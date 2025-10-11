import { logger } from '../core/logger';

const log = logger('DebounceManager');

/**
 * Generic debounce manager that can handle both simple callbacks and queued events
 */
export class DebounceManager<T = void> {
    private _timer?: NodeJS.Timeout;
    private _queue: T[] = [];
    private _isProcessing = false;
    private _callback: (items: T[]) => Promise<void> | void;
    private _debounceMs: number;
    private _deduplicateKey?: (item: T) => string;

    constructor(
        callback: (items: T[]) => Promise<void> | void,
        debounceMs: number = 100,
        options?: {
            deduplicateKey?: (item: T) => string;
        }
    ) {
        this._callback = callback;
        this._debounceMs = debounceMs;
        this._deduplicateKey = options?.deduplicateKey;
    }

    /**
     * Add an item to be processed (or trigger immediate processing for simple callbacks)
     */
    public trigger(item?: T): void {
        // Clear existing timer
        if (this._timer) {
            clearTimeout(this._timer);
        }

        // Add item to queue if provided
        if (item !== undefined) {
            this._addToQueue(item);
        }

        // Set new timer
        this._timer = setTimeout(() => {
            this._process();
        }, this._debounceMs);
    }

    /**
     * Add multiple items at once
     */
    public triggerBatch(items: T[]): void {
        // Clear existing timer
        if (this._timer) {
            clearTimeout(this._timer);
        }

        // Add all items to queue
        items.forEach(item => this._addToQueue(item));

        // Set new timer
        this._timer = setTimeout(() => {
            this._process();
        }, this._debounceMs);
    }

    /**
     * Process immediately without debouncing
     */
    public async processImmediately(): Promise<void> {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = undefined;
        }
        await this._process();
    }

    /**
     * Clear any pending processing
     */
    public cancel(): void {
        if (this._timer) {
            clearTimeout(this._timer);
            this._timer = undefined;
        }
        this._queue = [];
    }

    /**
     * Get current queue length
     */
    public get queueLength(): number {
        return this._queue.length;
    }

    /**
     * Check if currently processing
     */
    public get isProcessing(): boolean {
        return this._isProcessing;
    }

    /**
     * Dispose and cleanup
     */
    public dispose(): void {
        this.cancel();
    }

    private _addToQueue(item: T): void {
        if (this._deduplicateKey) {
            // Remove any existing items with the same key
            const key = this._deduplicateKey(item);
            this._queue = this._queue.filter(existing => this._deduplicateKey!(existing) !== key);
        }

        this._queue.push(item);
    }

    private async _process(): Promise<void> {
        if (this._isProcessing) {
            log.debug('Already processing, skipping');
            return;
        }

        this._isProcessing = true;
        this._timer = undefined;

        try {
            const itemsToProcess = [...this._queue];
            this._queue = [];

            if (itemsToProcess.length > 0) {
                log.debug(`Processing ${itemsToProcess.length} debounced items`);
                await this._callback(itemsToProcess);
            } else {
                // For simple callbacks without items
                await this._callback([]);
            }
        } catch (error) {
            log.error('Error processing debounced items:', error);
        } finally {
            this._isProcessing = false;
        }
    }
}

/**
 * Simple debounce manager for callbacks without queuing
 */
export class SimpleDebounceManager {
    private _debouncer: DebounceManager<void>;

    constructor(callback: () => Promise<void> | void, debounceMs: number = 100) {
        this._debouncer = new DebounceManager(async () => {
            await callback();
        }, debounceMs);
    }

    /**
     * Trigger the debounced callback
     */
    public trigger(): void {
        this._debouncer.trigger();
    }

    /**
     * Process immediately without debouncing
     */
    public async processImmediately(): Promise<void> {
        await this._debouncer.processImmediately();
    }

    /**
     * Cancel any pending processing
     */
    public cancel(): void {
        this._debouncer.cancel();
    }

    /**
     * Check if currently processing
     */
    public get isProcessing(): boolean {
        return this._debouncer.isProcessing;
    }

    /**
     * Dispose and cleanup
     */
    public dispose(): void {
        this._debouncer.dispose();
    }
}