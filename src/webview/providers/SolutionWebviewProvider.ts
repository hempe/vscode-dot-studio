import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionService } from '../../services/solutionService';
import { SolutionTreeService } from '../../services/solutionTreeService';
import { SolutionActionService } from '../../services/solutionActionService';
import { SolutionExpansionService } from '../../services/solutionExpansionService';
import { SolutionExpansionIdService } from '../../services/solutionExpansionIdService';
import { FrameworkDropdownService } from '../../services/frameworkDropdownService';
import { NodeType, ProjectActionType, ProjectNode, SolutionData } from '../solution-view/types';
import { Solution } from '../../core/Solution';
import { ProjectFileNode } from '../../core/Project';
import { logger } from '../../core/logger';
import { SolutionWebView } from './views/SolutionWebview';

const log = logger('SolutionWebviewProvider');

interface FileChangeEvent {
    filePath: string;
    changeType: 'created' | 'changed' | 'deleted';
    timestamp: number;
}

interface WebviewMessage {
    command: string;
    framework?: string;
    action?: ProjectActionType;
    projectPath?: string;
    data?: MessageData;
    expandedNodes?: string[];
    nodeId?: string;
    nodeType?: string;
}

interface MessageData {
    type?: string;
    oldName?: string;
    newName?: string;
    name?: string;
}

export class SolutionWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'dotnet-solution-webview';

    private _view?: vscode.WebviewView;
    private _isRenaming: boolean = false;
    private _currentSolutionPath?: string;
    private _isInitialized: boolean = false;
    private _fileChangeQueue: FileChangeEvent[] = [];
    private _isProcessingQueue: boolean = false;

    // Cache for solution tree data to improve expand performance
    private _cachedSolutionData?: ProjectNode[];
    private _cacheTimestamp?: number;
    private readonly _cacheTimeout = 30000; // 30 seconds cache

    // Protection against external state resets
    private _lastUpdateTimestamp?: number;
    private _rapidUpdateCount = 0;
    private _protectedExpansionState?: string[];
    private readonly _rapidUpdateThreshold = 3; // Max 3 updates in 2 seconds
    private readonly _rapidUpdateWindow = 2000; // 2 seconds

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext,
        private readonly _frameworkService: FrameworkDropdownService
    ) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
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

        // Send initial data when webview is ready (only if not already initialized)
        if (!this._isInitialized) {
            log.info('First time initialization');
            this._updateWebview();
            this._isInitialized = true;
        } else {
            log.info('Webview reconnected, sending current data');
            // Just send current data without full reload if we're already initialized
            this._sendCurrentData();
        }
    }

    private async _handleMessage(message: WebviewMessage) {
        log.info('Received message:', message);

        switch (message.command) {
            case 'getSolutionData':
                log.info('Handling getSolutionData request');
                await this._sendCurrentData();
                break;

            case 'setFramework':
                log.info('Handling setFramework request:', message.framework);
                await this._frameworkService.setActiveFramework(message.framework);
                break;

            case 'projectAction':
                if (message.action && message.projectPath) {
                    log.info('Handling projectAction:', {
                        action: message.action,
                        projectPath: message.projectPath,
                        data: message.data
                    });
                    await SolutionActionService.handleProjectAction(message.action, message.projectPath, message.data);
                }
                break;

            case 'openFile':
                log.info('Handling direct openFile request:', message.projectPath);
                if (message.projectPath) {
                    const uri = vscode.Uri.file(message.projectPath);
                    await vscode.window.showTextDocument(uri);
                }
                break;

            case 'saveExpansionState':
                if (message.expandedNodes) {
                    log.info('Handling saveExpansionState request:', message.expandedNodes);
                    SolutionExpansionService.saveExpansionState(message.expandedNodes, this._context);
                }
                break;

            case 'expandNode':
                if (message.nodeId && message.nodeType) {
                    log.info('Handling expandNode request:', message.nodeId, message.nodeType);
                    await SolutionExpansionService.handleExpandNode(
                        message.nodeId,
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
                        message.nodeId,
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

    private async _handleRename(oldPath: string, newName: string, oldName: string, nodeType: NodeType) {
        try {
            log.info(`Attempting to rename ${nodeType} from "${oldName}" to "${newName}"`);

            // Set flag to prevent file watcher from triggering refresh
            this._isRenaming = true;

            if (nodeType === 'solutionFolder') {
                // Solution folders are virtual - rename in the .sln file, not filesystem
                await this._handleSolutionFolderRename(oldName, newName);
                return;
            }

            const path = require('path');
            const fs = require('fs').promises;

            // Calculate new path
            const directory = path.dirname(oldPath);
            const originalExtension = path.extname(oldPath);

            // For files and solutions, check if user included extension in newName
            let finalNewName = newName;
            if (nodeType === 'file' || nodeType === 'solution') {
                const userProvidedExtension = path.extname(newName);
                if (!userProvidedExtension && originalExtension) {
                    // User didn't provide extension, add the original one
                    finalNewName = newName + originalExtension;
                }
                // If user provided extension, use newName as-is
            }

            const newPath = path.join(directory, finalNewName);

            log.info(`Renaming path: ${oldPath} -> ${newPath}`);

            // Use VS Code's workspace API to rename the file/folder
            const oldUri = vscode.Uri.file(oldPath);
            const newUri = vscode.Uri.file(newPath);

            const edit = new vscode.WorkspaceEdit();
            edit.renameFile(oldUri, newUri);

            const success = await vscode.workspace.applyEdit(edit);

            if (success) {
                log.info(`Successfully renamed ${oldName} to ${newName}`);
                // Send a targeted update instead of full refresh to preserve tree state
                this._view?.webview.postMessage({
                    command: 'nodeRenamed',
                    oldPath: oldPath,
                    newPath: newPath,
                    newName: path.basename(finalNewName)
                });
            } else {
                log.error(`Failed to rename ${oldName} to ${newName}`);
                vscode.window.showErrorMessage(`Failed to rename ${oldName} to ${newName}`);
            }
        } catch (error) {
            log.error(`Error during rename:`, error);
            vscode.window.showErrorMessage(`Error renaming file: ${error}`);
        } finally {
            // Clear the flag and allow refreshes again after a short delay
            setTimeout(() => {
                this._isRenaming = false;
                log.info('Rename operation completed, refreshes allowed again');
            }, 1000); // 1 second delay to allow file system events to settle
        }
    }

    private async _handleSolutionFolderRename(oldName: string, newName: string) {
        try {
            log.info(`Renaming solution folder from "${oldName}" to "${newName}"`);

            // Get the active solution
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                throw new Error('No active solution loaded');
            }

            // Rename the solution folder - file watcher will handle UI updates
            await solution.renameSolutionFolder(oldName, newName);
            vscode.window.showInformationMessage(`Renamed solution folder "${oldName}" to "${newName}"`);

        } catch (error) {
            log.error(`Error renaming solution folder:`, error);
            vscode.window.showErrorMessage(`Error renaming solution folder: ${error}`);
        }
    }








    /**
     * Recursively updates a node in the tree
     */

    /**
     * Gets all expanded node paths from the tree
     */
    private getExpandedNodePaths(nodes: ProjectNode[]): string[] {
        const expandedPaths: string[] = [];

        const traverse = (nodeList: ProjectNode[]) => {
            for (const node of nodeList) {
                if (node.expanded) {
                    expandedPaths.push(node.path);
                }
                if (node.children) {
                    traverse(node.children);
                }
            }
        };

        traverse(nodes);
        return expandedPaths;
    }

    /**
     * Sends the complete current tree state to the webview
     */
    private async _sendCompleteTreeUpdate(): Promise<void> {
        log.debug('Sending complete tree update');

        if (!this._view) {
            return;
        }

        try {
            // Get fresh solution data but preserve expansion and loading states from cache
            const freshSolutionData = await this._getSolutionData();

            if (this._cachedSolutionData && freshSolutionData) {
                // Merge the expansion/loading states from cache with fresh data
                SolutionTreeService.mergeTreeStates(freshSolutionData, this._cachedSolutionData);

                // After merging states, restore expansion states to actually load children for expanded nodes
                await SolutionExpansionService.restoreExpansionStates(freshSolutionData, this._context);

                // Re-expand dependency nodes that were marked for re-expansion
                // Note: This uses fresh solution data which should have updated dependencies
                await this._reExpandMarkedDependencyNodes(freshSolutionData);
            } else if (freshSolutionData) {
                // No cached data (cache was cleared), restore from workspace storage
                await SolutionExpansionService.restoreExpansionStates(freshSolutionData, this._context);
            }

            // Update cache with the merged data
            this._cachedSolutionData = freshSolutionData;
            this._cacheTimestamp = Date.now();

            // Get frameworks for complete update
            const frameworks = await this._frameworkService.getAvailableFrameworks();
            const activeFramework = this._frameworkService.getActiveFramework();

            log.info('Sending solutionDataUpdate message with', freshSolutionData?.length || 0, 'projects');
            this._view.webview.postMessage({
                command: 'solutionDataUpdate',
                data: {
                    projects: freshSolutionData || [],
                    frameworks: frameworks,
                    activeFramework: activeFramework
                }
            });

        } catch (error) {
            log.error('Error sending complete tree update:', error);
        }
    }

    /**
     * Merges expansion and loading states from cached tree into fresh tree
     */



    /**
     * Unified method to restore expansion states with flexible options
     */
    private async _restoreExpansionStates(
        treeData: ProjectNode[],
        options: {
            expansionPaths?: string[]; // Use specific paths instead of workspace storage
            parentPath?: string;       // Filter to children of this parent only
            updateCache?: boolean;     // Whether to update cache (default true)
        } = {}
    ): Promise<void> {
        try {
            // Determine source of expansion paths
            let expansionPaths: string[];
            if (options.expansionPaths) {
                expansionPaths = options.expansionPaths;
                log.debug('Restoring specific expansion states:', expansionPaths.length, 'paths');
            } else {
                expansionPaths = this.getExpansionState();
                log.debug('Restoring expansion states:', expansionPaths.length, 'paths');
            }

            if (!expansionPaths || expansionPaths.length === 0) {
                log.info('No expansion paths to restore');
                return;
            }

            // Filter by parent path if specified
            if (options.parentPath) {
                expansionPaths = expansionPaths.filter(path =>
                    path.startsWith(options.parentPath!) && path !== options.parentPath
                );
                log.info(`Filtered to ${expansionPaths.length} nested paths under: ${options.parentPath}`);
            }

            // CONSERVATIVE APPROACH: Preserve ALL expansion state
            // Only remove expansion state on explicit user collapse, never on reload
            // Dependencies nodes are virtual and lazy-loaded, so they won't exist in initial tree
            const cleanedExpandedNodes = expansionPaths;

            // Restore expansion states and load children
            for (const expandedPath of cleanedExpandedNodes) {
                const nodeType = SolutionTreeService.getNodeTypeById(expandedPath, treeData);
                if (nodeType) {
                    log.info(`Restoring expansion for: ${expandedPath} (${nodeType})`);

                    // Set expanded = true in the tree
                    SolutionTreeService.updateNodeInTree(treeData, expandedPath, { expanded: true });

                    // Load children for the expanded node
                    await this._loadChildrenForNode(expandedPath, nodeType, treeData);
                } else {
                    // Node doesn't exist in current tree (like Dependencies nodes - they're lazy-loaded)
                    // This is expected for virtual nodes, preserve their expansion state
                    log.debug(`Node not found in current tree: ${expandedPath} - expansion state preserved for future restoration`);
                }
            }

            // Update cache if requested (default true)
            if (options.updateCache !== false) {
                this._cachedSolutionData = treeData;
                this._cacheTimestamp = Date.now();
            }

        } catch (error) {
            log.error('Error restoring expansion states:', error);
        }
    }

    /**
     * Finds a specific node in the tree by path
     */
    private _findNodeInTree(nodes: ProjectNode[], targetPath: string): ProjectNode | undefined {
        for (const node of nodes) {
            if (node.path === targetPath) {
                return node;
            }
            if (node.children) {
                const found = this._findNodeInTree(node.children, targetPath);
                if (found) return found;
            }
        }
        return undefined;
    }

    /**
     * Refreshes expanded folders to catch file system changes while preserving expansion state
     */
    private async _refreshExpandedFolders(children: ProjectNode[], project: any): Promise<void> {
        for (const child of children) {
            if (child.type === 'folder' && child.expanded && child.children) {
                log.info(`Refreshing expanded folder: ${child.path}`);
                try {
                    // Get fresh folder contents
                    const folderChildren = await project.getFolderChildren(child.path);
                    const freshChildren = SolutionTreeService.convertProjectChildrenToProjectNodes(folderChildren);

                    // Merge with existing children to preserve nested expansion states
                    child.children = this._mergeChildrenArrays(child.children, freshChildren);

                    // Recursively refresh nested expanded folders
                    await this._refreshExpandedFolders(child.children, project);
                } catch (error) {
                    log.warn(`Error refreshing folder ${child.path}:`, error);
                }
            }
        }
    }

    /**
     * Merges existing children with fresh children, preserving expansion states
     */
    private _mergeChildrenArrays(existingChildren: ProjectNode[], freshChildren: ProjectNode[]): ProjectNode[] {
        const result: ProjectNode[] = [];
        const existingMap = new Map<string, ProjectNode>();

        // Build map of existing children by path
        for (const child of existingChildren) {
            existingMap.set(child.path, child);
        }

        // Merge fresh children with existing expansion states
        for (const freshChild of freshChildren) {
            const existing = existingMap.get(freshChild.path);
            if (existing) {
                // Keep expansion state and children from existing node
                result.push({
                    ...freshChild,
                    expanded: existing.expanded,
                    children: existing.children,
                    isLoaded: existing.isLoaded
                });
            } else {
                // New child, use fresh data
                result.push(freshChild);
            }
        }

        return result;
    }

    /**
     * Gets all valid paths from the tree structure
     */


    /**
     * Gets the node type for a given path from the tree
     */

    /**
     * Loads children for a specific node during restoration
     */
    private async _loadChildrenForNode(nodeId: string, nodeType: string, treeData: ProjectNode[]): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                return;
            }

            let children: ProjectNode[] = [];

            if (nodeType === 'solution') {
                // Solution children are already loaded in the initial tree
                return;
            } else if (nodeType === 'project') {
                // Extract actual project path from nodeId
                const projectPath = SolutionExpansionIdService.getPathFromId(nodeId);
                if (projectPath) {
                    const project = solution.getProject(projectPath);
                    if (project) {
                        const rootChildren = await project.getRootChildren();
                        children = SolutionTreeService.convertProjectChildrenToProjectNodes(rootChildren);
                    }
                }
            } else if (nodeType === 'dependencies') {
                // Extract project path from dependencies nodeId
                const projectPath = SolutionExpansionIdService.getProjectPathFromDependencyId(nodeId);
                if (projectPath) {
                    const project = solution.getProject(projectPath);
                    if (project) {
                        const dependencies = project.getDependencies();
                        children = SolutionTreeService.convertProjectChildrenToProjectNodes(dependencies);
                    }
                }
            } else if (nodeType === 'folder') {
                // Extract actual folder path from nodeId
                const folderPath = SolutionExpansionIdService.nodeIdToPath(nodeId);
                if (folderPath) {
                    const projectPath = SolutionTreeService.findProjectPathForFolder(folderPath);
                    if (projectPath) {
                        const project = solution.getProject(projectPath);
                        if (project) {
                            const folderChildren = await project.getFolderChildren(folderPath);
                            children = SolutionTreeService.convertProjectChildrenToProjectNodes(folderChildren);
                        }
                    }
                }
            }

            if (children.length > 0) {
                // Update the node in the tree with its children
                SolutionTreeService.updateNodeInTree(treeData, nodeId, {
                    children,
                    hasChildren: true,
                    isLoaded: true
                });

                // Create folder watcher for restored expanded folders
                if (nodeType === 'folder') {
                    const solution = SolutionService.getActiveSolution();
                    const folderPath = SolutionExpansionIdService.nodeIdToPath(nodeId);
                    if (solution && folderPath) {
                        const projectPath = SolutionTreeService.findProjectPathForFolder(folderPath);
                        if (projectPath) {
                            const project = solution.getProject(projectPath);
                            if (project) {
                                log.info(`Creating folder watcher for restored folder: ${folderPath}`);
                                project.createFolderWatcher(folderPath);
                            }
                        }
                    }
                } else if (nodeType === 'project') {
                    const solution = SolutionService.getActiveSolution();
                    const projectPath = SolutionExpansionIdService.getPathFromId(nodeId);
                    if (solution && projectPath) {
                        const project = solution.getProject(projectPath);
                        if (project) {
                            const projectDir = require('path').dirname(projectPath);
                            log.info(`Creating folder watcher for restored project: ${projectDir}`);
                            project.createFolderWatcher(projectDir);
                        }
                    }
                }
            }

        } catch (error) {
            log.error(`Error loading children for ${nodeId}:`, error);
        }
    }

    private _convertProjectFileNodesToProjectNodes(fileNodes: ProjectFileNode[]): ProjectNode[] {
        return fileNodes.map(fileNode => ({
            type: fileNode.type === 'folder' ? 'folder' : 'file',
            name: fileNode.name,
            path: fileNode.path,
            nodeId: fileNode.path, // Use path as expansion ID for file nodes
            children: fileNode.children ? this._convertProjectFileNodesToProjectNodes(fileNode.children) : undefined,
            isLoaded: fileNode.isLoaded,
            hasChildren: fileNode.type === 'folder' && !fileNode.isLoaded
        }));
    }

    /**
     * Converts Project class output format to ProjectNode format for the webview
     */

    /**
     * Helper method to remove project from solution using dotnet CLI
     * TODO: Move this to SolutionManager class
     */
    private async _removeProjectFromSolution(solutionPath: string, projectPath: string): Promise<boolean> {
        try {
            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);

            await execAsync(`dotnet sln "${solutionPath}" remove "${projectPath}"`);
            return true;
        } catch (error) {
            log.error('Error removing project from solution:', error);
            return false;
        }
    }

    private async _updateWebview() {
        if (!this._view) {
            log.info('No webview available, skipping update');
            return;
        }

        // Check for rapid updates that might be caused by external extensions
        const now = Date.now();
        if (this._lastUpdateTimestamp && (now - this._lastUpdateTimestamp) < this._rapidUpdateWindow) {
            this._rapidUpdateCount++;
            log.info(`Rapid update detected (${this._rapidUpdateCount}/${this._rapidUpdateThreshold})`);
        } else {
            this._rapidUpdateCount = 1;
        }
        this._lastUpdateTimestamp = now;

        // If we detect rapid updates, preserve the current expansion state
        if (this._rapidUpdateCount >= this._rapidUpdateThreshold && this._cachedSolutionData) {
            log.info('RAPID UPDATES DETECTED - Preserving current expansion state');
            this._protectedExpansionState = this.getExpandedNodePaths(this._cachedSolutionData);
        } else {
            log.debug('Manual operation detected - skipping rapid update protection');
        }

        try {
            // Show loading bar in webview
            this._view?.webview.postMessage({
                command: 'showLoading',
                message: 'Loading solution...'
            });

            // Load data asynchronously to prevent blocking
            log.info('Loading solution data and frameworks...');

            const [solutionData, frameworks] = await Promise.all([
                this._getSolutionData(),
                this._frameworkService.getAvailableFrameworks()
            ]);

            const activeFramework = this._frameworkService.getActiveFramework();

            log.info('Loaded data:', {
                projectCount: solutionData.length,
                frameworkCount: frameworks?.length || 0,
                activeFramework
            });

            log.info('Sending solution data to webview');
            const data: SolutionData = {
                projects: solutionData,
                frameworks: frameworks || [],
                activeFramework
            }

            log.info('Sending solutionData message with', data.projects?.length || 0, 'projects');
            this._view?.webview.postMessage({
                command: 'solutionData',
                data
            });

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
    }

    private async _getSolutionData(): Promise<ProjectNode[]> {
        log.info('Getting solution data...');

        // Check cache first for better expand performance
        const now = Date.now();
        if (this._cachedSolutionData &&
            this._cacheTimestamp &&
            (now - this._cacheTimestamp) < this._cacheTimeout) {
            log.info('Using cached solution data');
            return this._cachedSolutionData;
        }

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        log.info('Workspace root:', workspaceRoot);

        // CRITICAL FIX: Don't dispose the active solution unnecessarily
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

        // Store the current solution path for later use
        this._currentSolutionPath = solution.solutionPath;

        // Get solution file data
        const solutionData = solution.solutionFile;
        if (!solutionData) {
            log.info('Failed to get solution data');
            return [];
        }

        log.info('Got solution data:', solutionData);

        this._frameworkService.setSolution(solution.solutionPath, solutionData);

        // Convert solution data to tree structure for the React component
        const treeStructure = await this._convertToTreeStructureWithLazyLoading(solution);

        // Check if we should use protected expansion state due to rapid updates
        if (this._protectedExpansionState) {
            log.info('Using PROTECTED expansion state due to rapid updates');
            await this._restoreExpansionStates(treeStructure, { expansionPaths: this._protectedExpansionState });
            // Clear the protected state after one use
            this._protectedExpansionState = undefined;
        } else {
            // Restore expansion states if this is initial load (this modifies solutionData in place)
            log.info('About to restore expansion states...');
            await this._restoreExpansionStates(treeStructure);
            log.info('Finished restoring expansion states');
        }

        return treeStructure;
    }

    private async _convertToTreeStructureWithLazyLoading(solution: Solution): Promise<ProjectNode[]> {
        if (!solution.solutionFile) return [];

        // Use the tree service to build the solution tree
        const result = await SolutionTreeService.buildSolutionTree(solution);

        // Cache the result for faster subsequent calls
        this._cachedSolutionData = result;
        this._cacheTimestamp = Date.now();
        log.info('Cached solution data');

        return result;
    }

    /**
     * Clear cached solution data when solution changes
     */
    private _clearCache() {
        this._cachedSolutionData = undefined;
        this._cacheTimestamp = undefined;
        log.info('Cache cleared');
    }







    public refresh() {
        log.debug('Refresh called');

        // Don't refresh if we're in the middle of a rename operation
        if (this._isRenaming) {
            log.debug('Skipping refresh during rename operation');
            return;
        }


        // Use incremental update instead of full refresh
        this._updateWebview();
    }

    private saveExpansionState(expandedNodes: string[]) {
        log.debug('Saving expansion state to workspace:', expandedNodes.length, 'nodes');
        log.debug('Expansion paths:', expandedNodes);
        this._context.workspaceState.update('solutionTreeExpanded', expandedNodes);
    }


    /**
     * Dispose method to clean up resources
     */
    dispose(): void {
        // No cleanup needed currently
    }

    private getExpansionState(): string[] {
        const state = this._context.workspaceState.get('solutionTreeExpanded', []);
        log.debug('Retrieved expansion state from workspace:', state.length, 'nodes');
        if (state.length > 0) {
            log.debug('Restored expansion paths:', state);
        }
        return state;
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
            return this._updateWebview();
        }

        try {
            const frameworks = await this._frameworkService.getAvailableFrameworks();
            const activeFramework = this._frameworkService.getActiveFramework();

            const data: SolutionData = {
                projects: this._cachedSolutionData,
                frameworks: frameworks || [],
                activeFramework
            };

            log.info('Sending cached solutionData with', data.projects?.length || 0, 'projects');
            this._view.webview.postMessage({
                command: 'solutionData',
                data
            });

            // Hide loading bar
            this._view.webview.postMessage({
                command: 'hideLoading'
            });

        } catch (error) {
            log.error('Error sending cached data:', error);
            // Fallback to full update on error
            this._updateWebview();
        }
    }

    private async _sendCurrentData() {
        log.debug('Sending current data to webview');

        if (!this._view) {
            log.info('No webview available, skipping send');
            return;
        }

        try {
            log.info('Rebuilding solution data for reconnection');
            const solutionData = await this._getSolutionData();
            const frameworks = await this._frameworkService.getAvailableFrameworks();

            const data: SolutionData = {
                projects: solutionData,
                frameworks: frameworks,
                activeFramework: this._frameworkService.getActiveFramework()
            };

            log.info('Sending solutionData to reconnected webview with', data.projects?.length || 0, 'projects');
            this._view.webview.postMessage({
                command: 'solutionData',
                data: data
            });

        } catch (error) {
            log.error('Error sending current data:', error);
            // Fallback to full update on error
            this._updateWebview();
        }
    }

    public async handleProjectAdded(projectPath: string) {
        log.debug(`Project added via file watcher: ${projectPath}`);
        this._updateWebview(); // Simple full refresh
    }

    public handleProjectRemoved(projectPath: string) {
        log.debug(`Project removed via file watcher: ${projectPath}`);
        this._updateWebview(); // Simple full refresh
    }

    public handleFileChange(filePath: string, changeType: 'created' | 'changed' | 'deleted') {
        log.debug(`Queueing file ${changeType}: ${filePath}`);


        // Check if we already have a event for this file to avoid duplicates
        const existingEventIndex = this._fileChangeQueue.findIndex(event =>
            event.filePath === filePath &&
            event.changeType === changeType
        );

        if (existingEventIndex >= 0) {
            log.info(`Ignoring duplicate file change event for: ${filePath}`);
            return;
        }

        // Add to queue with timestamp
        this._fileChangeQueue.push({
            filePath,
            changeType,
            timestamp: Date.now()
        });

        // Process queue if not already processing
        this._processFileChangeQueue();
    }

    private async _processFileChangeQueue() {
        if (this._isProcessingQueue || this._fileChangeQueue.length === 0) {
            return;
        }

        this._isProcessingQueue = true;

        try {
            // Process all queued changes
            while (this._fileChangeQueue.length > 0) {
                const event = this._fileChangeQueue.shift()!;
                log.info(`Processing queued file ${event.changeType}: ${event.filePath}`);

                // Add small delay between processing events to prevent race conditions
                await new Promise(resolve => setTimeout(resolve, 50));

                await this._handleSingleFileChange(event.filePath, event.changeType);
            }
        } finally {
            this._isProcessingQueue = false;
        }
    }

    private async _handleSingleFileChange(filePath: string, changeType: 'created' | 'changed' | 'deleted') {
        const fileName = path.basename(filePath);

        // Handle different types of file changes
        if (fileName.endsWith('.sln')) {
            log.debug(`Solution file ${changeType}: ${filePath}`);
            if (changeType === 'deleted') {
                // Solution file was deleted - clear everything
                this._view?.webview.postMessage({
                    command: 'solutionDataUpdate',
                    projects: [],
                    frameworks: []
                });
            } else {
                this._clearCache(); // Clear cached data so fresh data is loaded
                this._updateWebview(); // Simple full refresh
            }
        } else if (fileName.endsWith('.csproj') || fileName.endsWith('.vbproj') || fileName.endsWith('.fsproj')) {
            // Project file changes
            if (changeType === 'created') {
                log.debug(`Project file created: ${filePath}`);
                await this.handleProjectAdded(filePath);
            } else if (changeType === 'deleted') {
                log.debug(`Project file deleted: ${filePath}`);
                this.handleProjectRemoved(filePath);
            } else {
                log.debug(`Project file content changed: ${fileName}`);
                // Clear cache to ensure fresh dependency data is loaded from disk
                this._clearCache();
                this._sendCompleteTreeUpdate(); // Full refresh with expansion state preservation
            }
        } else {
            // All other files - use simple full refresh
            log.debug(`File ${changeType}: ${fileName}`);
            this._updateWebview(); // Simple full refresh
        }
    }

    /**
     * Re-expands dependency nodes that were marked for re-expansion during merge
     */
    private async _reExpandMarkedDependencyNodes(treeData: ProjectNode[]): Promise<void> {
        const solution = SolutionService.getActiveSolution();
        if (!solution) {
            return;
        }

        const processNodes = async (nodes: ProjectNode[]): Promise<void> => {
            for (const node of nodes) {
                // Check if this is a dependency node marked for re-expansion
                if ((node.type === 'dependencies' || node.type === 'dependencyCategory') &&
                    node.expanded && !node.isLoaded && !node.children) {

                    log.info(`Re-expanding ${node.type} node: ${node.path}`);

                    try {
                        let children: ProjectNode[] = [];

                        if (node.type === 'dependencies') {
                            // Get dependency categories
                            const projectPath = node.path.replace('/dependencies', '');
                            const project = solution.getProject(projectPath);
                            if (project) {
                                const dependencies = project.getDependencies();
                                children = SolutionTreeService.convertProjectChildrenToProjectNodes(dependencies);
                            }
                        } else if (node.type === 'dependencyCategory') {
                            // Get individual dependencies for this category
                            const projectPath = node.path.replace(/\/dependencies\/.*$/, '');
                            const project = solution.getProject(projectPath);
                            if (project) {
                                const categoryDependencies = project.getDependenciesByCategory(node.path);
                                children = SolutionTreeService.convertProjectChildrenToProjectNodes(categoryDependencies);
                            }
                        }

                        if (children.length > 0) {
                            node.children = children;
                            node.isLoaded = true;
                            log.info(`Successfully re-expanded ${node.type} node: ${node.path} with ${children.length} children`);
                        }
                    } catch (error) {
                        log.error(`Error re-expanding ${node.type} node ${node.path}:`, error);
                    }
                }

                // Recursively process children
                if (node.children) {
                    await processNodes(node.children);
                }
            }
        };

        await processNodes(treeData);
    }
}