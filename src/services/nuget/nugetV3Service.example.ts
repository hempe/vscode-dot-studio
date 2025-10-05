import { NuGetV3Service } from './nugetV3Service';
import { logger } from '../../core/logger';

const log = logger('NuGetV3ServiceExample');

/**
 * Example usage of the enhanced NuGetV3Service with persistent caching
 */

// Initialize the caching system (typically done at extension startup)
export function initializeCaching(extensionPath?: string): void {
    NuGetV3Service.initializeCache(extensionPath);

    // Register for cache update notifications
    NuGetV3Service.onCacheUpdate((url) => {
        log.debug(`Cache updated for URL: ${url}`);
        // Here you could notify the UI to refresh data
        // For example: webview.postMessage({ type: 'cache-updated', url });
    });

    log.info('NuGet caching system initialized');
}

// Example of how the caching system works:
export async function exampleUsage(): Promise<void> {
    const sourceUrl = 'https://api.nuget.org/v3/index.json';
    const packageId = 'Newtonsoft.Json';

    // First request - fresh from server, cached persistently
    log.info('Making first request...');
    const result1 = await NuGetV3Service.getPackageDetails(sourceUrl, packageId);
    log.debug('First request result:', !!result1);

    // Second request immediately - from in-memory cache
    log.info('Making second request...');
    const result2 = await NuGetV3Service.getPackageDetails(sourceUrl, packageId);
    log.debug('Second request result:', !!result2);

    // Simulate waiting for cache to become stale
    // In real usage, this would happen naturally over time
    log.info('In real usage, stale cache would return immediately and queue background refresh');

    // The caching system automatically:
    // 1. Returns cached data immediately if fresh (< 5 minutes)
    // 2. Returns stale cached data (> 5 minutes) and queues background refresh
    // 3. Uses ETags for efficient conditional requests (304 Not Modified)
    // 4. Notifies UI when background refresh completes
}

// Example of cache statistics and management
export async function cacheManagement(): Promise<void> {
    // You can get statistics about the background refresh queue
    // (This would be exposed through a method if needed)
    log.info('Cache management features available for monitoring and debugging');
}