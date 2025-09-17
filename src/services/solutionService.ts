import * as fs from 'fs';
import * as path from 'path';
import { SolutionFileParser, SolutionFile, SolutionProject } from '../parsers/solutionFileParser';
import { SolutionUserFile } from '../parsers/solutionUserFile';

/**
 * Centralized service for solution file operations
 * Eliminates code duplication across command classes
 */
export class SolutionService {
    private static solutionCache = new Map<string, { content: SolutionFile; timestamp: number }>();
    private static readonly CACHE_TTL = 5000; // 5 seconds

    /**
     * Reads and parses a solution file with caching, including framework detection
     */
    static async parseSolutionFile(solutionPath: string): Promise<SolutionFile> {
        try {
            // Check cache first
            const cached = this.solutionCache.get(solutionPath);
            const now = Date.now();

            if (cached && (now - cached.timestamp) < this.CACHE_TTL) {
                return cached.content;
            }

            // Read and parse solution file
            const solutionContent = await fs.promises.readFile(solutionPath, 'utf8');
            const solutionFile = await SolutionFileParser.parse(solutionContent, path.dirname(solutionPath));

            // Update cache
            this.solutionCache.set(solutionPath, { content: solutionFile, timestamp: now });

            return solutionFile;
        } catch (error) {
            console.error('Error parsing solution file:', error);
            throw new Error(`Failed to parse solution file: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Gets the raw content of a solution file
     */
    static async readSolutionContent(solutionPath: string): Promise<string> {
        return await fs.promises.readFile(solutionPath, 'utf8');
    }

    /**
     * Writes content to a solution file and clears cache
     */
    static async writeSolutionContent(solutionPath: string, content: string): Promise<void> {
        await fs.promises.writeFile(solutionPath, content, 'utf8');
        // Clear cache for this solution
        this.solutionCache.delete(solutionPath);
    }

    /**
     * Finds a project by its GUID
     */
    static async findProjectByGuid(solutionPath: string, projectGuid: string): Promise<SolutionProject | null> {
        const solutionFile = await this.parseSolutionFile(solutionPath);
        return solutionFile.projects.find(p => p.guid === projectGuid) || null;
    }

    /**
     * Gets the absolute path of a project from its GUID
     */
    static async getProjectPath(solutionPath: string, projectGuid: string): Promise<string | null> {
        const project = await this.findProjectByGuid(solutionPath, projectGuid);
        if (!project) {
            return null;
        }

        // Normalize path separators for cross-platform compatibility and convert to absolute path
        const normalizedPath = project.path.replace(/\\/g, path.sep);
        return path.resolve(path.dirname(solutionPath), normalizedPath);
    }

    /**
     * Gets the GUID of a project by its file path
     */
    static async getProjectGuid(solutionPath: string, projectPath: string): Promise<string | null> {
        const solutionFile = await this.parseSolutionFile(solutionPath);
        const solutionDir = path.dirname(solutionPath);

        for (const project of solutionFile.projects) {
            // Normalize path separators for cross-platform compatibility
            const normalizedPath = project.path.replace(/\\/g, path.sep);
            const absoluteProjectPath = path.resolve(solutionDir, normalizedPath);
            if (absoluteProjectPath === projectPath || normalizedPath === projectPath) {
                return project.guid;
            }
        }
        return null;
    }

    /**
     * Gets all .NET project paths from a solution
     */
    static async getProjectPaths(solutionPath: string): Promise<string[]> {
        const solutionFile = await this.parseSolutionFile(solutionPath);
        const solutionDir = path.dirname(solutionPath);

        return solutionFile.projects
            .filter(project => SolutionFileParser.isDotNetProject(project))
            .map(project => {
                const normalizedPath = project.path.replace(/\\/g, path.sep);
                return path.resolve(solutionDir, normalizedPath);
            });
    }

    /**
     * Gets the current startup project from .sln.user file
     */
    static async getCurrentStartupProject(solutionPath: string): Promise<string | null> {
        const userFile = new SolutionUserFile(solutionPath);
        return await userFile.getStartupProject();
    }

    /**
     * Sets the startup project in .sln.user file
     */
    static async setStartupProject(solutionPath: string, projectGuid: string): Promise<void> {
        const userFile = new SolutionUserFile(solutionPath);
        await userFile.setStartupProject(projectGuid);
    }

    /**
     * Clears the startup project from .sln.user file
     */
    static async clearStartupProject(solutionPath: string): Promise<void> {
        const userFile = new SolutionUserFile(solutionPath);
        await userFile.clearStartupProject();
    }

    /**
     * Finds the first solution file in a workspace
     */
    static async findSolutionFile(workspaceRoot: string): Promise<string | null> {
        try {
            const files = await fs.promises.readdir(workspaceRoot);
            const solutionFiles = files
                .filter(file => file.endsWith('.sln'))
                .map(file => path.join(workspaceRoot, file));

            return solutionFiles.length > 0 ? solutionFiles[0] : null;
        } catch (error) {
            console.error('Error finding solution files:', error);
            return null;
        }
    }

    /**
     * Clears the solution cache (useful for testing or after major changes)
     */
    static clearCache(): void {
        this.solutionCache.clear();
    }

    /**
     * Gets solution statistics for debugging
     */
    static async getSolutionStats(solutionPath: string): Promise<{
        totalProjects: number;
        dotNetProjects: number;
        solutionFolders: number;
        startupProject: string | null;
    }> {
        const solutionFile = await this.parseSolutionFile(solutionPath);
        const startupProject = await this.getCurrentStartupProject(solutionPath);

        return {
            totalProjects: solutionFile.projects.length,
            dotNetProjects: solutionFile.projects.filter(p => SolutionFileParser.isDotNetProject(p)).length,
            solutionFolders: solutionFile.projects.filter(p => SolutionFileParser.isSolutionFolder(p)).length,
            startupProject
        };
    }

    /**
     * Get all target frameworks from projects in the solution
     */
    static async getAllFrameworks(solutionPath: string): Promise<string[]> {
        const solutionFile = await this.parseSolutionFile(solutionPath);
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
            // Current supported frameworks (as of 2024/2025)
            'net8.0': { name: '.NET 8.0 (LTS)', status: '✅ Supported until Nov 2026' },
            'net9.0': { name: '.NET 9.0', status: '✅ Supported until May 2025' },

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

    /**
     * Get recommended upgrade path for a framework
     */
    static getUpgradeRecommendation(framework: string): string {
        if (framework.startsWith('net6') || framework.startsWith('net7')) {
            return 'Consider upgrading to .NET 8.0 (LTS) for continued support and performance improvements.';
        }
        if (framework.startsWith('netcoreapp') || framework.startsWith('net5')) {
            return 'Upgrade to .NET 8.0 (LTS) - this framework is no longer supported.';
        }
        if (framework.startsWith('net4')) {
            return 'Consider migrating to .NET 8.0 for better performance, cross-platform support, and modern features.';
        }
        if (framework.startsWith('netstandard1')) {
            return 'Consider targeting .NET Standard 2.0 or higher for better API surface.';
        }
        return '';
    }

}