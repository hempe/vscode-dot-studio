import { logger } from '../../core/logger';
import { PackageBrowseService } from './packageBrowseService';
import { PackageInstalledService } from './packageInstalledService';
import { PackageUpdateService } from './packageUpdateService';
import { PackageOperationsService } from './packageOperationsService';
import { PackageSharedService } from './packageSharedService';
import { VersionUtils } from '../versionUtils';
import {
    PackageSearchOptions,
    PackageOperationResult,
    ProjectInfo,
    BasicInstalledPackage,
    InstalledPackage,
    UpdateablePackage
} from './types';

const log = logger('NuGetManagerService');

/**
 * Unified NuGet Manager Service that orchestrates all NuGet operations
 * This service provides both project-level and solution-level functionality
 */
export class NuGetManagerService {

    // ============ SOLUTION-LEVEL OPERATIONS ============

    /**
     * Get consolidation data using already-loaded installed packages (much faster)
     * No expensive dotnet commands needed since we have all the data from installed packages
     */
    static getConsolidationDataFromInstalledPackages(
        installedPackages: (InstalledPackage & { projects: ProjectInfo[] })[]
    ): { consolidationInfo: any[], consolidatePackages: any[] } {
        try {
            log.info(`Getting consolidation data from ${installedPackages.length} installed packages...`);

            // Group packages by ID to find version conflicts
            const packageGroups = new Map<string, (InstalledPackage & { projects: ProjectInfo[] })[]>();

            for (const pkg of installedPackages) {
                const existingGroup = packageGroups.get(pkg.id) || [];
                existingGroup.push(pkg);
                packageGroups.set(pkg.id, existingGroup);
            }

            log.info(`Grouped into ${packageGroups.size} unique package IDs`);

            const consolidatePackages: any[] = [];
            const consolidationInfo: any[] = [];

            // Find packages with multiple versions across projects
            for (const [packageId, packages] of packageGroups.entries()) {
                // Check if there are different versions
                const versions = new Set(packages.map(p => p.currentVersion));

                log.debug(`Package ${packageId}: ${packages.length} instances with versions [${Array.from(versions).join(', ')}]`);

                if (versions.size > 1) {
                    log.info(`Package ${packageId} needs consolidation: versions ${Array.from(versions).join(', ')}`);
                    // This package needs consolidation
                    const versionGroups = new Map<string, string[]>();

                    // Group by version to get project paths per version
                    for (const pkg of packages) {
                        const version = pkg.currentVersion;
                        const existingProjects = versionGroups.get(version) || [];
                        // Add all project paths from this package
                        for (const project of pkg.projects) {
                            if (!existingProjects.includes(project.path)) {
                                existingProjects.push(project.path);
                            }
                        }
                        versionGroups.set(version, existingProjects);
                    }

                    // Get latest version from any of the packages (they should all have the same latestVersion)
                    const latestVersion = packages[0].latestVersion;

                    // Create consolidation info
                    const versions_array = Array.from(versionGroups.entries()).map(([version, projects]) => ({
                        version,
                        projects
                    }));

                    consolidationInfo.push({
                        packageId,
                        versions: versions_array,
                        latestVersion
                    });

                    // Create consolidate package for UI
                    const allProjects = packages.reduce((acc, pkg) => {
                        for (const project of pkg.projects) {
                            if (!acc.find(p => p.path === project.path)) {
                                acc.push(project);
                            }
                        }
                        return acc;
                    }, [] as ProjectInfo[]);

                    // Use the highest current version as the "current" version
                    const sortedVersions = Array.from(versions).sort((a, b) => {
                        return VersionUtils.compare(a, b);
                    });

                    const consolidatePackage = {
                        ...packages[0], // Use first package as base
                        currentVersion: sortedVersions[0],
                        latestVersion,
                        allVersions: Array.from(versions),
                        needsConsolidation: true,
                        currentVersions: versions_array,
                        projects: allProjects
                    };

                    consolidatePackages.push(consolidatePackage);
                }
            }

            log.info(`Found ${consolidatePackages.length} packages needing consolidation (from ${installedPackages.length} installed packages)`);

            return {
                consolidationInfo,
                consolidatePackages
            };

        } catch (error) {
            log.error('Error getting consolidation data from installed packages:', error);
            return {
                consolidationInfo: [],
                consolidatePackages: []
            };
        }
    }

    /**
     * Get consolidation data from flat package list (works with version conflicts)
     */
    static getConsolidationDataFromFlatPackages(
        flatPackages: (BasicInstalledPackage & { projectInfo: ProjectInfo })[]
    ): { consolidationInfo: any[], consolidatePackages: any[] } {
        try {
            log.info(`Getting consolidation data from ${flatPackages.length} flat packages...`);

            // Group packages by ID to find version conflicts
            const packageGroups = new Map<string, (BasicInstalledPackage & { projectInfo: ProjectInfo })[]>();

            for (const pkg of flatPackages) {
                const existingGroup = packageGroups.get(pkg.id) || [];
                existingGroup.push(pkg);
                packageGroups.set(pkg.id, existingGroup);
            }

            log.info(`Grouped into ${packageGroups.size} unique package IDs`);

            const consolidatePackages: any[] = [];
            const consolidationInfo: any[] = [];

            // Find packages with multiple versions across projects
            for (const [packageId, packages] of packageGroups.entries()) {
                // Check if there are different versions
                const versions = new Set(packages.map(p => p.currentVersion));

                log.debug(`Package ${packageId}: ${packages.length} instances with versions [${Array.from(versions).join(', ')}]`);

                if (versions.size > 1) {
                    log.info(`Package ${packageId} needs consolidation: versions ${Array.from(versions).join(', ')}`);

                    // This package needs consolidation
                    const versionGroups = new Map<string, ProjectInfo[]>();

                    // Group by version to get projects per version
                    for (const pkg of packages) {
                        const version = pkg.currentVersion;
                        const existingProjects = versionGroups.get(version) || [];
                        if (!existingProjects.find(p => p.path === pkg.projectInfo.path)) {
                            existingProjects.push(pkg.projectInfo);
                        }
                        versionGroups.set(version, existingProjects);
                    }

                    // Create consolidation info
                    const versions_array = Array.from(versionGroups.entries()).map(([version, projects]) => ({
                        version,
                        projects: projects.map(p => p.path)
                    }));

                    consolidationInfo.push({
                        packageId,
                        versions: versions_array
                    });

                    // Create consolidate package for UI
                    const allProjects = Array.from(versionGroups.values()).flat();

                    // Use the highest current version as the "current" version
                    const sortedVersions = Array.from(versions).sort((a, b) => {
                        return VersionUtils.compare(a, b);
                    });

                    const consolidatePackage = {
                        id: packageId,
                        currentVersion: sortedVersions[0],
                        allVersions: Array.from(versions),
                        needsConsolidation: true,
                        currentVersions: versions_array,
                        projects: allProjects
                    };

                    consolidatePackages.push(consolidatePackage);
                }
            }

            log.info(`Found ${consolidatePackages.length} packages needing consolidation (from ${flatPackages.length} flat packages)`);

            return {
                consolidationInfo,
                consolidatePackages
            };

        } catch (error) {
            log.error('Error getting consolidation data from flat packages:', error);
            return {
                consolidationInfo: [],
                consolidatePackages: []
            };
        }
    }

    /**
     * Get comprehensive solution-wide NuGet data for the Package Manager UI
     */
    static async getSolutionNuGetData(solutionPath: string) {
        try {
            log.info(`Getting solution NuGet data for: ${solutionPath}`);

            // Only get projects from active solution - no fallback to expensive dotnet commands
            const allProjects = await PackageInstalledService.getAllProjectsInfoFromActiveSolution();
            if (allProjects.length === 0) {
                log.warn('No projects available from active solution - NuGet data will be empty');
                return {
                    context: 'solution',
                    solutionPath,
                    projects: [],
                    totalPackages: 0,
                    installedPackages: [],
                    outdatedPackages: [],
                    consolidationInfo: [],
                    consolidatePackages: [],
                    updateStats: { total: 0, outdated: 0, majorUpdates: 0, hasOutdated: false },
                    lastUpdated: new Date().toISOString()
                };
            }

            const installedPackages = await this.getGroupedInstalledPackages(solutionPath, false, allProjects);

            // Get outdated packages by filtering installed packages (much faster than dotnet list --outdated)
            const outdatedPackages = await this.getGroupedOutdatedPackages(solutionPath, false, allProjects);
            log.info(`Found ${outdatedPackages.length} outdated packages`);

            // Calculate update stats from outdated packages (much faster than dotnet commands)
            const updateStats = this.calculateUpdateStats(outdatedPackages);

            // Get consolidation data from flat package list (before grouping)
            const allProjectsData = await PackageInstalledService.getAllProjectsInfoFromActiveSolution();
            const flatPackageList = allProjectsData.flatMap(project => project.packages.map(pkg => ({
                ...pkg,
                projectInfo: project
            })));
            const { consolidationInfo, consolidatePackages: rawConsolidatePackages } = this.getConsolidationDataFromFlatPackages(flatPackageList);

            // Enrich consolidate packages with metadata (like authors, description, etc.)
            const consolidatePackages = await PackageSharedService.enrichWithBrowseMetadata(rawConsolidatePackages);
            log.info(`Found ${consolidatePackages.length} packages needing consolidation (enriched with metadata)`);

            return {
                context: 'solution',
                solutionPath,
                projects: allProjects,
                totalPackages: installedPackages.length,
                installedPackages,
                outdatedPackages,
                consolidationInfo, // Keep original for backend use
                consolidatePackages, // UI-ready format
                updateStats,
                lastUpdated: new Date().toISOString()
            };

        } catch (error) {
            log.error('Error getting solution NuGet data:', error);
            throw error;
        }
    }

    /**
     * Get installed packages grouped by package ID with project info and rich metadata
     * Returns the final UI structure directly
     */
    static async getGroupedInstalledPackages(targetPath?: string, isProject: boolean = false, allProjects?: ProjectInfo[])
        : Promise<(InstalledPackage & { projects: ProjectInfo[] })[]> {
        try {
            // Get enriched installed packages (individual entries per project)
            const installedPackages = isProject
                ? await PackageInstalledService.getProjectPackagesWithMetadata(targetPath!)
                : await PackageInstalledService.getInstalledPackagesWithMetadata();

            // Group by package ID and create projects array
            const packageMap = new Map<string, (InstalledPackage & { projects: ProjectInfo[] })>();

            log.info(`Grouping ${installedPackages.length} packages for UI`);

            // Count how many packages have metadata
            const packagesWithMetadata = installedPackages.filter(pkg => pkg.description);
            log.info(`${packagesWithMetadata.length}/${installedPackages.length} packages have metadata`);

            for (const pkg of installedPackages) {
                // Log first package to debug the structure
                if (packageMap.size === 0) {
                    log.debug('Sample package structure:', {
                        id: pkg.id,
                        currentVersion: pkg.currentVersion,
                        latestVersion: pkg.latestVersion,
                        description: pkg.description,
                        authors: pkg.authors,
                        projectName: pkg.projectName,
                        hasMetadata: !!pkg.description
                    });
                }

                const existing = packageMap.get(pkg.id);

                if (existing) {
                    // Add project info to existing package
                    if (pkg.projectName) {
                        // Find the full project info from allProjects
                        const fullProjectInfo = allProjects?.find(proj => proj.name === pkg.projectName);
                        if (fullProjectInfo && !existing.projects.find((p: any) => p.path === fullProjectInfo.path)) {
                            existing.projects.push(fullProjectInfo);
                        }
                    }
                } else {
                    // First time seeing this package
                    const fullProjectInfo = pkg.projectName ? allProjects?.find(proj => proj.name === pkg.projectName) : null;
                    packageMap.set(pkg.id, {
                        ...pkg,
                        // currentVersion is already correct from pkg.currentVersion
                        projects: fullProjectInfo ? [fullProjectInfo] : []
                    });
                }
            }

            return Array.from(packageMap.values());

        } catch (error) {
            log.error('Error getting grouped installed packages:', error);
            return [];
        }
    }

    /**
     * Get outdated packages by filtering installed packages that have newer versions available
     * Much faster than running dotnet list --outdated commands
     */
    static async getGroupedOutdatedPackages(targetPath?: string, isProject: boolean = false, allProjects?: ProjectInfo[])
        : Promise<(UpdateablePackage & { projects: ProjectInfo[] })[]> {
        try {
            // Get installed packages with metadata (which includes latestVersion)
            const installedPackages = isProject
                ? await this.getGroupedInstalledPackages(targetPath!, true, allProjects)
                : await this.getGroupedInstalledPackages(targetPath, false, allProjects);

            log.info(`Filtering ${installedPackages.length} installed packages for updates...`);

            // Filter packages that have newer versions available
            const outdatedPackages: (UpdateablePackage & { projects: ProjectInfo[] })[] = [];

            for (const pkg of installedPackages) {
                const currentVersion = pkg.currentVersion;
                const latestVersion = pkg.latestVersion;

                log.debug(`Package ${pkg.id}: current=${currentVersion}, latest=${latestVersion}, hasLatest=${!!latestVersion}`);

                if (latestVersion && currentVersion !== latestVersion) {
                    try {
                        // Use version utilities to compare versions
                        if (VersionUtils.compare(latestVersion, currentVersion) > 0) {
                            // Convert InstalledPackage to UpdateablePackage format
                            const updateablePackage: UpdateablePackage & { projects: ProjectInfo[] } = {
                                ...pkg,
                                latestVersion
                            } as any;
                            outdatedPackages.push(updateablePackage);
                        } else {
                            // Fallback to simple string comparison if versions are the same
                            if (currentVersion !== latestVersion) {
                                const updateablePackage: UpdateablePackage & { projects: ProjectInfo[] } = {
                                    ...pkg,
                                    latestVersion
                                } as any;
                                outdatedPackages.push(updateablePackage);
                            }
                        }
                    } catch (error) {
                        // If semver comparison fails, fallback to string comparison
                        if (currentVersion !== latestVersion) {
                            const updateablePackage: UpdateablePackage & { projects: ProjectInfo[] } = {
                                ...pkg,
                                latestVersion
                            } as any;
                            outdatedPackages.push(updateablePackage);
                        }
                    }
                }
            }

            log.info(`Found ${outdatedPackages.length} outdated packages (filtered from ${installedPackages.length} installed)`);

            return outdatedPackages;

        } catch (error) {
            log.error('Error filtering outdated packages:', error);
            return [];
        }
    }

    /**
     * Search packages for solution-wide installation
     */
    static async searchPackages(query: string, options?: Partial<PackageSearchOptions>) {
        return PackageBrowseService.searchPackages({
            query,
            take: options?.take || 20,
            skip: options?.skip || 0,
            source: options?.source
        });
    }

    /**
     * Install a package across multiple projects in a solution
     */
    static async installPackageInMultipleProjects(
        packageId: string,
        version: string,
        projectPaths: string[]
    ): Promise<PackageOperationResult[]> {
        log.info(`Installing ${packageId} v${version} in ${projectPaths.length} projects`);

        const results: PackageOperationResult[] = [];

        for (const projectPath of projectPaths) {
            const result = await PackageOperationsService.installPackage({
                packageId,
                version,
                projectPath
            });
            results.push(result);
        }

        return results;
    }

    /**
     * Update all outdated packages in solution
     */
    static async updateAllPackagesInSolution(solutionPath: string) {
        const allProjects = await PackageInstalledService.getAllProjectsInfo(solutionPath);
        const results: PackageOperationResult[] = [];

        for (const project of allProjects) {
            const projectResults = await PackageUpdateService.updateAllPackages(project.path);
            results.push(...projectResults);
        }

        return results;
    }

    // ============ PROJECT-LEVEL OPERATIONS ============

    /**
     * Get comprehensive project-specific NuGet data for the Package Manager UI
     */
    static async getProjectNuGetData(projectPath: string) {
        try {
            log.info(`Getting project NuGet data for: ${projectPath}`);

            // First get project info
            const projectInfo = await PackageInstalledService.getProjectInfo(projectPath);
            const allProjects = projectInfo ? [projectInfo] : []; // Handle potential null

            const [
                installedPackages,
                outdatedPackages
            ] = await Promise.all([
                this.getGroupedInstalledPackages(projectPath, true, allProjects),
                this.getGroupedOutdatedPackages(projectPath, true, allProjects)
            ]);

            return {
                context: 'project',
                projectPath,
                projectInfo,
                projects: allProjects, // Add projects array for frontend compatibility
                installedPackages,
                outdatedPackages,
                totalPackages: installedPackages.length,
                updatesAvailable: outdatedPackages.length,
                lastUpdated: new Date().toISOString()
            };

        } catch (error) {
            log.error('Error getting project NuGet data:', error);
            throw error;
        }
    }

    // ============ HELPER METHODS ============
    /**
     * Determine if a path is a solution or project file
     */
    static getContextFromPath(filePath: string): 'solution' | 'project' | 'unknown' {
        if (filePath.endsWith('.sln')) {
            return 'solution';
        } else if (filePath.endsWith('.csproj') || filePath.endsWith('.vbproj') || filePath.endsWith('.fsproj')) {
            return 'project';
        }
        return 'unknown';
    }

    /**
     * Validate package operation parameters
     */
    static validatePackageOperation(packageId: string, version?: string): { valid: boolean, error?: string } {
        if (!packageId || packageId.trim().length === 0) {
            return { valid: false, error: 'Package ID is required' };
        }

        if (version && version.trim().length === 0) {
            return { valid: false, error: 'Version cannot be empty if specified' };
        }

        // Add more validation as needed
        return { valid: true };
    }

    /**
     * Calculate update statistics from outdated packages
     */
    private static calculateUpdateStats(outdatedPackages: any[]): {
        total: number;
        outdated: number;
        majorUpdates: number;
        hasOutdated: boolean;
    } {
        try {
            // Track projects with updates for potential future use
            new Set(outdatedPackages.flatMap(pkg =>
                pkg.projects?.map((p: any) => p.path) || []
            )).size;

            // Consider packages as "critical" if they have major version updates
            const criticalUpdates = outdatedPackages.filter(pkg => {
                try {
                    const currentVersion = pkg.currentVersion;
                    const latestVersion = pkg.latestVersion;
                    return VersionUtils.isMajorUpdate(currentVersion, latestVersion);
                } catch {
                    return false;
                }
            }).length;

            return {
                total: outdatedPackages.length,
                outdated: outdatedPackages.length,
                majorUpdates: criticalUpdates,
                hasOutdated: outdatedPackages.length > 0
            };

        } catch (error) {
            log.error('Error calculating update statistics:', error);
            return {
                total: 0,
                outdated: 0,
                majorUpdates: 0,
                hasOutdated: false
            };
        }
    }
}