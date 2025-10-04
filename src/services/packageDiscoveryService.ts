import * as fs from 'fs';
import * as path from 'path';
import * as xml2js from 'xml2js';
import { InstalledPackage, ProjectPackageInfo } from '../types/packageDiscovery';
import { logger } from '../core/logger';

const log = logger('NuGetService');

export class PackageDiscoveryService {

    private static readonly parser = new xml2js.Parser({
        explicitArray: false,
        mergeAttrs: true,
        trim: true
    });

    /**
     * Discover all installed packages across all projects in a solution
     */
    static async discoverInstalledPackages(solutionPath: string): Promise<InstalledPackage[]> {
        try {
            const projectPaths = await this.getProjectPathsFromSolution(solutionPath);
            const allPackages: InstalledPackage[] = [];

            for (const projectPath of projectPaths) {
                const projectPackages = await this.getPackagesFromProject(projectPath);
                allPackages.push(...projectPackages.packages);
            }

            return this.deduplicatePackages(allPackages);
        } catch (error) {
            log.error('Error discovering installed packages:', error);
            throw new Error(`Failed to discover installed packages: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get detailed package information grouped by project
     */
    static async getProjectPackageInfo(solutionPath: string): Promise<ProjectPackageInfo[]> {
        try {
            const projectPaths = await this.getProjectPathsFromSolution(solutionPath);
            const projectInfos: ProjectPackageInfo[] = [];

            for (const projectPath of projectPaths) {
                const projectInfo = await this.getPackagesFromProject(projectPath);
                if (projectInfo.packages.length > 0) {
                    projectInfos.push(projectInfo);
                }
            }

            return projectInfos;
        } catch (error) {
            log.error('Error getting project package info:', error);
            throw new Error(`Failed to get project package information: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Extract project paths from solution file
     */
    private static async getProjectPathsFromSolution(solutionPath: string): Promise<string[]> {
        const solutionContent = await fs.promises.readFile(solutionPath, 'utf8');
        const projectPaths: string[] = [];
        const solutionDir = path.dirname(solutionPath);

        // Parse solution file to find project references
        const projectRegex = /Project\("\{[^}]+\}"\)\s*=\s*"[^"]+",\s*"([^"]+)",\s*"\{[^}]+\}"/g;
        let match;

        while ((match = projectRegex.exec(solutionContent)) !== null) {
            const relativePath = match[1];

            // Only include actual project files (not solution folders)
            if (relativePath.endsWith('.csproj') || relativePath.endsWith('.vbproj') || relativePath.endsWith('.fsproj')) {
                // Normalize path separators for cross-platform compatibility
                const normalizedPath = relativePath.replace(/\\/g, path.sep);
                const fullPath = path.resolve(solutionDir, normalizedPath);

                // Verify the project file exists
                if (fs.existsSync(fullPath)) {
                    projectPaths.push(fullPath);
                }
            }
        }

        return projectPaths;
    }

    /**
     * Parse packages from a single project file
     */
    private static async getPackagesFromProject(projectPath: string): Promise<ProjectPackageInfo> {
        const projectName = path.basename(projectPath, path.extname(projectPath));

        try {
            const projectContent = await fs.promises.readFile(projectPath, 'utf8');

            // Ensure we have valid XML content
            if (!projectContent || !projectContent.trim()) {
                log.warn(`Empty project file: ${projectPath}`);
                return {
                    projectPath,
                    projectName,
                    packages: []
                };
            }

            const projectData = await this.parser.parseStringPromise(projectContent);
            const packages: InstalledPackage[] = [];

            // Extract target framework
            const targetFramework = this.extractTargetFramework(projectData);

            // Find PackageReference elements
            const packageReferences = this.extractPackageReferences(projectData);

            for (const packageRef of packageReferences) {
                if (packageRef.Include && packageRef.Version) {
                    packages.push({
                        id: packageRef.Include,
                        version: packageRef.Version,
                        projectPath: projectPath,
                        projectName: projectName,
                        targetFramework: targetFramework,
                        isPrivateAssets: packageRef.PrivateAssets === 'all',
                        includeAssets: packageRef.IncludeAssets
                    });
                }
            }

            return {
                projectPath,
                projectName,
                targetFramework,
                packages
            };
        } catch (error) {
            log.error(`Error parsing project file ${projectPath}:`, error);
            return {
                projectPath,
                projectName,
                packages: []
            };
        }
    }

    /**
     * Extract target framework from project data
     */
    private static extractTargetFramework(projectData: any): string | undefined {
        try {
            const propertyGroups = this.ensureArray(projectData.Project?.PropertyGroup);

            for (const group of propertyGroups) {
                if (group.TargetFramework) {
                    return group.TargetFramework;
                }
                if (group.TargetFrameworks) {
                    // Return first framework if multiple targets
                    return group.TargetFrameworks.split(';')[0];
                }
            }
        } catch (error) {
            log.error('Error extracting target framework:', error);
        }

        return undefined;
    }

    /**
     * Extract PackageReference elements from project data
     */
    private static extractPackageReferences(projectData: any): any[] {
        const packageRefs: any[] = [];

        try {
            const itemGroups = this.ensureArray(projectData.Project?.ItemGroup);

            for (const group of itemGroups) {
                if (group.PackageReference) {
                    const packages = this.ensureArray(group.PackageReference);
                    packageRefs.push(...packages);
                }
            }
        } catch (error) {
            log.error('Error extracting package references:', error);
        }

        return packageRefs;
    }

    /**
     * Remove duplicate packages (same ID and version)
     */
    private static deduplicatePackages(packages: InstalledPackage[]): InstalledPackage[] {
        const seen = new Set<string>();
        const unique: InstalledPackage[] = [];

        for (const pkg of packages) {
            const key = `${pkg.id}@${pkg.version}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(pkg);
            }
        }

        return unique.sort((a, b) => a.id.localeCompare(b.id));
    }

    /**
     * Ensure value is always an array for consistent processing
     */
    private static ensureArray(value: any): any[] {
        if (!value) return [];
        return Array.isArray(value) ? value : [value];
    }

    /**
     * Get package usage across projects (which projects use which packages)
     */
    static async getPackageUsage(solutionPath: string, packageId: string): Promise<InstalledPackage[]> {
        try {
            const allPackages = await this.discoverInstalledPackages(solutionPath);
            return allPackages.filter(pkg => pkg.id === packageId);
        } catch (error) {
            log.error(`Error getting package usage for ${packageId}:`, error);
            return [];
        }
    }

    /**
     * Check if a specific package is installed in any project
     */
    static async isPackageInstalled(solutionPath: string, packageId: string): Promise<boolean> {
        try {
            const usage = await this.getPackageUsage(solutionPath, packageId);
            return usage.length > 0;
        } catch (error) {
            log.error(`Error checking if package ${packageId} is installed:`, error);
            return false;
        }
    }
}