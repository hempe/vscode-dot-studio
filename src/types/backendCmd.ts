import { LocalNuGetPackage } from "../webview/nuget-view/shared";
import { NodeIdString } from "./nodeId";
import { ProjectActionCmd } from "./projectActionCmd";

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
    }
}

export declare type InstallPackageCmd = {
    readonly type: 'installPackage',
    readonly payload: {
        readonly package: LocalNuGetPackage,
        readonly projects: string[],
        readonly version: string
        readonly includePrerelease: boolean
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
        readonly nodeType: string
    }
}

export declare type CollapseNodeCmd = {
    readonly type: 'collapseNode',
    readonly payload: {
        readonly nodeId: NodeIdString,
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
    CollapseNodeCmd;