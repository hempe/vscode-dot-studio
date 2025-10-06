import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../../core/logger';
import { BasicInstalledPackage, InstalledPackage, ProjectInfo, NuGetPackage } from './types';
import { PackageSharedService } from './packageSharedService';

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
    static async getInstalledPackages(solutionPath?: string): Promise<BasicInstalledPackage[]> {
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
     * This uses the same metadata enrichment as browse packages
     */
    static async getInstalledPackagesWithMetadata(solutionPath?: string): Promise<(InstalledPackage & Partial<NuGetPackage>)[]> {
        const basicPackages = await this.getInstalledPackages(solutionPath);
        return await PackageSharedService.enrichWithBrowseMetadata(basicPackages);
    }

    /**
     * Get installed packages for a specific project
     */
    static async getProjectPackages(projectPath: string): Promise<BasicInstalledPackage[]> {
        try {
            // Determine the working directory - use the project's directory or solution directory
            const workingDir = path.dirname(projectPath);
            const absoluteProjectPath = path.resolve(projectPath);

            // Use relative path if the project is in the working directory, otherwise use absolute path
            const projectArg = path.relative(workingDir, absoluteProjectPath) || absoluteProjectPath;

            const command = `dotnet list "${projectArg}" package --format json`;
            log.info(`Getting packages for project: ${command} (cwd: ${workingDir})`);

            const { stdout, stderr } = await execAsync(command, {
                cwd: workingDir,
                timeout: 15000,
                encoding: 'utf8'
            });

            if (stderr && !stderr.includes('warn')) {
                log.warn('dotnet list package stderr:', stderr);
            }

            if (!stdout || !stdout.trim()) {
                log.warn(`No output from dotnet list package for ${projectPath}`);
                return [];
            }

            const allPackages = this.parseInstalledPackages(stdout);
            return allPackages.filter(pkg =>
                pkg.projectPath === projectPath ||
                pkg.projectPath === absoluteProjectPath ||
                path.resolve(pkg.projectPath) === absoluteProjectPath
            );

        } catch (error) {
            // Provide more detailed error information
            const errorMessage = error instanceof Error ? error.message : String(error);
            log.error(`Error getting packages for project ${projectPath}: ${errorMessage}`);

            // Try to provide helpful debugging info
            if (errorMessage.includes('Command failed')) {
                log.error(`Project path: ${projectPath}`);
                log.error(`Project exists: ${fs.existsSync(projectPath)}`);
                log.error(`Working directory: ${path.dirname(projectPath)}`);
            }

            // Fallback: try to get packages from solution-wide listing
            try {
                log.info(`Attempting fallback: getting packages from solution-wide listing for ${projectPath}`);
                const solutionPath = this.findSolutionFile(path.dirname(projectPath));
                if (solutionPath) {
                    const allPackages = await this.getInstalledPackages(solutionPath);
                    const projectPackages = allPackages.filter(pkg =>
                        pkg.projectPath === projectPath ||
                        path.resolve(pkg.projectPath) === path.resolve(projectPath)
                    );
                    log.info(`Fallback found ${projectPackages.length} packages for project`);
                    return projectPackages;
                }
            } catch (fallbackError) {
                log.warn('Fallback also failed:', fallbackError);
            }

            return [];
        }
    }

    /**
     * Get installed packages for a specific project with rich metadata for UI display
     * This uses the same metadata enrichment as browse packages
     */
    static async getProjectPackagesWithMetadata(projectPath: string): Promise<(InstalledPackage & Partial<NuGetPackage>)[]> {
        const basicPackages = await this.getProjectPackages(projectPath);
        return PackageSharedService.enrichWithBrowseMetadata(basicPackages);
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
    private static parseInstalledPackages(stdout: string): BasicInstalledPackage[] {
        try {
            if (!stdout.trim()) {
                return [];
            }

            const data = JSON.parse(stdout);
            const packages: BasicInstalledPackage[] = [];

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
                                        version: pkg.requestedVersion || pkg.resolvedVersion || '',
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
     * Find solution file in directory or parent directories
     */
    private static findSolutionFile(startDir: string): string | null {
        let currentDir = startDir;

        while (currentDir !== path.dirname(currentDir)) {
            try {
                const files = fs.readdirSync(currentDir);
                const solutionFile = files.find((file: string) => file.endsWith('.sln'));
                if (solutionFile) {
                    return path.join(currentDir, solutionFile);
                }
            } catch (error) {
                // Continue searching in parent directory
            }
            currentDir = path.dirname(currentDir);
        }
        return null;
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