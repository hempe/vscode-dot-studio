import * as vscode from 'vscode';
import { logger } from '../core/logger';
import { SolutionService } from './solutionService';
import { SolutionTreeService } from './solutionTreeService';
import { ProjectNode } from '../webview/solution-view/types';

/**
 * Service responsible for handling node expansion/collapse operations
 * Extracted from SolutionWebviewProvider to improve maintainability
 */
export class SolutionExpansionService {
    private static readonly logger = logger('SolutionExpansionService');

    /**
     * Handles expanding a node in the solution tree
     */
    static async handleExpandNode(
        nodePath: string,
        nodeType: string,
        cachedSolutionData: ProjectNode[] | null,
        updateWebviewCallback: () => Promise<void>,
        context: vscode.ExtensionContext
    ): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                this.logger.warn('No active solution for expand operation');
                return;
            }

            // First, set loading state and send updated tree
            await this._updateNodeExpansionState(nodePath, true, undefined, cachedSolutionData, true);
            await updateWebviewCallback();

            let children: ProjectNode[] = [];

            if (nodeType === 'solution') {
                // Solution is always expanded when loaded, but check if we need to restore state
                const existingNode = SolutionTreeService.findNodeByPath(nodePath, cachedSolutionData || []);
                if (existingNode?.children) {
                    this.logger.info(`Re-expanding solution node: ${nodePath}`);

                    // Restore expansion states for all projects
                    for (const child of existingNode.children) {
                        if (child.type === 'project' && child.expanded) {
                            const project = solution.getProject(child.path);
                            if (project) {
                                // Refresh any expanded folders to catch file system changes
                                await this._refreshExpandedFolders(child.children || [], project);
                            }
                        }
                    }
                }
            } else if (nodeType === 'project') {
                // Expanding a project - check if we already have children with expansion state
                const existingNode = SolutionTreeService.findNodeByPath(nodePath, cachedSolutionData || []);
                const project = solution.getProject(nodePath);
                if (project) {
                    const rootChildren = await project.getRootChildren();
                    children = SolutionTreeService.convertProjectChildrenToProjectNodes(rootChildren);

                    if (existingNode?.children && existingNode.children.length > 0) {
                        // Merge with existing expansion states
                        children = this._mergeWithExistingExpansionStates(children, existingNode.children);

                        // Refresh any expanded folders to catch file system changes
                        await this._refreshExpandedFolders(children, project);
                    }

                    // Create lazy folder watcher for the project root directory
                    const projectDir = require('path').dirname(nodePath);
                    if (project.createFolderWatcher) {
                        project.createFolderWatcher(projectDir);
                    }
                }
            } else if (nodeType === 'dependencies') {
                // Expanding a Dependencies node - get the project and load its dependencies
                const projectPath = nodePath.replace('/dependencies', '');
                const project = solution.getProject(projectPath);
                if (project) {
                    const dependencies = project.getDependencies();
                    children = SolutionTreeService.convertProjectChildrenToProjectNodes(dependencies);
                }
            } else if (nodeType === 'folder') {
                // Expanding a folder within a project using the new Project methods
                const projectPath = SolutionTreeService.findProjectPathForFolder(nodePath);
                if (projectPath) {
                    const project = solution.getProject(projectPath);
                    if (project) {
                        const folderChildren = await project.getFolderChildren(nodePath);
                        children = SolutionTreeService.convertProjectChildrenToProjectNodes(folderChildren);

                        // Create lazy folder watcher for this expanded folder
                        if (project.createFolderWatcher) {
                            project.createFolderWatcher(nodePath);
                        }
                    }
                }
            } else if (nodeType === 'solutionFolder') {
                // Expanding a solution folder - get its children from the solution tree
                if (cachedSolutionData) {
                    const findSolutionFolder = (nodes: ProjectNode[], targetPath: string): ProjectNode | null => {
                        for (const node of nodes) {
                            if (node.path === targetPath && node.type === 'solutionFolder') {
                                return node;
                            }
                            if (node.children) {
                                const found = findSolutionFolder(node.children, targetPath);
                                if (found) return found;
                            }
                        }
                        return null;
                    };

                    const solutionFolderNode = findSolutionFolder(cachedSolutionData, nodePath);
                    if (solutionFolderNode?.children) {
                        children = solutionFolderNode.children;
                    }
                }
            }

            // Update backend state: set expanded = true and attach children
            await this._updateNodeExpansionState(nodePath, true, children, cachedSolutionData, false);

            // Update expansion state in persistent storage
            const expandedNodes = this.getExpandedNodePaths(cachedSolutionData || []);
            this.saveExpansionState(expandedNodes, context);

            await updateWebviewCallback();

        } catch (error) {
            this.logger.error('Error expanding node:', error);
            // Reset loading state on error
            await this._updateNodeExpansionState(nodePath, false, undefined, cachedSolutionData, false);
            await updateWebviewCallback();
        }
    }

    /**
     * Handles collapsing a node in the solution tree
     */
    static async handleCollapseNode(
        nodePath: string,
        cachedSolutionData: ProjectNode[] | null,
        updateWebviewCallback: () => Promise<void>,
        context: vscode.ExtensionContext
    ): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                this.logger.warn('No active solution for collapse operation');
                return;
            }

            // Find the project that contains this path and collapse it in the project state
            const projects = solution.getDotNetProjects();
            for (const project of projects) {
                if (nodePath.startsWith(require('path').dirname(project.projectPath))) {
                    project.collapseFolder(nodePath);

                    // Remove lazy folder watcher for this collapsed folder
                    // Note: This would need to be implemented in Project class
                    break;
                }
            }

            // Update backend state: set expanded = false (but preserve children for re-expansion)
            await this._updateNodeExpansionState(nodePath, false, undefined, cachedSolutionData, false);

            // Update expansion state in persistent storage
            const expandedNodes = this.getExpandedNodePaths(cachedSolutionData || []);
            this.saveExpansionState(expandedNodes, context);

            await updateWebviewCallback();

        } catch (error) {
            this.logger.error('Error collapsing node:', error);
        }
    }

    /**
     * Updates the expansion state of a node in the cached tree
     */
    private static async _updateNodeExpansionState(
        nodePath: string,
        expanded: boolean,
        children?: ProjectNode[],
        cachedSolutionData?: ProjectNode[] | null,
        isLoading: boolean = false
    ): Promise<void> {
        if (cachedSolutionData) {
            const updates: Partial<ProjectNode> = { expanded, isLoading: isLoading };
            if (children) {
                updates.children = children;
                updates.hasChildren = children.length > 0;
            }
            SolutionTreeService.updateNodeInTree(cachedSolutionData, nodePath, updates);
        }
    }

    /**
     * Gets all expanded node paths from the tree
     */
    static getExpandedNodePaths(nodes: ProjectNode[]): string[] {
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
     * Saves expansion state to workspace storage
     */
    static saveExpansionState(expandedNodes: string[], context: vscode.ExtensionContext): void {
        this.logger.debug('Saving expansion state to workspace:', expandedNodes.length, 'nodes');
        this.logger.debug('Expansion paths:', expandedNodes);
        context.workspaceState.update('solutionTreeExpanded', expandedNodes);
    }

    /**
     * Gets expansion state from workspace storage
     */
    static getExpansionState(context: vscode.ExtensionContext): string[] {
        const state = context.workspaceState.get<string[]>('solutionTreeExpanded', []);
        this.logger.debug('Retrieved expansion state from workspace:', state.length, 'nodes');
        return state;
    }

    /**
     * Restores expansion states for a tree
     */
    static async restoreExpansionStates(
        treeData: ProjectNode[],
        context: vscode.ExtensionContext,
        parentPath?: string,
        options: { updateCache?: boolean } = {}
    ): Promise<void> {
        try {
            // Get saved expansion paths from workspace state
            const expansionPaths = this.getExpansionState(context);

            if (!expansionPaths || expansionPaths.length === 0) {
                this.logger.debug('No expansion state to restore');
                return;
            }

            // Filter by parent path if specified
            let cleanedExpandedNodes = expansionPaths;
            if (parentPath) {
                cleanedExpandedNodes = expansionPaths.filter(path =>
                    path.startsWith(parentPath)
                );
            }

            // Get all valid paths from current tree and clean up stale ones
            const validPaths = SolutionTreeService.getAllValidPathsFromTree(treeData);
            cleanedExpandedNodes = cleanedExpandedNodes.filter(path =>
                validPaths.has(path)
            );

            // Restore expansion states and load children
            for (const expandedPath of cleanedExpandedNodes) {
                const nodeType = SolutionTreeService.getNodeTypeForPath(expandedPath, treeData);
                if (nodeType) {
                    this.logger.info(`Restoring expansion for: ${expandedPath} (${nodeType})`);

                    // Set expanded = true in the tree
                    SolutionTreeService.updateNodeInTree(treeData, expandedPath, { expanded: true });

                    // Load children for the expanded node
                    await this._loadChildrenForNode(expandedPath, nodeType, treeData);
                }
            }

        } catch (error) {
            this.logger.error('Error restoring expansion states:', error);
        }
    }

    /**
     * Refreshes expanded folders to catch file system changes while preserving expansion state
     */
    private static async _refreshExpandedFolders(children: ProjectNode[], project: any): Promise<void> {
        for (const child of children) {
            if (child.type === 'folder' && child.expanded && child.children) {
                this.logger.info(`Refreshing expanded folder: ${child.path}`);
                try {
                    // Get fresh folder contents
                    const folderChildren = await project.getFolderChildren(child.path);
                    const freshChildren = SolutionTreeService.convertProjectChildrenToProjectNodes(folderChildren);

                    // Merge with existing expansion states
                    child.children = this._mergeWithExistingExpansionStates(freshChildren, child.children);

                    // Recursively refresh nested expanded folders
                    await this._refreshExpandedFolders(child.children, project);
                } catch (error) {
                    this.logger.warn(`Failed to refresh expanded folder: ${child.path}`, error);
                }
            }
        }
    }

    /**
     * Merges fresh children with existing expansion states
     */
    private static _mergeWithExistingExpansionStates(freshChildren: ProjectNode[], existingChildren: ProjectNode[]): ProjectNode[] {
        const result: ProjectNode[] = [];

        for (const freshChild of freshChildren) {
            const existing = existingChildren.find(child =>
                child.path === freshChild.path && child.name === freshChild.name
            );

            if (existing) {
                // Preserve expansion state and children if expanded
                result.push({
                    ...freshChild,
                    expanded: existing.expanded,
                    children: existing.expanded && existing.children ? existing.children : freshChild.children
                });
            } else {
                result.push(freshChild);
            }
        }

        return result;
    }

    /**
     * Loads children for a specific node during restoration
     */
    private static async _loadChildrenForNode(nodePath: string, nodeType: string, treeData: ProjectNode[]): Promise<void> {
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
                const project = solution.getProject(nodePath);
                if (project) {
                    const rootChildren = await project.getRootChildren();
                    children = SolutionTreeService.convertProjectChildrenToProjectNodes(rootChildren);
                }
            } else if (nodeType === 'dependencies') {
                const projectPath = nodePath.replace('/dependencies', '');
                const project = solution.getProject(projectPath);
                if (project) {
                    const dependencies = project.getDependencies();
                    children = SolutionTreeService.convertProjectChildrenToProjectNodes(dependencies);
                }
            } else if (nodeType === 'folder') {
                const projectPath = SolutionTreeService.findProjectPathForFolder(nodePath);
                if (projectPath) {
                    const project = solution.getProject(projectPath);
                    if (project) {
                        const folderChildren = await project.getFolderChildren(nodePath);
                        children = SolutionTreeService.convertProjectChildrenToProjectNodes(folderChildren);
                    }
                }
            }

            if (children.length > 0) {
                // Update the node in the tree with its children
                SolutionTreeService.updateNodeInTree(treeData, nodePath, {
                    children,
                    hasChildren: true,
                    isLoaded: true
                });

                // Recursively restore expansion states for project-specific nodes
                if (nodeType === 'project') {
                    const project = solution.getProject(nodePath);
                    if (project) {
                        // Create folder watcher for restored expanded folders
                        const projectDir = require('path').dirname(nodePath);
                        if (project.createFolderWatcher) {
                            project.createFolderWatcher(projectDir);
                        }
                    }
                }
            }

        } catch (error) {
            this.logger.error('Error loading children for node:', error);
        }
    }
}