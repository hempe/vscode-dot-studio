import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionProvider } from '../solutionProvider';
import { PathUtils, ValidationUtils, ErrorUtils, InputUtils, FileSystemUtils } from '../utils';

export class FileCommands {
    constructor(
        private context: vscode.ExtensionContext,
        private solutionProvider: SolutionProvider
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

    private copyFile(item: any): void {
        const filePath = PathUtils.getPathFromItem(item, 'copy file');
        if (!filePath) return;

        this.solutionProvider.copyFile(filePath);
        vscode.window.showInformationMessage(`Copied: ${path.basename(filePath)}`);
    }

    private async pasteFile(item: any): Promise<void> {
        const targetPath = PathUtils.getPathFromItem(item, 'paste file');
        if (!targetPath) return;

        const targetDir = PathUtils.ensureDirectory(targetPath);
        const success = await this.solutionProvider.pasteFile(targetDir);
        
        if (success) {
            const copiedFile = this.solutionProvider.getCopiedFile();
            if (copiedFile) {
                vscode.window.showInformationMessage(`Pasted: ${path.basename(copiedFile)}`);
            }
        } else {
            ErrorUtils.showError('No file to paste or paste operation failed');
        }
    }

    private async deleteFile(item: any): Promise<void> {
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

    private async renameFile(item: any): Promise<void> {
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
                await fs.rename(filePath, newPath);
                this.solutionProvider.refresh();
                vscode.window.showInformationMessage(`Renamed "${fileName}" to "${newName}"`);
            } catch (error) {
                ErrorUtils.showError('Failed to rename file', error);
            }
        }
    }

    private cutFile(item: any): void {
        // For now, just copy the file - full cut/move functionality would require more complex state management
        this.copyFile(item);
        vscode.window.showInformationMessage('File copied to clipboard (cut functionality not yet implemented)');
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
}