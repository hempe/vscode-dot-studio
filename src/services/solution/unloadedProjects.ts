import type * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { logger } from '../../core/logger';
import { privateTempDir } from '../../core/privateTemp';

const log = logger('UnloadedProjects');

const STATE_KEY = 'shinobi.unloadedProjects';

/** The content of a solution filter (`.slnf`) that loads only `projectPaths` of the solution */
export function solutionFilterContent(solutionPath: string, projectPaths: readonly string[]): string {
    const solutionDir = path.dirname(solutionPath);
    return JSON.stringify({
        solution: {
            path: solutionPath,
            projects: projectPaths.map(project => path.relative(solutionDir, project).split(path.sep).join('/')),
        },
    }, null, 2) + '\n';
}

/**
 * Projects the user unloaded, like Visual Studio's Unload Project: they stay in the tree, greyed out,
 * and solution builds skip them (through a solution filter) until they are reloaded. Remembered per
 * workspace and solution.
 */
export class UnloadedProjects {
    private static state: vscode.Memento | undefined;
    private static readonly listeners = new Set<() => void>();

    /** Fires when a project is unloaded or reloaded */
    static onDidChange(listener: () => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
    }

    static initialize(state: vscode.Memento): void {
        this.state = state;
    }

    private static all(): Record<string, string[]> {
        return this.state?.get<Record<string, string[]>>(STATE_KEY) ?? {};
    }

    static list(solutionPath: string): string[] {
        return this.all()[path.normalize(solutionPath)] ?? [];
    }

    static isUnloaded(solutionPath: string, projectPath: string): boolean {
        return this.list(solutionPath).includes(path.normalize(projectPath));
    }

    static async setUnloaded(solutionPath: string, projectPath: string, unloaded: boolean): Promise<void> {
        const key = path.normalize(solutionPath);
        const project = path.normalize(projectPath);
        const rest = this.list(key).filter(p => p !== project);
        const all = { ...this.all() };
        if (unloaded) {
            all[key] = [...rest, project];
        } else if (rest.length > 0) {
            all[key] = rest;
        } else {
            delete all[key];
        }
        await this.state?.update(STATE_KEY, all);
        this.listeners.forEach(listener => listener());
    }

    static filterPath(solutionPath: string): string {
        const id = crypto.createHash('sha1').update(path.normalize(solutionPath)).digest('hex').slice(0, 12);
        return path.join(privateTempDir('slnf', id), `${path.basename(solutionPath, path.extname(solutionPath))}.slnf`);
    }

    /**
     * What `dotnet build` etc. should get for the solution: the solution itself, or while projects
     * are unloaded a solution filter with the others (written to the temp folder, MSBuild resolves the solution's own directory and properties).
     */
    static buildTarget(solutionPath: string, projectPaths: Iterable<string>): string {
        const unloaded = this.list(solutionPath);
        if (unloaded.length === 0) {
            return solutionPath;
        }
        let filterPath = '';
        try {
            filterPath = this.filterPath(solutionPath);
            const loaded = [...projectPaths].filter(project => !unloaded.includes(path.normalize(project)));
            const content = solutionFilterContent(solutionPath, loaded);
            if (!fs.existsSync(filterPath) || fs.readFileSync(filterPath, 'utf8') !== content) {
                fs.mkdirSync(path.dirname(filterPath), { recursive: true });
                fs.writeFileSync(filterPath, content);
            }
            return filterPath;
        } catch (error) {
            log.warn(`Could not write the solution filter${filterPath ? ` ${filterPath}` : ''}, building the whole solution:`, error);
            return solutionPath;
        }
    }
}
