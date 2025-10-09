import * as vscode from 'vscode';
import { logger } from '../core/logger';
import { SolutionService } from './solutionService';
import { SolutionTreeService } from './solutionTreeService';
import { SolutionExpansionIdService } from './solutionExpansionIdService';
import { ProjectNode } from '../webview/solution-view/types';

const log = logger('SolutionExpansionService');

/**
 * Service responsible for handling node expansion/collapse operations
 * Extracted from SolutionWebviewProvider to improve maintainability
 */
export class SolutionExpansionService {

    /**
     * Handles expanding a node in the solution tree
     */
    static async handleExpandNode(
        nodeId: string,
        nodeType: string,
        cachedSolutionData: ProjectNode[] | null,
        updateWebviewCallback: () => Promise<void>,
        context: vscode.ExtensionContext
    ): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                log.warn('No active solution for expand operation');
                return;
            }

            // First, set loading state and send updated tree
            await this._updateNodeExpansionState(nodeId, true, undefined, cachedSolutionData, true);
            await updateWebviewCallback();

            let children: ProjectNode[] = [];

            if (nodeType === 'solution') {
                // Solution is always expanded when loaded, but check if we need to restore state
                const existingNode = SolutionTreeService.findNodeById(nodeId, cachedSolutionData || []);
                if (existingNode?.children) {
                    log.info(`Re-expanding solution node: ${nodeId}`);

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
                // Expanding a project - extract actual project path from expansion ID
                const projectPath = SolutionExpansionIdService.getPathFromId(nodeId);
                if (!projectPath) {
                    log.error(`Could not extract project path from expansion ID: ${nodeId}`);
                    return;
                }

                const existingNode = SolutionTreeService.findNodeById(nodeId, cachedSolutionData || []);
                const project = solution.getProject(projectPath);
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
                    const projectDir = require('path').dirname(projectPath);
                    if (project.createFolderWatcher) {
                        project.createFolderWatcher(projectDir);
                    }
                }
            } else if (nodeType === 'dependencies') {
                // Expanding a Dependencies node - extract project path from expansion ID
                const projectPath = SolutionExpansionIdService.getPathFromId(nodeId);
                if (!projectPath) {
                    log.error(`Could not extract project path from dependencies expansion ID: ${nodeId}`);
                    return;
                }

                const project = solution.getProject(projectPath);
                if (project) {
                    const dependencies = project.getDependencies();
                    children = SolutionTreeService.convertProjectChildrenToProjectNodes(dependencies);
                }
            } else if (nodeType === 'packageDependencies' ||
                nodeType === 'projectDependencies' ||
                nodeType === 'assemblyDependencies') {
                // Expanding a Dependency Category node - extract project path from expansion ID
                const projectPath = SolutionExpansionIdService.getProjectPathFromDependencyId(nodeId);
                if (!projectPath) {
                    log.error(`Could not extract project path from dependency category expansion ID: ${nodeId}`);
                    return;
                }

                const project = solution.getProject(projectPath);
                if (project) {
                    const categoryDependencies = project.getDependenciesByCategory(nodeId);
                    children = SolutionTreeService.convertProjectChildrenToProjectNodes(categoryDependencies);
                }
            } else if (nodeType === 'folder') {
                // Expanding a folder within a project - extract paths from expansion ID
                const pathPortion = SolutionExpansionIdService.getPathFromId(nodeId);
                if (!pathPortion) {
                    log.error(`Could not extract path from folder expansion ID: ${nodeId}`);
                    return;
                }

                // Format is "projectPath:folderPath"
                const colonIndex = pathPortion.indexOf(':');
                if (colonIndex === -1) {
                    log.error(`Invalid folder expansion ID format: ${nodeId}`);
                    return;
                }

                const projectPath = pathPortion.substring(0, colonIndex);
                const folderPath = pathPortion.substring(colonIndex + 1);

                const project = solution.getProject(projectPath);
                if (project) {
                    const folderChildren = await project.getFolderChildren(folderPath);
                    children = SolutionTreeService.convertProjectChildrenToProjectNodes(folderChildren);

                    // Create lazy folder watcher for this expanded folder
                    if (project.createFolderWatcher) {
                        project.createFolderWatcher(folderPath);
                    }
                }
            } else if (nodeType === 'solutionFolder') {
                // Expanding a solution folder - get its children from the solution tree
                if (cachedSolutionData) {
                    const solutionFolderNode = SolutionTreeService.findNodeById(nodeId, cachedSolutionData);
                    if (solutionFolderNode?.children) {
                        children = solutionFolderNode.children;
                    }
                }
            }

            // Update backend state: set expanded = true and attach children
            // For solution nodes, don't override children since they already have children loaded
            if (nodeType === 'solution') {
                await this._updateNodeExpansionState(nodeId, true, undefined, cachedSolutionData, false);
            } else {
                await this._updateNodeExpansionState(nodeId, true, children, cachedSolutionData, false);
            }

            // Update expansion state in persistent storage
            const expandedNodes = this.getExpandedNodePaths(cachedSolutionData || []);
            this.saveExpansionState(expandedNodes, context);

            await updateWebviewCallback();

        } catch (error) {
            log.error('Error expanding node:', error);
            // Reset loading state on error
            await this._updateNodeExpansionState(nodeId, false, undefined, cachedSolutionData, false);
            await updateWebviewCallback();
        }
    }

    /**
     * Handles collapsing a node in the solution tree
     */
    static async handleCollapseNode(
        nodeId: string,
        cachedSolutionData: ProjectNode[] | null,
        updateWebviewCallback: () => Promise<void>,
        context: vscode.ExtensionContext
    ): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                log.warn('No active solution for collapse operation');
                return;
            }

            // For folder nodes, find the project and collapse the folder
            const nodeType = SolutionExpansionIdService.getNodeTypeFromId(nodeId);
            if (nodeType === 'folder') {
                const pathPortion = SolutionExpansionIdService.getPathFromId(nodeId);
                if (pathPortion) {
                    const colonIndex = pathPortion.indexOf(':');
                    if (colonIndex !== -1) {
                        const projectPath = pathPortion.substring(0, colonIndex);
                        const folderPath = pathPortion.substring(colonIndex + 1);

                        const projects = solution.getDotNetProjects();
                        for (const project of projects) {
                            if (project.projectPath === projectPath) {
                                project.collapseFolder(folderPath);
                                // Remove lazy folder watcher for this collapsed folder
                                // Note: This would need to be implemented in Project class
                                break;
                            }
                        }
                    }
                }
            }

            // Update backend state: set expanded = false (but preserve children for re-expansion)
            await this._updateNodeExpansionState(nodeId, false, undefined, cachedSolutionData, false);

            // Update expansion state in persistent storage
            const expandedNodes = this.getExpandedNodePaths(cachedSolutionData || []);
            this.saveExpansionState(expandedNodes, context);

            await updateWebviewCallback();

        } catch (error) {
            log.error('Error collapsing node:', error);
        }
    }

    /**
     * Updates the expansion state of a node in the cached tree
     */
    private static async _updateNodeExpansionState(
        nodeId: string,
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
            SolutionTreeService.updateNodeInTree(cachedSolutionData, nodeId, updates);
        }
    }

    /**
     * Gets all expanded node IDs from the tree (prioritizes nodeId over path)
     */
    static getExpandedNodePaths(nodes: ProjectNode[]): string[] {
        const expandedIds: string[] = [];

        const traverse = (nodeList: ProjectNode[], level: number = 0) => {
            for (const node of nodeList) {
                if (node.expanded) {
                    // Prefer nodeId over path for better collision-free identification
                    const nodeId = node.nodeId || node.path;
                    expandedIds.push(nodeId);

                    log.info(`Saving expanded state for ${node.type}: ${node.name} (${nodeId})`);

                    // Traverse children of expanded nodes
                    if (node.children) {
                        traverse(node.children, level + 1);
                    }
                } else if (level === 0 && node.type === 'solution') {
                    // Always log solution node state for debugging and traverse children even if not expanded
                    log.info(`Solution node "${node.name}" is NOT expanded - will not be saved`);
                    if (node.children) {
                        traverse(node.children, level + 1);
                    }
                }
                // Note: Non-expanded, non-solution nodes are ignored (no traversal of their children)
            }
        };

        traverse(nodes);

        return expandedIds;
    }

    /**
     * Saves expansion state to workspace storage
     */
    static saveExpansionState(expandedNodes: string[], context: vscode.ExtensionContext): void {
        context.workspaceState.update('solutionTreeExpanded', expandedNodes);
    }

    /**
     * Gets expansion state from workspace storage
     */
    static getExpansionState(context: vscode.ExtensionContext): string[] {
        const state = context.workspaceState.get<string[]>('solutionTreeExpanded', []);

        return state;
    }

    /**
     * Restores expansion states for a tree
     */
    static async restoreExpansionStates(
        treeData: ProjectNode[],
        context: vscode.ExtensionContext
    ): Promise<void> {

        try {

            // Log current tree structure for debugging
            const logTreeStructure = (nodes: any[], indent = 0) => {
                for (const node of nodes) {
                    if (node.children && node.children.length > 0) {
                        logTreeStructure(node.children, indent + 1);
                    }
                }
            };
            logTreeStructure(treeData);

            // Get saved expansion paths from workspace state
            const expansionPaths = this.getExpansionState(context);

            if (!expansionPaths || expansionPaths.length === 0) {
                return;
            }

            // Filter by parent path if specified
            let cleanedExpandedNodes = expansionPaths;

            // CONSERVATIVE APPROACH: Preserve ALL expansion state
            // Only remove expansion state on explicit user collapse, never on reload
            // Dependencies and other lazy-loaded nodes should maintain their expansion state

            // No filtering - preserve all expansion state
            // Nodes that don't exist yet (like Dependencies) will be handled when they're created

            log.info(`Restoring expansion states for ${cleanedExpandedNodes.length} nodes:`);
            cleanedExpandedNodes.forEach(id => log.info(`  - ${id}`));

            // Restore expansion states and load children
            for (const expandedId of cleanedExpandedNodes) {
                const nodeType = SolutionTreeService.getNodeTypeById(expandedId, treeData);
                if (nodeType) {
                    log.info(`Restoring expansion for: ${expandedId} (${nodeType})`);

                    // Set expanded = true in the tree
                    const updateSuccess = SolutionTreeService.updateNodeInTree(treeData, expandedId, { expanded: true });
                    if (!updateSuccess) {
                        log.error(`Failed to update expansion state for node: ${expandedId}`);
                        continue;
                    }

                    // Load children for the expanded node
                    await this._loadChildrenForNode(expandedId, nodeType, treeData);

                    log.info(`Successfully restored and loaded children for: ${expandedId}`);
                } else {
                    log.warn(`Could not determine node type for ID: ${expandedId} - node not found in fresh tree`);
                }
            }

            // Log final tree structure after restoration
            logTreeStructure(treeData);

        } catch (error) {
            log.error('Error restoring expansion states:', error);
        }
    }

    /**
     * Refreshes expanded folders to catch file system changes while preserving expansion state
     */
    private static async _refreshExpandedFolders(children: ProjectNode[], project: any): Promise<void> {
        for (const child of children) {
            if (child.type === 'folder' && child.expanded && child.children) {
                log.info(`Refreshing expanded folder: ${child.path}`);
                try {
                    // Get fresh folder contents
                    const folderChildren = await project.getFolderChildren(child.path);
                    const freshChildren = SolutionTreeService.convertProjectChildrenToProjectNodes(folderChildren);

                    // Merge with existing expansion states
                    child.children = this._mergeWithExistingExpansionStates(freshChildren, child.children);

                    // Recursively refresh nested expanded folders
                    await this._refreshExpandedFolders(child.children, project);
                } catch (error) {
                    log.warn(`Failed to refresh expanded folder: ${child.path}`, error);
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
    private static async _loadChildrenForNode(nodeId: string, nodeType: string, treeData: ProjectNode[]): Promise<void> {
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
                const projectPath = SolutionExpansionIdService.getPathFromId(nodeId);
                if (!projectPath) {
                    log.error(`Could not extract project path from expansion ID: ${nodeId}`);
                    return;
                }

                const project = solution.getProject(projectPath);
                if (project) {
                    const rootChildren = await project.getRootChildren();
                    children = SolutionTreeService.convertProjectChildrenToProjectNodes(rootChildren);
                }
            } else if (nodeType === 'dependencies') {
                // Expanding a Dependencies node - get the project and load its dependencies
                const projectPath = SolutionExpansionIdService.getPathFromId(nodeId);
                if (!projectPath) {
                    log.error(`Could not extract project path from dependencies expansion ID: ${nodeId}`);
                    return;
                }

                log.info(`Loading children for dependencies node. ProjectPath: ${projectPath}`);
                const project = solution.getProject(projectPath);
                if (project) {
                    const dependencies = project.getDependencies();
                    children = SolutionTreeService.convertProjectChildrenToProjectNodes(dependencies);
                    log.info(`Loaded ${children.length} dependency categories for ${projectPath}`);
                } else {
                    log.warn(`Could not find project for dependencies: ${projectPath}`);
                }
            } else if (nodeType === 'packageDependencies' ||
                nodeType === 'projectDependencies' ||
                nodeType === 'assemblyDependencies') {
                // Expanding a Dependency Category node - get dependencies for that specific category
                const projectPath = SolutionExpansionIdService.getProjectPathFromDependencyId(nodeId);
                if (!projectPath) {
                    log.error(`Could not extract project path from dependency category expansion ID: ${nodeId}`);
                    return;
                }

                log.info(`Loading children for dependency category node. ProjectPath: ${projectPath}, CategoryId: ${nodeId}`);
                const project = solution.getProject(projectPath);
                if (project) {
                    const categoryDependencies = project.getDependenciesByCategory(nodeId);
                    children = SolutionTreeService.convertProjectChildrenToProjectNodes(categoryDependencies);
                    log.info(`Loaded ${children.length} dependencies for category ${nodeId}`);
                } else {
                    log.warn(`Could not find project for dependency category: ${projectPath}`);
                }
            } else if (nodeType === 'folder') {
                const pathPortion = SolutionExpansionIdService.getPathFromId(nodeId);
                if (!pathPortion) {
                    log.error(`Could not extract path from folder expansion ID: ${nodeId}`);
                    return;
                }

                const colonIndex = pathPortion.indexOf(':');
                if (colonIndex === -1) {
                    log.error(`Invalid folder expansion ID format: ${nodeId}`);
                    return;
                }

                const projectPath = pathPortion.substring(0, colonIndex);
                const folderPath = pathPortion.substring(colonIndex + 1);

                const project = solution.getProject(projectPath);
                if (project) {
                    const folderChildren = await project.getFolderChildren(folderPath);
                    children = SolutionTreeService.convertProjectChildrenToProjectNodes(folderChildren);
                }
            }

            if (children.length > 0) {
                // Update the node in the tree with its children
                SolutionTreeService.updateNodeInTree(treeData, nodeId, {
                    children,
                    hasChildren: true,
                    isLoaded: true
                });

                // Recursively restore expansion states for project-specific nodes
                if (nodeType === 'project') {
                    const projectPath = SolutionExpansionIdService.getPathFromId(nodeId);
                    if (projectPath) {
                        const project = solution.getProject(projectPath);
                        if (project) {
                            // Create folder watcher for restored expanded folders
                            const projectDir = require('path').dirname(projectPath);
                            if (project.createFolderWatcher) {
                                project.createFolderWatcher(projectDir);
                            }
                        }
                    }
                }
            }

        } catch (error) {
            log.error('Error loading children for node:', error);
        }
    }
}