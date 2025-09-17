import * as vscode from 'vscode';
import { SolutionProvider } from './services/solutionProvider';
import { FrameworkDropdownService } from './services/frameworkDropdownService';
import { SolutionService } from './services/solutionService';
import { SolutionWebviewProvider } from './webview/providers/SolutionWebviewProvider';

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
            solutionWebviewProvider.refresh();
        }, 500); // 500ms delay
    };



    // Set context for when workspace has .NET files
    vscode.commands.executeCommand('setContext', 'workspaceHasDotnetFiles', true);

    // Initialize framework dropdown service
    const frameworkDropdownService = new FrameworkDropdownService();

    // Initialize services
    const solutionService = new SolutionService();

    // Create and register webview providers
    const solutionWebviewProvider = new SolutionWebviewProvider(
        context.extensionUri,
        solutionService,
        frameworkDropdownService
    );

    // Register webview providers
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SolutionWebviewProvider.viewType,
            solutionWebviewProvider
        )
    );

    // Keep the old SolutionProvider for backwards compatibility
    const solutionProvider = new SolutionProvider(workspaceRoot);

    // Set up callback to handle active framework changes
    frameworkDropdownService.setFrameworkChangeCallback((framework) => {
        // Store the active framework for debugging - don't filter the tree view
        console.log(`Active framework changed to: ${framework || 'Auto'}`);
        // The framework will be used when F5/debugging is triggered
    });

    // Note: CommandManager and related commands were removed as part of directory restructure

    // Find and set initial solution for framework dropdown
    const detectSolution = async () => {
        try {
            const solutionFiles = await vscode.workspace.findFiles('*.sln', '**/node_modules/**');
            if (solutionFiles.length > 0) {
                frameworkDropdownService.setSolution(solutionFiles[0].fsPath);
            }
        } catch (error) {
            // Ignore errors
        }
    };
    detectSolution();

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
    context.subscriptions.push(solutionWatcher, projectWatcher, allFilesWatcher);

    console.log('.NET Extension activation complete!');
    
    // Export for testing
    return {
        solutionProvider,
        solutionWebviewProvider,
        solutionService,
        frameworkDropdownService
    };
}

export function deactivate() {
    console.log('.NET Extension is being deactivated');
}