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
    /** Whether Mono and the Mono Debug extension are available */
    monoOk: true,
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

jest.mock('../../../../services/debug/monoDebug', () => ({
    ...jest.requireActual('../../../../services/debug/monoDebug'),
    ensureMonoDebugging: async () => env.monoOk,
}));

jest.mock('../../../../services/build/buildConfiguration', () => ({
    BuildConfiguration: { get active() { return 'Debug'; } },
}));

jest.mock('../../../../services/build/dotnetTaskProvider', () => ({
    DOTNET_TASK_TYPE: 'shinobi-dotnet',
    createDotnetTask: (definition: any) => ({ definition }),
}));

const devCertChecks: any[][] = [];
jest.mock('../../../../services/debug/devCert/devCertCheck', () => ({
    checkDevCertificateBeforeStart: (profiles: any[]) => { devCertChecks.push(profiles); },
}));

import { DebugConfigService } from '../../../../services/debug/debugConfigService';

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
        env.workspacePath = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'start-project-')));
        env.buildExitCode = 0;
        env.builds = [];
        env.started = [];
        env.messages = [];
        devCertChecks.length = 0;
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

    it('hands the launch profile to the HTTPS certificate check without waiting for it', async () => {
        await DebugConfigService.startProject(apiPath, false);

        expect(devCertChecks).toEqual([[expect.objectContaining({ name: 'http', applicationUrl: 'http://localhost:5181' })]]);
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

// On Windows .NET Framework programs run natively (the `clr` type), Mono is for Linux and macOS
const describeMono = process.platform === 'win32' ? describe.skip : describe;

describeMono('DebugConfigService: .NET Framework projects with Mono', () => {
    let appPath: string;

    beforeEach(() => {
        env.workspacePath = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'start-mono-')));
        env.buildExitCode = 0;
        env.builds = [];
        env.started = [];
        env.messages = [];
        env.monoOk = true;
        const dir = path.join(env.workspacePath, 'Legacy');
        fs.mkdirSync(path.join(dir, 'Properties'), { recursive: true });
        appPath = path.join(dir, 'Legacy.csproj');
        fs.writeFileSync(appPath, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net48</TargetFramework></PropertyGroup></Project>');
        fs.writeFileSync(path.join(dir, 'Properties', 'launchSettings.json'), JSON.stringify({
            profiles: { Legacy: { commandName: 'Project', commandLineArgs: '--verbose "two words"', environmentVariables: { MODE: 'test' } } },
        }));
    });

    afterEach(() => fs.rmSync(env.workspacePath, { recursive: true, force: true }));

    it('starts the .exe with the mono debugger and the launch profile as arguments and environment', async () => {
        await DebugConfigService.startProject(appPath, false);

        const { config } = env.started[0];
        expect(config).toEqual(expect.objectContaining({
            type: 'mono',
            request: 'launch',
            program: '${workspaceFolder}/Legacy/bin/Debug/net48/Legacy.exe',
            args: ['--verbose', 'two words'],
            env: { MODE: 'test' },
            cwd: '${workspaceFolder}/Legacy',
        }));
        expect(config.launchSettingsProfile).toBeUndefined();
        expect(config.stopAtEntry).toBeUndefined();
    });

    it('starts without debugging the same way', async () => {
        await DebugConfigService.startProject(appPath, true);

        expect(env.started[0].options).toEqual({ noDebug: true });
        expect(env.started[0].config.type).toBe('mono');
    });

    it('does not start when Mono or the Mono Debug extension is missing', async () => {
        env.monoOk = false;

        await DebugConfigService.startProject(appPath, false);

        expect(env.started).toEqual([]);
    });

    it('checks Mono before F5 and Ctrl+F5 start a .NET Framework startup project', async () => {
        fs.mkdirSync(path.join(env.workspacePath, '.vscode'));
        fs.writeFileSync(path.join(env.workspacePath, '.vscode', 'launch.json'), JSON.stringify({
            configurations: [{ name: 'Startup', type: 'mono', request: 'launch' }],
        }));
        fs.writeFileSync(path.join(env.workspacePath, '.vscode', 'tasks.json'), JSON.stringify({
            tasks: [{ label: 'StartupPreBuild', args: ['build', path.join('Legacy', 'Legacy.csproj'), '--framework', 'net48'] }],
        }));
        env.monoOk = false;
        await DebugConfigService.startStartupProject(false);
        expect(env.started).toEqual([]);

        env.monoOk = true;
        await DebugConfigService.startStartupProject(false);
        expect(env.started).toEqual([{ config: 'Startup', options: { noDebug: false } }]);
    });
});

describe('DebugConfigService.startStartupProject (Ctrl+F5)', () => {
    beforeEach(() => {
        env.workspacePath = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'start-startup-')));
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
