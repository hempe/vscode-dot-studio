import * as https from 'https';
import { NuGetPackage, NuGetSearchOptions } from '../types/nuget';
import { logger } from '../core/logger';

export class NuGetService {
    private static readonly SEARCH_API_URL = 'https://azuresearch-usnc.nuget.org/query';
    private static readonly REQUEST_TIMEOUT = 10000;
    private static readonly logger = logger('NuGetService');

    /**
     * Search for NuGet packages using the official NuGet.org API
     */
    static async searchPackages(options: NuGetSearchOptions): Promise<NuGetPackage[]> {
        if (!options.query || options.query.trim().length < 2) {
            return [];
        }

        try {
            const params = new URLSearchParams({
                q: options.query.trim(),
                skip: (options.skip || 0).toString(),
                take: (options.take || 20).toString(),
                prerelease: options.includePrerelease.toString(),
                semVerLevel: '2.0.0'
            });

            const fullUrl = `${this.SEARCH_API_URL}?${params}`;
            const data = await this.makeHttpRequest(fullUrl);

            return data.data || [];
        } catch (error) {
            this.logger.error('Error searching NuGet packages:', error);
            throw new Error(`Failed to search packages: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Make an HTTPS request and return the parsed JSON response
     */
    private static makeHttpRequest(url: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const req = https.get(url, (res: any) => {
                let data = '';

                res.on('data', (chunk: any) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                            return;
                        }

                        const jsonData = JSON.parse(data);
                        resolve(jsonData);
                    } catch (parseError) {
                        reject(new Error(`Failed to parse response: ${parseError}`));
                    }
                });
            });

            req.on('error', (error: any) => {
                reject(new Error(`Network error: ${error.message}`));
            });

            req.setTimeout(this.REQUEST_TIMEOUT, () => {
                req.abort();
                reject(new Error('Request timeout'));
            });
        });
    }

    /**
     * Validate package ID format
     */
    static validatePackageId(packageId: string): boolean {
        // NuGet package IDs follow specific rules
        const packageIdRegex = /^[A-Za-z0-9_.-]+$/;
        return Boolean(packageId && packageId.length > 0 && packageIdRegex.test(packageId));
    }

    /**
     * Validate version format (semantic versioning)
     */
    static validateVersion(version: string): boolean {
        if (!version) return false;

        // Simplified semver validation - major.minor.patch format with optional prerelease/build
        const versionRegex = /^\d+\.\d+(\.\d+)?(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;
        return versionRegex.test(version) && !version.includes('....'); // Prevent excessive dots
    }
}