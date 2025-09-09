import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionProvider } from './solutionProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('.NET Extension is now active!');

    const workspaceRoot = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;

    const solutionProvider = new SolutionProvider(workspaceRoot);
    const solutionTreeView = vscode.window.createTreeView('dotnet-solution', {
        treeDataProvider: solutionProvider,
        showCollapseAll: true,
        canSelectMany: false
    });

    // Track expansion state
    solutionTreeView.onDidExpandElement(event => {
        solutionProvider.setExpanded(event.element, true);
    });

    solutionTreeView.onDidCollapseElement(event => {
        solutionProvider.setExpanded(event.element, false);
    });

    vscode.commands.executeCommand('setContext', 'workspaceHasDotnetFiles', true);

    const manageNugetCommand = vscode.commands.registerCommand('dotnet-extension.manageNugetPackages', (uri: vscode.Uri) => {
        vscode.window.showInformationMessage(`Managing NuGet packages for: ${uri.fsPath}`);
        // TODO: Implement NuGet package management UI
    });

    const setStartupCommand = vscode.commands.registerCommand('dotnet-extension.setAsStartup', (uri: vscode.Uri) => {
        vscode.window.showInformationMessage(`Setting as startup project: ${uri.fsPath}`);
        // TODO: Implement set as startup project functionality
    });

    const refreshCommand = vscode.commands.registerCommand('dotnet-extension.refreshSolution', () => {
        solutionProvider.refresh();
    });

    const openFileCommand = vscode.commands.registerCommand('dotnet-extension.openFile', (item: any) => {
        let uri: vscode.Uri;
        
        // Handle both cases: direct URI or tree item with resourceUri
        if (item instanceof vscode.Uri) {
            uri = item;
        } else if (item && item.resourceUri) {
            uri = item.resourceUri;
        } else {
            vscode.window.showErrorMessage('Cannot open file: no valid URI found');
            return;
        }
        
        vscode.window.showTextDocument(uri);
    });

    const removeProjectCommand = vscode.commands.registerCommand('dotnet-extension.removeProject', async (item: any) => {
        if (!item || !item.resourceUri) {
            vscode.window.showErrorMessage('No project selected');
            return;
        }

        const projectPath = item.resourceUri.fsPath;
        const projectName = path.basename(projectPath, path.extname(projectPath));
        
        // Confirm removal
        const confirmed = await vscode.window.showWarningMessage(
            `Are you sure you want to remove "${projectName}" from the solution?`,
            { modal: true },
            'Remove'
        );
        
        if (confirmed !== 'Remove') {
            return;
        }

        // Use the specific solution path if available
        if (item.solutionPath) {
            const success = await solutionProvider.removeProjectFromSolution(item.solutionPath, projectPath);
            if (success) {
                // Force refresh as backup
                solutionProvider.refresh();
                vscode.window.showInformationMessage(`Removed "${projectName}" from solution`);
            } else {
                vscode.window.showErrorMessage(`Failed to remove "${projectName}" from solution`);
            }
        } else {
            // Fallback: try all solution files (for standalone projects)
            const solutionFiles = await vscode.workspace.findFiles('*.sln', '**/node_modules/**');
            
            for (const solutionFile of solutionFiles) {
                const success = await solutionProvider.removeProjectFromSolution(solutionFile.fsPath, projectPath);
                if (success) {
                    // Force refresh as backup
                    solutionProvider.refresh();
                    vscode.window.showInformationMessage(`Removed "${projectName}" from solution`);
                    return;
                }
            }
            
            vscode.window.showErrorMessage(`Failed to remove "${projectName}" from solution`);
        }
    });

    const addExistingProjectCommand = vscode.commands.registerCommand('dotnet-extension.addExistingProject', async (item: any) => {
        if (!item || !item.resourceUri) {
            vscode.window.showErrorMessage('No solution selected');
            return;
        }

        const solutionPath = item.resourceUri.fsPath;
        const solutionName = path.basename(solutionPath, '.sln');
        
        // Open file picker for .csproj, .vbproj, .fsproj files
        const projectFiles = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: true,
            defaultUri: vscode.Uri.file(path.dirname(solutionPath)),
            filters: {
                'Project Files': ['csproj', 'vbproj', 'fsproj']
            },
            openLabel: 'Add to Solution'
        });

        if (!projectFiles || projectFiles.length === 0) {
            return;
        }

        // Add each selected project
        let addedCount = 0;
        let failedProjects: string[] = [];

        for (const projectFile of projectFiles) {
            const projectPath = projectFile.fsPath;
            const projectName = path.basename(projectPath, path.extname(projectPath));
            
            const success = await solutionProvider.addProjectToSolution(solutionPath, projectPath);
            if (success) {
                addedCount++;
            } else {
                failedProjects.push(projectName);
            }
        }

        // Force refresh as backup
        solutionProvider.refresh();

        // Show results
        if (addedCount > 0 && failedProjects.length === 0) {
            vscode.window.showInformationMessage(
                `Added ${addedCount} project${addedCount > 1 ? 's' : ''} to solution "${solutionName}"`
            );
        } else if (addedCount > 0 && failedProjects.length > 0) {
            vscode.window.showWarningMessage(
                `Added ${addedCount} project${addedCount > 1 ? 's' : ''}. Failed to add: ${failedProjects.join(', ')}`
            );
        } else {
            vscode.window.showErrorMessage(
                `Failed to add project${projectFiles.length > 1 ? 's' : ''} to solution`
            );
        }
    });

    const revealInExplorerCommand = vscode.commands.registerCommand('dotnet-extension.revealInExplorer', async (item: any) => {
        let filePath: string;
        
        // Handle both direct URI and tree item with resourceUri
        if (item instanceof vscode.Uri) {
            filePath = item.fsPath;
        } else if (item && item.resourceUri) {
            filePath = item.resourceUri.fsPath;
        } else {
            vscode.window.showErrorMessage('Cannot reveal file: no valid path found');
            return;
        }

        // Use VS Code's built-in command to reveal file in explorer
        try {
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(filePath));
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to reveal file in explorer: ${error}`);
        }
    });

    const openInTerminalCommand = vscode.commands.registerCommand('dotnet-extension.openInTerminal', async (item: any) => {
        let filePath: string;
        
        // Handle both direct URI and tree item with resourceUri
        if (item instanceof vscode.Uri) {
            filePath = item.fsPath;
        } else if (item && item.resourceUri) {
            filePath = item.resourceUri.fsPath;
        } else {
            vscode.window.showErrorMessage('Cannot open terminal: no valid path found');
            return;
        }

        // Get the directory containing the file
        const dirPath = path.dirname(filePath);
        
        try {
            // Create a new terminal in the file's directory
            const terminal = vscode.window.createTerminal({
                name: `Terminal - ${path.basename(dirPath)}`,
                cwd: dirPath
            });
            terminal.show();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open terminal: ${error}`);
        }
    });

    const copyFileCommand = vscode.commands.registerCommand('dotnet-extension.copyFile', async (item: any) => {
        // If no item passed (keyboard shortcut), get the selected item from tree
        if (!item) {
            const selection = solutionTreeView.selection;
            if (selection && selection.length > 0) {
                item = selection[0];
            }
        }
        
        let filePath: string;
        
        // Handle both direct URI and tree item with resourceUri
        if (item instanceof vscode.Uri) {
            filePath = item.fsPath;
        } else if (item && item.resourceUri) {
            filePath = item.resourceUri.fsPath;
        } else {
            vscode.window.showErrorMessage('Cannot copy file: no valid path found');
            return;
        }

        // Store the file path for pasting
        solutionProvider.copyFile(filePath);
        
        const fileName = path.basename(filePath);
        vscode.window.showInformationMessage(`Copied "${fileName}"`);
    });

    const pasteFileCommand = vscode.commands.registerCommand('dotnet-extension.pasteFile', async (item: any) => {
        const copiedFile = solutionProvider.getCopiedFile();
        if (!copiedFile) {
            vscode.window.showWarningMessage('No file copied. Use Ctrl+C to copy a file first.');
            return;
        }

        // If no item passed (keyboard shortcut), get the selected item from tree
        if (!item) {
            const selection = solutionTreeView.selection;
            if (selection && selection.length > 0) {
                item = selection[0];
            }
        }

        let targetDir: string;
        
        // Handle both direct URI and tree item with resourceUri
        if (item instanceof vscode.Uri) {
            targetDir = item.fsPath;
        } else if (item && item.resourceUri) {
            targetDir = item.resourceUri.fsPath;
        } else {
            vscode.window.showErrorMessage('Cannot paste file: no valid target found');
            return;
        }

        // If target is a file, get its directory
        const fs = require('fs');
        if (fs.existsSync(targetDir) && fs.statSync(targetDir).isFile()) {
            targetDir = path.dirname(targetDir);
        }

        const success = await solutionProvider.pasteFile(targetDir);
        
        if (success) {
            const fileName = path.basename(copiedFile);
            vscode.window.showInformationMessage(`Pasted "${fileName}"`);
        } else {
            vscode.window.showErrorMessage('Failed to paste file');
        }
    });

    const deleteFileCommand = vscode.commands.registerCommand('dotnet-extension.deleteFile', async (item: any) => {
        // If no item passed (keyboard shortcut), get the selected item from tree
        if (!item) {
            const selection = solutionTreeView.selection;
            if (selection && selection.length > 0) {
                item = selection[0];
            }
        }
        
        let filePath: string;
        
        if (item instanceof vscode.Uri) {
            filePath = item.fsPath;
        } else if (item && item.resourceUri) {
            filePath = item.resourceUri.fsPath;
        } else {
            vscode.window.showErrorMessage('Cannot delete file: no valid path found');
            return;
        }

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
                solutionProvider.refresh();
                vscode.window.showInformationMessage(`Deleted "${fileName}"`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to delete file: ${error}`);
            }
        }
    });

    const renameFileCommand = vscode.commands.registerCommand('dotnet-extension.renameFile', async (item: any) => {
        console.log('Rename command triggered', item);
        
        // If no item passed (keyboard shortcut), get the selected item from tree
        if (!item) {
            const selection = solutionTreeView.selection;
            console.log('No item passed, getting from selection:', selection);
            if (selection && selection.length > 0) {
                item = selection[0];
            }
        }
        
        let filePath: string;
        
        if (item instanceof vscode.Uri) {
            filePath = item.fsPath;
        } else if (item && item.resourceUri) {
            filePath = item.resourceUri.fsPath;
        } else {
            vscode.window.showErrorMessage('Cannot rename file: no valid path found');
            return;
        }

        const fileName = path.basename(filePath);
        const newName = await vscode.window.showInputBox({
            prompt: `Rename "${fileName}"`,
            value: fileName,
            valueSelection: [0, path.basename(fileName, path.extname(fileName)).length], // Select name without extension
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return 'File name cannot be empty';
                }
                if (value.includes('/') || value.includes('\\')) {
                    return 'File name cannot contain path separators';
                }
                return null;
            }
        });

        if (newName && newName !== fileName) {
            try {
                const fs = require('fs').promises;
                const newPath = path.join(path.dirname(filePath), newName);
                await fs.rename(filePath, newPath);
                solutionProvider.refresh();
                vscode.window.showInformationMessage(`Renamed "${fileName}" to "${newName}"`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to rename file: ${error}`);
            }
        }
    });

    const cutFileCommand = vscode.commands.registerCommand('dotnet-extension.cutFile', async (item: any) => {
        let filePath: string;
        
        if (item instanceof vscode.Uri) {
            filePath = item.fsPath;
        } else if (item && item.resourceUri) {
            filePath = item.resourceUri.fsPath;
        } else {
            vscode.window.showErrorMessage('Cannot cut file: no valid path found');
            return;
        }

        // Store the file path for cutting (different from copying)
        solutionProvider.copyFile(filePath);
        (solutionProvider as any).isCut = true;
        
        const fileName = path.basename(filePath);
        vscode.window.showInformationMessage(`Cut "${fileName}"`);
    });

    const copyPathCommand = vscode.commands.registerCommand('dotnet-extension.copyPath', async (item: any) => {
        let filePath: string;
        
        if (item instanceof vscode.Uri) {
            filePath = item.fsPath;
        } else if (item && item.resourceUri) {
            filePath = item.resourceUri.fsPath;
        } else {
            vscode.window.showErrorMessage('Cannot copy path: no valid path found');
            return;
        }

        await vscode.env.clipboard.writeText(filePath);
        vscode.window.showInformationMessage('Path copied to clipboard');
    });

    const copyRelativePathCommand = vscode.commands.registerCommand('dotnet-extension.copyRelativePath', async (item: any) => {
        let filePath: string;
        
        if (item instanceof vscode.Uri) {
            filePath = item.fsPath;
        } else if (item && item.resourceUri) {
            filePath = item.resourceUri.fsPath;
        } else {
            vscode.window.showErrorMessage('Cannot copy relative path: no valid path found');
            return;
        }

        if (workspaceRoot) {
            const relativePath = path.relative(workspaceRoot, filePath);
            await vscode.env.clipboard.writeText(relativePath);
            vscode.window.showInformationMessage('Relative path copied to clipboard');
        } else {
            await vscode.env.clipboard.writeText(filePath);
            vscode.window.showInformationMessage('Path copied to clipboard');
        }
    });

    const openToSideCommand = vscode.commands.registerCommand('dotnet-extension.openToSide', async (item: any) => {
        let uri: vscode.Uri;
        
        if (item instanceof vscode.Uri) {
            uri = item;
        } else if (item && item.resourceUri) {
            uri = item.resourceUri;
        } else {
            vscode.window.showErrorMessage('Cannot open file: no valid URI found');
            return;
        }
        
        await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside });
    });

    const newFileCommand = vscode.commands.registerCommand('dotnet-extension.newFile', async (item: any) => {
        let targetDir: string;
        
        if (item instanceof vscode.Uri) {
            targetDir = item.fsPath;
        } else if (item && item.resourceUri) {
            targetDir = item.resourceUri.fsPath;
        } else {
            vscode.window.showErrorMessage('Cannot create file: no valid target found');
            return;
        }

        // If target is a file, get its directory
        const fs = require('fs');
        if (fs.existsSync(targetDir) && fs.statSync(targetDir).isFile()) {
            targetDir = path.dirname(targetDir);
        }

        const fileName = await vscode.window.showInputBox({
            prompt: 'Enter file name',
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return 'File name cannot be empty';
                }
                if (value.includes('/') || value.includes('\\')) {
                    return 'File name cannot contain path separators';
                }
                return null;
            }
        });

        if (fileName) {
            try {
                const newFilePath = path.join(targetDir, fileName);
                await fs.promises.writeFile(newFilePath, '', 'utf8');
                solutionProvider.refresh();
                
                // Open the new file
                const newFileUri = vscode.Uri.file(newFilePath);
                await vscode.window.showTextDocument(newFileUri);
                
                vscode.window.showInformationMessage(`Created "${fileName}"`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to create file: ${error}`);
            }
        }
    });

    const newFolderCommand = vscode.commands.registerCommand('dotnet-extension.newFolder', async (item: any) => {
        let targetDir: string;
        
        if (item instanceof vscode.Uri) {
            targetDir = item.fsPath;
        } else if (item && item.resourceUri) {
            targetDir = item.resourceUri.fsPath;
        } else {
            vscode.window.showErrorMessage('Cannot create folder: no valid target found');
            return;
        }

        // If target is a file, get its directory
        const fs = require('fs');
        if (fs.existsSync(targetDir) && fs.statSync(targetDir).isFile()) {
            targetDir = path.dirname(targetDir);
        }

        const folderName = await vscode.window.showInputBox({
            prompt: 'Enter folder name',
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return 'Folder name cannot be empty';
                }
                if (value.includes('/') || value.includes('\\')) {
                    return 'Folder name cannot contain path separators';
                }
                return null;
            }
        });

        if (folderName) {
            try {
                const newFolderPath = path.join(targetDir, folderName);
                await fs.promises.mkdir(newFolderPath, { recursive: true });
                solutionProvider.refresh();
                vscode.window.showInformationMessage(`Created folder "${folderName}"`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to create folder: ${error}`);
            }
        }
    });

    const findReferencesCommand = vscode.commands.registerCommand('dotnet-extension.findReferences', async (item: any) => {
        let uri: vscode.Uri;
        
        if (item instanceof vscode.Uri) {
            uri = item;
        } else if (item && item.resourceUri) {
            uri = item.resourceUri;
        } else {
            vscode.window.showErrorMessage('Cannot find references: no valid file found');
            return;
        }

        try {
            // Open the file first to ensure it's loaded
            const document = await vscode.workspace.openTextDocument(uri);
            
            // Use VS Code's built-in Find All References command
            await vscode.commands.executeCommand('references-view.find', uri, new vscode.Position(0, 0));
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to find references: ${error}`);
        }
    });

    context.subscriptions.push(manageNugetCommand);
    context.subscriptions.push(setStartupCommand);
    context.subscriptions.push(refreshCommand);
    context.subscriptions.push(openFileCommand);
    context.subscriptions.push(removeProjectCommand);
    context.subscriptions.push(addExistingProjectCommand);
    context.subscriptions.push(revealInExplorerCommand);
    context.subscriptions.push(openInTerminalCommand);
    context.subscriptions.push(copyFileCommand);
    context.subscriptions.push(pasteFileCommand);
    context.subscriptions.push(deleteFileCommand);
    context.subscriptions.push(renameFileCommand);
    context.subscriptions.push(cutFileCommand);
    context.subscriptions.push(copyPathCommand);
    context.subscriptions.push(copyRelativePathCommand);
    context.subscriptions.push(openToSideCommand);
    context.subscriptions.push(newFileCommand);
    context.subscriptions.push(newFolderCommand);
    context.subscriptions.push(findReferencesCommand);
    context.subscriptions.push(solutionTreeView);
}

export function deactivate() {}