import { logger } from '../../core/logger';
import { PackageBrowseService } from './packageBrowseService';
import { PackageInstalledService } from './packageInstalledService';
import { PackageUpdateService } from './packageUpdateService';
import { PackageOperationsService } from './packageOperationsService';
import { PackageConsolidationService } from './packageConsolidationService';
import { PackageSharedService } from './packageSharedService';
import {
    PackageSearchOptions,
    PackageInstallOptions,
    PackageOperationResult,
    ProjectInfo,
    ConsolidationInfo,
    BasicInstalledPackage,
    BasicConsolidationPackage,
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
     * Get comprehensive solution-wide NuGet data for the Package Manager UI
     */
    static async getSolutionNuGetData(solutionPath: string) {
        try {
            log.info(`Getting solution NuGet data for: ${solutionPath}`);

            // First get all projects info
            const allProjects = await PackageInstalledService.getAllProjectsInfo(solutionPath);

            const [
                installedPackages,
                outdatedPackages,
                consolidationInfo,
                updateStats
            ] = await Promise.all([
                this.getGroupedInstalledPackages(solutionPath, false, allProjects),
                this.getGroupedOutdatedPackages(solutionPath, false, allProjects),
                PackageConsolidationService.getPackagesNeedingConsolidation(solutionPath),
                PackageUpdateService.getUpdateStatistics(solutionPath)
            ]);

            // Transform consolidation info to package format for UI and enrich with metadata
            const basicConsolidatePackages = this.transformConsolidationInfoToPackages(consolidationInfo, allProjects);
            const consolidatePackages = await PackageSharedService.enrichWithBrowseMetadata(basicConsolidatePackages);

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
                : await PackageInstalledService.getInstalledPackagesWithMetadata(targetPath);

            // Group by package ID and create projects array
            const packageMap = new Map<string, (InstalledPackage & { projects: ProjectInfo[] })>();

            log.info(`Grouping ${installedPackages.length} packages for UI`);

            // Count how many packages have metadata
            const packagesWithMetadata = installedPackages.filter(pkg => (pkg as any).description);
            log.info(`${packagesWithMetadata.length}/${installedPackages.length} packages have metadata`);

            for (const pkg of installedPackages) {
                // Log first package to debug the structure
                if (packageMap.size === 0) {
                    log.debug('Sample package structure:', {
                        id: pkg.id,
                        currentVersion: pkg.currentVersion,
                        latestVersion: (pkg as any).latestVersion,
                        description: (pkg as any).description,
                        authors: (pkg as any).authors,
                        projectName: (pkg as any).projectName,
                        hasMetadata: !!(pkg as any).description
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
     * Get outdated packages grouped by package ID with project info and rich metadata
     * Returns the final UI structure directly
     */
    static async getGroupedOutdatedPackages(targetPath?: string, isProject: boolean = false, allProjects?: ProjectInfo[])
        : Promise<(UpdateablePackage & { projects: ProjectInfo[] })[]> {
        try {
            // Get enriched outdated packages (individual entries per project)
            const outdatedPackages = isProject
                ? await PackageUpdateService.getProjectOutdatedPackagesWithMetadata(targetPath!)
                : await PackageUpdateService.getOutdatedPackagesWithMetadata(targetPath);

            // Group by package ID and create projects array
            const packageMap = new Map<string, (UpdateablePackage & { projects: ProjectInfo[] })>();

            log.info(`Found ${outdatedPackages.length} enriched outdated packages`);

            for (const pkg of outdatedPackages) {
                // Log first package to debug the structure
                if (packageMap.size === 0) {
                    log.debug('Sample outdated package structure:', {
                        id: pkg.id,
                        currentVersion: pkg.currentVersion,
                        latestVersion: (pkg as any).latestVersion,
                        hasMetadata: !!(pkg as any).description
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
                        // currentVersion and latestVersion are already correct from enrichment
                        projects: fullProjectInfo ? [fullProjectInfo] : []
                    });
                }
            }

            return Array.from(packageMap.values());

        } catch (error) {
            log.error('Error getting grouped outdated packages:', error);
            return [];
        }
    }

    /**
     * Search packages for solution-wide installation
     */
    static async searchPackagesForSolution(query: string, options?: Partial<PackageSearchOptions>) {
        return PackageBrowseService.searchPackages({
            query,
            includePrerelease: options?.includePrerelease || false,
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
     * Consolidate packages across solution
     */
    static async consolidatePackages(solutionPath: string) {
        return PackageConsolidationService.consolidateAllToLatest(solutionPath);
    }

    /**
     * Consolidate a specific package across solution to a target version
     */
    static async consolidatePackage(solutionPath: string, packageId: string, targetVersion: string) {
        return PackageConsolidationService.consolidatePackageToVersion(solutionPath, packageId, targetVersion);
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

    /**
     * Search packages for project installation
     */
    static async searchPackagesForProject(projectPath: string, query: string, options?: Partial<PackageSearchOptions>) {
        // For project-level search, we might want to filter based on project framework in the future
        return PackageBrowseService.searchPackages({
            query,
            includePrerelease: options?.includePrerelease || false,
            take: options?.take || 20,
            skip: options?.skip || 0,
            source: options?.source
        });
    }

    /**
     * Install a package in a specific project
     */
    static async installPackageInProject(
        projectPath: string,
        packageId: string,
        version?: string,
        options?: Partial<PackageInstallOptions>
    ) {
        return PackageOperationsService.installPackage({
            packageId,
            version,
            projectPath,
            source: options?.source,
            prerelease: options?.prerelease,
            noRestore: options?.noRestore
        });
    }

    /**
     * Uninstall a package from a specific project
     */
    static async uninstallPackageFromProject(projectPath: string, packageId: string) {
        return PackageOperationsService.uninstallPackage(projectPath, packageId);
    }

    /**
     * Update a package in a specific project
     */
    static async updatePackageInProject(projectPath: string, packageId: string, targetVersion?: string) {
        return PackageUpdateService.updatePackage(projectPath, packageId, targetVersion);
    }

    /**
     * Update all packages in a specific project
     */
    static async updateAllPackagesInProject(projectPath: string) {
        return PackageUpdateService.updateAllPackages(projectPath);
    }

    // ============ COMMON OPERATIONS ============

    /**
     * Get package details (works for both contexts)
     */
    static async getPackageDetails(packageId: string) {
        return PackageBrowseService.getPackageDetails(packageId);
    }

    /**
     * Get package versions (works for both contexts)
     */
    static async getPackageVersions(packageId: string) {
        return PackageBrowseService.getPackageVersions(packageId);
    }

    /**
     * Restore packages (works for both project and solution)
     */
    static async restorePackages(targetPath: string) {
        return PackageOperationsService.restorePackages(targetPath);
    }

    /**
     * Clear package cache
     */
    static async clearPackageCache() {
        return PackageOperationsService.clearCache();
    }

    /**
     * Get package sources
     */
    static async getPackageSources() {
        return PackageBrowseService.getPackageSources();
    }

    // ============ HELPER METHODS ============

    /**
     * Transform ConsolidationInfo to BasicConsolidationPackage format for enrichment
     */
    private static transformConsolidationInfoToPackages(consolidationInfo: ConsolidationInfo[], allProjects: ProjectInfo[]): BasicConsolidationPackage[] {
        const consolidatePackages: BasicConsolidationPackage[] = [];

        for (const info of consolidationInfo) {
            // Find the latest version being used
            const latestUsedVersion = info.versions.reduce((latest, current) => {
                return !latest || current.version > latest.version ? current : latest;
            }).version;

            const consolidatePackage: BasicConsolidationPackage = {
                id: info.packageId,
                currentVersion: latestUsedVersion,
                latestVersion: info.latestVersion,
                allVersions: info.versions.map(v => v.version),
                needsConsolidation: true,
                currentVersions: info.versions,
                projects: allProjects.filter(p =>
                    info.versions.some(v => v.projects.includes(p.path))
                )
            };

            consolidatePackages.push(consolidatePackage);
        }

        return consolidatePackages;
    }

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
}