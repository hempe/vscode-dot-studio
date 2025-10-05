import { RequestQueue } from './requestQueue';

/**
 * Example usage of the RequestQueue utility
 */

// Example 1: Basic usage with default settings (max 10 concurrent)
async function basicExample() {
    // Simulate an API call
    const result = await RequestQueue.next(async () => {
        const response = await fetch('https://api.example.com/data');
        return response.json();
    });
    console.log(result);
}

// Example 2: Configure max concurrent requests
async function configuredExample() {
    // Set max concurrent requests to 5
    RequestQueue.configure(5);

    // Now all requests will be limited to 5 parallel
    const results = await Promise.all([
        RequestQueue.next(() => simulateApiCall('request1')),
        RequestQueue.next(() => simulateApiCall('request2')),
        RequestQueue.next(() => simulateApiCall('request3')),
        // ... even if you have 20 requests, only 5 will run in parallel
    ]);

    console.log(results);
}

// Example 3: Monitor queue statistics
async function monitoringExample() {
    // Check current state
    const stats = RequestQueue.getStats();
    console.log(`Running: ${stats.running}, Queued: ${stats.queued}, Max: ${stats.maxConcurrent}`);

    // Queue up multiple requests
    const promises = Array.from({ length: 20 }, (_, i) =>
        RequestQueue.next(() => simulateApiCall(`request-${i}`))
    );

    // Monitor progress
    const interval = setInterval(() => {
        const currentStats = RequestQueue.getStats();
        console.log(`Progress - Running: ${currentStats.running}, Queued: ${currentStats.queued}`);

        if (currentStats.running === 0 && currentStats.queued === 0) {
            clearInterval(interval);
            console.log('All requests completed!');
        }
    }, 1000);

    await Promise.all(promises);
}

// Example 4: Error handling
async function errorHandlingExample() {
    try {
        const result = await RequestQueue.next(async () => {
            // This will throw an error
            throw new Error('API call failed');
        });
    } catch (error) {
        console.error('Request failed:', error.message);
    }
}

// Example 5: Real-world usage - batch file processing
async function batchFileProcessing(filePaths: string[]) {
    RequestQueue.configure(3); // Limit to 3 concurrent file operations

    const results = await Promise.all(
        filePaths.map(filePath =>
            RequestQueue.next(async () => {
                // Simulate file processing
                console.log(`Processing file: ${filePath}`);
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
async function clearQueueExample() {
    // Queue up some requests
    const promises = Array.from({ length: 10 }, (_, i) =>
        RequestQueue.next(() => simulateApiCall(`request-${i}`))
    );

    // Clear the queue after 2 seconds
    setTimeout(() => {
        console.log('Clearing queue...');
        RequestQueue.clear();
    }, 2000);

    try {
        await Promise.all(promises);
    } catch (error) {
        console.log('Some requests were cancelled:', error.message);
    }
}