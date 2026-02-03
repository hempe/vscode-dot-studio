import * as path from 'path';
import { logger } from '../../core/logger';
import { InstalledPackage, PackageOperationResult } from './types';
import { PackageInstalledService } from './packageInstalledService';
import { PackageUpdateService } from './packageUpdateService';

const log = logger('PackageConsolidationService');

/**
 * Service for package consolidation across multiple projects in a solution
 * Helps manage package versions to ensure consistency across projects
 */
export class PackageConsolidationService {

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
}