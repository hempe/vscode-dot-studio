import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionService } from '../../services/solutionService';
import { SolutionTreeService } from '../../services/solutionTreeService';
import { SolutionActionService } from '../../services/solutionActionService';
import { SolutionExpansionService } from '../../services/solutionExpansionService';
import { FrameworkDropdownService } from '../../services/frameworkDropdownService';
import { NodeIdService, NodeIdString } from '../../services/nodeIdService';
import { ProjectActionType, ProjectNode as ExtensionProjectNode } from '../../types';
import { ProjectNode as WebviewProjectNode, SolutionData as WebviewSolutionData } from '../solution-view/types';
import { logger } from '../../core/logger';
import { SolutionWebView } from './views/SolutionWebview';
import { SimpleDebounceManager } from '../../services/debounceManager';

const log = logger('SolutionWebviewProvider');

interface WebviewMessage {
    command: string;
    framework?: string;
    action?: ProjectActionType;
    projectPath?: string;
    data?: MessageData;
    expandedNodes?: string[];
    nodeId?: NodeIdString;
    nodeType?: string;
}

interface MessageData {
    type?: string;
    oldName?: string;
    newName?: string;
    name?: string;
    isConfirmed?: boolean;
}

export class SolutionWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'dotnet-solution-webview';

    private _view?: vscode.WebviewView;
    private _isRenaming: boolean = false;

    private _solutionChangeListener?: vscode.Disposable;

    // Cache for solution tree data to improve expand performance
    private _cachedSolutionData?: ExtensionProjectNode[];
    private readonly _updateViewDebouncer: SimpleDebounceManager;

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

                // Show loading bar in webview
                this._view?.webview.postMessage({
                    command: 'showLoading',
                    message: 'Loading solution...'
                });

                // Load data asynchronously to prevent blocking
                log.info('Loading solution data and frameworks...');

                const solutionData = await this._getSolutionData();

                await SolutionExpansionService.restoreExpansionStates(solutionData, this._context);
                await this._sendSolutionData(solutionData);

                this._cachedSolutionData = solutionData;
                // Hide loading bar
                this._view?.webview.postMessage({
                    command: 'hideLoading'
                });
            } catch (error) {
                log.error('Error updating solution webview:', error);
                this._view?.webview.postMessage({
                    command: 'error',
                    message: 'Failed to load solution data'
                });

                // Hide loading bar on error
                this._view?.webview.postMessage({
                    command: 'hideLoading'
                });
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

        this._sendCachedData();
    }

    private async _handleMessage(message: WebviewMessage) {
        log.info('Received message:', message);

        switch (message.command) {
            case 'getSolutionData':
                log.info('Handling getSolutionData request');
                await this._sendCachedData();
                break;

            case 'setFramework':
                log.info('Handling setFramework request:', message.framework);
                await this._frameworkService.setActiveFramework(message.framework);
                break;

            case 'projectAction':
                if (message.action && message.nodeId) {
                    log.info('Handling projectAction:', {
                        action: message.action,
                        nodeId: message.nodeId,
                        data: message.data
                    });

                    // Handle addFile and addFolder specially - create temporary node in edit mode or create actual file/folder
                    if (message.action === 'addFile') {
                        if (message.data?.isConfirmed && message.data?.name) {
                            await this._handleCreateFileAction(message.nodeId, message.data.name);
                        } else {
                            await this._handleAddFileAction(message.nodeId);
                        }
                    } else if (message.action === 'addFolder') {
                        if (message.data?.isConfirmed && message.data?.name) {
                            await this._handleCreateFolderAction(message.nodeId, message.data.name);
                        } else {
                            await this._handleAddFolderAction(message.nodeId);
                        }
                    } else {
                        await SolutionActionService.handleProjectAction(message.action, message.nodeId!, message.data);

                        // Trigger the same file change handling that the file watcher would do for operations that modify the .sln file
                        const solutionFileOperations = ['addSolutionFolder', 'removeSolutionFolder', 'addSolutionItem', 'removeSolutionItem'];
                        if (solutionFileOperations.includes(message.action)) {
                            const solution = SolutionService.getActiveSolution();
                            if (solution) {
                                log.info(`Triggering immediate file change handling after ${message.action} operation`);
                                this.handleFileChange(solution.solutionPath, 'changed');
                            }
                        }

                        // Trigger immediate tree refresh for file/folder operations that affect the filesystem
                        const operationsThatAffectTree = ['deleteFile', 'rename', 'removeProject', 'deleteProject'];
                        if (operationsThatAffectTree.includes(message.action)) {
                            const projectPath = NodeIdService.getPathFromId(message.nodeId!);
                            if (!projectPath) {
                                log.error('Invalid node ID, cannot extract path for immediate refresh:', message.nodeId);
                                return;
                            }
                            const fileName = path.basename(projectPath);
                            await this._triggerImmediateTreeRefresh(`${message.action} operation: ${fileName}`);
                        }
                    }
                }
                break;

            case 'openFile':
                log.info('Handling direct openFile request:', message.projectPath);
                if (message.projectPath) {
                    const uri = vscode.Uri.file(message.projectPath);
                    await vscode.window.showTextDocument(uri);
                }
                break;

            case 'expandNode':
                if (message.nodeId && message.nodeType) {
                    log.info('Handling expandNode request:', message.nodeId, message.nodeType);
                    await SolutionExpansionService.handleExpandNode(
                        message.nodeId!,
                        message.nodeType,
                        this._cachedSolutionData || null,
                        () => this._sendCachedData(),
                        this._context
                    );
                }
                break;

            case 'collapseNode':
                if (message.nodeId) {
                    log.info('Handling collapseNode request:', message.nodeId);
                    await SolutionExpansionService.handleCollapseNode(
                        message.nodeId!,
                        this._cachedSolutionData || null,
                        () => this._sendCachedData(),
                        this._context
                    );
                }
                break;

            default:
                log.info('Unknown message command:', message.command);
        }
    }

    private async _getSolutionData(): Promise<ExtensionProjectNode[]> {
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

            // Hide loading bar
            this._view.webview.postMessage({
                command: 'hideLoading'
            });

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
                this._view?.webview.postMessage({
                    command: 'solutionData',
                    projects: [],
                    frameworks: []
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
    private async _sendSolutionData(projects: ExtensionProjectNode[]): Promise<void> {

        if (!this._view) {
            return;
        }

        // Get frameworks for complete update
        const frameworks = await this._frameworkService.getAvailableFrameworks();
        const activeFramework = this._frameworkService.getActiveFramework();

        // Convert extension nodes to webview nodes
        const webviewProjects = this.extensionToWebviewNodes(projects);

        const data: WebviewSolutionData = {
            projects: webviewProjects,
            frameworks: frameworks || [],
            activeFramework
        };
        this._view.webview.postMessage({
            command: 'solutionData',
            data
        });
    }

    /**
     * Handles the addFile action by creating a temporary node in edit mode
     */
    private async _handleAddFileAction(parentNodeId: NodeIdString): Promise<void> {
        try {
            const parentPath = NodeIdService.nodeIdToPath(parentNodeId);
            if (!parentPath) {
                log.error('Invalid parent node ID, cannot extract path:', parentNodeId);
                vscode.window.showErrorMessage(`Error adding file: invalid parent path`);
                return;
            }

            log.info(`Creating temporary file node for parent: ${parentPath}`);

            // Send a message to the webview to create a temporary node in edit mode
            this._view?.webview.postMessage({
                command: 'addTemporaryNode',
                parentNodeId,
                nodeType: 'file',
                defaultName: 'newfile.cs'
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
            const parentPath = NodeIdService.nodeIdToPath(parentNodeId);
            if (!parentPath) {
                log.error('Invalid parent node ID, cannot extract path:', parentNodeId);
                vscode.window.showErrorMessage(`Error adding folder: invalid parent path`);
                return;
            }

            log.info(`Creating temporary folder node for parent: ${parentPath}`);

            // Send a message to the webview to create a temporary node in edit mode
            this._view?.webview.postMessage({
                command: 'addTemporaryNode',
                parentNodeId,
                nodeType: 'folder',
                defaultName: 'NewFolder'
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
            this._view?.webview.postMessage({
                command: 'removeTemporaryNodes',
                parentPath: parentPath
            });

            // Ensure parent folder stays expanded by adding it to expansion state AFTER refresh
            if (projectPath) {
                const parentNodeId = NodeIdService.generateFolderId(parentPath, projectPath);
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
            this._view?.webview.postMessage({
                command: 'removeTemporaryNodes',
                parentPath: parentPath
            });

            // Trigger immediate tree refresh
            await this._triggerImmediateTreeRefresh(`folder creation: ${folderName}`);

            // Ensure parent folder stays expanded by adding it to expansion state AFTER refresh
            if (projectPath) {
                const parentNodeId = NodeIdService.generateFolderId(parentPath, projectPath);
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
     * Convert extension ProjectNode to webview ProjectNode
     */
    private extensionToWebviewNode(node: ExtensionProjectNode): WebviewProjectNode {
        return {
            ...node,
            nodeId: NodeIdService.toKey(node.nodeId), // Convert NodeIdString to string
            children: node.children ? node.children.map(child => this.extensionToWebviewNode(child)) : undefined
        };
    }

    /**
     * Convert extension ProjectNode array to webview ProjectNode array
     */
    private extensionToWebviewNodes(nodes: ExtensionProjectNode[]): WebviewProjectNode[] {
        return nodes.map(node => this.extensionToWebviewNode(node));
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        if (this._solutionChangeListener) {
            this._solutionChangeListener.dispose();
            this._solutionChangeListener = undefined;
        }
    }
}