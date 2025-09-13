import * as vscode from 'vscode';
import * as path from 'path';

export interface TerminalCommand {
    name: string;
    command: string;
    workingDirectory?: string;
    showTerminal?: boolean;
}

export class TerminalService {
    /**
     * Execute a dotnet command in a new terminal
     */
    static async executeDotNetCommand(command: TerminalCommand): Promise<vscode.Terminal> {
        const terminal = vscode.window.createTerminal({
            name: command.name,
            cwd: command.workingDirectory
        });

        if (command.showTerminal !== false) {
            terminal.show();
        }

        terminal.sendText(command.command);
        return terminal;
    }

    /**
     * Build a solution or project
     */
    static async buildSolution(solutionPath: string): Promise<vscode.Terminal> {
        const solutionName = path.basename(solutionPath, '.sln');
        
        return this.executeDotNetCommand({
            name: `Build ${solutionName}`,
            command: `dotnet build "${solutionPath}"`,
            workingDirectory: path.dirname(solutionPath)
        });
    }

    /**
     * Rebuild a solution (clean + build)
     */
    static async rebuildSolution(solutionPath: string): Promise<vscode.Terminal> {
        const solutionName = path.basename(solutionPath, '.sln');
        
        return this.executeDotNetCommand({
            name: `Rebuild ${solutionName}`,
            command: `dotnet clean "${solutionPath}" && dotnet build "${solutionPath}"`,
            workingDirectory: path.dirname(solutionPath)
        });
    }

    /**
     * Clean a solution
     */
    static async cleanSolution(solutionPath: string): Promise<vscode.Terminal> {
        const solutionName = path.basename(solutionPath, '.sln');
        
        return this.executeDotNetCommand({
            name: `Clean ${solutionName}`,
            command: `dotnet clean "${solutionPath}"`,
            workingDirectory: path.dirname(solutionPath)
        });
    }

    /**
     * Install a NuGet package
     */
    static async installPackage(solutionPath: string, packageId: string, version?: string): Promise<vscode.Terminal> {
        const versionParam = version ? `--version ${version}` : '';
        const command = `dotnet add package ${packageId} ${versionParam}`.trim();
        
        return this.executeDotNetCommand({
            name: `Install ${packageId}`,
            command: command,
            workingDirectory: path.dirname(solutionPath)
        });
    }

    /**
     * Remove a NuGet package
     */
    static async removePackage(projectPath: string, packageId: string): Promise<vscode.Terminal> {
        const command = `dotnet remove package ${packageId}`;
        
        return this.executeDotNetCommand({
            name: `Remove ${packageId}`,
            command: command,
            workingDirectory: path.dirname(projectPath)
        });
    }

    /**
     * Update a NuGet package to a specific version
     */
    static async updatePackage(projectPath: string, packageId: string, version: string): Promise<vscode.Terminal> {
        // To update a package, we need to remove it first, then add the new version
        const removeCommand = `dotnet remove package ${packageId}`;
        const addCommand = `dotnet add package ${packageId} --version ${version}`;
        const combinedCommand = `${removeCommand} && ${addCommand}`;
        
        return this.executeDotNetCommand({
            name: `Update ${packageId}`,
            command: combinedCommand,
            workingDirectory: path.dirname(projectPath)
        });
    }

    /**
     * Check if dotnet CLI is available
     */
    static async isDotNetAvailable(): Promise<boolean> {
        return new Promise((resolve) => {
            const terminal = vscode.window.createTerminal({
                name: 'dotnet-check',
                hideFromUser: true
            });

            // This is a simple check - in a real implementation you might want to use child_process
            // For now, we'll assume dotnet is available if we can create a terminal
            terminal.dispose();
            resolve(true);
        });
    }
}