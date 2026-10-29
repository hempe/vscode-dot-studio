import { ensureMonoDebugging, splitArguments } from './monoDebug';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../core/logger';
import { isNetFrameworkTarget } from '../parsers/targetFrameworks';
import { parseJsonc, removeArrayItems, upsertArrayItem } from '../core/jsonc';
import { activeProjectBuild } from './activeBuild';
import { createDotnetTask, DOTNET_TASK_TYPE } from './dotnetTaskProvider';
import { runTask } from './runTask';
import { solutionWorkspaceFolder } from './workspaceFolders';
import { BuildConfiguration } from './buildConfiguration';
import { checkDevCertificateBeforeStart } from './devCert/devCertCheck';

import { compoundConfigurationNames, hasStartupProfileConfiguration, launchJsonHasSyntaxErrors, readStartupCompound, readStartupConfig, removeStartupProfileConfiguration, updateTasksJson, upsertJsoncArrayItem } from './launch/launchFiles';
import { determineTargetFramework, extractTargetFrameworks, resolveTargetPath } from './launch/targetFramework';
import { browserAction, LaunchProfile, readLaunchProfiles } from './launch/launchProfiles';
export type { LaunchProfile } from './launch/launchProfiles';

const log = logger('DebugConfigService');

/** A project of a multi-project startup profile, as the "Startup" compound starts it */
export interface ProfileProjectLaunch {
    projectPath: string;
    /** The name of its launch configuration, unique in launch.json */
    name: string;
    /** Visual Studio's "Start without debugging" */
    noDebug: boolean;
    /** The launch profile to use when the project has it, else its first one */
    launchProfile?: string;
    framework?: string;
}

export class DebugConfigService {

    // The files and the framework lookups live in launch/; these are what the rest of the code calls
    static readonly extractTargetFrameworks = extractTargetFrameworks;
    static readonly removeStartupProfileConfiguration = removeStartupProfileConfiguration;
    static readonly hasStartupProfileConfiguration = hasStartupProfileConfiguration;
    /**
     * The startup project: the project the "StartupPreBuild" task builds, as long as launch.json still
     * has the "Startup" configuration. The program path can't tell, MSBuild decides where the output goes.
     */
    static getStartupProject(): string | null {
        const startup = this.readStartupBuild();
        return startup ? startup.projectPath : null;
    }

    /** The target framework the startup project builds and runs */
    static getActiveFramework(): string | null {
        return this.readStartupBuild()?.framework ?? null;
    }

    /**
     * Rewrites the "Startup" configuration of the current startup project, e.g. after the solution
     * configuration or its launchSettings.json changed. Writes nothing when everything is up to date.
     */
    static async refreshStartupConfiguration(): Promise<void> {
        const startupProject = this.getStartupProject();
        if (startupProject) {
            await this.updateStartupConfiguration(startupProject, this.getActiveFramework() ?? undefined);
        }
    }

    /** Project and framework of the "StartupPreBuild" task (`dotnet build <project> --framework <tfm> ...`) */
    private static readStartupBuild(): { projectPath: string; framework?: string } | undefined {
        try {
            const workspacePath = solutionWorkspaceFolder()?.uri.fsPath;
            if (!workspacePath) {
                return undefined;
            }
            const vscodeFolder = path.join(workspacePath, '.vscode');
            const startupConfig = readStartupConfig(path.join(vscodeFolder, 'launch.json'));
            if (!startupConfig || !['coreclr', 'clr', 'mono'].includes(startupConfig.type)) {
                return undefined;
            }

            const tasksJsonPath = path.join(vscodeFolder, 'tasks.json');
            if (!fs.existsSync(tasksJsonPath)) {
                return undefined;
            }
            const { value } = parseJsonc(fs.readFileSync(tasksJsonPath, 'utf8'));
            const args = value?.tasks?.find((task: any) => task?.label === 'StartupPreBuild')?.args;
            if (!Array.isArray(args) || args[0] !== 'build' || typeof args[1] !== 'string') {
                return undefined;
            }

            const frameworkIndex = args.indexOf('--framework');
            return {
                projectPath: path.resolve(workspacePath, args[1]),
                framework: frameworkIndex > 0 && typeof args[frameworkIndex + 1] === 'string' ? args[frameworkIndex + 1] : undefined,
            };
        } catch (error) {
            log.error('Error reading the startup project:', error);
            return undefined;
        }
    }

    /**
     * Updates the workspace launch.json with the "Startup" configuration.
     * `askForProfile` (Set as Startup Project) lets the user pick the launch profile when the project has
     * several; otherwise the profile already in the configuration is kept (`launchProfile` when there is none,
     * e.g. coming back from a multi-project profile). Cancelling the pick changes nothing.
     * Replaces a multi-project "Startup" compound. Resolves with whether the configuration was written.
     */
    static updateStartupConfiguration(startupProjectPath: string, framework?: string, askForProfile = false, launchProfile?: string): Promise<boolean> {
        return this.serialized(() => this.writeStartupConfiguration(startupProjectPath, framework, askForProfile, launchProfile));
    }

    /**
     * Runs the writes of launch.json and tasks.json one after the other, in the order they were asked for: each one waits
     * for MSBuild between reading and writing, and the slower earlier request must not overwrite a later one
     */
    private static serialized<T>(write: () => Promise<T>): Promise<T> {
        const run = this.writes.then(write, write);
        this.writes = run.then(() => undefined, () => undefined);
        return run;
    }

    private static writes: Promise<void> = Promise.resolve();

    private static async writeStartupConfiguration(startupProjectPath: string, framework?: string, askForProfile = false, launchProfile?: string): Promise<boolean> {
        try {
            log.info(`updateStartupConfiguration called with project: ${startupProjectPath}, framework: ${framework}`);

            const workspaceFolder = solutionWorkspaceFolder();
            if (!workspaceFolder) {
                log.error('No workspace folder found');
                return false;
            }

            log.info(`Workspace folder: ${workspaceFolder.uri.fsPath}`);

            const workspacePath = workspaceFolder.uri.fsPath;
            const vscodeFolder = path.join(workspacePath, '.vscode');
            const launchJsonPath = path.join(vscodeFolder, 'launch.json');
            const tasksJsonPath = path.join(vscodeFolder, 'tasks.json');

            const absoluteProjectPath = path.isAbsolute(startupProjectPath)
                ? startupProjectPath
                : path.join(workspacePath, startupProjectPath);
            const profile = await this.pickLaunchProfile(path.dirname(absoluteProjectPath), launchJsonPath, askForProfile, launchProfile);
            if (profile === null) {
                log.info('Launch profile choice cancelled, startup configuration unchanged');
                return false;
            }

            // Ensure .vscode folder exists
            if (!fs.existsSync(vscodeFolder)) {
                fs.mkdirSync(vscodeFolder, { recursive: true });
            }


            const relativeProjectPath = path.relative(workspacePath, absoluteProjectPath);
            const { config: startupConfig, framework: selectedFramework, configuration, platform } =
                await this.launchConfiguration(absoluteProjectPath, workspacePath, framework, profile, 'Startup', 'StartupPreBuild');

            // A launch.json with syntax errors is not changed: switching only tasks.json would make F5 build one project and run another
            if (launchJsonHasSyntaxErrors(launchJsonPath)) {
                vscode.window.showWarningMessage('.vscode/launch.json has syntax errors and was not updated. Fix them and select the startup project again.');
                return false;
            }

            // tasks.json first: it names the startup project, which is read back when launch.json changes
            await updateTasksJson(tasksJsonPath, relativeProjectPath, configuration, selectedFramework || undefined, platform);

            // A compound and a configuration with the same name make VS Code refuse to start
            removeStartupProfileConfiguration(launchJsonPath);

            // A new "Startup" goes first so VS Code selects it by default; an existing one is updated where it is
            upsertJsoncArrayItem(
                launchJsonPath,
                { version: '0.2.0', configurations: [] },
                'configurations',
                (config: any) => config?.name === 'Startup',
                startupConfig,
                'first'
            );

            log.info(`Updated "Startup" configuration: project=${relativeProjectPath}, configuration=${configuration}, framework=${selectedFramework || 'auto'}`);

            // Set the "Startup" configuration as the active debug configuration
            await this.setActiveDebugConfiguration(workspaceFolder, 'Startup');
            return true;
        } catch (error) {
            log.error('Error updating startup configuration:', error);
            return false;
        }
    }

    /**
     * Writes a multi-project startup profile as the "Startup" launch entry: one configuration per project (named
     * `<profile>: <project>`, `noDebug` for "Start without debugging") and a compound named "Startup" that lists them,
     * builds `buildTarget` (the solution) once through the "StartupPreBuild" task and has `stopAll`.
     *
     * Why a compound, and not sessions started one by one with `parentSession`: plain F5 is VS Code's own key and runs
     * the selected launch entry by name, so "Startup" keeps working for F5, the Run and Debug view and the title bar.
     * VS Code (checked in its 1.136 source) runs a compound's `preLaunchTask` once and starts nothing when it fails;
     * with `stopAll` it terminates every session of the compound as soon as one is terminated or disconnected by the
     * user (Stop, Shift+F5, the toolbar), while a program that exits on its own only ends its own session: Visual
     * Studio's behaviour. `startDebugging` with `noDebug` (Ctrl+F5) is passed on to every session of the compound, and
     * a `noDebug` in a configuration is kept, which gives mixed actions with plain F5. A parent session would not help:
     * stopping a parent does not stop its children, `lifecycleManagedByParent` only forwards a child's stop to its parent.
     * The single "Startup" configuration is removed (the names would clash); updateStartupConfiguration puts it back.
     *
     * The project configurations are `presentation.hidden` and the compound has `presentation.order`: F5 runs the entry
     * selected in Run and Debug, and VS Code selects the first visible one of its sorted list (entries with a
     * `presentation` before those without) when nothing valid is selected yet. Visible project configurations came
     * first, and F5 started one project without the compound's build. Hidden configurations still run in the compound.
     */
    static updateStartupProfileConfiguration(launches: readonly ProfileProjectLaunch[], buildTarget: string): Promise<void> {
        return this.serialized(() => this.writeStartupProfileConfiguration(launches, buildTarget));
    }

    private static async writeStartupProfileConfiguration(launches: readonly ProfileProjectLaunch[], buildTarget: string): Promise<void> {
        try {
            const workspaceFolder = solutionWorkspaceFolder();
            if (!workspaceFolder) {
                return;
            }
            const workspacePath = workspaceFolder.uri.fsPath;
            const vscodeFolder = path.join(workspacePath, '.vscode');
            const launchJsonPath = path.join(vscodeFolder, 'launch.json');

            const configs: Array<{ name: string; noDebug?: boolean; presentation: { hidden: boolean } }> = [];
            for (const launch of launches) {
                const profiles = readLaunchProfiles(path.dirname(launch.projectPath));
                const profile = profiles.find(candidate => candidate.name === launch.launchProfile) ?? profiles[0];
                const { config } = await this.launchConfiguration(launch.projectPath, workspacePath, launch.framework, profile, launch.name);
                configs.push({ ...config, ...(launch.noDebug && { noDebug: true }), presentation: { hidden: true } });
            }

            if (!fs.existsSync(vscodeFolder)) {
                fs.mkdirSync(vscodeFolder, { recursive: true });
            }
            const original = fs.existsSync(launchJsonPath)
                ? fs.readFileSync(launchJsonPath, 'utf8')
                : JSON.stringify({ version: '0.2.0', configurations: [] }, null, 4) + '\n';
            const { value, errors } = parseJsonc(original);
            if (errors.length > 0) {
                log.error(`Not updating ${launchJsonPath}, it has syntax errors:`, errors);
                vscode.window.showWarningMessage('.vscode/launch.json has syntax errors and was not updated. Fix them and select the startup profile again.');
                return;
            }

            // After the check: tasks.json names the build, and must not move on while launch.json stays
            const relativeTarget = path.relative(workspacePath, buildTarget);
            await updateTasksJson(path.join(vscodeFolder, 'tasks.json'), relativeTarget.startsWith('..') ? buildTarget : relativeTarget,
                BuildConfiguration.active, undefined, BuildConfiguration.activePlatform);
            const names = configs.map(config => config.name);
            const previous = compoundConfigurationNames(value);
            // A configuration named Startup clashes with the compound; the entries the previous compound listed go only when we wrote them (hidden)
            let text = removeArrayItems(original, 'configurations', (config: any) =>
                config?.name === 'Startup' || (previous.includes(config?.name) && !names.includes(config?.name) && config?.presentation?.hidden === true));
            // Inserted from the last, so new entries end up first and in the profile's order
            for (const config of [...configs].reverse()) {
                text = upsertArrayItem(text, 'configurations', (item: any) => item?.name === config.name, config, 'first');
            }
            text = upsertArrayItem(text, 'compounds', (item: any) => item?.name === 'Startup',
                { name: 'Startup', configurations: names, preLaunchTask: 'StartupPreBuild', stopAll: true, presentation: { order: 1 } }, 'first');
            if (text !== original) {
                log.info(`Writing the startup profile to ${launchJsonPath}: ${names.join(', ')}`);
                fs.writeFileSync(launchJsonPath, text, 'utf8');
            }
        } catch (error) {
            log.error('Error updating the startup profile configuration:', error);
        }
    }

    /**
     * The launch configuration of a project for the active solution configuration: its output (from MSBuild),
     * framework and launch profile. With a launch profile the C# debugger applies its applicationUrl,
     * environmentVariables and commandLineArgs from launchSettings.json at launch time.
     * Named after the project unless `name` is given.
     */
    private static async launchConfiguration(
        projectPath: string,
        workspacePath: string,
        framework: string | undefined,
        profile: LaunchProfile | undefined,
        name = path.basename(projectPath, path.extname(projectPath)),
        preLaunchTask?: string
    ) {
        const projectDir = path.dirname(projectPath);
        const relativeProjectDir = path.relative(workspacePath, projectDir);

        // Determine the best framework to use
        const selectedFramework = await determineTargetFramework(projectPath, framework);
        log.info(`Selected framework for ${projectPath}: ${selectedFramework}`);

        const { configuration, platform } = activeProjectBuild(projectPath);
        const targetPath = await resolveTargetPath(projectPath, configuration, selectedFramework, platform);
        const relativeTargetPath = path.relative(workspacePath, targetPath);
        const program = relativeTargetPath.startsWith('..') || path.isAbsolute(relativeTargetPath)
            ? targetPath
            : `\${workspaceFolder}/${relativeTargetPath.split(path.sep).join('/')}`;

        const isNetFramework = isNetFrameworkTarget(selectedFramework);

        // Determine debug type based on framework and platform
        let debugType: string;
        if (isNetFramework) {
            if (process.platform === 'win32') {
                debugType = 'clr';
            } else {
                // On non-Windows platforms, use the dedicated mono debugger
                debugType = 'mono';
                log.info(`Using mono debugger for .NET Framework project on ${process.platform}`);
            }
        } else {
            debugType = 'coreclr';
        }

        // The mono debugger does not read launchSettings.json: its arguments and environment go into the configuration
        const profileSettings = debugType === 'mono'
            ? { args: splitArguments(profile?.commandLineArgs), ...(profile?.environmentVariables && { env: profile.environmentVariables }) }
            : profile ? { launchSettingsProfile: profile.name } : { args: [] };

        const config = {
            name,
            type: debugType,
            request: 'launch',
            program,
            ...profileSettings,
            cwd: `\${workspaceFolder}/${relativeProjectDir}`,
            console: 'integratedTerminal',
            ...(debugType !== 'mono' && { stopAtEntry: false }), // mono type doesn't support stopAtEntry
            ...(preLaunchTask && { preLaunchTask }),
            ...(debugType !== 'mono' && profile?.launchBrowser && { serverReadyAction: browserAction(profile.launchUrl) })
        };
        return { config, framework: selectedFramework, configuration, platform };
    }

    /**
     * Visual Studio's "Debug > Start New Instance" / "Start Without Debugging" on a project: builds it and
     * starts it next to whatever already runs, without making it the startup project. The startup project
     * keeps its launch profile and framework; other projects use their first profile and newest framework.
     */
    static async startProject(projectPath: string, noDebug: boolean): Promise<void> {
        const workspaceFolder = solutionWorkspaceFolder();
        if (!workspaceFolder) {
            return;
        }
        const projectName = path.basename(projectPath, path.extname(projectPath));
        const profile = this.startLaunchProfile(projectPath);
        checkDevCertificateBeforeStart([profile]);

        const exitCode = await runTask(createDotnetTask({ type: DOTNET_TASK_TYPE, action: 'build', target: projectPath }));
        if (exitCode !== 0) {
            vscode.window.showErrorMessage(`${projectName} was not started, its build failed. See the Problems panel.`);
            return;
        }

        const framework = this.getStartupProject() === projectPath ? this.getActiveFramework() ?? undefined : undefined;
        const { config } = await this.launchConfiguration(projectPath, workspaceFolder.uri.fsPath, framework, profile);
        if (config.type === 'mono' && !await ensureMonoDebugging()) {
            return;
        }
        await vscode.debug.startDebugging(workspaceFolder, config, { noDebug });
    }

    /**
     * The launch profile Start New Instance uses: on the startup project its chosen profile, else the first one;
     * undefined when the project has no profile `dotnet run` can use
     */
    static startLaunchProfile(projectPath: string): LaunchProfile | undefined {
        const profiles = readLaunchProfiles(path.dirname(projectPath));
        const workspacePath = solutionWorkspaceFolder()?.uri.fsPath;
        const currentProfile = workspacePath && this.getStartupProject() === projectPath
            ? readStartupConfig(path.join(workspacePath, '.vscode', 'launch.json'))?.launchSettingsProfile
            : undefined;
        return profiles.find(p => p.name === currentProfile) ?? profiles[0];
    }

    /** The framework Start New Instance runs: on the startup project its chosen one, else the newest; null when unknown */
    static startFramework(projectPath: string): Promise<string | null> {
        const preferred = this.getStartupProject() === projectPath ? this.getActiveFramework() ?? undefined : undefined;
        return determineTargetFramework(projectPath, preferred);
    }

    /**
     * Starts the startup project through its "Startup" configuration (F5 / Ctrl+F5), which builds it first,
     * or the startup profile through the "Startup" compound (see updateStartupProfileConfiguration)
     */
    static async startStartupProject(noDebug: boolean): Promise<void> {
        const workspaceFolder = solutionWorkspaceFolder();
        if (workspaceFolder && await this.startStartupProfile(workspaceFolder, noDebug)) {
            return;
        }
        if (!workspaceFolder || !this.getStartupProject()) {
            vscode.window.showInformationMessage('There is no startup project. Right-click a project in the Solution Explorer and choose "Set as Startup Project".');
            return;
        }
        const startupConfig = readStartupConfig(path.join(workspaceFolder.uri.fsPath, '.vscode', 'launch.json'));
        const startupType = startupConfig?.type;
        const startupProfiles = readLaunchProfiles(path.dirname(this.getStartupProject()!));
        checkDevCertificateBeforeStart([startupProfiles.find(profile => profile.name === startupConfig?.launchSettingsProfile)]);
        if (startupType === 'mono' && !await ensureMonoDebugging()) {
            return;
        }
        await vscode.debug.startDebugging(workspaceFolder, 'Startup', { noDebug });
    }

    /** Starts the "Startup" compound when launch.json has one; false when it has none */
    private static async startStartupProfile(workspaceFolder: vscode.WorkspaceFolder, noDebug: boolean): Promise<boolean> {
        const launchJsonPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'launch.json');
        const compound = readStartupCompound(launchJsonPath);
        if (!compound) {
            return false;
        }
        const names = compoundConfigurationNames({ compounds: [compound] });
        if (names.length === 0) {
            vscode.window.showInformationMessage('The startup profile starts no project. Set the Action of a project to Start or Start Without Debugging.');
            return true;
        }
        const { value } = parseJsonc(fs.readFileSync(launchJsonPath, 'utf8'));
        const configs = (Array.isArray(value?.configurations) ? value.configurations : []).filter((config: any) => names.includes(config?.name));
        const types = configs.map((config: any) => config.type);
        checkDevCertificateBeforeStart(configs.map((config: any) => this.configurationLaunchProfile(config, workspaceFolder.uri.fsPath)));
        if (types.includes('mono') && !await ensureMonoDebugging()) {
            return true;
        }
        await vscode.debug.startDebugging(workspaceFolder, 'Startup', { noDebug });
        return true;
    }

    /** The launch profile a launch configuration of ours names (`launchSettingsProfile` in the project folder `cwd`) */
    private static configurationLaunchProfile(config: any, workspacePath: string): LaunchProfile | undefined {
        if (typeof config?.launchSettingsProfile !== 'string' || typeof config?.cwd !== 'string') {
            return undefined;
        }
        const projectDir = path.resolve(config.cwd.replace('${workspaceFolder}', workspacePath));
        return readLaunchProfiles(projectDir).find(profile => profile.name === config.launchSettingsProfile);
    }

    /**
     * Sets the active debug configuration in VS Code
     */
    private static async setActiveDebugConfiguration(_workspaceFolder: vscode.WorkspaceFolder, configName: string): Promise<void> {
        // Since we place the "Startup" configuration first in the launch.json array,
        // VS Code will automatically select it as the default. No additional action needed.
        log.info(`"${configName}" configuration is first in launch.json and will be selected by default`);
    }

    /**
     * The launch profile for the "Startup" configuration: the user's pick when `ask` is set and the project
     * has several, else the profile already configured (if it still exists), else the first one.
     * `preferred` stands in for the configured profile when launch.json has no "Startup" configuration.
     * Returns undefined without profiles and null when the user cancels the pick.
     */
    private static async pickLaunchProfile(projectDir: string, launchJsonPath: string, ask: boolean, preferred?: string): Promise<LaunchProfile | undefined | null> {
        const profiles = readLaunchProfiles(projectDir);
        if (profiles.length <= 1) {
            return profiles[0];
        }

        const current = readStartupConfig(launchJsonPath)?.launchSettingsProfile ?? preferred;
        if (ask) {
            const picked = await vscode.window.showQuickPick(
                profiles.map(profile => ({
                    label: profile.name,
                    description: profile.name === current ? `${profile.applicationUrl ?? ''} (current)`.trim() : profile.applicationUrl,
                    profile,
                })),
                { placeHolder: `Launch profile for ${path.basename(projectDir)}`, ignoreFocusOut: true }
            );
            return picked ? picked.profile : null;
        }

        return profiles.find(profile => profile.name === current) ?? profiles[0];
    }

    /** Whether the project has several launch profiles to choose from */
    static hasLaunchProfileChoice(projectPath: string): boolean {
        return readLaunchProfiles(path.dirname(projectPath)).length > 1;
    }

    /** The names of the launch profiles of the project that `dotnet run` can use, in the order of its launchSettings.json */
    static launchProfileNames(projectPath: string): string[] {
        return readLaunchProfiles(path.dirname(projectPath)).map(profile => profile.name);
    }

    /** Asks for another launch profile of the startup project, keeping its framework */
    static async chooseLaunchProfile(projectPath: string): Promise<void> {
        await this.updateStartupConfiguration(projectPath, this.getActiveFramework() ?? undefined, true);
    }

    /** The launch profile of the "Startup" configuration, if it has one */
    static getStartupLaunchProfile(): string | undefined {
        const workspacePath = solutionWorkspaceFolder()?.uri.fsPath;
        const profile = workspacePath ? readStartupConfig(path.join(workspacePath, '.vscode', 'launch.json'))?.launchSettingsProfile : undefined;
        return typeof profile === 'string' ? profile : undefined;
    }

}
