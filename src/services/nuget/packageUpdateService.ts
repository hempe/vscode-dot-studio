import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { logger } from '../../core/logger';
import { UpdateablePackage, PackageOperationResult, NuGetPackage } from './types';
import { PackageBrowseService } from './packageBrowseService';

const execAsync = promisify(exec);
const log = logger('PackageUpdateService');

/**
 * Service for managing package updates using dotnet CLI
 * Handles finding outdated packages and updating them
 */
export class PackageUpdateService {

    /**
     * Get all packages that have available updates across all projects
     */
    static async getOutdatedPackages(solutionPath?: string): Promise<UpdateablePackage[]> {
        try {
            const workingDir = solutionPath ? path.dirname(solutionPath) : process.cwd();

            // Use dotnet list package --outdated to find packages with updates
            const command = 'dotnet list package --outdated --format json';
            log.info(`Getting outdated packages: ${command}`);

            const { stdout, stderr } = await execAsync(command, {
                cwd: workingDir,
                timeout: 45000, // Longer timeout as this command can be slow
                encoding: 'utf8'
            });

            if (stderr && !stderr.includes('warn')) {
                log.warn('dotnet list package --outdated stderr:', stderr);
            }

            return this.parseOutdatedPackages(stdout);

        } catch (error) {
            log.error('Error getting outdated packages:', error);
            return [];
        }
    }

    /**
     * Get outdated packages with rich metadata for UI display
     * This enhances basic update data with NuGet API metadata
     */
    static async getOutdatedPackagesWithMetadata(solutionPath?: string): Promise<(UpdateablePackage & Partial<NuGetPackage>)[]> {
        try {
            // Get basic outdated package data from dotnet CLI
            const basicPackages = await this.getOutdatedPackages(solutionPath);

            if (basicPackages.length === 0) {
                return [];
            }

            // Get unique package IDs to avoid duplicate API calls
            const uniquePackageIds = [...new Set(basicPackages.map(pkg => pkg.id))];
            log.info(`Enriching ${uniquePackageIds.length} unique outdated packages with NuGet metadata`);

            // Create a map to store metadata by package ID
            const metadataMap = new Map<string, NuGetPackage>();

            // Fetch metadata for each unique package in parallel (with limit to avoid overwhelming API)
            const batchSize = 5; // Process 5 packages at a time
            for (let i = 0; i < uniquePackageIds.length; i += batchSize) {
                const batch = uniquePackageIds.slice(i, i + batchSize);

                const metadataPromises = batch.map(async (packageId) => {
                    try {
                        const metadata = await PackageBrowseService.getPackageDetails(packageId);
                        if (metadata) {
                            metadataMap.set(packageId.toLowerCase(), metadata);
                        }
                    } catch (error) {
                        log.warn(`Failed to get metadata for ${packageId}:`, error);
                    }
                });

                await Promise.all(metadataPromises);
            }

            // Merge metadata into basic package data
            const enrichedPackages = basicPackages.map(basicPkg => {
                const metadata = metadataMap.get(basicPkg.id.toLowerCase());

                if (metadata) {
                    // Merge metadata while preserving update-specific fields
                    return {
                        ...basicPkg, // Keep all original UpdateablePackage fields
                        // Add NuGet metadata
                        description: metadata.description,
                        authors: metadata.authors,
                        projectUrl: metadata.projectUrl,
                        licenseUrl: metadata.licenseUrl,
                        iconUrl: metadata.iconUrl,
                        tags: metadata.tags,
                        totalDownloads: metadata.totalDownloads,
                        allVersions: metadata.allVersions,
                        source: metadata.source,
                        // Set version to current version for consistency with UI expectations
                        version: basicPkg.currentVersion
                    };
                } else {
                    // Return basic package if metadata fetch failed
                    return {
                        ...basicPkg,
                        // Set version field for UI consistency
                        version: basicPkg.currentVersion
                    };
                }
            });

            log.info(`Successfully enriched ${enrichedPackages.filter(pkg => 'description' in pkg && pkg.description).length}/${basicPackages.length} outdated packages with metadata`);
            return enrichedPackages;

        } catch (error) {
            log.error('Error enriching outdated packages with metadata:', error);
            // Return basic packages if enrichment fails
            const basicPackages = await this.getOutdatedPackages(solutionPath);
            return basicPackages.map(pkg => ({ ...pkg, version: pkg.currentVersion }));
        }
    }

    /**
     * Get outdated packages for a specific project
     */
    static async getProjectOutdatedPackages(projectPath: string): Promise<UpdateablePackage[]> {
        try {
            const command = `dotnet list "${projectPath}" package --outdated --format json`;
            log.info(`Getting outdated packages for project: ${command}`);

            const { stdout, stderr } = await execAsync(command, {
                timeout: 30000,
                encoding: 'utf8'
            });

            if (stderr && !stderr.includes('warn')) {
                log.warn('dotnet list package --outdated stderr:', stderr);
            }

            const allOutdated = this.parseOutdatedPackages(stdout);
            return allOutdated.filter(pkg => pkg.projectPath === projectPath);

        } catch (error) {
            log.error(`Error getting outdated packages for project ${projectPath}:`, error);
            return [];
        }
    }

    /**
     * Update a specific package in a project to the latest version
     */
    static async updatePackage(
        projectPath: string,
        packageId: string,
        targetVersion?: string
    ): Promise<PackageOperationResult> {
        try {
            const args = ['add', `"${projectPath}"`, 'package', packageId];

            if (targetVersion) {
                args.push('--version', targetVersion);
            }

            const command = `dotnet ${args.join(' ')}`;
            log.info(`Updating package: ${command}`);

            const { stdout, stderr } = await execAsync(command, {
                timeout: 60000,
                encoding: 'utf8'
            });

            // Check if the command was successful
            const success = !stderr.includes('error') && !stdout.includes('error');

            if (success) {
                log.info(`Successfully updated ${packageId} in ${path.basename(projectPath)}`);
                return {
                    success: true,
                    message: `Successfully updated ${packageId} to ${targetVersion || 'latest version'}`,
                    packageId,
                    version: targetVersion,
                    projectPath
                };
            } else {
                const errorMessage = stderr || stdout || 'Unknown error occurred';
                log.error(`Failed to update ${packageId}:`, errorMessage);
                return {
                    success: false,
                    message: `Failed to update ${packageId}: ${errorMessage}`,
                    packageId,
                    projectPath
                };
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            log.error(`Error updating package ${packageId} in ${projectPath}:`, error);
            return {
                success: false,
                message: `Error updating ${packageId}: ${errorMessage}`,
                packageId,
                projectPath
            };
        }
    }

    /**
     * Update all outdated packages in a project
     */
    static async updateAllPackages(projectPath: string): Promise<PackageOperationResult[]> {
        try {
            const outdatedPackages = await this.getProjectOutdatedPackages(projectPath);

            if (outdatedPackages.length === 0) {
                return [{
                    success: true,
                    message: 'No packages need updating',
                    projectPath
                }];
            }

            log.info(`Updating ${outdatedPackages.length} packages in ${path.basename(projectPath)}`);

            const updatePromises = outdatedPackages.map(pkg =>
                this.updatePackage(projectPath, pkg.id, pkg.latestVersion)
            );

            const results = await Promise.all(updatePromises);

            // Log summary
            const successful = results.filter(r => r.success).length;
            const failed = results.length - successful;
            log.info(`Update summary: ${successful} successful, ${failed} failed`);

            return results;

        } catch (error) {
            log.error(`Error updating all packages in ${projectPath}:`, error);
            return [{
                success: false,
                message: `Error updating packages: ${error instanceof Error ? error.message : 'Unknown error'}`,
                projectPath
            }];
        }
    }

    /**
     * Check if a specific package has an available update
     */
    static async checkPackageUpdate(
        projectPath: string,
        packageId: string
    ): Promise<UpdateablePackage | null> {
        try {
            const outdatedPackages = await this.getProjectOutdatedPackages(projectPath);
            return outdatedPackages.find(pkg =>
                pkg.id.toLowerCase() === packageId.toLowerCase()
            ) || null;

        } catch (error) {
            log.error(`Error checking update for ${packageId}:`, error);
            return null;
        }
    }

    /**
     * Get update statistics for a solution
     */
    static async getUpdateStatistics(solutionPath?: string): Promise<{
        totalPackages: number;
        outdatedPackages: number;
        projectsWithUpdates: number;
        criticalUpdates: number;
    }> {
        try {
            const outdatedPackages = await this.getOutdatedPackages(solutionPath);

            const projectsWithUpdates = new Set(outdatedPackages.map(pkg => pkg.projectPath)).size;

            // Consider packages as "critical" if they have major version updates
            // This is a simple heuristic - in reality you'd want more sophisticated analysis
            const criticalUpdates = outdatedPackages.filter(pkg => {
                const currentMajor = this.getMajorVersion(pkg.currentVersion);
                const latestMajor = this.getMajorVersion(pkg.latestVersion);
                return latestMajor > currentMajor;
            }).length;

            return {
                totalPackages: outdatedPackages.length,
                outdatedPackages: outdatedPackages.length,
                projectsWithUpdates,
                criticalUpdates
            };

        } catch (error) {
            log.error('Error getting update statistics:', error);
            return {
                totalPackages: 0,
                outdatedPackages: 0,
                projectsWithUpdates: 0,
                criticalUpdates: 0
            };
        }
    }

    /**
     * Parse the JSON output from dotnet list package --outdated command
     */
    private static parseOutdatedPackages(stdout: string): UpdateablePackage[] {
        try {
            if (!stdout.trim()) {
                return [];
            }

            const data = JSON.parse(stdout);
            const outdatedPackages: UpdateablePackage[] = [];

            if (data.projects && Array.isArray(data.projects)) {
                for (const project of data.projects) {
                    const projectPath = project.path || '';
                    const projectName = path.basename(projectPath, path.extname(projectPath));

                    if (project.frameworks && Array.isArray(project.frameworks)) {
                        for (const framework of project.frameworks) {
                            if (framework.topLevelPackages && Array.isArray(framework.topLevelPackages)) {
                                for (const pkg of framework.topLevelPackages) {
                                    outdatedPackages.push({
                                        id: pkg.id,
                                        currentVersion: pkg.requestedVersion || pkg.resolvedVersion || '',
                                        latestVersion: pkg.latestVersion || '',
                                        projectPath,
                                        projectName
                                    });
                                }
                            }

                            if (framework.transitivePackages && Array.isArray(framework.transitivePackages)) {
                                for (const pkg of framework.transitivePackages) {
                                    outdatedPackages.push({
                                        id: pkg.id,
                                        currentVersion: pkg.resolvedVersion || '',
                                        latestVersion: pkg.latestVersion || '',
                                        projectPath,
                                        projectName
                                    });
                                }
                            }
                        }
                    }
                }
            }

            return outdatedPackages;

        } catch (error) {
            log.error('Error parsing outdated packages:', error);
            return [];
        }
    }

    /**
     * Extract major version number from a version string
     */
    private static getMajorVersion(version: string): number {
        try {
            const match = version.match(/^(\d+)/);
            return match ? parseInt(match[1], 10) : 0;
        } catch {
            return 0;
        }
    }
}