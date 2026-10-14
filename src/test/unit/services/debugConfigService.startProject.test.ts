import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const env = {
    workspacePath: '',
    /** Exit code of the build task; undefined lets it never finish */
    buildExitCode: 0 as number | undefined,
    builds: [] as string[],
    started: [] as { config: any; options: any }[],
    messages: [] as string[],
};

jest.mock('vscode', () => {
    const listeners = new Set<(event: any) => void>();
    return {
        workspace: {
            get workspaceFolders() { return [{ uri: { fsPath: env.workspacePath } }]; },
            getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
        },
        window: {
            showWarningMessage: async () => undefined,
            showErrorMessage: async (message: string) => { env.messages.push(message); },
            showInformationMessage: async (message: string) => { env.messages.push(message); },
            showQuickPick: async () => undefined,
        },
        tasks: {
            onDidEndTaskProcess: (listener: (event: any) => void) => {
                listeners.add(listener);
                return { dispose: () => listeners.delete(listener) };
            },
            executeTask: async (task: any) => {
                env.builds.push(task.definition.target);
                const execution = { task };
                if (env.buildExitCode !== undefined) {
                    setTimeout(() => [...listeners].forEach(listener => listener({ execution, exitCode: env.buildExitCode })));
                }
                return execution;
            },
        },
        debug: {
            startDebugging: async (_folder: unknown, config: any, options: any) => {
                env.started.push({ config, options });
                return true;
            },
        },
    };
}, { virtual: true });

jest.mock('../../../services/buildConfiguration', () => ({
    BuildConfiguration: { get active() { return 'Debug'; } },
}));

jest.mock('../../../services/dotnetTaskProvider', () => ({
    DOTNET_TASK_TYPE: 'shinobi-dotnet',
    createDotnetTask: (definition: any) => ({ definition }),
}));

import { DebugConfigService } from '../../../services/debugConfigService';

describe('DebugConfigService: starting a project that is not the startup project', () => {
    let apiPath: string;
    let workerPath: string;

    const writeProject = (name: string, frameworks: string, profiles?: Record<string, object>) => {
        const dir = path.join(env.workspacePath, name);
        fs.mkdirSync(path.join(dir, 'Properties'), { recursive: true });
        const projectPath = path.join(dir, `${name}.csproj`);
        fs.writeFileSync(projectPath, `<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFrameworks>${frameworks}</TargetFrameworks></PropertyGroup></Project>`);
        if (profiles) {
            fs.writeFileSync(path.join(dir, 'Properties', 'launchSettings.json'), JSON.stringify({ profiles }));
        }
        return projectPath;
    };

    beforeEach(() => {
        env.workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'start-project-'));
        env.buildExitCode = 0;
        env.builds = [];
        env.started = [];
        env.messages = [];
        apiPath = writeProject('Api', 'net10.0', {
            http: { commandName: 'Project', launchBrowser: true, launchUrl: 'swagger', applicationUrl: 'http://localhost:5181' },
            https: { commandName: 'Project', applicationUrl: 'https://localhost:7275' },
        });
        workerPath = writeProject('Worker', 'net8.0;net10.0');
    });

    afterEach(() => fs.rmSync(env.workspacePath, { recursive: true, force: true }));

    it('builds the project, then starts it with its first launch profile like Visual Studio', async () => {
        await DebugConfigService.startProject(apiPath, false);

        expect(env.builds).toEqual([apiPath]);
        expect(env.started).toHaveLength(1);
        const { config, options } = env.started[0];
        expect(options).toEqual({ noDebug: false });
        expect(config).toEqual(expect.objectContaining({
            name: 'Api',
            type: 'coreclr',
            request: 'launch',
            program: '${workspaceFolder}/Api/bin/Debug/net10.0/Api.dll',
            cwd: '${workspaceFolder}/Api',
            launchSettingsProfile: 'http',
            serverReadyAction: expect.objectContaining({ uriFormat: '%s/swagger' }),
        }));
        expect(config.preLaunchTask).toBeUndefined();
    });

    it('starts without debugging and on the newest framework of multi-targeted projects', async () => {
        await DebugConfigService.startProject(workerPath, true);

        const { config, options } = env.started[0];
        expect(options).toEqual({ noDebug: true });
        expect(config.program).toBe('${workspaceFolder}/Worker/bin/Debug/net10.0/Worker.dll');
        expect(config.launchSettingsProfile).toBeUndefined();
        expect(config.args).toEqual([]);
    });

    it('does not start when the build fails', async () => {
        env.buildExitCode = 1;

        await DebugConfigService.startProject(apiPath, false);

        expect(env.started).toEqual([]);
        expect(env.messages).toEqual([expect.stringContaining('Api')]);
    });

    it('uses the launch profile and framework of the startup project for it', async () => {
        env.started = [];
        // The startup configuration was set to https and net8.0 earlier
        fs.writeFileSync(apiPath, '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFrameworks>net8.0;net10.0</TargetFrameworks></PropertyGroup></Project>');
        fs.mkdirSync(path.join(env.workspacePath, '.vscode'));
        fs.writeFileSync(path.join(env.workspacePath, '.vscode', 'launch.json'), JSON.stringify({
            configurations: [{ name: 'Startup', type: 'coreclr', request: 'launch', launchSettingsProfile: 'https' }],
        }));
        fs.writeFileSync(path.join(env.workspacePath, '.vscode', 'tasks.json'), JSON.stringify({
            tasks: [{ label: 'StartupPreBuild', args: ['build', path.join('Api', 'Api.csproj'), '--framework', 'net8.0'] }],
        }));

        await DebugConfigService.startProject(apiPath, false);

        const { config } = env.started[0];
        expect(config.launchSettingsProfile).toBe('https');
        expect(config.program).toBe('${workspaceFolder}/Api/bin/Debug/net8.0/Api.dll');
    });
});

describe('DebugConfigService.startStartupProject (Ctrl+F5)', () => {
    beforeEach(() => {
        env.workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'start-startup-'));
        env.started = [];
        env.messages = [];
    });

    afterEach(() => fs.rmSync(env.workspacePath, { recursive: true, force: true }));

    it('runs the Startup configuration, whose pre-launch task builds', async () => {
        fs.mkdirSync(path.join(env.workspacePath, '.vscode'));
        fs.writeFileSync(path.join(env.workspacePath, '.vscode', 'launch.json'), JSON.stringify({
            configurations: [{ name: 'Startup', type: 'coreclr', request: 'launch' }],
        }));
        fs.writeFileSync(path.join(env.workspacePath, '.vscode', 'tasks.json'), JSON.stringify({
            tasks: [{ label: 'StartupPreBuild', args: ['build', 'Api/Api.csproj'] }],
        }));

        await DebugConfigService.startStartupProject(true);

        expect(env.started).toEqual([{ config: 'Startup', options: { noDebug: true } }]);
    });

    it('asks for a startup project when there is none', async () => {
        await DebugConfigService.startStartupProject(true);

        expect(env.started).toEqual([]);
        expect(env.messages).toEqual([expect.stringContaining('Set as Startup Project')]);
    });
});
