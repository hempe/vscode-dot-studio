import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { logger } from '../../core/logger';
import { ConsolidationInfo, InstalledPackage, PackageOperationResult } from './types';
import { PackageInstalledService } from './packageInstalledService';
import { PackageOperationsService } from './packageOperationsService';

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
    static async getPackagesNeedingConsolidation(solutionPath?: string): Promise<ConsolidationInfo[]> {
        try {
            const allPackages = await PackageInstalledService.getInstalledPackages(solutionPath);

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
                    const version = pkg.version;
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
    static async consolidateAllToLatest(solutionPath?: string): Promise<PackageOperationResult[]> {
        try {
            const packagesNeedingConsolidation = await this.getPackagesNeedingConsolidation(solutionPath);

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
     * Get consolidation recommendations for a solution
     */
    static async getConsolidationRecommendations(solutionPath?: string): Promise<{
        packageId: string;
        recommendedVersion: string;
        currentVersions: Array<{ version: string; projectCount: number }>;
        reasoning: string;
    }[]> {
        try {
            const packagesNeedingConsolidation = await this.getPackagesNeedingConsolidation(solutionPath);

            return packagesNeedingConsolidation.map(info => {
                const currentVersions = info.versions.map(v => ({
                    version: v.version,
                    projectCount: v.projects.length
                }));

                // Recommend the latest version if available, otherwise the most common version
                let recommendedVersion = info.latestVersion;
                let reasoning = 'Latest version available';

                if (!recommendedVersion) {
                    // Find the most common version
                    const mostCommonVersion = currentVersions.reduce((prev, current) =>
                        prev.projectCount > current.projectCount ? prev : current
                    );
                    recommendedVersion = mostCommonVersion.version;
                    reasoning = `Most commonly used version (${mostCommonVersion.projectCount} projects)`;
                }

                return {
                    packageId: info.packageId,
                    recommendedVersion: recommendedVersion!,
                    currentVersions,
                    reasoning
                };
            });

        } catch (error) {
            log.error('Error getting consolidation recommendations:', error);
            return [];
        }
    }

    /**
     * Check if a specific package needs consolidation
     */
    static async doesPackageNeedConsolidation(
        packageId: string,
        solutionPath?: string
    ): Promise<ConsolidationInfo | null> {
        try {
            const packagesNeedingConsolidation = await this.getPackagesNeedingConsolidation(solutionPath);
            return packagesNeedingConsolidation.find(info =>
                info.packageId.toLowerCase() === packageId.toLowerCase()
            ) || null;

        } catch (error) {
            log.error(`Error checking consolidation for ${packageId}:`, error);
            return null;
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
     * Get the highest version from a list of version strings
     */
    private static getHighestVersion(versions: string[]): string | undefined {
        if (versions.length === 0) return undefined;

        // Simple version comparison - in a real implementation you'd want proper semver comparison
        return versions.sort((a, b) => {
            const aParts = a.split('.').map(Number);
            const bParts = b.split('.').map(Number);

            for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
                const aPart = aParts[i] || 0;
                const bPart = bParts[i] || 0;

                if (aPart !== bPart) {
                    return bPart - aPart; // Descending order
                }
            }

            return 0;
        })[0];
    }
}