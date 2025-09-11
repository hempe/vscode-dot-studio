import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionProvider } from '../solutionProvider';
import { ValidationUtils, ErrorUtils, InputUtils } from '../utils';

export class SolutionFolderCommands {
    constructor(
        private context: vscode.ExtensionContext,
        private solutionProvider: SolutionProvider
    ) {}

    public registerCommands(): void {
        this.registerCommand('addExistingFile', this.addExistingFile.bind(this));
        this.registerCommand('renameSolutionFolder', this.renameSolutionFolder.bind(this));
        this.registerCommand('deleteSolutionFolder', this.deleteSolutionFolder.bind(this));
    }

    private registerCommand(commandName: string, callback: (...args: any[]) => any): void {
        const command = vscode.commands.registerCommand(`dotnet-extension.${commandName}`, callback);
        this.context.subscriptions.push(command);
    }

    private async addExistingFile(item: any): Promise<void> {
        if (!item || !item.solutionPath) {
            ErrorUtils.showError('No solution folder selected');
            return;
        }

        const solutionPath = item.solutionPath;
        const solutionDir = path.dirname(solutionPath);

        // Open file picker for any file type
        const selectedFiles = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            defaultUri: vscode.Uri.file(solutionDir),
            openLabel: 'Add to Solution Root'
        });

        if (!selectedFiles || selectedFiles.length === 0) {
            return;
        }

        // Copy files to solution directory root since solution folders are virtual
        let copiedCount = 0;
        let failedFiles: string[] = [];

        for (const selectedFile of selectedFiles) {
            try {
                const fs = require('fs');
                const fileName = path.basename(selectedFile.fsPath);
                const targetPath = path.join(solutionDir, fileName);
                
                // Copy file to solution directory
                await fs.promises.copyFile(selectedFile.fsPath, targetPath);
                copiedCount++;
            } catch (error) {
                failedFiles.push(path.basename(selectedFile.fsPath));
            }
        }

        this.solutionProvider.refresh();

        if (copiedCount > 0 && failedFiles.length === 0) {
            vscode.window.showInformationMessage(`Added ${copiedCount} file${copiedCount > 1 ? 's' : ''} to solution root`);
        } else if (copiedCount > 0 && failedFiles.length > 0) {
            vscode.window.showWarningMessage(`Added ${copiedCount} file${copiedCount > 1 ? 's' : ''}. Failed to add: ${failedFiles.join(', ')}`);
        } else {
            ErrorUtils.showError('Failed to add files to solution root');
        }
    }

    private async renameSolutionFolder(item: any): Promise<void> {
        if (!item || !item.solutionPath) {
            ErrorUtils.showError('No solution folder selected');
            return;
        }

        const solutionPath = item.solutionPath;
        const currentName = item.label;
        
        const newName = await InputUtils.showInputBox(
            `Rename solution folder "${currentName}"`,
            currentName,
            ValidationUtils.createNameValidator('Solution folder')
        );

        if (newName && newName !== currentName) {
            try {
                const fs = require('fs');
                const solutionContent = await fs.promises.readFile(solutionPath, 'utf8');
                
                // Replace the solution folder name in the .sln file
                const updatedContent = solutionContent.replace(
                    new RegExp(`Project\\("\\{2150E333-8FDC-42A3-9474-1A3956D46DE8\\}"\\)\\s*=\\s*"${currentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g'),
                    `Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "${newName.trim()}"`
                );
                
                await fs.promises.writeFile(solutionPath, updatedContent, 'utf8');
                this.solutionProvider.refresh();
                vscode.window.showInformationMessage(`Renamed solution folder to "${newName}"`);
            } catch (error) {
                ErrorUtils.showError(`Failed to rename solution folder`, error);
            }
        }
    }

    private async deleteSolutionFolder(item: any): Promise<void> {
        if (!item || !item.solutionPath) {
            ErrorUtils.showError('No solution folder selected');
            return;
        }

        const solutionPath = item.solutionPath;
        const folderName = item.label;
        
        const confirmed = await vscode.window.showWarningMessage(
            `Are you sure you want to delete the solution folder "${folderName}"?`,
            { modal: true },
            'Delete'
        );
        
        if (confirmed === 'Delete') {
            try {
                const fs = require('fs');
                const solutionContent = await fs.promises.readFile(solutionPath, 'utf8');
                
                // Remove the solution folder entry and any nested projects references
                const lines = solutionContent.split('\n');
                const updatedLines: string[] = [];
                let skipUntilEndProject = false;
                
                for (const line of lines) {
                    if (line.includes(`Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "${folderName}"`)) {
                        skipUntilEndProject = true;
                        continue;
                    }
                    
                    if (skipUntilEndProject && line.trim() === 'EndProject') {
                        skipUntilEndProject = false;
                        continue;
                    }
                    
                    if (!skipUntilEndProject) {
                        updatedLines.push(line);
                    }
                }
                
                const updatedContent = updatedLines.join('\n');
                await fs.promises.writeFile(solutionPath, updatedContent, 'utf8');
                
                this.solutionProvider.refresh();
                vscode.window.showInformationMessage(`Deleted solution folder "${folderName}"`);
            } catch (error) {
                ErrorUtils.showError(`Failed to delete solution folder`, error);
            }
        }
    }
}