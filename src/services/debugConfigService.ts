import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../core/logger';
import { parseStringPromise } from 'xml2js';
import { VersionUtils } from './versionUtils';
import { parseJsonc, upsertArrayItem } from '../core/jsonc';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { BuildConfiguration } from './buildConfiguration';
import { createDotnetTask, DOTNET_TASK_TYPE } from './dotnetTaskProvider';
import { runTask } from './runTask';
import { EMIT_GENERATED_FILES } from './analyzers';

const execFileAsync = promisify(execFile);

const log = logger('DebugConfigService');

export class DebugConfigService {
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
            const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!workspacePath) {
                return undefined;
            }
            const vscodeFolder = path.join(workspacePath, '.vscode');
            const startupConfig = this.readStartupConfig(path.join(vscodeFolder, 'launch.json'));
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
     * several; otherwise the profile already in the configuration is kept. Cancelling the pick changes nothing.
     */
    static async updateStartupConfiguration(startupProjectPath: string, framework?: string, askForProfile = false): Promise<void> {
        try {
            log.info(`updateStartupConfiguration called with project: ${startupProjectPath}, framework: ${framework}`);

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                log.error('No workspace folder found');
                return;
            }

            log.info(`Workspace folder: ${workspaceFolder.uri.fsPath}`);

            const workspacePath = workspaceFolder.uri.fsPath;
            const vscodeFolder = path.join(workspacePath, '.vscode');
            const launchJsonPath = path.join(vscodeFolder, 'launch.json');
            const tasksJsonPath = path.join(vscodeFolder, 'tasks.json');

            const absoluteProjectPath = path.isAbsolute(startupProjectPath)
                ? startupProjectPath
                : path.join(workspacePath, startupProjectPath);
            const profile = await this.pickLaunchProfile(path.dirname(absoluteProjectPath), launchJsonPath, askForProfile);
            if (profile === null) {
                log.info('Launch profile choice cancelled, startup configuration unchanged');
                return;
            }

            // Ensure .vscode folder exists
            if (!fs.existsSync(vscodeFolder)) {
                fs.mkdirSync(vscodeFolder, { recursive: true });
            }


            const relativeProjectPath = path.relative(workspacePath, absoluteProjectPath);
            const { config: startupConfig, framework: selectedFramework, configuration } =
                await this.launchConfiguration(absoluteProjectPath, workspacePath, framework, profile, 'Startup', 'StartupPreBuild');

            // tasks.json first: it names the startup project, which is read back when launch.json changes
            await this.updateTasksJson(tasksJsonPath, relativeProjectPath, configuration, selectedFramework || undefined);

            // A new "Startup" goes first so VS Code selects it by default; an existing one is updated where it is
            this.upsertJsoncArrayItem(
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
        } catch (error) {
            log.error('Error updating startup configuration:', error);
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
        const selectedFramework = await this.determineTargetFramework(projectPath, framework);
        log.info(`Selected framework for ${projectPath}: ${selectedFramework}`);

        const configuration = BuildConfiguration.active;
        const targetPath = await this.resolveTargetPath(projectPath, configuration, selectedFramework);
        const relativeTargetPath = path.relative(workspacePath, targetPath);
        const program = relativeTargetPath.startsWith('..') || path.isAbsolute(relativeTargetPath)
            ? targetPath
            : `\${workspaceFolder}/${relativeTargetPath.split(path.sep).join('/')}`;

        const isNetFramework = this.isNetFramework(selectedFramework);

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

        const config = {
            name,
            type: debugType,
            request: 'launch',
            program,
            ...(profile ? { launchSettingsProfile: profile.name } : { args: [] }),
            cwd: `\${workspaceFolder}/${relativeProjectDir}`,
            console: 'integratedTerminal',
            ...(debugType !== 'mono' && { stopAtEntry: false }), // mono type doesn't support stopAtEntry
            ...(preLaunchTask && { preLaunchTask }),
            ...(profile?.launchBrowser && { serverReadyAction: this.browserAction(profile.launchUrl) })
        };
        return { config, framework: selectedFramework, configuration };
    }

    /**
     * Visual Studio's "Debug > Start New Instance" / "Start Without Debugging" on a project: builds it and
     * starts it next to whatever already runs, without making it the startup project. The startup project
     * keeps its launch profile and framework; other projects use their first profile and newest framework.
     */
    static async startProject(projectPath: string, noDebug: boolean): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }
        const projectName = path.basename(projectPath, path.extname(projectPath));
        const isStartup = this.getStartupProject() === projectPath;
        const profiles = this.readLaunchProfiles(path.dirname(projectPath));
        const currentProfile = isStartup
            ? this.readStartupConfig(path.join(workspaceFolder.uri.fsPath, '.vscode', 'launch.json'))?.launchSettingsProfile
            : undefined;
        const profile = profiles.find(p => p.name === currentProfile) ?? profiles[0];

        const exitCode = await runTask(createDotnetTask({ type: DOTNET_TASK_TYPE, action: 'build', target: projectPath }));
        if (exitCode !== 0) {
            vscode.window.showErrorMessage(`${projectName} was not started, its build failed. See the Problems panel.`);
            return;
        }

        const framework = isStartup ? this.getActiveFramework() ?? undefined : undefined;
        const { config } = await this.launchConfiguration(projectPath, workspaceFolder.uri.fsPath, framework, profile);
        await vscode.debug.startDebugging(workspaceFolder, config, { noDebug });
    }

    /** Starts the startup project through its "Startup" configuration (F5 / Ctrl+F5), which builds it first */
    static async startStartupProject(noDebug: boolean): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder || !this.getStartupProject()) {
            vscode.window.showInformationMessage('There is no startup project. Right-click a project in the Solution Explorer and choose "Set as Startup Project".');
            return;
        }
        await vscode.debug.startDebugging(workspaceFolder, 'Startup', { noDebug });
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
     * The assembly the project builds for a configuration and framework, as MSBuild evaluates it
     * (`TargetPath`): respects OutputPath, AssemblyName, the artifacts layout and Directory.Build.props.
     * Falls back to the default `bin/<configuration>/<framework>/<project>.dll` when evaluation fails.
     */
    private static async resolveTargetPath(projectPath: string, configuration: string, framework: string | null): Promise<string> {
        const projectDir = path.dirname(projectPath);
        const fallback = path.join(projectDir, 'bin', configuration, framework || 'net*',
            `${path.basename(projectPath, path.extname(projectPath))}.${this.isNetFramework(framework) ? 'exe' : 'dll'}`);
        try {
            const { stdout } = await execFileAsync('dotnet', [
                'msbuild', projectPath, '-nologo', '-getProperty:TargetPath',
                `-property:Configuration=${configuration}`,
                ...(framework ? [`-property:TargetFramework=${framework}`] : []),
            ], { cwd: projectDir, timeout: 60000 });
            const targetPath = stdout.trim().split(/\r?\n/).pop()?.trim();
            if (targetPath && path.isAbsolute(targetPath)) {
                return targetPath;
            }
            log.warn(`MSBuild returned no TargetPath for ${projectPath}, using ${fallback}`);
        } catch (error) {
            log.warn(`Could not evaluate the output path of ${projectPath}, using ${fallback}:`, error);
        }
        return fallback;
    }

    /**
     * Determines the best target framework for the project
     */
    private static async determineTargetFramework(projectPath: string, preferredFramework?: string): Promise<string | null> {
        try {
            // Parse the project file to get its target frameworks
            const frameworks = await this.extractTargetFrameworks(projectPath);

            if (!frameworks || frameworks.length === 0) {
                log.warn(`No target frameworks found in project: ${projectPath}`);
                return preferredFramework || null;
            }

            log.info(`Available frameworks in project: ${frameworks.join(', ')}`);

            // If a specific framework is preferred and it exists in the project, use it
            if (preferredFramework && preferredFramework !== 'auto' && frameworks.includes(preferredFramework)) {
                log.info(`Using preferred framework: ${preferredFramework}`);
                return preferredFramework;
            }

            // If preference is 'auto' or not specified, pick the highest version
            const sortedFrameworks = this.sortFrameworksByVersion(frameworks);
            const selectedFramework = sortedFrameworks[0]; // Highest version first

            log.info(`Auto-selected highest framework version: ${selectedFramework}`);
            return selectedFramework;
        } catch (error) {
            log.error('Error determining target framework:', error);
            return preferredFramework || null;
        }
    }

    /**
     * Sorts frameworks by version, highest first (uses same logic as NuGet version sorting)
     */
    private static sortFrameworksByVersion(frameworks: string[]): string[] {
        return frameworks.sort((a, b) => {
            // Convert framework names to version-like strings for comparison
            const normalizeFramework = (fw: string): string => {
                // Handle modern .NET (net5.0, net6.0, net7.0, net8.0, net9.0, etc.)
                const modernMatch = fw.match(/^net(\d+)\.(\d+)$/);
                if (modernMatch) {
                    // Prefix with high number to prioritize over older frameworks
                    return `9.${modernMatch[1]}.${modernMatch[2]}`;
                }

                // Handle .NET Core (netcoreapp3.1, netcoreapp2.1, etc.)
                const coreMatch = fw.match(/^netcoreapp(\d+)\.(\d+)$/);
                if (coreMatch) {
                    // Medium priority
                    return `5.${coreMatch[1]}.${coreMatch[2]}`;
                }

                // Handle .NET Framework (net472, net48, net481, etc.)
                const frameworkMatch = fw.match(/^net(\d)(\d)(\d+)?$/);
                if (frameworkMatch) {
                    const major = frameworkMatch[1];
                    const minor = frameworkMatch[2];
                    const patch = frameworkMatch[3] || '0';
                    // Lower priority
                    return `2.${major}.${minor}.${patch}`;
                }

                // Handle .NET Standard (netstandard2.0, netstandard2.1, etc.)
                const standardMatch = fw.match(/^netstandard(\d+)\.(\d+)$/);
                if (standardMatch) {
                    // Lowest priority
                    return `1.${standardMatch[1]}.${standardMatch[2]}`;
                }

                // Unknown framework type - very low priority
                return `0.0.0`;
            };

            const versionA = normalizeFramework(a);
            const versionB = normalizeFramework(b);

            // Use the same version comparison as NuGet (newest first)
            return VersionUtils.compare(versionA, versionB);
        });
    }

    /**
     * Determines if a framework is .NET Framework (which produces .exe) vs modern .NET (which produces .dll)
     */
    private static isNetFramework(framework: string | null): boolean {
        if (!framework) return false;

        // .NET Framework patterns: net472, net48, net481, etc.
        return /^net\d\d\d+$/.test(framework);
    }

    /**
     * Updates tasks.json with the StartupPreBuild task
     */
    private static async updateTasksJson(tasksJsonPath: string, projectPath: string, configuration: string, framework?: string | undefined): Promise<void> {
        try {
            // Create the StartupPreBuild task
            const prebuildTask = {
                label: 'StartupPreBuild',
                command: 'dotnet',
                type: 'process',
                args: [
                    'build',
                    projectPath,
                    ...(framework ? ['--framework', framework] : []),
                    '--configuration', configuration,
                    '/property:GenerateFullPaths=true',
                    '/consoleloggerparameters:NoSummary',
                    EMIT_GENERATED_FILES
                ],
                presentation: {
                    reveal: 'silent'
                },
                problemMatcher: '$msCompile'
            };

            this.upsertJsoncArrayItem(
                tasksJsonPath,
                { version: '2.0.0', tasks: [] },
                'tasks',
                (task: any) => task?.label === 'StartupPreBuild',
                prebuildTask,
                'last'
            );
        } catch (error) {
            log.error('Error updating tasks.json:', error);
        }
    }

    /**
     * Writes `item` into the array `arrayKey` of a launch.json/tasks.json-style file, replacing the entry
     * matched by `isMatch`. Comments and all other content are kept; a file with syntax errors is left alone.
     */
    private static upsertJsoncArrayItem(
        filePath: string,
        emptyFile: Record<string, unknown>,
        arrayKey: string,
        isMatch: (item: any) => boolean,
        item: unknown,
        position: 'first' | 'last'
    ): void {
        const fileName = path.basename(filePath);

        if (!fs.existsSync(filePath)) {
            log.info(`Creating ${filePath}`);
            fs.writeFileSync(filePath, JSON.stringify({ ...emptyFile, [arrayKey]: [item] }, null, 4) + '\n', 'utf8');
            return;
        }

        const text = fs.readFileSync(filePath, 'utf8');
        const { errors } = parseJsonc(text);
        if (errors.length > 0) {
            log.error(`Not updating ${filePath}, it has syntax errors:`, errors);
            vscode.window.showWarningMessage(`.vscode/${fileName} has syntax errors and was not updated. Fix them and select the startup project again.`);
            return;
        }

        const updated = upsertArrayItem(text, arrayKey, isMatch, item, position);
        if (updated === text) {
            log.info(`${fileName} already up to date`);
            return;
        }

        log.info(`Writing ${filePath}`);
        fs.writeFileSync(filePath, updated, 'utf8');
    }

    /**
     * Extracts target frameworks from a project file
     */
    static async extractTargetFrameworks(projectPath: string): Promise<string[]> {
        try {
            if (!fs.existsSync(projectPath)) {
                log.warn(`Project file does not exist: ${projectPath}`);
                return [];
            }

            const projectXml = await fs.promises.readFile(projectPath, 'utf8');
            const parsed = await parseStringPromise(projectXml);

            const frameworks: string[] = [];

            // Navigate through PropertyGroups to find TargetFramework(s)
            if (parsed.Project && parsed.Project.PropertyGroup) {
                const propertyGroups = Array.isArray(parsed.Project.PropertyGroup)
                    ? parsed.Project.PropertyGroup
                    : [parsed.Project.PropertyGroup];

                for (const group of propertyGroups) {
                    // Check for TargetFrameworks (plural) first
                    if (group.TargetFrameworks) {
                        const frameworksValue = Array.isArray(group.TargetFrameworks)
                            ? group.TargetFrameworks[0]
                            : group.TargetFrameworks;
                        const multiple = frameworksValue.split(';')
                            .map((f: string) => f.trim())
                            .filter((f: string) => f);
                        frameworks.push(...multiple);
                    }
                    // Then check for TargetFramework (singular)
                    else if (group.TargetFramework) {
                        const frameworkValue = Array.isArray(group.TargetFramework)
                            ? group.TargetFramework[0]
                            : group.TargetFramework;
                        frameworks.push(frameworkValue.trim());
                    }
                }
            }

            return frameworks;
        } catch (error) {
            log.error(`Error extracting target frameworks from ${projectPath}:`, error);
            return [];
        }
    }

    /**
     * The launch profile for the "Startup" configuration: the user's pick when `ask` is set and the project
     * has several, else the profile already configured (if it still exists), else the first one.
     * Returns undefined without profiles and null when the user cancels the pick.
     */
    private static async pickLaunchProfile(projectDir: string, launchJsonPath: string, ask: boolean): Promise<LaunchProfile | undefined | null> {
        const profiles = this.readLaunchProfiles(projectDir);
        if (profiles.length <= 1) {
            return profiles[0];
        }

        const current = this.readStartupConfig(launchJsonPath)?.launchSettingsProfile;
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
        return this.readLaunchProfiles(path.dirname(projectPath)).length > 1;
    }

    /** Asks for another launch profile of the startup project, keeping its framework */
    static async chooseLaunchProfile(projectPath: string): Promise<void> {
        await this.updateStartupConfiguration(projectPath, this.getActiveFramework() ?? undefined, true);
    }

    /** The "Startup" configuration currently in launch.json, if any */
    private static readStartupConfig(launchJsonPath: string): any {
        if (!fs.existsSync(launchJsonPath)) {
            return undefined;
        }
        const { value } = parseJsonc(fs.readFileSync(launchJsonPath, 'utf8'));
        return value?.configurations?.find((config: any) => config?.name === 'Startup');
    }

    /**
     * Profiles of Properties/launchSettings.json that `dotnet run` can launch (`commandName: "Project"`);
     * IIS Express, Docker and similar profiles don't apply
     */
    private static readLaunchProfiles(projectDir: string): LaunchProfile[] {
        const launchSettingsPath = path.join(projectDir, 'Properties', 'launchSettings.json');
        if (!fs.existsSync(launchSettingsPath)) {
            return [];
        }

        const { value, errors } = parseJsonc(fs.readFileSync(launchSettingsPath, 'utf8'));
        if (errors.length > 0 || !value?.profiles || typeof value.profiles !== 'object') {
            log.warn(`Ignoring ${launchSettingsPath}: ${errors.join(', ') || 'no profiles'}`);
            return [];
        }

        return Object.entries(value.profiles as Record<string, any>)
            .filter(([, profile]) => profile?.commandName === 'Project')
            .map(([name, profile]) => ({
                name,
                applicationUrl: typeof profile.applicationUrl === 'string' ? profile.applicationUrl : undefined,
                launchBrowser: profile.launchBrowser === true,
                launchUrl: typeof profile.launchUrl === 'string' ? profile.launchUrl : undefined,
            }));
    }

    /**
     * Opens the browser once the app logs its first URL, like Visual Studio's launchBrowser:
     * at `launchUrl` relative to that URL, or at `launchUrl` itself when it is absolute
     */
    private static browserAction(launchUrl: string | undefined) {
        return {
            action: 'openExternally',
            pattern: '\\bNow listening on:\\s+(https?://\\S+)',
            uriFormat: !launchUrl ? '%s' : /^https?:\/\//i.test(launchUrl) ? launchUrl : `%s/${launchUrl.replace(/^\//, '')}`,
        };
    }
}

interface LaunchProfile {
    readonly name: string;
    readonly applicationUrl?: string;
    readonly launchBrowser: boolean;
    readonly launchUrl?: string;
}
