import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionService } from '../../services/solutionService';
import { SolutionTreeService } from '../../services/solutionTreeService';
import { SolutionActionService } from '../../services/solutionActionService';
import { SolutionExpansionService } from '../../services/solutionExpansionService';
import { FrameworkDropdownService } from '../../services/frameworkDropdownService';
import { NodeIdService } from '../../services/nodeIdService';
import { ProjectNode, SolutionData } from '../../types';
import { logger } from '../../core/logger';
import { SolutionWebView } from './views/SolutionWebview';
import { SimpleDebounceManager } from '../../services/debounceManager';
import { NodeIdString } from '../../types/nodeId';
import { sendToUi } from '../nuget-view/shared';
import { BackendCmd } from '../../types/commands/backend';
import { ProjectActionCmd } from '../../types/commands/project-action';
import { sln } from '../../core/utils';
import { FOCUSED_NODE_TYPE_CONTEXT } from '../../core/contextMenus';
import { DiagnosticsService } from '../../services/diagnosticsService';
import { computeMarkers } from '../../services/diagnosticsRollup';
import { IconThemeService } from '../../services/iconThemeService';
import { BuildConfiguration, solutionConfigurations } from '../../services/buildConfiguration';
import { DebugConfigService } from '../../services/debugConfigService';
import { Solution } from '../../core/Solution';
import { projectForPath } from '../../services/templates/templateService';
import { openNewItemWizard } from './TemplateWizardPanel';
import { Settings } from '../../services/settings';

const log = logger('SolutionWebviewProvider');


export class SolutionWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'shinobi-solution-webview';

    private _view?: vscode.WebviewView;
    private _isRenaming: boolean = false;
    private _focusedNodeId?: NodeIdString;

    private _solutionChangeListener?: vscode.Disposable;
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
                log.info('Loading solution data and frameworks...');

                const solutionData = await this._getSolutionData();

                await SolutionExpansionService.restoreExpansionStates(solutionData, this._context);
                await this._sendSolutionData(solutionData);

                this._cachedSolutionData = solutionData;
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

        // Track active editor changes to highlight the active file in the tree
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

        this._sendCachedData();
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
        log.info('Received message:', message);

        switch (message.type) {
            case 'getSolutionData':
                log.info('Handling getSolutionData request');
                await this._sendCachedData();
                break;

            case 'setFramework':
                log.info('Handling setFramework request:', message.payload.framework);
                await this._frameworkService.setActiveFramework(message.payload.framework);
                break;

            case 'projectAction':
                if (message.payload.action && message.payload.nodeId) {
                    log.info('Handling projectAction:', message.payload);

                    // Handle addFile and addFolder specially - create temporary node in edit mode or create actual file/folder
                    if (message.payload.action === 'addFile') {
                        if (message.payload.data?.confirmed) {
                            await this._handleCreateFileAction(message.payload.nodeId, message.payload.data.name);
                        } else {
                            await this._handleAddFileAction(message.payload.nodeId);
                        }
                    } else if (message.payload.action === 'addNewItem') {
                        await this._handleAddNewItemAction(message.payload.nodeId);

                    } else if (message.payload.action === 'addFolder') {
                        if (message.payload.data?.confirmed) {
                            await this._handleCreateFolderAction(message.payload.nodeId, message.payload.data.name);
                        } else {
                            await this._handleAddFolderAction(message.payload.nodeId);
                        }
                    } else {
                        await SolutionActionService.handleProjectAction(message.payload);

                        // Trigger the same file change handling that the file watcher would do for operations that modify the .sln file
                        const solutionFileOperations = ['addSolutionFolder', 'removeSolutionFolder', 'addSolutionItem', 'removeSolutionItem'];
                        if (solutionFileOperations.includes(message.payload.action)) {
                            const solution = SolutionService.getActiveSolution();
                            if (solution) {
                                log.info(`Triggering immediate file change handling after ${message.payload.action} operation`);
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

            case 'treeFocusChanged':
                this._focusedNodeId = message.payload.nodeId;
                await vscode.commands.executeCommand('setContext', FOCUSED_NODE_TYPE_CONTEXT, message.payload.nodeType ?? '');
                break;

            case 'expandNode':
                if (message.payload.nodeId) {
                    log.info('Handling expandNode request:', message.payload.nodeId);
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
                    log.info('Handling collapseNode request:', message.payload.nodeId);
                    await SolutionExpansionService.handleCollapseNode(
                        message.payload.nodeId!,
                        this._cachedSolutionData || null,
                        () => this._sendCachedData(),
                        this._context
                    );
                }
                break;

            default:
                log.info('Unknown message command:', message);
        }
    }

    private async _getSolutionData(): Promise<ProjectNode[]> {
        log.info('Getting solution data...');

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        log.info('Workspace root:', workspaceRoot);

        // First check if we already have an active solution for the same workspace
        let solution = SolutionService.getActiveSolution();

        // A loaded solution stays, also one opened from outside the workspace folder (Open Solution...)
        if (!solution || !solution.solutionPath) {
            log.info('No active solution, discovering solution...');
            solution = await SolutionService.discoverAndInitializeSolution(workspaceRoot) || undefined;
        } else {
            log.info('Reusing existing active solution:', solution.solutionPath);
        }
        if (!solution) {
            log.info('No solution found or failed to initialize');
            return [];
        }

        BuildConfiguration.setAvailable(solutionConfigurations(solution.solutionFile));

        // Listen to the solution once per loaded solution (it is replaced e.g. after a rename)
        if (this._listenedSolution !== solution) {
            this._solutionChangeListener?.dispose();
            this._listenedSolution = solution;
            // Bring the startup configuration in line with the active configuration and the MSBuild
            // output path once per solution, e.g. when the configuration changed in another session
            void DebugConfigService.refreshStartupConfiguration();
            void vscode.commands.executeCommand('shinobi.internal.refreshTests');
            this._solutionChangeListener = solution.onDidChange(() => {
                log.info('Solution changed (including launch.json), updating tree...');
                this._updateViewDebouncer.trigger();
            });
        }

        // Solution path available for potential future use

        // Get solution file data
        const solutionData = solution.solutionFile;
        if (!solutionData) {
            log.info('Failed to get solution data');
            return [];
        }

        log.info('Got solution data:', solutionData);

        this._frameworkService.setSolution(solution);
        this._updateDescription(solution);

        // Convert solution data to tree structure for the React component
        return await SolutionTreeService.buildSolutionTree(solution);
    }

    /** Shows the active configuration and framework next to the view title, like Visual Studio's toolbar */
    private _updateDescription(solution: Solution) {
        if (this._view) {
            this._view.description = [BuildConfiguration.active, solution.getActiveFramework()].filter(Boolean).join(' · ');
        }
    }

    public refresh() {
        log.debug('Refresh called');

        // Don't refresh if we're in the middle of a rename operation
        if (this._isRenaming) {
            log.debug('Skipping refresh during rename operation');
            return;
        }
        // Use incremental update instead of full refresh
        this._updateViewDebouncer.trigger();
    }

    /**
     * Sends cached data to webview without reloading solution - used for node expansion
     */
    private async _sendCachedData() {
        log.debug('Sending cached data to webview (no reload)');

        if (!this._view) {
            log.info('No webview available, skipping send');
            return;
        }

        if (!this._cachedSolutionData) {
            log.info('No cached data available, falling back to full reload');
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
                    payload: {
                        projects: [],
                        frameworks: []
                    }
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

        // Get frameworks for complete update
        const frameworks = await this._frameworkService.getAvailableFrameworks();
        const activeFramework = this._frameworkService.getActiveFramework();

        const data: SolutionData = {
            projects: projects,
            frameworks: frameworks || [],
            activeFramework
        };
        sendToUi(this.webview, {
            type: 'solutionData',
            payload: data
        });
        this._sendDiagnostics(projects);
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
            payload: { markers: computeMarkers(projects, this._diagnostics.counts) }
        });
    }

    /**
     * Returns the directory new files/folders are created in for a folder or project node
     */
    private _getContainerDirectory(nodeId: NodeIdString): string | undefined {
        const node = NodeIdService.parse(nodeId);
        switch (node?.type) {
            case 'folder': return node.path;
            case 'project': return path.dirname(node.path);
            default: return undefined;
        }
    }

    /**
     * Handles the addFile action by creating a temporary node in edit mode
     */
    /** "Add New Item...": the template wizard for the folder (or project root) */
    private async _handleAddNewItemAction(parentNodeId: NodeIdString): Promise<void> {
        const parentDir = this._getContainerDirectory(parentNodeId);
        const projectPath = parentDir && projectForPath(parentDir);
        if (!parentDir || !projectPath) {
            log.error('Add New Item: no project for', parentNodeId);
            return;
        }
        openNewItemWizard(parentDir, projectPath);
    }

    private async _handleAddFileAction(parentNodeId: NodeIdString): Promise<void> {
        try {
            const parentDir = this._getContainerDirectory(parentNodeId);
            if (!parentDir) {
                log.error('Invalid parent node ID, cannot extract path:', parentNodeId);
                vscode.window.showErrorMessage(`Error adding file: invalid parent path`);
                return;
            }

            log.info(`Creating temporary file node for parent: ${parentDir}`);

            // Send a message to the webview to create a temporary node in edit mode
            sendToUi(this.webview, {
                type: 'addTemporaryNode',
                payload: {
                    parentNodeId: parentNodeId,
                    nodeId: NodeIdService.generateTemporaryId('file', parentDir),
                    nodeType: 'file'
                }
            });

            log.info(`Sent addTemporaryNode message to webview`);
        } catch (error) {
            log.error('Error handling add file action:', error);
            vscode.window.showErrorMessage(`Error adding file: ${error}`);
        }
    }

    /**
     * Handles the addFolder action by creating a temporary node in edit mode
     */
    private async _handleAddFolderAction(parentNodeId: NodeIdString): Promise<void> {
        try {
            const parentDir = this._getContainerDirectory(parentNodeId);
            if (!parentDir) {
                log.error('Invalid parent node ID, cannot extract path:', parentNodeId);
                vscode.window.showErrorMessage(`Error adding folder: invalid parent path`);
                return;
            }

            log.info(`Creating temporary folder node for parent: ${parentDir}`);

            // Send a message to the webview to create a temporary node in edit mode
            sendToUi(this.webview, {
                type: 'addTemporaryNode',
                payload: {
                    parentNodeId: parentNodeId,
                    nodeId: NodeIdService.generateTemporaryId('folder', parentDir),
                    nodeType: 'folder'
                }
            });

            log.info(`Sent addTemporaryNode message to webview for folder`);
        } catch (error) {
            log.error('Error handling add folder action:', error);
            vscode.window.showErrorMessage(`Error adding folder: ${error}`);
        }
    }

    /**
     * Handles actual file creation when a temporary node is confirmed
     */
    private async _handleCreateFileAction(parentNodeId: NodeIdString, fileName: string): Promise<void> {
        try {
            const nodeId = NodeIdService.parse(parentNodeId);
            const parentPath = nodeId.path;

            if (!parentPath) {
                log.error('Invalid node ID, cannot extract parent path:', nodeId);
                vscode.window.showErrorMessage(`Error creating file: invalid parent path`);
                return;
            }

            log.info(`Creating actual file: ${fileName} in ${parentPath}`);
            const fullPath = path.join(parentPath, fileName);
            await SolutionActionService.createFile(fullPath);

            log.info(`File created successfully: ${fullPath}`);
            // Send message to remove all temporary nodes for this parent
            /*
            sendToUi(this.webview, {
                type: 'removeTemporaryNodes',
                payload: {
                    parentPath: parentPath
                }
            });
*/
            // Ensure parent folder stays expanded by adding it to expansion state AFTER refresh
            const currentExpanded = SolutionExpansionService.getExpansionState(this._context);
            if (!currentExpanded.has(parentNodeId)) {
                currentExpanded.add(parentNodeId);
                SolutionExpansionService.saveExpansionState(currentExpanded, this._context);
                log.info(`Added folder to expansion state: ${parentNodeId}`);
            } else {
                log.info(`Folder already in expansion state: ${parentNodeId}`);
            }

            //return this._triggerImmediateTreeRefresh(`File created: ${fileName}`);
        } catch (error) {
            log.error('Error creating file:', error);
            vscode.window.showErrorMessage(`Error creating file: ${error}`);
        }
    }

    /**
     * Handles actual folder creation when a temporary node is confirmed
     */
    private async _handleCreateFolderAction(parentNodeId: NodeIdString, folderName: string): Promise<void> {
        try {
            const nodeId = NodeIdService.parse(parentNodeId);
            const parentPath = nodeId.path;
            if (!parentPath) {
                log.error('Invalid node ID, cannot extract parent path:', nodeId);
                vscode.window.showErrorMessage(`Error creating folder: invalid parent path`);
                return;
            }

            log.info(`Creating actual folder: ${folderName} in ${parentPath}`);

            const fullPath = path.join(parentPath, folderName);
            await SolutionActionService.createFolder(fullPath);

            log.info(`Folder created successfully: ${fullPath}`);

            // Send message to remove all temporary nodes for this parent
            sendToUi(this.webview, {
                type: 'removeTemporaryNodes',
                payload: {
                    parentPath: parentPath
                }
            });

            // Trigger immediate tree refresh
            await this._triggerImmediateTreeRefresh(`folder creation: ${folderName}`);

            const currentExpanded = SolutionExpansionService.getExpansionState(this._context);
            if (!currentExpanded.has(parentNodeId)) {
                currentExpanded.add(parentNodeId);
                SolutionExpansionService.saveExpansionState(currentExpanded, this._context);
                log.info(`Added folder to expansion state: ${parentNodeId}`);

                // Force another tree update to apply the expansion state
                await this._triggerImmediateTreeRefresh(`Folder created: ${folderName}`);
            } else {
                log.info(`Folder already in expansion state: ${parentNodeId}`);
            }
        } catch (error) {
            log.error('Error creating folder:', error);
            vscode.window.showErrorMessage(`Error creating folder: ${error}`);
        }
    }

    /**
     * Triggers an immediate refresh of the tree after a file operation
     */
    private async _triggerImmediateTreeRefresh(reason: string): Promise<void> {
        try {
            log.info(`Triggering immediate tree refresh: ${reason}`);

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
        if (this._activeEditorListener) {
            this._activeEditorListener.dispose();
            this._activeEditorListener = undefined;
        }
    }
}