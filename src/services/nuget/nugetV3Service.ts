import { logger } from '../../core/logger';
import { NuGetPackage, PackageSearchOptions } from './types';

const log = logger('NuGetV3Service');

/**
 * Service for interacting with NuGet V3 API feeds
 * Handles modern NuGet feeds including nuget.org and Azure DevOps Artifacts
 */
export class NuGetV3Service {

    /**
     * Search packages using NuGet V3 API
     */
    static async searchPackages(
        sourceUrl: string,
        options: PackageSearchOptions,
        accessToken?: string
    ): Promise<NuGetPackage[]> {
        try {
            log.info(`Searching NuGet V3 feed: ${sourceUrl}`);

            // Get service index to find search endpoint
            const serviceIndex = await this.fetchServiceIndex(sourceUrl, accessToken);
            const searchServiceUrl = this.findSearchService(serviceIndex);

            if (!searchServiceUrl) {
                log.warn('No search service found in V3 service index');
                return [];
            }

            // Build search URL with parameters
            const searchUrl = this.buildSearchUrl(searchServiceUrl, options);
            log.info(`V3 API search URL: ${searchUrl}`);

            // Make authenticated request
            const response = await this.makeRequest(searchUrl, accessToken);
            const searchResults = JSON.parse(response);

            const packages = this.parseSearchResults(searchResults);

            // If prereleases are requested, enhance each package with latest prerelease version
            if (options.includePrerelease && packages.length > 0) {
                log.info(`Enhancing ${packages.length} packages with latest prereleases`);
                await this.enhanceWithLatestPrereleases(packages, serviceIndex, accessToken);
            }

            return packages;

        } catch (error) {
            log.error('NuGet V3 search failed:', error);
            throw error;
        }
    }

    /**
     * Get package details including all versions
     */
    static async getPackageDetails(
        sourceUrl: string,
        packageId: string,
        accessToken?: string
    ): Promise<NuGetPackage | null> {
        try {
            const serviceIndex = await this.fetchServiceIndex(sourceUrl, accessToken);
            const registrationUrl = this.findRegistrationService(serviceIndex);

            if (!registrationUrl) {
                log.warn('No registration service found in V3 service index');
                return null;
            }

            // Get package registration data
            const packageUrl = `${registrationUrl}${packageId.toLowerCase()}/index.json`;
            const response = await this.makeRequest(packageUrl, accessToken);
            const packageData = JSON.parse(response);

            return this.parsePackageDetails(packageData);

        } catch (error) {
            log.error(`Error getting V3 package details for ${packageId}:`, error);
            return null;
        }
    }

    /**
     * Get all versions for a package using flat container API
     */
    static async getPackageVersions(
        sourceUrl: string,
        packageId: string,
        accessToken?: string
    ): Promise<string[]> {
        try {
            // Use flat container API which is more reliable for version lists
            // Format: https://api.nuget.org/v3-flatcontainer/{id-lower}/index.json
            const flatContainerUrl = `https://api.nuget.org/v3-flatcontainer/${packageId.toLowerCase()}/index.json`;
            log.info(`Fetching package versions from flat container: ${flatContainerUrl}`);

            const response = await this.makeRequest(flatContainerUrl, accessToken);
            const versionData = JSON.parse(response);

            // Flat container returns {versions: ["1.0.0", "1.0.1", ...]}
            const versions = versionData.versions || [];
            log.info(`Got ${versions.length} versions from flat container, latest 5: ${versions.slice(-5).join(', ')}`);

            return versions;

        } catch (error) {
            log.error(`Error getting V3 versions for ${packageId}:`, error);
            return [];
        }
    }

    /**
     * Fetch NuGet V3 service index
     */
    private static async fetchServiceIndex(sourceUrl: string, accessToken?: string): Promise<any> {
        const response = await this.makeRequest(sourceUrl, accessToken);
        return JSON.parse(response);
    }

    /**
     * Find search service URL from service index
     */
    private static findSearchService(serviceIndex: any): string | null {
        try {
            const resources = serviceIndex.resources || [];
            const searchResource = resources.find((resource: any) =>
                resource['@type']?.includes('SearchQueryService') ||
                resource['@type']?.includes('SearchGalleryQueryService')
            );

            return searchResource?.['@id'] || null;
        } catch (error) {
            log.error('Error finding search service:', error);
            return null;
        }
    }

    /**
     * Find package registration service URL
     */
    private static findRegistrationService(serviceIndex: any): string | null {
        try {
            const resources = serviceIndex.resources || [];
            const registrationResource = resources.find((resource: any) =>
                resource['@type']?.includes('RegistrationsBaseUrl')
            );

            return registrationResource?.['@id'] || null;
        } catch (error) {
            log.error('Error finding registration service:', error);
            return null;
        }
    }

    /**
     * Build search URL with query parameters
     */
    private static buildSearchUrl(baseUrl: string, options: PackageSearchOptions): string {
        const url = new URL(baseUrl);
        url.searchParams.set('q', options.query);
        url.searchParams.set('take', (options.take || 20).toString());

        if (options.includePrerelease) {
            url.searchParams.set('prerelease', 'true');
        }

        if (options.skip) {
            url.searchParams.set('skip', options.skip.toString());
        }

        return url.toString();
    }

    /**
     * Make HTTP request with authentication
     */
    private static async makeRequest(url: string, accessToken?: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const https = require('https');
            const urlObj = new URL(url);

            const headers: Record<string, string> = {
                'Accept': 'application/json',
                'User-Agent': 'DotNet-Extension-VSCode/1.0'
            };

            if (accessToken && accessToken !== 'credential-provider-managed') {
                headers['Authorization'] = `Bearer ${accessToken}`;
            }

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || 443,
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
                headers
            };

            const req = https.request(options, (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => data += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(data);
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    }
                });
            });

            req.on('error', reject);
            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
            req.end();
        });
    }

    /**
     * Parse V3 API search results
     */
    private static parseSearchResults(searchResults: any): NuGetPackage[] {
        try {
            const packages: NuGetPackage[] = [];
            const data = searchResults.data || [];

            for (const item of data) {
                // Get all available versions
                const versions = item.versions || [];
                const allVersions = versions.map((v: any) => v.version).filter(Boolean);

                // Use the top-level version as it represents the latest according to search API
                // The search API should return the appropriate latest version based on prerelease parameter
                const displayVersion = item.version || '';

                packages.push({
                    id: item.id || '',
                    version: displayVersion,
                    description: item.description || '',
                    authors: item.authors || [],
                    projectUrl: item.projectUrl,
                    licenseUrl: item.licenseUrl,
                    iconUrl: item.iconUrl,
                    tags: item.tags || [],
                    totalDownloads: item.totalDownloads || 0,
                    allVersions: allVersions
                });
            }

            return packages;

        } catch (error) {
            log.error('Error parsing V3 search results:', error);
            return [];
        }
    }

    /**
     * Enhance packages with latest prerelease versions from registration API
     */
    private static async enhanceWithLatestPrereleases(
        packages: NuGetPackage[],
        serviceIndex: any,
        accessToken?: string
    ): Promise<void> {
        try {
            const registrationUrl = this.findRegistrationService(serviceIndex);
            if (!registrationUrl) {
                log.warn('No registration service found for prerelease enhancement');
                return;
            }
            log.info(`Using registration service: ${registrationUrl}`);

            // Process packages in batches to avoid overwhelming the API
            for (const pkg of packages.slice(0, 5)) { // Limit to first 5 packages for performance
                try {
                    log.info(`Getting versions for ${pkg.id} (current: ${pkg.version})`);
                    const versions = await this.getPackageVersions(
                        `https://api.nuget.org/v3/index.json`, // Use source URL
                        pkg.id,
                        accessToken
                    );

                    log.info(`Got ${versions.length} versions for ${pkg.id}: ${versions.slice(-5).join(', ')}`);

                    if (versions.length > 0) {
                        // Find the actual latest version (including prereleases)
                        const latestVersion = this.findLatestVersion(versions, true);
                        log.info(`Latest version for ${pkg.id}: ${latestVersion} (current: ${pkg.version})`);

                        if (latestVersion && latestVersion !== pkg.version) {
                            log.info(`Enhanced ${pkg.id}: ${pkg.version} -> ${latestVersion}`);
                            pkg.version = latestVersion;
                        }
                        // Update all versions list
                        pkg.allVersions = versions;
                    }
                } catch (error) {
                    log.warn(`Failed to enhance ${pkg.id} with latest prerelease:`, error);
                }
            }
        } catch (error) {
            log.error('Error enhancing packages with prereleases:', error);
        }
    }

    /**
     * Find the latest version from a list, optionally including prereleases
     */
    private static findLatestVersion(versions: string[], includePrereleases: boolean): string | null {
        if (versions.length === 0) return null;

        // Filter out prereleases if not wanted
        let candidateVersions = versions;
        if (!includePrereleases) {
            candidateVersions = versions.filter(v => !v.includes('-'));
        }

        if (candidateVersions.length === 0) return null;

        // Sort versions using semantic versioning rules
        return candidateVersions.sort((a, b) => {
            return this.compareVersions(b, a); // Descending order
        })[0];
    }

    /**
     * Compare two semantic versions (returns > 0 if a > b, < 0 if a < b, 0 if equal)
     */
    private static compareVersions(a: string, b: string): number {
        const parseVersion = (version: string) => {
            // Handle versions like "10.0.0-rc.1.25451.107"
            const [main, prerelease] = version.split('-', 2);
            const mainParts = main.split('.').map(Number);
            return { mainParts, prerelease: prerelease || null };
        };

        const aVer = parseVersion(a);
        const bVer = parseVersion(b);

        // Compare main version parts first
        const maxLength = Math.max(aVer.mainParts.length, bVer.mainParts.length);
        for (let i = 0; i < maxLength; i++) {
            const aPart = aVer.mainParts[i] || 0;
            const bPart = bVer.mainParts[i] || 0;
            if (aPart !== bPart) return aPart - bPart;
        }

        // Main versions are equal, now compare prerelease status
        // For major version differences (like 10.x vs 9.x), prerelease doesn't matter
        // But this should already be handled above

        if (aVer.prerelease === null && bVer.prerelease === null) return 0;
        if (aVer.prerelease === null) return 1; // Release version > prerelease version
        if (bVer.prerelease === null) return -1; // Prerelease version < release version

        // Both are prereleases, compare prerelease identifiers
        return aVer.prerelease.localeCompare(bVer.prerelease);
    }

    /**
     * Parse package details from registration data
     */
    private static parsePackageDetails(packageData: any): NuGetPackage | null {
        try {
            const items = packageData.items || [];
            if (items.length === 0) {
                return null;
            }

            const latestItem = items[items.length - 1];
            const catalogEntry = latestItem.catalogEntry || {};

            return {
                id: catalogEntry.id || '',
                version: catalogEntry.version || '',
                description: catalogEntry.description || '',
                authors: catalogEntry.authors ? catalogEntry.authors.split(',').map((a: string) => a.trim()) : [],
                projectUrl: catalogEntry.projectUrl,
                licenseUrl: catalogEntry.licenseUrl,
                iconUrl: catalogEntry.iconUrl,
                tags: catalogEntry.tags ? catalogEntry.tags.split(' ') : [],
                totalDownloads: 0, // Not available in registration
                allVersions: this.extractVersions(packageData)
            };

        } catch (error) {
            log.error('Error parsing package details:', error);
            return null;
        }
    }

    /**
     * Extract all versions from package registration data
     */
    private static extractVersions(packageData: any): string[] {
        try {
            const versions: string[] = [];
            const items = packageData.items || [];

            log.info(`Extracting versions from ${items.length} registration items`);

            for (const item of items) {
                const catalogEntry = item.catalogEntry;
                if (catalogEntry?.version) {
                    versions.push(catalogEntry.version);
                }
            }

            log.info(`Extracted ${versions.length} versions, latest 5: ${versions.slice(-5).join(', ')}`);
            return versions.sort();

        } catch (error) {
            log.error('Error extracting versions:', error);
            return [];
        }
    }
}