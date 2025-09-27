import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../core/logger';

export interface SolutionDiscoveryResult {
    type: 'none' | 'single' | 'multiple';
    solutionPath?: string;
    availableSolutions?: string[];
}

export class SolutionDiscovery {
    private static readonly logger = logger('SolutionDiscovery');
    /**
     * Discovers solution files in the workspace root
     * Returns discovery result with type and available solutions
     */
    static async discoverSolutions(workspaceRoot: string): Promise<SolutionDiscoveryResult> {
        try {
            const files = await fs.promises.readdir(workspaceRoot);
            const solutionFiles = files
                .filter(file => file.endsWith('.sln'))
                .map(file => path.join(workspaceRoot, file));

            if (solutionFiles.length === 0) {
                return { type: 'none' };
            } else if (solutionFiles.length === 1) {
                return {
                    type: 'single',
                    solutionPath: solutionFiles[0]
                };
            } else {
                return {
                    type: 'multiple',
                    availableSolutions: solutionFiles
                };
            }
        } catch (error) {
            SolutionDiscovery.logger.error('Error discovering solution files:', error);
            return { type: 'none' };
        }
    }

    /**
     * Shows a UI to let user select which solution to open when multiple exist
     */
    static async selectSolution(availableSolutions: string[]): Promise<string | null> {
        const items = availableSolutions.map(solutionPath => ({
            label: path.basename(solutionPath, '.sln'),
            description: path.dirname(solutionPath),
            solutionPath
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a solution to open',
            title: 'Multiple Solution Files Found'
        });

        return selected?.solutionPath || null;
    }

    /**
     * Shows UI to create a new solution when none exists
     */
    static async promptCreateSolution(workspaceRoot: string): Promise<string | null> {
        const createOption = await vscode.window.showInformationMessage(
            'No solution file found in the workspace. Would you like to create one?',
            'Create Solution',
            'Skip'
        );

        if (createOption !== 'Create Solution') {
            return null;
        }

        // Get solution name from user
        const solutionName = await vscode.window.showInputBox({
            prompt: 'Enter solution name',
            placeHolder: 'MySolution',
            title: 'Create New Solution',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Solution name cannot be empty';
                }
                if (!/^[a-zA-Z][a-zA-Z0-9._\-]*$/.test(value.trim())) {
                    return 'Solution name must start with a letter and contain only letters, numbers, dots, hyphens, and underscores';
                }
                return null;
            }
        });

        if (!solutionName) {
            return null;
        }

        const solutionPath = path.join(workspaceRoot, `${solutionName.trim()}.sln`);

        try {
            await this.createEmptySolution(solutionPath);
            vscode.window.showInformationMessage(`Created solution: ${solutionName}`);
            return solutionPath;
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create solution: ${error}`);
            return null;
        }
    }

    /**
     * Creates an empty solution file
     */
    private static async createEmptySolution(solutionPath: string): Promise<void> {
        const solutionContent = `
Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
VisualStudioVersion = 17.0.31903.59
MinimumVisualStudioVersion = 10.0.40219.1
Global
	GlobalSection(SolutionProperties) = preSolution
		HideSolutionNode = FALSE
	EndGlobalSection
	GlobalSection(ExtensibilityGlobals) = postSolution
		SolutionGuid = {${randomUUID()}}
	EndGlobalSection
EndGlobal
`.trim();

        await fs.promises.writeFile(solutionPath, solutionContent, 'utf8');
    }

    /**
     * Main entry point for solution discovery and selection
     * Returns the path to the solution that should be used
     */
    static async discoverAndSelectSolution(workspaceRoot: string): Promise<string | null> {
        const discovery = await this.discoverSolutions(workspaceRoot);

        switch (discovery.type) {
            case 'single':
                return discovery.solutionPath!;

            case 'multiple':
                return await this.selectSolution(discovery.availableSolutions!);

            case 'none':
                return await this.promptCreateSolution(workspaceRoot);

            default:
                return null;
        }
    }
}