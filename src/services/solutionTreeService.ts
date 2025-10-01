import * as path from 'path';
import * as fs from 'fs';
import { SolutionProject } from '../parsers/solutionFileParser';
import { Solution } from '../core/Solution';
import { ProjectFileNode } from '../core/Project';
import { ProjectNode } from '../webview/solution-view/types';
import { SolutionExpansionIdService } from './solutionExpansionIdService';
import { logger } from '../core/logger';

/**
 * Service responsible for building and managing solution tree structures
 * Extracted from SolutionWebviewProvider to improve maintainability
 */
export class SolutionTreeService {
    private static readonly logger = logger('SolutionTreeService');

    /**
     * Builds a complete solution tree from Solution data
     */
    static async buildSolutionTree(solution: Solution): Promise<ProjectNode[]> {
        const solutionPath = solution.solutionPath;
        this.logger.info(`Building solution tree for: ${solutionPath}`);

        const solutionFile = solution.solutionFile;
        if (!solutionFile) {
            this.logger.error('No solution file available');
            return [];
        }

        // Create project hierarchy map
        const hierarchy = new Map<string, SolutionProject[]>();
        hierarchy.set('ROOT', []);

        // Group projects by their parent GUID (for solution folders)
        for (const project of solutionFile.projects) {
            const parentGuid = solutionFile.nestedProjects.find(np => np.childGuid === project.guid)?.parentGuid;
            const key = parentGuid || 'ROOT';

            if (!hierarchy.has(key)) {
                hierarchy.set(key, []);
            }
            hierarchy.get(key)!.push(project);
        }

        this.logger.info(`Building lazy-loaded tree structure for: ${solutionPath}`);

        // Add the solution as the root node
        const solutionNode: ProjectNode = {
            type: 'solution',
            name: path.basename(solutionPath, '.sln'),
            path: solutionPath,
            nodeId: SolutionExpansionIdService.generateSolutionId(solutionPath),
            children: []
        };

        // Get root level projects and solution folders from hierarchy
        const rootProjects = hierarchy.get('ROOT') || [];
        this.logger.info(`Found ${rootProjects.length} root-level items`);

        // Build tree using lazy loading approach
        solutionNode.children = await this.buildLazyHierarchicalNodes(rootProjects, hierarchy, solution, solutionNode.nodeId);

        // Sort solution-level items (projects and solution folders)
        solutionNode.children.sort((a: ProjectNode, b: ProjectNode) => {
            // Visual Studio ordering at solution level: Solution Folders -> Projects
            const getTypePriority = (item: ProjectNode) => {
                if (item.type === 'solutionFolder') return 0;  // Solution folders first
                return 1;  // Projects second
            };

            const priorityA = getTypePriority(a);
            const priorityB = getTypePriority(b);

            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }

            // Within same type, sort alphabetically
            return a.name.localeCompare(b.name);
        });

        return [solutionNode];
    }

    /**
     * Builds hierarchical nodes using lazy loading approach
     */
    static async buildLazyHierarchicalNodes(
        projects: SolutionProject[],
        hierarchy: Map<string, SolutionProject[]>,
        solution: Solution,
        parentExpansionId: string = ''
    ): Promise<ProjectNode[]> {
        const nodes: ProjectNode[] = [];

        for (const project of projects) {
            // Determine the item type based on typeGuid
            const itemType = this.getItemType(project.typeGuid);
            this.logger.info(`Processing ${itemType}: ${project.name}, type GUID: ${project.typeGuid}`);

            // Ensure path is absolute (for both projects and solution items)
            const absolutePath = this.resolveAbsolutePath(project.path || '', solution.solutionPath);
            this.logger.info(`Path resolution: ${project.path} -> ${absolutePath}`);

            // Generate expansion ID based on node type
            let nodeId: string;
            if (itemType === 'project') {
                nodeId = SolutionExpansionIdService.generateProjectId(absolutePath);
            } else if (itemType === 'solutionFolder') {
                nodeId = SolutionExpansionIdService.generateSolutionFolderId(
                    project.guid || project.name,
                    solution.solutionPath
                );
            } else {
                // Fallback for other types
                nodeId = `${itemType}:${absolutePath}`;
            }

            const itemNode: ProjectNode = {
                type: itemType,
                name: project.name || path.basename(project.path || '', path.extname(project.path || '')),
                path: absolutePath,
                nodeId: nodeId,
                children: [],
                // Add framework information if available
                frameworks: project.targetFrameworks || [],
                // Store original typeGuid for debugging
                typeGuid: project.typeGuid,
                // Store GUID for hierarchy lookup
                guid: project.guid,
                // Mark as not loaded for lazy loading
                isLoaded: false
            };

            // Check if project nodes actually have children (optimized check)
            if (itemType === 'project') {
                try {
                    const projectInstance = solution.getProject(absolutePath);
                    if (projectInstance) {
                        const hasFiles = await projectInstance.hasAnyChildren();
                        itemNode.hasChildren = hasFiles;
                        this.logger.info(`Project ${project.name} has children: ${hasFiles}`);
                    } else {
                        this.logger.warn(`Could not find project instance for: ${absolutePath}`);
                        // For projects, assume they have children if we can't check
                        itemNode.hasChildren = true;
                    }
                } catch (error) {
                    this.logger.warn(`Could not check children for project ${project.name}: ${error}`);
                    // For projects, assume they have children if there's an error
                    itemNode.hasChildren = true;
                }

                // Project always has Dependencies node - this will be provided by the Project class when expanded
            }
            // Handle solution folders - add their children recursively like the original
            else if (itemType === 'solutionFolder') {
                const childProjects = hierarchy.get(project.guid) || [];
                this.logger.info(`Solution folder ${project.name} has ${childProjects.length} children`);

                if (childProjects.length > 0) {
                    itemNode.children = await this.buildLazyHierarchicalNodes(childProjects, hierarchy, solution, nodeId);
                }

                // Add solution items (files directly in the solution folder)
                const solutionItems = solution.getSolutionItems(project);
                this.logger.info(`Solution folder ${project.name} has ${solutionItems.length} solution items`);

                if (!itemNode.children) {
                    itemNode.children = [];
                }

                for (const itemPath of solutionItems) {
                    const itemName = path.basename(itemPath);
                    const absoluteItemPath = path.resolve(path.dirname(solution.solutionPath), itemPath);
                    itemNode.children.push({
                        type: 'solutionItem',
                        name: itemName,
                        path: absoluteItemPath,
                        nodeId: SolutionExpansionIdService.generateSolutionItemId(
                            absoluteItemPath,
                            project.guid || project.name
                        )
                    });
                }

                // Sort solution folder children
                if (itemNode.children?.length) {
                    itemNode.children.sort((a: ProjectNode, b: ProjectNode) => {
                        const getTypePriority = (item: ProjectNode) => {
                            if (item.type === 'solutionFolder') return 0;
                            if (item.type === 'project') return 1;
                            if (item.type === 'solutionItem') return 2;
                            return 3;
                        };

                        const priorityA = getTypePriority(a);
                        const priorityB = getTypePriority(b);

                        if (priorityA !== priorityB) {
                            return priorityA - priorityB;
                        }

                        return a.name.localeCompare(b.name);
                    });
                }

                // Set hasChildren based on whether the solution folder has any children
                itemNode.hasChildren = (itemNode.children && itemNode.children.length > 0);
            }

            nodes.push(itemNode);
        }

        return nodes;
    }

    /**
     * Merges fresh tree data with cached expansion states
     */
    static mergeTreeStates(freshNodes: ProjectNode[], cachedNodes: ProjectNode[]): void {
        if (!cachedNodes || cachedNodes.length === 0) {
            return;
        }

        // Create a map of cached nodes by path for efficient lookup
        const cachedMap = new Map<string, ProjectNode>();
        this.buildNodeMap(cachedNodes, cachedMap);

        // Merge states recursively
        this.mergeNodeStates(freshNodes, cachedMap);
    }

    /**
     * Updates a specific node in the tree structure using expansion ID
     */
    static updateNodeInTree(nodes: ProjectNode[], nodeId: string, updates: Partial<ProjectNode>): boolean {
        for (const node of nodes) {
            if (node.nodeId === nodeId) {
                Object.assign(node, updates);
                return true;
            }
            if (node.children && this.updateNodeInTree(node.children, nodeId, updates)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Finds a node in the tree by expansion ID
     */
    static findNodeById(nodeId: string, nodes: ProjectNode[]): ProjectNode | null {
        for (const node of nodes) {
            if (node.nodeId === nodeId) {
                return node;
            }
            if (node.children) {
                const found = this.findNodeById(nodeId, node.children);
                if (found) return found;
            }
        }
        return null;
    }

    /**
     * Gets all valid expansion IDs from the tree structure
     */
    static getAllValidIdsFromTree(nodes: ProjectNode[]): Set<string> {
        const nodeIds = new Set<string>();

        const traverse = (nodeList: ProjectNode[]) => {
            for (const node of nodeList) {
                nodeIds.add(node.nodeId);
                if (node.children) {
                    traverse(node.children);
                }
            }
        };

        traverse(nodes);
        return nodeIds;
    }

    /**
     * Gets the node type for a given expansion ID from the tree
     */
    static getNodeTypeById(nodeId: string, nodes: ProjectNode[]): string | null {
        const node = this.findNodeById(nodeId, nodes);
        return node ? node.type : null;
    }

    /**
     * Converts Project children to ProjectNode format
     * This method handles the generic project children from Project class methods
     */
    static convertProjectChildrenToProjectNodes(children: any[]): ProjectNode[] {
        return children.map(child => {
            let nodeType: ProjectNode['type'] = 'file';

            // Handle the different child types
            if (child.type === 'folder') {
                nodeType = 'folder';
            } else if (child.type === 'dependencies') {
                nodeType = 'dependencies';
            } else if (child.type === 'dependencyCategory') {
                nodeType = 'dependencyCategory';
            } else if (child.type === 'packageDependencies') {
                nodeType = 'packageDependencies';
            } else if (child.type === 'projectDependencies') {
                nodeType = 'projectDependencies';
            } else if (child.type === 'assemblyDependencies') {
                nodeType = 'assemblyDependencies';
            } else if (child.type === 'dependency') {
                nodeType = 'dependency';
            } else {
                nodeType = 'file';
            }

            return {
                type: nodeType,
                name: child.name,
                path: child.path,
                nodeId: child.nodeId || child.path, // Use expansion ID if provided, fallback to path
                hasChildren: child.hasChildren,
                expanded: child.expanded,
                children: child.children ? this.convertProjectChildrenToProjectNodes(child.children) : undefined
            };
        });
    }

    /**
     * Finds the project path for a given folder path
     */
    static findProjectPathForFolder(folderPath: string): string | undefined {
        // We need to find which project contains this folder by traversing up the directory tree
        let currentPath = folderPath;

        // Keep going up until we find a directory that contains a project file
        while (currentPath && currentPath !== path.dirname(currentPath)) {
            try {
                // Check if current directory contains any project files
                const files = fs.readdirSync(currentPath);
                const projectFile = files.find((file: string) =>
                    file.endsWith('.csproj') || file.endsWith('.vbproj') || file.endsWith('.fsproj')
                );

                if (projectFile) {
                    return path.join(currentPath, projectFile);
                }

                // Move up one directory
                currentPath = path.dirname(currentPath);
            } catch (error) {
                // If we can't read the directory, move up
                currentPath = path.dirname(currentPath);
            }
        }

        return undefined;
    }

    // Private helper methods

    private static getItemType(typeGuid?: string): ProjectNode['type'] {
        if (!typeGuid) return 'project';

        // Solution folder type GUID
        if (typeGuid === '{2150E333-8FDC-42A3-9474-1A3956D46DE8}') {
            return 'solutionFolder';
        }

        // All other project types are treated as 'project'
        return 'project';
    }

    private static resolveAbsolutePath(itemPath: string, solutionPath: string): string {
        if (path.isAbsolute(itemPath)) {
            return itemPath;
        }

        // For solution folders, the path is usually just the folder name
        // For projects, it's a relative path to the .csproj file
        return path.resolve(path.dirname(solutionPath), itemPath);
    }

    private static buildNodeMap(nodes: ProjectNode[], map: Map<string, ProjectNode>): void {
        for (const node of nodes) {
            // Store node by its expansion ID (primary identifier)
            map.set(node.nodeId, node);
            if (node.children) {
                this.buildNodeMap(node.children, map);
            }
        }
    }

    private static mergeNodeStates(freshNodes: ProjectNode[], cachedMap: Map<string, ProjectNode>): void {
        for (const freshNode of freshNodes) {
            // Check if this is a dependency category node type (exclude 'dependencies' container)
            const isDependencyNode = freshNode.type === 'dependencyCategory' ||
                                     freshNode.type === 'packageDependencies' ||
                                     freshNode.type === 'projectDependencies' ||
                                     freshNode.type === 'assemblyDependencies';

            // Find cached state using expansion ID
            const cached = cachedMap.get(freshNode.nodeId);
            if (cached) {
                this.logger.info(`Merging state for ${freshNode.type} node: ${freshNode.name}, nodeId: ${freshNode.nodeId}, expanded: ${cached.expanded}`);

                // Preserve expansion and loading states
                freshNode.expanded = cached.expanded;
                freshNode.isLoading = cached.isLoading;
                freshNode.isLoaded = cached.isLoaded;

                // If node was expanded and had children, merge the children too
                // BUT skip this for dependency nodes - they should always force refresh
                if (freshNode.expanded && freshNode.children && cached.children && !isDependencyNode) {
                    this.logger.debug(`Recursively merging children for expanded node: ${freshNode.path}`);
                    this.mergeNodeStates(freshNode.children, cachedMap);
                }

                // For dependency nodes, preserve expansion state but allow children to be updated naturally
                // The cache clearing already ensures fresh dependency data is loaded
                if (isDependencyNode && cached.expanded) {
                    this.logger.info(`${freshNode.type} node ${freshNode.path} was expanded, preserving expansion state with fresh data`);
                    // Keep the node expanded and preserve any fresh children data
                    freshNode.expanded = true;
                    freshNode.isLoaded = true; // Mark as loaded since we have fresh data
                    // Don't clear children - let the fresh dependency data be preserved
                }
            } else if (isDependencyNode) {
                this.logger.debug(`No cached state found for ${freshNode.type} node: ${freshNode.path}`);
            }

            // Always recursively process children even if no cached state found
            if (freshNode.children) {
                this.mergeNodeStates(freshNode.children, cachedMap);
            }
        }
    }
}