import { logger } from '../../core/logger';
import { NuGetPackage } from './types';
import { PackageBrowseService } from './packageBrowseService';
import { RequestQueue } from '../../core/requestQueue';

const log = logger('PackageSharedService');

/**
 * Shared service for common NuGet package operations across all package services
 * Provides utilities used by packageBrowseService, packageInstalledService, packageUpdateService, etc.
 */
export class PackageSharedService {

    private static readonly queue = new RequestQueue(10);

    /**
     * Enrich packages with metadata using the browse API
     * This method is used by both installed and updatable package services
     */
    static async enrichWithBrowseMetadata<T extends { id: string; latestVersion?: string }>(
        basicPackages: T[]
    ): Promise<(T & Partial<NuGetPackage>)[]> {
        if (basicPackages.length === 0) {
            return [];
        }

        log.info(`Enriching ${basicPackages.length} packages with browse metadata`);

        // Get unique package IDs to avoid duplicate API calls
        const uniquePackageIds = [...new Set(basicPackages.map(pkg => pkg.id))];
        const metadataMap = new Map<string, NuGetPackage>();

        // Fetch metadata for each unique package using the same service as browse
        await Promise.all(uniquePackageIds.map(packageId => this.queue.next(async () => {
            for (let i = 0; i < 3; i++) { // Retry up to 3 times
                try {
                    const metadata = await PackageBrowseService.getPackageDetails(packageId);
                    if (metadata) {
                        metadataMap.set(packageId.toLowerCase(), metadata);
                        log.debug(`Got metadata for ${packageId}: description=${!!metadata.description}, authors=${metadata.authors?.length || 0}`);
                    } else {
                        log.warn(`No metadata found for ${packageId}`);
                    }
                    return;
                } catch (error) {
                    log.warn(`Failed to get metadata for ${packageId}:`, error);
                    await new Promise(res => setTimeout(res, 500 * (i + 1))); // Exponential backoff
                    continue; // Retry
                }
            }
        })));

        // Merge basic package data with metadata
        return basicPackages.map(pkg => {
            const metadata = metadataMap.get(pkg.id.toLowerCase());
            if (metadata) {
                return {
                    ...pkg,
                    description: metadata.description,
                    authors: metadata.authors,
                    iconUrl: metadata.iconUrl,
                    projectUrl: metadata.projectUrl,
                    licenseUrl: metadata.licenseUrl,
                    tags: metadata.tags,
                    totalDownloads: metadata.totalDownloads,
                    // Use metadata latestVersion as the authoritative source for the latest available version
                    latestVersion: metadata.latestVersion,
                    allVersions: metadata.allVersions,
                    source: metadata.source
                };
            }
            return pkg;
        });
    }
}