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
    readonly id: string;
    /** The version currently installed in the project */
    readonly currentVersion: string;
    /** Absolute path to the project file (.csproj) */
    readonly projectPath: string;
    /** Name of the project (filename without extension) */
    readonly projectName: string;
    /** Actual resolved version (may differ from requested version) */
    readonly resolved?: string;
    /** Whether this package was automatically referenced by the framework */
    readonly autoReferenced?: boolean;
    /** Whether this is a transitive dependency (not directly referenced) */
    readonly transitivePackage?: boolean;
}

/**
 * Basic outdated package information from dotnet CLI output
 * Represents a package that has updates available, before NuGet API enrichment
 */
export interface BasicUpdateablePackage {
    /** The package identifier (e.g., "Newtonsoft.Json") */
    readonly id: string;
    /** The version currently installed in the project */
    readonly currentVersion: string;
    /** The latest version available from the package source */
    readonly versions: string[];
    /** Absolute path to the project file (.csproj) */
    readonly projectPath: string;
    /** Name of the project (filename without extension) */
    readonly projectName: string;
}

/**
 * Basic consolidation package information from analysis
 * Represents a package that has different versions across projects and needs consolidation
 */
export interface BasicConsolidationPackage {
    /** The package identifier (e.g., "Newtonsoft.Json") */
    readonly id: string;
    /** The highest version currently used across all projects */
    readonly currentVersion: string;
    /** The latest version available from the package source (optional) */
    readonly latestVersion?: string;
    /** All versions currently in use across projects */
    readonly versions: string[];
    /** Breakdown of which projects use which versions */
    readonly currentVersions: Array<{ version: string; projects: string[] }>;
    /** Project information for all projects using this package */
    readonly projects: ProjectInfo[];
}

// ============ FULL TYPES (For UI/API) ============
// These include full metadata from NuGet API

/**
 * Complete NuGet package information with metadata from NuGet API
 * Used for package browsing, search results, and enriched package display
 */
export interface NuGetPackage {
    /** The package identifier (e.g., "Newtonsoft.Json") */
    readonly id: string;
    /** The version being referenced for this context (could be installed, latest, or searched version) */
    readonly currentVersion: string;
    /** Package description from NuGet API */
    readonly description?: string;
    /** Package authors/owners */
    readonly authors?: string[];
    /** Project or repository URL */
    readonly projectUrl?: string;
    /** License information URL */
    readonly licenseUrl?: string;
    /** Package icon URL */
    readonly iconUrl?: string;
    /** Package tags for categorization */
    readonly tags?: string[];
    /** Total download count across all versions */
    readonly totalDownloads?: number;
    /** All available versions (sorted) */
    readonly versions?: string[];
    /** Package source URL or name where this package was found */
    readonly source?: string;
}

/**
 * Installed package with enriched NuGet API metadata
 * Combines basic installed package info with optional metadata from NuGet API
 */
export type InstalledPackage = BasicInstalledPackage & Partial<Omit<NuGetPackage, 'id' | 'currentVersion'>> & {
    /** Package description from NuGet API */
    readonly description?: string;
    /** Package authors/owners */
    readonly authors?: string[];
    /** Project or repository URL */
    readonly projectUrl?: string;
    /** License information URL */
    readonly licenseUrl?: string;
    /** Package icon URL */
    readonly iconUrl?: string;
    /** Package tags for categorization */
    readonly tags?: string[];
    /** Total download count across all versions */
    readonly totalDownloads?: number;
    /** All available versions (sorted) */
    readonly versions?: string[];
    /** Package source URL or name */
    readonly source?: string;
};

/**
 * Updateable package with enriched NuGet API metadata
 * Combines basic updateable package info with optional metadata from NuGet API
 */
export type UpdateablePackage = BasicUpdateablePackage & Partial<Omit<NuGetPackage, 'id' | 'currentVersion'>> & {
    /** Package description from NuGet API */
    readonly description?: string;
    /** Package authors/owners */
    readonly authors?: string[];
    /** Project or repository URL */
    readonly projectUrl?: string;
    /** License information URL */
    readonly licenseUrl?: string;
    /** Package icon URL */
    readonly iconUrl?: string;
    /** Package tags for categorization */
    readonly tags?: string[];
    /** Total download count across all versions */
    readonly totalDownloads?: number;
    /** All available versions (sorted) */
    readonly versions?: string[];
    /** Package source URL or name */
    readonly source?: string;
}

/**
 * Options for searching packages in NuGet repositories
 */
export interface PackageSearchOptions {
    /** Search query string */
    readonly query: string;
    /** Specific package source to search (optional) */
    readonly source?: string;
    /** Maximum number of results to return */
    readonly take?: number;
    /** Number of results to skip (for pagination) */
    readonly skip?: number;
}

/**
 * Options for installing a NuGet package
 */
export interface PackageInstallOptions {
    /** The package identifier to install */
    readonly packageId: string;
    /** Specific version to install (optional, defaults to latest) */
    readonly version?: string;
    /** Path to the project file (.csproj) */
    readonly projectPath: string;
    /** Package source to install from (optional) */
    readonly source?: string;
    /** Whether to allow prerelease versions */
    readonly prerelease?: boolean;
    /** Whether to skip package restore after installation */
    readonly noRestore?: boolean;
}

/**
 * Information about a .NET project and its installed packages
 */
export interface ProjectInfo {
    /** Project name (filename without extension) */
    readonly name: string;
    /** Absolute path to the project file (.csproj) */
    readonly path: string;
    /** Target framework (e.g., "net8.0", "netstandard2.0") */
    readonly framework: string;
    /** All packages installed in this project */
    readonly packages: InstalledPackage[];
}

/**
 * Package source information
 * Represents a configured NuGet package source (like nuget.org, private feeds, etc.)
 */
export interface PackageSource {
    /** Display name of the package source */
    readonly name: string;
    /** URL of the package source API */
    readonly url: string;
    /** Whether this source is currently enabled */
    readonly enabled: boolean;
    /** Whether this is a local file system source */
    readonly isLocal: boolean;
}


/**
 * Upgrade nuget.org V2 URLs to V3 for better functionality
 */
export function upgradeNuGetOrgUrl(sourceUrl: string): string {
    // Upgrade old nuget.org V2 URLs to V3
    if (sourceUrl.includes('nuget.org') && sourceUrl.includes('/api/v2')) {
        return 'https://api.nuget.org/v3/index.json';
    }

    // Upgrade www.nuget.org URLs to api.nuget.org V3
    if (sourceUrl.includes('www.nuget.org')) {
        return 'https://api.nuget.org/v3/index.json';
    }

    return sourceUrl;
}

/**
 * Result of a package operation (install, update, uninstall)
 */
export interface PackageOperationResult {
    /** Whether the operation completed successfully */
    readonly success: boolean;
    /** Human-readable message describing the result */
    readonly message: string;
    /** Package identifier that was operated on (optional) */
    readonly packageId?: string;
    /** Version that was operated on (optional) */
    readonly version?: string;
    /** Project path where the operation occurred (optional) */
    readonly projectPath?: string;
}