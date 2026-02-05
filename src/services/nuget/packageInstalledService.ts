import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../../core/logger';
import { BasicInstalledPackage, InstalledPackage, ProjectInfo, NuGetPackage } from './types';
import { PackageSharedService } from './packageSharedService';
import { SolutionService } from '../solutionService';

const execAsync = promisify(exec);
const log = logger('PackageInstalledService');

/**
 * Service for managing installed NuGet packages using dotnet CLI
 * Handles listing, analyzing, and getting details about installed packages
 */
export class PackageInstalledService {
    /**
     * Get installed packages with rich metadata for UI display
     * This uses the same metadata enrichment as browse packages
     * @deprecated Use getAllProjectsInfoFromActiveSolution() instead for better performance
     */
    static async getInstalledPackagesWithMetadata(): Promise<(InstalledPackage & Partial<NuGetPackage>)[]> {
        // Use active solution for much better performance
        const allProjects = await this.getAllProjectsInfoFromActiveSolution();
        const basicPackages = allProjects.flatMap(project => project.packages);
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

            // Fallback: try to get packages from active solution
            try {
                log.info(`Attempting fallback: getting packages from active solution for ${projectPath}`);
                const allProjects = await this.getAllProjectsInfoFromActiveSolution();
                const project = allProjects.find(p =>
                    p.path === projectPath ||
                    path.resolve(p.path) === path.resolve(projectPath)
                );
                if (project) {
                    log.info(`Fallback found ${project.packages.length} packages for project`);
                    return project.packages;
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
     * Get all projects info using active solution (faster alternative to dotnet list commands)
     * Waits indefinitely for active solution to be available (no timeout due to VS Code startup overhead)
     */
    static async getAllProjectsInfoFromActiveSolution(): Promise<ProjectInfo[]> {
        const startTime = Date.now();

        try {
            // Wait for active solution to be available (no timeout - VS Code startup can be slow)
            let activeSolution = SolutionService.getActiveSolution();
            let waitTime = 0;
            const pollInterval = 500; // Increased to 500ms to reduce CPU usage

            // Debug: Log initial state
            log.info(`Initial check - activeSolution: ${activeSolution ? 'exists' : 'null'}, initialized: ${activeSolution?.isInitialized ? 'yes' : 'no'}`);
            if (activeSolution) {
                log.info(`Solution path: ${activeSolution.solutionPath}, projects count: ${activeSolution.projects.size}`);
            }

            while (!activeSolution || !activeSolution.isInitialized) {
                if (waitTime % 5000 === 0) { // Log every 5 seconds instead of every poll
                    log.info(`Waiting for active solution to initialize... (${waitTime}ms elapsed)`);
                    log.info(`Current state - activeSolution: ${activeSolution ? 'exists' : 'null'}, initialized: ${activeSolution?.isInitialized ? 'yes' : 'no'}`);
                }
                await new Promise(resolve => setTimeout(resolve, pollInterval));
                waitTime += pollInterval;
                activeSolution = SolutionService.getActiveSolution();
            }

            log.info('Getting project info from active solution...');

            const projectInfos: ProjectInfo[] = [];
            const projects = Array.from(activeSolution.projects.values());

            log.info(`Processing ${projects.length} projects from active solution...`);

            for (const project of projects) {
                try {
                    // Convert Project dependencies to BasicInstalledPackage format
                    // Filter out ProjectReferences - only include actual NuGet packages (PackageReference)
                    const packages: BasicInstalledPackage[] = project.dependencies
                        .filter(dep => dep.type === 'PackageReference') // Only include NuGet packages, not project references
                        .map(dep => ({
                            id: dep.name,
                            currentVersion: dep.version || 'Unknown',
                            projectPath: project.projectPath,
                            projectName: project.name
                        }));

                    const projectInfo: ProjectInfo = {
                        name: project.name,
                        path: project.projectPath,
                        framework: project.frameworks[0] || 'Unknown',
                        packages
                    };

                    projectInfos.push(projectInfo);
                    log.debug(`✓ ${project.name}: ${packages.length} packages`);

                } catch (error) {
                    log.error(`Error processing project ${project.name}:`, error);
                }
            }

            const duration = Date.now() - startTime;
            log.info(`Completed processing ${projects.length} projects from active solution in ${duration}ms (${projectInfos.length} successful)`);

            return projectInfos;

        } catch (error) {
            log.error('Error getting projects from active solution:', error);
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

            // Get package info for each project in parallel with timing
            const totalStartTime = Date.now();

            log.info(`Processing ${projectPaths.length} projects in parallel...`);

            const projectInfoPromises = projectPaths.map(async (projectPath, index) => {
                const projectName = path.basename(projectPath);
                const startTime = Date.now();

                log.info(`[${index + 1}/${projectPaths.length}] Starting project: ${projectName}`);

                try {
                    const projectInfo = await this.getProjectInfo(projectPath);
                    const duration = Date.now() - startTime;

                    if (projectInfo) {
                        log.info(`[${index + 1}/${projectPaths.length}] ✓ ${projectName} completed in ${duration}ms (${projectInfo.packages.length} packages)`);
                    } else {
                        log.warn(`[${index + 1}/${projectPaths.length}] ✗ ${projectName} failed in ${duration}ms`);
                    }

                    return projectInfo;
                } catch (error) {
                    const duration = Date.now() - startTime;
                    log.error(`[${index + 1}/${projectPaths.length}] ✗ ${projectName} error in ${duration}ms:`, error);
                    return null;
                }
            });

            const results = await Promise.all(projectInfoPromises);
            const totalDuration = Date.now() - totalStartTime;
            const validResults = results.filter((info): info is ProjectInfo => info !== null);

            log.info(`Completed processing ${projectPaths.length} projects in parallel in ${totalDuration}ms (${validResults.length} successful)`);

            return validResults;

        } catch (error) {
            log.error('Error getting all projects info:', error);
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
                                        currentVersion: pkg.requestedVersion || pkg.resolvedVersion || '',
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
                                        currentVersion: pkg.resolvedVersion || '',
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