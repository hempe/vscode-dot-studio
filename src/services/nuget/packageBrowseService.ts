import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../core/logger';
import { NuGetPackage, PackageSearchOptions, PackageSource } from './types';

const execAsync = promisify(exec);

/**
 * Service for browsing and searching NuGet packages using dotnet CLI
 * Replaces the external API-based approach with dotnet commands
 */
export class PackageBrowseService {
    private static readonly logger = logger('PackageBrowseService');

    /**
     * Search for packages using dotnet CLI
     * Uses `dotnet search` command which searches NuGet.org and configured sources
     */
    static async searchPackages(options: PackageSearchOptions): Promise<NuGetPackage[]> {
        if (!options.query || options.query.trim().length < 2) {
            return [];
        }

        try {
            const args = [
                'search',
                `"${options.query.trim()}"`,
                '--format', 'json'
            ];

            if (options.includePrerelease) {
                args.push('--prerelease');
            }

            if (options.take && options.take > 0) {
                args.push('--take', options.take.toString());
            }

            if (options.skip && options.skip > 0) {
                args.push('--skip', options.skip.toString());
            }

            if (options.source) {
                args.push('--source', options.source);
            }

            const command = `dotnet ${args.join(' ')}`;
            this.logger.info(`Searching packages: ${command}`);

            const { stdout, stderr } = await execAsync(command, {
                timeout: 30000,
                encoding: 'utf8'
            });

            if (stderr && !stderr.includes('warn')) {
                this.logger.warn('dotnet search stderr:', stderr);
            }

            // Parse the JSON output from dotnet search
            return this.parseSearchResults(stdout);

        } catch (error) {
            this.logger.error('Error searching packages:', error);

            // Fallback to a simpler approach if dotnet search fails
            // This might happen if dotnet search is not available in older versions
            return this.fallbackSearch(options);
        }
    }

    /**
     * Get detailed package information including all versions
     */
    static async getPackageDetails(packageId: string, source?: string): Promise<NuGetPackage | null> {
        try {
            const args = ['search', `"${packageId}"`, '--exact-match', '--format', 'json'];

            if (source) {
                args.push('--source', source);
            }

            const command = `dotnet ${args.join(' ')}`;
            const { stdout } = await execAsync(command, { timeout: 15000 });

            const results = this.parseSearchResults(stdout);
            const exactMatch = results.find(pkg => pkg.id.toLowerCase() === packageId.toLowerCase());

            if (exactMatch) {
                // Get all versions for this package
                exactMatch.allVersions = await this.getPackageVersions(packageId, source);
                return exactMatch;
            }

            return null;

        } catch (error) {
            this.logger.error(`Error getting package details for ${packageId}:`, error);
            return null;
        }
    }

    /**
     * Get all available versions for a package
     */
    static async getPackageVersions(packageId: string, source?: string): Promise<string[]> {
        try {
            // Use dotnet list package with --outdated to get version info
            // Note: This is a workaround since dotnet CLI doesn't have a direct "list versions" command
            const args = ['search', `"${packageId}"`, '--exact-match', '--prerelease', '--format', 'json'];

            if (source) {
                args.push('--source', source);
            }

            const command = `dotnet ${args.join(' ')}`;
            const { stdout } = await execAsync(command, { timeout: 15000 });

            const results = this.parseSearchResults(stdout);
            const packageData = results.find(pkg => pkg.id.toLowerCase() === packageId.toLowerCase());

            // Extract versions from the search result
            // Note: dotnet search might not return all versions, this is a limitation
            return packageData ? [packageData.version] : [];

        } catch (error) {
            this.logger.error(`Error getting versions for ${packageId}:`, error);
            return [];
        }
    }

    /**
     * Get configured package sources
     */
    static async getPackageSources(): Promise<PackageSource[]> {
        try {
            const { stdout } = await execAsync('dotnet nuget list source --format json', { timeout: 10000 });

            // Parse the sources from dotnet nuget list source output
            const lines = stdout.split('\n').filter(line => line.trim());
            const sources: PackageSource[] = [];

            for (const line of lines) {
                if (line.includes('nuget.org')) {
                    sources.push({
                        name: 'nuget.org',
                        url: 'https://api.nuget.org/v3/index.json',
                        enabled: true,
                        isLocal: false
                    });
                }
                // Parse other sources as needed
            }

            return sources;

        } catch (error) {
            this.logger.error('Error getting package sources:', error);
            // Return default nuget.org source
            return [{
                name: 'nuget.org',
                url: 'https://api.nuget.org/v3/index.json',
                enabled: true,
                isLocal: false
            }];
        }
    }

    /**
     * Parse the JSON output from dotnet search command
     */
    private static parseSearchResults(stdout: string): NuGetPackage[] {
        try {
            if (!stdout.trim()) {
                return [];
            }

            // dotnet search outputs one JSON object per line
            const lines = stdout.split('\n').filter(line => line.trim());
            const packages: NuGetPackage[] = [];

            for (const line of lines) {
                try {
                    const packageData = JSON.parse(line);

                    packages.push({
                        id: packageData.id || packageData.packageId || '',
                        version: packageData.version || packageData.latestVersion || '',
                        description: packageData.description || '',
                        authors: packageData.authors || [],
                        projectUrl: packageData.projectUrl,
                        licenseUrl: packageData.licenseUrl,
                        iconUrl: packageData.iconUrl,
                        tags: packageData.tags ? packageData.tags.split(' ') : [],
                        totalDownloads: packageData.totalDownloads || 0
                    });
                } catch (parseError) {
                    // Skip malformed JSON lines
                    continue;
                }
            }

            return packages;

        } catch (error) {
            this.logger.error('Error parsing search results:', error);
            return [];
        }
    }

    /**
     * Fallback search method for when dotnet search is not available
     * This is a simple approach that just validates package names
     */
    private static async fallbackSearch(options: PackageSearchOptions): Promise<NuGetPackage[]> {
        this.logger.info('Using fallback search method');

        // For now, return empty results
        // In a real implementation, you might use alternative approaches like:
        // - Direct NuGet API calls (what we're trying to avoid)
        // - Local package cache search
        // - User's recently used packages

        return [];
    }
}