import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionProvider } from '../solutionProvider';
import { PathUtils, ValidationUtils, ErrorUtils, InputUtils, FileSystemUtils } from '../utils';

export class FileCommands {
    constructor(
        private context: vscode.ExtensionContext,
        private solutionProvider: SolutionProvider,
        private solutionTreeView?: vscode.TreeView<any>
    ) {}

    public registerCommands(): void {
        // openFile is available for context menu usage (double-click handling is in extension.ts)
        this.registerCommand('openFile', this.openFile.bind(this));
        this.registerCommand('revealInExplorer', this.revealInExplorer.bind(this));
        this.registerCommand('openInTerminal', this.openInTerminal.bind(this));
        this.registerCommand('copyFile', this.copyFile.bind(this));
        this.registerCommand('pasteFile', this.pasteFile.bind(this));
        this.registerCommand('deleteFile', this.deleteFile.bind(this));
        this.registerCommand('renameFile', this.renameFile.bind(this));
        this.registerCommand('cutFile', this.cutFile.bind(this));
        this.registerCommand('copyPath', this.copyPath.bind(this));
        this.registerCommand('copyRelativePath', this.copyRelativePath.bind(this));
        this.registerCommand('openToSide', this.openToSide.bind(this));
        this.registerCommand('newFile', this.newFile.bind(this));
        this.registerCommand('newFolder', this.newFolder.bind(this));
        this.registerCommand('findReferences', this.findReferences.bind(this));
        this.registerCommand('debugContext', this.debugContext.bind(this));
        this.registerCommand('smartRename', this.smartRename.bind(this));
        this.registerCommand('smartDelete', this.smartDelete.bind(this));
        this.registerCommand('renameFolder', this.renameFolder.bind(this));
        this.registerCommand('deleteFolder', this.deleteFolder.bind(this));
    }

    private registerCommand(commandName: string, callback: (...args: any[]) => any): void {
        const command = vscode.commands.registerCommand(`dotnet-extension.${commandName}`, callback);
        this.context.subscriptions.push(command);
    }

    private openFile(item: any): void {
        // Handle both cases: direct URI or tree item with resourceUri
        if (item instanceof vscode.Uri) {
            vscode.window.showTextDocument(item);
        } else if (item && item.resourceUri) {
            vscode.window.showTextDocument(item.resourceUri);
        } else {
            ErrorUtils.showError('Cannot open file: no valid URI found');
        }
    }

    private async revealInExplorer(item: any): Promise<void> {
        const filePath = PathUtils.getPathFromItem(item, 'reveal in explorer');
        if (!filePath) return;

        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(filePath));
    }

    private async openInTerminal(item: any): Promise<void> {
        const filePath = PathUtils.getPathFromItem(item, 'open in terminal');
        if (!filePath) return;

        const targetDir = PathUtils.ensureDirectory(filePath);
        const terminal = vscode.window.createTerminal({
            name: 'Terminal',
            cwd: targetDir
        });
        terminal.show();
    }

    private async copyFile(item?: any): Promise<void> {
        // If no item provided (keyboard shortcut), get selected item from tree view
        if (!item) {
            item = await this.getSelectedTreeItem();
            if (!item) {
                vscode.window.showWarningMessage('No item selected in Solution Explorer');
                return;
            }
        }

        const filePath = PathUtils.getPathFromItem(item, 'copy file');
        if (!filePath) return;

        this.solutionProvider.copyFile(filePath);
        vscode.window.showInformationMessage(`Copied: ${path.basename(filePath)}`);
    }

    private async pasteFile(item?: any): Promise<void> {
        // If no item provided (keyboard shortcut), get selected item from tree view
        if (!item) {
            item = await this.getSelectedTreeItem();
            if (!item) {
                vscode.window.showWarningMessage('No item selected in Solution Explorer');
                return;
            }
        }

        const targetPath = PathUtils.getPathFromItem(item, 'paste file');
        if (!targetPath) return;

        const targetDir = PathUtils.ensureDirectory(targetPath);
        const copiedFile = this.solutionProvider.getCopiedFile();
        const wasCutOperation = this.solutionProvider.isCutOperationActive();
        const success = await this.solutionProvider.pasteFile(targetDir);

        if (success) {
            if (copiedFile) {
                const operation = wasCutOperation ? 'Moved' : 'Pasted';
                vscode.window.showInformationMessage(`${operation}: ${path.basename(copiedFile)}`);
            }
        } else {
            ErrorUtils.showError('No file to paste or paste operation failed');
        }
    }

    private async deleteFile(item?: any): Promise<void> {
        // If no item provided (keyboard shortcut), get selected item from tree view
        if (!item) {
            item = await this.getSelectedTreeItem();
            if (!item) {
                vscode.window.showWarningMessage('No item selected in Solution Explorer');
                return;
            }
        }

        const filePath = PathUtils.getPathFromItem(item, 'delete');
        if (!filePath) return;

        const fileName = path.basename(filePath);
        const confirmed = await vscode.window.showWarningMessage(
            `Are you sure you want to delete "${fileName}"?`,
            { modal: true },
            'Delete'
        );
        
        if (confirmed === 'Delete') {
            try {
                const fs = require('fs').promises;
                await fs.unlink(filePath);
                this.solutionProvider.refresh();
                vscode.window.showInformationMessage(`Deleted: ${fileName}`);
            } catch (error) {
                ErrorUtils.showError('Failed to delete file', error);
            }
        }
    }

    private async renameFile(item?: any): Promise<void> {
        // If no item provided (keyboard shortcut), get selected item from tree view
        if (!item) {
            item = await this.getSelectedTreeItem();
            if (!item) {
                vscode.window.showWarningMessage('No item selected in Solution Explorer');
                return;
            }
        }

        const filePath = PathUtils.getPathFromItem(item, 'rename');
        if (!filePath) return;

        const fileName = path.basename(filePath);
        const newName = await InputUtils.showInputBox(
            `Rename "${fileName}"`,
            fileName,
            ValidationUtils.createNameValidator('File')
        );

        if (newName && newName !== fileName) {
            try {
                const fs = require('fs').promises;
                const newPath = path.join(path.dirname(filePath), newName);

                // Rename the physical file
                await fs.rename(filePath, newPath);

                // If this is a solution item, also update the .sln file reference
                if (item.contextValue === 'solutionItem' && item.solutionPath) {
                    await this.updateSolutionFileReference(item.solutionPath, fileName, newName);
                }

                this.solutionProvider.refresh();
                vscode.window.showInformationMessage(`Renamed "${fileName}" to "${newName}"`);
            } catch (error) {
                ErrorUtils.showError('Failed to rename file', error);
            }
        }
    }

    private async renameFolder(item?: any): Promise<void> {
        // If no item provided (keyboard shortcut), get selected item from tree view
        if (!item) {
            item = await this.getSelectedTreeItem();
            if (!item) {
                vscode.window.showWarningMessage('No folder selected in Solution Explorer');
                return;
            }
        }

        const folderPath = PathUtils.getPathFromItem(item, 'rename folder');
        if (!folderPath) return;

        const folderName = path.basename(folderPath);
        const newName = await InputUtils.showInputBox(
            `Rename folder "${folderName}"`,
            folderName,
            ValidationUtils.createNameValidator('Folder')
        );

        if (newName && newName !== folderName) {
            try {
                const fs = require('fs').promises;
                const newPath = path.join(path.dirname(folderPath), newName);

                // Check if target folder already exists
                try {
                    await fs.access(newPath);
                    ErrorUtils.showError(`A folder with the name "${newName}" already exists`);
                    return;
                } catch {
                    // Target doesn't exist, which is what we want
                }

                // Rename the folder
                await fs.rename(folderPath, newPath);

                this.solutionProvider.refresh();
                vscode.window.showInformationMessage(`Renamed folder "${folderName}" to "${newName}"`);
            } catch (error) {
                ErrorUtils.showError('Failed to rename folder', error);
            }
        }
    }

    private async deleteFolder(item?: any): Promise<void> {
        // If no item provided (keyboard shortcut), get selected item from tree view
        if (!item) {
            item = await this.getSelectedTreeItem();
            if (!item) {
                vscode.window.showWarningMessage('No folder selected in Solution Explorer');
                return;
            }
        }

        const folderPath = PathUtils.getPathFromItem(item, 'delete folder');
        if (!folderPath) return;

        const folderName = path.basename(folderPath);
        const confirmed = await vscode.window.showWarningMessage(
            `Are you sure you want to delete the folder "${folderName}" and all its contents?`,
            { modal: true },
            'Delete'
        );

        if (confirmed === 'Delete') {
            try {
                const fs = require('fs').promises;

                // Use recursive delete to remove folder and all contents
                await fs.rm(folderPath, { recursive: true, force: true });

                this.solutionProvider.refresh();
                vscode.window.showInformationMessage(`Deleted folder: ${folderName}`);
            } catch (error) {
                ErrorUtils.showError('Failed to delete folder', error);
            }
        }
    }

    private async cutFile(item?: any): Promise<void> {
        // If no item provided (keyboard shortcut), get selected item from tree view
        if (!item) {
            item = await this.getSelectedTreeItem();
            if (!item) {
                vscode.window.showWarningMessage('No item selected in Solution Explorer');
                return;
            }
        }

        const filePath = PathUtils.getPathFromItem(item, 'cut file');
        if (!filePath) return;

        this.solutionProvider.cutFile(filePath);
        vscode.window.showInformationMessage(`Cut: ${path.basename(filePath)}`);
    }

    private async copyPath(item: any): Promise<void> {
        const filePath = PathUtils.getPathFromItem(item, 'copy path');
        if (!filePath) return;

        await vscode.env.clipboard.writeText(filePath);
        vscode.window.showInformationMessage('Path copied to clipboard');
    }

    private async copyRelativePath(item: any): Promise<void> {
        const filePath = PathUtils.getPathFromItem(item, 'copy relative path');
        if (!filePath) return;

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            await vscode.env.clipboard.writeText(filePath);
        } else {
            const relativePath = path.relative(workspaceRoot, filePath);
            await vscode.env.clipboard.writeText(relativePath);
        }
        vscode.window.showInformationMessage('Relative path copied to clipboard');
    }

    private openToSide(item: any): void {
        if (item instanceof vscode.Uri) {
            vscode.window.showTextDocument(item, { viewColumn: vscode.ViewColumn.Beside });
        } else if (item && item.resourceUri) {
            vscode.window.showTextDocument(item.resourceUri, { viewColumn: vscode.ViewColumn.Beside });
        } else {
            ErrorUtils.showError('Cannot open file to side: no valid URI found');
        }
    }

    private async newFile(item: any): Promise<void> {
        let targetDir: string;
        
        // Handle solution folders - create files in solution root
        if (item && item.itemType === 'solutionFolder' && item.solutionPath) {
            targetDir = path.dirname(item.solutionPath);
        } else {
            const itemPath = PathUtils.getPathFromItem(item, 'create new file');
            if (!itemPath) return;
            targetDir = PathUtils.ensureDirectory(itemPath);
        }

        const fileName = await InputUtils.showInputBox(
            'Enter file name',
            'NewFile.cs',
            ValidationUtils.createNameValidator('File')
        );

        if (!fileName) return;

        try {
            const filePath = path.join(targetDir, fileName);
            const fs = require('fs').promises;
            
            // Check if file already exists
            try {
                await fs.access(filePath);
                ErrorUtils.showError('File already exists');
                return;
            } catch {
                // File doesn't exist, which is what we want
            }

            // Create file with basic content based on extension
            let content = '';
            const ext = path.extname(fileName).toLowerCase();
            
            if (ext === '.cs') {
                const className = path.basename(fileName, ext);
                content = `using System;

namespace ${path.basename(targetDir)}
{
    public class ${className}
    {
        
    }
}
`;
            } else if (ext === '.json') {
                content = '{\n  \n}\n';
            }

            await fs.writeFile(filePath, content, 'utf8');
            
            // If created in a solution folder, add to solution file
            if (item && item.itemType === 'solutionFolder' && item.solutionPath) {
                await this.addFileToSolution(item.solutionPath, filePath, item.id, item.label);
            }
            
            this.solutionProvider.refresh();
            
            // Open the new file
            const fileUri = vscode.Uri.file(filePath);
            await vscode.window.showTextDocument(fileUri);
            
            vscode.window.showInformationMessage(`Created: ${fileName}`);
        } catch (error) {
            ErrorUtils.showError('Failed to create file', error);
        }
    }

    private async newFolder(item: any): Promise<void> {
        const itemPath = PathUtils.getPathFromItem(item, 'create new folder');
        if (!itemPath) return;

        const targetDir = PathUtils.ensureDirectory(itemPath);

        const folderName = await InputUtils.showInputBox(
            'Enter folder name',
            'NewFolder',
            ValidationUtils.createNameValidator('Folder')
        );

        if (!folderName) return;

        try {
            const folderPath = path.join(targetDir, folderName);
            await FileSystemUtils.ensureDirectoryExists(folderPath);
            this.solutionProvider.refresh();
            vscode.window.showInformationMessage(`Created folder: ${folderName}`);
        } catch (error) {
            ErrorUtils.showError('Failed to create folder', error);
        }
    }

    private async findReferences(item: any): Promise<void> {
        const filePath = PathUtils.getPathFromItem(item, 'find references');
        if (!filePath) return;

        // Open the file and trigger find references
        const fileUri = vscode.Uri.file(filePath);
        const doc = await vscode.window.showTextDocument(fileUri);
        
        // Execute find references command
        await vscode.commands.executeCommand('references-view.find');
    }

    private async addFileToSolution(solutionPath: string, filePath: string, parentFolderId?: string, parentFolderName?: string): Promise<void> {
        try {
            const fs = require('fs');
            const solutionContent = await fs.promises.readFile(solutionPath, 'utf8');
            const lines = solutionContent.split('\n');
            
            const solutionDir = path.dirname(solutionPath);
            let relativePath = path.relative(solutionDir, filePath);
            
            // Normalize path separators for .sln file format
            relativePath = relativePath.replace(/\//g, '\\');

            // Generate GUID for solution item
            const itemGuid = '{' + 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            }).toUpperCase() + '}';

            const fileName = path.basename(filePath);
            
            // For solution items, we add them to the parent folder's ProjectSection(SolutionItems)
            // We don't create separate Project entries for individual files
            let needsNewProject = false;
            
            if (!parentFolderId) {
                // Adding to solution root - create "Solution Items" folder
                needsNewProject = true;
            }
            
            if (needsNewProject) {
                // Create "Solution Items" folder with the file
                const itemEntry = `Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Solution Items", "Solution Items", "${itemGuid}"\n\tProjectSection(SolutionItems) = preProject\n\t\t${relativePath} = ${relativePath}\n\tEndProjectSection\nEndProject`;
                
                // Find insertion point (after last Project entry)
                let insertIndex = -1;
                for (let i = lines.length - 1; i >= 0; i--) {
                    if (lines[i].trim() === 'EndProject') {
                        insertIndex = i + 1;
                        break;
                    }
                }
                
                if (insertIndex === -1) {
                    insertIndex = lines.findIndex((line: string) => line.trim() === 'Global');
                    if (insertIndex === -1) {
                        insertIndex = lines.length;
                    }
                }
                
                lines.splice(insertIndex, 0, itemEntry);
            } else if (parentFolderId) {
                // Add to existing solution folder's ProjectSection
                // Find the target solution folder in the file
                let targetFolderIndex = -1;
                let targetFolderEndIndex = -1;
                
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes(parentFolderId)) {
                        targetFolderIndex = i;
                        // Find the corresponding EndProject
                        for (let j = i + 1; j < lines.length; j++) {
                            if (lines[j].trim() === 'EndProject') {
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
                        if (lines[i].includes('ProjectSection(SolutionItems)')) {
                            hasSolutionItems = true;
                            // Find EndProjectSection
                            for (let j = i + 1; j < targetFolderEndIndex; j++) {
                                if (lines[j].trim() === 'EndProjectSection') {
                                    solutionItemsEndIndex = j;
                                    break;
                                }
                            }
                            break;
                        }
                    }
                    
                    if (hasSolutionItems && solutionItemsEndIndex !== -1) {
                        // Add to existing ProjectSection
                        lines.splice(solutionItemsEndIndex, 0, `\t\t${relativePath} = ${relativePath}`);
                    } else {
                        // Add new ProjectSection
                        lines.splice(targetFolderEndIndex, 0, 
                            '\tProjectSection(SolutionItems) = preProject',
                            `\t\t${relativePath} = ${relativePath}`,
                            '\tEndProjectSection'
                        );
                    }
                }
            }


            // Write updated solution file
            const updatedContent = lines.join('\n');
            await fs.promises.writeFile(solutionPath, updatedContent, 'utf8');
            
        } catch (error) {
            console.error('Failed to add file to solution:', error);
            // Don't throw error to avoid breaking file creation
        }
    }

    private async debugContext(item: any): Promise<void> {
        const activeEditor = vscode.window.activeTextEditor;

        // Try to get the selected item from the tree view if not provided as parameter
        let selectedItem = item;
        if (!selectedItem) {
            // The tree view selection needs to be accessed differently
            // We'll need to get it from the solution provider or tree view
            selectedItem = await this.getSelectedTreeItem();
        }

        const debugInfo = {
            'item (parameter)': item ? {
                label: item.label,
                contextValue: item.contextValue,
                itemType: item.itemType,
                resourceUri: item.resourceUri?.fsPath
            } : 'No item provided as parameter',
            'selectedItem': selectedItem ? {
                label: selectedItem.label,
                contextValue: selectedItem.contextValue,
                itemType: selectedItem.itemType,
                resourceUri: selectedItem.resourceUri?.fsPath
            } : 'No selected item found',
            'activeEditor': activeEditor ? {
                document: activeEditor.document.uri.fsPath,
                scheme: activeEditor.document.uri.scheme
            } : 'No active editor',
            'workspaceFolders': vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath) || 'None',
            'extension.packageJSON.contributes.views': 'dotnet-solution view exists',
        };

        const message = `Debug Context Info:\n${JSON.stringify(debugInfo, null, 2)}`;

        vscode.window.showInformationMessage('Context debug info logged to console', 'Show Details').then(selection => {
            if (selection === 'Show Details') {
                vscode.window.showInformationMessage(message);
            }
        });

        console.log('=== Context Debug Info ===');
        console.log(message);
        console.log('=========================');
    }

    private async getSelectedTreeItem(): Promise<any> {
        if (!this.solutionTreeView) {
            return null;
        }

        // Try to get the focused item first (blue border from arrow keys)
        // If that's not available, fall back to selection (mouse clicks)

        // Unfortunately, VS Code's TreeView API doesn't expose the focused item directly
        // So we have to use the selection, which tracks mouse clicks but not arrow key navigation
        const selection = this.solutionTreeView.selection;
        return selection && selection.length > 0 ? selection[0] : null;
    }

    private async smartRename(): Promise<void> {
        const selectedItem = await this.getSelectedTreeItem();
        if (!selectedItem) {
            vscode.window.showWarningMessage('No item selected in Solution Explorer. Click on an item first, then use F2.');
            return;
        }

        // Route to appropriate rename command based on item type
        switch (selectedItem.contextValue || selectedItem.itemType) {
            case 'file':
            case 'solutionItem':
                await this.renameFile(selectedItem);
                break;
            case 'folder':
                await this.renameFolder(selectedItem);
                break;
            case 'project':
                // Projects can be renamed by renaming the .csproj file
                await this.renameFile(selectedItem);
                break;
            case 'solutionFolder':
                // Call the solution folder rename command
                const solutionFolderCommands = this.getSolutionFolderCommands();
                if (solutionFolderCommands) {
                    await solutionFolderCommands.renameSolutionFolder(selectedItem);
                }
                break;
            case 'solution':
                // Call the solution rename command
                const solutionCommands = this.getSolutionCommands();
                if (solutionCommands) {
                    await solutionCommands.renameSolution(selectedItem);
                }
                break;
            default:
                vscode.window.showWarningMessage(`Cannot rename item of type: ${selectedItem.contextValue || selectedItem.itemType || 'unknown'}`);
        }
    }

    private async smartDelete(): Promise<void> {
        const selectedItem = await this.getSelectedTreeItem();
        if (!selectedItem) {
            vscode.window.showWarningMessage('No item selected in Solution Explorer. Click on an item first, then use Delete.');
            return;
        }

        // Route to appropriate delete command based on item type
        switch (selectedItem.contextValue || selectedItem.itemType) {
            case 'file':
                await this.deleteFile(selectedItem);
                break;
            case 'folder':
                await this.deleteFolder(selectedItem);
                break;
            case 'project':
                // For projects, delete means "remove from solution", not physical deletion
                const projectCommands = this.getProjectCommands();
                if (projectCommands) {
                    await projectCommands.removeProjectFromSolution(selectedItem);
                }
                break;
            case 'solutionFolder':
                // Call the solution folder delete command
                const solutionFolderCommands = this.getSolutionFolderCommands();
                if (solutionFolderCommands) {
                    await solutionFolderCommands.deleteSolutionFolder(selectedItem);
                }
                break;
            case 'solutionItem':
                // Call the solution item delete command
                const solutionFolderCommands2 = this.getSolutionFolderCommands();
                if (solutionFolderCommands2) {
                    await solutionFolderCommands2.deleteSolutionItem(selectedItem);
                }
                break;
            default:
                vscode.window.showWarningMessage(`Cannot delete item of type: ${selectedItem.contextValue || selectedItem.itemType || 'unknown'}`);
        }
    }

    private getSolutionFolderCommands(): any {
        // We need access to the solution folder commands instance
        // For now, we'll use vscode.commands.executeCommand to call the commands
        return {
            renameSolutionFolder: async (item: any) => {
                await vscode.commands.executeCommand('dotnet-extension.renameSolutionFolder', item);
            },
            deleteSolutionFolder: async (item: any) => {
                await vscode.commands.executeCommand('dotnet-extension.deleteSolutionFolder', item);
            },
            deleteSolutionItem: async (item: any) => {
                await vscode.commands.executeCommand('dotnet-extension.deleteSolutionItem', item);
            }
        };
    }

    private getSolutionCommands(): any {
        // We need access to the solution commands instance
        return {
            renameSolution: async (item: any) => {
                await vscode.commands.executeCommand('dotnet-extension.renameSolution', item);
            }
        };
    }

    private getProjectCommands(): any {
        // We need access to the project commands instance
        return {
            removeProjectFromSolution: async (item: any) => {
                await vscode.commands.executeCommand('dotnet-extension.removeProject', item);
            }
        };
    }

    private async updateSolutionFileReference(solutionPath: string, oldFileName: string, newFileName: string): Promise<void> {
        try {
            const fs = require('fs');
            const solutionContent = await fs.promises.readFile(solutionPath, 'utf8');

            // Get the directory of the solution file to compute relative paths correctly
            const solutionDir = path.dirname(solutionPath);

            // Find and replace references to the old file name in the solution file
            // Solution items are stored as relative paths in ProjectSection(SolutionItems)
            // We need to be careful to only replace the filename part, not path separators

            let updatedContent = solutionContent;

            // Pattern to match solution item entries like: "path\to\oldfile.txt = path\to\oldfile.txt"
            // We need to replace both sides of the equation
            const patterns = [
                // Windows-style paths (backslashes)
                new RegExp(`(\\s+)([^\\s]*\\\\)?${oldFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*=\\s*)([^\\s]*\\\\)?${oldFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
                // Unix-style paths (forward slashes) - in case they exist
                new RegExp(`(\\s+)([^\\s]*/)?${oldFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*=\\s*)([^\\s]*/)?${oldFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
                // Just the filename without path (in case it's stored that way)
                new RegExp(`(\\s+)${oldFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*=\\s*)${oldFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g')
            ];

            for (const pattern of patterns) {
                updatedContent = updatedContent.replace(pattern, (match: string, prefix: string, oldPath1: string | undefined, equals: string, oldPath2: string | undefined) => {
                    // Preserve the path structure but replace the filename
                    const newPath1 = oldPath1 ? oldPath1 + newFileName : newFileName;
                    const newPath2 = oldPath2 ? oldPath2 + newFileName : newFileName;
                    return prefix + newPath1 + equals + newPath2;
                });
            }

            // Only write if content actually changed
            if (updatedContent !== solutionContent) {
                await fs.promises.writeFile(solutionPath, updatedContent, 'utf8');
                console.log(`Updated solution file: renamed "${oldFileName}" to "${newFileName}"`);
            } else {
                console.log(`No references to "${oldFileName}" found in solution file`);
            }

        } catch (error) {
            console.error('Failed to update solution file reference:', error);
            // Don't throw error to avoid breaking the rename operation
            vscode.window.showWarningMessage(`File renamed but failed to update solution file reference: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }


}