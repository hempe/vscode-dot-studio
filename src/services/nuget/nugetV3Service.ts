import { logger } from '../../core/logger';
import { NuGetPackage, PackageDependency, PackageSearchOptions, PackageSource, upgradeNuGetOrgUrl } from './types';
import { VersionUtils } from '../shared/versionUtils';
import { pickRegistrationUrl } from './httpBody';
import { httpGet } from './httpGet';
import { PersistentCache } from '../../core/persistentCache';
import { BackgroundRefreshQueue } from '../../core/backgroundRefreshQueue';
import * as path from 'path';
import * as os from 'os';
import { reportRejectedCredentials } from './feedAuth';
import { NuGetCredentialManager } from './nugetCredentialManager';

import { errorReason } from '../../core/errorReason';

const log = logger('NuGetV3Service');

/** The dependencies of a registration catalog entry, every target framework's group in turn */
function dependenciesOf(entry: { dependencyGroups?: { dependencies?: { id?: string; range?: string }[] }[] }): PackageDependency[] {
    return (entry.dependencyGroups ?? []).flatMap(group => (group.dependencies ?? [])
        .filter(dependency => dependency.id)
        .map(dependency => ({ id: dependency.id!, range: dependency.range ?? '' })));
}

/**
 * Service for interacting with NuGet V3 API feeds
 * Handles modern NuGet feeds including nuget.org and Azure DevOps Artifacts
 */
export class NuGetV3Service {
    // In-memory cache (existing)
    private static requestCache: Map<string, { timestamp: number, promise: Promise<{ body: string, statusCode: number }> }> = new Map();

    /** Counts the times the caches were cleared: an answer to a request from before must not be stored after it */
    private static cacheGeneration = 0;

    // Persistent cache
    private static persistentCache: PersistentCache<{ body: string, statusCode: number }> | null = null;

    // Background refresh queue
    private static refreshQueue = new BackgroundRefreshQueue(async (url: string, accessToken?: string) => {
        const generation = this.cacheGeneration;
        const data = await this._makeHttpRequest(url, accessToken);
        // Only a good answer replaces the cached one, and not one that was asked for before the caches were cleared
        if (data && data.statusCode === 200 && generation === this.cacheGeneration) {
            // Update both caches, under the key the readers use (with the token: a private feed's entry is keyed by it)
            const cacheKey = this.getCacheKey(url, accessToken);
            this.requestCache.set(cacheKey, {
                timestamp: Date.now(),
                promise: Promise.resolve(data)
            });
            await this.persistentCache?.set(cacheKey, data, url);

            // Notify UI (simplified, no rate limiting needed since queue handles timing)
            this.notifyUI(url);
        }
        return data;
    });

    // UI notification callbacks
    private static uiNotificationCallbacks: Array<(url: string) => void> = [];

    /**
     * Initialize the caching system
     */
    static initializeCache(storagePath?: string): void {
        if (this.persistentCache) return; // Already initialized

        // The extension's own storage folder (activate passes it); the shared temp folder only when nothing was passed
        // (tests): the cache holds responses of private feeds and must not be readable or writable by other users
        const cacheDir = storagePath
            ? path.join(storagePath, 'nuget-requests')
            : path.join(os.tmpdir(), `vscode-dotnet-extension-${os.userInfo().username}`, 'cache', 'nuget-requests');

        this.persistentCache = new PersistentCache(cacheDir, {
            maxAge: 24 * 60 * 60 * 1000, // older entries are never used; entries older than 5 minutes are refreshed in the background
            maxEntries: 5000
        });

        log.debug(`Initialized caching system with directory: ${cacheDir}`);
    }

    /** Drops every cached response (memory and disk), so the next requests ask the feeds again (the refresh button) */
    static async clearCaches(): Promise<void> {
        this.cacheGeneration++;
        this.requestCache.clear();
        await this.persistentCache?.clear();
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
            log.debug(`Searching NuGet V3 feed: ${sourceUrl}`);

            // Get service index to find search endpoint
            const serviceIndex = await this.fetchServiceIndex(sourceUrl, accessToken);
            const searchServiceUrl = this.findSearchService(serviceIndex);

            if (!searchServiceUrl) {
                log.warn('No search service found in V3 service index');
                return [];
            }

            // Build search URL with parameters
            const searchUrl = this.buildSearchUrl(searchServiceUrl, options);
            log.debug(`V3 API search URL: ${searchUrl}`);

            // Make authenticated request
            const response = await this.makeRequest(searchUrl, accessToken);
            if (response.statusCode !== 200) {
                throw new Error(`Search request failed with status code: ${response.statusCode}`);
            }

            const searchResults = JSON.parse(response.body);

            const packages = this.parseSearchResults(searchResults);
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
        packageId: string,
        packageSource: PackageSource[],
    ): Promise<NuGetPackage | null> {
        const now = Date.now();
        const cacheKey = `${packageId}`;
        const cached = this.packageCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < 10 * 60 * 1000) { // 10 minutes cache
            log.debug(`Using cached package details for ${packageId}`);
            return cached.request;
        }

        const request = this._getPackageDetails(packageId, packageSource);
        try {
            this.packageCache.set(cacheKey, { timestamp: now, request });
            return await request;

        } catch (error) {
            // Every source failed: the one line that says so
            log.warn(error instanceof Error ? error.message : `Error getting V3 package details for ${packageId}: ${String(error)}`);
            this.packageCache.delete(cacheKey);
            return null;
        }
    }

    private static async _getPackageDetails(
        packageId: string,
        packageSources: PackageSource[],
    ): Promise<NuGetPackage | null> {

        // What each source answered: one line when none of them had the package, not one per source (a private feed saying 404
        // for a public package is the normal case, a source that cannot be reached is not)
        const outcomes: string[] = [];
        for (const packageSource of packageSources) {
            // A folder of packages has no registration service: skipping it saves three tries and their waits
            if (!packageSource.enabled || packageSource.isLocal) continue;
            const accessToken = await NuGetCredentialManager.getSourceToken(packageSource);
            let outcome = 'no answer';

            for (let i = 0; i < 3; i++) {
                try {
                    const sourceUrl = upgradeNuGetOrgUrl(packageSource.url);
                    const serviceIndex = await this.fetchServiceIndex(sourceUrl, accessToken);
                    const registrationUrl = this.findRegistrationService(serviceIndex);

                    if (!registrationUrl) {
                        log.warn('No registration service found in V3 service index');
                        return null;
                    }

                    const packageUrl = `${registrationUrl}${packageId.toLowerCase()}/index.json`;
                    const response = await this.makeRequest(packageUrl, accessToken);

                    if (response.statusCode >= 500 || !response.statusCode) {
                        outcome = `status ${response.statusCode}`;
                        log.debug(`Package details for ${packageId} from ${packageSource.name}: ${outcome}, trying again`);
                        await new Promise(r => setTimeout(r, 100));
                        continue;
                    }

                    if (response.statusCode !== 200) {
                        outcome = response.statusCode === 404 ? 'not found' : `status ${response.statusCode}`;
                        break;
                    }

                    const packageData = JSON.parse(response.body);

                    if (!packageData.items || packageData.items.length === 0) {
                        return null;
                    }

                    // 🧮 Find the page with the highest `upper` version
                    const pages: any[] = packageData.items.filter((i: any) => i['@id'] && i.upper);
                    if (pages.length === 0) {
                        return null;
                    }

                    // Newest pages first (VersionUtils.compare sorts descending)
                    const latestPages = pages.sort((a: any, b: any) => VersionUtils.compare(a.upper, b.upper)).slice(0, 2);

                    const allItems: any[] = [];
                    for (const latestPage of latestPages) {

                        if (Array.isArray(latestPage.items) && latestPage.items.length > 0) {
                            allItems.push(...latestPage.items);
                        } else if (latestPage['@id']) {
                            // 🔗 Fetch only the latest page
                            const subResponse = await this.makeRequest(latestPage['@id'], accessToken);
                            if (subResponse.statusCode === 200) {
                                const subData = JSON.parse(subResponse.body);
                                allItems.push(...(subData.items || []));
                            } else {
                                log.warn(`Failed to fetch latest page ${latestPage['@id']}, status ${subResponse.statusCode}`);
                            }
                        }
                    }
                    if (allItems.length === 0) {
                        return null;
                    }

                    const details = this.parsePackageDetails(allItems, packageUrl);
                    return details && { ...details, sourceName: packageSource.name };

                } catch (error) {
                    outcome = errorReason(error);
                    log.debug(`Package details for ${packageId} from ${packageSource.name} failed (${outcome}), trying again`);
                    await new Promise(res => setTimeout(res, 1000 * (i + 1))); // Exponential backoff
                }
            }
            outcomes.push(`${packageSource.name}: ${outcome}`);
        }

        throw new Error(`No package details for ${packageId} (${outcomes.join('; ') || 'no source to ask'})`);
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

        log.debug(`Fetching V3 service index from: ${sourceUrl}`);

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
            return pickRegistrationUrl(serviceIndex.resources || []);
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
        // Also the packages with SemVer 2.0.0 versions (dotted prerelease labels, build metadata)
        url.searchParams.set('semVerLevel', '2.0.0');

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

        // Note: The simplified background queue doesn't need activity marking

        const cacheKey = this.getCacheKey(url, accessToken);
        const allowedCacheTime = 5 * 60 * 1000; // 5 minutes for fresh cache

        // 1. Check in-memory cache first
        const memoryCache = this.requestCache.get(cacheKey);
        // A 404 (the feed does not have the package) is an answer like any other: updating several projects does not ask again
        if (memoryCache && (Date.now() - memoryCache.timestamp) < allowedCacheTime) {
            log.debug(`Using fresh in-memory cache for ${url}`);
            return memoryCache.promise;
        }

        // Callers that ask for the same URL within moments share one lookup and one request: the entry is stored
        // before anything is awaited, not after the disk cache answered (two callers would both find nothing)
        const entry: { timestamp: number; promise: Promise<{ body: string, statusCode: number }> } = { timestamp: Date.now(), promise: undefined as never };
        entry.promise = this.loadRequest(url, accessToken, cacheKey, entry);
        this.requestCache.set(cacheKey, entry);
        return entry.promise;
    }

    /** Answers a request from the disk cache (refreshing a stale entry in the background) or from the feed */
    private static async loadRequest(url: string, accessToken: string | undefined, cacheKey: string,
        entry: { timestamp: number; promise: Promise<{ body: string, statusCode: number }> }): Promise<{ body: string, statusCode: number }> {
        const allowedCacheTime = 5 * 60 * 1000;

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
                log.debug(`Using stale persistent cache for ${url}, queuing background refresh`);
                try {
                    this.refreshQueue?.enqueue(url, accessToken); // Background refresh
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
        log.debug(`Making fresh request to ${url}`);
        const generation = this.cacheGeneration;
        const promise = this._makeHttpRequestWithETag(url, accessToken);

        // Forgets this request's entry, not that of a newer request for the same URL made after the caches were cleared
        const forget = () => { if (this.requestCache.get(cacheKey) === entry) { this.requestCache.delete(cacheKey); } };

        return promise
            .then(async (result) => {
                // Cache the result if successful
                if (generation !== this.cacheGeneration) {
                    // The caches were cleared (Refresh) while this was on its way: the caller gets the answer, nothing keeps it
                    return result;
                }
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
                    forget();
                } else if (result.statusCode === 401 || result.statusCode === 403) {
                    // Expired or missing token: explain what to do, and don't remember the answer
                    forget();
                    void reportRejectedCredentials(url, result.statusCode);
                }
                return result;
            })
            .catch(error => {
                forget();
                throw error;
            });
    }

    /**
     * Make HTTP request with ETag support
     */
    private static async _makeHttpRequestWithETag(url: string, accessToken?: string, etag?: string): Promise<{ body: string, statusCode: number, etag?: string }> {
        return new Promise<{ body: string, statusCode: number, etag?: string }>((resolve, reject) => {
            const headers: Record<string, string> = {
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip',
                'User-Agent': 'DotNet-Extension-VSCode/1.0'
            };

            if (accessToken) {
                // As NuGet sends stored credentials: Basic with base64(Username:ClearTextPassword)
                headers['Authorization'] = `Basic ${accessToken}`;
            }

            // Add If-None-Match header if we have an ETag
            if (etag) {
                headers['If-None-Match'] = etag;
            }

            httpGet(url, { headers }).then(resolve, reject);
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
        return result.etag;
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
                    currentVersion: displayVersion,
                    description: item.description || '',
                    authors: item.authors || [],
                    projectUrl: item.projectUrl,
                    licenseUrl: item.licenseUrl,
                    iconUrl: item.iconUrl,
                    tags: item.tags || [],
                    totalDownloads: item.totalDownloads || 0,
                    versions: allVersions
                });
            }

            return packages;

        } catch (error) {
            log.error('Error parsing V3 search results:', error);
            return [];
        }
    }

    /**
     * Parse package details from registration data
     */
    private static parsePackageDetails(flatEntries: any[], packageUrl: string): NuGetPackage | null {
        try {

            if (flatEntries.length === 0) {
                return null;
            }

            // Extract all catalog entries
            const catalogEntries = flatEntries
                .map((i: { catalogEntry: any }) => i.catalogEntry)
                .filter(Boolean);

            if (catalogEntries.length === 0) {
                return null;
            }

            // Filter for relevant types
            const validEntries: any[] = catalogEntries.filter((e: any) => {
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

            // Newest first
            const sorted = validEntries.sort((a: any, b: any) => {
                try {
                    return VersionUtils.compare(a?.version ?? "0.0.0", b?.version ?? "0.0.0");
                } catch {
                    return 0;
                }
            });

            // Pick the highest version (using version utilities)
            const entry = sorted.slice()[0];

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
                currentVersion: entry.version ?? "",
                description: entry.description ?? "",
                authors,
                projectUrl: entry.projectUrl ?? "",
                licenseUrl: entry.licenseUrl ?? "",
                iconUrl: entry.iconUrl ?? "",
                source: entry.source,
                tags,
                totalDownloads: 0, // still not exposed by registration API
                versions: sorted.filter(x => x.version).map(x => x.version),
                dependencies: Object.fromEntries(sorted.filter(x => x.version).map(x => [x.version, dependenciesOf(x)])),
            };
        } catch (error) {
            log.error(`Error parsing package details: ${packageUrl}`, error, flatEntries);
            return null;
        }
    }
}