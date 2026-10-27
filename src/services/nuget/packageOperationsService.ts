import * as path from 'path';
import { logger } from '../../core/logger';
import { PackageInstallOptions, PackageOperationResult } from './types';
import { reportRejectedInOutput } from './feedAuth';
import { execDotnet } from './dotnetCli';

const log = logger('PackageOperationsService');

/**
 * NuGet package operations (install, uninstall, restore) with the dotnet CLI. A command that fails exits with an error
 * code, which `execDotnet` turns into a rejection: the output of a successful run is not searched for "error" (a folder
 * `error-pages`, a package named so).
 */
export class PackageOperationsService {

    /** Installs a NuGet package in a project */
    static async installPackage(options: PackageInstallOptions): Promise<PackageOperationResult> {
        const args = ['add', options.projectPath, 'package', options.packageId,
            ...(options.version ? ['--version', options.version] : []),
            ...(options.source ? ['--source', options.source] : []),
            ...(options.prerelease ? ['--prerelease'] : []),
            ...(options.noRestore ? ['--no-restore'] : [])];
        try {
            log.info(`Installing package: dotnet ${args.join(' ')}`);
            await execDotnet(args, { timeout: 120000 });
            log.info(`Successfully installed ${options.packageId} in ${path.basename(options.projectPath)}`);
            return {
                success: true,
                message: `Successfully installed ${options.packageId}${options.version ? ` version ${options.version}` : ''}`,
                packageId: options.packageId,
                version: options.version,
                projectPath: options.projectPath
            };
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

    /** Removes a NuGet package from a project */
    static async uninstallPackage(projectPath: string, packageId: string): Promise<PackageOperationResult> {
        const args = ['remove', projectPath, 'package', packageId];
        try {
            log.info(`Uninstalling package: dotnet ${args.join(' ')}`);
            await execDotnet(args, { timeout: 60000 });
            log.info(`Successfully uninstalled ${packageId} from ${path.basename(projectPath)}`);
            return { success: true, message: `Successfully uninstalled ${packageId}`, packageId, projectPath };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            log.error(`Error uninstalling package ${packageId}:`, error);
            return { success: false, message: `Error uninstalling ${packageId}: ${errorMessage}`, packageId, projectPath };
        }
    }

    /** Restores the packages of a project or solution */
    static async restorePackages(targetPath: string): Promise<PackageOperationResult> {
        const args = ['restore', targetPath];
        try {
            log.info(`Restoring packages: dotnet ${args.join(' ')}`);
            await execDotnet(args, { timeout: 180000 });
            const targetName = path.basename(targetPath);
            log.info(`Successfully restored packages for ${targetName}`);
            return { success: true, message: `Successfully restored packages for ${targetName}`, projectPath: targetPath };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            log.error(`Error restoring packages:`, error);
            return { success: false, message: `Error restoring packages: ${errorMessage}`, projectPath: targetPath };
        }
    }
}
