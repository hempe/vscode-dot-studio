import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../core/logger';
import { ITEM_TYPES, ProjectItems, parseMsbuildItems } from './projectItems';

const execFileAsync = promisify(execFile);
const log = logger('ProjectItems');

export type RunMsbuild = (projectPath: string) => Promise<string>;

const runMsbuild: RunMsbuild = async projectPath => {
    const { stdout } = await execFileAsync('dotnet', ['msbuild', projectPath, '-nologo', `-getItem:${ITEM_TYPES.join(',')}`],
        { cwd: path.dirname(projectPath), timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
};

/**
 * What each project contains according to MSBuild (globs, `Remove`, `DefaultItemExcludes`, `Link`, props files).
 * Evaluating starts a process, so results are cached until the project file or a props file changes.
 */
export class ProjectItemsService {
    static readonly instance = new ProjectItemsService();

    // null: MSBuild failed; not retried before `invalidate`
    private readonly cache = new Map<string, ProjectItems | null>();
    private readonly pending = new Map<string, Promise<ProjectItems | undefined>>();
    private readonly generation = new Map<string, number>();
    private readonly listeners = new Set<(projectPath: string) => void>();

    constructor(private readonly run: RunMsbuild = runMsbuild) { }

    /** The cached result, without starting an evaluation */
    get(projectPath: string): ProjectItems | undefined {
        return this.cache.get(projectPath) ?? undefined;
    }

    async evaluate(projectPath: string): Promise<ProjectItems | undefined> {
        if (this.cache.has(projectPath)) {
            return this.cache.get(projectPath) ?? undefined;
        }
        const running = this.pending.get(projectPath);
        if (running) {
            return running;
        }
        const generation = this.generation.get(projectPath) ?? 0;
        const promise = this.evaluateNow(projectPath, generation);
        this.pending.set(projectPath, promise);
        try {
            return await promise;
        } finally {
            if (this.pending.get(projectPath) === promise) {
                this.pending.delete(projectPath);
            }
        }
    }

    private async evaluateNow(projectPath: string, generation: number): Promise<ProjectItems | undefined> {
        let items: ProjectItems | undefined;
        try {
            items = parseMsbuildItems(await this.run(projectPath), path.dirname(projectPath));
            if (!items) {
                log.warn(`MSBuild gave no item list for ${projectPath}`);
            }
        } catch (error) {
            log.warn(`Could not evaluate the items of ${projectPath}:`, error);
        }
        if ((this.generation.get(projectPath) ?? 0) === generation) {
            this.cache.set(projectPath, items ?? null);
            for (const listener of [...this.listeners]) {
                try {
                    listener(projectPath);
                } catch (error) {
                    log.warn(`A listener failed after evaluating ${projectPath}:`, error);
                }
            }
        }
        return items;
    }

    /** The project changed: forget the result, and ignore an evaluation that is still running */
    invalidate(projectPath: string): void {
        this.generation.set(projectPath, (this.generation.get(projectPath) ?? 0) + 1);
        this.cache.delete(projectPath);
        this.pending.delete(projectPath);
    }

    onDidEvaluate(listener: (projectPath: string) => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
    }
}
