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
import { NuGetV3Offer } from './services/nuget/nugetV3Offer';
import { FrameworkChoice } from './services/project/frameworkChoice';
import { applyFrameworkContext } from './services/code/projectContext';
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
import { RefactoringPanel } from './webview/providers/RefactoringPanel';
import { CSharpServer, SERVER_EXTENSION_PATH } from './services/refactoring/csharpServer';
import { TypeRefactoring } from './services/refactoring/typeRefactoring';
import { EXTRACT_INTERFACE } from './services/refactoring/extractInterface';
import { EXTRACT_PARTIAL } from './services/refactoring/extractPartial';
import { EXTRACT_SUPERCLASS } from './services/refactoring/extractSuperclass';
import { PULL_UP } from './services/refactoring/pullUp';
import { USE_BASE_TYPE } from './services/refactoring/useBaseType';
import { PUSH_DOWN } from './services/refactoring/pushDown';
import { CONVERT_TYPE } from './services/refactoring/convertType';
import { EXTRACT_CLASS } from './services/refactoring/extractClass';
import { MOVE_TYPE_NAMESPACE } from './services/refactoring/moveTypeNamespace';
import { CHANGE_SIGNATURE } from './services/refactoring/changeSignature';
import { registerRenameSync } from './services/code/renameSync';
import { ExtractMethodChecked, EXTRACT_METHOD_CHECKED, EXTRACT_LOCAL_FUNCTION_CHECKED } from './services/refactoring/extractMethodChecked';
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
import { t } from './core/i18n';

const logger = loggerFn('Extensions');

async function startDebugWithStartupProject(): Promise<void> {
    try {
        // Just use the standard debug start command - launch.json should be configured
        await vscode.commands.executeCommand('workbench.action.debug.start');
    } catch (error) {
        logger.error('Error starting debug:', error);
        vscode.window.showErrorMessage(t('Error starting debug: {0}', error instanceof Error ? error.message : 'Unknown error'));
    }
}

export function activate(context: vscode.ExtensionContext) {
    // All logs go to Output > "Shinobi .NET Studio"; "Developer: Set Log Level" picks how much
    const logChannel = vscode.window.createOutputChannel('Shinobi .NET Studio', { log: true });
    // Messages below the channel's level are dropped before they are built: an object in a debug line is not dumped for nothing
    const levels = { trace: vscode.LogLevel.Trace, debug: vscode.LogLevel.Debug, info: vscode.LogLevel.Info, warn: vscode.LogLevel.Warning, error: vscode.LogLevel.Error };
    setLogSink({
        enabled: level => logChannel.logLevel !== vscode.LogLevel.Off && logChannel.logLevel <= levels[level],
        trace: message => logChannel.trace(message),
        debug: message => logChannel.debug(message),
        info: message => logChannel.info(message),
        warn: message => logChannel.warn(message),
        error: message => logChannel.error(message),
    });
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
        logger.debug(`File ${changeType}: ${fileName}`);

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
    NuGetV3Offer.initialize(context.workspaceState);
    FrameworkChoice.initialize(context.workspaceState);
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
    RefactoringPanel.extensionUri = context.extensionUri;
    const csharpServer = new CSharpServer(vscode.Uri.joinPath(context.extensionUri, SERVER_EXTENSION_PATH).fsPath);
    const checkedExtractions = [EXTRACT_METHOD_CHECKED, EXTRACT_LOCAL_FUNCTION_CHECKED].map(extraction => new ExtractMethodChecked(csharpServer, extraction));
    const typeRefactorings = [EXTRACT_INTERFACE, EXTRACT_PARTIAL, EXTRACT_SUPERCLASS, PULL_UP, USE_BASE_TYPE, PUSH_DOWN, CONVERT_TYPE, EXTRACT_CLASS, MOVE_TYPE_NAMESPACE, CHANGE_SIGNATURE].map(spec => new TypeRefactoring(csharpServer, spec));
    registerRenameSync(context);
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

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SolutionWebviewProvider.viewType,
            solutionWebviewProvider
        )
    );

    // The view is contributed once, to the activity bar container; only "vscode.moveViews" can put it in the secondary
    // sidebar (hosts whose VS Code core has no secondary-sidebar containers, e.g. Trae, would otherwise warn about the
    // view's container not existing and fall back to the Explorer)
    // Where a view container sits is workbench state, not something the manifest sets: a container can be left in the
    // panel (moved there once), which hides it away from the left and right sidebars. Resetting it puts it back in its
    // default place, the activity bar, i.e. the left sidebar; the reset also opens the container, so the editor takes
    // the focus back afterwards.
    const resetSolutionExplorerContainer = () => Promise.resolve(
        vscode.commands.executeCommand('workbench.view.extension.shinobi-solution-explorer.resetViewContainerLocation')
    ).then(() => vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup'));
    const applySolutionExplorerLocation = () => {
        const location = vscode.workspace.getConfiguration('shinobi.solutionExplorer').get<string>('location', 'sidebar');
        if (location === 'manual') {
            return;
        }
        const secondarySidebar = location === 'secondary-sidebar';
        void (secondarySidebar
            ? Promise.resolve(vscode.commands.executeCommand('vscode.moveViews', {
                viewIds: [SolutionWebviewProvider.viewType],
                destinationId: 'shinobi-solution-explorer-secondary-sidebar'
            // No right sidebar in this host: the view belongs in the left one
            })).catch(resetSolutionExplorerContainer)
            : resetSolutionExplorerContainer()
        ).catch(() => { /* host without these commands: the view stays where it is */ });
    };
    applySolutionExplorerLocation();
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('shinobi.solutionExplorer.location')) {
            applySolutionExplorerLocation();
        }
    }));

    // Register custom editor provider
    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(
            NuGetCustomEditorProvider.viewType,
            nugetCustomEditorProvider
        )
    );

    const applyChosenFramework = (documents: readonly vscode.TextDocument[]) => {
        const solution = SolutionService.getActiveSolution();
        if (!solution) {
            return Promise.resolve();
        }
        const projects = [...solution.projects.values()].map(project => ({ name: project.name, projectPath: project.projectPath, frameworks: project.frameworks }));
        return applyFrameworkContext(documents, solution.getActiveFramework() ?? undefined, projects, (command, ...args) => vscode.commands.executeCommand(command, ...args));
    };

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('shinobi.openNuGetManager', (projectPath?: string) => {
            void NuGetCustomEditorProvider.openNuGetManager(projectPath);
        }),
        vscode.commands.registerCommand('shinobi.openNuGetManagerForSolution', (solutionPath?: string) => {
            void NuGetCustomEditorProvider.openNuGetManagerForSolution(solutionPath);
        }),
        // The framework chosen for the solution is also the C# language context of the files of every project that targets it: of the open
        // files when it is chosen, and of each file as its editor comes to the front (the C# extension starts a file on its first framework)
        FrameworkChoice.onDidChange(() => void applyChosenFramework(vscode.workspace.textDocuments)),
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                void applyChosenFramework([editor.document]);
            }
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
                placeHolder: t('Select target framework')
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
                BuildConfiguration.available.map(name => ({ label: name, description: name === active ? t('(current)') : undefined })),
                { placeHolder: t('Solution configuration') }
            );
            if (picked) {
                await BuildConfiguration.set(picked.label);
            }
        }),
        vscode.commands.registerCommand('shinobi.solution.selectPlatform', async () => {
            const active = BuildConfiguration.activePlatform;
            const picked = await vscode.window.showQuickPick(
                BuildConfiguration.availablePlatforms.map(name => ({ label: name, description: name === active ? t('(current)') : undefined })),
                { placeHolder: t('Solution platform') }
            );
            if (picked) {
                await BuildConfiguration.setPlatform(picked.label);
            }
        }),
        // The toolbar's configuration button: one menu for what the title bar's configuration menu offers
        vscode.commands.registerCommand('shinobi.solution.configurationMenu', async () => {
            const active = BuildConfiguration.active;
            const items: Array<vscode.QuickPickItem & { run?: string }> = [
                { label: t('Solution configuration'), kind: vscode.QuickPickItemKind.Separator },
                ...BuildConfiguration.available.map(name => ({ label: name, description: name === active ? t('(current)') : undefined, run: `configuration:${name}` })),
            ];
            if (BuildConfiguration.availablePlatforms.length > 1) {
                items.push({ label: t('Platform'), kind: vscode.QuickPickItemKind.Separator },
                    ...BuildConfiguration.availablePlatforms.map(name => ({ label: name, description: name === BuildConfiguration.activePlatform ? t('(current)') : undefined, run: `platform:${name}` })));
            }
            items.push({ label: '', kind: vscode.QuickPickItemKind.Separator },
                { label: `$(symbol-event) ${t('Startup Profile...')}`, run: 'command:shinobi.solution.selectStartupProfile' },
                { label: `$(settings-gear) ${t('Configuration Manager...')}`, run: 'command:shinobi.configurationManager.open' });
            const picked = await vscode.window.showQuickPick(items, { placeHolder: t('Solution configuration: {0}', active) });
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
            `${SolutionWebviewProvider.viewType}.focus`)),
        // Visual Studio's File > Open > Solution: another solution of the workspace, or any solution file
        vscode.commands.registerCommand('shinobi.solution.open', async () => {
            const folders = vscode.workspace.workspaceFolders ?? [];
            const found = (await Promise.all(folders.map(folder => SolutionDiscovery.findSolutionFiles(folder.uri.fsPath, 6)))).flat();
            const active = SolutionService.getActiveSolution()?.solutionPath;
            const browse = { label: `$(folder-opened) ${t('Browse...')}`, description: t('Any .sln or .slnx file'), solutionPath: undefined as string | undefined };
            const picked = await vscode.window.showQuickPick([
                ...found.map(solutionPath => ({
                    label: path.basename(solutionPath),
                    description: path.relative(path.dirname(rootOf(solutionPath) ?? ''), path.dirname(solutionPath)) || undefined,
                    detail: solutionPath === active ? t('Open now') : undefined,
                    solutionPath: solutionPath as string | undefined,
                })),
                browse,
            ], { title: t('Open Solution'), placeHolder: t('Pick a solution') });
            let solutionPath = picked?.solutionPath;
            if (picked === browse) {
                const [file] = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    filters: { Solutions: ['sln', 'slnx'] },
                    openLabel: t('Open Solution'),
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
        ...checkedExtractions.flatMap(extraction => [
            vscode.languages.registerCodeActionsProvider({ language: 'csharp' }, extraction, ExtractMethodChecked.metadata),
            vscode.commands.registerCommand(extraction.extraction.command, (uri: vscode.Uri, range: vscode.Range) => extraction.run(uri, range).catch(error => {
                void vscode.window.showErrorMessage(t('{0} failed: {1}', extraction.extraction.title.replace(/\.\.\.$/, ''), error instanceof Error ? error.message : String(error)));
            })),
        ]),
        ...typeRefactorings.flatMap(refactoring => [
            vscode.languages.registerCodeActionsProvider({ language: 'csharp' }, refactoring, TypeRefactoring.metadata),
            vscode.commands.registerCommand(refactoring.spec.command, (uri: vscode.Uri, position: vscode.Position) => refactoring.run(uri, position).catch(error => {
                void vscode.window.showErrorMessage(t('{0} failed: {1}', refactoring.spec.actionTitle.replace(/\.\.\.$/, ''), error instanceof Error ? error.message : String(error)));
            })),
        ]),
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
            // The Startup configuration in launch.json carries the console: write it again
            if (event.affectsConfiguration('shinobi.debug.console')) {
                await DebugConfigService.refreshStartupConfiguration();
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