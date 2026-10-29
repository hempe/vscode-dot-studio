import { ConcurrencyLimit, SingleFlight } from '../../../../services/shared/singleFlight';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

/** A job whose runs finish when the test says so */
const controlledJob = () => {
    const finishers: ((value: string) => void)[] = [];
    const failers: ((error: Error) => void)[] = [];
    let running = 0;
    let most = 0;
    let calls = 0;
    const job = () => new Promise<string>((resolve, reject) => {
        calls++;
        running++;
        most = Math.max(most, running);
        finishers.push(value => { running--; resolve(value); });
        failers.push(error => { running--; reject(error); });
    });
    return {
        job,
        finish: (value: string) => { failers.shift(); finishers.shift()!(value); },
        fail: (error: Error) => { finishers.shift(); failers.shift()!(error); },
        get calls() { return calls; },
        get most() { return most; },
    };
};

describe('SingleFlight', () => {
    test('callers while a run is in progress share it', async () => {
        const flight = new SingleFlight();
        const runner = controlledJob();
        const done = jest.fn((value: string) => value.toUpperCase());
        const first = flight.run('a', runner.job, done);
        const second = flight.run('a', runner.job, done);
        await settle();
        runner.finish('one');
        expect(await first).toBe('ONE');
        expect(await second).toBe('ONE');
        expect(runner.calls).toBe(1);
        expect(done).toHaveBeenCalledTimes(1);
        expect(flight.isRunning('a')).toBe(false);
    });

    test('100 requests during a run give exactly one re-run, and every caller gets its result', async () => {
        const flight = new SingleFlight();
        const runner = controlledJob();
        const done = jest.fn((value: string) => value);
        const first = flight.run('a', runner.job, done);
        await settle();
        const later = Array.from({ length: 100 }, () => {
            flight.markDirty('a');
            return flight.run('a', runner.job, done);
        });
        runner.finish('stale');
        await settle();
        expect(runner.calls).toBe(2);
        runner.finish('fresh');
        expect(await first).toBe('fresh');
        expect(new Set(await Promise.all(later))).toEqual(new Set(['fresh']));
        expect(runner.calls).toBe(2);
        expect(runner.most).toBe(1);
        // The stale result is never completed (published)
        expect(done.mock.calls).toEqual([['fresh']]);
    });

    test('marking dirty while nothing runs does nothing', async () => {
        const flight = new SingleFlight();
        flight.markDirty('a');
        const runner = controlledJob();
        const result = flight.run('a', runner.job, value => value);
        await settle();
        runner.finish('x');
        expect(await result).toBe('x');
        expect(runner.calls).toBe(1);
    });

    test('a request after a run ended starts a new run', async () => {
        const flight = new SingleFlight();
        const runner = controlledJob();
        const first = flight.run('a', runner.job, value => value);
        await settle();
        runner.finish('1');
        await first;
        const second = flight.run('a', runner.job, value => value);
        await settle();
        runner.finish('2');
        expect(await second).toBe('2');
        expect(runner.calls).toBe(2);
    });

    test('a failing run rejects every caller; a dirty mark during it still gives its re-run', async () => {
        const flight = new SingleFlight();
        const runner = controlledJob();
        const failing = flight.run('a', runner.job, value => value);
        await settle();
        runner.fail(new Error('broken'));
        await expect(failing).rejects.toThrow('broken');

        const retried = flight.run('a', runner.job, value => value);
        await settle();
        flight.markDirty('a');
        runner.fail(new Error('half saved'));
        await settle();
        expect(runner.calls).toBe(3);
        runner.finish('fixed');
        expect(await retried).toBe('fixed');
    });

    test('marks while waiting for a slot do not add a run: the run has not read anything yet', async () => {
        const limit = new ConcurrencyLimit(1);
        const flight = new SingleFlight(limit);
        const runner = controlledJob();
        const a = flight.run('a', runner.job, value => value);
        const b = flight.run('b', runner.job, value => value);
        await settle();
        expect(runner.calls).toBe(1);
        flight.markDirty('b');
        runner.finish('a');
        await a;
        await settle();
        runner.finish('b');
        expect(await b).toBe('b');
        expect(runner.calls).toBe(2);
    });

    test('a complete callback that marks the key dirty again starts a new flight instead of being lost', async () => {
        const flight = new SingleFlight();
        const runner = controlledJob();
        const first = flight.run('a', runner.job, value => {
            flight.markDirty('a');
            return value;
        });
        await settle();
        runner.finish('1');
        expect(await first).toBe('1');
        expect(flight.isRunning('a')).toBe(false);
    });
});

describe('ConcurrencyLimit', () => {
    test('different keys run in parallel up to the limit, and all of them run', async () => {
        const flight = new SingleFlight(new ConcurrencyLimit(3));
        const runner = controlledJob();
        const all = Promise.all(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(key => flight.run(key, runner.job, value => value)));
        await settle();
        expect(runner.calls).toBe(3);
        for (let i = 0; i < 7; i++) {
            runner.finish(String(i));
            await settle();
        }
        await all;
        expect(runner.calls).toBe(7);
        expect(runner.most).toBe(3);
    });

    test('a failing run frees its slot', async () => {
        const flight = new SingleFlight(new ConcurrencyLimit(1));
        await expect(flight.run('a', () => Promise.reject(new Error('no sdk')), value => value)).rejects.toThrow('no sdk');
        expect(await flight.run('b', () => Promise.resolve('ok'), value => value)).toBe('ok');
    });

    test('the slots can be used directly for one-off jobs', async () => {
        const limit = new ConcurrencyLimit(1);
        const order: string[] = [];
        let release!: () => void;
        const first = limit.use(() => new Promise<void>(resolve => { order.push('first'); release = resolve; }));
        const second = limit.use(async () => { order.push('second'); });
        await settle();
        expect(order).toEqual(['first']);
        release();
        await Promise.all([first, second]);
        expect(order).toEqual(['first', 'second']);
    });
});
