/**
 * Shared static request queue that limits the number of parallel async operations
 * Usage: const result = await RequestQueue.next(() => myAsyncCall());
 */
export class RequestQueue {
    private readonly maxConcurrent: number;
    private currentlyRunning: number = 0;
    private queue: Array<{
        task: () => Promise<any>;
        resolve: (value: any) => void;
        reject: (error: any) => void;
    }> = [];

    constructor(maxConcurrent: number = 10) {
        this.maxConcurrent = maxConcurrent;
    }

    /**
     * Add a request to the queue and execute when slot becomes available
     * @param task The async function to execute
     * @returns Promise that resolves with the task result
     */
    public next<T>(task: () => Promise<T>): Promise<T> {
        return this.enqueue(task);
    }

    /**
     * Clear all pending requests in the queue
     */
    public clear(): void {
        this.queue.forEach(item => {
            item.reject(new Error('Request queue cleared'));
        });
        this.queue = [];
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