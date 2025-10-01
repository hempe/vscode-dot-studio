import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { logger } from '../../core/logger';
import { UpdateablePackage, PackageOperationResult } from './types';

const execAsync = promisify(exec);

/**
 * Service for managing package updates using dotnet CLI
 * Handles finding outdated packages and updating them
 */
export class PackageUpdateService {
    private static readonly logger = logger('PackageUpdateService');

    /**
     * Get all packages that have available updates across all projects
     */
    static async getOutdatedPackages(solutionPath?: string): Promise<UpdateablePackage[]> {
        try {
            const workingDir = solutionPath ? path.dirname(solutionPath) : process.cwd();

            // Use dotnet list package --outdated to find packages with updates
            const command = 'dotnet list package --outdated --format json';
            this.logger.info(`Getting outdated packages: ${command}`);

            const { stdout, stderr } = await execAsync(command, {
                cwd: workingDir,
                timeout: 45000, // Longer timeout as this command can be slow
                encoding: 'utf8'
            });

            if (stderr && !stderr.includes('warn')) {
                this.logger.warn('dotnet list package --outdated stderr:', stderr);
            }

            return this.parseOutdatedPackages(stdout);

        } catch (error) {
            this.logger.error('Error getting outdated packages:', error);
            return [];
        }
    }

    /**
     * Get outdated packages for a specific project
     */
    static async getProjectOutdatedPackages(projectPath: string): Promise<UpdateablePackage[]> {
        try {
            const command = `dotnet list "${projectPath}" package --outdated --format json`;
            this.logger.info(`Getting outdated packages for project: ${command}`);

            const { stdout, stderr } = await execAsync(command, {
                timeout: 30000,
                encoding: 'utf8'
            });

            if (stderr && !stderr.includes('warn')) {
                this.logger.warn('dotnet list package --outdated stderr:', stderr);
            }

            const allOutdated = this.parseOutdatedPackages(stdout);
            return allOutdated.filter(pkg => pkg.projectPath === projectPath);

        } catch (error) {
            this.logger.error(`Error getting outdated packages for project ${projectPath}:`, error);
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
            this.logger.info(`Updating package: ${command}`);

            const { stdout, stderr } = await execAsync(command, {
                timeout: 60000,
                encoding: 'utf8'
            });

            // Check if the command was successful
            const success = !stderr.includes('error') && !stdout.includes('error');

            if (success) {
                this.logger.info(`Successfully updated ${packageId} in ${path.basename(projectPath)}`);
                return {
                    success: true,
                    message: `Successfully updated ${packageId} to ${targetVersion || 'latest version'}`,
                    packageId,
                    version: targetVersion,
                    projectPath
                };
            } else {
                const errorMessage = stderr || stdout || 'Unknown error occurred';
                this.logger.error(`Failed to update ${packageId}:`, errorMessage);
                return {
                    success: false,
                    message: `Failed to update ${packageId}: ${errorMessage}`,
                    packageId,
                    projectPath
                };
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(`Error updating package ${packageId} in ${projectPath}:`, error);
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

            this.logger.info(`Updating ${outdatedPackages.length} packages in ${path.basename(projectPath)}`);

            const updatePromises = outdatedPackages.map(pkg =>
                this.updatePackage(projectPath, pkg.id, pkg.latestVersion)
            );

            const results = await Promise.all(updatePromises);

            // Log summary
            const successful = results.filter(r => r.success).length;
            const failed = results.length - successful;
            this.logger.info(`Update summary: ${successful} successful, ${failed} failed`);

            return results;

        } catch (error) {
            this.logger.error(`Error updating all packages in ${projectPath}:`, error);
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
            this.logger.error(`Error checking update for ${packageId}:`, error);
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
            this.logger.error('Error getting update statistics:', error);
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
            this.logger.error('Error parsing outdated packages:', error);
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