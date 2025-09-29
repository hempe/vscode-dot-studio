import * as path from 'path';
import { logger } from '../core/logger';

/**
 * Service for generating and managing unique expansion IDs for solution tree nodes
 * This prevents ID collisions between different node types (e.g. real folders vs virtual nodes)
 */
export class SolutionExpansionIdService {
    private static readonly logger = logger('SolutionExpansionIdService');

    // Prefixes for different node types to prevent collisions
    private static readonly PREFIXES = {
        solution: 'sol:',
        project: 'proj:',
        folder: 'folder:',
        file: 'file:',
        solutionFolder: 'solfld:',
        solutionItem: 'solitem:',
        dependencies: 'deps:',
        dependencyCategory: 'depcat:',
        dependency: 'dep:'
    };

    /**
     * Generates a unique expansion ID for a solution node
     */
    static generateSolutionId(solutionPath: string): string {
        return `${this.PREFIXES.solution}${solutionPath}`;
    }

    /**
     * Generates a unique expansion ID for a project node
     */
    static generateProjectId(projectPath: string): string {
        return `${this.PREFIXES.project}${projectPath}`;
    }

    /**
     * Generates a unique expansion ID for a folder node
     */
    static generateFolderId(folderPath: string, projectPath: string): string {
        // Include project path to make folder IDs unique across projects
        return `${this.PREFIXES.folder}${projectPath}:${folderPath}`;
    }

    /**
     * Generates a unique expansion ID for a file node
     */
    static generateFileId(filePath: string): string {
        return `${this.PREFIXES.file}${filePath}`;
    }

    /**
     * Generates a unique expansion ID for a solution folder node
     */
    static generateSolutionFolderId(guid: string, solutionPath: string): string {
        // Use GUID for solution folders as they have unique GUIDs
        return `${this.PREFIXES.solutionFolder}${solutionPath}:${guid}`;
    }

    /**
     * Generates a unique expansion ID for a solution item node
     */
    static generateSolutionItemId(itemPath: string, solutionFolderGuid: string): string {
        return `${this.PREFIXES.solutionItem}${solutionFolderGuid}:${itemPath}`;
    }

    /**
     * Generates a unique expansion ID for a dependencies node
     */
    static generateDependenciesId(projectPath: string): string {
        return `${this.PREFIXES.dependencies}${projectPath}`;
    }

    /**
     * Generates a unique expansion ID for a dependency category node
     */
    static generateDependencyCategoryId(projectPath: string, categoryName: string): string {
        return `${this.PREFIXES.dependencyCategory}${projectPath}:${categoryName.toLowerCase()}`;
    }

    /**
     * Generates a unique expansion ID for a dependency node
     */
    static generateDependencyId(projectPath: string, categoryName: string, dependencyName: string, version?: string): string {
        const versionSuffix = version ? `@${version}` : '';
        return `${this.PREFIXES.dependency}${projectPath}:${categoryName.toLowerCase()}:${dependencyName}${versionSuffix}`;
    }

    /**
     * Extracts the node type from an expansion ID
     */
    static getNodeTypeFromId(expansionId: string): string | null {
        for (const [nodeType, prefix] of Object.entries(this.PREFIXES)) {
            if (expansionId.startsWith(prefix)) {
                return nodeType;
            }
        }
        return null;
    }

    /**
     * Extracts the path portion from an expansion ID
     */
    static getPathFromId(expansionId: string): string | null {
        for (const prefix of Object.values(this.PREFIXES)) {
            if (expansionId.startsWith(prefix)) {
                return expansionId.substring(prefix.length);
            }
        }
        return null;
    }

    /**
     * Checks if an expansion ID represents a virtual node (non-filesystem)
     */
    static isVirtualNode(expansionId: string): boolean {
        return expansionId.startsWith(this.PREFIXES.dependencies) ||
               expansionId.startsWith(this.PREFIXES.dependencyCategory) ||
               expansionId.startsWith(this.PREFIXES.dependency) ||
               expansionId.startsWith(this.PREFIXES.solutionFolder);
    }

    /**
     * Extracts project path from dependency-related expansion IDs
     */
    static getProjectPathFromDependencyId(expansionId: string): string | null {
        if (expansionId.startsWith(this.PREFIXES.dependencies)) {
            return expansionId.substring(this.PREFIXES.dependencies.length);
        }

        if (expansionId.startsWith(this.PREFIXES.dependencyCategory) ||
            expansionId.startsWith(this.PREFIXES.dependency)) {
            const pathPortion = this.getPathFromId(expansionId);
            if (pathPortion) {
                // Extract project path before the first colon
                const colonIndex = pathPortion.indexOf(':');
                if (colonIndex > 0) {
                    return pathPortion.substring(0, colonIndex);
                }
            }
        }

        return null;
    }

    /**
     * Extracts category name from dependency category or dependency expansion IDs
     */
    static getCategoryFromDependencyId(expansionId: string): string | null {
        const pathPortion = this.getPathFromId(expansionId);
        if (!pathPortion) return null;

        if (expansionId.startsWith(this.PREFIXES.dependencyCategory)) {
            // Format: projectPath:categoryName
            const colonIndex = pathPortion.indexOf(':');
            if (colonIndex > 0) {
                return pathPortion.substring(colonIndex + 1);
            }
        }

        if (expansionId.startsWith(this.PREFIXES.dependency)) {
            // Format: projectPath:categoryName:dependencyName[@version]
            const parts = pathPortion.split(':');
            if (parts.length >= 3) {
                return parts[1];
            }
        }

        return null;
    }

    /**
     * Converts a nodeId to a file system path for folder and file types
     * Returns null for virtual nodes (dependencies, solution folders, etc.)
     */
    static nodeIdToPath(nodeId: string): string | null {
        const nodeType = this.getNodeTypeFromId(nodeId);

        if (!nodeType) return null;

        switch (nodeType) {
            case 'file':
                // file:/path/to/file.cs → /path/to/file.cs
                return this.getPathFromId(nodeId);

            case 'folder':
                // folder:/project/path:/folder/path → /folder/path
                const pathPortion = this.getPathFromId(nodeId);
                if (pathPortion) {
                    const colonIndex = pathPortion.indexOf(':');
                    if (colonIndex > 0) {
                        return pathPortion.substring(colonIndex + 1);
                    }
                }
                return pathPortion;

            case 'solution':
            case 'project':
                // These also have direct file system paths
                return this.getPathFromId(nodeId);

            default:
                // Virtual nodes (dependencies, solution folders) don't have file system paths
                return null;
        }
    }

    /**
     * Generates legacy path for backwards compatibility
     * This can be used during migration period
     */
    static generateLegacyPath(expansionId: string): string | null {
        const nodeType = this.getNodeTypeFromId(expansionId);
        const pathPortion = this.getPathFromId(expansionId);

        if (!nodeType || !pathPortion) return null;

        switch (nodeType) {
            case 'solution':
            case 'project':
            case 'folder':
            case 'file':
                return pathPortion;

            case 'dependencies':
                return `${pathPortion}/dependencies`;

            case 'dependencyCategory':
                const colonIndex = pathPortion.indexOf(':');
                if (colonIndex > 0) {
                    const projectPath = pathPortion.substring(0, colonIndex);
                    const categoryName = pathPortion.substring(colonIndex + 1);
                    return `${projectPath}/dependencies/${categoryName}`;
                }
                break;

            default:
                return pathPortion;
        }

        return null;
    }
}