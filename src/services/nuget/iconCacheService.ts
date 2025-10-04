import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../../core/logger';

/**
 * Service for caching package icons locally to bypass CSP restrictions
 * Downloads icons from NuGet.org flat container API and serves them from extension storage
 */
export class IconCacheService {
    private static readonly logger = logger('IconCacheService');
    private static cacheDir: string;
    private static readonly CACHE_VERSION = '1';
    private static readonly MAX_CACHE_SIZE_MB = 50; // Maximum cache size in MB
    private static readonly CACHE_DURATION_DAYS = 7; // Cache icons for 7 days
    private static readonly failedPackages = new Set<string>(); // Track packages without icons

    /**
     * Initialize the icon cache service
     */
    static async initialize(extensionContext: vscode.ExtensionContext): Promise<void> {
        this.cacheDir = path.join(extensionContext.globalStorageUri.fsPath, 'icon-cache', this.CACHE_VERSION);

        // Ensure cache directory exists
        await this.ensureCacheDirectory();

        // Clean up old cached icons
        await this.cleanupOldIcons();

        this.logger.info(`Icon cache initialized at: ${this.cacheDir}`);
    }

    /**
     * Get local path for a package icon, downloading if necessary
     */
    static async getIconPath(packageId: string, version: string, webview: vscode.Webview): Promise<string | null> {
        try {
            const packageKey = packageId.toLowerCase();

            // Check if this package is known to not have an icon
            if (this.failedPackages.has(packageKey)) {
                this.logger.info(`Skipping known failed package: ${packageId}`);
                return null;
            }

            const iconFileName = this.generateIconFileName(packageId, version);
            const localIconPath = path.join(this.cacheDir, iconFileName);

            // Check if icon already exists locally
            if (await this.fileExists(localIconPath)) {
                // Check if cached icon is still fresh
                if (await this.isCachedIconFresh(localIconPath)) {
                    return this.getWebviewIconUri(localIconPath, webview);
                }
            }

            // Download icon from NuGet.org flat container API
            const iconUrl = `https://api.nuget.org/v3-flatcontainer/${packageKey}/${version}/icon`;
            const downloaded = await this.downloadIcon(iconUrl, localIconPath);

            if (downloaded) {
                return this.getWebviewIconUri(localIconPath, webview);
            } else {
                // Mark this package as having no icon to avoid future requests
                this.failedPackages.add(packageKey);
                this.logger.info(`Marked package as having no icon: ${packageId}`);
            }

            return null;
        } catch (error) {
            this.logger.error(`Error getting icon for ${packageId}@${version}:`, error);
            return null;
        }
    }

    /**
     * Generate a safe filename for an icon (only package ID, no version)
     */
    private static generateIconFileName(packageId: string, version: string): string {
        // Create a safe filename by replacing invalid characters
        // Only use package ID since we only keep the latest version
        const safePackageId = packageId.toLowerCase().replace(/[^a-z0-9.-]/g, '_');
        return `${safePackageId}.png`;
    }

    /**
     * Download an icon from the given URL and save it locally
     */
    private static async downloadIcon(iconUrl: string, localPath: string): Promise<boolean> {
        try {
            this.logger.info(`Downloading icon from: ${iconUrl}`);

            const https = require('https');

            return new Promise<boolean>((resolve) => {
                const request = https.get(iconUrl, (response: any) => {
                    if (response.statusCode === 200) {
                        const fileStream = fs.createWriteStream(localPath);
                        response.pipe(fileStream);

                        fileStream.on('finish', () => {
                            fileStream.close();
                            this.logger.info(`Icon downloaded successfully: ${localPath}`);
                            resolve(true);
                        });

                        fileStream.on('error', (error: Error) => {
                            this.logger.error(`Error writing icon file:`, error);
                            // Clean up partial file
                            this.deleteFile(localPath);
                            resolve(false);
                        });
                    } else {
                        this.logger.warn(`Icon download failed with status ${response.statusCode}: ${iconUrl}`);
                        resolve(false);
                    }
                });

                request.on('error', (error: Error) => {
                    this.logger.error(`Error downloading icon:`, error);
                    resolve(false);
                });

                // Set timeout
                request.setTimeout(10000, () => {
                    request.destroy();
                    this.logger.error(`Icon download timeout: ${iconUrl}`);
                    resolve(false);
                });
            });
        } catch (error) {
            this.logger.error(`Error in downloadIcon:`, error);
            return false;
        }
    }

    /**
     * Convert local file path to webview URI
     */
    private static getWebviewIconUri(localPath: string, webview: vscode.Webview): string {
        const iconUri = vscode.Uri.file(localPath);
        return webview.asWebviewUri(iconUri).toString();
    }

    /**
     * Check if a cached icon is still fresh (within cache duration)
     */
    private static async isCachedIconFresh(filePath: string): Promise<boolean> {
        try {
            const stats = await fs.promises.stat(filePath);
            const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
            return ageInDays <= this.CACHE_DURATION_DAYS;
        } catch {
            return false;
        }
    }

    /**
     * Ensure cache directory exists
     */
    private static async ensureCacheDirectory(): Promise<void> {
        try {
            await fs.promises.mkdir(this.cacheDir, { recursive: true });
        } catch (error) {
            this.logger.error('Error creating cache directory:', error);
            throw error;
        }
    }

    /**
     * Check if file exists
     */
    private static async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.promises.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Delete a file safely
     */
    private static async deleteFile(filePath: string): Promise<void> {
        try {
            await fs.promises.unlink(filePath);
        } catch {
            // Ignore errors when deleting
        }
    }

    /**
     * Clean up old cached icons to prevent unlimited cache growth
     */
    private static async cleanupOldIcons(): Promise<void> {
        try {
            if (!await this.fileExists(this.cacheDir)) {
                return;
            }

            const files = await fs.promises.readdir(this.cacheDir);
            const cacheInfo: Array<{ path: string; mtime: Date; size: number }> = [];

            // Get file stats
            for (const file of files) {
                const filePath = path.join(this.cacheDir, file);
                try {
                    const stats = await fs.promises.stat(filePath);
                    cacheInfo.push({
                        path: filePath,
                        mtime: stats.mtime,
                        size: stats.size
                    });
                } catch {
                    // Skip files we can't read
                }
            }

            // Calculate total cache size
            const totalSizeBytes = cacheInfo.reduce((sum, info) => sum + info.size, 0);
            const totalSizeMB = totalSizeBytes / (1024 * 1024);

            this.logger.info(`Cache size: ${totalSizeMB.toFixed(2)} MB (${cacheInfo.length} files)`);

            // Remove old files if cache is too large
            if (totalSizeMB > this.MAX_CACHE_SIZE_MB) {
                // Sort by modification time (oldest first)
                cacheInfo.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

                let currentSizeMB = totalSizeMB;
                let deletedCount = 0;

                for (const info of cacheInfo) {
                    if (currentSizeMB <= this.MAX_CACHE_SIZE_MB * 0.8) { // Keep 80% of max size
                        break;
                    }

                    await this.deleteFile(info.path);
                    currentSizeMB -= info.size / (1024 * 1024);
                    deletedCount++;
                }

                this.logger.info(`Cleaned up ${deletedCount} old cached icons`);
            }

            // Remove files older than cache duration
            const now = Date.now();
            let expiredCount = 0;

            for (const info of cacheInfo) {
                const ageInDays = (now - info.mtime.getTime()) / (1000 * 60 * 60 * 24);
                if (ageInDays > this.CACHE_DURATION_DAYS) {
                    await this.deleteFile(info.path);
                    expiredCount++;
                }
            }

            if (expiredCount > 0) {
                this.logger.info(`Removed ${expiredCount} expired cached icons`);
            }
        } catch (error) {
            this.logger.error('Error cleaning up cache:', error);
        }
    }

    /**
     * Clear all cached icons
     */
    static async clearCache(): Promise<void> {
        try {
            if (await this.fileExists(this.cacheDir)) {
                const files = await fs.promises.readdir(this.cacheDir);
                for (const file of files) {
                    await this.deleteFile(path.join(this.cacheDir, file));
                }
                this.logger.info('Icon cache cleared');
            }
        } catch (error) {
            this.logger.error('Error clearing cache:', error);
        }
    }

    /**
     * Get cache statistics
     */
    static async getCacheStats(): Promise<{ fileCount: number; sizeMB: number }> {
        try {
            if (!await this.fileExists(this.cacheDir)) {
                return { fileCount: 0, sizeMB: 0 };
            }

            const files = await fs.promises.readdir(this.cacheDir);
            let totalSize = 0;

            for (const file of files) {
                try {
                    const stats = await fs.promises.stat(path.join(this.cacheDir, file));
                    totalSize += stats.size;
                } catch {
                    // Skip files we can't read
                }
            }

            return {
                fileCount: files.length,
                sizeMB: totalSize / (1024 * 1024)
            };
        } catch {
            return { fileCount: 0, sizeMB: 0 };
        }
    }
}