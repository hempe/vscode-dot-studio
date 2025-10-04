import { logger } from '../../core/logger';
import { PackageBrowseService } from './packageBrowseService';
import { PackageInstalledService } from './packageInstalledService';
import { PackageUpdateService } from './packageUpdateService';
import { PackageOperationsService } from './packageOperationsService';
import { PackageConsolidationService } from './packageConsolidationService';
import {
    PackageSearchOptions,
    PackageInstallOptions,
    PackageOperationResult
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

            const [
                allProjects,
                installedPackages,
                outdatedPackages,
                consolidationInfo,
                updateStats
            ] = await Promise.all([
                PackageInstalledService.getAllProjectsInfo(solutionPath),
                PackageInstalledService.getInstalledPackagesWithMetadata(solutionPath),
                PackageUpdateService.getOutdatedPackagesWithMetadata(solutionPath),
                PackageConsolidationService.getPackagesNeedingConsolidation(solutionPath),
                PackageUpdateService.getUpdateStatistics(solutionPath)
            ]);

            return {
                context: 'solution',
                solutionPath,
                projects: allProjects,
                totalPackages: installedPackages.length,
                installedPackages,
                outdatedPackages,
                consolidationInfo,
                updateStats,
                lastUpdated: new Date().toISOString()
            };

        } catch (error) {
            log.error('Error getting solution NuGet data:', error);
            throw error;
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

            const [
                projectInfo,
                installedPackages,
                outdatedPackages
            ] = await Promise.all([
                PackageInstalledService.getProjectInfo(projectPath),
                PackageInstalledService.getProjectPackages(projectPath),
                PackageUpdateService.getProjectOutdatedPackages(projectPath)
            ]);

            return {
                context: 'project',
                projectPath,
                projectInfo,
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