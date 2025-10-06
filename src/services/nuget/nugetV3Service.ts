import { sign } from 'crypto';
import { logger } from '../../core/logger';
import { NuGetPackage, PackageSearchOptions } from './types';
import * as https from 'https';
import semver, { rsort } from "semver";
import { PersistentCache, CacheEntry } from '../../core/persistentCache';
import { BackgroundRefreshQueue } from '../../core/backgroundRefreshQueue';
import * as path from 'path';
import * as os from 'os';

const log = logger('NuGetV3Service');

/**
 * Service for interacting with NuGet V3 API feeds
 * Handles modern NuGet feeds including nuget.org and Azure DevOps Artifacts
 */
export class NuGetV3Service {
    // In-memory cache (existing)
    private static requestCache: Map<string, { timestamp: number, promise: Promise<{ body: string, statusCode: number }> }> = new Map();

    // Persistent cache
    private static persistentCache: PersistentCache<{ body: string, statusCode: number }> | null = null;

    // Background refresh queue
    private static refreshQueue: BackgroundRefreshQueue | null = null;

    // UI notification callbacks
    private static uiNotificationCallbacks: Array<(url: string) => void> = [];
    private static lastUINotification = 0;

    /**
     * Initialize the caching system
     */
    static initializeCache(extensionPath?: string): void {
        if (this.persistentCache) return; // Already initialized

        const cacheDir = extensionPath
            ? path.join(extensionPath, '.cache', 'nuget-requests')
            : path.join(os.tmpdir(), 'vscode-dotnet-extension', 'cache', 'nuget-requests');

        this.persistentCache = new PersistentCache(cacheDir, {
            maxAge: 30 * 60 * 1000, // 30 minutes for fresh cache
            maxEntries: 5000
        });

        this.refreshQueue = new BackgroundRefreshQueue({
            idleDelayMs: 2000, // 2 seconds idle
            maxConcurrent: 3,
            maxRetries: 2,
            onRefreshComplete: (url, success, data) => {
                if (success && data) {
                    // Update both caches
                    const cacheKey = this.getCacheKey(url);
                    this.requestCache.set(cacheKey, {
                        timestamp: Date.now(),
                        promise: Promise.resolve(data)
                    });
                    this.persistentCache?.set(cacheKey, data, url);

                    // Notify UI with delay and rate limiting to avoid spam
                    const now = Date.now();
                    if (now - this.lastUINotification > 2000) { // Max 1 notification per 2 seconds
                        this.lastUINotification = now;
                        setTimeout(() => {
                            this.notifyUI(url);
                        }, 500);
                    }
                }
            }
        });

        // Inject the refresh function
        this.refreshQueue.setRefreshFunction((url, accessToken) => {
            return this._makeHttpRequest(url, accessToken);
        });

        log.info(`Initialized caching system with directory: ${cacheDir}`);
    }

    /**
     * Register a callback for UI notifications when cache is updated
     */
    static onCacheUpdate(callback: (url: string) => void): void {
        this.uiNotificationCallbacks.push(callback);
    }

    /**
     * Remove UI notification callback
     */
    static offCacheUpdate(callback: (url: string) => void): void {
        const index = this.uiNotificationCallbacks.indexOf(callback);
        if (index !== -1) {
            this.uiNotificationCallbacks.splice(index, 1);
        }
    }

    private static notifyUI(url: string): void {
        this.uiNotificationCallbacks.forEach(callback => {
            try {
                callback(url);
            } catch (error) {
                log.warn('Error in UI notification callback:', error);
            }
        });
    }

    private static getCacheKey(url: string, accessToken?: string): string {
        return `${url}|${accessToken || ''}`;
    }

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
            if (response.statusCode !== 200) {
                throw new Error(`Search request failed with status code: ${response.statusCode}`);
            }

            const searchResults = JSON.parse(response.body);

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

    private static packageCache: Map<string, { timestamp: number, request: Promise<NuGetPackage | null> }> = new Map();

    /**
     * Get package details including all versions
     */
    static async getPackageDetails(
        sourceUrl: string,
        packageId: string,
        accessToken?: string
    ): Promise<NuGetPackage | null> {
        const now = Date.now();
        const cacheKey = `${sourceUrl}|${packageId}`;
        const cached = this.packageCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < 10 * 60 * 1000) { // 10 minutes cache
            log.info(`Using cached package details for ${packageId}`);
            return cached.request;
        }

        const request = this._getPackageDetails(sourceUrl, packageId, accessToken);
        try {
            this.packageCache.set(cacheKey, { timestamp: now, request });
            return await request;

        } catch (error) {
            log.error(`Error getting V3 package details for ${packageId}:`, error);
            this.packageCache.delete(cacheKey);
            return null;
        }
    }

    private static async _getPackageDetails(
        sourceUrl: string,
        packageId: string,
        accessToken?: string
    ): Promise<NuGetPackage | null> {
        for (let i = 0; i < 3; i++) {
            try {
                const serviceIndex = await this.fetchServiceIndex(sourceUrl, accessToken);
                const registrationUrl = this.findRegistrationService(serviceIndex);

                if (!registrationUrl) {
                    log.warn('No registration service found in V3 service index');
                    return null;
                }

                const packageUrl = `${registrationUrl}${packageId.toLowerCase()}/index.json`;
                const response = await this.makeRequest(packageUrl, accessToken);
                if (response.statusCode !== 200) {
                    log.warn(`Failed to get package details for ${packageId}, status code: ${response.statusCode}`);
                    return null;
                }

                const packageData = JSON.parse(response.body);

                if (!packageData.items || packageData.items.length === 0) {
                    return null;
                }

                // 🧮 Find the page with the highest `upper` version
                const pages = packageData.items.filter((i: any) => i['@id'] && i.upper);
                if (pages.length === 0) {
                    return null;
                }

                // Compare versions using semver if available
                const latestPage = pages.reduce((best: any, cur: any) => {
                    try {
                        return semver.gt(cur.upper, best.upper) ? cur : best;
                    } catch {
                        return cur.upper > best.upper ? cur : best;
                    }
                }, pages[0]);

                let allItems: any[] = [];

                if (Array.isArray(latestPage.items) && latestPage.items.length > 0) {
                    allItems = latestPage.items;
                } else if (latestPage['@id']) {
                    // 🔗 Fetch only the latest page
                    const subResponse = await this.makeRequest(latestPage['@id'], accessToken);
                    if (subResponse.statusCode === 200) {
                        const subData = JSON.parse(subResponse.body);
                        allItems = subData.items || [];
                    } else {
                        log.warn(`Failed to fetch latest page ${latestPage['@id']}, status ${subResponse.statusCode}`);
                    }
                }

                if (allItems.length === 0) {
                    return null;
                }

                // Reshape data so parsePackageDetails() can handle it
                const mergedData = { items: [{ items: allItems }] };

                return this.parsePackageDetails(mergedData, packageUrl);

            } catch (error) {
                await new Promise(res => setTimeout(res, 1000 * (i + 1))); // Exponential backoff
                log.error(`Error getting V3 package details for ${packageId}:`, error);
            }
        }

        throw new Error(`Failed to get package details for ${packageId} after multiple attempts`);
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
            if (response.statusCode !== 200) {
                log.warn(`Failed to get versions for ${packageId}, status code: ${response.statusCode}`);
                return [];
            }

            const versionData = JSON.parse(response.body);

            // Flat container returns {versions: ["1.0.0", "1.0.1", ...]}
            const versions = versionData.versions || [];
            log.info(`Got ${versions.length} versions from flat container, latest 5: ${versions.slice(-5).join(', ')}`);

            return versions;

        } catch (error) {
            log.error(`Error getting V3 versions for ${packageId}:`, error);
            return [];
        }
    }

    private static serviceIndexCache: Map<string, { timestamp: number, request: Promise<any> }> = new Map();

    /**
     * Fetch NuGet V3 service index
     */
    private static async fetchServiceIndex(sourceUrl: string, accessToken?: string): Promise<any> {
        if (this.serviceIndexCache.has(sourceUrl)) {
            const cached = this.serviceIndexCache.get(sourceUrl)!;
            if (Date.now() - cached.timestamp < 10 * 60 * 1000) { // 10 minutes cache
                return cached.request;
            }
        }

        log.info(`Fetching V3 service index from: ${sourceUrl}`);

        const request = this.makeRequest(sourceUrl, accessToken)
            .then(response => {
                if (response.statusCode === 200)
                    return JSON.parse(response.body);
                this.serviceIndexCache.delete(sourceUrl);
                throw new Error(`Failed to fetch service index, status code: ${response.statusCode}`);
            })
            .catch(error => {
                this.serviceIndexCache.delete(sourceUrl);
                throw error;
            });
        this.serviceIndexCache.set(sourceUrl, { timestamp: Date.now(), request });
        return request;
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
     * Make HTTP request with multi-tier caching and ETag support
     */
    private static async makeRequest(url: string, accessToken?: string): Promise<{ body: string, statusCode: number }> {
        // Initialize cache if not done yet
        if (!this.persistentCache) {
            this.initializeCache();
        }

        // Mark activity for background queue (only if cache system is working properly)
        try {
            this.refreshQueue?.markActivity();
        } catch (error) {
            log.warn('Background refresh queue error, disabling:', error);
            this.refreshQueue = null; // Disable on error
        }

        const cacheKey = this.getCacheKey(url, accessToken);
        const allowedCacheTime = 5 * 60 * 1000; // 5 minutes for fresh cache

        // 1. Check in-memory cache first
        const memoryCache = this.requestCache.get(cacheKey);
        if (memoryCache && (Date.now() - memoryCache.timestamp) < allowedCacheTime) {
            log.debug(`Using fresh in-memory cache for ${url}`);
            return memoryCache.promise;
        }

        // 2. Check persistent cache
        const persistentEntry = await this.persistentCache?.get(cacheKey);
        if (persistentEntry) {
            const age = Date.now() - persistentEntry.timestamp;

            if (age < allowedCacheTime) {
                // Fresh persistent cache - update memory cache and use it
                log.debug(`Using fresh persistent cache for ${url}`);
                const promise = Promise.resolve(persistentEntry.data);
                this.requestCache.set(cacheKey, { timestamp: persistentEntry.timestamp, promise });
                return promise;
            } else {
                // Stale persistent cache - use it but queue a refresh
                log.debug(`Using stale persistent cache for ${url}, queuing refresh`);
                try {
                    this.refreshQueue?.enqueue(url, accessToken, 'normal');
                } catch (error) {
                    log.warn('Failed to enqueue background refresh:', error);
                }

                // Update memory cache with stale data
                const promise = Promise.resolve(persistentEntry.data);
                this.requestCache.set(cacheKey, { timestamp: persistentEntry.timestamp, promise });
                return promise;
            }
        }

        // 3. No cache available - make fresh request
        log.info(`Making fresh request to ${url}`);
        const promise = this._makeHttpRequestWithETag(url, accessToken);

        this.requestCache.set(cacheKey, { timestamp: Date.now(), promise });

        return promise
            .then(async (result) => {
                // Cache the result if successful
                if (result.statusCode === 200) {
                    await this.persistentCache?.set(cacheKey, result, url, this.extractETag(result));
                } else if (result.statusCode === 304) {
                    // Not modified - this should only happen when we have a persistentEntry
                    // but TypeScript doesn't know that, so let's check again
                    const currentEntry = await this.persistentCache?.get(cacheKey);
                    if (currentEntry) {
                        log.debug(`Got 304 Not Modified for ${url}, updating cache timestamp`);
                        await this.persistentCache?.set(cacheKey, currentEntry.data, url, currentEntry.etag);
                        return currentEntry.data;
                    }
                } else if (result.statusCode >= 500) {
                    // Server error - remove from memory cache
                    this.requestCache.delete(cacheKey);
                }
                return result;
            })
            .catch(error => {
                this.requestCache.delete(cacheKey);
                throw error;
            });
    }

    /**
     * Make HTTP request with ETag support
     */
    private static async _makeHttpRequestWithETag(url: string, accessToken?: string, etag?: string): Promise<{ body: string, statusCode: number, etag?: string }> {
        return new Promise<{ body: string, statusCode: number, etag?: string }>((resolve, reject) => {
            const urlObj = new URL(url);
            const headers: Record<string, string> = {
                'Accept': 'application/json',
                'User-Agent': 'DotNet-Extension-VSCode/1.0'
            };

            if (accessToken && accessToken !== 'credential-provider-managed') {
                headers['Authorization'] = `Bearer ${accessToken}`;
            }

            // Add If-None-Match header if we have an ETag
            if (etag) {
                headers['If-None-Match'] = etag;
            }

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || 443,
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
                headers,
            };

            const req = https.request(options, (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => data += chunk);
                res.on('end', () => {
                    const responseETag = res.headers['etag'];
                    resolve({
                        statusCode: res.statusCode,
                        body: data,
                        etag: responseETag
                    });
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
     * Legacy method for background refresh (without ETag)
     */
    private static async _makeHttpRequest(url: string, accessToken?: string): Promise<{ body: string, statusCode: number }> {
        const result = await this._makeHttpRequestWithETag(url, accessToken);
        return { body: result.body, statusCode: result.statusCode };
    }

    private static extractETag(result: { body: string, statusCode: number, etag?: string }): string | undefined {
        return (result as any).etag;
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
        return semver.compare(a, b);
    }

    /**
     * Parse package details from registration data
     */
    private static parsePackageDetails(packageData: any, packageUrl: string): NuGetPackage | null {
        try {
            if (!packageData) {
                return null;
            }

            const items = packageData.items || [];
            if (items.length === 0) {
                return null;
            }

            // Flatten nested structure (items[].items[].catalogEntry)
            const flatEntries = items.flatMap((i: any) =>
                Array.isArray(i.items) ? i.items : [i]
            );

            // Extract all catalog entries
            const catalogEntries = flatEntries
                .map((i: { catalogEntry: any }) => i.catalogEntry)
                .filter(Boolean);

            if (catalogEntries.length === 0) {
                return null;
            }

            // Filter for relevant types
            const validEntries = catalogEntries.filter((e: any) => {
                const types = Array.isArray(e["@type"])
                    ? e["@type"]
                    : typeof e["@type"] === "string"
                        ? [e["@type"]]
                        : [];
                return types.some(t => t.includes("PackageDetails") || t.includes("Package"));
            });

            if (validEntries.length === 0) {
                return null;
            }

            // Pick the highest version (using semver if available)
            const latestEntry = validEntries.reduce((best: any, current: any) => {
                const vBest = best?.version ?? "0.0.0";
                const vCur = current.version ?? "0.0.0";
                try {
                    return semver.gt(vCur, vBest) ? current : best;
                } catch {
                    // fallback if version not semver-parsable
                    return vCur > vBest ? current : best;
                }
            }, validEntries[0]);

            const entry = latestEntry;

            // Normalize authors
            const authors =
                typeof entry.authors === "string"
                    ? entry.authors.split(",").map((a: string) => a.trim())
                    : Array.isArray(entry.authors)
                        ? entry.authors
                        : [];

            // Normalize tags
            const tags =
                Array.isArray(entry.tags)
                    ? entry.tags
                    : typeof entry.tags === "string"
                        ? entry.tags.split(/\s+/).filter(Boolean)
                        : [];

            return {
                id: entry.id ?? "",
                version: entry.version ?? "",
                description: entry.description ?? "",
                authors,
                projectUrl: entry.projectUrl ?? "",
                licenseUrl: entry.licenseUrl ?? "",
                iconUrl: entry.iconUrl ?? "",
                tags,
                totalDownloads: 0, // still not exposed by registration API
                allVersions: this.extractVersions(packageData)
            };
        } catch (error) {
            log.error(`Error parsing package details: ${packageUrl}`, error, packageData);
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