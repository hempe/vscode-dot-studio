import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../core/logger';
import { DebugConfigService, ProfileProjectLaunch } from '../debugConfigService';
import { SolutionService } from '../solutionService';
import { UnloadedProjects } from '../unloadedProjects';
import { StartupProfile } from './slnLaunch';
import { ActiveProfileRef, ProfileFile, ProfileSource, readStartupProfiles, StartupChoice } from './startupChoice';

const log = logger('StartupProfiles');

const projectName = (projectPath: string) => path.basename(projectPath, path.extname(projectPath));

/** A path of a profile as the solution's projects spell it: relative, forward slashes, no `./` */
function solutionRelative(projectPath: string, solutionDir: string): string {
    const normalized = projectPath.replace(/\\/g, '/');
    const relative = path.isAbsolute(normalized) ? path.relative(solutionDir, normalized).replace(/\\/g, '/') : normalized;
    return relative.replace(/^(\.\/)+/, '');
}

/**
 * What a profile starts, in its order: the projects with Action Start or StartWithoutDebugging that the solution has
 * (matched case-insensitively against its project paths), and the paths it has no project for (`missing`).
 * The launch profile is the project's `DebugTarget` (best effort: Visual Studio's key for the debug target is unverified).
 */
export function planProfileLaunch(
    profile: StartupProfile,
    solutionPath: string,
    solutionProjects: readonly { path: string }[]
): { launches: ProfileProjectLaunch[]; missing: string[] } {
    const solutionDir = path.dirname(solutionPath);
    const byKey = new Map(solutionProjects.map(project => [solutionRelative(project.path, solutionDir).toLowerCase(), project.path]));
    const missing: string[] = [];
    const found: Array<{ projectPath: string; relative: string; noDebug: boolean; launchProfile?: string }> = [];
    for (const project of profile.projects) {
        if (project.action === 'None') {
            continue;
        }
        const relative = byKey.get(solutionRelative(project.path, solutionDir).toLowerCase());
        if (relative === undefined) {
            missing.push(project.path);
            continue;
        }
        const projectPath = path.resolve(solutionDir, relative);
        if (found.some(entry => entry.projectPath === projectPath)) {
            continue;
        }
        const debugTarget = project.extra.DebugTarget;
        found.push({ projectPath, relative, noDebug: project.action === 'StartWithoutDebugging', launchProfile: typeof debugTarget === 'string' ? debugTarget : undefined });
    }
    // Two projects with the same name (in different folders) are told apart by their paths
    const launches = found.map(({ relative, ...entry }) => {
        const shared = found.filter(other => projectName(other.projectPath).toLowerCase() === projectName(entry.projectPath).toLowerCase()).length > 1;
        return { ...entry, name: `${profile.name}: ${shared ? relative.replace(/\.[^./]+$/, '') : projectName(entry.projectPath)}` };
    });
    return { launches, missing };
}

export type StartupPick = vscode.QuickPickItem & { choice: { kind: 'single' } | { kind: 'profile'; ref: ActiveProfileRef } };

/**
 * The entries of "Select Startup Profile...": the single startup project (when there is one) and the profiles of the
 * shared and the user file, the user file's marked; the active entry is marked "(current)"
 */
export function startupPickItems(
    singleProject: string | undefined,
    files: Record<ProfileSource, Pick<ProfileFile, 'profiles'>>,
    active: ActiveProfileRef | undefined
): StartupPick[] {
    const items: StartupPick[] = [];
    if (singleProject) {
        items.push({ label: `Single: ${projectName(singleProject)}`, description: active ? undefined : '(current)', choice: { kind: 'single' } });
    }
    for (const source of ['shared', 'user'] as const) {
        for (const profile of files[source].profiles) {
            const isActive = active?.source === source && active.name === profile.name;
            const description = [source === 'user' ? 'user file' : '', isActive ? '(current)' : ''].filter(Boolean).join(' ');
            items.push({
                label: profile.name,
                description: description || undefined,
                detail: profile.projects.filter(project => project.action !== 'None')
                    .map(project => `${projectName(project.path)}${project.action === 'StartWithoutDebugging' ? ' (without debugging)' : ''}`)
                    .join(', ') || 'Starts no project',
                choice: { kind: 'profile', ref: { name: profile.name, source } },
            });
        }
    }
    return items;
}

/** What defaultStartupProject needs of the solution */
export interface StartableProjects {
    readonly solutionPath: string;
    /** The projects in the solution file's order (paths relative to the solution, forward slashes) */
    readonly configurationProjects: readonly { path: string }[];
    readonly projects: ReadonlyMap<string, { readonly isExecutable: boolean; readonly isTestProject: boolean }>;
}

/**
 * The startup project when none was ever set: the first project of the solution file that can be started (console,
 * web, worker...; not a library, a test project or an unloaded project). Visual Studio takes the first project of the
 * solution file, even a library that then cannot start; the first one that can start is what that is meant to be.
 */
export function defaultStartupProject(solution: StartableProjects): string | undefined {
    const solutionDir = path.dirname(solution.solutionPath);
    const same = (a: string, b: string) => process.platform === 'win32' || process.platform === 'darwin'
        ? path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase()
        : path.normalize(a) === path.normalize(b);
    for (const entry of solution.configurationProjects) {
        const projectPath = path.resolve(solutionDir, entry.path);
        const project = [...solution.projects].find(([candidate]) => same(candidate, projectPath))?.[1];
        if (project?.isExecutable && !project.isTestProject && !UnloadedProjects.isUnloaded(solution.solutionPath, projectPath)) {
            return projectPath;
        }
    }
    return undefined;
}

let lastWarning = '';

async function writeProfileStartup(profile: StartupProfile, solutionPath: string): Promise<void> {
    const solution = SolutionService.getActiveSolution();
    if (!solution) {
        return;
    }
    const planned = planProfileLaunch(profile, solutionPath, solution.configurationProjects);
    const missing = planned.missing;
    // Unloaded projects are left out of the build, so they are not started either
    const launches = planned.launches.filter(launch => !UnloadedProjects.isUnloaded(solutionPath, launch.projectPath));
    // Once per profile and set of missing projects, not on every refresh
    const warning = missing.length > 0
        ? `The startup profile "${profile.name}" names projects the solution does not have, they are skipped: ${missing.join(', ')}`
        : '';
    if (warning && warning !== lastWarning) {
        void vscode.window.showWarningMessage(warning);
    }
    lastWarning = warning;

    // The remembered startup project keeps its framework and launch profile inside the profile too, like Start New Instance
    const single = StartupChoice.rememberedSingle(solutionPath);
    const isSingle = (projectPath: string) => !!single && path.normalize(single.projectPath).toLowerCase() === path.normalize(projectPath).toLowerCase();
    await DebugConfigService.updateStartupProfileConfiguration(
        launches.map(launch => isSingle(launch.projectPath)
            ? { ...launch, framework: single?.framework, launchProfile: launch.launchProfile ?? single?.launchProfile }
            : launch),
        UnloadedProjects.buildTarget(solutionPath, solution.projects.keys())
    );
}

async function doRefreshStartup(): Promise<void> {
    const solutionPath = SolutionService.getActiveSolution()?.solutionPath;
    const resolved = solutionPath ? StartupChoice.resolve(solutionPath) : { kind: 'single' as const };
    if (resolved.kind === 'unreadable') {
        // Likely being edited: F5 keeps starting what it started before
        log.warn(`Startup profile "${resolved.ref.name}" not refreshed: ${resolved.error}`);
        return;
    }
    if (resolved.kind === 'profile' && solutionPath) {
        await writeProfileStartup(resolved.profile, solutionPath);
        return;
    }
    if (DebugConfigService.hasStartupProfileConfiguration()) {
        // Back to the single startup project (chosen, or the profile or its file is gone)
        const single = solutionPath ? StartupChoice.rememberedSingle(solutionPath) : undefined;
        if (single && fs.existsSync(single.projectPath)) {
            await DebugConfigService.updateStartupConfiguration(single.projectPath, single.framework, false, single.launchProfile);
            return;
        }
        // No startup project was set before the profile: without one F5 would ask "Select a debugger"
        const solution = SolutionService.getActiveSolution();
        const fallback = solution ? defaultStartupProject(solution) : undefined;
        if (fallback && await DebugConfigService.updateStartupConfiguration(fallback)) {
            const message = `F5 starts ${projectName(fallback)}, the first project of the solution that can be started: `
                + 'no startup project was set before the startup profile. Set as Startup Project chooses another.';
            log.info(message);
            void vscode.window.showInformationMessage(message);
        } else {
            DebugConfigService.removeStartupProfileConfiguration();
            const message = 'The startup profile is no longer used and the solution has no project that can be started: F5 has nothing to start.';
            log.info(message);
            void vscode.window.showInformationMessage(message);
        }
        return;
    }
    await DebugConfigService.refreshStartupConfiguration();
}

let refreshing: Promise<void> = Promise.resolve();

/**
 * Brings the "Startup" entry of launch.json in line with the active startup choice: the single startup project's
 * configuration, or the active profile's compound. Refreshes run one after the other, they write the same files.
 */
export function refreshStartup(): Promise<void> {
    refreshing = refreshing.then(doRefreshStartup, doRefreshStartup);
    return refreshing;
}

/** A .slnLaunch file of the active solution was created, changed or deleted */
export async function startupProfilesChanged(filePath: string): Promise<boolean> {
    const solutionPath = SolutionService.getActiveSolution()?.solutionPath;
    if (!solutionPath || !/\.slnLaunch(\.user)?$/i.test(filePath)) {
        return false;
    }
    StartupChoice.updateContext(solutionPath);
    await refreshStartup();
    return true;
}

/** The startup project before a profile replaces it, to come back to with "Single: ..." */
export function currentSingle() {
    const projectPath = DebugConfigService.getStartupProject();
    return projectPath
        ? { projectPath, framework: DebugConfigService.getActiveFramework() ?? undefined, launchProfile: DebugConfigService.getStartupLaunchProfile() }
        : undefined;
}

/** "Select Startup Profile...": the single startup project or one of the solution's multi-project launch profiles */
export async function selectStartupProfile(): Promise<void> {
    const solution = SolutionService.getActiveSolution();
    if (!solution) {
        vscode.window.showInformationMessage('Open a solution first.');
        return;
    }
    const solutionPath = solution.solutionPath;
    const files = readStartupProfiles(solutionPath);
    for (const file of [files.shared, files.user]) {
        if (file.error) {
            void vscode.window.showErrorMessage(`${path.basename(file.path)} cannot be read: ${file.error}`);
        }
    }
    const resolved = StartupChoice.resolve(solutionPath);
    const active = resolved.kind === 'profile' ? { name: resolved.profile.name, source: resolved.source }
        : resolved.kind === 'unreadable' ? resolved.ref : undefined;
    const singleProject = DebugConfigService.getStartupProject() ?? StartupChoice.rememberedSingle(solutionPath)?.projectPath;
    const items = startupPickItems(singleProject, files, active);
    if (items.length === 0) {
        vscode.window.showInformationMessage('There is no startup project and no startup profile yet.');
        return;
    }

    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'What F5 starts', matchOnDetail: true });
    if (!picked) {
        return;
    }
    if (picked.choice.kind === 'single') {
        await StartupChoice.chooseSingle(solutionPath);
        return;
    }
    await StartupChoice.chooseProfile(solutionPath, picked.choice.ref, currentSingle());
}
