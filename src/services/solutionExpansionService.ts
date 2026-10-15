import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../core/logger';
import { SolutionService } from './solutionService';
import { SolutionTreeService } from './solutionTreeService';
import { NodeIdService } from './nodeIdService';
import { NodeType, ProjectNode } from '../types';
import { Project } from '../core/Project';
import { NodeIdString } from '../types/nodeId';
import { analyzerChildren } from './analyzerNodes';
import { packageChildren } from './nuget/packageNodes';

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
        cachedSolutionData: ProjectNode[] | null,
        updateWebviewCallback: () => Promise<void>,
        context: vscode.ExtensionContext
    ): Promise<void> {
        try {
            var node = NodeIdService.parse(nodeId);
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                log.warn('No active solution for expand operation');
                return;
            }

            // First, set loading state and send updated tree
            await this._updateNodeExpansionState(nodeId, true, undefined, cachedSolutionData, true);
            await updateWebviewCallback();

            let children: ProjectNode[] = [];
            // Analyzers and packages expand to what MSBuild and the last restore report
            const dependencyNodes = await analyzerChildren(node) ?? packageChildren(node);

            if (dependencyNodes) {
                children = SolutionTreeService.convertProjectChildrenToProjectNodes(dependencyNodes);
            } else if (node.type === 'solution') {
                // Solution is always expanded when loaded, but check if we need to restore state
                const existingNode = SolutionTreeService.findNodeById(nodeId, cachedSolutionData || []);
                if (existingNode?.children) {
                    log.info(`Re-expanding solution node: ${nodeId}`);

                    // Restore expansion states for all projects
                    for (const child of existingNode.children) {
                        if (child.type === 'project' && child.expanded) {
                            const projectPath = NodeIdService.parse(child.nodeId).path;
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
            } else if (node.type === 'project') {
                const projectPath = node.path;
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
            } else if (node.type === 'dependencies') {
                // Expanding a Dependencies node - extract project path from expansion ID
                const path = node.path;
                if (!path) {
                    log.error(`Could not extract project path from dependencies expansion ID: ${nodeId}`);
                    return;
                }

                const project = solution.getProject(path);
                if (project) {
                    const dependencies = project.getDependencies();
                    children = SolutionTreeService.convertProjectChildrenToProjectNodes(dependencies);
                }
            } else if (node.type === 'dependencyCategory') {
                // Expanding a Dependency Category node - extract project path from expansion ID
                const path = node.path;
                if (!path) {
                    log.error(`Could not extract project path from dependency category expansion ID: ${nodeId}`);
                    return;
                }

                const project = solution.getProject(path);
                if (project) {
                    try {
                        const categoryDependencies = project.getDependenciesByCategory(node);
                        children = SolutionTreeService.convertProjectChildrenToProjectNodes(categoryDependencies);
                    } catch (error) {
                        log.error(`Failed to parse nodeId for dependency category: ${nodeId}`, error);
                    }
                }
            }
            else if (node.type === 'folder') {
                // Expanding a folder within a project - extract paths from nodeId
                const path = node.path;

                if (!path) {
                    log.error(`Could not extract paths from folder expansion ID: ${nodeId}`);
                    return;
                }

                const project = solution.getProject(path);
                if (project) {
                    const folderChildren = await project.getFolderChildren(path);
                    children = SolutionTreeService.convertProjectChildrenToProjectNodes(folderChildren);

                    // Create lazy folder watcher for this expanded folder
                    if (project.createFolderWatcher) {
                        project.createFolderWatcher(path);
                    }
                }
            } else if (node.type === 'solutionFolder') {
                // Expanding a solution folder - get its children from the solution tree
                if (cachedSolutionData) {
                    const solutionFolderNode = SolutionTreeService.findNodeById(nodeId, cachedSolutionData);
                    if (solutionFolderNode?.children) {
                        children = solutionFolderNode.children;
                    }
                }
            }

            const expandedIds = this.getExpansionState(context);
            // Only nodes whose children load on demand get new ones; the solution's are there from the start, and
            // nested files (Index.cshtml.cs under Index.cshtml) come with their parent
            const loadsChildren = !['solution', 'file', 'solutionItem', 'generatedFile'].includes(node.type);
            await this._updateNodeExpansionState(nodeId, true, loadsChildren ? children : undefined, cachedSolutionData, false, expandedIds);

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
                const pathPortion = node.path;
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

    /** Visual Studio's "Collapse All": collapses every node but the solution, which keeps showing its projects */
    static collapseAll(nodes: ProjectNode[], context: vscode.ExtensionContext): void {
        const collapse = (list: ProjectNode[]) => list.forEach(node => {
            if (node.type !== 'solution') {
                node.expanded = false;
            }
            if (node.children) {
                collapse(node.children);
            }
        });
        collapse(nodes);
        this.saveExpansionState(new Set(nodes.filter(node => node.type === 'solution' && node.expanded).map(node => node.nodeId)), context);
    }

    /**
     * Visual Studio's "Sync with Active Document": expands the solution folders, project, folders and parent
     * file down to a file, loading their children where needed, and remembers them as expanded.
     * When projects are nested in each other's directories, the innermost project wins.
     * Returns the node of the file, or undefined when the file isn't in the solution.
     */
    static async revealPath(
        filePath: string,
        nodes: ProjectNode[],
        context: vscode.ExtensionContext,
        loadChildren: (node: ProjectNode) => Promise<ProjectNode[]> = node => this._loadChildren(node)
    ): Promise<NodeIdString | undefined> {
        const isUnder = (dir: string) => filePath.startsWith(dir + path.sep);
        const chains: ProjectNode[][] = [];

        const walk = async (list: ProjectNode[], chain: ProjectNode[]): Promise<void> => {
            for (const node of list) {
                const nodePath = NodeIdService.parse(node.nodeId).path;
                let descend: boolean;
                switch (node.type) {
                    case 'solution':
                    case 'solutionFolder': descend = true; break;
                    case 'project': descend = !!nodePath && isUnder(path.dirname(nodePath)); break;
                    case 'folder': descend = !!nodePath && isUnder(nodePath); break;
                    case 'file':
                    case 'solutionItem':
                        if (nodePath === filePath) {
                            chains.push([...chain, node]);
                            continue;
                        }
                        // Nested files (Index.cshtml.cs under Index.cshtml) come with their parent
                        descend = !!node.children?.length;
                        break;
                    default: descend = false;
                }
                if (!descend) {
                    continue;
                }
                if (!node.children?.length && (node.type === 'project' || node.type === 'folder')) {
                    node.children = await loadChildren(node);
                    node.hasChildren = node.children.length > 0;
                }
                await walk(node.children ?? [], [...chain, node]);
            }
        };
        await walk(nodes, []);

        const projectDepth = (chain: ProjectNode[]) => {
            const project = chain.find(node => node.type === 'project');
            return project ? NodeIdService.parse(project.nodeId).path.length : 0;
        };
        const chain = chains.sort((a, b) => projectDepth(b) - projectDepth(a) || a.length - b.length)[0];
        if (!chain) {
            return undefined;
        }

        const expanded = this.getExpansionState(context);
        for (const node of chain.slice(0, -1)) {
            node.expanded = true;
            expanded.add(node.nodeId);
        }
        this.saveExpansionState(expanded, context);
        return chain[chain.length - 1].nodeId;
    }

    /** Loads the children of a project or folder for revealing a file, with the watcher expanding by hand creates */
    private static async _loadChildren(node: ProjectNode): Promise<ProjectNode[]> {
        const nodePath = NodeIdService.parse(node.nodeId).path;
        const project = SolutionService.getActiveSolution()?.getProject(nodePath);
        if (!project) {
            return [];
        }
        const folder = node.type === 'project' ? path.dirname(nodePath) : nodePath;
        const children = node.type === 'project' ? await project.getRootChildren() : await project.getFolderChildren(nodePath);
        project.createFolderWatcher?.(folder);
        return SolutionTreeService.convertProjectChildrenToProjectNodes(children);
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

    private static firstLoad: boolean = false;
    /**
     * Gets expansion state from workspace storage
     */
    static getExpansionState(context: vscode.ExtensionContext): Set<NodeIdString> {
        let state = context.workspaceState.get<NodeIdString[]>('solutionTreeExpanded', []);
        if (this.firstLoad) {
            state = state.filter(x => NodeIdService.isValid(x));
            this.firstLoad = false;
        }
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
                    const node = NodeIdService.parse(expandedId);

                    // Check if the node actually exists in the tree
                    const nodeType = node.type;
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
                const nodeType = NodeIdService.parse(expandedId).type;
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
                const path = NodeIdService.parse(child.nodeId).path;
                if (!path) {
                    log.error(`Could not extract project path from expansion ID: ${child.nodeId}`);
                    continue;
                }

                log.info(`Refreshing expanded folder: ${path}`);
                try {
                    // Get fresh folder contents
                    const folderChildren = await project.getFolderChildren(path);
                    const freshChildren = SolutionTreeService.convertProjectChildrenToProjectNodes(folderChildren);

                    // Merge with existing expansion states
                    child.children = this._mergeWithExistingExpansionStates(freshChildren, child.children);

                    // Recursively refresh nested expanded folders
                    await this._refreshExpandedFolders(child.children, project);
                } catch (error) {
                    log.warn(`Failed to refresh expanded folder: ${path}`, error);
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
    private static async _loadChildrenForNode(nodeId: NodeIdString, nodeType: NodeType, treeData: ProjectNode[]): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                return;
            }

            let children: ProjectNode[] = [];
            const parsedNode = NodeIdService.parse(nodeId);
            const dependencyNodes = await analyzerChildren(parsedNode) ?? packageChildren(parsedNode);

            if (dependencyNodes) {
                children = SolutionTreeService.convertProjectChildrenToProjectNodes(dependencyNodes);
            } else if (nodeType === 'solution') {
                // Solution children are already loaded in the initial tree
                return;
            } else if (nodeType === 'project') {
                const path = NodeIdService.parse(nodeId).path;
                if (!path) {
                    log.error(`Could not extract project path from expansion ID: ${nodeId}`);
                    return;
                }

                const project = solution.getProject(path);
                if (project) {
                    const rootChildren = await project.getRootChildren();
                    children = SolutionTreeService.convertProjectChildrenToProjectNodes(rootChildren);
                }
            } else if (nodeType === 'dependencies') {
                // Expanding a Dependencies node - get the project and load its dependencies
                const path = NodeIdService.parse(nodeId).path;
                if (!path) {
                    log.error(`Could not extract project path from dependencies expansion ID: ${nodeId}`);
                    return;
                }

                log.info(`Loading children for dependencies node. ProjectPath: ${path}`);
                const project = solution.getProject(path);
                if (project) {
                    const dependencies = project.getDependencies();
                    children = SolutionTreeService.convertProjectChildrenToProjectNodes(dependencies);
                    log.info(`Loaded ${children.length} dependency categories for ${path}`);
                } else {
                    log.warn(`Could not find project for dependencies: ${path}`);
                }
            } else if (nodeType === 'dependencyCategory') {
                // Expanding a Dependency Category node - get dependencies for that specific category
                const path = NodeIdService.parse(nodeId).path;
                if (!path) {
                    log.error(`Could not extract project path from dependency category expansion ID: ${nodeId}`);
                    return;
                }

                log.info(`Loading children for dependency category node. ProjectPath: ${path}, CategoryId: ${nodeId}`);
                const project = solution.getProject(path);
                if (project) {
                    try {
                        const nodeData = NodeIdService.parse(nodeId);
                        const categoryDependencies = project.getDependenciesByCategory(nodeData);
                        children = SolutionTreeService.convertProjectChildrenToProjectNodes(categoryDependencies);
                        log.info(`Loaded ${children.length} dependencies for category ${nodeId}`);
                    } catch (error) {
                        log.error(`Failed to parse nodeId for dependency category: ${nodeId}`, error);
                    }
                } else {
                    log.warn(`Could not find project for dependency category: ${path}`);
                }
            } else if (nodeType === 'folder') {
                const path = NodeIdService.parse(nodeId).path;

                if (!path) {
                    log.error(`Could not extract paths from folder expansion ID: ${nodeId}`);
                    return;
                }

                const project = solution.getProject(path);
                if (project) {
                    const folderChildren = await project.getFolderChildren(path);
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
                    const path = NodeIdService.parse(nodeId).path;
                    if (path) {
                        const project = solution.getProject(path);
                        if (project) {
                            // Create folder watcher for restored expanded folders
                            const projectDir = require('path').dirname(path);
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