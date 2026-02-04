import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { logger } from '../../core/logger';
import { PackageOperationResult } from './types';

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
}