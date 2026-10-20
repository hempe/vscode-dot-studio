import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { readSlnLaunch, renderSlnLaunch, slnLaunchPaths, StartupProfile } from './slnLaunch';

const STATE_KEY = 'shinobi.solution.startupChoice';
/** Context key set while the solution has a .slnLaunch or .slnLaunch.user file, for the title bar's profile picker */
export const STARTUP_PROFILES_CONTEXT = 'shinobi.solution.hasStartupProfiles';

/** Which file a profile lives in: `shared` is the .slnLaunch meant for source control, `user` the per-user file */
export type ProfileSource = 'shared' | 'user';

/** The profiles of one .slnLaunch file; `error` (readable) when the file exists but cannot be read */
export interface ProfileFile {
    path: string;
    exists: boolean;
    profiles: StartupProfile[];
    error?: string;
}

export interface ActiveProfileRef {
    name: string;
    source: ProfileSource;
}

/** The single startup project as it was before a profile became active, to go back to */
export interface RememberedSingle {
    projectPath: string;
    framework?: string;
    launchProfile?: string;
}

/** What starts with F5: the single startup project, a profile, or a profile whose file cannot be read right now */
export type ResolvedStartup =
    | { kind: 'single' }
    | { kind: 'profile'; profile: StartupProfile; source: ProfileSource }
    | { kind: 'unreadable'; ref: ActiveProfileRef; error: string };

interface StoredChoice {
    profile?: ActiveProfileRef;
    single?: RememberedSingle;
}

export function readProfileFile(filePath: string): ProfileFile {
    if (!fs.existsSync(filePath)) {
        return { path: filePath, exists: false, profiles: [] };
    }
    try {
        return { path: filePath, exists: true, profiles: readSlnLaunch(fs.readFileSync(filePath, 'utf8')).profiles };
    } catch (error) {
        return { path: filePath, exists: true, profiles: [], error: error instanceof Error ? error.message : String(error) };
    }
}

/** The shared and the user profile files of a solution */
export function readStartupProfiles(solutionPath: string): Record<ProfileSource, ProfileFile> {
    const paths = slnLaunchPaths(solutionPath);
    return { shared: readProfileFile(paths.shared), user: readProfileFile(paths.user) };
}

/**
 * Writes the profiles of one file, keeping its formatting. Throws an Error with a readable message, and writes
 * nothing, when the existing file cannot be parsed (a hand-edited file is never overwritten).
 */
export function writeStartupProfiles(solutionPath: string, source: ProfileSource, profiles: readonly StartupProfile[]): void {
    const filePath = slnLaunchPaths(solutionPath)[source];
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : undefined;
    let text: string;
    try {
        text = renderSlnLaunch(existing, profiles);
    } catch (error) {
        throw new Error(`${path.basename(filePath)} was not changed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (text !== existing) {
        fs.writeFileSync(filePath, text, 'utf8');
    }
}

/**
 * The active startup choice of each solution (Visual Studio's "Single startup project" / a multi-project launch
 * profile), kept per user in the workspace state. The profile itself is read from its file each time, so edits
 * in Visual Studio or by hand apply; a file or profile that is gone falls back to the single startup project.
 */
export class StartupChoice {
    private static _state?: vscode.Memento;
    private static readonly _listeners = new Set<() => void>();

    static initialize(state: vscode.Memento): void {
        this._state = state;
    }

    /** The profile chosen for the solution, whether or not its file still has it */
    static profileRef(solutionPath: string): ActiveProfileRef | undefined {
        return this._stored(solutionPath).profile;
    }

    static rememberedSingle(solutionPath: string): RememberedSingle | undefined {
        return this._stored(solutionPath).single;
    }

    /** Makes a profile active; `single` is the startup project to go back to (the remembered one stays when undefined) */
    static async useProfile(solutionPath: string, ref: ActiveProfileRef, single?: RememberedSingle): Promise<void> {
        const stored = this._stored(solutionPath);
        await this._store(solutionPath, { profile: { name: ref.name, source: ref.source }, single: single ?? stored.single });
        this._fire();
    }

    /** Back to the single startup project; nothing happens when no profile is active */
    static async useSingle(solutionPath: string): Promise<void> {
        const stored = this._stored(solutionPath);
        if (!stored.profile) {
            return;
        }
        await this._store(solutionPath, { single: stored.single });
        this._fire();
    }

    static resolve(solutionPath: string): ResolvedStartup {
        const ref = this.profileRef(solutionPath);
        if (!ref) {
            return { kind: 'single' };
        }
        const file = readProfileFile(slnLaunchPaths(solutionPath)[ref.source]);
        if (file.error) {
            return { kind: 'unreadable', ref, error: file.error };
        }
        const profile = file.profiles.find(candidate => candidate.name === ref.name);
        return profile ? { kind: 'profile', profile, source: ref.source } : { kind: 'single' };
    }

    /** The name of the profile F5 starts, undefined for the single startup project */
    static activeProfileName(solutionPath: string): string | undefined {
        const resolved = this.resolve(solutionPath);
        return resolved.kind === 'profile' ? resolved.profile.name : undefined;
    }

    static updateContext(solutionPath: string | undefined): void {
        const paths = solutionPath ? slnLaunchPaths(solutionPath) : undefined;
        void vscode.commands.executeCommand('setContext', STARTUP_PROFILES_CONTEXT,
            !!paths && (fs.existsSync(paths.shared) || fs.existsSync(paths.user)));
    }

    static onDidChange(listener: () => void): vscode.Disposable {
        this._listeners.add(listener);
        return { dispose: () => this._listeners.delete(listener) };
    }

    private static _all(): Record<string, StoredChoice> {
        return this._state?.get<Record<string, StoredChoice>>(STATE_KEY) ?? {};
    }

    private static _stored(solutionPath: string): StoredChoice {
        return this._all()[path.normalize(solutionPath)] ?? {};
    }

    private static async _store(solutionPath: string, choice: StoredChoice): Promise<void> {
        await this._state?.update(STATE_KEY, { ...this._all(), [path.normalize(solutionPath)]: choice });
    }

    private static _fire(): void {
        this._listeners.forEach(listener => listener());
    }
}
