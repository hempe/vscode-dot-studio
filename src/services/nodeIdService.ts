/**
 * Next-generation NodeId service using JSON structure with zlib compression
 * This replaces the string-based prefix system with a structured approach
 */

import { gzipSync, gunzipSync } from 'zlib';
import { NodeIdString } from '../types/nodeId';


// Define the structure of a NodeId
export declare type SolutionNodeId = {
    readonly type: 'solution';
    readonly path: string;
}
export declare type ProjectNodeId = {
    readonly type: 'project';
    readonly path: string;
}

export declare type FolderNodeId = {
    readonly type: 'folder';
    readonly path: string;
}

export declare type FileNodeId = {
    readonly type: 'file';
    readonly path: string;
}

export declare type SolutionFolderNodeId = {
    readonly type: 'solutionFolder';
    readonly name: string;
    readonly path: string;
    readonly guid: string;
    readonly parentGuid: string | undefined;
}

export declare type SolutionItemNodeId = {
    readonly type: 'solutionItem',
    readonly name: string;
    readonly guid: string;
    readonly path: string;
}

export declare type TemporaryNodeId = {
    readonly type: 'temporary';
    readonly path: string;
    readonly nodeType: string;
    readonly random: string;
    readonly timestamp: number;
}

export declare type DependenciesNodeId = {
    readonly type: 'dependencies';
    readonly path: string;
}

export declare type DependencyNodeId = {
    readonly type: 'dependency';
    readonly path: string;
    readonly category: string;
    readonly name: string;
    readonly version?: string
}

export declare type DependencyCategoryNodeId = {
    readonly type: 'dependencyCategory';
    readonly path: string;
    readonly name: string;
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
            path: solutionPath
        });
    }

    /**
     * Generates a unique ID for a project node
     */
    static generateProjectId(projectPath: string): NodeIdString {
        return this.compress({
            type: 'project',
            path: projectPath
        });
    }

    /**
     * Generates a unique ID for a folder node
     */
    static generateFolderId(folderPath: string): NodeIdString {
        return this.compress({
            type: 'folder',
            path: folderPath
        });
    }

    /**
     * Generates a unique ID for a file node
     */
    static generateFileId(filePath: string): NodeIdString {
        return this.compress({
            type: 'file',
            path: filePath
        });
    }

    /**
     * Generates a unique ID for a solution folder node
     */
    static generateSolutionFolderId(solutionItemName: string, solutionPath: string, guid: string, parentGuid?: string): NodeIdString {
        return this.compress({
            type: 'solutionFolder',
            name: solutionItemName,
            path: solutionPath,
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
            name: solutionItemName,
            guid: solutionFolderGuid,
            path: itemPath
        });
    }

    /**
     * Generates a unique ID for a project dependencies container
     */
    static generateDependenciesId(projectPath: string): NodeIdString {
        return this.compress({
            type: 'dependencies',
            path: projectPath
        });
    }

    /**
     * Generates a unique ID for a dependency category
     */
    static generateDependencyCategoryId(projectPath: string, categoryName: string): NodeIdString {
        return this.compress({
            type: 'dependencyCategory',
            path: projectPath,
            name: categoryName
        });
    }

    /**
     * Generates a unique ID for a specific dependency
     */
    static generateDependencyId(projectPath: string, categoryName: string, dependencyName: string, version?: string): NodeIdString {
        return this.compress({
            type: 'dependency',
            path: projectPath,
            category: categoryName,
            name: dependencyName,
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
            path: parentPath, // Using folderPath as generic parent path
            nodeType, // Using categoryName as generic node type
            timestamp,
            random
        });
    }


    static getDependencyInfoFromNode(node: NodeId): { projectPath: string; dependencyName: string; dependencyType: string; version?: string } | null {
        if (node.type === 'dependency' && node.path && node.category && node.name) {
            return {
                projectPath: node.path,
                dependencyName: node.name,
                dependencyType: node.category, // Map categoryName to dependencyType for backward compatibility
                version: node.version
            };
        }
        return null;
    }

    static isValid(compressedNodeId: NodeIdString) {
        try {
            return !!this.parse(compressedNodeId);
        }
        catch {
            return false;
        }
    }
}