import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ProjectInfo {
    name: string;
    path: string;
    relativePath: string;
}

export class SolutionManager {
    constructor(private workspaceRoot: string) {}

    async listProjects(solutionPath: string): Promise<ProjectInfo[]> {
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
            console.error('Error listing projects from solution:', error);
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
            console.error('Error adding project to solution:', error);
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
            console.error('Error removing project from solution:', error);
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
            console.error('Error creating solution:', error);
            vscode.window.showErrorMessage(`Failed to create solution: ${error}`);
            return false;
        }
    }

    async getAvailableProjects(): Promise<string[]> {
        try {
            const projectFiles = await vscode.workspace.findFiles('**/*.{csproj,vbproj,fsproj}', '**/node_modules/**');
            return projectFiles.map(file => file.fsPath);
        } catch (error) {
            console.error('Error finding available projects:', error);
            return [];
        }
    }
}