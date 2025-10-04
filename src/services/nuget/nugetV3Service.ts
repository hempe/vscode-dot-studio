import { logger } from '../../core/logger';
import { NuGetPackage, PackageSearchOptions } from './types';

/**
 * Service for interacting with NuGet V3 API feeds
 * Handles modern NuGet feeds including nuget.org and Azure DevOps Artifacts
 */
export class NuGetV3Service {
    private static readonly logger = logger('NuGetV3Service');

    /**
     * Search packages using NuGet V3 API
     */
    static async searchPackages(
        sourceUrl: string,
        options: PackageSearchOptions,
        accessToken?: string
    ): Promise<NuGetPackage[]> {
        try {
            this.logger.info(`Searching NuGet V3 feed: ${sourceUrl}`);

            // Get service index to find search endpoint
            const serviceIndex = await this.fetchServiceIndex(sourceUrl, accessToken);
            const searchServiceUrl = this.findSearchService(serviceIndex);

            if (!searchServiceUrl) {
                this.logger.warn('No search service found in V3 service index');
                return [];
            }

            // Build search URL with parameters
            const searchUrl = this.buildSearchUrl(searchServiceUrl, options);
            this.logger.info(`V3 API search URL: ${searchUrl}`);

            // Make authenticated request
            const response = await this.makeRequest(searchUrl, accessToken);
            const searchResults = JSON.parse(response);

            return this.parseSearchResults(searchResults);

        } catch (error) {
            this.logger.error('NuGet V3 search failed:', error);
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
                this.logger.warn('No registration service found in V3 service index');
                return null;
            }

            // Get package registration data
            const packageUrl = `${registrationUrl}${packageId.toLowerCase()}/index.json`;
            const response = await this.makeRequest(packageUrl, accessToken);
            const packageData = JSON.parse(response);

            return this.parsePackageDetails(packageData);

        } catch (error) {
            this.logger.error(`Error getting V3 package details for ${packageId}:`, error);
            return null;
        }
    }

    /**
     * Get all versions for a package
     */
    static async getPackageVersions(
        sourceUrl: string,
        packageId: string,
        accessToken?: string
    ): Promise<string[]> {
        try {
            const serviceIndex = await this.fetchServiceIndex(sourceUrl, accessToken);
            const registrationUrl = this.findRegistrationService(serviceIndex);

            if (!registrationUrl) {
                return [];
            }

            const packageUrl = `${registrationUrl}${packageId.toLowerCase()}/index.json`;
            const response = await this.makeRequest(packageUrl, accessToken);
            const packageData = JSON.parse(response);

            return this.extractVersions(packageData);

        } catch (error) {
            this.logger.error(`Error getting V3 versions for ${packageId}:`, error);
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
            this.logger.error('Error finding search service:', error);
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
            this.logger.error('Error finding registration service:', error);
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
                // Get the latest version info
                const versions = item.versions || [];
                const latestVersion = versions.length > 0 ? versions[versions.length - 1] : {};

                packages.push({
                    id: item.id || '',
                    version: latestVersion.version || item.version || '',
                    description: item.description || '',
                    authors: item.authors || [],
                    projectUrl: item.projectUrl,
                    licenseUrl: item.licenseUrl,
                    iconUrl: item.iconUrl,
                    tags: item.tags || [],
                    totalDownloads: item.totalDownloads || 0,
                    allVersions: versions.map((v: any) => v.version).filter(Boolean)
                });
            }

            return packages;

        } catch (error) {
            this.logger.error('Error parsing V3 search results:', error);
            return [];
        }
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
            this.logger.error('Error parsing package details:', error);
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

            for (const item of items) {
                const catalogEntry = item.catalogEntry;
                if (catalogEntry?.version) {
                    versions.push(catalogEntry.version);
                }
            }

            return versions.sort();

        } catch (error) {
            this.logger.error('Error extracting versions:', error);
            return [];
        }
    }
}