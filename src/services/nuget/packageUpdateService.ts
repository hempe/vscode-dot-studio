import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { logger } from '../../core/logger';
import { BasicUpdateablePackage, PackageOperationResult } from './types';

const execAsync = promisify(exec);
const log = logger('PackageUpdateService');

/**
 * Service for managing package updates using dotnet CLI
 * Handles finding outdated packages and updating them
 */
export class PackageUpdateService {

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

    /**
     * Get outdated packages for a specific project
     */
    private static async getProjectOutdatedPackages(projectPath: string): Promise<BasicUpdateablePackage[]> {
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
}