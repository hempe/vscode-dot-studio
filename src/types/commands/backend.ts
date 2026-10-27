import { NodeType } from "..";
import { LocalNuGetPackage } from "../../webview/nuget-view/shared";
import { NodeIdString } from "../nodeId";
import { ProjectActionCmd } from "./project-action";
import { ToolbarAction } from "../toolbar";

export declare type GetPackageReadmeCmd = {
    readonly type: 'getPackageReadme',
    readonly payload: {
        readonly packageId: string,
        readonly version: string
    }
}

export declare type GetPackageIconCmd = {
    readonly type: 'getPackageIcon',
    readonly payload: {
        readonly packageId: string,
        readonly version: string
    }
}

export declare type GetNuGetDataCmd = {
    readonly type: 'getNuGetData'
    readonly payload: {
        readonly includePrerelease: boolean
    }
}

export declare type SearchPackagesCmd = {
    readonly type: 'searchPackages',
    readonly payload: {
        readonly query: string,
        /** The package source to search (its name); all enabled sources when not set */
        readonly source?: string,
    }
}

/** The refresh button: the caches of the feeds are dropped and everything is read again */
export declare type RefreshNuGetCmd = {
    readonly type: 'refreshNuGet',
    readonly payload: {
        readonly includePrerelease: boolean
    }
}

export declare type InstallPackageCmd = {
    readonly type: 'installPackage',
    readonly payload: {
        readonly package: LocalNuGetPackage,
        readonly projects: string[],
        readonly version: string
        readonly includePrerelease: boolean
        /**
         * Central Package Management: `shared` (default) changes the central version (asking first when that reaches
         * other projects), `project` writes a VersionOverride ("Set for this project only"); see centralPackagePlan
         */
        readonly versionScope?: 'shared' | 'project'
    }
}

export declare type UnInstallPackageCmd = {
    readonly type: 'uninstallPackage',
    readonly payload: {
        readonly package: LocalNuGetPackage,
        readonly projects: string[],
        readonly includePrerelease: boolean
    }
}

export declare type BulkUpdatePackagesCmd = {
    readonly type: 'bulkUpdatePackages',
    readonly payload: {
        readonly packages: LocalNuGetPackage[]
        readonly includePrerelease: boolean,
    }
}

export declare type BulkConsolidatePackagesCmd = {
    readonly type: 'bulkConsolidatePackages',
    readonly payload: {
        readonly packages: LocalNuGetPackage[],
        readonly includePrerelease: boolean
    }
}

export declare type GetConsolidatePackagesCmd = {
    readonly type: 'getConsolidatePackages'
    readonly payload: {
        readonly includePrerelease: boolean
    }
}

export declare type GetSolutionDataCmd = {
    readonly type: 'getSolutionData'
}

export declare type SetFrameworkCmd = {
    readonly type: 'setFramework',
    readonly payload: {
        readonly framework: string
    }
}

export declare type ProjectActionBackendCmd = {
    readonly type: 'projectAction',
    readonly payload: ProjectActionCmd
}

export declare type ExpandNodeCmd = {
    readonly type: 'expandNode',
    readonly payload: {
        readonly nodeId: NodeIdString,
    }
}

export declare type CollapseNodeCmd = {
    readonly type: 'collapseNode',
    readonly payload: {
        readonly nodeId: NodeIdString,
    }
}

/** Focused tree node while the tree has keyboard focus and no rename is in progress; empty otherwise */
export declare type TreeFocusChangedCmd = {
    readonly type: 'treeFocusChanged',
    readonly payload: {
        readonly nodeId?: NodeIdString,
        readonly nodeType?: NodeType
    }
}

/** The nodes selected in the tree (Ctrl/Shift+click), for commands that act on all of them */
export declare type TreeSelectionChangedCmd = {
    readonly type: 'treeSelectionChanged',
    readonly payload: {
        readonly nodeIds: NodeIdString[]
    }
}

/** Drag & drop in the tree: the dragged nodes that fit the target; the extension checks the drop again */
export declare type MoveNodesCmd = {
    readonly type: 'moveNodes',
    readonly payload: {
        readonly nodeIds: NodeIdString[],
        readonly targetNodeId: NodeIdString,
        /** Ctrl (Cmd on macOS) was held over files and folders */
        readonly copy: boolean
    }
}

/** A button of the toolbar above the tree */
export declare type ToolbarActionCmd = {
    readonly type: 'toolbarAction',
    readonly payload: {
        readonly action: ToolbarAction
    }
}

export declare type BackendCmd =
    GetPackageReadmeCmd |
    GetPackageIconCmd |
    GetNuGetDataCmd |
    SearchPackagesCmd |
    InstallPackageCmd |
    UnInstallPackageCmd |
    BulkUpdatePackagesCmd |
    BulkConsolidatePackagesCmd |
    GetConsolidatePackagesCmd |
    GetSolutionDataCmd |
    SetFrameworkCmd |
    ProjectActionBackendCmd |
    ExpandNodeCmd |
    CollapseNodeCmd |
    TreeFocusChangedCmd |
    TreeSelectionChangedCmd |
    MoveNodesCmd |
    ToolbarActionCmd |
    RefreshNuGetCmd;