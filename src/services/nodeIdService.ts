/**
 * Next-generation NodeId service using JSON structure with zlib compression
 * This replaces the string-based prefix system with a structured approach
 */

import { gzipSync, gunzipSync } from 'zlib';

// Branded type for NodeId strings to provide type safety
declare const __nodeIdBrand: unique symbol;
export type NodeIdString = { readonly [__nodeIdBrand]: true };

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

    static composeNodeId(nodeId: NodeId) {
        return this.compress(nodeId);
    }

    /**
     * Compress a NodeId object into a Base64 string using gzip
     */
    private static compress(nodeId: NodeId): NodeIdString {
        const json = JSON.stringify(nodeId);
        const compressed = gzipSync(Buffer.from(json, 'utf8'));
        return compressed.toString('base64') as unknown as NodeIdString;
    }

    /**
     * Decompress a Base64 gzip string back into a NodeId object
     */
    static parse(compressedNodeId: NodeIdString): NodeId {
        try {
            const buffer = Buffer.from(compressedNodeId as unknown as string, 'base64');
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
    static generateSolutionId(solutionPath: string): NodeIdString {
        return this.compress({
            type: 'solution',
            solutionPath
        });
    }

    /**
     * Generates a unique ID for a project node
     */
    static generateProjectId(projectPath: string): NodeIdString {
        return this.compress({
            type: 'project',
            projectPath
        });
    }

    /**
     * Generates a unique ID for a folder node
     */
    static generateFolderId(folderPath: string, projectPath: string): NodeIdString {
        return this.compress({
            type: 'folder',
            folderPath,
            projectPath
        });
    }

    /**
     * Generates a unique ID for a file node
     */
    static generateFileId(filePath: string, projectPath?: string): NodeIdString {
        return this.compress({
            type: 'file',
            filePath,
            projectPath
        });
    }

    /**
     * Generates a unique ID for a solution folder node
     */
    static generateSolutionFolderId(solutionPath: string, guid: string, parentGuid?: string): NodeIdString {
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
    static generateSolutionItemId(solutionFolderGuid: string, itemPath: string): NodeIdString {
        return this.compress({
            type: 'solutionItem',
            guid: solutionFolderGuid,
            itemPath
        });
    }

    /**
     * Generates a unique ID for a project dependencies container
     */
    static generateDependenciesId(projectPath: string): NodeIdString {
        return this.compress({
            type: 'dependencies',
            projectPath
        });
    }

    /**
     * Generates a unique ID for a dependency category
     */
    static generateDependencyCategoryId(projectPath: string, categoryName: string): NodeIdString {
        return this.compress({
            type: 'dependencyCategory',
            projectPath,
            categoryName
        });
    }

    /**
     * Generates a unique ID for a specific dependency
     */
    static generateDependencyId(projectPath: string, categoryName: string, dependencyName: string, version?: string): NodeIdString {
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
    static generateTemporaryId(nodeType: string, parentPath: string): NodeIdString {
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
    static getProjectPathFromNodeId(nodeId: NodeIdString): string | null {
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
    static getSolutionPathFromNodeId(nodeId: NodeIdString): string | null {
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
    static getFilePathFromNodeId(nodeId: NodeIdString): string | null {
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
    static getFolderPathFromNodeId(nodeId: NodeIdString): string | null {
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
    static getDependencyInfoFromNodeId(nodeId: NodeIdString): { projectPath: string; dependencyName: string; dependencyType: string; version?: string } | null {
        try {
            const parsed = this.parse(nodeId);
            return this.getDependencyInfoFromNode(parsed);
        } catch {
            return null;
        }
    }

    static getDependencyInfoFromNode(node: NodeId): { projectPath: string; dependencyName: string; dependencyType: string; version?: string } | null {
        if (node.type === 'dependency' && node.projectPath && node.categoryName && node.dependencyName) {
            return {
                projectPath: node.projectPath,
                dependencyName: node.dependencyName,
                dependencyType: node.categoryName, // Map categoryName to dependencyType for backward compatibility
                version: node.version
            };
        }
        return null;
    }

    // Type checking methods

    /**
     * Checks if nodeId represents a temporary node
     */
    static isTemporary(nodeId: NodeIdString): boolean {
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
    static isFolder(nodeId: NodeIdString): boolean {
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
    static isProject(nodeId: NodeIdString): boolean {
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
    static isFile(nodeId: NodeIdString): boolean {
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
    static isSolution(nodeId: NodeIdString): boolean {
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
    static isSolutionFolder(nodeId: NodeIdString): boolean {
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
    static isDependencies(nodeId: NodeIdString): boolean {
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
    static isDependencyCategory(nodeId: NodeIdString): boolean {
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
    static isDependency(nodeId: NodeIdString): boolean {
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
    static getNodeType(nodeId: NodeIdString): NodeType | null {
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
    static getFullInfo(nodeId: NodeIdString): NodeId | null {
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
    static getPathFromId(nodeId: NodeIdString): string | null {
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
    static nodeIdToPath(nodeId: NodeIdString): string | null {
        return this.getPathFromId(nodeId);
    }

    /**
     * Gets the node type from a nodeId
     * @deprecated Use getNodeType instead
     */
    static getNodeTypeFromId(nodeId: NodeIdString): string | null {
        return this.getNodeType(nodeId);
    }

    /**
     * Alias for isTemporary for backward compatibility
     */
    static isTemporaryNode(nodeId: NodeIdString): boolean {
        return this.isTemporary(nodeId);
    }

    /**
     * Alias for isFolder for backward compatibility
     */
    static isFolderNode(nodeId: NodeIdString): boolean {
        return this.isFolder(nodeId);
    }

    /**
     * Gets temporary node information
     */
    static getTemporaryNodeInfo(nodeId: NodeIdString): { nodeType: string; parentPath: string } | null {
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
    static getProjectPathFromDependencyId(nodeId: NodeIdString): string | null {
        return this.getProjectPathFromNodeId(nodeId);
    }

    /**
     * Creates a NodeIdString from a raw string (used internally for casting)
     * External code should not use this - use generation methods instead
     */
    static fromString(str: string): NodeIdString {
        return str as unknown as NodeIdString;
    }

    /**
     * Converts a NodeIdString to a raw string (used internally for operations that need string)
     * External code should not use this - use utility methods instead
     */
    static toString(nodeId: NodeIdString): string {
        return nodeId as unknown as string;
    }

    /**
     * Gets the length of a nodeId string (for testing purposes)
     */
    static getLength(nodeId: NodeIdString): number {
        return (nodeId as unknown as string).length;
    }

    /**
     * Checks if nodeId is valid by attempting to parse it
     */
    static isValid(nodeId: NodeIdString): boolean {
        try {
            this.parse(nodeId);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Converts a NodeIdString to a React key (string)
     * This is the only proper way to get a string for React key usage
     */
    static toKey(nodeId: NodeIdString): string {
        return nodeId as unknown as string;
    }

    /**
     * Converts a React key string back to NodeIdString
     * Only for use when you have a string that you know came from toKey()
     */
    static fromKey(key: string): NodeIdString {
        return key as unknown as NodeIdString;
    }
}