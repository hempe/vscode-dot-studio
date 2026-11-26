import * as vscode from 'vscode';

const KEY = 'shinobi.activeFramework';

/**
 * The framework chosen with Select Framework, for the whole solution (not only for the startup project), kept per user in the
 * workspace state. F5 uses it when the startup project targets it; the Dependencies tree and the C# language context of every
 * project that targets it follow. Undefined: Auto.
 */
export class FrameworkChoice {
    private static state: vscode.Memento | undefined;
    private static readonly listeners = new Set<() => void>();

    static initialize(state: vscode.Memento): void {
        this.state = state;
    }

    static get(solutionPath: string): string | undefined {
        return this.state?.get<Record<string, string>>(KEY, {})[solutionPath];
    }

    static async set(solutionPath: string, framework: string | undefined): Promise<void> {
        const all = { ...(this.state?.get<Record<string, string>>(KEY, {}) ?? {}) };
        if (framework) {
            all[solutionPath] = framework;
        } else {
            delete all[solutionPath];
        }
        await this.state?.update(KEY, all);
        for (const listener of [...this.listeners]) {
            listener();
        }
    }

    /** A saved temporary solution: the chosen framework moves to the saved file */
    static async rename(from: string, to: string): Promise<void> {
        const framework = this.get(from);
        if (framework) {
            await this.set(from, undefined);
            await this.set(to, framework);
        }
    }

    static onDidChange(listener: () => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
    }
}
