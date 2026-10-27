import { BackgroundRefreshQueue } from '../../../core/backgroundRefreshQueue';

describe('BackgroundRefreshQueue', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('refreshes a url once, after the delay, however often it was asked for meanwhile', async () => {
        const refreshed: string[] = [];
        const queue = new BackgroundRefreshQueue(async url => { refreshed.push(url); });

        queue.enqueue('https://feed/a');
        await jest.advanceTimersByTimeAsync(3000);
        queue.enqueue('https://feed/a');
        await jest.advanceTimersByTimeAsync(3000);

        // The second ask did not start the wait over: 6 s in, the 5 s delay of the first one is over
        expect(refreshed).toEqual(['https://feed/a']);
    });

    it('keeps the urls of different tokens apart and refreshes each', async () => {
        const refreshed: (string | undefined)[] = [];
        const queue = new BackgroundRefreshQueue(async (_url, token) => { refreshed.push(token); });
        queue.enqueue('https://feed/a', 'one');
        queue.enqueue('https://feed/a', 'two');
        await jest.advanceTimersByTimeAsync(10000);
        expect(refreshed.sort()).toEqual(['one', 'two']);
    });

    it('can refresh the same url again after it was done', async () => {
        const refreshed: string[] = [];
        const queue = new BackgroundRefreshQueue(async url => { refreshed.push(url); });
        queue.enqueue('https://feed/a');
        await jest.advanceTimersByTimeAsync(6000);
        queue.enqueue('https://feed/a');
        await jest.advanceTimersByTimeAsync(6000);
        expect(refreshed).toEqual(['https://feed/a', 'https://feed/a']);
    });
});
