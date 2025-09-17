export interface InstalledPackage {
    id: string;
    version: string;
    projectPath: string;
    projectName: string;
    targetFramework?: string;
    isPrivateAssets?: boolean;
    includeAssets?: string;
}

export interface ProjectPackageInfo {
    projectPath: string;
    projectName: string;
    targetFramework?: string;
    packages: InstalledPackage[];
}