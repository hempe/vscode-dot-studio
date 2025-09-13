import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionProvider } from '../solutionProvider';
import { ValidationUtils, ErrorUtils, InputUtils } from '../utils';

export class SolutionFolderCommands {
    constructor(
        private context: vscode.ExtensionContext,
        private solutionProvider: SolutionProvider,
        private solutionTreeView?: vscode.TreeView<any>
    ) {}

    public registerCommands(): void {
        this.registerCommand('addExistingFile', this.addExistingFile.bind(this));
        this.registerCommand('renameSolutionFolder', this.renameSolutionFolder.bind(this));
        this.registerCommand('deleteSolutionFolder', this.deleteSolutionFolder.bind(this));
        this.registerCommand('deleteSolutionItem', this.deleteSolutionItem.bind(this));
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
        const targetFolder = item.contextValue === 'solutionFolder' ? item.label : null;

        // Open file picker for any file type
        const selectedFiles = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            defaultUri: vscode.Uri.file(solutionDir),
            openLabel: targetFolder ? `Add to Solution Folder "${targetFolder}"` : 'Add to Solution'
        });

        if (!selectedFiles || selectedFiles.length === 0) {
            return;
        }

        try {
            const fs = require('fs');
            const solutionContent = await fs.promises.readFile(solutionPath, 'utf8');
            const lines = solutionContent.split('\n');
            
            let addedCount = 0;
            let failedFiles: string[] = [];
            let updatedLines = [...lines];

            for (const selectedFile of selectedFiles) {
                try {
                    const fileName = path.basename(selectedFile.fsPath);
                    let relativePath = path.relative(solutionDir, selectedFile.fsPath);
                    
                    // Normalize path separators for .sln file format
                    relativePath = relativePath.replace(/\//g, '\\');

                    // Generate GUID for solution item
                    const itemGuid = '{' + 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                        const r = Math.random() * 16 | 0;
                        const v = c === 'x' ? r : (r & 0x3 | 0x8);
                        return v.toString(16);
                    }).toUpperCase() + '}';

                    // Solution items are added to existing solution folders via ProjectSection(SolutionItems)
                    // If we're adding to a solution folder, we need to modify that folder's ProjectSection
                    // If adding to solution root, we need to create a special "Solution Items" folder
                    
                    let itemEntry: string;
                    if (targetFolder && item.id) {
                        // Adding to existing solution folder - we'll modify the folder's ProjectSection later
                        itemEntry = ''; // No new project entry needed
                    } else {
                        // Adding to solution root - create "Solution Items" folder if it doesn't exist
                        itemEntry = `Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Solution Items", "Solution Items", "${itemGuid}"\n\tProjectSection(SolutionItems) = preProject\n\t\t${relativePath} = ${relativePath}\n\tEndProjectSection\nEndProject`;
                    }
                    
                    // Find insertion point (after last Project entry)
                    let insertIndex = -1;
                    for (let i = updatedLines.length - 1; i >= 0; i--) {
                        if (updatedLines[i].trim() === 'EndProject') {
                            insertIndex = i + 1;
                            break;
                        }
                    }
                    
                    if (insertIndex === -1) {
                        insertIndex = updatedLines.findIndex(line => line.trim() === 'Global');
                        if (insertIndex === -1) {
                            insertIndex = updatedLines.length;
                        }
                    }
                    
                    if (itemEntry) {
                        updatedLines.splice(insertIndex, 0, itemEntry);
                    }

                    // If adding to an existing solution folder, modify that folder's ProjectSection
                    if (targetFolder && item.id) {
                        // Find the target solution folder in the file
                        let targetFolderIndex = -1;
                        let targetFolderEndIndex = -1;
                        
                        for (let i = 0; i < updatedLines.length; i++) {
                            if (updatedLines[i].includes(`"${targetFolder}"`) && 
                                updatedLines[i].includes('2150E333-8FDC-42A3-9474-1A3956D46DE8') &&
                                updatedLines[i].includes(item.id)) {
                                targetFolderIndex = i;
                                // Find the corresponding EndProject
                                for (let j = i + 1; j < updatedLines.length; j++) {
                                    if (updatedLines[j].trim() === 'EndProject') {
                                        targetFolderEndIndex = j;
                                        break;
                                    }
                                }
                                break;
                            }
                        }
                        
                        if (targetFolderIndex !== -1 && targetFolderEndIndex !== -1) {
                            // Check if this folder already has a ProjectSection(SolutionItems)
                            let hasSolutionItems = false;
                            let solutionItemsEndIndex = -1;
                            
                            for (let i = targetFolderIndex; i < targetFolderEndIndex; i++) {
                                if (updatedLines[i].includes('ProjectSection(SolutionItems)')) {
                                    hasSolutionItems = true;
                                    // Find EndProjectSection
                                    for (let j = i + 1; j < targetFolderEndIndex; j++) {
                                        if (updatedLines[j].trim() === 'EndProjectSection') {
                                            solutionItemsEndIndex = j;
                                            break;
                                        }
                                    }
                                    break;
                                }
                            }
                            
                            if (hasSolutionItems && solutionItemsEndIndex !== -1) {
                                // Add to existing ProjectSection
                                updatedLines.splice(solutionItemsEndIndex, 0, `\t\t${relativePath} = ${relativePath}`);
                            } else {
                                // Add new ProjectSection
                                updatedLines.splice(targetFolderEndIndex, 0, 
                                    '\tProjectSection(SolutionItems) = preProject',
                                    `\t\t${relativePath} = ${relativePath}`,
                                    '\tEndProjectSection'
                                );
                            }
                        }
                    }

                    addedCount++;
                } catch (error) {
                    failedFiles.push(path.basename(selectedFile.fsPath));
                }
            }

            // Write updated solution file
            const updatedContent = updatedLines.join('\n');
            await fs.promises.writeFile(solutionPath, updatedContent, 'utf8');
            
            this.solutionProvider.refresh();

            if (addedCount > 0 && failedFiles.length === 0) {
                const location = targetFolder ? `solution folder "${targetFolder}"` : 'solution';
                vscode.window.showInformationMessage(`Added ${addedCount} file${addedCount > 1 ? 's' : ''} to ${location}`);
            } else if (addedCount > 0 && failedFiles.length > 0) {
                vscode.window.showWarningMessage(`Added ${addedCount} file${addedCount > 1 ? 's' : ''}. Failed to add: ${failedFiles.join(', ')}`);
            } else {
                ErrorUtils.showError('Failed to add files to solution');
            }
        } catch (error) {
            ErrorUtils.showError('Failed to add files to solution', error);
        }
    }

    private async renameSolutionFolder(item?: any): Promise<void> {
        // If no item provided (keyboard shortcut), get selected item from tree view
        if (!item) {
            item = await this.getSelectedTreeItem();
            if (!item) {
                vscode.window.showWarningMessage('No solution folder selected');
                return;
            }
        }

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

    private async deleteSolutionFolder(item?: any): Promise<void> {
        // If no item provided (keyboard shortcut), get selected item from tree view
        if (!item) {
            item = await this.getSelectedTreeItem();
            if (!item) {
                vscode.window.showWarningMessage('No solution folder selected');
                return;
            }
        }

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

    private async deleteSolutionItem(item?: any): Promise<void> {
        // If no item provided (keyboard shortcut), get selected item from tree view
        if (!item) {
            item = await this.getSelectedTreeItem();
            if (!item) {
                vscode.window.showWarningMessage('No solution item selected');
                return;
            }
        }

        if (!item || !item.solutionPath) {
            ErrorUtils.showError('No solution item selected');
            return;
        }

        const solutionPath = item.solutionPath;
        const itemName = item.label;
        
        const confirmed = await vscode.window.showWarningMessage(
            `Are you sure you want to remove "${itemName}" from the solution?`,
            { modal: true },
            'Remove'
        );
        
        if (confirmed === 'Remove') {
            try {
                const fs = require('fs');
                const solutionContent = await fs.promises.readFile(solutionPath, 'utf8');
                const lines = solutionContent.split('\n');
                const updatedLines: string[] = [];
                
                // Find and remove the solution item from any ProjectSection(SolutionItems)
                let insideProject = false;
                let insideSolutionItems = false;
                let removedFromSection = false;
                
                for (const line of lines) {
                    if (line.includes('Project(') && line.includes('{2150E333-8FDC-42A3-9474-1A3956D46DE8}')) {
                        insideProject = true;
                        updatedLines.push(line);
                        continue;
                    }
                    
                    if (insideProject && line.trim() === 'EndProject') {
                        insideProject = false;
                        insideSolutionItems = false;
                        updatedLines.push(line);
                        continue;
                    }
                    
                    if (insideProject && line.includes('ProjectSection(SolutionItems)')) {
                        insideSolutionItems = true;
                        updatedLines.push(line);
                        continue;
                    }
                    
                    if (insideSolutionItems && line.trim() === 'EndProjectSection') {
                        insideSolutionItems = false;
                        updatedLines.push(line);
                        continue;
                    }
                    
                    // Skip lines that contain the item we want to remove
                    if (insideSolutionItems && line.includes(itemName)) {
                        removedFromSection = true;
                        continue; // Skip this line
                    }
                    
                    updatedLines.push(line);
                }
                
                if (removedFromSection) {
                    const updatedContent = updatedLines.join('\n');
                    await fs.promises.writeFile(solutionPath, updatedContent, 'utf8');
                    
                    this.solutionProvider.refresh();
                    vscode.window.showInformationMessage(`Removed "${itemName}" from solution`);
                } else {
                    vscode.window.showWarningMessage(`Could not find "${itemName}" in solution file`);
                }
                
            } catch (error) {
                ErrorUtils.showError(`Failed to remove solution item`, error);
            }
        }
    }

    private async getSelectedTreeItem(): Promise<any> {
        if (!this.solutionTreeView) {
            return null;
        }

        // Get the first selected item from the tree view
        const selection = this.solutionTreeView.selection;
        return selection && selection.length > 0 ? selection[0] : null;
    }

}