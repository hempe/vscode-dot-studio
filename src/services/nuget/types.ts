/**
 * Types for NuGet Package Manager services using dotnet CLI
 */

// ============ BASIC TYPES (Internal Use Only) ============
// These are intermediate types from dotnet CLI commands, before NuGet API enrichment

/**
 * Basic installed package information from dotnet CLI output
 * Represents a package that is currently installed in a project, before NuGet API enrichment
 */
export interface BasicInstalledPackage {
    /** The package identifier (e.g., "Newtonsoft.Json") */
    id: string;
    /** The version currently installed in the project */
    currentVersion: string;
    /** Absolute path to the project file (.csproj) */
    projectPath: string;
    /** Name of the project (filename without extension) */
    projectName: string;
    /** Actual resolved version (may differ from requested version) */
    resolved?: string;
    /** Whether this package was automatically referenced by the framework */
    autoReferenced?: boolean;
    /** Whether this is a transitive dependency (not directly referenced) */
    transitivePackage?: boolean;
}

/**
 * Basic outdated package information from dotnet CLI output
 * Represents a package that has updates available, before NuGet API enrichment
 */
export interface BasicUpdateablePackage {
    /** The package identifier (e.g., "Newtonsoft.Json") */
    id: string;
    /** The version currently installed in the project */
    currentVersion: string;
    /** The latest version available from the package source */
    latestVersion: string;
    /** Absolute path to the project file (.csproj) */
    projectPath: string;
    /** Name of the project (filename without extension) */
    projectName: string;
}

/**
 * Basic consolidation package information from analysis
 * Represents a package that has different versions across projects and needs consolidation
 */
export interface BasicConsolidationPackage {
    /** The package identifier (e.g., "Newtonsoft.Json") */
    id: string;
    /** The highest version currently used across all projects */
    currentVersion: string;
    /** The latest version available from the package source (optional) */
    latestVersion?: string;
    /** All versions currently in use across projects */
    allVersions: string[];
    /** Always true for consolidation packages */
    needsConsolidation: true;
    /** Breakdown of which projects use which versions */
    currentVersions: Array<{ version: string; projects: string[] }>;
    /** Project information for all projects using this package */
    projects: ProjectInfo[];
}

// ============ FULL TYPES (For UI/API) ============
// These include full metadata from NuGet API

/**
 * Complete NuGet package information with metadata from NuGet API
 * Used for package browsing, search results, and enriched package display
 */
export interface NuGetPackage {
    /** The package identifier (e.g., "Newtonsoft.Json") */
    id: string;
    /** The version being referenced for this context (could be installed, latest, or searched version) */
    currentVersion: string;
    /** Package description from NuGet API */
    description?: string;
    /** Package authors/owners */
    authors?: string[];
    /** Project or repository URL */
    projectUrl?: string;
    /** License information URL */
    licenseUrl?: string;
    /** Package icon URL */
    iconUrl?: string;
    /** Package tags for categorization */
    tags?: string[];
    /** Total download count across all versions */
    totalDownloads?: number;
    /** Latest stable version available */
    latestVersion?: string;
    /** All available versions (sorted) */
    allVersions?: string[];
    /** Package source URL or name where this package was found */
    source?: string;
}

/**
 * Installed package with enriched NuGet API metadata
 * Combines basic installed package info with optional metadata from NuGet API
 * currentVersion = installed version, latestVersion = latest available version
 */
export type InstalledPackage = BasicInstalledPackage & Partial<Omit<NuGetPackage, 'id' | 'currentVersion'>> & {
    /** Package description from NuGet API */
    description?: string;
    /** Package authors/owners */
    authors?: string[];
    /** Project or repository URL */
    projectUrl?: string;
    /** License information URL */
    licenseUrl?: string;
    /** Package icon URL */
    iconUrl?: string;
    /** Package tags for categorization */
    tags?: string[];
    /** Total download count across all versions */
    totalDownloads?: number;
    /** Latest stable version available from NuGet API */
    latestVersion?: string;
    /** All available versions (sorted) */
    allVersions?: string[];
    /** Package source URL or name */
    source?: string;
};

/**
 * Updateable package with enriched NuGet API metadata
 * Combines basic updateable package info with optional metadata from NuGet API
 * currentVersion = installed version, latestVersion = latest available version
 */
export type UpdateablePackage = BasicUpdateablePackage & Partial<Omit<NuGetPackage, 'id' | 'currentVersion' | 'latestVersion'>> & {
    /** Package description from NuGet API */
    description?: string;
    /** Package authors/owners */
    authors?: string[];
    /** Project or repository URL */
    projectUrl?: string;
    /** License information URL */
    licenseUrl?: string;
    /** Package icon URL */
    iconUrl?: string;
    /** Package tags for categorization */
    tags?: string[];
    /** Total download count across all versions */
    totalDownloads?: number;
    /** All available versions (sorted) */
    allVersions?: string[];
    /** Package source URL or name */
    source?: string;
}

/**
 * Options for searching packages in NuGet repositories
 */
export interface PackageSearchOptions {
    /** Search query string */
    query: string;
    /** Whether to include prerelease versions in results */
    includePrerelease?: boolean;
    /** Specific package source to search (optional) */
    source?: string;
    /** Maximum number of results to return */
    take?: number;
    /** Number of results to skip (for pagination) */
    skip?: number;
}

/**
 * Options for installing a NuGet package
 */
export interface PackageInstallOptions {
    /** The package identifier to install */
    packageId: string;
    /** Specific version to install (optional, defaults to latest) */
    version?: string;
    /** Path to the project file (.csproj) */
    projectPath: string;
    /** Package source to install from (optional) */
    source?: string;
    /** Whether to allow prerelease versions */
    prerelease?: boolean;
    /** Whether to skip package restore after installation */
    noRestore?: boolean;
}

/**
 * Information about a .NET project and its installed packages
 */
export interface ProjectInfo {
    /** Project name (filename without extension) */
    name: string;
    /** Absolute path to the project file (.csproj) */
    path: string;
    /** Target framework (e.g., "net8.0", "netstandard2.0") */
    framework: string;
    /** All packages installed in this project */
    packages: InstalledPackage[];
}

/**
 * Information about packages that need version consolidation across projects
 */
export interface ConsolidationInfo {
    /** The package identifier */
    packageId: string;
    /** Breakdown of which projects use which versions */
    versions: Array<{
        /** Version string */
        version: string;
        /** Projects using this version */
        projects: string[];
    }>;
    /** Latest version available (optional) */
    latestVersion?: string;
}

/**
 * Package source information
 * Represents a configured NuGet package source (like nuget.org, private feeds, etc.)
 */
export interface PackageSource {
    /** Display name of the package source */
    name: string;
    /** URL of the package source API */
    url: string;
    /** Whether this source is currently enabled */
    enabled: boolean;
    /** Whether this is a local file system source */
    isLocal: boolean;
}

/**
 * Result of a package operation (install, update, uninstall)
 */
export interface PackageOperationResult {
    /** Whether the operation completed successfully */
    success: boolean;
    /** Human-readable message describing the result */
    message: string;
    /** Package identifier that was operated on (optional) */
    packageId?: string;
    /** Version that was operated on (optional) */
    version?: string;
    /** Project path where the operation occurred (optional) */
    projectPath?: string;
}