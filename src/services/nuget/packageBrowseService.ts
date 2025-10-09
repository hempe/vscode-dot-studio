import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../core/logger';
import { NuGetPackage, PackageSearchOptions, PackageSource } from './types';
import { NuGetV3Service } from './nugetV3Service';
import { VersionUtils } from '../versionUtils';

const execAsync = promisify(exec);
const log = logger('PackageBrowseService');

/**
 * Service for browsing and searching NuGet packages using NuGet V3 API
 * Supports all standard NuGet feeds including public and private sources
 */
export class PackageBrowseService {

    /**
     * Search for packages across all configured NuGet sources
     * Uses NuGet V3 API to search public and private feeds
     */
    static async searchPackages(options: PackageSearchOptions): Promise<NuGetPackage[]> {
        if (!options.query || options.query.trim().length < 2) {
            return [];
        }

        log.info(`Searching packages across configured sources for: ${options.query}`);
        return this.searchAcrossConfiguredSources(options);
    }

    /**
     * Get detailed package information including all versions
     */
    static async getPackageDetails(packageId: string, source?: string): Promise<NuGetPackage | null> {
        try {
            const targetSources: PackageSource[] = source
                // Use specific source
                ? [{ name: 'specified', url: source, enabled: true, isLocal: false }]
                // Get all configured sources
                : await this.getPackageSources();

            // Try each source until we find the package
            for (const packageSource of targetSources) {
                if (!packageSource.enabled) continue;

                try {
                    const accessToken = await this.getSourceToken(packageSource);

                    // Upgrade nuget.org V2 URLs to V3 for better functionality
                    const upgradedUrl = this.upgradeNuGetOrgUrl(packageSource.url);

                    const packageDetails = await NuGetV3Service.getPackageDetails(upgradedUrl, packageId, accessToken);

                    if (packageDetails) {
                        // Get all versions
                        packageDetails.allVersions = await this.getPackageVersions(packageId, packageSource.url);

                        // Calculate latest version from all available versions
                        if (packageDetails.allVersions && packageDetails.allVersions.length > 0) {
                            packageDetails.latestVersion = VersionUtils.findLatest(packageDetails.allVersions) || undefined;
                        }

                        return packageDetails;
                    }
                } catch (error) {
                    log.warn(`Failed to get package details from ${packageSource.name}:`, error);
                    continue;
                }
            }

            return null;

        } catch (error) {
            log.warn(`Failed to get package details for ${packageId} (network issues during VS Code initialization are common):`, error);
            return null;
        }
    }

    /**
     * Get all available versions for a package
     */
    static async getPackageVersions(packageId: string, source?: string): Promise<string[]> {
        try {
            let targetSources: PackageSource[] = [];

            if (source) {
                // Use specific source
                targetSources = [{ name: 'specified', url: source, enabled: true, isLocal: false }];
            } else {
                // Get all configured sources
                targetSources = await this.getPackageSources();
            }

            // Try each source until we find versions
            for (const packageSource of targetSources) {
                if (!packageSource.enabled) continue;

                try {
                    const accessToken = await this.getSourceToken(packageSource);

                    // Upgrade nuget.org V2 URLs to V3 for better functionality
                    const upgradedUrl = this.upgradeNuGetOrgUrl(packageSource.url);

                    const versions = await NuGetV3Service.getPackageVersions(upgradedUrl, packageId, accessToken);

                    if (versions.length > 0) {
                        return versions;
                    }
                } catch (error) {
                    log.warn(`Failed to get versions from ${packageSource.name}:`, error);
                    continue;
                }
            }

            return [];

        } catch (error) {
            log.error(`Error getting versions for ${packageId}:`, error);
            return [];
        }
    }

    /**
     * Get configured package sources from multiple nuget.config locations
     * Searches in: root/.nuget/nuget.config, project folders, and global configs
     */
    static async getPackageSources(): Promise<PackageSource[]> {
        try {
            // First try to get sources using dotnet CLI (respects all nuget.config files)
            const sources = await this.getSourcesFromDotnetCli();
            if (sources.length > 0) {
                return sources;
            }

            // Fallback: manually parse nuget.config files
            return await this.getSourcesFromNugetConfigs();

        } catch (error) {
            log.error('Error getting package sources:', error);
            // Return default nuget.org source
            return [{
                name: 'nuget.org',
                url: 'https://api.nuget.org/v3/index.json',
                enabled: true,
                isLocal: false
            }];
        }
    }

    private static pending: Promise<PackageSource[]> | null = null;
    private static async getSourcesFromDotnetCli(): Promise<PackageSource[]> {
        if (this.pending) {
            return this.pending;
        }
        this.pending = this._getSourcesFromDotnetCli();
        try {
            const result = await this.pending;
            return result;
        } finally {
            this.pending = null;
        }
    }

    /**
     * Get sources using dotnet CLI (recommended method)
     */
    private static async _getSourcesFromDotnetCli(): Promise<PackageSource[]> {
        try {
            const { stdout } = await execAsync('dotnet nuget list source --format detailed', { timeout: 10000 });

            const sources: PackageSource[] = [];
            const lines = stdout.split('\n').filter(line => line.trim());

            let currentSource: Partial<PackageSource> = {};

            for (const line of lines) {
                const trimmedLine = line.trim();

                // Match source number and name
                const sourceMatch = trimmedLine.match(/^(\d+)\.\s+(.+?)(?:\s+\[Enabled\]|\s+\[Disabled\])?$/);
                if (sourceMatch) {
                    // Save previous source if complete
                    if (currentSource.name && currentSource.url) {
                        sources.push({
                            name: currentSource.name,
                            url: currentSource.url,
                            enabled: currentSource.enabled ?? true,
                            isLocal: currentSource.isLocal ?? false
                        });
                    }

                    // Start new source
                    currentSource = {
                        name: sourceMatch[2],
                        enabled: !trimmedLine.includes('[Disabled]')
                    };
                    continue;
                }

                // Match URL
                if (trimmedLine.startsWith('http')) {
                    currentSource.url = trimmedLine;
                    currentSource.isLocal = false;
                    continue;
                }

                // Match local path
                if (trimmedLine.match(/^[A-Za-z]:\\|^\/|^\./)) {
                    currentSource.url = trimmedLine;
                    currentSource.isLocal = true;
                    continue;
                }
            }

            // Add the last source
            if (currentSource.name && currentSource.url) {
                sources.push({
                    name: currentSource.name,
                    url: currentSource.url,
                    enabled: currentSource.enabled ?? true,
                    isLocal: currentSource.isLocal ?? false
                });
            }

            log.info(`Found ${sources.length} package sources from dotnet CLI`);
            return sources;

        } catch (error) {
            log.warn('Failed to get sources from dotnet CLI:', error);
            return [];
        }
    }

    /**
     * Manually parse nuget.config files from common locations
     */
    private static async getSourcesFromNugetConfigs(): Promise<PackageSource[]> {
        const fs = require('fs');
        const path = require('path');
        const sources: PackageSource[] = [];

        // Common nuget.config locations
        const configPaths = [
            // Project root/.nuget/nuget.config
            path.join(process.cwd(), '.nuget', 'nuget.config'),
            // Project root/nuget.config
            path.join(process.cwd(), 'nuget.config'),
            // Look for csproj folders and check for nuget.config
            ...(await this.findProjectNugetConfigs())
        ];

        for (const configPath of configPaths) {
            try {
                if (fs.existsSync(configPath)) {
                    log.info(`Parsing nuget.config: ${configPath}`);
                    const configSources = await this.parseNugetConfig(configPath);
                    sources.push(...configSources);
                }
            } catch (error) {
                log.warn(`Failed to parse ${configPath}:`, error);
            }
        }

        // Add default nuget.org if no sources found
        if (sources.length === 0) {
            sources.push({
                name: 'nuget.org',
                url: 'https://api.nuget.org/v3/index.json',
                enabled: true,
                isLocal: false
            });
        }

        return sources;
    }

    /**
     * Find nuget.config files in project directories
     */
    private static async findProjectNugetConfigs(): Promise<string[]> {
        const fs = require('fs');
        const path = require('path');
        const configs: string[] = [];

        try {
            // Find all csproj/vbproj/fsproj files
            const { stdout } = await execAsync('find . -name "*.csproj" -o -name "*.vbproj" -o -name "*.fsproj" 2>/dev/null || echo ""', { timeout: 5000 });
            const projectFiles = stdout.split('\n').filter(line => line.trim());

            for (const projectFile of projectFiles) {
                const projectDir = path.dirname(projectFile);
                const nugetConfig = path.join(projectDir, 'nuget.config');
                if (fs.existsSync(nugetConfig)) {
                    configs.push(nugetConfig);
                }
            }
        } catch (error) {
            // Ignore errors in project discovery
        }

        return configs;
    }

    /**
     * Parse a nuget.config XML file
     */
    private static async parseNugetConfig(configPath: string): Promise<PackageSource[]> {
        const fs = require('fs');
        const sources: PackageSource[] = [];

        try {
            const configContent = fs.readFileSync(configPath, 'utf8');

            // Simple XML parsing for packageSources
            const packageSourcesMatch = configContent.match(/<packageSources[^>]*>([\s\S]*?)<\/packageSources>/);
            if (!packageSourcesMatch) {
                return sources;
            }

            const packageSourcesXml = packageSourcesMatch[1];

            // Extract add elements
            const addMatches = packageSourcesXml.matchAll(/<add\s+key="([^"]+)"\s+value="([^"]+)"[^>]*\/?>|<add\s+value="([^"]+)"\s+key="([^"]+)"[^>]*\/?>/g);

            for (const match of addMatches) {
                const key = match[1] || match[4];
                const value = match[2] || match[3];

                if (key && value) {
                    sources.push({
                        name: key,
                        url: value,
                        enabled: true, // TODO: Check for disabled sources
                        isLocal: !value.startsWith('http')
                    });
                }
            }

            log.info(`Parsed ${sources.length} sources from ${configPath}`);

        } catch (error) {
            log.error(`Error parsing nuget.config ${configPath}:`, error);
        }

        return sources;
    }

    /**
     * Search across all configured NuGet sources
     * This respects nuget.config and private feeds
     */
    private static async searchAcrossConfiguredSources(options: PackageSearchOptions): Promise<NuGetPackage[]> {
        try {
            // Get all configured sources from nuget.config
            const sources = await this.getPackageSources();
            log.info(`Found ${sources.length} configured package sources`);

            const allResults: NuGetPackage[] = [];
            const searchPromises: Promise<NuGetPackage[]>[] = [];

            // Search each source (but limit to avoid overwhelming)
            for (const source of sources.slice(0, 3)) { // Limit to first 3 sources for performance
                if (source.enabled) {
                    log.info(`Searching source: ${source.name} (${source.url})`);
                    searchPromises.push(this.searchSingleSource(source, options));
                }
            }

            // Wait for all searches to complete
            const results = await Promise.allSettled(searchPromises);

            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    allResults.push(...result.value);
                } else {
                    log.warn(`Search failed for source ${index}:`, result.reason);
                }
            });

            // Remove duplicates based on package ID
            const uniquePackages = this.deduplicatePackages(allResults);
            log.info(`Found ${uniquePackages.length} unique packages across all sources`);

            return uniquePackages.slice(0, options.take || 20);

        } catch (error) {
            log.error('Error searching across configured sources:', error);
            // Ultimate fallback - try nuget.org V3 API directly
            try {
                const accessToken = await this.getSourceToken({ name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json', enabled: true, isLocal: false });
                return await NuGetV3Service.searchPackages('https://api.nuget.org/v3/index.json', options, accessToken);
            } catch (fallbackError) {
                log.error('Fallback search also failed:', fallbackError);
                return [];
            }
        }
    }

    /**
     * Search a single package source using NuGet V3 API
     */
    private static async searchSingleSource(source: PackageSource, options: PackageSearchOptions): Promise<NuGetPackage[]> {
        try {
            const accessToken = await this.getSourceToken(source);

            // Upgrade nuget.org V2 URLs to V3 for better functionality
            const upgradedUrl = this.upgradeNuGetOrgUrl(source.url);

            log.info(`Using NuGet V3 API for: ${source.name}`);
            return await NuGetV3Service.searchPackages(upgradedUrl, options, accessToken);

        } catch (error) {
            log.error(`Error searching source ${source.name}:`, error);
            return [];
        }
    }

    /**
     * Upgrade nuget.org V2 URLs to V3 for better functionality
     */
    private static upgradeNuGetOrgUrl(sourceUrl: string): string {
        // Upgrade old nuget.org V2 URLs to V3
        if (sourceUrl.includes('nuget.org') && sourceUrl.includes('/api/v2')) {
            log.info(`Upgrading nuget.org V2 URL to V3: ${sourceUrl}`);
            return 'https://api.nuget.org/v3/index.json';
        }

        // Upgrade www.nuget.org URLs to api.nuget.org V3
        if (sourceUrl.includes('www.nuget.org')) {
            log.info(`Upgrading www.nuget.org URL to V3: ${sourceUrl}`);
            return 'https://api.nuget.org/v3/index.json';
        }

        return sourceUrl;
    }

    /**
     * Get authentication token for a source
     */
    private static async getSourceToken(source: PackageSource): Promise<string | undefined> {
        try {
            // For Azure DevOps feeds, check if credential provider is available
            if (source.url.includes('dev.azure.com') || source.url.includes('visualstudio.com')) {
                return await this.getAzureDevOpsToken(source.url);
            }

            // For other private feeds, return undefined (no auth)
            return undefined;

        } catch (error) {
            log.warn(`Failed to get token for ${source.name}:`, error);
            return undefined;
        }
    }

    /**
     * Get Azure DevOps authentication token using credential provider
     */
    private static async getAzureDevOpsToken(sourceUrl: string): Promise<string | undefined> {
        try {
            // Try to get token from Azure Artifacts Credential Provider
            // This is installed when users set up Azure DevOps feeds
            const authCommand = `dotnet restore --verbosity quiet --no-cache --force --interactive false`;
            try {
                await execAsync(authCommand, { timeout: 5000, cwd: process.cwd() });
                log.info('Azure DevOps credentials are available');

                // For now, return a placeholder - in production you'd extract from credential provider
                // The credential provider handles this automatically for dotnet commands
                return 'credential-provider-managed';
            } catch (authError) {
                log.warn('Azure DevOps credential provider not configured or no access');
                return undefined;
            }

        } catch (error) {
            log.error('Error checking Azure DevOps authentication:', error);
            return undefined;
        }
    }
    /**
     * Remove duplicate packages based on ID, keeping the one with highest version
     */
    private static deduplicatePackages(packages: NuGetPackage[]): NuGetPackage[] {
        const packageMap = new Map<string, NuGetPackage>();

        for (const pkg of packages) {
            const existing = packageMap.get(pkg.id.toLowerCase());
            if (!existing || VersionUtils.compare(pkg.currentVersion, existing.currentVersion) > 0) {
                packageMap.set(pkg.id.toLowerCase(), pkg);
            }
        }

        return Array.from(packageMap.values());
    }

}