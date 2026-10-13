import * as vscode from 'vscode';
import { FrameworkDropdownService } from './services/frameworkDropdownService';
import { SolutionService } from './services/solutionService';
import { SolutionWebviewProvider } from './webview/providers/SolutionWebviewProvider';
import { DiagnosticsService } from './services/diagnosticsService';
import { DotnetTaskProvider, DOTNET_TASK_TYPE } from './services/dotnetTaskProvider';
import { ErrorListProvider, ERROR_LIST_SEVERITIES, ERROR_LIST_VIEW, ErrorListSeverity } from './services/errorListProvider';
import { registerNativeContextMenuCommands } from './webview/providers/nativeContextMenu';
import { NuGetCustomEditorProvider } from './webview/providers/NuGetCustomEditorProvider';
import { isExcluded } from './core/constants';
import { logger as loggerFn } from './core/logger';
import { checkCSharpExtension } from './services/csharpExtensionCheck';

const logger = loggerFn('Extensions');

async function startDebugWithStartupProject(): Promise<void> {
    try {
        // Just use the standard debug start command - launch.json should be configured
        await vscode.commands.executeCommand('workbench.action.debug.start');
    } catch (error) {
        logger.error('Error starting debug:', error);
        vscode.window.showErrorMessage(`Error starting debug: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export function activate(context: vscode.ExtensionContext) {
    logger.info('.NET Extension is now active!');

    void checkCSharpExtension(context);

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
    vscode.commands.executeCommand('setContext', 'shinobi.workspaceHasDotnetFiles', true);

    // Initialize framework dropdown service
    const frameworkDropdownService = new FrameworkDropdownService();

    // Create and register webview providers
    const diagnosticsService = new DiagnosticsService();
    context.subscriptions.push(
        diagnosticsService,
        vscode.tasks.registerTaskProvider(DOTNET_TASK_TYPE, new DotnetTaskProvider())
    );

    const errorList = new ErrorListProvider(diagnosticsService, context.workspaceState);
    const errorListView = vscode.window.createTreeView(ERROR_LIST_VIEW, { treeDataProvider: errorList, showCollapseAll: true });
    errorList.attach(errorListView);
    const toggleCommand = (severity: ErrorListSeverity, verb: 'show' | 'hide') =>
        vscode.commands.registerCommand(`shinobi.errorList.${verb}${severity[0].toUpperCase()}${severity.slice(1)}`, () => errorList.toggle(severity));
    context.subscriptions.push(
        errorList,
        errorListView,
        ...ERROR_LIST_SEVERITIES.flatMap(severity => [toggleCommand(severity, 'show'), toggleCommand(severity, 'hide')])
    );

    const solutionWebviewProvider = new SolutionWebviewProvider(
        context.extensionUri,
        context,
        frameworkDropdownService,
        diagnosticsService
    );

    // Create NuGet custom editor provider
    const nugetCustomEditorProvider = new NuGetCustomEditorProvider(
        context.extensionUri,
        context
    );

    // Register webview providers for both sidebar and secondary-sidebar locations
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SolutionWebviewProvider.viewType,
            solutionWebviewProvider
        ),
        vscode.window.registerWebviewViewProvider(
            'shinobi-solution-webview-secondary-sidebar',
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
        vscode.commands.registerCommand('shinobi.openNuGetManager', (projectPath?: string) => {
            NuGetCustomEditorProvider.openNuGetManager(projectPath);
        }),
        vscode.commands.registerCommand('shinobi.openNuGetManagerForSolution', (solutionPath?: string) => {
            NuGetCustomEditorProvider.openNuGetManagerForSolution(solutionPath);
        }),
        vscode.commands.registerCommand('shinobi.solution.selectFramework', async () => {
            const frameworkOptions = frameworkDropdownService.getFrameworkOptions();
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
        vscode.commands.registerCommand('shinobi.solution.debug', async () => {
            await startDebugWithStartupProject();
        }),
        vscode.commands.registerCommand('shinobi.internal.refreshSolution', () => {
            // Clear cache to force fresh data rebuild (needed for startup project changes)
            solutionWebviewProvider.refresh();
        }),
        ...registerNativeContextMenuCommands(solutionWebviewProvider)
    );

    // Watch only .NET solution and project files to reduce load
    const solutionWatcher = vscode.workspace.createFileSystemWatcher('**/*.sln*');
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
}

export function deactivate() {
    logger.info('.NET Extension is being deactivated');

    // Dispose the solution service to clean up active solution
    SolutionService.dispose();
}