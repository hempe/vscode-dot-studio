import * as vscode from 'vscode';
import { SolutionProvider } from './solutionProvider';
import { CommandManager } from './commands/commandManager';
import { it } from 'node:test';

export function activate(context: vscode.ExtensionContext) {
    console.log('.NET Extension is now active!');

    const workspaceRoot = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;

    // Double-click detection to allow single-click expand/collapse and double-click file opening
    let lastSelectedItem: any = null;
    let lastItemClickAt = 0;
    const DOUBLE_CLICK_THRESHOLD = 500; // milliseconds

    // Register the item click command
    const itemClickCommand = vscode.commands.registerCommand('dotnet-extension.itemClick', (item: any) => {
        vscode.window.showTextDocument(item.resourceUri);
    });

    context.subscriptions.push(itemClickCommand);

    // Now initialize solution provider and tree view AFTER command registration
    const solutionProvider = new SolutionProvider(workspaceRoot);

    // Create and register tree view
    const solutionTreeView = vscode.window.createTreeView('dotnet-solution', {
        treeDataProvider: solutionProvider,
        showCollapseAll: true
    });


    // Track expansion state
    solutionTreeView.onDidExpandElement((event) => {
        solutionProvider.setExpanded(event.element, true);
    });

    solutionTreeView.onDidCollapseElement((event) => {
        solutionProvider.setExpanded(event.element, false);
    });

    // Set context for when workspace has .NET files
    vscode.commands.executeCommand('setContext', 'workspaceHasDotnetFiles', true);

    // Initialize and register all commands through the command manager
    const commandManager = new CommandManager(context, solutionProvider);
    commandManager.registerAllCommands();

    // Add tree view to subscriptions
    context.subscriptions.push(solutionTreeView);

    console.log('.NET Extension activation complete!');
}

export function deactivate() {
    console.log('.NET Extension is being deactivated');
}