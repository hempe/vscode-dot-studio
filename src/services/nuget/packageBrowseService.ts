import { exec } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { logger } from '../../core/logger';
import { NuGetPackage, PackageSearchOptions, PackageSource, upgradeNuGetOrgUrl } from './types';
import { NuGetV3Service } from './nugetV3Service';
import { VersionUtils } from '../versionUtils';
import { NuGetCredentialManager } from './nugetCredentialManager';

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
    static async getPackageDetails(packageId: string, source?: PackageSource): Promise<NuGetPackage | null> {
        try {
            const targetSources: PackageSource[] = source
                // Use specific source
                ? [source]
                // Get all configured sources
                : await this.getPackageSources();

            // Try each source until we find the package

            try {
                // Upgrade nuget.org V2 URLs to V3 for better functionality
                const packageDetails = await NuGetV3Service.getPackageDetails(packageId, targetSources);
                return packageDetails;
            } catch (error) {
                log.warn(`Failed to get package details from ${packageId}:`, error);
            }

            return null;

        } catch (error) {
            log.warn(`Failed to get package details for ${packageId} (network issues during VS Code initialization are common):`, error);
            return null;
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
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const { stdout } = await execAsync('dotnet nuget list source --format detailed', {
                timeout: 10000,
                cwd: workspaceFolder
            });

            const sources: PackageSource[] = [];
            const lines = stdout.split('\n').filter(line => line.trim());

            let currentSource: Partial<PackageSource> = {};

            for (const line of lines) {
                const trimmedLine = line.trim();

                // Match source number and name (e.g., "1.  CIRRUS [Enabled]" or "2.  nuget.org [Disabled]")
                const sourceMatch = trimmedLine.match(/^(\d+)\.\s+(.+?)\s+\[(Enabled|Disabled)\]$/);
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
                        enabled: sourceMatch[3] === 'Enabled'
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
                const accessToken = await NuGetCredentialManager.getSourceToken({ name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json', enabled: true, isLocal: false });
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
            const accessToken = await NuGetCredentialManager.getSourceToken(source);

            // Upgrade nuget.org V2 URLs to V3 for better functionality
            const upgradedUrl = upgradeNuGetOrgUrl(source.url);

            log.info(`Using NuGet V3 API for: ${source.name}`);
            return await NuGetV3Service.searchPackages(upgradedUrl, options, accessToken);

        } catch (error) {
            log.error(`Error searching source ${source.name}:`, error);
            return [];
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