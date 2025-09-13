import { NuGetService, NuGetSearchOptions } from './nugetService';
import { PackageDiscoveryService, InstalledPackage } from './packageDiscoveryService';

export interface PackageUpdate {
    id: string;
    currentVersion: string;
    latestVersion: string;
    projects: string[];
    description?: string;
    releaseNotes?: string;
    isPrerelease: boolean;
    publishedDate?: string;
}

export interface UpdateCheckOptions {
    includePrerelease: boolean;
    batchSize?: number;
}

export class PackageUpdateService {
    private static readonly DEFAULT_BATCH_SIZE = 5;
    private static readonly VERSION_REGEX = /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?(?:\+([a-zA-Z0-9.-]+))?$/;

    /**
     * Check for updates for all installed packages in a solution
     */
    static async checkForUpdates(solutionPath: string, options: UpdateCheckOptions): Promise<PackageUpdate[]> {
        try {
            const installedPackages = await PackageDiscoveryService.discoverInstalledPackages(solutionPath);
            
            if (installedPackages.length === 0) {
                return [];
            }

            // Group packages by ID to get unique packages
            const packageGroups = this.groupPackagesById(installedPackages);
            const updates: PackageUpdate[] = [];

            // Process packages in batches to avoid overwhelming the API
            const batchSize = options.batchSize || this.DEFAULT_BATCH_SIZE;
            const packageIds = Object.keys(packageGroups);
            
            for (let i = 0; i < packageIds.length; i += batchSize) {
                const batch = packageIds.slice(i, i + batchSize);
                const batchUpdates = await this.checkBatchForUpdates(batch, packageGroups, options);
                updates.push(...batchUpdates);
                
                // Small delay between batches to be respectful to the API
                if (i + batchSize < packageIds.length) {
                    await this.delay(100);
                }
            }

            return updates.sort((a, b) => a.id.localeCompare(b.id));
        } catch (error) {
            console.error('Error checking for package updates:', error);
            throw new Error(`Failed to check for updates: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Check a single package for updates
     */
    static async checkPackageForUpdate(packageId: string, currentVersion: string, includePrerelease: boolean = false): Promise<string | null> {
        try {
            const searchOptions: NuGetSearchOptions = {
                query: packageId,
                includePrerelease,
                take: 1
            };

            const results = await NuGetService.searchPackages(searchOptions);
            const packageInfo = results.find(pkg => pkg.id.toLowerCase() === packageId.toLowerCase());

            if (!packageInfo || !packageInfo.version) {
                return null;
            }

            const latestVersion = packageInfo.version;
            
            // Compare versions
            if (this.isNewerVersion(latestVersion, currentVersion)) {
                return latestVersion;
            }

            return null;
        } catch (error) {
            console.error(`Error checking update for package ${packageId}:`, error);
            return null;
        }
    }

    /**
     * Group installed packages by ID
     */
    private static groupPackagesById(packages: InstalledPackage[]): Record<string, InstalledPackage[]> {
        const groups: Record<string, InstalledPackage[]> = {};
        
        for (const pkg of packages) {
            if (!groups[pkg.id]) {
                groups[pkg.id] = [];
            }
            groups[pkg.id].push(pkg);
        }

        return groups;
    }

    /**
     * Check a batch of packages for updates
     */
    private static async checkBatchForUpdates(
        packageIds: string[], 
        packageGroups: Record<string, InstalledPackage[]>, 
        options: UpdateCheckOptions
    ): Promise<PackageUpdate[]> {
        const updates: PackageUpdate[] = [];

        for (const packageId of packageIds) {
            try {
                const packages = packageGroups[packageId];
                const latestVersion = await this.checkPackageForUpdate(packageId, packages[0].version, options.includePrerelease);
                
                if (latestVersion) {
                    // Get all unique versions currently installed
                    const currentVersions = [...new Set(packages.map(p => p.version))];
                    const projects = packages.map(p => p.projectName);
                    
                    // Check if any installed version needs updating
                    const needsUpdate = currentVersions.some(version => 
                        this.isNewerVersion(latestVersion, version)
                    );

                    if (needsUpdate) {
                        updates.push({
                            id: packageId,
                            currentVersion: this.getMostCommonVersion(packages),
                            latestVersion: latestVersion,
                            projects: [...new Set(projects)],
                            isPrerelease: this.isPrerelease(latestVersion)
                        });
                    }
                }
            } catch (error) {
                console.error(`Error checking updates for ${packageId}:`, error);
                // Continue with other packages
            }
        }

        return updates;
    }

    /**
     * Get the most commonly used version across projects
     */
    private static getMostCommonVersion(packages: InstalledPackage[]): string {
        const versionCounts: Record<string, number> = {};
        
        for (const pkg of packages) {
            versionCounts[pkg.version] = (versionCounts[pkg.version] || 0) + 1;
        }

        return Object.entries(versionCounts)
            .sort(([,a], [,b]) => b - a)[0][0];
    }

    /**
     * Compare two semantic versions
     */
    static isNewerVersion(version1: string, version2: string): boolean {
        try {
            const v1Parts = this.parseVersion(version1);
            const v2Parts = this.parseVersion(version2);

            if (!v1Parts || !v2Parts) {
                return false;
            }

            // Compare major.minor.patch
            for (let i = 0; i < 3; i++) {
                if (v1Parts.numbers[i] > v2Parts.numbers[i]) {
                    return true;
                } else if (v1Parts.numbers[i] < v2Parts.numbers[i]) {
                    return false;
                }
            }

            // If versions are equal, check prerelease
            // Stable versions are newer than prerelease versions
            if (v1Parts.prerelease && !v2Parts.prerelease) {
                return false;
            } else if (!v1Parts.prerelease && v2Parts.prerelease) {
                return true;
            } else if (v1Parts.prerelease && v2Parts.prerelease) {
                return v1Parts.prerelease > v2Parts.prerelease;
            }

            return false;
        } catch (error) {
            console.error(`Error comparing versions ${version1} and ${version2}:`, error);
            return false;
        }
    }

    /**
     * Parse a semantic version string
     */
    private static parseVersion(version: string): { numbers: number[], prerelease?: string } | null {
        const match = version.match(this.VERSION_REGEX);
        
        if (!match) {
            return null;
        }

        return {
            numbers: [
                parseInt(match[1], 10),
                parseInt(match[2], 10),
                parseInt(match[3], 10)
            ],
            prerelease: match[4]
        };
    }

    /**
     * Check if a version is a prerelease
     */
    static isPrerelease(version: string): boolean {
        const parsed = this.parseVersion(version);
        return parsed ? !!parsed.prerelease : false;
    }

    /**
     * Delay execution for specified milliseconds
     */
    private static delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get update summary statistics
     */
    static getUpdateSummary(updates: PackageUpdate[]): {
        totalUpdates: number;
        majorUpdates: number;
        minorUpdates: number;
        patchUpdates: number;
        prereleaseUpdates: number;
    } {
        let majorUpdates = 0;
        let minorUpdates = 0;
        let patchUpdates = 0;
        let prereleaseUpdates = 0;

        for (const update of updates) {
            if (update.isPrerelease) {
                prereleaseUpdates++;
            } else {
                const currentParts = this.parseVersion(update.currentVersion);
                const latestParts = this.parseVersion(update.latestVersion);
                
                if (currentParts && latestParts) {
                    if (latestParts.numbers[0] > currentParts.numbers[0]) {
                        majorUpdates++;
                    } else if (latestParts.numbers[1] > currentParts.numbers[1]) {
                        minorUpdates++;
                    } else {
                        patchUpdates++;
                    }
                }
            }
        }

        return {
            totalUpdates: updates.length,
            majorUpdates,
            minorUpdates,
            patchUpdates,
            prereleaseUpdates
        };
    }
}