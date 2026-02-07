/**
 * Next-generation NodeId service using JSON structure with zlib compression
 * This replaces the string-based prefix system with a structured approach
 */

import { gzipSync, gunzipSync } from 'zlib';
import { NodeIdString } from '../types/nodeId';


// Define the structure of a NodeId
export declare type SolutionNodeId = {
    readonly type: 'solution';
    readonly solutionPath: string;
}
export declare type ProjectNodeId = {
    readonly type: 'project';
    readonly projectPath: string;
}

export declare type FolderNodeId = {
    readonly type: 'folder';
    readonly projectPath: string;
    readonly folderPath: string;
}

export declare type FileNodeId = {
    readonly type: 'file';
    readonly filePath: string;
}

export declare type SolutionFolderNodeId = {
    readonly type: 'solutionFolder';
    readonly solutionItemName: string;
    readonly solutionPath: string;
    readonly guid: string;
    readonly parentGuid: string | undefined;
}

export declare type SolutionItemNodeId = {
    readonly type: 'solutionItem',
    readonly solutionItemName: string;
    readonly guid: string;
    readonly itemPath: string;
}


export declare type TemporaryNodeId = {
    readonly type: 'temporary';
    readonly folderPath: string;
    readonly nodeType: string;
    readonly random: string;
    readonly timestamp: number;
}

export declare type DependenciesNodeId = {
    readonly type: 'dependencies';
    readonly projectPath: string;
}

export declare type DependencyNodeId = {
    readonly type: 'dependency';
    readonly projectPath: string;
    readonly categoryName: string;
    readonly dependencyName: string;
    readonly version?: string
}

export declare type DependencyCategoryNodeId = {
    readonly type: 'dependencyCategory';
    readonly projectPath: string;
    readonly categoryName: string;
}

export declare type NodeId =
    SolutionNodeId |
    SolutionItemNodeId |
    ProjectNodeId |
    FolderNodeId |
    FileNodeId |
    SolutionFolderNodeId |
    TemporaryNodeId |
    DependencyNodeId |
    DependenciesNodeId |
    DependencyCategoryNodeId;

/**
 * Service for generating and managing structured node IDs with compression
 */
export class NodeIdService {

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
    static generateFileId(filePath: string): NodeIdString {
        return this.compress({
            type: 'file',
            filePath
        });
    }

    /**
     * Generates a unique ID for a solution folder node
     */
    static generateSolutionFolderId(solutionItemName: string, solutionPath: string, guid: string, parentGuid?: string): NodeIdString {
        return this.compress({
            type: 'solutionFolder',
            solutionItemName,
            solutionPath,
            guid,
            parentGuid
        });
    }

    /**
     * Generates a unique ID for a solution item node
     */
    static generateSolutionItemId(solutionItemName: string, solutionFolderGuid: string, itemPath: string): NodeIdString {
        return this.compress({
            type: 'solutionItem',
            solutionItemName,
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
            nodeType, // Using categoryName as generic node type
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
            const parsed = this.parse(nodeId) as ProjectNodeId;
            return parsed.projectPath || null;
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

    // Backward compatibility methods for existing API

    /**
     * Extracts the primary path from a nodeId (filePath, folderPath, projectPath, etc.)
     * @deprecated Use specific path extraction methods instead
     */
    static getPathFromId(nodeId: NodeIdString): string | null {
        try {
            const parsed = this.parse(nodeId) as any;
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
                    nodeType: parsed.nodeType || 'unknown',
                    parentPath: parsed.folderPath || ''
                };
            }
            return null;
        } catch {
            return null;
        }
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
}