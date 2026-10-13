import * as vscode from 'vscode';
import { SolutionFile } from '../types/solution';

const STATE_KEY = 'shinobi.solution.configuration';
/** Context key with the active configuration, for the view title menu */
export const CONFIGURATION_CONTEXT = 'shinobi.solution.configuration';
/** Context key with the solution's configurations */
export const AVAILABLE_CONFIGURATIONS_CONTEXT = 'shinobi.solution.availableConfigurations';
/** Context key set when the solution has configurations besides Debug and Release */
export const OTHER_CONFIGURATIONS_CONTEXT = 'shinobi.solution.hasOtherConfigurations';

export const DEFAULT_CONFIGURATIONS: readonly string[] = ['Debug', 'Release'];

/** The configuration names (Debug, Release, ...) a solution declares; Debug and Release when it declares none */
export function solutionConfigurations(solutionFile?: SolutionFile): string[] {
    const section = solutionFile?.globalSections.find(s => s.name === 'SolutionConfigurationPlatforms');
    const names = Object.keys(section?.items ?? {})
        .map(key => key.split('|')[0].trim())
        .filter(Boolean);
    return names.length > 0 ? [...new Set(names)] : [...DEFAULT_CONFIGURATIONS];
}

/**
 * The active solution configuration (like Visual Studio's "Solution Configurations" dropdown).
 * Applies to builds and to the startup configuration; kept per user in the workspace state.
 */
export class BuildConfiguration {
    private static _state?: vscode.Memento;
    private static _available: readonly string[] = DEFAULT_CONFIGURATIONS;
    private static readonly _listeners = new Set<(configuration: string) => void>();

    static initialize(state: vscode.Memento): void {
        this._state = state;
        this._updateContext();
    }

    static get available(): readonly string[] {
        return this._available;
    }

    /** The chosen configuration while the solution has it, else Debug, else the solution's first one */
    static get active(): string {
        const stored = this._state?.get<string>(STATE_KEY);
        if (stored && this._available.includes(stored)) {
            return stored;
        }
        return this._available.includes('Debug') ? 'Debug' : this._available[0];
    }

    static setAvailable(configurations: readonly string[]): void {
        const before = this.active;
        this._available = configurations.length > 0 ? configurations : DEFAULT_CONFIGURATIONS;
        this._updateContext();
        if (this.active !== before) {
            this._fire();
        }
    }

    static async set(configuration: string): Promise<void> {
        if (configuration === this.active || !this._available.includes(configuration)) {
            return;
        }
        await this._state?.update(STATE_KEY, configuration);
        this._updateContext();
        this._fire();
    }

    static onDidChange(listener: (configuration: string) => void): vscode.Disposable {
        this._listeners.add(listener);
        return { dispose: () => this._listeners.delete(listener) };
    }

    private static _fire(): void {
        const active = this.active;
        this._listeners.forEach(listener => listener(active));
    }

    private static _updateContext(): void {
        void vscode.commands.executeCommand('setContext', CONFIGURATION_CONTEXT, this.active);
        void vscode.commands.executeCommand('setContext', AVAILABLE_CONFIGURATIONS_CONTEXT, this._available);
        void vscode.commands.executeCommand('setContext', OTHER_CONFIGURATIONS_CONTEXT,
            this._available.some(name => !DEFAULT_CONFIGURATIONS.includes(name)));
    }
}
