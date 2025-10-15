import * as vscode from 'vscode';
import { logger } from '../core/logger';
import { SolutionService } from './solutionService';
import { SolutionTreeService } from './solutionTreeService';
import { NodeId, NodeIdService, NodeIdString } from './nodeIdService';
import { ProjectNode } from '../types';
import { Project } from '../core/Project';

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
        nodeId: NodeIdString,
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
                            const projectPath = NodeIdService.getPathFromId(child.nodeId);
                            if (!projectPath) {
                                log.error(`Could not extract project path from expansion ID: ${child.nodeId}`);
                                continue;
                            }
                            const project = solution.getProject(projectPath);
                            if (project) {
                                // Refresh any expanded folders to catch file system changes
                                await this._refreshExpandedFolders(child.children || [], project);
                            }
                        }
                    }
                }
            } else if (nodeType === 'project') {
                // Expanding a project - extract actual project path from expansion ID
                const projectPath = NodeIdService.getProjectPathFromNodeId(nodeId);
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
                const projectPath = NodeIdService.parse(nodeId)?.projectPath;
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
                const projectPath = NodeIdService.getProjectPathFromDependencyId(nodeId);
                if (!projectPath) {
                    log.error(`Could not extract project path from dependency category expansion ID: ${nodeId}`);
                    return;
                }

                const project = solution.getProject(projectPath);
                if (project) {
                    const nodeData = NodeIdService.parse(nodeId);
                    const categoryDependencies = project.getDependenciesByCategory(nodeData);
                    children = SolutionTreeService.convertProjectChildrenToProjectNodes(categoryDependencies);
                }
            } else if (nodeType === 'folder') {
                // Expanding a folder within a project - extract paths from expansion ID
                const pathPortion = NodeIdService.getFolderPathFromNodeId(nodeId);
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

            const expandedIds = this.getExpansionState(context);
            await this._updateNodeExpansionState(nodeId, true, nodeType === 'solution' ? undefined : children, cachedSolutionData, false, expandedIds);

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
        nodeId: NodeIdString,
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

            const node = NodeIdService.parse(nodeId);
            if (!node) {
                log.error(`Could not parse nodeId for collapse: ${nodeId}`);
                return;
            }
            const nodeType = node.type;
            if (nodeType === 'folder') {
                const pathPortion = NodeIdService.getPathFromId(nodeId);
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
            const expandedNodes = this.getExpansionState(context);
            if (!expandedNodes.delete(nodeId))
                return; // Node was not in expanded set, no need to update storage

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
        nodeId: NodeIdString,
        expanded: boolean,
        children?: ProjectNode[],
        cachedSolutionData?: ProjectNode[] | null,
        isLoading: boolean = false,
        expandedIds?: Set<NodeIdString>,
    ): Promise<void> {
        if (cachedSolutionData) {
            const updates: Partial<ProjectNode> = { expanded, isLoading: isLoading };
            if (children) {
                updates.children = children;
                updates.hasChildren = children.length > 0;
            }
            SolutionTreeService.updateNodeInTree(cachedSolutionData, nodeId, updates, expandedIds);
        }
    }

    /**
     * Gets all expanded node IDs from the tree (prioritizes nodeId over path)
     */
    private static getExpandedNodePaths(nodes: ProjectNode[]): Set<NodeIdString> {

        const checkedIds = new Set<NodeIdString>();
        const expandedIds = new Set<NodeIdString>();

        const traverse = (nodeList: ProjectNode[], level: number = 0) => {
            for (const node of nodeList) {
                const nodeId = node.nodeId;
                if (checkedIds.has(nodeId)) continue;
                checkedIds.add(nodeId);
                if (node.expanded) expandedIds.add(nodeId);
                if (node.children) traverse(node.children, level + 1);
            }
        };

        traverse(nodes);

        return expandedIds;
    }

    /**
     * Saves expansion state to workspace storage
     */
    static saveExpansionState(expandedNodes: Set<NodeIdString>, context: vscode.ExtensionContext): void {
        context.workspaceState.update('solutionTreeExpanded', Array.from(expandedNodes));
    }

    /**
     * Gets expansion state from workspace storage
     */
    static getExpansionState(context: vscode.ExtensionContext): Set<NodeIdString> {
        const state = context.workspaceState.get<NodeIdString[]>('solutionTreeExpanded', []);
        return new Set<NodeIdString>(state ?? []);
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

            if (!expansionPaths || expansionPaths.size === 0) {
                return;
            }


            log.info(`Restoring expansion states for ${expansionPaths.size} nodes:`);

            // Filter out broken/old nodeIds and track valid ones
            const validExpansionPaths = new Set<NodeIdString>();
            const brokenNodeIds: NodeIdString[] = [];

            for (const expandedId of expansionPaths) {
                // Try to parse the nodeId to see if it's valid
                try {
                    // First check if it's an old string-based nodeId
                    if (!NodeIdService.isValid(expandedId)) {
                        log.debug(`Removing old string-based nodeId: ${expandedId}`);
                        brokenNodeIds.push(expandedId);
                        continue;
                    }

                    // Try to parse as new format
                    NodeIdService.parse(expandedId);

                    // Check if the node actually exists in the tree
                    const nodeType = SolutionTreeService.getNodeTypeById(expandedId, treeData);
                    if (nodeType) {
                        validExpansionPaths.add(expandedId);
                    } else {
                        log.debug(`Removing nodeId not found in tree: ${expandedId}`);
                        brokenNodeIds.push(expandedId);
                    }
                } catch (error) {
                    log.debug(`Removing invalid nodeId: ${expandedId} - ${error}`);
                    brokenNodeIds.push(expandedId);
                }
            }

            // Clean up broken nodeIds from saved state
            if (brokenNodeIds.length > 0) {
                log.info(`Cleaning up ${brokenNodeIds.length} broken/outdated nodeIds from expansion state`);
                this.saveExpansionState(validExpansionPaths, context);
            }

            // Restore expansion states and load children for valid nodes
            for (const expandedId of validExpansionPaths) {
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
                    await this._loadChildrenForNode(NodeIdService.parse(expandedId), nodeType, treeData);

                    log.info(`Successfully restored and loaded children for: ${expandedId}`);
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
    private static async _refreshExpandedFolders(children: ProjectNode[], project: Project): Promise<void> {
        for (const child of children) {
            if (child.type === 'folder' && child.expanded && child.children) {
                const projectPath = NodeIdService.getPathFromId(child.nodeId);
                if (!projectPath) {
                    log.error(`Could not extract project path from expansion ID: ${child.nodeId}`);
                    continue;
                }

                log.info(`Refreshing expanded folder: ${projectPath}`);
                try {
                    // Get fresh folder contents
                    const folderChildren = await project.getFolderChildren(projectPath);
                    const freshChildren = SolutionTreeService.convertProjectChildrenToProjectNodes(folderChildren);

                    // Merge with existing expansion states
                    child.children = this._mergeWithExistingExpansionStates(freshChildren, child.children);

                    // Recursively refresh nested expanded folders
                    await this._refreshExpandedFolders(child.children, project);
                } catch (error) {
                    log.warn(`Failed to refresh expanded folder: ${projectPath}`, error);
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
            const existing = existingChildren.find(child => child.nodeId === freshChild.nodeId);

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
    private static async _loadChildrenForNode(nodeId: NodeId, nodeType: string, treeData: ProjectNode[]): Promise<void> {
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
                const projectPath = nodeId.projectPath;
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
                const projectPath = nodeId.projectPath;
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
                const projectPath = nodeId.projectPath;
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
                const pathPortion = nodeId.folderPath;
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
                const nodeIdString = NodeIdService.composeNodeId(nodeId);
                SolutionTreeService.updateNodeInTree(treeData, nodeIdString, {
                    children,
                    hasChildren: true,
                    isLoaded: true
                });

                // Recursively restore expansion states for project-specific nodes
                if (nodeType === 'project') {
                    const projectPath = nodeId.projectPath;
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