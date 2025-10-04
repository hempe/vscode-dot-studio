import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Solution } from '../core/Solution';
import { Project } from '../core/Project';
import { logger } from '../core/logger';

const execAsync = promisify(exec);
const log = logger('PackageUpdateService');

export interface ProjectInfo {
    name: string;
    path: string;
    relativePath: string;
}

export class SolutionManager {
    constructor(private workspaceRoot: string) { }

    /**
     * Lists projects from a solution using the Solution class
     */
    async listProjects(solutionPath: string): Promise<ProjectInfo[]> {
        try {
            // Create a temporary Solution instance to get project information
            const solution = new Solution(solutionPath);

            // Wait for initialization
            let retries = 0;
            while (!solution.isInitialized && retries < 50) {
                await new Promise(resolve => setTimeout(resolve, 100));
                retries++;
            }

            if (!solution.isInitialized) {
                log.warn('Solution initialization timed out, falling back to CLI');
                solution.dispose();
                return this.listProjectsWithCli(solutionPath);
            }

            const projects: ProjectInfo[] = [];
            const dotNetProjects = solution.getDotNetProjects();

            for (const project of dotNetProjects) {
                const relativePath = path.relative(path.dirname(solutionPath), project.projectPath);
                projects.push({
                    name: project.name,
                    path: project.projectPath,
                    relativePath: relativePath.replace(/\\/g, '/')
                });
            }

            solution.dispose();
            return projects;
        } catch (error) {
            log.error('Error listing projects from solution:', error);
            // Fallback to CLI approach
            return this.listProjectsWithCli(solutionPath);
        }
    }

    /**
     * Fallback method using dotnet CLI
     */
    private async listProjectsWithCli(solutionPath: string): Promise<ProjectInfo[]> {
        try {
            const { stdout } = await execAsync(`dotnet sln "${solutionPath}" list`, {
                cwd: this.workspaceRoot
            });

            const projects: ProjectInfo[] = [];
            const lines = stdout.split('\n');

            // Skip header lines and process project entries
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine &&
                    !trimmedLine.startsWith('Project(s)') &&
                    !trimmedLine.startsWith('----------') &&
                    (trimmedLine.endsWith('.csproj') ||
                        trimmedLine.endsWith('.vbproj') ||
                        trimmedLine.endsWith('.fsproj'))) {

                    const relativePath = trimmedLine.replace(/\\/g, '/');
                    const absolutePath = path.resolve(path.dirname(solutionPath), relativePath);
                    const projectName = path.basename(relativePath, path.extname(relativePath));

                    projects.push({
                        name: projectName,
                        path: absolutePath,
                        relativePath
                    });
                }
            }

            return projects;
        } catch (error) {
            log.error('Error listing projects with CLI:', error);
            return [];
        }
    }

    async addProject(solutionPath: string, projectPath: string): Promise<boolean> {
        try {
            await execAsync(`dotnet sln "${solutionPath}" add "${projectPath}"`, {
                cwd: this.workspaceRoot
            });
            return true;
        } catch (error) {
            log.error('Error adding project to solution:', error);
            vscode.window.showErrorMessage(`Failed to add project: ${error}`);
            return false;
        }
    }

    async removeProject(solutionPath: string, projectPath: string): Promise<boolean> {
        try {
            await execAsync(`dotnet sln "${solutionPath}" remove "${projectPath}"`, {
                cwd: this.workspaceRoot
            });
            return true;
        } catch (error) {
            log.error('Error removing project from solution:', error);
            vscode.window.showErrorMessage(`Failed to remove project: ${error}`);
            return false;
        }
    }

    async createSolution(solutionPath: string, solutionName?: string): Promise<boolean> {
        try {
            const name = solutionName || path.basename(solutionPath, '.sln');
            await execAsync(`dotnet new sln -n "${name}"`, {
                cwd: path.dirname(solutionPath)
            });
            return true;
        } catch (error) {
            log.error('Error creating solution:', error);
            vscode.window.showErrorMessage(`Failed to create solution: ${error}`);
            return false;
        }
    }
}