/**
 * Types for NuGet Package Manager services using dotnet CLI
 */

// ============ BASIC TYPES (Internal Use Only) ============
// These are intermediate types from dotnet CLI commands, before NuGet API enrichment

export interface BasicInstalledPackage {
    id: string;
    version: string;
    projectPath: string;
    projectName: string;
    resolved?: string;  // Actual resolved version
    autoReferenced?: boolean;
    transitivePackage?: boolean;
}

export interface BasicUpdateablePackage {
    id: string;
    currentVersion: string;
    latestVersion: string;
    projectPath: string;
    projectName: string;
}

export interface BasicConsolidationPackage {
    id: string;
    version: string;
    latestVersion?: string;
    allVersions: string[];
    needsConsolidation: true;
    currentVersions: Array<{ version: string; projects: string[] }>;
    projects: ProjectInfo[];
}

// ============ FULL TYPES (For UI/API) ============
// These include full metadata from NuGet API

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

// Full enriched types (these include NuGet API metadata)
export type InstalledPackage = BasicInstalledPackage & Partial<Omit<NuGetPackage, 'id' | 'version'>> & {
    // Keep the basic id/version, add optional NuGet metadata
    description?: string;
    authors?: string[];
    projectUrl?: string;
    licenseUrl?: string;
    iconUrl?: string;
    tags?: string[];
    totalDownloads?: number;
    latestVersion?: string;
    allVersions?: string[];
    source?: string;
};

export type UpdateablePackage = BasicUpdateablePackage & Partial<Omit<NuGetPackage, 'id' | 'version' | 'latestVersion'>> & {
    // Keep the basic fields, add optional NuGet metadata
    description?: string;
    authors?: string[];
    projectUrl?: string;
    licenseUrl?: string;
    iconUrl?: string;
    tags?: string[];
    totalDownloads?: number;
    allVersions?: string[];
    source?: string;
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