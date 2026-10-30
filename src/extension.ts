import * as vscode from 'vscode';
import * as path from 'path';
import { FrameworkDropdownService } from './services/debug/frameworkDropdownService';
import { SolutionService } from './services/solution/solutionService';
import { SolutionWebviewProvider } from './webview/providers/SolutionWebviewProvider';
import { DiagnosticsService } from './services/diagnostics/diagnosticsService';
import { IconThemeService } from './services/shared/iconThemeService';
import { DotnetTaskProvider, DOTNET_TASK_TYPE } from './services/build/dotnetTaskProvider';
import type { DiagnosticScope } from './services/diagnostics/diagnosticsRollup';
import { ErrorListViewProvider, ERROR_LIST_VIEW } from './webview/providers/ErrorListViewProvider';
import { registerNativeContextMenuCommands } from './webview/providers/nativeContextMenu';
import { NuGetCustomEditorProvider } from './webview/providers/NuGetCustomEditorProvider';
import { CentralPackageWatchers } from './services/nuget/centralPackageWatchers';
import { OwnWrites } from './services/shared/ownWrites';
import { isExcluded } from './core/constants';
import { logger as loggerFn, setLogSink } from './core/logger';
import { checkCSharpExtension } from './services/shared/csharpExtensionCheck';
import { BuildConfiguration } from './services/build/buildConfiguration';
import { SlnxMigration } from './services/solution/slnxMigration';
import { LegacyConfigOffer, offerLegacyConfigMove } from './services/nuget/legacyConfigOffer';
import { SolutionDiscovery } from './services/solution/solutionDiscovery';
import { reportPacked } from './services/build/pack';
import { UnloadedProjects } from './services/solution/unloadedProjects';
import { ShowAllFiles } from './services/solution/showAllFiles';
import { DebugConfigService } from './services/debug/debugConfigService';
import { initializeTemplates } from './services/templates/templateService';
import { openNewSolutionWizard, TemplateWizardPanel } from './webview/providers/TemplateWizardPanel';
import { PublishPanel } from './webview/providers/PublishPanel';
import { ConfigurationManagerPanel } from './webview/providers/ConfigurationManagerPanel';
import { StartupProjectsPanel } from './webview/providers/StartupProjectsPanel';
import { runCodeCleanupOnActiveFile } from './services/code/codeCleanup/activeFileCleanup';
import { TestExplorer } from './services/testing/testExplorer';
import { setFeedSources } from './services/nuget/feedAuth';
import { PackageBrowseService } from './services/nuget/packageBrowseService';
import { NuGetV3Service } from './services/nuget/nugetV3Service';
import { workspaceHasDotnetFiles } from './services/solution/dotnetWorkspace';
import { initializeMonoVsTest } from './services/testing/monoVsTest';
import { workspaceFolderOf } from './services/solution/workspaceFolders';
import { attachToProcess } from './services/debug/attach/attachToProcess';
import { startWithHotReload } from './services/debug/hotReload/startWithHotReload';
import { initDevCertCheck, trustDevCertificate } from './services/debug/devCert/devCertCheck';
import { StartupChoice } from './services/debug/startupProfiles/startupChoice';
import { refreshStartup, selectStartupProfile, startupProfilesChanged } from './services/debug/startupProfiles/startProfile';

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
    // All logs go to Output > "Shinobi .NET Studio"; "Developer: Set Log Level" picks how much
    const logChannel = vscode.window.createOutputChannel('Shinobi .NET Studio', { log: true });
    setLogSink(logChannel);
    context.subscriptions.push(
        logChannel,
        { dispose: () => setLogSink(undefined) },
        vscode.commands.registerCommand('shinobi.showLog', () => logChannel.show())
    );
    logger.info('.NET Extension is now active!');

    void checkCSharpExtension(context);
    initDevCertCheck(context);

    // The workspace folder a file belongs to (multi-root workspaces)
    const rootOf = (filePath: string) => workspaceFolderOf(filePath)?.uri.fsPath;

    // Handle specific file changes for targeted updates
    const handleFileChange = (uri: vscode.Uri, changeType: 'created' | 'changed' | 'deleted') => {
        if (isExcluded(uri.fsPath, rootOf(uri.fsPath)))
            return;

        const filePath = uri.fsPath;
        const fileName = filePath.split('/').pop() || '';
        logger.info(`File ${changeType}: ${fileName}`);

        // The **/*.sln* watcher also sees the startup profiles (.slnLaunch, .slnLaunch.user)
        void startupProfilesChanged(filePath).then(changed => changed && solutionWebviewProvider.refresh());

        // A solution or project file that appears turns the .NET features on (a solution created into an open folder)
        if (changeType === 'created') {
            void updateDotnetContext();
        }

        // Let the solution provider handle the specific file change
        solutionWebviewProvider.handleFileChange(filePath, changeType);
    };

    // Context for when the workspace has .NET files: this extension also activates for its commands in other workspaces
    // (Create New Project... in a Node folder), where F5 and Ctrl+F5 have to stay VS Code's own
    const updateDotnetContext = async () => {
        const has = await workspaceHasDotnetFiles((vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath));
        await vscode.commands.executeCommand('setContext', 'shinobi.workspaceHasDotnetFiles', has);
    };
    void updateDotnetContext();

    BuildConfiguration.initialize(context.workspaceState);
    StartupChoice.initialize(context.workspaceState);
    SlnxMigration.initialize(context.workspaceState);
    LegacyConfigOffer.initialize(context.workspaceState);
    SolutionDiscovery.initialize(context.workspaceState);
    UnloadedProjects.initialize(context.workspaceState);
    ShowAllFiles.initialize(context.workspaceState);
    initializeTemplates(context.globalState);
    NuGetV3Service.initializeCache(context.globalStorageUri.fsPath);
    initializeMonoVsTest(context.globalStorageUri.fsPath);
    TemplateWizardPanel.extensionUri = context.extensionUri;
    PublishPanel.extensionUri = context.extensionUri;
    PublishPanel.state = context.workspaceState;
    ConfigurationManagerPanel.extensionUri = context.extensionUri;
    StartupProjectsPanel.extensionUri = context.extensionUri;
    // The expired-token message needs the configured sources to know which feed a request went to
    setFeedSources(() => PackageBrowseService.getPackageSources());
    const testExplorer = new TestExplorer();
    context.subscriptions.push(
        testExplorer,
        // The Solution Explorer calls this once the solution is loaded: tests of built projects show right away
        vscode.commands.registerCommand('shinobi.internal.refreshTests', () => testExplorer.refresh(false)),
        // "Run Tests" / "Debug Tests" in the Solution Explorer context menu
        vscode.commands.registerCommand('shinobi.internal.runTests', (fsPath: string, debug: boolean) => testExplorer.runTestsAt(fsPath, debug))
    );

    // Initialize framework dropdown service
    const frameworkDropdownService = new FrameworkDropdownService();

    // Create and register webview providers
    const diagnosticsService = new DiagnosticsService();
    context.subscriptions.push(
        diagnosticsService,
        vscode.tasks.registerTaskProvider(DOTNET_TASK_TYPE, new DotnetTaskProvider())
    );

    const errorList = new ErrorListViewProvider(context.extensionUri, diagnosticsService);
    context.subscriptions.push(
        errorList,
        vscode.window.registerWebviewViewProvider(ERROR_LIST_VIEW, errorList, { webviewOptions: { retainContextWhenHidden: true } })
    );

    const iconThemeService = new IconThemeService();
    context.subscriptions.push(iconThemeService);

    const solutionWebviewProvider = new SolutionWebviewProvider(
        context.extensionUri,
        context,
        frameworkDropdownService,
        diagnosticsService,
        iconThemeService
    );

    // Props files change what projects contain and their package versions: every project is evaluated again
    const reevaluateAllProjects = async () => {
        const solution = SolutionService.getActiveSolution();
        await Promise.all([...(solution?.projects.values() ?? [])].map(project => project.reevaluateItems()));
    };
    // Files Directory.Packages.props imports (and props outside the workspace, re-checked when the NuGet editor gets focus)
    const centralPackageWatchers = new CentralPackageWatchers(reevaluateAllProjects);
    context.subscriptions.push(centralPackageWatchers);

    // Create NuGet custom editor provider
    const nugetCustomEditorProvider = new NuGetCustomEditorProvider(
        context.extensionUri,
        context,
        () => centralPackageWatchers.recheck()
    );
    context.subscriptions.push(nugetCustomEditorProvider);

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
            void NuGetCustomEditorProvider.openNuGetManager(projectPath);
        }),
        vscode.commands.registerCommand('shinobi.openNuGetManagerForSolution', (solutionPath?: string) => {
            void NuGetCustomEditorProvider.openNuGetManagerForSolution(solutionPath);
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
            }
        }),
        vscode.commands.registerCommand('shinobi.solution.configuration.debug', () => BuildConfiguration.set('Debug')),
        vscode.commands.registerCommand('shinobi.solution.configuration.release', () => BuildConfiguration.set('Release')),
        // The checked entries of the configuration menu; choosing the active configuration again does nothing
        vscode.commands.registerCommand('shinobi.solution.configuration.debug.active', () => { }),
        vscode.commands.registerCommand('shinobi.solution.configuration.release.active', () => { }),
        vscode.commands.registerCommand('shinobi.solution.selectConfiguration', async () => {
            const active = BuildConfiguration.active;
            const picked = await vscode.window.showQuickPick(
                BuildConfiguration.available.map(name => ({ label: name, description: name === active ? '(current)' : undefined })),
                { placeHolder: 'Solution configuration' }
            );
            if (picked) {
                await BuildConfiguration.set(picked.label);
            }
        }),
        vscode.commands.registerCommand('shinobi.solution.selectPlatform', async () => {
            const active = BuildConfiguration.activePlatform;
            const picked = await vscode.window.showQuickPick(
                BuildConfiguration.availablePlatforms.map(name => ({ label: name, description: name === active ? '(current)' : undefined })),
                { placeHolder: 'Solution platform' }
            );
            if (picked) {
                await BuildConfiguration.setPlatform(picked.label);
            }
        }),
        // The toolbar's configuration button: one menu for what the title bar's configuration menu offers
        vscode.commands.registerCommand('shinobi.solution.configurationMenu', async () => {
            const active = BuildConfiguration.active;
            const items: Array<vscode.QuickPickItem & { run?: string }> = [
                { label: 'Solution configuration', kind: vscode.QuickPickItemKind.Separator },
                ...BuildConfiguration.available.map(name => ({ label: name, description: name === active ? '(current)' : undefined, run: `configuration:${name}` })),
            ];
            if (BuildConfiguration.availablePlatforms.length > 1) {
                items.push({ label: 'Platform', kind: vscode.QuickPickItemKind.Separator },
                    ...BuildConfiguration.availablePlatforms.map(name => ({ label: name, description: name === BuildConfiguration.activePlatform ? '(current)' : undefined, run: `platform:${name}` })));
            }
            items.push({ label: '', kind: vscode.QuickPickItemKind.Separator },
                { label: '$(symbol-event) Startup Profile...', run: 'command:shinobi.solution.selectStartupProfile' },
                { label: '$(settings-gear) Configuration Manager...', run: 'command:shinobi.configurationManager.open' });
            const picked = await vscode.window.showQuickPick(items, { placeHolder: `Solution configuration: ${active}` });
            const [kind, ...rest] = (picked?.run ?? '').split(':');
            const value = rest.join(':');
            if (kind === 'configuration') {
                await BuildConfiguration.set(value);
            } else if (kind === 'platform') {
                await BuildConfiguration.setPlatform(value);
            } else if (kind === 'command') {
                await vscode.commands.executeCommand(value);
            }
        }),
        BuildConfiguration.onDidChange(async () => {
            await refreshStartup();
            solutionWebviewProvider.refresh();
        }),
        vscode.commands.registerCommand('shinobi.debug.attachToProcess', () => attachToProcess()),
        vscode.commands.registerCommand('shinobi.debug.startWithHotReload', () => startWithHotReload()),
        vscode.commands.registerCommand('shinobi.debug.trustDevCertificate', () => trustDevCertificate()),
        vscode.commands.registerCommand('shinobi.solution.selectStartupProfile', () => selectStartupProfile()),
        StartupChoice.onDidChange(async () => {
            await refreshStartup();
            solutionWebviewProvider.refresh();
        }),
        vscode.commands.registerCommand('shinobi.solution.debug', async () => {
            await startDebugWithStartupProject();
        }),
        vscode.commands.registerCommand('shinobi.solution.startWithoutDebugging', () => DebugConfigService.startStartupProject(true)),
        vscode.commands.registerCommand('shinobi.solution.syncWithActiveDocument', () => solutionWebviewProvider.syncWithActiveDocument()),
        vscode.commands.registerCommand('shinobi.solution.collapseAll', () => solutionWebviewProvider.collapseAll()),
        vscode.commands.registerCommand('shinobi.solution.showAllFiles', () => solutionWebviewProvider.toggleShowAllFiles()),
        // Visual Studio's View > Solution Explorer (Ctrl+Alt+L) and View > Error List
        vscode.commands.registerCommand('shinobi.solution.focusSolutionExplorer', () => vscode.commands.executeCommand(
            vscode.workspace.getConfiguration('shinobi.solutionExplorer').get('location') === 'secondary-sidebar'
                ? 'shinobi-solution-webview-secondary-sidebar.focus'
                : `${SolutionWebviewProvider.viewType}.focus`)),
        // Visual Studio's File > Open > Solution: another solution of the workspace, or any solution file
        vscode.commands.registerCommand('shinobi.solution.open', async () => {
            const folders = vscode.workspace.workspaceFolders ?? [];
            const found = (await Promise.all(folders.map(folder => SolutionDiscovery.findSolutionFiles(folder.uri.fsPath, 6)))).flat();
            const active = SolutionService.getActiveSolution()?.solutionPath;
            const browse = { label: '$(folder-opened) Browse...', description: 'Any .sln or .slnx file', solutionPath: undefined as string | undefined };
            const picked = await vscode.window.showQuickPick([
                ...found.map(solutionPath => ({
                    label: path.basename(solutionPath),
                    description: path.relative(path.dirname(rootOf(solutionPath) ?? ''), path.dirname(solutionPath)) || undefined,
                    detail: solutionPath === active ? 'Open now' : undefined,
                    solutionPath: solutionPath as string | undefined,
                })),
                browse,
            ], { title: 'Open Solution', placeHolder: 'Pick a solution' });
            let solutionPath = picked?.solutionPath;
            if (picked === browse) {
                const [file] = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    filters: { Solutions: ['sln', 'slnx'] },
                    openLabel: 'Open Solution',
                }) ?? [];
                solutionPath = file?.fsPath;
            }
            if (solutionPath) {
                await SolutionService.openSolution(solutionPath);
                await vscode.commands.executeCommand('shinobi.internal.refreshSolution');
            }
        }),
        vscode.commands.registerCommand('shinobi.configurationManager.open', () => ConfigurationManagerPanel.show()),
        vscode.commands.registerCommand('shinobi.startupProjects.open', () => StartupProjectsPanel.show()),
        vscode.commands.registerCommand('shinobi.codeCleanup.file', () => runCodeCleanupOnActiveFile()),
        vscode.commands.registerCommand('shinobi.solution.new', () => openNewSolutionWizard()),
        vscode.commands.registerCommand('shinobi.internal.errorList.showScope', (name: string, scope: DiagnosticScope) => errorList.showScope(name, scope)),
        vscode.commands.registerCommand('shinobi.errorList.show', () => vscode.commands.executeCommand(`${ERROR_LIST_VIEW}.focus`)),
        vscode.commands.registerCommand('shinobi.internal.refreshSolution', () => {
            // Clear cache to force fresh data rebuild (needed for startup project changes)
            solutionWebviewProvider.refresh();
        }),
        ...registerNativeContextMenuCommands(solutionWebviewProvider),
        // Another file nesting mode regroups the files of every project
        vscode.workspace.onDidChangeConfiguration(async event => {
            if (event.affectsConfiguration('shinobi.solutionExplorer.fileNesting')) {
                await SolutionService.getActiveSolution()?.forceRefreshAllProjects();
                solutionWebviewProvider.refresh();
            }
        }),
        // Builds write new source generator output (Dependencies > Analyzers), restores a new package graph
        vscode.tasks.onDidEndTaskProcess(event => {
            const task = event.execution.task;
            if ((task.definition.type === DOTNET_TASK_TYPE && ['build', 'rebuild', 'restore'].includes(task.definition.action))
                || task.name === 'StartupPreBuild') {
                solutionWebviewProvider.refresh();
            }
            // A failed restore or build with a .nuget/NuGet.Config next to the solution: dotnet does not read it
            const solutionPath = SolutionService.getActiveSolution()?.solutionPath;
            if (solutionPath && event.exitCode !== undefined && event.exitCode !== 0
                && ((task.definition.type === DOTNET_TASK_TYPE && ['build', 'rebuild', 'restore'].includes(task.definition.action)) || task.name === 'StartupPreBuild')) {
                void offerLegacyConfigMove(solutionPath, 'restoreFailed');
            }
            if (task.definition.type === DOTNET_TASK_TYPE && task.definition.action === 'pack' && event.exitCode === 0) {
                void reportPacked(task.definition.target);
            }
        })
    );

    // Unloaded projects are left out of the build and of the startup profile's launches
    context.subscriptions.push(UnloadedProjects.onDidChange(() => {
        void refreshStartup();
        solutionWebviewProvider.refresh();
    }));

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


    // Launch profiles: the startup configuration follows its launchSettings.json, and the tree shows
    // "Set Launch Profile..." only while the startup project has several profiles
    const launchSettingsWatcher = vscode.workspace.createFileSystemWatcher('**/Properties/launchSettings.json');
    const handleLaunchSettingsChange = async (uri: vscode.Uri) => {
        if (isExcluded(uri.fsPath, rootOf(uri.fsPath))) {
            return;
        }
        const startupProject = DebugConfigService.getStartupProject();
        if ((startupProject && path.dirname(path.dirname(uri.fsPath)) === path.dirname(startupProject))
            || DebugConfigService.hasStartupProfileConfiguration()) {
            await refreshStartup();
        }
        solutionWebviewProvider.refresh();
    };
    launchSettingsWatcher.onDidCreate(handleLaunchSettingsChange);
    launchSettingsWatcher.onDidChange(handleLaunchSettingsChange);
    launchSettingsWatcher.onDidDelete(handleLaunchSettingsChange);

    // Directory.Build.props/targets change what every project below contains, Directory.Packages.props its package versions
    const buildPropsWatcher = vscode.workspace.createFileSystemWatcher('**/Directory.{Build.props,Build.targets,Packages.props}');
    const handleBuildPropsChange = async (uri: vscode.Uri) => {
        // A version the NuGet manager wrote: it evaluates the projects itself, after the restore
        if (isExcluded(uri.fsPath, rootOf(uri.fsPath)) || OwnWrites.isOwn(uri.fsPath)) {
            return;
        }
        await reevaluateAllProjects();
    };
    buildPropsWatcher.onDidCreate(handleBuildPropsChange);
    buildPropsWatcher.onDidChange(handleBuildPropsChange);
    buildPropsWatcher.onDidDelete(handleBuildPropsChange);

    // Add watchers to subscriptions
    context.subscriptions.push(solutionWatcher);
    context.subscriptions.push(projectWatcher);
    context.subscriptions.push(launchSettingsWatcher);
    context.subscriptions.push(buildPropsWatcher);

    logger.info('.NET Extension activation complete!');
}

export function deactivate() {
    logger.info('.NET Extension is being deactivated');

    // Dispose the solution service to clean up active solution
    SolutionService.dispose();
}