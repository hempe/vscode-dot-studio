import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { logger } from '../../core/logger';
import { InstalledPackage, ProjectInfo, NuGetPackage } from './types';
import { PackageBrowseService } from './packageBrowseService';

const execAsync = promisify(exec);
const log = logger('PackageInstalledService');

/**
 * Service for managing installed NuGet packages using dotnet CLI
 * Handles listing, analyzing, and getting details about installed packages
 */
export class PackageInstalledService {

    /**
     * Get all installed packages across all projects in a solution
     */
    static async getInstalledPackages(solutionPath?: string): Promise<InstalledPackage[]> {
        try {
            const workingDir = solutionPath ? path.dirname(solutionPath) : process.cwd();

            // Use dotnet list package to get all installed packages
            const command = 'dotnet list package --format json';
            log.info(`Getting installed packages: ${command}`);

            const { stdout, stderr } = await execAsync(command, {
                cwd: workingDir,
                timeout: 30000,
                encoding: 'utf8'
            });

            if (stderr && !stderr.includes('warn')) {
                log.warn('dotnet list package stderr:', stderr);
            }

            return this.parseInstalledPackages(stdout);

        } catch (error) {
            log.error('Error getting installed packages:', error);
            return [];
        }
    }

    /**
     * Get installed packages with rich metadata for UI display
     * This enhances basic package data with NuGet API metadata
     */
    static async getInstalledPackagesWithMetadata(solutionPath?: string): Promise<(InstalledPackage & Partial<NuGetPackage>)[]> {
        try {
            // Get basic installed package data from dotnet CLI
            const basicPackages = await this.getInstalledPackages(solutionPath);

            if (basicPackages.length === 0) {
                return [];
            }

            // Get unique package IDs to avoid duplicate API calls
            const uniquePackageIds = [...new Set(basicPackages.map(pkg => pkg.id))];
            log.info(`Enriching ${uniquePackageIds.length} unique packages with NuGet metadata`);

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
                    // Merge metadata while preserving installation-specific fields
                    return {
                        ...basicPkg, // Keep all original InstalledPackage fields
                        // Add NuGet metadata
                        description: metadata.description,
                        authors: metadata.authors,
                        projectUrl: metadata.projectUrl,
                        licenseUrl: metadata.licenseUrl,
                        iconUrl: metadata.iconUrl,
                        tags: metadata.tags,
                        totalDownloads: metadata.totalDownloads,
                        latestVersion: metadata.latestVersion,
                        allVersions: metadata.allVersions,
                        source: metadata.source
                    };
                } else {
                    // Return basic package if metadata fetch failed
                    return basicPkg;
                }
            });

            log.info(`Successfully enriched ${enrichedPackages.filter(pkg => 'description' in pkg && pkg.description).length}/${basicPackages.length} packages with metadata`);
            return enrichedPackages;

        } catch (error) {
            log.error('Error enriching packages with metadata:', error);
            // Return basic packages if enrichment fails
            const basicPackages = await this.getInstalledPackages(solutionPath);
            return basicPackages;
        }
    }

    /**
     * Get installed packages for a specific project
     */
    static async getProjectPackages(projectPath: string): Promise<InstalledPackage[]> {
        try {
            const command = `dotnet list "${projectPath}" package --format json`;
            log.info(`Getting packages for project: ${command}`);

            const { stdout, stderr } = await execAsync(command, {
                timeout: 15000,
                encoding: 'utf8'
            });

            if (stderr && !stderr.includes('warn')) {
                log.warn('dotnet list package stderr:', stderr);
            }

            const allPackages = this.parseInstalledPackages(stdout);
            return allPackages.filter(pkg => pkg.projectPath === projectPath);

        } catch (error) {
            log.error(`Error getting packages for project ${projectPath}:`, error);
            return [];
        }
    }

    /**
     * Get detailed project information including packages and frameworks
     */
    static async getProjectInfo(projectPath: string): Promise<ProjectInfo | null> {
        try {
            const projectName = path.basename(projectPath, path.extname(projectPath));
            const packages = await this.getProjectPackages(projectPath);

            // Get target framework info
            const framework = await this.getProjectFramework(projectPath);

            return {
                name: projectName,
                path: projectPath,
                framework: framework || 'Unknown',
                packages
            };

        } catch (error) {
            log.error(`Error getting project info for ${projectPath}:`, error);
            return null;
        }
    }

    /**
     * Get all projects with their package information
     */
    static async getAllProjectsInfo(solutionPath?: string): Promise<ProjectInfo[]> {
        try {
            const workingDir = solutionPath ? path.dirname(solutionPath) : process.cwd();

            // First get all projects in the solution
            const projectPaths = await this.getSolutionProjects(workingDir);

            // Get package info for each project
            const projectInfoPromises = projectPaths.map(projectPath =>
                this.getProjectInfo(projectPath)
            );

            const results = await Promise.all(projectInfoPromises);
            return results.filter((info): info is ProjectInfo => info !== null);

        } catch (error) {
            log.error('Error getting all projects info:', error);
            return [];
        }
    }

    /**
     * Get packages with dependency tree information
     */
    static async getPackageDependencies(projectPath: string, includeTransitive: boolean = false): Promise<InstalledPackage[]> {
        try {
            const args = ['list', `"${projectPath}"`, 'package', '--format', 'json'];

            if (includeTransitive) {
                args.push('--include-transitive');
            }

            const command = `dotnet ${args.join(' ')}`;
            log.info(`Getting package dependencies: ${command}`);

            const { stdout } = await execAsync(command, { timeout: 20000 });
            return this.parseInstalledPackages(stdout);

        } catch (error) {
            log.error(`Error getting package dependencies for ${projectPath}:`, error);
            return [];
        }
    }

    /**
     * Parse the JSON output from dotnet list package command
     */
    private static parseInstalledPackages(stdout: string): InstalledPackage[] {
        try {
            if (!stdout.trim()) {
                return [];
            }

            const data = JSON.parse(stdout);
            const packages: InstalledPackage[] = [];

            // Handle the structure from dotnet list package --format json
            if (data.projects && Array.isArray(data.projects)) {
                for (const project of data.projects) {
                    const projectPath = project.path || '';
                    const projectName = path.basename(projectPath, path.extname(projectPath));

                    if (project.frameworks && Array.isArray(project.frameworks)) {
                        for (const framework of project.frameworks) {
                            if (framework.topLevelPackages && Array.isArray(framework.topLevelPackages)) {
                                for (const pkg of framework.topLevelPackages) {
                                    // Skip auto-referenced packages (like NETStandard.Library) as they're not explicitly installed
                                    if (pkg.autoReferenced) {
                                        continue;
                                    }

                                    packages.push({
                                        id: pkg.id,
                                        version: pkg.resolvedVersion || pkg.requestedVersion || '',
                                        projectPath,
                                        projectName,
                                        resolved: pkg.resolvedVersion,
                                        autoReferenced: pkg.autoReferenced || false,
                                        transitivePackage: false
                                    });
                                }
                            }

                            if (framework.transitivePackages && Array.isArray(framework.transitivePackages)) {
                                for (const pkg of framework.transitivePackages) {
                                    packages.push({
                                        id: pkg.id,
                                        version: pkg.resolvedVersion || '',
                                        projectPath,
                                        projectName,
                                        resolved: pkg.resolvedVersion,
                                        autoReferenced: false,
                                        transitivePackage: true
                                    });
                                }
                            }
                        }
                    }
                }
            }

            return packages;

        } catch (error) {
            log.error('Error parsing installed packages:', error);
            return [];
        }
    }

    /**
     * Get target framework for a project
     */
    private static async getProjectFramework(projectPath: string): Promise<string | null> {
        try {
            // Read the project file to get target framework
            // For now, use a simple approach
            const command = `dotnet list "${projectPath}" package --framework net8.0 --format json 2>/dev/null || dotnet list "${projectPath}" package --format json`;

            const { stdout } = await execAsync(command, { timeout: 10000 });
            const data = JSON.parse(stdout);

            if (data.projects && data.projects.length > 0 && data.projects[0].frameworks) {
                const frameworks = data.projects[0].frameworks;
                if (frameworks.length > 0) {
                    return frameworks[0].framework || null;
                }
            }

            return null;

        } catch (error) {
            log.debug(`Could not determine framework for ${projectPath}`);
            return null;
        }
    }

    /**
     * Get all project paths in a solution
     */
    private static async getSolutionProjects(workingDir: string): Promise<string[]> {
        try {
            const { stdout } = await execAsync('dotnet sln list', {
                cwd: workingDir,
                timeout: 10000
            });

            const lines = stdout.split('\n')
                .map(line => line.trim())
                .filter(line => line && line.endsWith('.csproj'));

            // Convert relative paths to absolute paths
            return lines.map(relativePath => path.resolve(workingDir, relativePath));

        } catch (error) {
            log.error('Error getting solution projects:', error);
            return [];
        }
    }
}