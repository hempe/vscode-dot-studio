import { NodeType, ProjectNode } from "."
import { NuGetPackage, ProjectInfo } from "../services/nuget/types"
import { LocalNuGetPackage } from "../webview/nuget-view/shared"
import { NodeIdString } from "./nodeId"

export declare type ErrorCmd = {
    readonly type: 'error',
    readonly payload: {
        readonly message: string
    }
}

export declare type SearchResultsCmd = {
    readonly type: 'searchResults',
    readonly payload: {
        readonly searchResults: NuGetPackage[],
        readonly error?: string
    }
}

export interface NuGetViewData {
    readonly installedPackages?: (LocalNuGetPackage & { version: string })[] | null;
    readonly searchResults?: LocalNuGetPackage[] | null;
    readonly updatesAvailable?: LocalNuGetPackage[] | null;
    readonly consolidatePackages?: LocalNuGetPackage[]; // For future consolidation functionality
    readonly projects?: ProjectInfo[] | null;
    readonly projectPath?: string | null;
}

export declare type NugetDataCmd = {
    readonly type: 'nugetData',
    readonly payload: NuGetViewData
}

export declare type ConsolidatePackagesCmd = {
    readonly type: 'consolidatePackages',
    readonly payload: {
        readonly consolidatePackages?: LocalNuGetPackage[] | null
    }
}

export declare type InstallCompleteCmd = {
    readonly type: 'installComplete',
    readonly payload: {
        readonly success: boolean,
        readonly packageId: string
    }
}

export declare type UninstallCompleteCmd = {
    readonly type: 'uninstallComplete',
    readonly payload: {
        readonly success: boolean,
        readonly packageId: string
    }
}

export declare type BulkUpdateCompleteCmd = {
    readonly type: 'bulkUpdateComplete',
    readonly payload: {
        readonly success: boolean,
        readonly error?: string
    }
}

export declare type BulkConsolidateCompleteCmd = {
    readonly type: 'bulkConsolidateComplete',
    readonly payload: {
        readonly success: boolean,
        readonly error?: string
    }
}

export declare type PackageIconCmd = {
    readonly type: 'packageIcon',
    readonly payload: {
        readonly packageId: string,
        readonly version: string,
        readonly iconUri: string | null,
    }
}

export declare type PackageReadmeCmd = {
    readonly type: 'packageReadme',
    readonly payload: {
        readonly packageId: string,
        readonly version: string,
        readonly readmeUrl: string | null,
    }
}

export declare type LoadingCmd = {
    readonly type: 'loading',
    readonly payload: {}
}

export declare type HideLoadingCmd = {
    readonly type: 'hideLoading'
}

export declare type ActiveFileChangedCmd = {
    readonly type: 'activeFileChanged'
    readonly payload: {
        readonly filePath: string
    }
}

export declare type SolutionDataCmd = {
    readonly type: 'solutionData',
    readonly payload: {
        readonly projects: ProjectNode[],
        readonly frameworks: string[],
        readonly activeFramework?: string | undefined;
    }
}

export declare type AddTemporaryNodeCmd = {
    readonly type: 'addTemporaryNode',
    readonly payload: {
        readonly nodeId: NodeIdString,
        readonly nodeType: NodeType,
        readonly parentNodeId: NodeIdString
    }
}

export declare type RemoveTemporaryNodesCmd = {
    readonly type: 'removeTemporaryNodes',
    readonly payload: {
        readonly parentPath: string,
    }
}


export declare type UICmd =
    ErrorCmd |
    SearchResultsCmd |
    NugetDataCmd |
    ConsolidatePackagesCmd |
    InstallCompleteCmd |
    UninstallCompleteCmd |
    BulkUpdateCompleteCmd |
    BulkConsolidateCompleteCmd |
    PackageIconCmd |
    PackageReadmeCmd |
    LoadingCmd |
    HideLoadingCmd |
    ActiveFileChangedCmd |
    SolutionDataCmd |
    AddTemporaryNodeCmd |
    RemoveTemporaryNodesCmd;
