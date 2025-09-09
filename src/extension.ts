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
        showCollapseAll: true
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

    context.subscriptions.push(manageNugetCommand);
    context.subscriptions.push(setStartupCommand);
    context.subscriptions.push(refreshCommand);
    context.subscriptions.push(openFileCommand);
    context.subscriptions.push(removeProjectCommand);
    context.subscriptions.push(addExistingProjectCommand);
    context.subscriptions.push(revealInExplorerCommand);
    context.subscriptions.push(openInTerminalCommand);
    context.subscriptions.push(solutionTreeView);
}

export function deactivate() {}