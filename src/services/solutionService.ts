import * as fs from 'fs';
import * as path from 'path';
import { SolutionFileParser, SolutionFile, SolutionProject } from '../solutionFileParser';
import { SolutionUserFile } from '../solutionUserFile';

/**
 * Centralized service for solution file operations
 * Eliminates code duplication across command classes
 */
export class SolutionService {
    private static solutionCache = new Map<string, { content: SolutionFile; timestamp: number }>();
    private static readonly CACHE_TTL = 5000; // 5 seconds

    /**
     * Reads and parses a solution file with caching
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
            const solutionFile = SolutionFileParser.parse(solutionContent, path.dirname(solutionPath));

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

        // Convert relative path to absolute path
        return path.resolve(path.dirname(solutionPath), project.path);
    }

    /**
     * Gets the GUID of a project by its file path
     */
    static async getProjectGuid(solutionPath: string, projectPath: string): Promise<string | null> {
        const solutionFile = await this.parseSolutionFile(solutionPath);
        const solutionDir = path.dirname(solutionPath);

        for (const project of solutionFile.projects) {
            // Check both relative and absolute paths
            const absoluteProjectPath = path.resolve(solutionDir, project.path);
            if (absoluteProjectPath === projectPath || project.path === projectPath) {
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
            .map(project => path.resolve(solutionDir, project.path));
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
        const vscode = await import('vscode');
        const solutionFiles = await vscode.workspace.findFiles('*.sln', '**/node_modules/**');
        return solutionFiles.length > 0 ? solutionFiles[0].fsPath : null;
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
}