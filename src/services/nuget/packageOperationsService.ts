import * as path from 'path';
import { logger } from '../../core/logger';
import { PackageInstallOptions, PackageOperationResult } from './types';

import { reportRejectedInOutput } from './feedAuth';
import { execDotnet } from './dotnetCli';
const log = logger('PackageOperationsService');

/**
 * Service for NuGet package operations (install, uninstall, restore) using dotnet CLI
 * Handles the core package management operations
 */
export class PackageOperationsService {

    /**
     * Install a NuGet package in a project
     */
    static async installPackage(options: PackageInstallOptions): Promise<PackageOperationResult> {
        try {
            const args = ['add', options.projectPath, 'package', options.packageId];

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

            log.info(`Installing package: dotnet ${args.join(' ')}`);

            const { stdout, stderr } = await execDotnet(args, {
                timeout: 120000, // 2 minutes for package installation
            });

            // dotnet exits with an error code when it fails (that lands in the catch below); the word "error" in the output of a
            // successful run (a folder `error-pages`, a package named so) does not make it fail
            const success = true;

            if (success) {
                log.info(`Successfully installed ${options.packageId} in ${path.basename(options.projectPath)}`);
                return {
                    success: true,
                    message: `Successfully installed ${options.packageId}${options.version ? ` version ${options.version}` : ''}`,
                    packageId: options.packageId,
                    version: options.version,
                    projectPath: options.projectPath
                };
            } else {
                const errorMessage = stderr || stdout || 'Unknown error occurred';
                void reportRejectedInOutput(`${stdout}\n${stderr}`);
                log.error(`Failed to install ${options.packageId}:`, errorMessage);
                return {
                    success: false,
                    message: `Failed to install ${options.packageId}: ${errorMessage}`,
                    packageId: options.packageId,
                    projectPath: options.projectPath
                };
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            // dotnet exits with an error for NU1301 (feed not reachable / unauthorized)
            void reportRejectedInOutput(`${errorMessage}\n${(error as { stdout?: string }).stdout ?? ''}\n${(error as { stderr?: string }).stderr ?? ''}`);
            log.error(`Error installing package ${options.packageId}:`, error);
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
            const args = ['remove', projectPath, 'package', packageId];
            log.info(`Uninstalling package: dotnet ${args.join(' ')}`);

            const { stdout, stderr } = await execDotnet(args, {
                timeout: 60000,
            });

            // dotnet exits with an error code when it fails (that lands in the catch below); the word "error" in the output of a
            // successful run (a folder `error-pages`, a package named so) does not make it fail
            const success = true;

            if (success) {
                log.info(`Successfully uninstalled ${packageId} from ${path.basename(projectPath)}`);
                return {
                    success: true,
                    message: `Successfully uninstalled ${packageId}`,
                    packageId,
                    projectPath
                };
            } else {
                const errorMessage = stderr || stdout || 'Unknown error occurred';
                log.error(`Failed to uninstall ${packageId}:`, errorMessage);
                return {
                    success: false,
                    message: `Failed to uninstall ${packageId}: ${errorMessage}`,
                    packageId,
                    projectPath
                };
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            log.error(`Error uninstalling package ${packageId}:`, error);
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
            const args = ['restore', targetPath];
            log.info(`Restoring packages: dotnet ${args.join(' ')}`);

            const { stdout, stderr } = await execDotnet(args, {
                timeout: 180000, // 3 minutes for restore operation
            });

            // Check if the command was successful
            const success = stdout.includes('Restore succeeded') ||
                (!stderr.includes('error') && !stdout.includes('error'));

            if (success) {
                const targetName = path.basename(targetPath);
                log.info(`Successfully restored packages for ${targetName}`);
                return {
                    success: true,
                    message: `Successfully restored packages for ${targetName}`,
                    projectPath: targetPath
                };
            } else {
                const errorMessage = stderr || stdout || 'Unknown error occurred';
                log.error(`Failed to restore packages:`, errorMessage);
                return {
                    success: false,
                    message: `Failed to restore packages: ${errorMessage}`,
                    projectPath: targetPath
                };
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            log.error(`Error restoring packages:`, error);
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
            const args = ['add', projectPath, 'package', packageId];

            if (version) {
                args.push('--version', version);
            }

            if (framework) {
                args.push('--framework', framework);
            }

            log.info(`Adding package reference: dotnet ${args.join(' ')}`);

            const { stdout, stderr } = await execDotnet(args, {
                timeout: 90000,
            });

            const success = true; // see above: a failing command lands in the catch

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
            log.error(`Error adding package reference:`, error);
            return {
                success: false,
                message: `Error adding package reference: ${errorMessage}`,
                packageId,
                projectPath
            };
        }
    }

}