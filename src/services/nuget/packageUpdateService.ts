import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import semver from 'semver';
import { logger } from '../../core/logger';
import { BasicUpdateablePackage, UpdateablePackage, PackageOperationResult, NuGetPackage } from './types';
import { PackageSharedService } from './packageSharedService';

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
    static async getOutdatedPackages(solutionPath?: string): Promise<BasicUpdateablePackage[]> {
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

            // Enrich packages with metadata using the same method as browse packages
            const enrichedPackages = await PackageSharedService.enrichWithBrowseMetadata(basicPackages);

            // Set version field to current version for UI consistency
            return enrichedPackages.map(pkg => ({
                ...pkg,
                version: pkg.currentVersion
            }));

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
    static async getProjectOutdatedPackages(projectPath: string): Promise<BasicUpdateablePackage[]> {
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
     * Get outdated packages for a specific project with rich metadata for UI display
     * This enhances basic update data with NuGet API metadata
     */
    static async getProjectOutdatedPackagesWithMetadata(projectPath: string): Promise<(UpdateablePackage & Partial<NuGetPackage>)[]> {
        try {
            // Get basic outdated package data from dotnet CLI
            const basicPackages = await this.getProjectOutdatedPackages(projectPath);

            if (basicPackages.length === 0) {
                return [];
            }

            // Enrich packages with metadata using the same method as browse packages
            const enrichedPackages = await PackageSharedService.enrichWithBrowseMetadata(basicPackages);

            // Set version field to current version for UI consistency
            return enrichedPackages.map(pkg => ({
                ...pkg,
                version: pkg.currentVersion
            }));

        } catch (error) {
            log.error(`Error enriching project outdated packages with metadata for ${projectPath}:`, error);
            // Return basic packages if enrichment fails
            const basicPackages = await this.getProjectOutdatedPackages(projectPath);
            return basicPackages.map(pkg => ({ ...pkg, version: pkg.currentVersion }));
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
                try {
                    const currentMajor = semver.major(pkg.currentVersion);
                    const latestMajor = semver.major(pkg.latestVersion);
                    return latestMajor > currentMajor;
                } catch {
                    // If semver parsing fails, fall back to false (not critical)
                    return false;
                }
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
    private static parseOutdatedPackages(stdout: string): BasicUpdateablePackage[] {
        try {
            if (!stdout.trim()) {
                return [];
            }

            const data = JSON.parse(stdout);
            const outdatedPackages: BasicUpdateablePackage[] = [];

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


}