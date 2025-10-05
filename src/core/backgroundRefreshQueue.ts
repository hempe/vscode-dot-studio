import { logger } from './logger';
import { RequestQueue } from './requestQueue';

const log = logger('BackgroundRefreshQueue');

export interface RefreshTask {
    url: string;
    accessToken?: string;
    priority: 'high' | 'normal' | 'low';
    addedAt: number;
    retryCount: number;
}

export interface RefreshQueueOptions {
    idleDelayMs?: number; // Time to wait before starting background processing
    maxConcurrent?: number; // Max concurrent background requests
    maxRetries?: number; // Max retry attempts
    onRefreshComplete?: (url: string, success: boolean, data?: any) => void;
}

/**
 * Background refresh queue for stale cache entries
 * Processes refresh tasks when the system is idle
 */
export class BackgroundRefreshQueue {
    private queue: Map<string, RefreshTask> = new Map();
    private isProcessing = false;
    private lastActivity = Date.now();
    private processingTimer?: NodeJS.Timeout;
    private options: Required<RefreshQueueOptions>;
    private activeRequests = 0;
    private requestQueue: RequestQueue;

    constructor(options: RefreshQueueOptions = {}) {
        this.options = {
            idleDelayMs: options.idleDelayMs || 3000, // 3 seconds idle
            maxConcurrent: options.maxConcurrent || 3,
            maxRetries: options.maxRetries || 2,
            onRefreshComplete: options.onRefreshComplete || (() => {})
        };
        this.requestQueue = new RequestQueue(this.options.maxConcurrent);
    }

    /**
     * Add a URL to the refresh queue
     */
    enqueue(url: string, accessToken?: string, priority: 'high' | 'normal' | 'low' = 'normal'): void {
        const key = `${url}|${accessToken || ''}`;

        // If already queued, update priority if higher
        const existing = this.queue.get(key);
        if (existing) {
            if (this.getPriorityValue(priority) > this.getPriorityValue(existing.priority)) {
                existing.priority = priority;
                log.debug(`Updated priority for ${url} to ${priority}`);
            }
            return;
        }

        const task: RefreshTask = {
            url,
            accessToken,
            priority,
            addedAt: Date.now(),
            retryCount: 0
        };

        this.queue.set(key, task);
        log.debug(`Queued ${url} for background refresh (priority: ${priority})`);

        // Schedule processing if not already scheduled
        this.scheduleProcessing();
    }

    /**
     * Mark activity to delay background processing
     */
    markActivity(): void {
        this.lastActivity = Date.now();

        // If we're processing, pause it
        if (this.isProcessing && this.activeRequests === 0) {
            log.debug('Activity detected, pausing background refresh');
            this.isProcessing = false;
        }

        this.scheduleProcessing();
    }

    /**
     * Get queue statistics
     */
    getStats(): { queueSize: number; processing: boolean; activeRequests: number } {
        return {
            queueSize: this.queue.size,
            processing: this.isProcessing,
            activeRequests: this.activeRequests
        };
    }

    /**
     * Clear the queue
     */
    clear(): void {
        this.queue.clear();
        this.requestQueue.clear();
        this.isProcessing = false;
        this.activeRequests = 0;
        if (this.processingTimer) {
            clearTimeout(this.processingTimer);
            this.processingTimer = undefined;
        }
        log.info('Background refresh queue cleared');
    }

    /**
     * Force process the queue immediately (for testing)
     */
    forceProcess(): void {
        this.processQueue();
    }

    private scheduleProcessing(): void {
        if (this.processingTimer) {
            clearTimeout(this.processingTimer);
        }

        const timeSinceActivity = Date.now() - this.lastActivity;
        const delay = Math.max(0, this.options.idleDelayMs - timeSinceActivity);

        this.processingTimer = setTimeout(() => {
            if (Date.now() - this.lastActivity >= this.options.idleDelayMs) {
                this.processQueue();
            } else {
                // Re-schedule if activity happened recently
                this.scheduleProcessing();
            }
        }, delay);
    }

    private async processQueue(): Promise<void> {
        if (this.isProcessing || this.queue.size === 0) {
            return;
        }

        this.isProcessing = true;
        log.info(`Starting background refresh processing (${this.queue.size} tasks)`);

        try {
            // Sort tasks by priority and age
            const sortedTasks = Array.from(this.queue.values()).sort((a, b) => {
                const priorityDiff = this.getPriorityValue(b.priority) - this.getPriorityValue(a.priority);
                if (priorityDiff !== 0) return priorityDiff;
                return a.addedAt - b.addedAt; // Older tasks first within same priority
            });

            // Process tasks in batches
            const tasks = sortedTasks.slice(0, this.options.maxConcurrent);
            const promises = tasks.map(task => this.processTask(task));

            await Promise.allSettled(promises);

            // Continue processing if there are more tasks and we're still idle
            if (this.queue.size > 0 && Date.now() - this.lastActivity >= this.options.idleDelayMs) {
                // Small delay before next batch
                setTimeout(() => this.processQueue(), 100);
            } else {
                this.isProcessing = false;
                if (this.queue.size > 0) {
                    this.scheduleProcessing();
                }
            }

        } catch (error) {
            log.error('Error in background refresh processing:', error);
            this.isProcessing = false;
        }
    }

    private async processTask(task: RefreshTask): Promise<void> {
        const key = `${task.url}|${task.accessToken || ''}`;

        try {
            this.activeRequests++;
            log.debug(`Refreshing ${task.url} (attempt ${task.retryCount + 1})`);

            // Use RequestQueue to respect the global request limit
            const result = await this.requestQueue.next(async () => {
                return this.makeRefreshRequest(task.url, task.accessToken);
            });

            // Remove from queue on success
            this.queue.delete(key);
            this.options.onRefreshComplete(task.url, true, result);
            log.debug(`Successfully refreshed ${task.url}`);

        } catch (error) {
            log.warn(`Failed to refresh ${task.url}:`, error);

            task.retryCount++;
            if (task.retryCount >= this.options.maxRetries) {
                this.queue.delete(key);
                this.options.onRefreshComplete(task.url, false);
                log.warn(`Giving up on ${task.url} after ${task.retryCount} attempts`);
            }
        } finally {
            this.activeRequests--;
        }
    }

    private async makeRefreshRequest(url: string, accessToken?: string): Promise<any> {
        // This is a placeholder - the actual implementation will be injected
        // when we integrate with the NuGetV3Service
        throw new Error('makeRefreshRequest not implemented - should be injected');
    }

    private getPriorityValue(priority: 'high' | 'normal' | 'low'): number {
        switch (priority) {
            case 'high': return 3;
            case 'normal': return 2;
            case 'low': return 1;
            default: return 2;
        }
    }

    /**
     * Set the refresh request function (dependency injection)
     */
    setRefreshFunction(fn: (url: string, accessToken?: string) => Promise<any>): void {
        this.makeRefreshRequest = fn;
    }
}