import * as path from 'path';
import { SolutionProject } from '../parsers/solutionFileParser';
import { Solution } from '../core/Solution';
import { Mutable, ProjectChild, ProjectNode } from '../types';
import { NodeId, NodeIdService, SolutionFolderNodeId } from './nodeIdService';
import { logger } from '../core/logger';
import { NodeIdString } from '../types/nodeId';

const log = logger('SolutionTreeService');

/**
 * Service responsible for building and managing solution tree structures
 * Extracted from SolutionWebviewProvider to improve maintainability
 */
export class SolutionTreeService {

    /**
     * Builds a complete solution tree from Solution data
     */
    static async buildSolutionTree(solution: Solution): Promise<ProjectNode[]> {
        const solutionPath = solution.solutionPath;

        const solutionFile = solution.solutionFile;
        if (!solutionFile) {
            return [];
        }

        // Get the startup project path from cache
        const startupProjectPath = solution.getStartupProject();
        log.info(`Startup project path from cache: ${startupProjectPath}`);

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

        log.info(`Building lazy-loaded tree structure for: ${solutionPath}`);

        // Add the solution as the root node
        const solutionNode: Mutable<ProjectNode> = {
            type: 'solution',
            name: path.basename(solutionPath, '.sln'),
            nodeId: NodeIdService.generateSolutionId(solutionPath),
            children: []
        };

        // Get root level projects and solution folders from hierarchy
        const rootProjects = hierarchy.get('ROOT') || [];
        log.info(`Found ${rootProjects.length} root-level items`);

        // Build tree using lazy loading approach
        solutionNode.children = await this.buildLazyHierarchicalNodes(rootProjects, hierarchy, solution, solutionNode.nodeId, startupProjectPath);

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
        parentExpansionId: NodeIdString | undefined,
        startupProjectPath?: string | null
    ): Promise<ProjectNode[]> {
        const nodes: ProjectNode[] = [];

        for (const project of projects) {
            // Determine the item type based on typeGuid
            const itemType = this.getItemType(project.typeGuid);
            log.info(`Processing ${itemType}: ${project.name}, type GUID: ${project.typeGuid}`);

            // Ensure path is absolute (for both projects and solution items)
            const absolutePath = this.resolveAbsolutePath(project.path || '', solution.solutionPath);
            log.info(`Path resolution: ${project.path} -> ${absolutePath}`);

            // Generate expansion ID based on node type
            let nodeId: NodeIdString;
            if (itemType === 'project') {
                nodeId = NodeIdService.generateProjectId(absolutePath);
            } else if (itemType === 'solutionFolder') {
                // Include parent hierarchy in solution folder ID for proper nesting support
                nodeId = NodeIdService.generateSolutionFolderId(
                    project.name || path.basename(project.path || '', path.extname(project.path || '')),
                    solution.solutionPath,
                    project.guid || project.name,
                    parentExpansionId ? (NodeIdService.parse(parentExpansionId) as SolutionFolderNodeId)?.guid : undefined
                );
            } else {
                // Fallback for other types - use temporary ID
                nodeId = NodeIdService.generateTemporaryId(itemType, absolutePath);
            }

            const itemNode: Mutable<ProjectNode> = {
                type: itemType,
                name: project.name || path.basename(project.path || '', path.extname(project.path || '')),
                nodeId: nodeId,
                children: [],
                // Add framework information if available
                frameworks: project.targetFrameworks || [],
                // Store original typeGuid for debugging
                typeGuid: project.typeGuid,
                // Mark as not loaded for lazy loading
                isLoaded: false,
                // Mark if this is the startup project (only for actual projects)
                isStartupProject: itemType === 'project' && absolutePath === startupProjectPath,
            };

            // Check if project nodes actually have children (optimized check)
            if (itemType === 'project') {
                try {
                    const projectInstance = solution.getProject(absolutePath);
                    if (projectInstance) {
                        const hasFiles = await projectInstance.hasAnyChildren();
                        itemNode.hasChildren = hasFiles;
                        log.info(`Project ${project.name} has children: ${hasFiles}`);
                    } else {
                        log.warn(`Could not find project instance for: ${absolutePath}`);
                        // For projects, assume they have children if we can't check
                        itemNode.hasChildren = true;
                    }
                } catch (error) {
                    log.warn(`Could not check children for project ${project.name}: ${error}`);
                    // For projects, assume they have children if there's an error
                    itemNode.hasChildren = true;
                }

                // Project always has Dependencies node - this will be provided by the Project class when expanded
            }
            // Handle solution folders - add their children recursively like the original
            else if (itemType === 'solutionFolder') {
                const childProjects = hierarchy.get(project.guid) || [];
                log.info(`Solution folder ${project.name} has ${childProjects.length} children`);

                if (childProjects.length > 0) {
                    itemNode.children = await this.buildLazyHierarchicalNodes(childProjects, hierarchy, solution, nodeId, startupProjectPath);
                }

                // Add solution items (files directly in the solution folder)
                const solutionItems = solution.getSolutionItems(project);
                log.info(`Solution folder ${project.name} has ${solutionItems.length} solution items`);

                if (!itemNode.children) {
                    itemNode.children = [];
                }

                for (const itemPath of solutionItems) {
                    const itemName = path.basename(itemPath);
                    const absoluteItemPath = path.resolve(path.dirname(solution.solutionPath), itemPath);
                    itemNode.children.push({
                        type: 'solutionItem',
                        name: itemName,
                        nodeId: NodeIdService.generateSolutionItemId(
                            itemName,
                            project.guid || project.name,
                            absoluteItemPath
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
     * Updates a specific node in the tree structure using expansion ID
     */
    static updateNodeInTree(nodes: ProjectNode[], nodeId: NodeIdString, updates: Partial<ProjectNode>, expandedIds?: Set<NodeIdString>): boolean {
        let changed = false;
        for (const node of nodes) {
            const p = NodeIdService.parse(node.nodeId);
            log.info("Check ", p.path);
            if (node.nodeId === nodeId) {
                Object.assign(node, updates);
                if (!expandedIds)
                    return true

                changed = true;
            }

            if (expandedIds && !node.expanded && expandedIds.has(node.nodeId)) {
                node.expanded = true;
            }

            if (node.children) {
                changed = this.updateNodeInTree(node.children, nodeId, updates, expandedIds) || changed;
            }
        }

        return changed;
    }


    /**
     * Finds a node in the tree by expansion ID
     */
    static findNodeById(nodeId: NodeIdString, nodes: ProjectNode[]): ProjectNode | null {
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
     * Converts Project children to ProjectNode format
     * This method handles the generic project children from Project class methods
     */
    static convertProjectChildrenToProjectNodes(children: ProjectChild[]): ProjectNode[] {
        return children.map(child => {
            let nodeType: ProjectNode['type'] = 'file';

            // Handle the different child types
            if (child.type === 'folder') {
                nodeType = 'folder';
            } else if (child.type === 'dependencies') {
                nodeType = 'dependencies';
            } else if (child.type === 'dependencyCategory') {
                nodeType = 'dependencyCategory';
            } else if (child.type === 'dependency') {
                nodeType = 'dependency';
            } else {
                nodeType = 'file';
            }

            return {
                type: nodeType,
                name: child.name,
                nodeId: child.nodeId,
                isLoaded: child.isLoaded,
                hasChildren: child.hasChildren || !!child.children?.length,
                expanded: child.expanded,
                children: child.children ? this.convertProjectChildrenToProjectNodes(child.children) : undefined
            };
        });
    }


    // Private helper methods

    private static getItemType(typeGuid?: string): NodeId['type'] {
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
}