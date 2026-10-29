import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SolutionFileParser } from '../../parsers/solutionFileParser';
import { SolutionFile } from '../../types/solution';
import { Solution } from '../../core/Solution';
import { SolutionDiscovery } from './solutionDiscovery';
import { logger } from '../../core/logger';
import { checkOmniSharpForSlnx } from '../shared/csharpExtensionCheck';
import { offerSlnxMigration } from './slnxMigration';
import { offerLegacyConfigMove } from '../nuget/legacyConfigOffer';
import { setActiveSolutionPath } from './workspaceFolders';
import { ShowAllFiles } from './showAllFiles';

const log = logger('SolutionService');

/**
 * Centralized service for solution file operations
 * Now uses the Solution class for better architecture
 */
export class SolutionService {
    private static activeSolution?: Solution;
    private static readonly activeSolutionListeners = new Set<() => void>();
    /** Last load error shown, so repeated refreshes don't show the same error again */
    private static lastLoadError?: string;

    /**
     * Reads and parses a solution file with caching, including framework detection
     */
    static async parseSolutionFile(solutionPath: string): Promise<SolutionFile> {
        try {
            const solutionContent = await fs.promises.readFile(solutionPath, 'utf8');
            const solutionFile = await SolutionFileParser.parse(solutionContent, path.dirname(solutionPath));
            return solutionFile;
        } catch (error) {
            log.error('Error parsing solution file:', error);
            throw new Error(`Failed to parse solution file: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Discovers and selects the solution to use based on workspace contents
     * Implements the new discovery logic: single solution auto-selected,
     * multiple solutions prompt user selection, no solution offers creation
     */
    static async discoverAndInitializeSolution(): Promise<Solution | null> {
        try {
            // First dispose any existing active solution
            if (this.activeSolution) {
                this.activeSolution.dispose();
                this.setActiveSolution(undefined);
            }

            // Use the new discovery logic
            // Every folder of a multi-root workspace
            const solutionPath = await SolutionDiscovery.discoverAndSelectSolution((vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath));
            if (!solutionPath) {
                return null;
            }
            return await this.openSolution(solutionPath);
        } catch (error) {
            log.error('Error discovering and initializing solution:', error);
            return null;
        }
    }

    /** Loads a solution file as the active solution, e.g. after it was renamed */
    static async openSolution(solutionPath: string): Promise<Solution | null> {
        try {
            if (this.activeSolution) {
                this.activeSolution.dispose();
                this.setActiveSolution(undefined);
            }

            // Create and initialize the Solution instance
            const solution = new Solution(solutionPath);

            try {
                await solution.ready;
            } catch (error) {
                solution.dispose();
                this.reportLoadError(solutionPath, error);
                return null;
            }

            this.lastLoadError = undefined;
            this.setActiveSolution(solution);
            setActiveSolutionPath(solutionPath);
            ShowAllFiles.setSolution(solutionPath);
            await SolutionDiscovery.remember(solutionPath);
            checkOmniSharpForSlnx(solutionPath).catch(error => log.error('Error checking the C# language server:', error));
            offerSlnxMigration(solutionPath, {
                open: async slnxPath => {
                    await this.openSolution(slnxPath);
                    await vscode.commands.executeCommand('shinobi.internal.refreshSolution');
                },
            }).catch(error => log.error('Error offering the .slnx conversion:', error));
            offerLegacyConfigMove(solutionPath, 'open').catch(error => log.error('Error offering the NuGet.Config move:', error));
            log.info(`Initialized solution: ${path.basename(solutionPath)}`);

            return solution;
        } catch (error) {
            log.error(`Error opening ${solutionPath}:`, error);
            return null;
        }
    }

    private static reportLoadError(solutionPath: string, error: unknown): void {
        const reason = error instanceof Error ? error.message : String(error);
        const message = `Could not load ${path.basename(solutionPath)}: ${reason}`;
        log.error(message);
        if (message !== this.lastLoadError) {
            this.lastLoadError = message;
            vscode.window.showErrorMessage(message, 'Show Log').then(choice => {
                if (choice === 'Show Log') {
                    void vscode.commands.executeCommand('shinobi.showLog');
                }
            });
        }
    }

    private static setActiveSolution(solution: Solution | undefined): void {
        this.activeSolution = solution;
        for (const listener of [...this.activeSolutionListeners]) {
            try {
                listener();
            } catch (error) {
                log.error('A listener failed after the active solution changed:', error);
            }
        }
    }

    /** Called whenever a solution is opened or closed */
    static onDidChangeActiveSolution(listener: () => void): { dispose(): void } {
        this.activeSolutionListeners.add(listener);
        return { dispose: () => { this.activeSolutionListeners.delete(listener); } };
    }

    /**
     * Gets the currently active solution instance
     */
    static getActiveSolution(): Solution | undefined {
        return this.activeSolution;
    }

    /**
     * Disposes the active solution and clears cache
     */
    static dispose(): void {
        if (this.activeSolution) {
            this.activeSolution.dispose();
            this.setActiveSolution(undefined);
        }
    }

    /**
     * Get all target frameworks from projects in the solution
     */
    static getAllFrameworks(solutionFile: SolutionFile): string[] {
        const allFrameworks = new Set<string>();

        for (const project of solutionFile.projects) {
            if (SolutionFileParser.isDotNetProject(project) && project.targetFrameworks) {
                project.targetFrameworks.forEach(f => allFrameworks.add(f));
            }
        }

        return Array.from(allFrameworks).sort();
    }

    /**
     * Check if a framework is currently supported
     */
    static isFrameworkSupported(framework: string): boolean {
        const supportedFrameworks = ['net8.0', 'net9.0'];
        return supportedFrameworks.includes(framework);
    }

    /**
     * Get user-friendly display name for framework with support status
     */
    static getFrameworkDisplayName(framework: string): string {
        const frameworkInfo: { [key: string]: { name: string, status?: string } } = {
            // Current supported frameworks (as of 2024/2025/2026)
            'net8.0': { name: '.NET 8.0 (LTS)', status: '✅ Supported until November 2026' },
            'net9.0': { name: '.NET 9.0', status: '✅ Supported until November 2026' },
            'net10.0': { name: '.NET 10.0 (LTS)', status: '✅ Supported until November 2028' },

            // Out of support modern frameworks
            'net7.0': { name: '.NET 7.0', status: '⚠️ End of life May 2024' },
            'net6.0': { name: '.NET 6.0 (LTS)', status: '⚠️ End of life Nov 2024' },
            'net5.0': { name: '.NET 5.0', status: '❌ End of life May 2022' },

            // Legacy .NET Core (all out of support)
            'netcoreapp3.1': { name: '.NET Core 3.1 (LTS)', status: '❌ End of life Dec 2022' },
            'netcoreapp3.0': { name: '.NET Core 3.0', status: '❌ End of life Mar 2020' },
            'netcoreapp2.2': { name: '.NET Core 2.2', status: '❌ End of life Dec 2019' },
            'netcoreapp2.1': { name: '.NET Core 2.1 (LTS)', status: '❌ End of life Aug 2021' },
            'netcoreapp2.0': { name: '.NET Core 2.0', status: '❌ End of life Oct 2018' },
            'netcoreapp1.1': { name: '.NET Core 1.1', status: '❌ End of life Jun 2019' },
            'netcoreapp1.0': { name: '.NET Core 1.0', status: '❌ End of life Jun 2019' },

            // .NET Framework (still supported but legacy)
            'net4.8.1': { name: '.NET Framework 4.8.1', status: '🔶 Legacy - consider upgrading' },
            'net4.8': { name: '.NET Framework 4.8', status: '🔶 Legacy - consider upgrading' },
            'net4.7.2': { name: '.NET Framework 4.7.2', status: '🔶 Legacy - consider upgrading' },
            'net4.7.1': { name: '.NET Framework 4.7.1', status: '🔶 Legacy - consider upgrading' },
            'net4.7': { name: '.NET Framework 4.7', status: '🔶 Legacy - consider upgrading' },
            'net4.6.2': { name: '.NET Framework 4.6.2', status: '🔶 Legacy - consider upgrading' },
            'net4.6.1': { name: '.NET Framework 4.6.1', status: '🔶 Legacy - consider upgrading' },
            'net4.6': { name: '.NET Framework 4.6', status: '🔶 Legacy - consider upgrading' },
            'net4.5.2': { name: '.NET Framework 4.5.2', status: '❌ Out of support' },
            'net4.5.1': { name: '.NET Framework 4.5.1', status: '❌ Out of support' },
            'net4.5': { name: '.NET Framework 4.5', status: '❌ Out of support' },
            'net4.0': { name: '.NET Framework 4.0', status: '❌ Out of support' },
            'net3.5': { name: '.NET Framework 3.5', status: '❌ Out of support' },
            'net2.0': { name: '.NET Framework 2.0', status: '❌ Out of support' },

            // .NET Standard (current)
            'netstandard2.1': { name: '.NET Standard 2.1' },
            'netstandard2.0': { name: '.NET Standard 2.0' },
            'netstandard1.6': { name: '.NET Standard 1.6', status: '🔶 Consider netstandard2.0+' },
            'netstandard1.5': { name: '.NET Standard 1.5', status: '🔶 Consider netstandard2.0+' },
            'netstandard1.4': { name: '.NET Standard 1.4', status: '🔶 Consider netstandard2.0+' },
            'netstandard1.3': { name: '.NET Standard 1.3', status: '🔶 Consider netstandard2.0+' },
            'netstandard1.2': { name: '.NET Standard 1.2', status: '🔶 Consider netstandard2.0+' },
            'netstandard1.1': { name: '.NET Standard 1.1', status: '🔶 Consider netstandard2.0+' },
            'netstandard1.0': { name: '.NET Standard 1.0', status: '🔶 Consider netstandard2.0+' }
        };

        const info = frameworkInfo[framework];
        if (info) {
            return info.status ? `${info.name} - ${info.status}` : info.name;
        }

        return framework;
    }

}