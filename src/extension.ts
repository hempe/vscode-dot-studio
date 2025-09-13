import * as vscode from 'vscode';
import { SolutionProvider } from './solutionProvider';
import { CommandManager } from './commands/commandManager';

export function activate(context: vscode.ExtensionContext) {
    console.log('.NET Extension is now active!');

    const workspaceRoot = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;

    // Debounced refresh to prevent excessive refreshes
    let refreshTimeout: NodeJS.Timeout | undefined;
    const debouncedRefresh = (reason: string) => {
        if (refreshTimeout) {
            clearTimeout(refreshTimeout);
        }
        refreshTimeout = setTimeout(() => {
            console.log(`File system change detected (${reason}), refreshing solution explorer...`);
            solutionProvider.refresh();
        }, 500); // 500ms delay
    };



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
    const commandManager = new CommandManager(context, solutionProvider, solutionTreeView);
    commandManager.registerAllCommands();

    // Set up file system watchers for solution and project files
    const solutionWatcher = vscode.workspace.createFileSystemWatcher('**/*.sln');
    
    solutionWatcher.onDidChange(() => debouncedRefresh('solution file changed'));
    solutionWatcher.onDidCreate(() => debouncedRefresh('solution file created'));
    solutionWatcher.onDidDelete(() => debouncedRefresh('solution file deleted'));

    // Watch for project file changes (.csproj, .vbproj, .fsproj)
    const projectWatcher = vscode.workspace.createFileSystemWatcher('**/*.{csproj,vbproj,fsproj}');
    
    projectWatcher.onDidChange(() => debouncedRefresh('project file changed'));
    projectWatcher.onDidCreate(() => debouncedRefresh('project file created'));
    projectWatcher.onDidDelete(() => debouncedRefresh('project file deleted'));

    // Watch for ALL files (except some common excludes like build outputs and hidden files)
    const allFilesWatcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);
    
    allFilesWatcher.onDidCreate((uri) => {
        // Skip certain directories and files that shouldn't trigger refreshes
        const path = uri.fsPath.toLowerCase();
        if (path.includes('/bin/') || 
            path.includes('/obj/') || 
            path.includes('/.git/') || 
            path.includes('/.vs/') ||
            path.includes('/node_modules/') ||
            path.includes('/.vscode/') ||
            path.endsWith('.tmp') ||
            path.endsWith('.temp')) {
            return;
        }
        debouncedRefresh('file created: ' + uri.fsPath.split('/').pop());
    });
    
    allFilesWatcher.onDidDelete((uri) => {
        const path = uri.fsPath.toLowerCase();
        if (path.includes('/bin/') || 
            path.includes('/obj/') || 
            path.includes('/.git/') || 
            path.includes('/.vs/') ||
            path.includes('/node_modules/') ||
            path.includes('/.vscode/')) {
            return;
        }
        debouncedRefresh('file deleted: ' + uri.fsPath.split('/').pop());
    });

    // Add all watchers to subscriptions
    context.subscriptions.push(solutionTreeView, solutionWatcher, projectWatcher, allFilesWatcher);

    console.log('.NET Extension activation complete!');
    
    // Export for testing
    return {
        solutionProvider,
        solutionTreeView
    };
}

export function deactivate() {
    console.log('.NET Extension is being deactivated');
}