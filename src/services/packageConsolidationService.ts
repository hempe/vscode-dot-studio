import { PackageDiscoveryService } from './packageDiscoveryService';
import { InstalledPackage, ProjectPackageInfo } from '../types/packageDiscovery';
import { PackageConflict, ConsolidationSummary } from '../types/packageConsolidation';

export class PackageConsolidationService {
    /**
     * Analyze solution for package version conflicts
     */
    static async analyzePackageConflicts(solutionPath: string): Promise<PackageConflict[]> {
        try {
            const projectPackageInfo = await PackageDiscoveryService.getProjectPackageInfo(solutionPath);
            
            if (projectPackageInfo.length === 0) {
                return [];
            }

            // Group all packages by ID across all projects
            const packageGroups = this.groupPackagesByIdAcrossProjects(projectPackageInfo);
            const conflicts: PackageConflict[] = [];

            for (const [packageId, packageInstances] of Object.entries(packageGroups)) {
                const conflict = this.analyzePackageVersions(packageId, packageInstances);
                if (conflict) {
                    conflicts.push(conflict);
                }
            }

            return conflicts.sort((a, b) => {
                // Sort by severity first, then by package name
                const severityOrder = { high: 3, medium: 2, low: 1 };
                const severityDiff = severityOrder[b.conflictSeverity] - severityOrder[a.conflictSeverity];
                if (severityDiff !== 0) return severityDiff;
                return a.packageId.localeCompare(b.packageId);
            });
        } catch (error) {
            console.error('Error analyzing package conflicts:', error);
            throw new Error(`Failed to analyze package conflicts: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get consolidation summary statistics
     */
    static async getConsolidationSummary(solutionPath: string): Promise<ConsolidationSummary> {
        try {
            const conflicts = await this.analyzePackageConflicts(solutionPath);
            const projectPackageInfo = await PackageDiscoveryService.getProjectPackageInfo(solutionPath);
            
            // Get unique package IDs across all projects
            const allPackageIds = new Set<string>();
            projectPackageInfo.forEach(project => {
                project.packages.forEach(pkg => allPackageIds.add(pkg.id));
            });

            const severityCount = { high: 0, medium: 0, low: 0 };
            conflicts.forEach(conflict => {
                severityCount[conflict.conflictSeverity]++;
            });

            return {
                totalPackages: allPackageIds.size,
                conflictedPackages: conflicts.length,
                totalProjects: projectPackageInfo.length,
                conflictSeverity: severityCount
            };
        } catch (error) {
            console.error('Error getting consolidation summary:', error);
            return {
                totalPackages: 0,
                conflictedPackages: 0,
                totalProjects: 0,
                conflictSeverity: { high: 0, medium: 0, low: 0 }
            };
        }
    }

    /**
     * Group packages by ID across all projects
     */
    private static groupPackagesByIdAcrossProjects(projectPackageInfo: ProjectPackageInfo[]): Record<string, InstalledPackage[]> {
        const packageGroups: Record<string, InstalledPackage[]> = {};

        for (const project of projectPackageInfo) {
            for (const pkg of project.packages) {
                if (!packageGroups[pkg.id]) {
                    packageGroups[pkg.id] = [];
                }
                packageGroups[pkg.id].push(pkg);
            }
        }

        return packageGroups;
    }

    /**
     * Analyze versions of a specific package across projects
     */
    private static analyzePackageVersions(packageId: string, packageInstances: InstalledPackage[]): PackageConflict | null {
        // Group by version
        const versionGroups: Record<string, InstalledPackage[]> = {};
        
        for (const pkg of packageInstances) {
            if (!versionGroups[pkg.version]) {
                versionGroups[pkg.version] = [];
            }
            versionGroups[pkg.version].push(pkg);
        }

        // If only one version exists, no conflict
        const versions = Object.keys(versionGroups);
        if (versions.length <= 1) {
            return null;
        }

        // Build conflict information
        const versionInfo = versions.map(version => ({
            version,
            projects: versionGroups[version].map(pkg => ({
                projectName: pkg.projectName,
                projectPath: pkg.projectPath
            })),
            usageCount: versionGroups[version].length
        })).sort((a, b) => b.usageCount - a.usageCount); // Most used versions first

        const recommendedVersion = this.determineRecommendedVersion(versions);
        const conflictSeverity = this.assessConflictSeverity(versions, packageId);
        const impactDescription = this.generateImpactDescription(versionInfo, packageId);

        return {
            packageId,
            versions: versionInfo,
            recommendedVersion,
            conflictSeverity,
            impactDescription
        };
    }

    /**
     * Determine the recommended version for consolidation
     */
    private static determineRecommendedVersion(versions: string[]): string {
        // Sort versions and recommend the latest stable version
        const sortedVersions = versions.sort((a, b) => {
            // Simple version comparison (could be enhanced with semantic versioning)
            const aParts = PackageConsolidationService.parseSimpleVersion(a);
            const bParts = PackageConsolidationService.parseSimpleVersion(b);

            for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
                const aPart = aParts[i] || 0;
                const bPart = bParts[i] || 0;
                
                if (aPart !== bPart) {
                    return bPart - aPart; // Descending order (latest first)
                }
            }
            
            return 0;
        });

        // Prefer non-prerelease versions
        const stableVersions = sortedVersions.filter(v => !v.includes('-'));
        return stableVersions.length > 0 ? stableVersions[0] : sortedVersions[0];
    }

    /**
     * Parse version string into numeric parts for comparison
     */
    private static parseSimpleVersion(version: string): number[] {
        return version.split(/[.-]/)
            .map(part => parseInt(part, 10))
            .filter(num => !isNaN(num));
    }

    /**
     * Assess the severity of version conflicts
     */
    private static assessConflictSeverity(versions: string[], packageId: string): 'low' | 'medium' | 'high' {
        const majorVersions = new Set(
            versions.map(v => PackageConsolidationService.parseSimpleVersion(v)[0]).filter(v => v !== undefined)
        );

        // Different major versions = high severity
        if (majorVersions.size > 1) {
            return 'high';
        }

        // Check for prerelease versions mixed with stable
        const hasPrerelease = versions.some(v => v.includes('-'));
        const hasStable = versions.some(v => !v.includes('-'));

        if (hasPrerelease && hasStable) {
            return 'medium';
        }

        // More than 3 different versions = medium severity
        if (versions.length > 3) {
            return 'medium';
        }

        // Core framework packages should have higher severity
        const corePackages = [
            'Microsoft.Extensions.',
            'System.',
            'Microsoft.AspNetCore.',
            'Microsoft.EntityFrameworkCore'
        ];
        
        const isCorePackage = corePackages.some(prefix => packageId.startsWith(prefix));
        if (isCorePackage && versions.length > 2) {
            return 'medium';
        }

        return 'low';
    }

    /**
     * Generate human-readable impact description
     */
    private static generateImpactDescription(versionInfo: Array<{ version: string; projects: Array<{ projectName: string }>; usageCount: number }>, packageId: string): string {
        const totalProjects = versionInfo.reduce((sum, info) => sum + info.usageCount, 0);
        const mostUsedVersion = versionInfo[0];
        const otherVersionsCount = versionInfo.length - 1;

        if (versionInfo.length === 2) {
            return `${packageId} has 2 different versions across ${totalProjects} projects. Most projects (${mostUsedVersion.usageCount}) use ${mostUsedVersion.version}.`;
        }

        return `${packageId} has ${versionInfo.length} different versions across ${totalProjects} projects. ${mostUsedVersion.usageCount} projects use ${mostUsedVersion.version}, while ${otherVersionsCount} other versions are used elsewhere.`;
    }

    /**
     * Generate consolidation plan for a specific conflict
     */
    static generateConsolidationPlan(conflict: PackageConflict): {
        targetVersion: string;
        projectsToUpdate: Array<{
            projectName: string;
            projectPath: string;
            currentVersion: string;
            targetVersion: string;
        }>;
        estimatedImpact: string;
    } {
        const targetVersion = conflict.recommendedVersion;
        const projectsToUpdate = [];

        for (const versionInfo of conflict.versions) {
            if (versionInfo.version !== targetVersion) {
                for (const project of versionInfo.projects) {
                    projectsToUpdate.push({
                        projectName: project.projectName,
                        projectPath: project.projectPath,
                        currentVersion: versionInfo.version,
                        targetVersion: targetVersion
                    });
                }
            }
        }

        let estimatedImpact = `${projectsToUpdate.length} projects will be updated to use ${targetVersion}.`;
        
        if (conflict.conflictSeverity === 'high') {
            estimatedImpact += ' Major version changes may require code updates.';
        } else if (conflict.conflictSeverity === 'medium') {
            estimatedImpact += ' Minor compatibility issues may occur.';
        } else {
            estimatedImpact += ' Low risk of compatibility issues.';
        }

        return {
            targetVersion,
            projectsToUpdate,
            estimatedImpact
        };
    }

    /**
     * Check if a specific package has version conflicts
     */
    static async hasConflicts(solutionPath: string, packageId: string): Promise<boolean> {
        try {
            const conflicts = await this.analyzePackageConflicts(solutionPath);
            return conflicts.some(conflict => conflict.packageId === packageId);
        } catch (error) {
            console.error(`Error checking conflicts for ${packageId}:`, error);
            return false;
        }
    }
}