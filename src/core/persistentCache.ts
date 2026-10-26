import * as crypto from 'crypto';
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
    maxAge?: number; // Entries older than this (milliseconds) are not returned
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

            const entry = await this.readEntry(filePath);
            if (!entry) {
                return null;
            }
            const age = Date.now() - entry.timestamp;
            if (age > this.options.maxAge) {
                log.debug(`Cache entry ${this.id(key)} is ${age}ms old: not used`);
                return null;
            }

            log.debug(`Retrieved cache entry ${this.id(key)}, age: ${age}ms`);
            return entry;

        } catch (error) {
            log.warn(`Failed to read cache entry ${this.id(key)}:`, error);
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
            await fs.promises.writeFile(filePath, JSON.stringify(entry), { encoding: 'utf8', mode: 0o600 });

            log.debug(`Cached entry ${this.id(key)}`);

            // Clean up old entries if we exceed maxEntries
            await this.cleanup();

        } catch (error) {
            log.error(`Failed to write cache entry ${this.id(key)}:`, error);
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
                log.debug(`Deleted cache entry ${this.id(key)}`);
            }
        } catch (error) {
            log.warn(`Failed to delete cache entry ${this.id(key)}:`, error);
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
                fs.mkdirSync(this.cacheDir, { recursive: true, mode: 0o700 });
                log.info(`Created cache directory: ${this.cacheDir}`);
            }
        } catch (error) {
            log.error(`Failed to create cache directory ${this.cacheDir}:`, error);
        }
    }

    /** Short, non-reversible name of a key for log lines (keys can hold feed credentials) */
    private id(key: string): string {
        return this.hash(key).slice(0, 12);
    }

    private hash(key: string): string {
        return crypto.createHash('sha256').update(key).digest('hex');
    }

    /** One file per key, named by the hash of the key: no credentials in file names, no collisions, no length limit */
    private getFilePath(key: string): string {
        return path.join(this.cacheDir, `${this.hash(key)}.json`);
    }

    private async readEntry(filePath: string): Promise<CacheEntry<T> | null> {
        const entry = JSON.parse(await fs.promises.readFile(filePath, 'utf8')) as Partial<CacheEntry<T>>;
        // A file that is not an entry (damaged, or put there by someone else) is not trusted
        if (!entry || typeof entry !== 'object' || typeof entry.timestamp !== 'number' || !('data' in entry) || typeof entry.url !== 'string') {
            return null;
        }
        return entry as CacheEntry<T>;
    }

    private async cleanup(): Promise<void> {
        try {
            const files = (await fs.promises.readdir(this.cacheDir)).filter(file => file.endsWith('.json'));
            if (files.length <= this.options.maxEntries) {
                return;
            }

            const entries = await Promise.all(files.map(async file => {
                const entry = await this.readEntry(path.join(this.cacheDir, file)).catch(() => null);
                return { file, timestamp: entry?.timestamp ?? 0 };
            }));

            // Oldest first (damaged files too), delete the excess
            entries.sort((a, b) => a.timestamp - b.timestamp);
            const toDelete = entries.slice(0, entries.length - this.options.maxEntries);
            await Promise.all(toDelete.map(({ file }) => fs.promises.unlink(path.join(this.cacheDir, file)).catch(() => undefined)));

            if (toDelete.length > 0) {
                log.info(`Cleaned up ${toDelete.length} old cache entries`);
            }

        } catch (error) {
            log.error('Failed to cleanup cache:', error);
        }
    }
}
