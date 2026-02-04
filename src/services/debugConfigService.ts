import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../core/logger';
import { parseStringPromise } from 'xml2js';
import { VersionUtils } from './versionUtils';

const log = logger('DebugConfigService');

export class DebugConfigService {
    /**
     * Gets the current startup project from launch.json
     */
    static getStartupProjectFromLaunchJson(): string | null {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return null;
            }

            const workspacePath = workspaceFolder.uri.fsPath;
            const launchJsonPath = path.join(workspacePath, '.vscode', 'launch.json');

            if (!fs.existsSync(launchJsonPath)) {
                return null;
            }

            const content = fs.readFileSync(launchJsonPath, 'utf8');
            let launchConfig;
            try {
                launchConfig = JSON.parse(content);
            } catch (parseError) {
                log.error(`Failed to parse launch.json for reading startup project - invalid JSON (possibly trailing commas?):`, parseError);
                return null;
            }

            // Find the "Startup" configuration
            const startupConfig = launchConfig.configurations?.find(
                (config: any) => config.name === 'Startup' && (config.type === 'coreclr' || config.type === 'clr' || config.type === 'mono')
            );

            if (!startupConfig) {
                return null;
            }

            // Extract project path from the program path
            // program format: "${workspaceFolder}/path/to/project/bin/Debug/net*/ProjectName.dll"
            const programPath = startupConfig.program;
            if (!programPath || typeof programPath !== 'string') {
                return null;
            }

            // Extract project directory from program path
            const match = programPath.match(/\$\{workspaceFolder\}\/(.+?)\/bin\/Debug/);
            if (!match) {
                return null;
            }

            const projectDir = match[1];

            // Get project name from the program DLL name
            const dllMatch = programPath.match(/\/([^\/]+)\.dll$/);
            if (!dllMatch) {
                return null;
            }

            const projectName = dllMatch[1];
            const projectPath = `${projectDir}/${projectName}.csproj`;

            // Convert to absolute path for comparison
            const absoluteProjectPath = path.resolve(workspacePath, projectPath);

            log.info(`Found startup project from launch.json: ${projectPath} -> ${absoluteProjectPath}`);
            log.debug(`Program path was: ${programPath}`);
            return absoluteProjectPath;
        } catch (error) {
            log.error('Error reading startup project from launch.json:', error);
            return null;
        }
    }

    /**
     * Gets the current active framework from launch.json
     */
    static getActiveFrameworkFromLaunchJson(): string | null {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return null;
            }

            const workspacePath = workspaceFolder.uri.fsPath;
            const launchJsonPath = path.join(workspacePath, '.vscode', 'launch.json');

            if (!fs.existsSync(launchJsonPath)) {
                return null;
            }

            const content = fs.readFileSync(launchJsonPath, 'utf8');
            let launchConfig;
            try {
                launchConfig = JSON.parse(content);
            } catch (parseError) {
                log.error(`Failed to parse launch.json for reading active framework - invalid JSON (possibly trailing commas?):`, parseError);
                return null;
            }

            // Find the "Startup" configuration
            const startupConfig = launchConfig.configurations?.find(
                (config: any) => config.name === 'Startup' && (config.type === 'coreclr' || config.type === 'clr' || config.type === 'mono')
            );

            if (!startupConfig) {
                return null;
            }

            // Extract framework from the program path
            // program format: "${workspaceFolder}/path/to/project/bin/Debug/net8.0/ProjectName.dll"
            const programPath = startupConfig.program;
            if (!programPath || typeof programPath !== 'string') {
                return null;
            }

            const frameworkMatch = programPath.match(/\/bin\/Debug\/([^\/]+)\//);
            if (frameworkMatch) {
                const framework = frameworkMatch[1];
                log.info(`Found active framework from launch.json: ${framework}`);
                return framework;
            }

            return null;
        } catch (error) {
            log.error('Error reading active framework from launch.json:', error);
            return null;
        }
    }

    /**
     * Updates the workspace launch.json with the "Startup" configuration
     */
    static async updateStartupConfiguration(startupProjectPath: string, framework?: string): Promise<void> {
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

            // Ensure .vscode folder exists
            if (!fs.existsSync(vscodeFolder)) {
                fs.mkdirSync(vscodeFolder, { recursive: true });
            }

            // Convert relative path to absolute path
            const absoluteProjectPath = path.isAbsolute(startupProjectPath)
                ? startupProjectPath
                : path.join(workspacePath, startupProjectPath);

            // Get project directory and assembly name
            const projectDir = path.dirname(absoluteProjectPath);
            const projectName = path.basename(absoluteProjectPath, path.extname(absoluteProjectPath));
            const relativeProjectPath = path.relative(workspacePath, absoluteProjectPath);
            const relativeProjectDir = path.relative(workspacePath, projectDir);

            // Determine the best framework to use
            const selectedFramework = await this.determineTargetFramework(absoluteProjectPath, framework);
            log.info(`Selected framework for startup project: ${selectedFramework}`);

            // Determine framework path - use specific framework if selected, otherwise use wildcard
            const frameworkPath = selectedFramework || 'net*';

            // Determine if we should use .exe or .dll based on framework type
            const isNetFramework = this.isNetFramework(selectedFramework);
            const programExtension = isNetFramework ? 'exe' : 'dll';

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

            // Read launch settings to get command line arguments and other settings
            const launchSettings = await this.readLaunchSettings(projectDir);
            log.info(`Launch settings loaded:`, launchSettings);

            // Create the "Startup" configuration
            const startupConfig = {
                name: 'Startup',
                type: debugType,
                request: 'launch',
                program: `\${workspaceFolder}/${relativeProjectDir}/bin/Debug/${frameworkPath}/${projectName}.${programExtension}`,
                args: launchSettings.commandLineArgs || [],
                cwd: `\${workspaceFolder}/${relativeProjectDir}`,
                console: 'integratedTerminal',
                ...(debugType !== 'mono' && { stopAtEntry: false }), // mono type doesn't support stopAtEntry
                preLaunchTask: 'StartupPreBuild',
                ...(launchSettings.environmentVariables && Object.keys(launchSettings.environmentVariables).length > 0 && {
                    env: launchSettings.environmentVariables
                })
            };

            let launchConfig;
            if (fs.existsSync(launchJsonPath)) {
                // Read existing launch.json
                try {
                    const content = fs.readFileSync(launchJsonPath, 'utf8');
                    launchConfig = JSON.parse(content);
                    log.info('Successfully parsed existing launch.json');
                } catch (parseError) {
                    log.error(`Failed to parse launch.json - invalid JSON (possibly trailing commas?):`, parseError);
                    // Create backup and start fresh
                    const backupPath = `${launchJsonPath}.backup`;
                    fs.copyFileSync(launchJsonPath, backupPath);
                    log.info(`Created backup at: ${backupPath}`);

                    launchConfig = {
                        version: '0.2.0',
                        configurations: []
                    };
                }
            } else {
                // Create new launch.json
                launchConfig = {
                    version: '0.2.0',
                    configurations: []
                };
            }

            // Remove any existing "Startup" configuration
            launchConfig.configurations = launchConfig.configurations.filter(
                (config: any) => config.name !== 'Startup'
            );

            // Add the new "Startup" configuration at the beginning (makes it default)
            launchConfig.configurations.unshift(startupConfig);

            // Check if launch.json content actually changed before writing
            const newLaunchContent = JSON.stringify(launchConfig, null, 2);
            let shouldWriteLaunch = true;

            if (fs.existsSync(launchJsonPath)) {
                try {
                    const existingContent = fs.readFileSync(launchJsonPath, 'utf8');
                    if (existingContent === newLaunchContent) {
                        shouldWriteLaunch = false;
                        log.info('launch.json content unchanged, skipping write');
                    }
                } catch (error) {
                    log.warn('Error reading existing launch.json for comparison:', error);
                }
            }

            // Write back to launch.json only if content changed
            if (shouldWriteLaunch) {
                log.info(`Writing to launch.json at: ${launchJsonPath}`);
                log.debug(`Launch config:`, newLaunchContent);
                fs.writeFileSync(launchJsonPath, newLaunchContent, 'utf8');
            }

            // Create/update tasks.json with the StartupPreBuild task
            await this.updateTasksJson(tasksJsonPath, relativeProjectPath, selectedFramework || undefined);

            log.info(`Updated "Startup" configuration: project=${projectName}, framework=${selectedFramework || 'auto'}`);

            // Set the "Startup" configuration as the active debug configuration
            await this.setActiveDebugConfiguration(workspaceFolder, 'Startup');
        } catch (error) {
            log.error('Error updating startup configuration:', error);
        }
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
    private static async updateTasksJson(tasksJsonPath: string, projectPath: string, framework?: string | undefined): Promise<void> {
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
                    '/property:GenerateFullPaths=true',
                    '/consoleloggerparameters:NoSummary'
                ],
                group: 'build',
                presentation: {
                    reveal: 'silent'
                },
                problemMatcher: '$msCompile'
            };

            let tasksConfig;
            if (fs.existsSync(tasksJsonPath)) {
                // Read existing tasks.json
                try {
                    const content = fs.readFileSync(tasksJsonPath, 'utf8');
                    tasksConfig = JSON.parse(content);
                } catch (parseError) {
                    log.error(`Failed to parse tasks.json - invalid JSON:`, parseError);
                    // Create backup and start fresh
                    const backupPath = `${tasksJsonPath}.backup`;
                    fs.copyFileSync(tasksJsonPath, backupPath);
                    log.info(`Created backup at: ${backupPath}`);

                    tasksConfig = {
                        version: '2.0.0',
                        tasks: []
                    };
                }
            } else {
                // Create new tasks.json
                tasksConfig = {
                    version: '2.0.0',
                    tasks: []
                };
            }

            // Remove any existing StartupPreBuild task
            tasksConfig.tasks = tasksConfig.tasks.filter(
                (task: any) => task.label !== 'StartupPreBuild'
            );

            // Add the new StartupPreBuild task
            tasksConfig.tasks.push(prebuildTask);

            // Check if tasks.json content actually changed before writing
            const newTasksContent = JSON.stringify(tasksConfig, null, 2);
            let shouldWriteTasks = true;

            if (fs.existsSync(tasksJsonPath)) {
                try {
                    const existingContent = fs.readFileSync(tasksJsonPath, 'utf8');
                    if (existingContent === newTasksContent) {
                        shouldWriteTasks = false;
                        log.info('tasks.json content unchanged, skipping write');
                    }
                } catch (error) {
                    log.warn('Error reading existing tasks.json for comparison:', error);
                }
            }

            // Write back to tasks.json only if content changed
            if (shouldWriteTasks) {
                log.info(`Writing to tasks.json at: ${tasksJsonPath}`);
                fs.writeFileSync(tasksJsonPath, newTasksContent, 'utf8');
                log.info(`Updated StartupPreBuild task for project: ${projectPath}, framework: ${framework || 'auto'}`);
            } else {
                log.info(`StartupPreBuild task already up to date for project: ${projectPath}, framework: ${framework || 'auto'}`);
            }
        } catch (error) {
            log.error('Error updating tasks.json:', error);
        }
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
     * Reads launchSettings.json from the Properties folder of a project
     */
    private static async readLaunchSettings(projectDir: string): Promise<{
        commandLineArgs?: string[];
        environmentVariables?: Record<string, string>;
        workingDirectory?: string;
        launchBrowser?: boolean;
        launchUrl?: string;
    }> {
        try {
            const launchSettingsPath = path.join(projectDir, 'Properties', 'launchSettings.json');

            if (!fs.existsSync(launchSettingsPath)) {
                log.info(`No launchSettings.json found at: ${launchSettingsPath}`);
                return {};
            }

            const content = fs.readFileSync(launchSettingsPath, 'utf8');
            let launchSettings;
            try {
                launchSettings = JSON.parse(content);
            } catch (parseError) {
                log.error(`Failed to parse launchSettings.json:`, parseError);
                return {};
            }

            // Extract settings from the default profile or the first available profile
            let selectedProfile;

            // Try to find the project name profile first (most common default)
            const projectName = path.basename(projectDir);
            if (launchSettings.profiles && launchSettings.profiles[projectName]) {
                selectedProfile = launchSettings.profiles[projectName];
                log.info(`Using launch profile: ${projectName}`);
            }
            // Try "Project" profile
            else if (launchSettings.profiles && launchSettings.profiles['Project']) {
                selectedProfile = launchSettings.profiles['Project'];
                log.info(`Using launch profile: Project`);
            }
            // Use the first available profile
            else if (launchSettings.profiles) {
                const firstProfileKey = Object.keys(launchSettings.profiles)[0];
                if (firstProfileKey) {
                    selectedProfile = launchSettings.profiles[firstProfileKey];
                    log.info(`Using first available launch profile: ${firstProfileKey}`);
                }
            }

            if (!selectedProfile) {
                log.info('No suitable launch profile found in launchSettings.json');
                return {};
            }

            const result: any = {};

            // Extract command line arguments
            if (selectedProfile.commandLineArgs) {
                // Parse command line args string into array
                result.commandLineArgs = this.parseCommandLineArgs(selectedProfile.commandLineArgs);
            }

            // Extract environment variables
            if (selectedProfile.environmentVariables && typeof selectedProfile.environmentVariables === 'object') {
                result.environmentVariables = selectedProfile.environmentVariables;
            }

            // Extract working directory
            if (selectedProfile.workingDirectory) {
                result.workingDirectory = selectedProfile.workingDirectory;
            }

            // Extract browser settings (for web projects)
            if (selectedProfile.launchBrowser !== undefined) {
                result.launchBrowser = selectedProfile.launchBrowser;
            }

            if (selectedProfile.launchUrl) {
                result.launchUrl = selectedProfile.launchUrl;
            }

            log.info(`Extracted launch settings:`, result);
            return result;

        } catch (error) {
            log.error(`Error reading launchSettings.json from ${projectDir}:`, error);
            return {};
        }
    }

    /**
     * Parses command line arguments string into an array
     */
    private static parseCommandLineArgs(argsString: string): string[] {
        if (!argsString || typeof argsString !== 'string') {
            return [];
        }

        // Simple parsing - split by spaces but respect quoted arguments
        const args: string[] = [];
        let current = '';
        let inQuotes = false;
        let quoteChar = '';

        for (let i = 0; i < argsString.length; i++) {
            const char = argsString[i];

            if (!inQuotes && (char === '"' || char === "'")) {
                inQuotes = true;
                quoteChar = char;
            } else if (inQuotes && char === quoteChar) {
                inQuotes = false;
                quoteChar = '';
            } else if (!inQuotes && char === ' ') {
                if (current.trim()) {
                    args.push(current.trim());
                    current = '';
                }
            } else {
                current += char;
            }
        }

        if (current.trim()) {
            args.push(current.trim());
        }

        return args;
    }
}