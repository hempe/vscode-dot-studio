import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

const log = logger('PersistentCache');

export interface CacheEntry<T> {
    data: T;
    timestamp: number;
    etag?: string;
    url: string;
}

export interface CacheOptions {
    maxAge?: number; // Maximum age in milliseconds before considering stale
    maxEntries?: number; // Maximum number of entries to keep
}

/**
 * Persistent file-based cache for HTTP responses
 * Stores cache entries as JSON files in a cache directory
 */
export class PersistentCache<T> {
    private cacheDir: string;
    private options: Required<CacheOptions>;

    constructor(cacheDir: string, options: CacheOptions = {}) {
        this.cacheDir = cacheDir;
        this.options = {
            maxAge: options.maxAge || 24 * 60 * 60 * 1000, // 24 hours default
            maxEntries: options.maxEntries || 1000
        };

        this.ensureCacheDirectory();
    }

    /**
     * Get cached entry by key
     */
    async get(key: string): Promise<CacheEntry<T> | null> {
        try {
            const filePath = this.getFilePath(key);
            if (!fs.existsSync(filePath)) {
                return null;
            }

            const content = await fs.promises.readFile(filePath, 'utf8');
            const entry: CacheEntry<T> = JSON.parse(content);

            log.debug(`Retrieved cache entry for ${key}, age: ${Date.now() - entry.timestamp}ms`);
            return entry;

        } catch (error) {
            log.warn(`Failed to read cache entry ${key}:`, error);
            return null;
        }
    }

    /**
     * Set cache entry
     */
    async set(key: string, data: T, url: string, etag?: string): Promise<void> {
        try {
            const entry: CacheEntry<T> = {
                data,
                timestamp: Date.now(),
                etag,
                url
            };

            const filePath = this.getFilePath(key);
            await fs.promises.writeFile(filePath, JSON.stringify(entry, null, 2), 'utf8');

            log.debug(`Cached entry for ${key}`);

            // Clean up old entries if we exceed maxEntries
            await this.cleanup();

        } catch (error) {
            log.error(`Failed to write cache entry ${key}:`, error);
        }
    }

    /**
     * Delete cache entry
     */
    async delete(key: string): Promise<void> {
        try {
            const filePath = this.getFilePath(key);
            if (fs.existsSync(filePath)) {
                await fs.promises.unlink(filePath);
                log.debug(`Deleted cache entry ${key}`);
            }
        } catch (error) {
            log.warn(`Failed to delete cache entry ${key}:`, error);
        }
    }

    /**
     * Clear all cache entries
     */
    async clear(): Promise<void> {
        try {
            const files = await fs.promises.readdir(this.cacheDir);
            await Promise.all(
                files
                    .filter(file => file.endsWith('.json'))
                    .map(file => fs.promises.unlink(path.join(this.cacheDir, file)))
            );
            log.info(`Cleared all cache entries from ${this.cacheDir}`);
        } catch (error) {
            log.error('Failed to clear cache:', error);
        }
    }

    /**
     * Get all cache keys
     */
    async getAllKeys(): Promise<string[]> {
        try {
            const files = await fs.promises.readdir(this.cacheDir);
            return files
                .filter(file => file.endsWith('.json'))
                .map(file => file.replace('.json', ''));
        } catch (error) {
            log.error('Failed to get cache keys:', error);
            return [];
        }
    }

    private ensureCacheDirectory(): void {
        try {
            if (!fs.existsSync(this.cacheDir)) {
                fs.mkdirSync(this.cacheDir, { recursive: true });
                log.info(`Created cache directory: ${this.cacheDir}`);
            }
        } catch (error) {
            log.error(`Failed to create cache directory ${this.cacheDir}:`, error);
        }
    }

    private getFilePath(key: string): string {
        // Sanitize key for filename
        const sanitizedKey = key.replace(/[^a-zA-Z0-9-_.]/g, '_');
        return path.join(this.cacheDir, `${sanitizedKey}.json`);
    }

    private async cleanup(): Promise<void> {
        try {
            const keys = await this.getAllKeys();
            if (keys.length <= this.options.maxEntries) {
                return;
            }

            // Get entries with timestamps
            const entries = await Promise.all(
                keys.map(async key => {
                    const entry = await this.get(key);
                    return { key, timestamp: entry?.timestamp || 0 };
                })
            );

            // Sort by timestamp (oldest first) and delete excess entries
            entries.sort((a, b) => a.timestamp - b.timestamp);
            const toDelete = entries.slice(0, entries.length - this.options.maxEntries);

            await Promise.all(toDelete.map(({ key }) => this.delete(key)));

            if (toDelete.length > 0) {
                log.info(`Cleaned up ${toDelete.length} old cache entries`);
            }

        } catch (error) {
            log.error('Failed to cleanup cache:', error);
        }
    }
}