import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../core/logger';
import { ConcurrencyLimit, SingleFlight } from '../singleFlight';
import { ITEM_TYPES, ProjectItems, crossTargetingFramework, parseMsbuildItems } from './projectItems';

const execFileAsync = promisify(execFile);
const log = logger('ProjectItems');

export type RunMsbuild = (projectPath: string) => Promise<string>;

/** Starts `dotnet msbuild` (twice for a multi-targeted project: the items exist per target framework) */
export const runMsbuild: RunMsbuild = async projectPath => {
    const run = async (...extra: string[]) => (await execFileAsync('dotnet',
        ['msbuild', projectPath, '-nologo', `-getItem:${ITEM_TYPES.join(',')}`, '-getProperty:TargetFramework,TargetFrameworks', ...extra],
        { cwd: path.dirname(projectPath), timeout: 120000, maxBuffer: 64 * 1024 * 1024 })).stdout;
    const stdout = await run();
    // A multi-targeted project has its items only per target framework
    const framework = crossTargetingFramework(stdout);
    return framework ? run(`-p:TargetFramework=${framework}`) : stdout;
};

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

    // null: MSBuild failed and there was no earlier result; not retried before `invalidate`
    private readonly cache = new Map<string, ProjectItems | null>();
    // Projects whose cached result is outdated: still returned by `get`, but `evaluate` runs MSBuild again
    private readonly stale = new Set<string>();
    private readonly versions = new Map<string, number>();
    // When the MSBuild run behind the cached list started (a later run giving the same list moves it on)
    private readonly evaluated = new Map<string, number>();
    private readonly listeners = new Set<(projectPath: string) => void>();
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

    /** The cached result, or the result of the evaluation running (or started now) for the project */
    evaluate(projectPath: string): Promise<ProjectItems | undefined> {
        if (this.cache.has(projectPath) && !this.stale.has(projectPath)) {
            return Promise.resolve(this.get(projectPath));
        }
        return this.flights.run(projectPath, () => this.evaluateNow(projectPath), items => this.publish(projectPath, items));
    }

    private async evaluateNow(projectPath: string): Promise<{ items: ProjectItems | undefined; startedAt: number }> {
        const startedAt = this.now();
        try {
            const items = parseMsbuildItems(await this.run(projectPath), path.dirname(projectPath));
            if (!items) {
                log.warn(`MSBuild gave no item list for ${projectPath}`);
            }
            return { items, startedAt };
        } catch (error) {
            log.warn(`Could not evaluate the items of ${projectPath}:`, error);
            return { items: undefined, startedAt };
        }
    }

    private publish(projectPath: string, { items, startedAt }: { items: ProjectItems | undefined; startedAt: number }): ProjectItems | undefined {
        this.stale.delete(projectPath);
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
