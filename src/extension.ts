import * as vscode from 'vscode';
// import { SolutionProvider } from './services/solutionProvider'; // Legacy - not used, webview handles tree now
import { FrameworkDropdownService } from './services/frameworkDropdownService';
import { SolutionService } from './services/solutionService';
import { SolutionWebviewProvider } from './webview/providers/SolutionWebviewProvider';
import { isExcluded } from './core/constants';

export function activate(context: vscode.ExtensionContext) {
    console.log('.NET Extension is now active!');

    const workspaceRoot = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;

    // Handle specific file changes for targeted updates
    const handleFileChange = (uri: vscode.Uri, changeType: 'created' | 'changed' | 'deleted') => {
        if (isExcluded(uri.fsPath, workspaceRoot))
            return;

        const filePath = uri.fsPath;
        const fileName = filePath.split('/').pop() || '';
        console.log(`File ${changeType}: ${fileName}`);

        // Let the solution provider handle the specific file change
        solutionWebviewProvider.handleFileChange(filePath, changeType);
    };



    // Set context for when workspace has .NET files
    vscode.commands.executeCommand('setContext', 'workspaceHasDotnetFiles', true);

    // Initialize framework dropdown service
    const frameworkDropdownService = new FrameworkDropdownService();

    // Initialize services
    const solutionService = new SolutionService();
    // const solutionProvider = new SolutionProvider(workspaceRoot); // Legacy - not used anymore

    // Create and register webview providers
    const solutionWebviewProvider = new SolutionWebviewProvider(
        context.extensionUri,
        context,
        solutionService,
        undefined, // solutionProvider not used anymore
        frameworkDropdownService
    );

    // Register webview providers
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SolutionWebviewProvider.viewType,
            solutionWebviewProvider
        )
    );

    // Set up callback to handle active framework changes
    frameworkDropdownService.setFrameworkChangeCallback((framework) => {
        // Store the active framework for debugging - don't filter the tree view
        console.log(`Active framework changed to: ${framework || 'Auto'}`);
        // The framework will be used when F5/debugging is triggered
    });


    // Watch only .NET solution and project files to reduce load
    const solutionWatcher = vscode.workspace.createFileSystemWatcher('**/*.sln');
    const projectWatcher = vscode.workspace.createFileSystemWatcher('**/*.{csproj,vbproj,fsproj}');

    // Set up handlers for both watchers
    solutionWatcher.onDidCreate((uri) => handleFileChange(uri, 'created'));
    solutionWatcher.onDidChange((uri) => handleFileChange(uri, 'changed'));
    solutionWatcher.onDidDelete((uri) => handleFileChange(uri, 'deleted'));

    projectWatcher.onDidCreate((uri) => handleFileChange(uri, 'created'));
    projectWatcher.onDidChange((uri) => handleFileChange(uri, 'changed'));
    projectWatcher.onDidDelete((uri) => handleFileChange(uri, 'deleted'));

    // Add watchers to subscriptions
    context.subscriptions.push(solutionWatcher);
    context.subscriptions.push(projectWatcher);

    console.log('.NET Extension activation complete!');

    // Export for testing
    return {
        // solutionProvider, // Legacy - not used anymore
        solutionWebviewProvider,
        solutionService,
        frameworkDropdownService
    };
}

export function deactivate() {
    console.log('.NET Extension is being deactivated');

    // Dispose the solution service to clean up active solution
    SolutionService.dispose();
}