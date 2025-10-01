import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { logger } from '../../core/logger';
import { PackageInstallOptions, PackageOperationResult } from './types';

const execAsync = promisify(exec);

/**
 * Service for NuGet package operations (install, uninstall, restore) using dotnet CLI
 * Handles the core package management operations
 */
export class PackageOperationsService {
    private static readonly logger = logger('PackageOperationsService');

    /**
     * Install a NuGet package in a project
     */
    static async installPackage(options: PackageInstallOptions): Promise<PackageOperationResult> {
        try {
            const args = ['add', `"${options.projectPath}"`, 'package', options.packageId];

            if (options.version) {
                args.push('--version', options.version);
            }

            if (options.source) {
                args.push('--source', options.source);
            }

            if (options.prerelease) {
                args.push('--prerelease');
            }

            if (options.noRestore) {
                args.push('--no-restore');
            }

            const command = `dotnet ${args.join(' ')}`;
            this.logger.info(`Installing package: ${command}`);

            const { stdout, stderr } = await execAsync(command, {
                timeout: 120000, // 2 minutes for package installation
                encoding: 'utf8'
            });

            // Check if the command was successful
            const success = !stderr.includes('error') && !stdout.includes('error');

            if (success) {
                this.logger.info(`Successfully installed ${options.packageId} in ${path.basename(options.projectPath)}`);
                return {
                    success: true,
                    message: `Successfully installed ${options.packageId}${options.version ? ` version ${options.version}` : ''}`,
                    packageId: options.packageId,
                    version: options.version,
                    projectPath: options.projectPath
                };
            } else {
                const errorMessage = stderr || stdout || 'Unknown error occurred';
                this.logger.error(`Failed to install ${options.packageId}:`, errorMessage);
                return {
                    success: false,
                    message: `Failed to install ${options.packageId}: ${errorMessage}`,
                    packageId: options.packageId,
                    projectPath: options.projectPath
                };
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(`Error installing package ${options.packageId}:`, error);
            return {
                success: false,
                message: `Error installing ${options.packageId}: ${errorMessage}`,
                packageId: options.packageId,
                projectPath: options.projectPath
            };
        }
    }

    /**
     * Uninstall a NuGet package from a project
     */
    static async uninstallPackage(projectPath: string, packageId: string): Promise<PackageOperationResult> {
        try {
            const command = `dotnet remove "${projectPath}" package ${packageId}`;
            this.logger.info(`Uninstalling package: ${command}`);

            const { stdout, stderr } = await execAsync(command, {
                timeout: 60000,
                encoding: 'utf8'
            });

            // Check if the command was successful
            const success = !stderr.includes('error') && !stdout.includes('error');

            if (success) {
                this.logger.info(`Successfully uninstalled ${packageId} from ${path.basename(projectPath)}`);
                return {
                    success: true,
                    message: `Successfully uninstalled ${packageId}`,
                    packageId,
                    projectPath
                };
            } else {
                const errorMessage = stderr || stdout || 'Unknown error occurred';
                this.logger.error(`Failed to uninstall ${packageId}:`, errorMessage);
                return {
                    success: false,
                    message: `Failed to uninstall ${packageId}: ${errorMessage}`,
                    packageId,
                    projectPath
                };
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(`Error uninstalling package ${packageId}:`, error);
            return {
                success: false,
                message: `Error uninstalling ${packageId}: ${errorMessage}`,
                packageId,
                projectPath
            };
        }
    }

    /**
     * Restore packages for a project or solution
     */
    static async restorePackages(targetPath: string): Promise<PackageOperationResult> {
        try {
            const command = `dotnet restore "${targetPath}"`;
            this.logger.info(`Restoring packages: ${command}`);

            const { stdout, stderr } = await execAsync(command, {
                timeout: 180000, // 3 minutes for restore operation
                encoding: 'utf8'
            });

            // Check if the command was successful
            const success = stdout.includes('Restore succeeded') ||
                          (!stderr.includes('error') && !stdout.includes('error'));

            if (success) {
                const targetName = path.basename(targetPath);
                this.logger.info(`Successfully restored packages for ${targetName}`);
                return {
                    success: true,
                    message: `Successfully restored packages for ${targetName}`,
                    projectPath: targetPath
                };
            } else {
                const errorMessage = stderr || stdout || 'Unknown error occurred';
                this.logger.error(`Failed to restore packages:`, errorMessage);
                return {
                    success: false,
                    message: `Failed to restore packages: ${errorMessage}`,
                    projectPath: targetPath
                };
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(`Error restoring packages:`, error);
            return {
                success: false,
                message: `Error restoring packages: ${errorMessage}`,
                projectPath: targetPath
            };
        }
    }

    /**
     * Add a package reference with specific framework
     */
    static async addPackageReference(
        projectPath: string,
        packageId: string,
        version?: string,
        framework?: string
    ): Promise<PackageOperationResult> {
        try {
            const args = ['add', `"${projectPath}"`, 'package', packageId];

            if (version) {
                args.push('--version', version);
            }

            if (framework) {
                args.push('--framework', framework);
            }

            const command = `dotnet ${args.join(' ')}`;
            this.logger.info(`Adding package reference: ${command}`);

            const { stdout, stderr } = await execAsync(command, {
                timeout: 90000,
                encoding: 'utf8'
            });

            const success = !stderr.includes('error') && !stdout.includes('error');

            if (success) {
                return {
                    success: true,
                    message: `Successfully added reference to ${packageId}`,
                    packageId,
                    version,
                    projectPath
                };
            } else {
                const errorMessage = stderr || stdout || 'Unknown error occurred';
                return {
                    success: false,
                    message: `Failed to add reference to ${packageId}: ${errorMessage}`,
                    packageId,
                    projectPath
                };
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(`Error adding package reference:`, error);
            return {
                success: false,
                message: `Error adding package reference: ${errorMessage}`,
                packageId,
                projectPath
            };
        }
    }

    /**
     * Clear package cache
     */
    static async clearCache(): Promise<PackageOperationResult> {
        try {
            const command = 'dotnet nuget locals all --clear';
            this.logger.info(`Clearing package cache: ${command}`);

            const { stdout, stderr } = await execAsync(command, {
                timeout: 60000,
                encoding: 'utf8'
            });

            const success = stdout.includes('Clearing') ||
                          (!stderr.includes('error') && !stdout.includes('error'));

            if (success) {
                this.logger.info('Successfully cleared package cache');
                return {
                    success: true,
                    message: 'Successfully cleared package cache'
                };
            } else {
                const errorMessage = stderr || stdout || 'Unknown error occurred';
                this.logger.error('Failed to clear package cache:', errorMessage);
                return {
                    success: false,
                    message: `Failed to clear package cache: ${errorMessage}`
                };
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Error clearing package cache:', error);
            return {
                success: false,
                message: `Error clearing package cache: ${errorMessage}`
            };
        }
    }

    /**
     * Verify package installation
     */
    static async verifyPackageInstalled(projectPath: string, packageId: string): Promise<boolean> {
        try {
            const command = `dotnet list "${projectPath}" package`;
            const { stdout } = await execAsync(command, { timeout: 15000 });

            return stdout.includes(packageId);

        } catch (error) {
            this.logger.error(`Error verifying package installation:`, error);
            return false;
        }
    }

    /**
     * Get package installation status
     */
    static async getPackageStatus(projectPath: string, packageId: string): Promise<{
        installed: boolean;
        version?: string;
        isTransitive?: boolean;
    }> {
        try {
            const command = `dotnet list "${projectPath}" package --format json`;
            const { stdout } = await execAsync(command, { timeout: 15000 });

            const data = JSON.parse(stdout);

            if (data.projects && Array.isArray(data.projects)) {
                for (const project of data.projects) {
                    if (project.frameworks && Array.isArray(project.frameworks)) {
                        for (const framework of project.frameworks) {
                            // Check top-level packages
                            if (framework.topLevelPackages && Array.isArray(framework.topLevelPackages)) {
                                const topLevelPkg = framework.topLevelPackages.find(
                                    (pkg: any) => pkg.id.toLowerCase() === packageId.toLowerCase()
                                );
                                if (topLevelPkg) {
                                    return {
                                        installed: true,
                                        version: topLevelPkg.requestedVersion || topLevelPkg.resolvedVersion,
                                        isTransitive: false
                                    };
                                }
                            }

                            // Check transitive packages
                            if (framework.transitivePackages && Array.isArray(framework.transitivePackages)) {
                                const transitivePkg = framework.transitivePackages.find(
                                    (pkg: any) => pkg.id.toLowerCase() === packageId.toLowerCase()
                                );
                                if (transitivePkg) {
                                    return {
                                        installed: true,
                                        version: transitivePkg.resolvedVersion,
                                        isTransitive: true
                                    };
                                }
                            }
                        }
                    }
                }
            }

            return { installed: false };

        } catch (error) {
            this.logger.error(`Error getting package status:`, error);
            return { installed: false };
        }
    }
}