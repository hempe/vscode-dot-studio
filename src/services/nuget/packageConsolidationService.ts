import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { logger } from '../../core/logger';
import { ConsolidationInfo, InstalledPackage, PackageOperationResult } from './types';
import { PackageInstalledService } from './packageInstalledService';
import { PackageOperationsService } from './packageOperationsService';
import { PackageUpdateService } from './packageUpdateService';
import { VersionUtils } from '../versionUtils';

const execAsync = promisify(exec);
const log = logger('PackageConsolidationService');

/**
 * Service for package consolidation across multiple projects in a solution
 * Helps manage package versions to ensure consistency across projects
 */
export class PackageConsolidationService {

    /**
     * Get all packages that need consolidation across projects
     * These are packages that exist in multiple projects but with different versions
     */
    static async getPackagesNeedingConsolidation(): Promise<ConsolidationInfo[]> {
        try {
            // Use active solution for much better performance
            const allProjects = await PackageInstalledService.getAllProjectsInfoFromActiveSolution();
            const allPackages = allProjects.flatMap(project => project.packages);

            // Group packages by ID
            const packageGroups = new Map<string, InstalledPackage[]>();

            for (const pkg of allPackages) {
                // Only consider top-level packages (not transitive dependencies)
                if (!pkg.transitivePackage) {
                    const existingGroup = packageGroups.get(pkg.id) || [];
                    existingGroup.push(pkg);
                    packageGroups.set(pkg.id, existingGroup);
                }
            }

            const consolidationInfos: ConsolidationInfo[] = [];

            // Find packages with multiple versions
            for (const [packageId, packages] of packageGroups.entries()) {
                const versionGroups = new Map<string, string[]>();

                // Group by version
                for (const pkg of packages) {
                    const version = pkg.currentVersion;
                    const existingProjects = versionGroups.get(version) || [];
                    existingProjects.push(pkg.projectPath);
                    versionGroups.set(version, existingProjects);
                }

                // If there are multiple versions, this package needs consolidation
                if (versionGroups.size > 1) {
                    const versions = Array.from(versionGroups.entries()).map(([version, projects]) => ({
                        version,
                        projects
                    }));

                    // Get the latest version for recommendations
                    const latestVersion = await this.getLatestVersion(packageId);

                    consolidationInfos.push({
                        packageId,
                        versions,
                        latestVersion
                    });
                }
            }

            log.info(`Found ${consolidationInfos.length} packages needing consolidation`);
            return consolidationInfos;

        } catch (error) {
            log.error('Error getting packages needing consolidation:', error);
            return [];
        }
    }

    /**
     * Consolidate a package to a specific version across all projects
     */
    static async consolidatePackage(
        packageId: string,
        targetVersion: string,
        projectPaths: string[]
    ): Promise<PackageOperationResult[]> {
        try {
            log.info(`Consolidating ${packageId} to version ${targetVersion} across ${projectPaths.length} projects`);

            const results: PackageOperationResult[] = [];

            for (const projectPath of projectPaths) {
                try {
                    // First, check if package is already at target version
                    const status = await PackageOperationsService.getPackageStatus(projectPath, packageId);

                    if (status.installed && status.version === targetVersion) {
                        results.push({
                            success: true,
                            message: `Package ${packageId} already at target version ${targetVersion}`,
                            packageId,
                            version: targetVersion,
                            projectPath
                        });
                        continue;
                    }

                    // Remove the current version
                    if (status.installed && !status.isTransitive) {
                        const removeResult = await PackageOperationsService.uninstallPackage(projectPath, packageId);
                        if (!removeResult.success) {
                            results.push(removeResult);
                            continue;
                        }
                    }

                    // Install the target version
                    const installResult = await PackageOperationsService.installPackage({
                        packageId,
                        version: targetVersion,
                        projectPath
                    });

                    results.push(installResult);

                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    results.push({
                        success: false,
                        message: `Error consolidating ${packageId} in ${path.basename(projectPath)}: ${errorMessage}`,
                        packageId,
                        projectPath
                    });
                }
            }

            // Log summary
            const successful = results.filter(r => r.success).length;
            const failed = results.length - successful;
            log.info(`Consolidation summary for ${packageId}: ${successful} successful, ${failed} failed`);

            return results;

        } catch (error) {
            log.error(`Error consolidating package ${packageId}:`, error);
            return [{
                success: false,
                message: `Error consolidating package ${packageId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                packageId
            }];
        }
    }

    /**
     * Consolidate all packages to their latest versions
     */
    static async consolidateAllToLatest(): Promise<PackageOperationResult[]> {
        try {
            const packagesNeedingConsolidation = await this.getPackagesNeedingConsolidation();

            if (packagesNeedingConsolidation.length === 0) {
                return [{
                    success: true,
                    message: 'No packages need consolidation'
                }];
            }

            const allResults: PackageOperationResult[] = [];

            for (const consolidationInfo of packagesNeedingConsolidation) {
                const targetVersion = consolidationInfo.latestVersion ||
                    this.getHighestVersion(consolidationInfo.versions.map(v => v.version));

                if (targetVersion) {
                    // Get all projects that have this package
                    const allProjectPaths = consolidationInfo.versions.flatMap(v => v.projects);

                    const results = await this.consolidatePackage(
                        consolidationInfo.packageId,
                        targetVersion,
                        allProjectPaths
                    );

                    allResults.push(...results);
                }
            }

            return allResults;

        } catch (error) {
            log.error('Error consolidating all packages:', error);
            return [{
                success: false,
                message: `Error consolidating packages: ${error instanceof Error ? error.message : 'Unknown error'}`
            }];
        }
    }

    /**
     * Get the latest version of a package (simplified implementation)
     */
    private static async getLatestVersion(packageId: string): Promise<string | undefined> {
        try {
            // Use dotnet search to get the latest version
            const command = `dotnet search "${packageId}" --exact-match --format json`;
            const { stdout } = await execAsync(command, { timeout: 15000 });

            if (stdout.trim()) {
                const lines = stdout.split('\n').filter(line => line.trim());
                for (const line of lines) {
                    try {
                        const packageData = JSON.parse(line);
                        if (packageData.id && packageData.id.toLowerCase() === packageId.toLowerCase()) {
                            return packageData.version || packageData.latestVersion;
                        }
                    } catch {
                        continue;
                    }
                }
            }

            return undefined;

        } catch (error) {
            log.debug(`Could not get latest version for ${packageId}`);
            return undefined;
        }
    }

    /**
     * Consolidate a specific package to a target version across all projects in solution
     */
    static async consolidatePackageToVersion(
        _solutionPath: string,
        packageId: string,
        targetVersion: string
    ): Promise<PackageOperationResult[]> {
        try {
            log.info(`Consolidating package ${packageId} to version ${targetVersion} across solution`);

            // Get all projects that have this package using active solution
            const allProjects = await PackageInstalledService.getAllProjectsInfoFromActiveSolution();
            const allPackages = allProjects.flatMap(project => project.packages);
            const packagesWithThisId = allPackages.filter(pkg => pkg.id.toLowerCase() === packageId.toLowerCase());

            if (packagesWithThisId.length === 0) {
                return [{
                    success: false,
                    message: `Package ${packageId} is not installed in any project`,
                    packageId
                }];
            }

            // Group by project and find projects that need updating
            const projectsToUpdate = new Map<string, InstalledPackage>();
            for (const pkg of packagesWithThisId) {
                if (pkg.currentVersion !== targetVersion) {
                    projectsToUpdate.set(pkg.projectPath, pkg);
                }
            }

            if (projectsToUpdate.size === 0) {
                return [{
                    success: true,
                    message: `Package ${packageId} is already at version ${targetVersion} in all projects`,
                    packageId
                }];
            }

            log.info(`Updating ${packageId} to ${targetVersion} in ${projectsToUpdate.size} projects`);

            const results: PackageOperationResult[] = [];

            // Update each project to the target version
            for (const [projectPath, pkg] of projectsToUpdate) {
                try {
                    log.info(`Updating ${packageId} from ${pkg.currentVersion} to ${targetVersion} in ${path.basename(projectPath)}`);

                    const updateResult = await PackageUpdateService.updatePackage(
                        projectPath,
                        packageId,
                        targetVersion
                    );

                    results.push(updateResult);

                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    results.push({
                        success: false,
                        message: `Error updating ${packageId} to ${targetVersion} in ${path.basename(projectPath)}: ${errorMessage}`,
                        packageId,
                        projectPath
                    });
                }
            }

            // Log summary
            const successful = results.filter(r => r.success).length;
            const failed = results.length - successful;
            log.info(`Consolidation summary for ${packageId}: ${successful} successful, ${failed} failed`);

            return results;

        } catch (error) {
            log.error(`Error consolidating package ${packageId} to version ${targetVersion}:`, error);
            return [{
                success: false,
                message: `Error consolidating package ${packageId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                packageId
            }];
        }
    }

    /**
     * Get the highest version from a list of version strings
     */
    private static getHighestVersion(versions: string[]): string | undefined {
        if (versions.length === 0) return undefined;

        // Use version utilities for proper version comparison
        return versions.sort((a, b) => VersionUtils.rcompare(a, b))[0]; // rcompare for descending order
    }
}