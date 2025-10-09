import { RequestQueue } from './requestQueue';
import { logger } from './logger';

const log = logger('RequestQueueExample');

/**
 * Example usage of the RequestQueue utility
 */

// Example 1: Basic usage with default settings (max 10 concurrent)
export async function basicExample() {
    const requestQueue = new RequestQueue(10);

    // Simulate an API call
    const result = await requestQueue.next(async () => {
        const response = await fetch('https://api.example.com/data');
        return response.json();
    });
    log.debug('API result:', result);
}

// Example 2: Configure max concurrent requests
export async function configuredExample() {
    // Create queue with max 5 concurrent requests
    const limitedQueue = new RequestQueue(5);

    // Now all requests will be limited to 5 parallel
    const results = await Promise.all([
        limitedQueue.next(() => simulateApiCall('request1')),
        limitedQueue.next(() => simulateApiCall('request2')),
        limitedQueue.next(() => simulateApiCall('request3')),
        // ... even if you have 20 requests, only 5 will run in parallel
    ]);

    log.debug('All results:', results);
}

// Example 3: Monitor queue by tracking promises
export async function monitoringExample() {
    const requestQueue = new RequestQueue(5);

    // Queue up multiple requests
    const promises = Array.from({ length: 20 }, (_, i) =>
        requestQueue.next(() => simulateApiCall(`request-${i}`))
    );

    // Monitor progress (simplified since no stats available)
    const interval = setInterval(() => {
        log.debug('Processing requests...');
    }, 1000);

    await Promise.all(promises);
    clearInterval(interval);
    log.debug('All requests completed!');
}

// Example 4: Error handling
export async function errorHandlingExample() {
    const requestQueue = new RequestQueue(3);

    try {
        await requestQueue.next(async () => {
            // This will throw an error
            throw new Error('API call failed');
        });
    } catch (error) {
        log.error('Request failed:', error instanceof Error ? error.message : String(error));
    }
}

// Example 5: Real-world usage - batch file processing
export async function batchFileProcessing(filePaths: string[]) {
    const fileQueue = new RequestQueue(3); // Limit to 3 concurrent file operations

    const results = await Promise.all(
        filePaths.map(filePath =>
            fileQueue.next(async () => {
                // Simulate file processing
                log.debug(`Processing file: ${filePath}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                return `Processed: ${filePath}`;
            })
        )
    );

    return results;
}

// Helper function to simulate async calls
async function simulateApiCall(id: string): Promise<string> {
    const delay = Math.random() * 2000 + 500; // 500-2500ms
    await new Promise(resolve => setTimeout(resolve, delay));
    return `Result for ${id}`;
}

// Example 6: Clear queue if needed
export async function clearQueueExample() {
    const requestQueue = new RequestQueue(5);

    // Queue up some requests
    const promises = Array.from({ length: 10 }, (_, i) =>
        requestQueue.next(() => simulateApiCall(`request-${i}`))
    );

    // Clear the queue after 2 seconds
    setTimeout(() => {
        log.debug('Clearing queue...');
        requestQueue.clear();
    }, 2000);

    try {
        await Promise.all(promises);
    } catch (error) {
        log.debug('Some requests were cancelled:', error instanceof Error ? error.message : String(error));
    }
}