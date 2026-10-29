import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../../core/logger';
import { ConcurrencyLimit, SingleFlight } from '../../shared/singleFlight';
import { FRAMEWORK_ITEM_TYPE, ITEM_TYPES, ProjectItems, crossTargetingFramework, parseMsbuildItems } from './projectItems';
import { PACKAGE_ITEM_TYPES, PACKAGE_PROPERTIES, ProjectPackages, packagesEqual, parseMsbuildPackages } from '../../nuget/centralPackages';

const execFileAsync = promisify(execFile);
const log = logger('ProjectItems');

export type RunMsbuild = (projectPath: string) => Promise<string>;

/**
 * Starts `dotnet msbuild` (twice for a multi-targeted project: the items exist per target framework). The same run
 * answers what the project contains and its packages (Central Package Management), so a project is evaluated once.
 */
export const runMsbuild: RunMsbuild = async projectPath => {
    const run = async (...extra: string[]) => (await execFileAsync('dotnet',
        ['msbuild', projectPath, '-nologo', `-getItem:${[...ITEM_TYPES, ...PACKAGE_ITEM_TYPES, FRAMEWORK_ITEM_TYPE].join(',')}`,
            `-getProperty:${['TargetFramework', 'TargetFrameworks', ...PACKAGE_PROPERTIES].join(',')}`, ...extra],
        { cwd: path.dirname(projectPath), timeout: 120000, maxBuffer: 64 * 1024 * 1024 })).stdout;
    const stdout = await run();
    // A multi-targeted project has its items only per target framework
    const framework = crossTargetingFramework(stdout);
    return framework ? run(`-p:TargetFramework=${framework}`) : stdout;
};

/**
 * After a failed evaluation (a timeout, a half-saved project file) the next attempts wait this long: the project
 * retries by itself after each delay, and after the last one only when the next evaluation is asked for (a folder
 * of it is expanded, the project or a props file changes).
 */
export const RETRY_DELAYS_MS: readonly number[] = [5_000, 30_000, 120_000];

/** What one MSBuild run gave: undefined parts were not in the output (or MSBuild failed) */
interface Evaluation {
    readonly items?: ProjectItems;
    readonly packages?: ProjectPackages;
    /** When the run started (ms since the epoch) */
    readonly startedAt: number;
}

/**
 * What each project contains according to MSBuild (globs, `Remove`, `DefaultItemExcludes`, `Link`, props files).
 * Evaluating starts a process, so results are cached until the project file or a props file changes. After a
 * change the last result stays available (stale-while-revalidate) until the new evaluation lands, so the tree
 * does not fall back to the plain disk listing meanwhile.
 *
 * At most one MSBuild runs per project: changes while it runs make it run once more when it ends (however many
 * changes came), and only that run's result is published. Across projects at most `maxConcurrent` run at once.
 */
export class ProjectItemsService {
    static readonly instance = new ProjectItemsService();

    // null: MSBuild failed and there was no earlier result
    private readonly cache = new Map<string, ProjectItems | null>();
    // Projects whose cached result is outdated: still returned by `get`, but `evaluate` runs MSBuild again
    private readonly stale = new Set<string>();
    private readonly versions = new Map<string, number>();
    // When the MSBuild run behind the cached list started (a later run giving the same list moves it on)
    private readonly evaluated = new Map<string, number>();
    private readonly listeners = new Set<(projectPath: string) => void>();
    // The packages of the same evaluation; an evaluation without them keeps the last ones
    private readonly packageCache = new Map<string, ProjectPackages>();
    private readonly packageVersions = new Map<string, number>();
    // Projects whose last evaluation failed: how often in a row, and from when on `evaluate` runs MSBuild again
    private readonly failures = new Map<string, { readonly count: number; readonly retryAt: number }>();
    // Opening a solution evaluates every project: start at most `maxConcurrent` processes at once
    private readonly flights: SingleFlight<ProjectItems | undefined>;

    constructor(
        private readonly run: RunMsbuild = runMsbuild,
        maxConcurrent = Math.max(2, Math.floor(os.cpus().length / 2)),
        private readonly now: () => number = Date.now,
    ) {
        this.flights = new SingleFlight(new ConcurrencyLimit(maxConcurrent));
    }

    /** The cached result (possibly outdated while a new evaluation runs), without starting an evaluation */
    get(projectPath: string): ProjectItems | undefined {
        return this.cache.get(projectPath) ?? undefined;
    }

    /** Changes whenever the result `get` returns changes, to tell whether a tree needs redrawing */
    version(projectPath: string): number {
        return this.versions.get(projectPath) ?? 0;
    }

    /**
     * When the MSBuild run behind the cached list started (ms since the epoch): a file created later may be missing
     * from the list. Undefined while there is no list.
     */
    evaluatedAt(projectPath: string): number | undefined {
        return this.evaluated.get(projectPath);
    }

    /** The packages of the last evaluation (possibly outdated while a new one runs), without starting one */
    packages(projectPath: string): ProjectPackages | undefined {
        return this.packageCache.get(projectPath);
    }

    /** Changes whenever the result `packages` returns changes */
    packagesVersion(projectPath: string): number {
        return this.packageVersions.get(projectPath) ?? 0;
    }

    /** The packages, after the evaluation running (or started now) for the project */
    async evaluatePackages(projectPath: string): Promise<ProjectPackages | undefined> {
        await this.evaluate(projectPath);
        return this.packages(projectPath);
    }

    /** Whether the last evaluation failed and its retry delay has passed: the next `evaluate` runs MSBuild again */
    retryDue(projectPath: string): boolean {
        const failure = this.failures.get(projectPath);
        return !!failure && this.now() >= failure.retryAt;
    }

    /**
     * How long until the project should retry its failed evaluation by itself (ms, at least 0); undefined when the
     * last evaluation did not fail, or after the last of `RETRY_DELAYS_MS`
     */
    retryDelay(projectPath: string): number | undefined {
        const failure = this.failures.get(projectPath);
        if (!failure || failure.count > RETRY_DELAYS_MS.length) {
            return undefined;
        }
        return Math.max(0, failure.retryAt - this.now());
    }

    /** The cached result, or the result of the evaluation running (or started now) for the project */
    evaluate(projectPath: string): Promise<ProjectItems | undefined> {
        if (this.cache.has(projectPath) && !this.stale.has(projectPath) && !this.retryDue(projectPath)) {
            return Promise.resolve(this.get(projectPath));
        }
        return this.flights.run(projectPath, () => this.evaluateNow(projectPath), evaluation => this.publish(projectPath, evaluation));
    }

    private async evaluateNow(projectPath: string): Promise<Evaluation> {
        const startedAt = this.now();
        try {
            const output = await this.run(projectPath);
            const items = parseMsbuildItems(output, path.dirname(projectPath));
            if (!items) {
                log.warn(`MSBuild gave no item list for ${projectPath}`);
            }
            return { items, packages: parseMsbuildPackages(output, projectPath), startedAt };
        } catch (error) {
            log.warn(`Could not evaluate the items of ${projectPath}:`, error);
            return { startedAt };
        }
    }

    private publish(projectPath: string, { items, packages, startedAt }: Evaluation): ProjectItems | undefined {
        this.stale.delete(projectPath);
        if (items) {
            this.failures.delete(projectPath);
        } else {
            const count = (this.failures.get(projectPath)?.count ?? 0) + 1;
            const delay = RETRY_DELAYS_MS[Math.min(count, RETRY_DELAYS_MS.length) - 1];
            this.failures.set(projectPath, { count, retryAt: this.now() + delay });
        }
        const previousPackages = this.packageCache.get(projectPath);
        if (packages && (!previousPackages || !packagesEqual(previousPackages, packages))) {
            this.packageCache.set(projectPath, packages);
            this.packageVersions.set(projectPath, this.packagesVersion(projectPath) + 1);
        }
        const previous = this.get(projectPath);
        if (items) {
            this.evaluated.set(projectPath, startedAt);
            if (!previous || !previous.equals(items)) {
                this.cache.set(projectPath, items);
                this.versions.set(projectPath, this.version(projectPath) + 1);
            }
        } else if (previous) {
            log.warn(`Keeping the previous item list of ${projectPath}`);
        } else {
            this.cache.set(projectPath, null);
        }
        for (const listener of [...this.listeners]) {
            try {
                listener(projectPath);
            } catch (error) {
                log.warn(`A listener failed after evaluating ${projectPath}:`, error);
            }
        }
        return this.get(projectPath);
    }

    /** The project changed: the next `evaluate` runs MSBuild again; an evaluation still running runs once more */
    invalidate(projectPath: string): void {
        this.stale.add(projectPath);
        this.flights.markDirty(projectPath);
    }

    onDidEvaluate(listener: (projectPath: string) => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
    }
}
