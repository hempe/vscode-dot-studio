import * as vscode from 'vscode';
import { SolutionFile } from '../../types/solution';

const STATE_KEY = 'shinobi.solution.configuration';
/** Context key with the active configuration, for the view title menu */
export const CONFIGURATION_CONTEXT = 'shinobi.solution.configuration';
/** Context key with the solution's configurations */
export const AVAILABLE_CONFIGURATIONS_CONTEXT = 'shinobi.solution.availableConfigurations';
/** Context key set when the solution has configurations besides Debug and Release */
export const OTHER_CONFIGURATIONS_CONTEXT = 'shinobi.solution.hasOtherConfigurations';

const PLATFORM_STATE_KEY = 'shinobi.solution.platform';
/** Context key with the active platform */
export const PLATFORM_CONTEXT = 'shinobi.solution.platform';
/** Context key with the solution's platforms */
export const AVAILABLE_PLATFORMS_CONTEXT = 'shinobi.solution.availablePlatforms';
/** True when the solution has a platform to choose between (for the `when` of the picker, which cannot test an array's length) */
export const SEVERAL_PLATFORMS_CONTEXT = 'shinobi.solution.hasSeveralPlatforms';

export const DEFAULT_CONFIGURATIONS: readonly string[] = ['Debug', 'Release'];
export const DEFAULT_PLATFORM = 'Any CPU';

/** The configuration names (Debug, Release, ...) a solution declares; Debug and Release when it declares none */
export function solutionConfigurations(solutionFile?: SolutionFile): string[] {
    const section = solutionFile?.globalSections.find(s => s.name === 'SolutionConfigurationPlatforms');
    const names = Object.keys(section?.items ?? {})
        .map(key => key.split('|')[0].trim())
        .filter(Boolean);
    return names.length > 0 ? [...new Set(names)] : [...DEFAULT_CONFIGURATIONS];
}

/** The platform names (Any CPU, x64, ...) a solution declares; Any CPU when it declares none */
export function solutionPlatforms(solutionFile?: SolutionFile): string[] {
    const section = solutionFile?.globalSections.find(s => s.name === 'SolutionConfigurationPlatforms');
    const names = Object.keys(section?.items ?? {})
        .map(key => key.split('|')[1]?.trim())
        .filter(Boolean);
    return names.length > 0 ? [...new Set(names)] : [DEFAULT_PLATFORM];
}

/**
 * The active solution configuration and platform (like Visual Studio's "Solution Configurations" dropdown).
 * Applies to builds and to the startup configuration; kept per user in the workspace state.
 */
export class BuildConfiguration {
    private static _state?: vscode.Memento;
    private static _available: readonly string[] = DEFAULT_CONFIGURATIONS;
    private static _availablePlatforms: readonly string[] = [DEFAULT_PLATFORM];
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

    static get availablePlatforms(): readonly string[] {
        return this._availablePlatforms;
    }

    /** The chosen platform while the solution has it, else Any CPU, else the solution's first one */
    static get activePlatform(): string {
        const stored = this._state?.get<string>(PLATFORM_STATE_KEY);
        if (stored && this._availablePlatforms.includes(stored)) {
            return stored;
        }
        return this._availablePlatforms.includes(DEFAULT_PLATFORM) ? DEFAULT_PLATFORM : this._availablePlatforms[0];
    }

    static setAvailablePlatforms(platforms: readonly string[]): void {
        const before = this.activePlatform;
        this._availablePlatforms = platforms.length > 0 ? platforms : [DEFAULT_PLATFORM];
        this._updateContext();
        if (this.activePlatform !== before) {
            this._fire();
        }
    }

    static async setPlatform(platform: string): Promise<void> {
        if (platform === this.activePlatform || !this._availablePlatforms.includes(platform)) {
            return;
        }
        await this._state?.update(PLATFORM_STATE_KEY, platform);
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
        void vscode.commands.executeCommand('setContext', PLATFORM_CONTEXT, this.activePlatform);
        void vscode.commands.executeCommand('setContext', AVAILABLE_PLATFORMS_CONTEXT, this._availablePlatforms);
        void vscode.commands.executeCommand('setContext', SEVERAL_PLATFORMS_CONTEXT, this._availablePlatforms.length > 1);
    }
}
