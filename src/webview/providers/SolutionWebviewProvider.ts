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
import { BackendCmd } from '../../types/backendCmd';

const log = logger('SolutionWebviewProvider');


export class SolutionWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'dotnet-solution-webview';

    private _view?: vscode.WebviewView;
    private _isRenaming: boolean = false;

    private _solutionChangeListener?: vscode.Disposable;
    private _activeEditorListener?: vscode.Disposable;

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
        private readonly _frameworkService: FrameworkDropdownService
    ) {
        SolutionWebviewProvider.Instance = this;
        this._updateViewDebouncer = new SimpleDebounceManager(async () => {
            try {
                console.error('Debounced updateView triggered');

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
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'out', 'webview')
            ]
        };

        webviewView.webview.html = SolutionWebView.getHtmlForWebview(this._extensionUri, webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            message => this._handleMessage(message),
            undefined,
            []
        );

        // Track active editor changes to highlight the active file in the tree
        this._activeEditorListener = vscode.window.onDidChangeActiveTextEditor(editor => {
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
                    log.info('Handling projectAction:', {
                        action: message.payload.action,
                        nodeId: message.payload.nodeId,
                        data: (message.payload as any).data
                    });

                    // Handle addFile and addFolder specially - create temporary node in edit mode or create actual file/folder
                    if (message.payload.action === 'addFile') {
                        if (message.payload.data?.confirmed) {
                            await this._handleCreateFileAction(message.payload.nodeId, message.payload.data.name);
                        } else {
                            await this._handleAddFileAction(message.payload.nodeId);
                        }
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
                        const operationsThatAffectTree = ['deleteFile', 'rename', 'removeProject', 'deleteProject'];
                        if (operationsThatAffectTree.includes(message.payload.action)) {
                            const projectPath = NodeIdService.getPathFromId(message.payload.nodeId);
                            if (!projectPath) {
                                log.error('Invalid node ID, cannot extract path for immediate refresh:', message.payload.nodeId);
                                return;
                            }
                            const fileName = path.basename(projectPath);
                            await this._triggerImmediateTreeRefresh(`${message.payload.action} operation: ${fileName}`);
                        }
                    }
                }
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

        if (!solution || !solution.solutionPath ||
            !solution.solutionPath.startsWith(workspaceRoot)) {
            // Only discover and initialize if we don't have a solution or it's for a different workspace
            log.info('No active solution or different workspace, discovering solution...');
            solution = await SolutionService.discoverAndInitializeSolution(workspaceRoot) || undefined;
        } else {
            log.info('Reusing existing active solution:', solution.solutionPath);
        }
        if (!solution) {
            log.info('No solution found or failed to initialize');
            return [];
        }

        // Set up solution change listener if not already set up
        if (!this._solutionChangeListener) {
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

        // Convert solution data to tree structure for the React component
        return await SolutionTreeService.buildSolutionTree(solution);
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
        if (fileName.endsWith('.sln')) {
            if (changeType === 'deleted') {
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
    }

    /**
     * Handles the addFile action by creating a temporary node in edit mode
     */
    private async _handleAddFileAction(parentNodeId: NodeIdString): Promise<void> {
        try {
            const node = NodeIdService.parse(parentNodeId);
            if (!node || node.type !== 'folder') {
                log.error('Invalid parent node ID, cannot extract path:', parentNodeId);
                vscode.window.showErrorMessage(`Error adding file: invalid parent path`);
                return;
            }

            log.info(`Creating temporary file node for parent: ${node.path}`);

            // Send a message to the webview to create a temporary node in edit mode
            sendToUi(this.webview, {
                type: 'addTemporaryNode',
                payload: {
                    parentNodeId: parentNodeId,
                    nodeId: NodeIdService.generateTemporaryId('file', node.path!),
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
            const node = NodeIdService.parse(parentNodeId);
            if (!node || node.type !== 'folder') {
                log.error('Invalid parent node ID, cannot extract path:', parentNodeId);
                vscode.window.showErrorMessage(`Error adding folder: invalid parent path`);
                return;
            }

            log.info(`Creating temporary folder node for parent: ${node.path}`);

            // Send a message to the webview to create a temporary node in edit mode
            sendToUi(this.webview, {
                type: 'addTemporaryNode',
                payload: {
                    parentNodeId: parentNodeId,
                    nodeId: NodeIdService.generateTemporaryId('folder', node.path!),
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
    private async _handleCreateFileAction(nodeId: NodeIdString, fileName: string): Promise<void> {
        try {
            let parentPath: string | null = null;
            let projectPath: string | null = null;

            // Handle temporary node IDs vs regular node IDs
            if (NodeIdService.isTemporaryNode(nodeId)) {
                const tempInfo = NodeIdService.getTemporaryNodeInfo(nodeId);
                if (tempInfo) {
                    parentPath = tempInfo.parentPath;
                }
            } else {
                // Handle regular node IDs
                parentPath = NodeIdService.getPathFromId(nodeId);
            }

            if (!parentPath) {
                log.error('Invalid node ID, cannot extract parent path:', nodeId);
                vscode.window.showErrorMessage(`Error creating file: invalid parent path`);
                return;
            }

            // Extract project path from the original nodeId if available
            if (NodeIdService.isTemporaryNode(nodeId)) {
                const solution = SolutionService.getActiveSolution();
                if (solution) {
                    for (const [projPath] of solution.projects) {
                        if (parentPath.startsWith(path.dirname(projPath))) {
                            projectPath = projPath;
                            break;
                        }
                    }
                }
            } else if (NodeIdService.isFolderNode(nodeId)) {
                // For folder nodeIds, extract project path from nodeId format: folder:projectPath:folderPath
                projectPath = NodeIdService.getProjectPathFromNodeId(nodeId);
            }

            log.info(`Creating actual file: ${fileName} in ${parentPath}`);
            const fullPath = path.join(parentPath, fileName);
            await SolutionActionService.createFile(fullPath);

            log.info(`File created successfully: ${fullPath}`);
            vscode.window.showInformationMessage(`File created: ${fileName}`);
            // Send message to remove all temporary nodes for this parent
            sendToUi(this.webview, {
                type: 'removeTemporaryNodes',
                payload: {
                    parentPath: parentPath
                }
            });

            // Ensure parent folder stays expanded by adding it to expansion state AFTER refresh
            if (projectPath) {
                const parentNodeId = NodeIdService.generateFolderId(parentPath);
                const currentExpanded = SolutionExpansionService.getExpansionState(this._context);
                if (!currentExpanded.has(parentNodeId)) {
                    currentExpanded.add(parentNodeId);
                    SolutionExpansionService.saveExpansionState(currentExpanded, this._context);
                    log.info(`Added folder to expansion state: ${parentNodeId}`);
                } else {
                    log.info(`Folder already in expansion state: ${parentNodeId}`);
                }
            } else {
                log.warn(`Could not find project path for folder: ${parentPath}`);
            }

            return this._triggerImmediateTreeRefresh(`File created: ${fileName}`);
        } catch (error) {
            log.error('Error creating file:', error);
            vscode.window.showErrorMessage(`Error creating file: ${error}`);
        }
    }

    /**
     * Handles actual folder creation when a temporary node is confirmed
     */
    private async _handleCreateFolderAction(nodeId: NodeIdString, folderName: string): Promise<void> {
        try {
            let parentPath: string | null = null;
            let projectPath: string | null = null;

            // Handle temporary node IDs vs regular node IDs
            if (NodeIdService.isTemporaryNode(nodeId)) {
                const tempInfo = NodeIdService.getTemporaryNodeInfo(nodeId);
                if (tempInfo) {
                    parentPath = tempInfo.parentPath;
                }
            } else {
                // Handle regular node IDs
                parentPath = NodeIdService.getPathFromId(nodeId);
            }

            if (!parentPath) {
                log.error('Invalid node ID, cannot extract parent path:', nodeId);
                vscode.window.showErrorMessage(`Error creating folder: invalid parent path`);
                return;
            }

            // Extract project path from the original nodeId if available
            if (NodeIdService.isTemporaryNode(nodeId)) {
                const solution = SolutionService.getActiveSolution();
                if (solution) {
                    for (const [projPath] of solution.projects) {
                        if (parentPath.startsWith(path.dirname(projPath))) {
                            projectPath = projPath;
                            break;
                        }
                    }
                }
            } else if (NodeIdService.isFolderNode(nodeId)) {
                // For folder nodeIds, extract project path from nodeId format: folder:projectPath:folderPath
                projectPath = NodeIdService.getProjectPathFromNodeId(nodeId);
            }

            log.info(`Creating actual folder: ${folderName} in ${parentPath}`);

            const fullPath = path.join(parentPath, folderName);
            await SolutionActionService.createFolder(fullPath);

            log.info(`Folder created successfully: ${fullPath}`);
            vscode.window.showInformationMessage(`Folder created: ${folderName}`);

            // Send message to remove all temporary nodes for this parent
            sendToUi(this.webview, {
                type: 'removeTemporaryNodes',
                payload: {
                    parentPath: parentPath
                }
            });

            // Trigger immediate tree refresh
            await this._triggerImmediateTreeRefresh(`folder creation: ${folderName}`);

            // Ensure parent folder stays expanded by adding it to expansion state AFTER refresh
            if (projectPath) {
                const parentNodeId = NodeIdService.generateFolderId(parentPath);
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
            } else {
                log.warn(`Could not find project path for folder: ${parentPath}`);
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