import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionProvider } from '../solutionProvider';
import { PathUtils, ValidationUtils, ErrorUtils, InputUtils } from '../utils';

export class SolutionCommands {
    constructor(
        private context: vscode.ExtensionContext,
        private solutionProvider: SolutionProvider
    ) {}

    public registerCommands(): void {
        this.registerCommand('refreshSolution', this.refreshSolution.bind(this));
        this.registerCommand('renameSolution', this.renameSolution.bind(this));
        this.registerCommand('newProject', this.newProject.bind(this));
        this.registerCommand('addExistingProject', this.addExistingProject.bind(this));
        this.registerCommand('newSolutionFolder', this.newSolutionFolder.bind(this));
    }

    private registerCommand(commandName: string, callback: (...args: any[]) => any): void {
        const command = vscode.commands.registerCommand(`dotnet-extension.${commandName}`, callback);
        this.context.subscriptions.push(command);
    }

    private refreshSolution(): void {
        this.solutionProvider.refresh();
    }

    private async renameSolution(item: any): Promise<void> {
        const solutionPath = PathUtils.getPathFromItem(item, 'rename solution');
        if (!solutionPath) return;

        const currentName = path.basename(solutionPath, '.sln');
        
        const newName = await InputUtils.showInputBox(
            `Rename solution "${currentName}"`,
            currentName,
            ValidationUtils.createNameValidator('Solution', false)
        );

        if (newName && newName !== currentName) {
            try {
                const fs = require('fs');
                const solutionDir = path.dirname(solutionPath);
                const newSolutionPath = path.join(solutionDir, `${newName}.sln`);
                
                // Check if new name already exists
                if (fs.existsSync(newSolutionPath)) {
                    ErrorUtils.showError(`A solution named "${newName}" already exists`);
                    return;
                }
                
                await fs.promises.rename(solutionPath, newSolutionPath);
                this.solutionProvider.refresh();
                vscode.window.showInformationMessage(`Renamed solution to "${newName}"`);
            } catch (error) {
                ErrorUtils.showError(`Failed to rename solution`, error);
            }
        }
    }

    private async newProject(item: any): Promise<void> {
        if (!item || !item.resourceUri) {
            ErrorUtils.showError('No solution selected');
            return;
        }

        const solutionPath = item.resourceUri.fsPath;
        const solutionDir = path.dirname(solutionPath);

        // Show project template selection
        const templates = [
            { label: 'Console Application', value: 'console' },
            { label: 'Class Library', value: 'classlib' },
            { label: 'Web API', value: 'webapi' },
            { label: 'MVC Web Application', value: 'mvc' },
            { label: 'Blazor WebAssembly', value: 'blazorwasm' },
            { label: 'Blazor Server', value: 'blazorserver' },
            { label: 'WPF Application', value: 'wpf' },
            { label: 'WinForms Application', value: 'winforms' },
            { label: 'xUnit Test Project', value: 'xunit' },
            { label: 'NUnit Test Project', value: 'nunit' },
            { label: 'MSTest Test Project', value: 'mstest' }
        ];

        const selectedTemplate = await InputUtils.showQuickPick(
            templates,
            'Select project template'
        );

        if (!selectedTemplate || Array.isArray(selectedTemplate)) return;

        const projectName = await InputUtils.showInputBox(
            'Enter project name',
            undefined,
            ValidationUtils.createNameValidator('Project', false)
        );

        if (!projectName) return;

        try {
            const projectDir = path.join(solutionDir, projectName);
            
            // Create project using dotnet CLI
            const terminal = vscode.window.createTerminal({
                name: 'New Project',
                cwd: solutionDir
            });

            terminal.sendText(`dotnet new ${selectedTemplate.value} -n "${projectName}" -o "${projectName}"`);
            terminal.sendText(`dotnet sln add "${projectName}/${projectName}.csproj"`);
            terminal.show();
            
            this.solutionProvider.refresh();
            vscode.window.showInformationMessage(`Created new ${selectedTemplate.label}: ${projectName}`);
        } catch (error) {
            ErrorUtils.showError('Failed to create new project', error);
        }
    }

    private async addExistingProject(item: any): Promise<void> {
        if (!item || !item.resourceUri) {
            ErrorUtils.showError('No solution selected');
            return;
        }

        const solutionPath = item.resourceUri.fsPath;
        const solutionDir = path.dirname(solutionPath);

        const projectFiles = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            filters: {
                'Project Files': ['csproj', 'vbproj', 'fsproj']
            },
            defaultUri: vscode.Uri.file(solutionDir)
        });

        if (!projectFiles || projectFiles.length === 0) {
            return;
        }

        try {
            for (const projectFile of projectFiles) {
                const success = await this.solutionProvider.addProjectToSolution(solutionPath, projectFile.fsPath);
                if (success) {
                    const projectName = PathUtils.getProjectName(projectFile.fsPath);
                    vscode.window.showInformationMessage(`Added project: ${projectName}`);
                }
            }
        } catch (error) {
            ErrorUtils.showError('Failed to add project to solution', error);
        }
    }

    private async newSolutionFolder(item: any): Promise<void> {
        if (!item || !item.solutionPath) {
            ErrorUtils.showError('No solution selected');
            return;
        }

        const solutionPath = item.solutionPath || (item.resourceUri ? item.resourceUri.fsPath : null);
        if (!solutionPath) {
            ErrorUtils.showError('Cannot find solution path');
            return;
        }
        
        const solutionName = path.basename(solutionPath, '.sln');
        
        const folderName = await InputUtils.showInputBox(
            `Create new solution folder in "${solutionName}"`,
            'New Solution Folder',
            ValidationUtils.createNameValidator('Solution folder')
        );

        if (!folderName) return;

        try {
            const fs = require('fs');
            const solutionContent = await fs.promises.readFile(solutionPath, 'utf8');
            
            // Generate GUID for new solution folder
            const folderGuid = '{' + 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            }).toUpperCase() + '}';
            
            // Insert solution folder entry
            const folderEntry = `Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "${folderName}", "${folderName}", "${folderGuid}"\nEndProject`;
            
            // Find a good insertion point (after last Project entry)
            const lines = solutionContent.split('\n');
            let insertIndex = -1;
            
            for (let i = lines.length - 1; i >= 0; i--) {
                const line: string = lines[i];
                if (line.trim() === 'EndProject') {
                    insertIndex = i + 1;
                    break;
                }
            }
            
            if (insertIndex === -1) {
                // Fallback: insert before Global section
                insertIndex = lines.findIndex((line: string) => line.trim() === 'Global');
                if (insertIndex === -1) {
                    insertIndex = lines.length;
                }
            }
            
            lines.splice(insertIndex, 0, folderEntry);
            const updatedContent = lines.join('\n');
            
            await fs.promises.writeFile(solutionPath, updatedContent, 'utf8');
            this.solutionProvider.refresh();
            vscode.window.showInformationMessage(`Created solution folder: ${folderName}`);
        } catch (error) {
            ErrorUtils.showError('Failed to create solution folder', error);
        }
    }
}