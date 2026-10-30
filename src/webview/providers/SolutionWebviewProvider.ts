import * as vscode from 'vscode';
import * as path from 'path';
import { ShowAllFiles } from '../../services/solution/showAllFiles';
import { TOOLBAR_ACTIONS, TOOLBAR_COMMANDS, ToolbarState } from '../../types/toolbar';
import { SolutionService } from '../../services/solution/solutionService';
import { SolutionTreeService } from '../../services/solution/solutionTreeService';
import { SolutionActionService } from '../../services/solution/solutionActionService';
import { DropResult, SolutionExpansionService } from '../../services/solution/solutionExpansionService';
import { FrameworkDropdownService } from '../../services/debug/frameworkDropdownService';
import { NodeIdService } from '../../services/solution/nodeIdService';
import { ProjectNode, SolutionData } from '../../types';
import { logger } from '../../core/logger';
import { SolutionWebView } from './views/SolutionWebview';
import { SimpleDebounceManager } from '../../services/shared/debounceManager';
import { NodeIdString } from '../../types/nodeId';
import { sendToUi } from '../nuget-view/shared';
import { BackendCmd } from '../../types/commands/backend';
import { ProjectActionCmd } from '../../types/commands/project-action';
import { sln } from '../../core/utils';
import { FOCUSED_NODE_TYPE_CONTEXT, MenuCommandAction, menuCommands, nodeTypesWithAction } from '../../core/contextMenus';
import { DiagnosticsService } from '../../services/diagnostics/diagnosticsService';
import { computeMarkers, scopeOf } from '../../services/diagnostics/diagnosticsRollup';
import { ProjectItemsService } from '../../services/project/items/projectItemsService';
import { IconThemeService } from '../../services/shared/iconThemeService';
import { BuildConfiguration, solutionConfigurations, solutionPlatforms } from '../../services/build/buildConfiguration';
import { StartupChoice } from '../../services/debug/startupProfiles/startupChoice';
import { refreshStartup } from '../../services/debug/startupProfiles/startProfile';
import { Solution } from '../../core/Solution';
import { Settings } from '../../services/shared/settings';
import { solutionWorkspaceFolder } from '../../services/solution/workspaceFolders';

import { handleAddNewItemAction, handleAddFileAction, handleAddFolderAction, handleCreateFileAction, handleCreateFolderAction, NewItemHost } from './solution/newItemHandlers';

const log = logger('SolutionWebviewProvider');

/** How long after a drop the tree still looks for the moved nodes to select them (a moved file waits for MSBuild) */
const DROP_REVEAL_MS = 10000;


export class SolutionWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'shinobi-solution-webview';

    private _view?: vscode.WebviewView;
    private _focusedNodeId?: NodeIdString;
    /** Nodes selected with Ctrl/Shift+click, reported by the webview */
    private _selectedNodeIds: NodeIdString[] = [];

    private _solutionChangeListener?: vscode.Disposable;
    private _solutionParseListener?: vscode.Disposable;
    /** The solution `_solutionChangeListener` listens to; another one is loaded e.g. after renaming the solution */
    private _listenedSolution?: Solution;
    private _activeEditorListener?: vscode.Disposable;
    private readonly _diagnosticsListener: vscode.Disposable;
    private readonly _iconThemeListener: vscode.Disposable;
    /** The webview has the current icon theme; reset when the webview (re)loads or the theme changes */
    private _iconThemeSent = false;
    private _localResourceRoots?: string;

    // Cache for solution tree data to improve expand performance
    private _cachedSolutionData?: ProjectNode[];
    private readonly _updateViewDebouncer: SimpleDebounceManager;
    /** A drop whose target opens and whose moved nodes are selected once the tree is rebuilt (and shows them) */
    /** Solution folders to open again once the tree is rebuilt after a drop moved them (their ids changed with their path) */
    private _reopenFolders?: { readonly paths: string[][]; readonly until: number };
    private _dropToReveal?: { readonly drop: DropResult; readonly until: number; opened: boolean };
    private get webview(): vscode.Webview | undefined {
        return this._view?.webview;
    }

    public static Instance: SolutionWebviewProvider | null = null;
    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext,
        private readonly _frameworkService: FrameworkDropdownService,
        private readonly _diagnostics: DiagnosticsService,
        private readonly _iconTheme: IconThemeService
    ) {
        SolutionWebviewProvider.Instance = this;
        this._updateViewDebouncer = new SimpleDebounceManager(async () => {
            try {
                log.debug('Debounced updateView triggered');

                // Load data asynchronously to prevent blocking
                log.debug('Loading solution data...');

                const solutionData = await this._getSolutionData();

                await SolutionExpansionService.restoreExpansionStates(solutionData, this._context);
                if (this._reopenFolders) {
                    const done = SolutionExpansionService.openSolutionFolders(this._reopenFolders.paths, solutionData, this._context);
                    if (done || Date.now() > this._reopenFolders.until) {
                        this._reopenFolders = undefined;
                    }
                }
                const dropped = await this._revealDrop(solutionData);
                await this._sendSolutionData(solutionData);

                this._cachedSolutionData = solutionData;
                if (dropped.length > 0) {
                    sendToUi(this.webview, { type: 'selectNode', payload: { nodeId: dropped[0], nodeIds: dropped, focus: false } });
                }
                // Note: hideLoading is not needed here - the solutionData message handler
                // will automatically set loading=false in useVsCodeApi.ts (line 388-389)
            } catch (error) {
                log.error('Error updating solution webview:', error);
                sendToUi(this.webview, {
                    type: 'error',
                    payload: {
                        message: 'Failed to load solution data'
                    }
                });

                // Hide loading bar on error
                sendToUi(this.webview, { type: 'hideLoading', });
            }
        }, 100);
        this._diagnosticsListener = _diagnostics.onDidChange(() => this._sendDiagnostics());
        this._iconThemeListener = _iconTheme.onDidChange(() => {
            this._iconThemeSent = false;
            this._sendIconTheme();
        });
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        this._iconThemeSent = false;
        this._localResourceRoots = undefined;

        this._applyWebviewOptions();

        webviewView.webview.html = SolutionWebView.getHtmlForWebview(this._extensionUri, webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            undefined,
            []
        );

        // A hidden view can't have focus, so stop keyboard shortcuts from targeting it
        webviewView.onDidChangeVisibility(() => {
            if (!webviewView.visible) {
                this._focusedNodeId = undefined;
                vscode.commands.executeCommand('setContext', FOCUSED_NODE_TYPE_CONTEXT, '');
            }
        });

        // Track active editor changes to highlight the active file in the tree (a view that is resolved again, after it
        // was disposed, must not leave the listener of the old one behind)
        this._activeEditorListener?.dispose();
        webviewView.onDidDispose(() => {
            this._activeEditorListener?.dispose();
            this._activeEditorListener = undefined;
            if (this._view === webviewView) {
                this._view = undefined;
            }
        });
        this._activeEditorListener = vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && this._view?.visible && Settings.trackActiveItem()) {
                void this.syncWithActiveDocument({ track: true });
            }
            if (editor && this._view) {
                const activeFilePath = editor.document.uri.fsPath;
                sendToUi(this.webview, {
                    type: 'activeFileChanged',
                    payload: {
                        filePath: activeFilePath
                    }
                });
            }
        });

        // Send current active file on initial load
        if (vscode.window.activeTextEditor && this._view) {
            const activeFilePath = vscode.window.activeTextEditor.document.uri.fsPath;
            sendToUi(this.webview, {
                type: 'activeFileChanged',
                payload: {
                    filePath: activeFilePath
                }
            });
        }

        void this._sendCachedData();
    }

    /** Tree node that keyboard shortcuts apply to, if the tree has focus */
    public get focusedNodeId(): NodeIdString | undefined {
        return this._focusedNodeId;
    }

    /**
     * Runs a tree node action invoked from the native (`webview/context`) context menu.
     */
    public async runNodeAction(action: ProjectActionCmd['action'], nodeId: NodeIdString): Promise<void> {
        if (action === 'rename') {
            // Rename is an inline edit in the tree, so hand it back to the webview
            sendToUi(this.webview, { type: 'startRename', payload: { nodeId } });
            return;
        }
        // On a node of a multi-selection, commands of Visual Studio's multi-select act on all selected nodes
        // that offer them (a menu only knows the clicked node)
        if (this._selectedNodeIds.length > 1 && this._selectedNodeIds.includes(nodeId)
            && SolutionActionService.multiSelectActions.includes(action) && action in menuCommands) {
            const types = nodeTypesWithAction(action as MenuCommandAction);
            const targets = this._selectedNodeIds.filter(id => types.includes(NodeIdService.parse(id).type));
            if (targets.length > 1) {
                await SolutionActionService.handleMultiAction(action, targets);
                if (!['copy', 'cut', 'build', 'rebuild', 'clean'].includes(action)) {
                    await this._triggerImmediateTreeRefresh(`${action} on ${targets.length} nodes`);
                }
                return;
            }
        }
        await this._handleMessage({ type: 'projectAction', payload: { action, nodeId } as ProjectActionCmd });
    }

    /** Visual Studio's "Collapse All" in the title bar */
    public async collapseAll(): Promise<void> {
        if (!this._cachedSolutionData) {
            return;
        }
        SolutionExpansionService.collapseAll(this._cachedSolutionData, this._context);
        await this._sendCachedData();
    }

    /** Visual Studio's "Show All Files" in the title bar */
    public async toggleShowAllFiles(): Promise<void> {
        await ShowAllFiles.toggle();
        const solution = SolutionService.getActiveSolution();
        await Promise.all([...(solution?.projects.values() ?? [])].map(project => project.reloadFileTree()));
        this.refresh();
    }

    /**
     * Visual Studio's "Sync with Active Document": selects the file of the active editor in the tree.
     * Tracking the active item (`shinobi.solutionExplorer.trackActiveItem`) does the same quietly,
     * without moving the focus and without a message for files outside the solution.
     */
    public async syncWithActiveDocument({ track = false } = {}): Promise<void> {
        const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
        const uri = vscode.window.activeTextEditor?.document.uri
            ?? (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri : undefined);
        if (!uri || uri.scheme !== 'file' || !this._view || !this._cachedSolutionData) {
            return;
        }
        const nodeId = await SolutionExpansionService.revealPath(uri.fsPath, this._cachedSolutionData, this._context);
        if (!nodeId) {
            if (!track) {
                vscode.window.showInformationMessage(`${path.basename(uri.fsPath)} is not part of the solution.`);
            }
            return;
        }
        if (!track) {
            this._view.show(false);
        }
        await this._sendCachedData();
        sendToUi(this.webview, { type: 'selectNode', payload: { nodeId, focus: !track } });
    }

    private async _handleMessage(message: BackendCmd) {
        log.debug('Received message:', message);

        switch (message.type) {
            case 'toolbarAction':
                // Only the commands of the toolbar buttons and the choices of its menu, whatever the webview sends
                if ('value' in message.payload) {
                    const { action, value } = message.payload;
                    if (action === 'setConfiguration' && BuildConfiguration.available.includes(value)) {
                        await BuildConfiguration.set(value);
                    } else if (action === 'setPlatform' && BuildConfiguration.availablePlatforms.includes(value)) {
                        await BuildConfiguration.setPlatform(value);
                    } else if (action === 'setFramework') {
                        const option = this._frameworkService.getFrameworkOptions().find(candidate => (candidate.value ?? '') === value);
                        if (option) {
                            await this._frameworkService.setActiveFramework(option.value);
                        }
                    }
                } else if (message.payload?.action && TOOLBAR_ACTIONS.includes(message.payload.action)) {
                    await vscode.commands.executeCommand(TOOLBAR_COMMANDS[message.payload.action]);
                }
                break;

            case 'getSolutionData':
                log.debug('Handling getSolutionData request');
                await this._sendCachedData();
                break;

            case 'projectAction':
                if (message.payload.action && message.payload.nodeId) {
                    log.debug('Handling projectAction:', message.payload);

                    // Handle addFile and addFolder specially - create temporary node in edit mode or create actual file/folder
                    if (message.payload.action === 'addFile') {
                        if (message.payload.data?.confirmed) {
                            await handleCreateFileAction(message.payload.nodeId, message.payload.data.name, this._newItemHost);
                        } else {
                            await handleAddFileAction(message.payload.nodeId, this._newItemHost);
                        }
                    } else if (message.payload.action === 'showDiagnostics') {
                        const node = SolutionTreeService.findNodeById(message.payload.nodeId, this._cachedSolutionData ?? []);
                        if (node) {
                            const scope = scopeOf(node, projectPath => ProjectItemsService.instance.get(projectPath)?.linkedEntries() ?? []);
                            await vscode.commands.executeCommand('shinobi.internal.errorList.showScope', node.name, scope);
                        }
                    } else if (message.payload.action === 'addNewItem') {
                        await handleAddNewItemAction(message.payload.nodeId);

                    } else if (message.payload.action === 'addFolder') {
                        if (message.payload.data?.confirmed) {
                            await handleCreateFolderAction(message.payload.nodeId, message.payload.data.name, this._newItemHost);
                        } else {
                            await handleAddFolderAction(message.payload.nodeId, this._newItemHost);
                        }
                    } else {
                        await SolutionActionService.handleProjectAction(message.payload);

                        // Trigger the same file change handling that the file watcher would do for operations that modify the .sln file
                        const solutionFileOperations = ['addSolutionFolder', 'removeSolutionFolder', 'addSolutionItem', 'removeSolutionItem'];
                        if (solutionFileOperations.includes(message.payload.action)) {
                            const solution = SolutionService.getActiveSolution();
                            if (solution) {
                                log.debug(`Triggering immediate file change handling after ${message.payload.action} operation`);
                                this.handleFileChange(solution.solutionPath, 'changed');
                            }
                        }

                        // Trigger immediate tree refresh for file/folder operations that affect the filesystem
                        const operationsThatAffectTree = ['deleteFile', 'rename', 'removeProject', 'deleteProject', 'addExistingItem'];
                        if (operationsThatAffectTree.includes(message.payload.action)) {
                            const nodeId = NodeIdService.parse(message.payload.nodeId);
                            if (!nodeId.path) {
                                log.error('Invalid node ID, cannot extract path for immediate refresh:', message.payload.nodeId);
                                return;
                            }
                            const fileName = path.basename(nodeId.path);
                            await this._triggerImmediateTreeRefresh(`${message.payload.action} operation: ${fileName}`);
                        }
                    }
                }
                break;

            case 'treeSelectionChanged':
                this._selectedNodeIds = message.payload.nodeIds;
                break;

            case 'treeFocusChanged':
                this._focusedNodeId = message.payload.nodeId;
                await vscode.commands.executeCommand('setContext', FOCUSED_NODE_TYPE_CONTEXT, message.payload.nodeType ?? '');
                break;

            case 'moveNodes': {
                const { nodeIds, targetNodeId, copy } = message.payload;
                if (!Array.isArray(nodeIds) || typeof targetNodeId !== 'string') {
                    log.warn('moveNodes without nodes or target ignored');
                    break;
                }
                const tree = this._cachedSolutionData ?? [];
                const open = SolutionExpansionService.openSolutionFolderPaths(tree);
                const into = SolutionExpansionService.solutionFolderPath(targetNodeId, tree) ?? [];
                const reopen = copy === true ? [] : nodeIds.flatMap(id => {
                    const from = SolutionTreeService.findNodeById(id, tree)?.type === 'solutionFolder' ? SolutionExpansionService.solutionFolderPath(id, tree) : undefined;
                    return from ? SolutionExpansionService.pathsAfterMove(open, from, into) : [];
                });
                const drop = await SolutionActionService.moveNodes(nodeIds, targetNodeId, copy === true);
                if (drop && reopen.length > 0) {
                    this._reopenFolders = { paths: reopen, until: Date.now() + DROP_REVEAL_MS };
                }
                if (drop) {
                    this._dropToReveal = { drop, until: Date.now() + DROP_REVEAL_MS, opened: false };
                }
                // Solution nodes change the solution file, files and folders the disk: refresh both ways, like the other operations
                const solution = SolutionService.getActiveSolution();
                if (solution) {
                    this.handleFileChange(solution.solutionPath, 'changed');
                }
                await this._triggerImmediateTreeRefresh(`drop of ${nodeIds.length} node(s)`);
                break;
            }

            case 'expandNode':
                if (message.payload.nodeId) {
                    log.debug('Handling expandNode request:', message.payload.nodeId);
                    await SolutionExpansionService.handleExpandNode(
                        message.payload.nodeId!,
                        this._cachedSolutionData || null,
                        () => this._sendCachedData(),
                        this._context
                    );
                }
                break;

            case 'collapseNode':
                if (message.payload.nodeId) {
                    log.debug('Handling collapseNode request:', message.payload.nodeId);
                    await SolutionExpansionService.handleCollapseNode(
                        message.payload.nodeId!,
                        this._cachedSolutionData || null,
                        () => this._sendCachedData(),
                        this._context
                    );
                }
                break;

            default:
                log.debug('Unknown message command:', message);
        }
    }

    private async _getSolutionData(): Promise<ProjectNode[]> {
        log.debug('Getting solution data...');

        const workspaceRoot = solutionWorkspaceFolder()?.uri.fsPath || '';
        log.debug('Workspace root:', workspaceRoot);

        // First check if we already have an active solution for the same workspace
        let solution = SolutionService.getActiveSolution();

        // A loaded solution stays, also one opened from outside the workspace folder (Open Solution...)
        if (!solution || !solution.solutionPath) {
            log.debug('No active solution, discovering solution...');
            solution = await SolutionService.discoverAndInitializeSolution() || undefined;
        } else {
            log.debug('Reusing existing active solution:', solution.solutionPath);
        }
        if (solution) {
            ShowAllFiles.setSolution(solution.solutionPath);
        }
        if (!solution) {
            log.debug('No solution found or failed to initialize');
            return [];
        }

        BuildConfiguration.setAvailable(solutionConfigurations(solution.solutionFile));
        BuildConfiguration.setAvailablePlatforms(solutionPlatforms(solution.solutionFile));

        // Listen to the solution once per loaded solution (it is replaced e.g. after a rename)
        if (this._listenedSolution !== solution) {
            this._solutionChangeListener?.dispose();
            this._solutionParseListener?.dispose();
            this._listenedSolution = solution;
            // Bring the startup configuration in line with the active configuration and the MSBuild
            // output path once per solution, e.g. when the configuration changed in another session
            StartupChoice.updateContext(solution.solutionPath);
            void refreshStartup();
            void vscode.commands.executeCommand('shinobi.internal.refreshTests');
            // A project the startup profile names was added or removed: its launches follow (refreshes run one after another;
            // a refresh does not touch the solution file, so this does not loop)
            this._solutionParseListener = solution.onDidParse(() => void refreshStartup());
            this._solutionChangeListener = solution.onDidChange(() => {
                log.debug('Solution changed (including launch.json), updating tree...');
                this._updateViewDebouncer.trigger();
            });
        }

        // Solution path available for potential future use

        // Get solution file data
        const solutionData = solution.solutionFile;
        if (!solutionData) {
            log.debug('Failed to get solution data');
            return [];
        }

        log.debug('Got solution data:', solutionData);

        this._frameworkService.setSolution(solution);
        this._updateDescription(solution);

        // Convert solution data to tree structure for the React component
        return await SolutionTreeService.buildSolutionTree(solution);
    }

    /**
     * Shows the active configuration and framework next to the view title, like Visual Studio's toolbar;
     * the startup profile's name instead of the framework while a profile is active
     */
    private _updateDescription(solution: Solution) {
        if (this._view) {
            const platform = BuildConfiguration.availablePlatforms.length > 1 ? BuildConfiguration.activePlatform : undefined;
            const startup = StartupChoice.activeProfileName(solution.solutionPath) ?? solution.getActiveFramework();
            this._view.description = [[BuildConfiguration.active, platform].filter(Boolean).join(' | '), startup].filter(Boolean).join(' · ');
            this._toolbarState = {
                configuration: [BuildConfiguration.active, platform].filter(Boolean).join(' | '),
                configurations: BuildConfiguration.available,
                activeConfiguration: BuildConfiguration.active,
                platforms: BuildConfiguration.availablePlatforms,
                activePlatform: BuildConfiguration.activePlatform,
                frameworks: this._frameworkService.getFrameworkOptions().map(option => ({
                    value: option.value ?? '', label: option.label, checked: option.value === this._frameworkService.getActiveFramework(),
                })),
                ...(startup ? { startup } : {}),
                showAllFiles: ShowAllFiles.isOn(),
            };
            this._sendToolbarState();
        }
    }

    /** What the new file and folder handlers use of this provider */
    private get _newItemHost(): NewItemHost {
        return { webview: this.webview, context: this._context, refreshTree: reason => this._triggerImmediateTreeRefresh(reason) };
    }

    private _toolbarState: ToolbarState | undefined;

    /** The state of the toolbar above the tree (configuration, framework or startup profile, Show All Files) */
    private _sendToolbarState(): void {
        if (this._view && this._toolbarState) {
            sendToUi(this.webview, { type: 'toolbarState', payload: this._toolbarState });
        }
    }

    public refresh() {
        log.debug('Refresh called');

        // Use incremental update instead of full refresh
        this._updateViewDebouncer.trigger();
    }

    /**
     * Sends cached data to webview without reloading solution - used for node expansion
     */
    private async _sendCachedData() {
        log.debug('Sending cached data to webview (no reload)');

        if (!this._view) {
            log.debug('No webview available, skipping send');
            return;
        }

        if (!this._cachedSolutionData) {
            log.debug('No cached data available, falling back to full reload');
            return this._updateViewDebouncer.trigger();
        }

        try {
            // Send cached data with expansion states already applied
            await this._sendSolutionData(this._cachedSolutionData);

            // Note: hideLoading is not needed here - the solutionData message handler
            // will automatically set loading=false in useVsCodeApi.ts (line 388-389)

        } catch (error) {
            log.error('Error sending cached data:', error);
        }
    }

    public handleFileChange(filePath: string, changeType: 'created' | 'changed' | 'deleted') {
        const fileName = path.basename(filePath);

        // Handle different types of file changes
        if (sln(filePath)) {
            if (changeType === 'deleted' && filePath === SolutionService.getActiveSolution()?.solutionPath) {
                // Solution file was deleted - clear everything
                sendToUi(this.webview, {
                    type: 'solutionData',
                    payload: { projects: [] }
                });
            } else {
                this._updateViewDebouncer.trigger(); // Full refresh with expansion state preservation
            }
        } else if (fileName.endsWith('.csproj') || fileName.endsWith('.vbproj') || fileName.endsWith('.fsproj')) {
            log.debug(`Project file ${changeType}: ${fileName}`);
            this._updateViewDebouncer.trigger(); // Simple full refresh
        } else {
            // All other files - use simple full refresh
            log.debug(`File ${changeType}: ${fileName}`);
            this._updateViewDebouncer.trigger(); // Simple full refresh
        }
    }

    /**
     * Centralized method to send solution data with expansion states already applied
     * This ensures expansion states are always restored before sending data to UI
     */
    private async _sendSolutionData(projects: ProjectNode[]): Promise<void> {

        if (!this._view) {
            return;
        }

        const data: SolutionData = { projects };
        sendToUi(this.webview, {
            type: 'solutionData',
            payload: data
        });
        this._sendDiagnostics(projects);
        this._sendToolbarState();
        if (!this._iconThemeSent) {
            this._sendIconTheme();
        }
    }

    /** Lets the webview load our bundle and the files of the user's icon theme */
    private _applyWebviewOptions(): void {
        if (!this._view) {
            return;
        }
        const themeRoot = this._iconTheme.themeRoot;
        const localResourceRoots = [
            vscode.Uri.joinPath(this._extensionUri, 'out', 'webview'),
            ...(themeRoot ? [themeRoot] : [])
        ];
        const key = localResourceRoots.map(uri => uri.toString()).join('|');
        if (key !== this._localResourceRoots) {
            this._localResourceRoots = key;
            this._view.webview.options = { enableScripts: true, localResourceRoots };
        }
    }

    /** Sends the user's file icon theme; the webview falls back to its own icons without one */
    private _sendIconTheme(): void {
        if (!this._view) {
            return;
        }
        this._applyWebviewOptions();
        this._iconThemeSent = true;
        sendToUi(this.webview, {
            type: 'iconTheme',
            payload: { theme: this._iconTheme.payloadFor(this._view.webview) }
        });
    }

    /** Sends the error/warning markers for the given (or last sent) tree */
    private _sendDiagnostics(projects: ProjectNode[] | undefined = this._cachedSolutionData): void {
        if (!this._view || !projects) {
            return;
        }
        sendToUi(this.webview, {
            type: 'diagnostics',
            payload: { markers: computeMarkers(projects, this._diagnostics.counts, projectPath => ProjectItemsService.instance.get(projectPath)?.linkedEntries() ?? []) }
        });
    }

    /**
     * After a drop, like Visual Studio: the node it went into opens (once) and the moved nodes get selected. A moved
     * file shows only once MSBuild evaluated its project again, so later rebuilds look for them, for a while.
     */
    private async _revealDrop(tree: ProjectNode[]): Promise<NodeIdString[]> {
        const pending = this._dropToReveal;
        if (!pending) {
            return [];
        }
        if (Date.now() > pending.until) {
            this._dropToReveal = undefined;
            return [];
        }
        const revealed = await SolutionExpansionService.revealDrop(pending.drop, tree, this._context, !pending.opened);
        pending.opened = true;
        if (revealed.length > 0) {
            this._dropToReveal = undefined;
        }
        return revealed;
    }

    /**
     * Triggers an immediate refresh of the tree after a file operation
     */
    private async _triggerImmediateTreeRefresh(reason: string): Promise<void> {
        try {
            log.debug(`Triggering immediate tree refresh: ${reason}`);

            // Force all projects to refresh their file trees (this will reload folder contents)
            const solution = SolutionService.getActiveSolution();
            if (solution) {
                await solution.forceRefreshAllProjects();
            }

            // Force a complete tree update with expansion state preservation
            await this._updateViewDebouncer.trigger();
        } catch (error) {
            log.error('Error triggering immediate tree refresh:', error);
        }
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this._diagnosticsListener.dispose();
        this._iconThemeListener.dispose();
        if (this._solutionChangeListener) {
            this._solutionChangeListener.dispose();
            this._solutionChangeListener = undefined;
        }
        this._solutionParseListener?.dispose();
        this._solutionParseListener = undefined;
        if (this._activeEditorListener) {
            this._activeEditorListener.dispose();
            this._activeEditorListener = undefined;
        }
    }
}