import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { TerminalCommand, CommandResult } from '../types/terminal';

export class TerminalService {
    /**
     * Execute a dotnet command using child_process
     */
    static async executeDotNetCommand(command: TerminalCommand): Promise<CommandResult> {
        return new Promise((resolve) => {
            const args = command.command.split(' ');
            const cmd = args.shift() || '';

            const childProcess = spawn(cmd, args, {
                cwd: command.workingDirectory || process.cwd(),
                shell: true
            });

            let stdout = '';
            let stderr = '';

            childProcess.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            childProcess.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            childProcess.on('close', (code) => {
                resolve({
                    success: code === 0,
                    stdout,
                    stderr,
                    exitCode: code
                });
            });

            childProcess.on('error', (error) => {
                resolve({
                    success: false,
                    stdout,
                    stderr: error.message,
                    exitCode: null
                });
            });
        });
    }

    /**
     * Build a solution or project
     */
    static async buildSolution(solutionPath: string): Promise<CommandResult> {
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
    static async rebuildSolution(solutionPath: string): Promise<CommandResult> {
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
    static async cleanSolution(solutionPath: string): Promise<CommandResult> {
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
    static async installPackage(solutionPath: string, packageId: string, version?: string): Promise<CommandResult> {
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
    static async removePackage(projectPath: string, packageId: string): Promise<CommandResult> {
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
    static async updatePackage(projectPath: string, packageId: string, version: string): Promise<CommandResult> {
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
        try {
            const result = await this.executeDotNetCommand({
                name: 'dotnet-check',
                command: 'dotnet --version'
            });
            return result.success;
        } catch (error) {
            return false;
        }
    }
}