/** At most `max` jobs at once; the others wait in order. Shared by everything that starts MSBuild for many projects. */
export class ConcurrencyLimit {
    private running = 0;
    private readonly waiting: (() => void)[] = [];

    constructor(readonly max: number) { }

    async acquire(): Promise<void> {
        if (this.running >= this.max) {
            // The finishing job hands its slot over, so `running` stays counted
            await new Promise<void>(resolve => this.waiting.push(resolve));
        } else {
            this.running++;
        }
    }

    release(): void {
        const next = this.waiting.shift();
        if (next) {
            next();
        } else {
            this.running--;
        }
    }

    async use<T>(job: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await job();
        } finally {
            this.release();
        }
    }
}

interface Flight<T> {
    dirty: boolean;
    promise: Promise<T>;
}

/**
 * Runs at most one job per key at a time. Whoever asks while a job of the key runs gets that job's promise. When
 * the key is marked dirty while its job runs (what the job read has changed), the job's result is thrown away and
 * the job runs exactly once more when it ends, however many marks came: one or a hundred changes during a run give
 * two runs in total, and every caller gets the result of the last one.
 */
export class SingleFlight<T = unknown> {
    private readonly flights = new Map<string, Flight<T>>();

    constructor(private readonly limit?: ConcurrencyLimit) { }

    isRunning(key: string): boolean {
        return this.flights.has(key);
    }

    /** The running job outdated: run it once more when it ends. Nothing runs: nothing to do. */
    markDirty(key: string): void {
        const flight = this.flights.get(key);
        if (flight) {
            flight.dirty = true;
        }
    }

    /**
     * Joins the job of the key, or starts `job`. `complete` gets the result of the run nobody marked dirty, once,
     * after the key is free again (so it may start the next flight); its return value is what the callers get.
     * A rejecting run rejects the callers, unless the key was marked dirty during it (then it runs again).
     */
    run<R>(key: string, job: () => Promise<R>, complete: (result: R) => T): Promise<T> {
        const running = this.flights.get(key);
        if (running) {
            return running.promise;
        }
        const flight: Flight<T> = { dirty: false, promise: undefined as unknown as Promise<T> };
        flight.promise = this.fly(key, flight, job, complete);
        this.flights.set(key, flight);
        return flight.promise;
    }

    private async fly<R>(key: string, flight: Flight<T>, job: () => Promise<R>, complete: (result: R) => T): Promise<T> {
        // Lets `run` register the flight before the loop can end and remove it
        await Promise.resolve();
        for (; ;) {
            let outcome: { value: R } | { error: unknown };
            if (this.limit) {
                await this.limit.acquire();
            }
            // Marks while waiting for a slot are covered by this run: it has not read anything yet
            flight.dirty = false;
            try {
                outcome = { value: await job() };
            } catch (error) {
                outcome = { error };
            } finally {
                this.limit?.release();
            }
            if (flight.dirty) {
                continue;
            }
            this.flights.delete(key);
            if ('error' in outcome) {
                throw outcome.error;
            }
            return complete(outcome.value);
        }
    }
}
