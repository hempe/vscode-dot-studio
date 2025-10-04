/**
 * Types for NuGet Package Manager services using dotnet CLI
 */

export interface NuGetPackage {
    id: string;
    version: string;
    description?: string;
    authors?: string[];
    projectUrl?: string;
    licenseUrl?: string;
    iconUrl?: string;
    tags?: string[];
    totalDownloads?: number;
    latestVersion?: string;
    allVersions?: string[];
    source?: string;  // Package source URL or name
}

export interface InstalledPackage {
    id: string;
    version: string;
    projectPath: string;
    projectName: string;
    resolved?: string;  // Actual resolved version
    autoReferenced?: boolean;
    transitivePackage?: boolean;
}

export interface UpdateablePackage {
    id: string;
    currentVersion: string;
    latestVersion: string;
    projectPath: string;
    projectName: string;
}

export interface PackageSearchOptions {
    query: string;
    includePrerelease?: boolean;
    source?: string;
    take?: number;
    skip?: number;
}

export interface PackageInstallOptions {
    packageId: string;
    version?: string;
    projectPath: string;
    source?: string;
    prerelease?: boolean;
    noRestore?: boolean;
}

export interface ProjectInfo {
    name: string;
    path: string;
    framework: string;
    packages: InstalledPackage[];
}

export interface ConsolidationInfo {
    packageId: string;
    versions: Array<{
        version: string;
        projects: string[];
    }>;
    latestVersion?: string;
}

/**
 * Package source information
 */
export interface PackageSource {
    name: string;
    url: string;
    enabled: boolean;
    isLocal: boolean;
}

/**
 * Package operation result
 */
export interface PackageOperationResult {
    success: boolean;
    message: string;
    packageId?: string;
    version?: string;
    projectPath?: string;
}