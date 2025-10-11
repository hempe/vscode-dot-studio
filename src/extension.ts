import * as vscode from 'vscode';
import { FrameworkDropdownService } from './services/frameworkDropdownService';
import { SolutionService } from './services/solutionService';
import { SolutionWebviewProvider } from './webview/providers/SolutionWebviewProvider';
import { NuGetCustomEditorProvider } from './webview/providers/NuGetCustomEditorProvider';
import { isExcluded } from './core/constants';
import { logger as loggerFn } from './core/logger';

const logger = loggerFn('Extensions');
export function activate(context: vscode.ExtensionContext) {
    logger.info('.NET Extension is now active!');

    const workspaceRoot = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;

    // Handle specific file changes for targeted updates
    const handleFileChange = (uri: vscode.Uri, changeType: 'created' | 'changed' | 'deleted') => {
        if (isExcluded(uri.fsPath, workspaceRoot))
            return;

        const filePath = uri.fsPath;
        const fileName = filePath.split('/').pop() || '';
        logger.info(`File ${changeType}: ${fileName}`);

        // Let the solution provider handle the specific file change
        solutionWebviewProvider.handleFileChange(filePath, changeType);
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
        context,
        frameworkDropdownService
    );

    // Create NuGet custom editor provider
    const nugetCustomEditorProvider = new NuGetCustomEditorProvider(
        context.extensionUri,
        context
    );

    // Register webview providers
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SolutionWebviewProvider.viewType,
            solutionWebviewProvider
        )
    );

    // Register custom editor provider
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            NuGetCustomEditorProvider.viewType,
            nugetCustomEditorProvider
        )
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('dotnet.openNuGetManager', (projectPath?: string) => {
            NuGetCustomEditorProvider.openNuGetManager(projectPath);
        }),
        vscode.commands.registerCommand('dotnet.openNuGetManagerForSolution', (solutionPath?: string) => {
            NuGetCustomEditorProvider.openNuGetManagerForSolution(solutionPath);
        }),
        vscode.commands.registerCommand('dotnet.solution.selectFramework', async () => {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const frameworkOptions = await frameworkDropdownService.getFrameworkOptions(workspaceRoot);
            const currentFramework = frameworkDropdownService.getActiveFramework();

            const quickPickItems = frameworkOptions.map(option => ({
                label: option.label,
                description: option.description,
                detail: option.detail,
                picked: option.value === currentFramework || (!currentFramework && option.value === undefined)
            }));

            const selection = await vscode.window.showQuickPick(quickPickItems, {
                placeHolder: 'Select target framework'
            });

            if (selection) {
                const selectedOption = frameworkOptions.find(option => option.label === selection.label);
                await frameworkDropdownService.setActiveFramework(selectedOption?.value);
                vscode.window.showInformationMessage(`Framework changed to: ${selection.label}`);
            }
        }),
        vscode.commands.registerCommand('dotnet.solution.debug', () => {
            vscode.commands.executeCommand('workbench.action.debug.start');
        }),
        vscode.commands.registerCommand('dotnet.internal.refreshSolution', () => {
            // Clear cache to force fresh data rebuild (needed for startup project changes)
            solutionWebviewProvider.clearCache();
            solutionWebviewProvider.refresh();
        })
    );

    // Set up callback to handle active framework changes
    frameworkDropdownService.setFrameworkChangeCallback((framework) => {
        // Store the active framework for debugging - don't filter the tree view
        logger.info(`Active framework changed to: ${framework || 'Auto'}`);
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

    logger.info('.NET Extension activation complete!');

    // Export for testing
    return {
        solutionWebviewProvider,
        solutionService,
        frameworkDropdownService
    };
}

export function deactivate() {
    logger.info('.NET Extension is being deactivated');

    // Dispose the solution service to clean up active solution
    SolutionService.dispose();
}