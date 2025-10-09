import { logger } from './logger';

const log = logger('BackgroundRefreshQueue');
interface RefreshTask {
    readonly url: string;
    readonly accessToken?: string;
}

type TimeoutID = ReturnType<typeof setTimeout>; // number
const DELAY = 60_000; // 5 second delay between refreshes

export class BackgroundRefreshQueue {
    private readonly tasks = new Map<string, RefreshTask>(); // Simple list of things to refresh
    private readonly pending = new Map<string, TimeoutID>();
    private isRunning = false; // Is the run loop currently active?

    constructor(private readonly refreshFunction?: (url: string, accessToken?: string) => Promise<any>) {
    }

    /**
     * Add a URL to refresh. If already in list, do nothing.
     */
    enqueue(url: string, accessToken?: string): void {
        log.debug(`Request to enqueue background refresh for: ${url}`);
        const key = `${url}|${accessToken || ''}`;
        if (this.pending.has(key)) {
            // Already pending, reset the timer
            clearTimeout(this.pending.get(key)!);
            log.debug(`Resetting pending refresh timer for: ${url}`);
        }

        // If already in the list, do nothing
        if (this.tasks.has(key)) {
            log.debug(`URL already queued for refresh: ${url}`);
            return;
        }

        // Set a new timer to actually add to the queue after a delay
        const invalidate = setTimeout(() => {
            this.pending.delete(key);
            // If already in the list, do nothing
            if (this.tasks.has(key)) {
                log.debug(`URL already queued for refresh: ${url}`);
                return;
            }

            log.info(`Enqueuing background refresh for: ${url}`);
            // Add to list
            this.tasks.set(key, {
                url,
                accessToken
            });

            log.debug(`Added to refresh queue: ${url} (queue size: ${this.tasks.size})`);

            // If no run loop is active, start one
            if (!this.isRunning) {
                this.startRunLoop();
            }
        }, DELAY);
        this.pending.set(key, invalidate);
    }

    /**
     * Start the main run loop to process all tasks
     */
    private async startRunLoop(): Promise<void> {
        if (this.isRunning) {
            return; // Already running
        }

        this.isRunning = true;
        log.debug('Starting background refresh run loop');

        try {
            // Process all tasks
            while (this.tasks.size > 0) {
                await this.processNextTask();
            }
        } catch (error) {
            log.error('Error in background refresh run loop:', error);
        } finally {
            this.isRunning = false;
            log.debug('Background refresh run loop finished');
        }
    }

    /**
     * Process the next task in the queue
     */
    private async processNextTask(): Promise<void> {
        if (this.tasks.size === 0) {
            return;
        }

        // Get next task (simple FIFO, could add priority sorting later if needed)
        const entry = this.tasks.entries().next();
        if (entry.done || !entry.value) {
            return; // No more entries
        }

        const [key, task] = entry.value;
        this.tasks.delete(key);

        log.error(`Processing background refresh for: ${task.url}`);

        try {
            // Perform the actual refresh
            await this.refreshUrl(task.url, task.accessToken);
            log.debug(`Successfully refreshed: ${task.url}`);
        } catch (error) {
            log.warn(`Failed to refresh ${task.url}:`, error);
        }
    }

    /**
     * Actually perform the refresh for a URL
     */
    private async refreshUrl(url: string, accessToken?: string): Promise<void> {
        if (!this.refreshFunction) {
            log.warn('No refresh function set, skipping refresh');
            return;
        }

        try {
            await this.refreshFunction(url, accessToken);
        } catch (error) {
            log.warn(`Refresh function failed for ${url}:`, error);
            throw error;
        }
    }

    /**
     * Simple delay utility
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}