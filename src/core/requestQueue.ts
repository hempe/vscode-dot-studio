/**
 * Shared static request queue that limits the number of parallel async operations
 * Usage: const result = await RequestQueue.next(() => myAsyncCall());
 */
export class RequestQueue {
    private static instance: RequestQueue;
    private readonly maxConcurrent: number;
    private currentlyRunning: number = 0;
    private queue: Array<{
        task: () => Promise<any>;
        resolve: (value: any) => void;
        reject: (error: any) => void;
    }> = [];

    private constructor(maxConcurrent: number = 10) {
        this.maxConcurrent = maxConcurrent;
    }

    /**
     * Get the singleton instance of the request queue
     */
    public static getInstance(maxConcurrent: number = 10): RequestQueue {
        if (!RequestQueue.instance) {
            RequestQueue.instance = new RequestQueue(maxConcurrent);
        }
        return RequestQueue.instance;
    }

    /**
     * Add a request to the queue and execute when slot becomes available
     * @param task The async function to execute
     * @returns Promise that resolves with the task result
     */
    public static next<T>(task: () => Promise<T>): Promise<T> {
        const instance = RequestQueue.getInstance();
        return instance.enqueue(task);
    }

    /**
     * Configure the maximum number of concurrent requests
     * @param maxConcurrent Maximum parallel requests (default: 10)
     */
    public static configure(maxConcurrent: number): void {
        const instance = RequestQueue.getInstance(maxConcurrent);
        (instance as any).maxConcurrent = maxConcurrent;
    }

    /**
     * Get current queue statistics
     */
    public static getStats(): { running: number; queued: number; maxConcurrent: number } {
        const instance = RequestQueue.getInstance();
        return {
            running: instance.currentlyRunning,
            queued: instance.queue.length,
            maxConcurrent: instance.maxConcurrent
        };
    }

    /**
     * Clear all pending requests in the queue
     */
    public static clear(): void {
        const instance = RequestQueue.getInstance();
        instance.queue.forEach(item => {
            item.reject(new Error('Request queue cleared'));
        });
        instance.queue = [];
    }

    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            this.processQueue();
        });
    }

    private async processQueue(): Promise<void> {
        if (this.currentlyRunning >= this.maxConcurrent || this.queue.length === 0) {
            return;
        }

        const item = this.queue.shift();
        if (!item) {
            return;
        }

        this.currentlyRunning++;

        try {
            const result = await item.task();
            item.resolve(result);
        } catch (error) {
            item.reject(error);
        } finally {
            this.currentlyRunning--;
            // Process next item in queue
            setImmediate(() => this.processQueue());
        }
    }
}