/**
 * Next-generation NodeId service using JSON structure with zlib compression
 * This replaces the string-based prefix system with a structured approach
 */

import { gzipSync, gunzipSync } from 'zlib';

// Define the structure of a NodeId
export interface NodeId {
    type: NodeType;
    solutionPath?: string;
    projectPath?: string;
    filePath?: string;
    folderPath?: string;
    guid?: string;
    parentGuid?: string;
    categoryName?: string;
    dependencyName?: string;
    version?: string;
    itemPath?: string;
    timestamp?: number;
    random?: string;
}

export type NodeType =
    | 'solution'
    | 'project'
    | 'folder'
    | 'file'
    | 'solutionFolder'
    | 'solutionItem'
    | 'dependencies'
    | 'dependencyCategory'
    | 'dependency'
    | 'temporary';

/**
 * Service for generating and managing structured node IDs with compression
 */
export class NodeIdService {

    /**
     * Compress a NodeId object into a Base64 string using gzip
     */
    private static compress(nodeId: NodeId): string {
        const json = JSON.stringify(nodeId);
        const compressed = gzipSync(Buffer.from(json, 'utf8'));
        return compressed.toString('base64');
    }

    /**
     * Decompress a Base64 gzip string back into a NodeId object
     */
    static parse(compressedNodeId: string): NodeId {
        try {
            const buffer = Buffer.from(compressedNodeId, 'base64');
            const decompressed = gunzipSync(buffer).toString('utf8');
            return JSON.parse(decompressed) as NodeId;
        } catch (error) {
            throw new Error(`Failed to parse nodeId: ${error}`);
        }
    }

    // Alias for backward compatibility
    static parseNodeId = NodeIdService.parse;

    /**
     * Generates a unique ID for a solution node
     */
    static generateSolutionId(solutionPath: string): string {
        return this.compress({
            type: 'solution',
            solutionPath
        });
    }

    /**
     * Generates a unique ID for a project node
     */
    static generateProjectId(projectPath: string): string {
        return this.compress({
            type: 'project',
            projectPath
        });
    }

    /**
     * Generates a unique ID for a folder node
     */
    static generateFolderId(folderPath: string, projectPath: string): string {
        return this.compress({
            type: 'folder',
            folderPath,
            projectPath
        });
    }

    /**
     * Generates a unique ID for a file node
     */
    static generateFileId(filePath: string, projectPath?: string): string {
        return this.compress({
            type: 'file',
            filePath,
            projectPath
        });
    }

    /**
     * Generates a unique ID for a solution folder node
     */
    static generateSolutionFolderId(solutionPath: string, guid: string, parentGuid?: string): string {
        return this.compress({
            type: 'solutionFolder',
            solutionPath,
            guid,
            parentGuid
        });
    }

    /**
     * Generates a unique ID for a solution item node
     */
    static generateSolutionItemId(solutionFolderGuid: string, itemPath: string): string {
        return this.compress({
            type: 'solutionItem',
            guid: solutionFolderGuid,
            itemPath
        });
    }

    /**
     * Generates a unique ID for a project dependencies container
     */
    static generateDependenciesId(projectPath: string): string {
        return this.compress({
            type: 'dependencies',
            projectPath
        });
    }

    /**
     * Generates a unique ID for a dependency category
     */
    static generateDependencyCategoryId(projectPath: string, categoryName: string): string {
        return this.compress({
            type: 'dependencyCategory',
            projectPath,
            categoryName
        });
    }

    /**
     * Generates a unique ID for a specific dependency
     */
    static generateDependencyId(projectPath: string, categoryName: string, dependencyName: string, version?: string): string {
        return this.compress({
            type: 'dependency',
            projectPath,
            categoryName,
            dependencyName,
            version
        });
    }

    /**
     * Generates a unique ID for temporary nodes
     */
    static generateTemporaryId(nodeType: string, parentPath: string): string {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);

        return this.compress({
            type: 'temporary',
            folderPath: parentPath, // Using folderPath as generic parent path
            categoryName: nodeType, // Using categoryName as generic node type
            timestamp,
            random
        });
    }

    // Utility methods for extracting information from nodeIds

    /**
     * Extracts project path from any nodeId that contains it
     */
    static getProjectPathFromNodeId(nodeId: string): string | null {
        try {
            const parsed = this.parse(nodeId);
            return parsed.projectPath || null;
        } catch {
            return null;
        }
    }

    /**
     * Extracts solution path from any nodeId that contains it
     */
    static getSolutionPathFromNodeId(nodeId: string): string | null {
        try {
            const parsed = this.parse(nodeId);
            return parsed.solutionPath || null;
        } catch {
            return null;
        }
    }

    /**
     * Extracts file path from a file nodeId
     */
    static getFilePathFromNodeId(nodeId: string): string | null {
        try {
            const parsed = this.parse(nodeId);
            return parsed.type === 'file' ? parsed.filePath || null : null;
        } catch {
            return null;
        }
    }

    /**
     * Extracts folder path from a folder nodeId
     */
    static getFolderPathFromNodeId(nodeId: string): string | null {
        try {
            const parsed = this.parse(nodeId);
            return parsed.type === 'folder' ? parsed.folderPath || null : null;
        } catch {
            return null;
        }
    }

    /**
     * Extracts dependency information from a dependency nodeId
     */
    static getDependencyInfoFromNodeId(nodeId: string): { projectPath: string; dependencyName: string; dependencyType: string; version?: string } | null {
        try {
            const parsed = this.parse(nodeId);
            if (parsed.type === 'dependency' && parsed.projectPath && parsed.categoryName && parsed.dependencyName) {
                return {
                    projectPath: parsed.projectPath,
                    dependencyName: parsed.dependencyName,
                    dependencyType: parsed.categoryName, // Map categoryName to dependencyType for backward compatibility
                    version: parsed.version
                };
            }
            return null;
        } catch {
            return null;
        }
    }

    // Type checking methods

    /**
     * Checks if nodeId represents a temporary node
     */
    static isTemporary(nodeId: string): boolean {
        try {
            const parsed = this.parse(nodeId);
            return parsed.type === 'temporary';
        } catch {
            return false;
        }
    }

    /**
     * Checks if nodeId represents a folder
     */
    static isFolder(nodeId: string): boolean {
        try {
            const parsed = this.parse(nodeId);
            return parsed.type === 'folder';
        } catch {
            return false;
        }
    }

    /**
     * Checks if nodeId represents a project
     */
    static isProject(nodeId: string): boolean {
        try {
            const parsed = this.parse(nodeId);
            return parsed.type === 'project';
        } catch {
            return false;
        }
    }

    /**
     * Checks if nodeId represents a file
     */
    static isFile(nodeId: string): boolean {
        try {
            const parsed = this.parse(nodeId);
            return parsed.type === 'file';
        } catch {
            return false;
        }
    }

    /**
     * Checks if nodeId represents a solution
     */
    static isSolution(nodeId: string): boolean {
        try {
            const parsed = this.parse(nodeId);
            return parsed.type === 'solution';
        } catch {
            return false;
        }
    }

    /**
     * Checks if nodeId represents a solution folder
     */
    static isSolutionFolder(nodeId: string): boolean {
        try {
            const parsed = this.parse(nodeId);
            return parsed.type === 'solutionFolder';
        } catch {
            return false;
        }
    }

    /**
     * Checks if nodeId represents dependencies container
     */
    static isDependencies(nodeId: string): boolean {
        try {
            const parsed = this.parse(nodeId);
            return parsed.type === 'dependencies';
        } catch {
            return false;
        }
    }

    /**
     * Checks if nodeId represents a dependency category
     */
    static isDependencyCategory(nodeId: string): boolean {
        try {
            const parsed = this.parse(nodeId);
            return parsed.type === 'dependencyCategory';
        } catch {
            return false;
        }
    }

    /**
     * Checks if nodeId represents a specific dependency
     */
    static isDependency(nodeId: string): boolean {
        try {
            const parsed = this.parse(nodeId);
            return parsed.type === 'dependency';
        } catch {
            return false;
        }
    }

    /**
     * Gets the type of a nodeId
     */
    static getNodeType(nodeId: string): NodeType | null {
        try {
            const parsed = this.parse(nodeId);
            return parsed.type;
        } catch {
            return null;
        }
    }

    /**
     * Helper method to get all available information from a nodeId
     */
    static getFullInfo(nodeId: string): NodeId | null {
        try {
            return this.parse(nodeId);
        } catch {
            return null;
        }
    }

    // Backward compatibility methods for existing API

    /**
     * Extracts the primary path from a nodeId (filePath, folderPath, projectPath, etc.)
     * @deprecated Use specific path extraction methods instead
     */
    static getPathFromId(nodeId: string): string | null {
        try {
            const parsed = this.parse(nodeId);
            return parsed.filePath || parsed.folderPath || parsed.projectPath || parsed.solutionPath || null;
        } catch {
            return null;
        }
    }

    /**
     * Alias for getPathFromId for backward compatibility
     * @deprecated Use specific path extraction methods instead
     */
    static nodeIdToPath(nodeId: string): string | null {
        return this.getPathFromId(nodeId);
    }

    /**
     * Gets the node type from a nodeId
     * @deprecated Use getNodeType instead
     */
    static getNodeTypeFromId(nodeId: string): string | null {
        return this.getNodeType(nodeId);
    }

    /**
     * Alias for isTemporary for backward compatibility
     */
    static isTemporaryNode(nodeId: string): boolean {
        return this.isTemporary(nodeId);
    }

    /**
     * Alias for isFolder for backward compatibility
     */
    static isFolderNode(nodeId: string): boolean {
        return this.isFolder(nodeId);
    }

    /**
     * Gets temporary node information
     */
    static getTemporaryNodeInfo(nodeId: string): { nodeType: string; parentPath: string } | null {
        try {
            const parsed = this.parse(nodeId);
            if (parsed.type === 'temporary') {
                return {
                    nodeType: parsed.categoryName || 'unknown',
                    parentPath: parsed.folderPath || ''
                };
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Extracts project path from dependency-related nodeIds
     * @deprecated Use getProjectPathFromNodeId instead
     */
    static getProjectPathFromDependencyId(nodeId: string): string | null {
        return this.getProjectPathFromNodeId(nodeId);
    }
}