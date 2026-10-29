/**
 * NodeId service: tree node ids are typed JSON objects, encoded as opaque base64url strings
 */

import { gunzipSync } from 'zlib';
import { NodeIdString } from '../../types/nodeId';

/** How gzip data starts in base64: the node ids of older versions */
const GZIP_PREFIX = 'H4sI';


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
    /**
     * The project whose tree shows the folder, when the path alone would name another one: a folder in the folder
     * of a nested project, shown in the outer project's tree. Absent otherwise (the deepest project around the path).
     */
    readonly project?: string;
}

export declare type FileNodeId = {
    readonly type: 'file';
    readonly path: string;
    /** The project whose tree shows the file, when the path alone would name another one (see FolderNodeId) */
    readonly project?: string;
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

/** An analyzer or source generator assembly under Dependencies > Analyzers */
export declare type AnalyzerNodeId = {
    readonly type: 'analyzer';
    /** The project */
    readonly path: string;
    readonly name: string;
}

/** A source generator of an analyzer assembly */
export declare type SourceGeneratorNodeId = {
    readonly type: 'sourceGenerator';
    /** The project */
    readonly path: string;
    readonly analyzer: string;
    readonly name: string;
}

/** A package a package depends on, under Dependencies > Packages; `parents` makes it unique in the tree */
export declare type TransitivePackageNodeId = {
    readonly type: 'transitivePackage';
    /** The project */
    readonly path: string;
    /** Ids from the top-level package down to the parent of this one */
    readonly parents: string[];
    readonly name: string;
    readonly version: string;
}

/** A file a source generator wrote in the last build */
export declare type GeneratedFileNodeId = {
    readonly type: 'generatedFile';
    readonly path: string;
}

/** Connected Services of a project that has gRPC references but no `Connected Services` folder on disk */
export declare type ConnectedServicesNodeId = {
    readonly type: 'connectedServices';
    /** The project */
    readonly path: string;
}

/** A gRPC reference (a `Protobuf` item) in Connected Services */
export declare type GrpcReferenceNodeId = {
    readonly type: 'grpcReference';
    /** The `.proto` file (Open opens it) */
    readonly path: string;
    readonly project: string;
}

/** A shared framework the project uses (`Microsoft.NETCore.App`, `Microsoft.AspNetCore.App`), under Dependencies > Frameworks */
export declare type FrameworkReferenceNodeId = {
    readonly type: 'frameworkReference';
    /** The project */
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
    DependencyCategoryNodeId |
    AnalyzerNodeId |
    SourceGeneratorNodeId |
    GeneratedFileNodeId |
    TransitivePackageNodeId |
    ConnectedServicesNodeId |
    GrpcReferenceNodeId |
    FrameworkReferenceNodeId;

/**
 * Service for generating and reading structured node IDs
 */
export class NodeIdService {

    /**
     * Compress a NodeId object into a Base64 string using gzip
     */
    /**
     * Encodes a NodeId as base64url JSON: opaque, so the webview can't come to depend on what an id contains
     * (a test checks it never decodes one), but cheap to read here, unlike the gzip ids before
     */
    private static encode(nodeId: NodeId): NodeIdString {
        return Buffer.from(JSON.stringify(nodeId), 'utf8').toString('base64url') as unknown as NodeIdString;
    }

    /** Reads a NodeId; also the gzipped ids of older versions (kept in the workspace's expansion state) */
    static parse(nodeId: NodeIdString): NodeId {
        try {
            const text = nodeId as unknown as string;
            const json = text.startsWith(GZIP_PREFIX)
                ? gunzipSync(Buffer.from(text, 'base64')).toString('utf8')
                : Buffer.from(text, 'base64url').toString('utf8');
            return JSON.parse(json) as NodeId;
        } catch (error) {
            throw new Error(`Failed to parse nodeId: ${error}`);
        }
    }

    /** Like `parse`, but undefined for anything that is not a node id */
    static tryParse(nodeId: NodeIdString): NodeId | undefined {
        try {
            return this.parse(nodeId);
        } catch {
            return undefined;
        }
    }

    /**
     * Generates a unique ID for a solution node
     */
    static generateSolutionId(solutionPath: string): NodeIdString {
        return this.encode({
            type: 'solution',
            path: solutionPath
        });
    }

    /**
     * Generates a unique ID for a project node
     */
    static generateProjectId(projectPath: string): NodeIdString {
        return this.encode({
            type: 'project',
            path: projectPath
        });
    }

    /**
     * Generates a unique ID for a folder node
     */
    static generateFolderId(folderPath: string, project?: string): NodeIdString {
        return this.encode({
            type: 'folder',
            path: folderPath,
            ...(project ? { project } : {}),
        });
    }

    /**
     * Generates a unique ID for a file node
     */
    static generateFileId(filePath: string, project?: string): NodeIdString {
        return this.encode({
            type: 'file',
            path: filePath,
            ...(project ? { project } : {}),
        });
    }

    /**
     * Generates a unique ID for a solution folder node
     */
    static generateSolutionFolderId(solutionItemName: string, solutionPath: string, guid: string, parentGuid?: string): NodeIdString {
        return this.encode({
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
        return this.encode({
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
        return this.encode({
            type: 'dependencies',
            path: projectPath
        });
    }

    /**
     * Generates a unique ID for a dependency category
     */
    static generateDependencyCategoryId(projectPath: string, categoryName: string): NodeIdString {
        return this.encode({
            type: 'dependencyCategory',
            path: projectPath,
            name: categoryName
        });
    }

    /**
     * Generates a unique ID for a specific dependency
     */
    static generateDependencyId(projectPath: string, categoryName: string, dependencyName: string, version?: string): NodeIdString {
        return this.encode({
            type: 'dependency',
            path: projectPath,
            category: categoryName,
            name: dependencyName,
            version
        });
    }

    static generateAnalyzerId(projectPath: string, name: string): NodeIdString {
        return this.encode({ type: 'analyzer', path: projectPath, name });
    }

    static generateSourceGeneratorId(projectPath: string, analyzer: string, name: string): NodeIdString {
        return this.encode({ type: 'sourceGenerator', path: projectPath, analyzer, name });
    }

    static generateTransitivePackageId(projectPath: string, parents: string[], name: string, version: string): NodeIdString {
        return this.encode({ type: 'transitivePackage', path: projectPath, parents, name, version });
    }

    static generateFrameworkReferenceId(projectPath: string, name: string): NodeIdString {
        return this.encode({ type: 'frameworkReference', path: projectPath, name });
    }

    static generateGeneratedFileId(filePath: string): NodeIdString {
        return this.encode({ type: 'generatedFile', path: filePath });
    }

    static generateConnectedServicesId(projectPath: string): NodeIdString {
        return this.encode({ type: 'connectedServices', path: projectPath });
    }

    static generateGrpcReferenceId(projectPath: string, protoPath: string): NodeIdString {
        return this.encode({ type: 'grpcReference', path: protoPath, project: projectPath });
    }

    /**
     * Generates a unique ID for temporary nodes
     */
    static generateTemporaryId(nodeType: string, parentPath: string): NodeIdString {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);

        return this.encode({
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

    static isValid(nodeId: NodeIdString) {
        try {
            return !!this.parse(nodeId);
        }
        catch {
            return false;
        }
    }
}