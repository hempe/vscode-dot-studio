import { logger } from '../../core/logger';
import { NuGetPackage, PackageSearchOptions } from './types';

/**
 * Service for interacting with NuGet V2 API feeds (legacy OData format)
 * Handles older feeds that still use the V2 protocol
 */
export class NuGetV2Service {
    private static readonly logger = logger('NuGetV2Service');

    /**
     * Search packages using NuGet V2 OData API
     */
    static async searchPackages(
        sourceUrl: string,
        options: PackageSearchOptions,
        accessToken?: string
    ): Promise<NuGetPackage[]> {
        try {
            this.logger.info(`Searching NuGet V2 feed: ${sourceUrl}`);

            // Build V2 OData search URL
            const searchUrl = this.buildV2SearchUrl(sourceUrl, options);
            this.logger.info(`V2 OData search URL: ${searchUrl}`);

            // Make authenticated request
            const response = await this.makeRequest(searchUrl, accessToken);
            const searchResults = this.parseXmlResponse(response);

            return this.parseV2SearchResults(searchResults);

        } catch (error) {
            this.logger.error('NuGet V2 search failed:', error);
            throw error;
        }
    }

    /**
     * Get package details from V2 feed
     */
    static async getPackageDetails(
        sourceUrl: string,
        packageId: string,
        accessToken?: string
    ): Promise<NuGetPackage | null> {
        try {
            // V2 API endpoint for specific package
            const packageUrl = `${this.ensureV2BaseUrl(sourceUrl)}/Packages?$filter=Id eq '${packageId}'&$orderby=Version desc&$top=1`;
            const response = await this.makeRequest(packageUrl, accessToken);
            const packageData = this.parseXmlResponse(response);

            return this.parseV2PackageDetails(packageData);

        } catch (error) {
            this.logger.error(`Error getting V2 package details for ${packageId}:`, error);
            return null;
        }
    }

    /**
     * Get all versions for a package from V2 feed
     */
    static async getPackageVersions(
        sourceUrl: string,
        packageId: string,
        accessToken?: string
    ): Promise<string[]> {
        try {
            const versionsUrl = `${this.ensureV2BaseUrl(sourceUrl)}/Packages?$filter=Id eq '${packageId}'&$select=Version&$orderby=Version`;
            const response = await this.makeRequest(versionsUrl, accessToken);
            const versionData = this.parseXmlResponse(response);

            return this.extractV2Versions(versionData);

        } catch (error) {
            this.logger.error(`Error getting V2 versions for ${packageId}:`, error);
            return [];
        }
    }

    /**
     * Build V2 OData search URL
     */
    private static buildV2SearchUrl(sourceUrl: string, options: PackageSearchOptions): string {
        const baseUrl = this.ensureV2BaseUrl(sourceUrl);
        const url = new URL(`${baseUrl}/Packages`);

        // Build OData filter
        const filters: string[] = [];

        // Search in Id and Description
        if (options.query) {
            filters.push(`(substringof('${options.query}',Id) or substringof('${options.query}',Description))`);
        }

        // Handle prerelease
        if (!options.includePrerelease) {
            filters.push(`IsPrerelease eq false`);
        }

        if (filters.length > 0) {
            url.searchParams.set('$filter', filters.join(' and '));
        }

        // Add ordering and paging
        url.searchParams.set('$orderby', 'DownloadCount desc');
        url.searchParams.set('$top', (options.take || 20).toString());

        if (options.skip) {
            url.searchParams.set('$skip', options.skip.toString());
        }

        return url.toString();
    }

    /**
     * Ensure URL is V2 API base URL
     */
    private static ensureV2BaseUrl(sourceUrl: string): string {
        // Remove /index.json if present (V3 format)
        const cleanUrl = sourceUrl.replace(/\/index\.json$/, '');

        // If it already looks like V2, return as-is
        if (cleanUrl.includes('/api/v2')) {
            return cleanUrl;
        }

        // Try to convert V3 to V2 URL patterns
        if (cleanUrl.includes('pkgs.dev.azure.com')) {
            // Azure DevOps V3 to V2 conversion
            return cleanUrl.replace('/nuget/v3', '/nuget/v2');
        }

        if (cleanUrl.includes('api.nuget.org/v3')) {
            // NuGet.org V3 to V2 conversion
            return 'https://www.nuget.org/api/v2';
        }

        // Default: assume it's already a V2 URL or add /api/v2
        return cleanUrl.endsWith('/api/v2') ? cleanUrl : `${cleanUrl}/api/v2`;
    }

    /**
     * Make HTTP request with authentication
     */
    private static async makeRequest(url: string, accessToken?: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const https = require('https');
            const urlObj = new URL(url);

            const headers: Record<string, string> = {
                'Accept': 'application/atom+xml,application/xml',
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
     * Parse XML response from V2 API (basic parsing)
     */
    private static parseXmlResponse(xmlString: string): any {
        try {
            // Simple XML parsing for V2 responses
            // In production, you'd use a proper XML parser like xml2js
            const entries: any[] = [];

            // Extract entry elements
            const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/g;
            let match;

            while ((match = entryRegex.exec(xmlString)) !== null) {
                const entryXml = match[1];
                const entry = this.parseEntryXml(entryXml);
                if (entry) {
                    entries.push(entry);
                }
            }

            return { entries };

        } catch (error) {
            this.logger.error('Error parsing XML response:', error);
            return { entries: [] };
        }
    }

    /**
     * Parse individual entry XML
     */
    private static parseEntryXml(entryXml: string): any {
        try {
            const properties: any = {};

            // Extract properties from m:properties section
            const propsMatch = entryXml.match(/<m:properties[^>]*>([\s\S]*?)<\/m:properties>/);
            if (propsMatch) {
                const propsXml = propsMatch[1];

                // Extract common properties
                properties.Id = this.extractXmlValue(propsXml, 'd:Id');
                properties.Version = this.extractXmlValue(propsXml, 'd:Version');
                properties.Description = this.extractXmlValue(propsXml, 'd:Description');
                properties.Authors = this.extractXmlValue(propsXml, 'd:Authors');
                properties.ProjectUrl = this.extractXmlValue(propsXml, 'd:ProjectUrl');
                properties.LicenseUrl = this.extractXmlValue(propsXml, 'd:LicenseUrl');
                properties.IconUrl = this.extractXmlValue(propsXml, 'd:IconUrl');
                properties.Tags = this.extractXmlValue(propsXml, 'd:Tags');
                properties.DownloadCount = parseInt(this.extractXmlValue(propsXml, 'd:DownloadCount') || '0');
                properties.IsPrerelease = this.extractXmlValue(propsXml, 'd:IsPrerelease') === 'true';
            }

            return properties;

        } catch (error) {
            this.logger.error('Error parsing entry XML:', error);
            return null;
        }
    }

    /**
     * Extract value from XML tag
     */
    private static extractXmlValue(xml: string, tagName: string): string {
        const regex = new RegExp(`<${tagName}[^>]*>([^<]*)<\/${tagName}>`, 'i');
        const match = xml.match(regex);
        return match ? match[1].trim() : '';
    }

    /**
     * Parse V2 search results
     */
    private static parseV2SearchResults(searchResults: any): NuGetPackage[] {
        try {
            const packages: NuGetPackage[] = [];
            const entries = searchResults.entries || [];

            for (const entry of entries) {
                packages.push({
                    id: entry.Id || '',
                    version: entry.Version || '',
                    description: entry.Description || '',
                    authors: entry.Authors ? entry.Authors.split(',').map((a: string) => a.trim()) : [],
                    projectUrl: entry.ProjectUrl,
                    licenseUrl: entry.LicenseUrl,
                    iconUrl: entry.IconUrl,
                    tags: entry.Tags ? entry.Tags.split(' ').filter((t: string) => t.trim()) : [],
                    totalDownloads: entry.DownloadCount || 0
                });
            }

            return packages;

        } catch (error) {
            this.logger.error('Error parsing V2 search results:', error);
            return [];
        }
    }

    /**
     * Parse package details from V2 response
     */
    private static parseV2PackageDetails(packageData: any): NuGetPackage | null {
        try {
            const entries = packageData.entries || [];
            if (entries.length === 0) {
                return null;
            }

            const entry = entries[0];
            return {
                id: entry.Id || '',
                version: entry.Version || '',
                description: entry.Description || '',
                authors: entry.Authors ? entry.Authors.split(',').map((a: string) => a.trim()) : [],
                projectUrl: entry.ProjectUrl,
                licenseUrl: entry.LicenseUrl,
                iconUrl: entry.IconUrl,
                tags: entry.Tags ? entry.Tags.split(' ').filter((t: string) => t.trim()) : [],
                totalDownloads: entry.DownloadCount || 0
            };

        } catch (error) {
            this.logger.error('Error parsing V2 package details:', error);
            return null;
        }
    }

    /**
     * Extract versions from V2 response
     */
    private static extractV2Versions(versionData: any): string[] {
        try {
            const versions: string[] = [];
            const entries = versionData.entries || [];

            for (const entry of entries) {
                if (entry.Version) {
                    versions.push(entry.Version);
                }
            }

            return versions;

        } catch (error) {
            this.logger.error('Error extracting V2 versions:', error);
            return [];
        }
    }
}