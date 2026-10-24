import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const env = {
    workspacePath: '',
    solution: undefined as any,
    started: [] as { config: any; options: any }[],
    warnings: [] as string[],
    messages: [] as string[],
    monoOk: true,
    /** What the quick pick returns, given its items */
    pick: (_items: any[]) => undefined as any,
    pickedFrom: [] as any[],
    unloaded: [] as string[],
};

jest.mock('vscode', () => ({
    workspace: {
        get workspaceFolders() { return [{ uri: { fsPath: env.workspacePath } }]; },
        getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
    },
    window: {
        showWarningMessage: async (message: string) => { env.warnings.push(message); },
        showErrorMessage: async (message: string) => { env.messages.push(message); },
        showInformationMessage: async (message: string) => { env.messages.push(message); },
        showQuickPick: async (items: any[]) => { env.pickedFrom = items; return env.pick(items); },
    },
    commands: { executeCommand: async () => undefined },
    debug: {
        startDebugging: async (_folder: unknown, config: any, options: any) => {
            env.started.push({ config, options });
            return true;
        },
    },
}), { virtual: true });

jest.mock('../../../../services/monoDebug', () => ({
    ...jest.requireActual('../../../../services/monoDebug'),
    ensureMonoDebugging: async () => env.monoOk,
}));
jest.mock('../../../../services/buildConfiguration', () => ({
    BuildConfiguration: { get active() { return 'Debug'; }, get activePlatform() { return 'Any CPU'; } },
}));
jest.mock('../../../../services/dotnetTaskProvider', () => ({
    DOTNET_TASK_TYPE: 'shinobi-dotnet',
    createDotnetTask: (definition: any) => ({ definition }),
}));
jest.mock('../../../../services/solutionService', () => ({
    SolutionService: { getActiveSolution: () => env.solution },
}));
jest.mock('../../../../services/unloadedProjects', () => ({
    UnloadedProjects: { buildTarget: (solutionPath: string) => solutionPath, isUnloaded: (_solutionPath: string, projectPath: string) => env.unloaded.includes(projectPath) },
}));

import { DebugConfigService } from '../../../../services/debugConfigService';
import { StartupChoice } from '../../../../services/startupProfiles/startupChoice';
import { defaultStartupProject, refreshStartup, selectStartupProfile } from '../../../../services/startupProfiles/startProfile';
import { parseJsonc } from '../../../../core/jsonc';

class Memento {
    private readonly values = new Map<string, unknown>();
    get<T>(key: string): T | undefined { return this.values.get(key) as T | undefined; }
    async update(key: string, value: unknown) { this.values.set(key, value); }
}

const PROFILES = JSON.stringify([{
    Name: 'Both',
    Projects: [
        { Path: 'Api\\Api.csproj', Action: 'Start', DebugTarget: 'https' },
        { Path: 'Gone\\Gone.csproj', Action: 'Start' },
        { Path: 'Lib\\Lib.csproj', Action: 'None' },
        { Path: 'Worker\\Worker.csproj', Action: 'StartWithoutDebugging' },
    ],
}, { Name: 'Nothing', Projects: [] }], null, 2);

const API_CONFIG = {
    name: 'Both: Api',
    type: 'coreclr',
    request: 'launch',
    program: '${workspaceFolder}/Api/bin/Debug/net10.0/Api.dll',
    launchSettingsProfile: 'https',
    cwd: '${workspaceFolder}/Api',
    console: 'integratedTerminal',
    stopAtEntry: false,
    presentation: { hidden: true },
};
const WORKER_CONFIG = {
    name: 'Both: Worker',
    type: 'coreclr',
    request: 'launch',
    program: '${workspaceFolder}/Worker/bin/Debug/net10.0/Worker.dll',
    args: [],
    cwd: '${workspaceFolder}/Worker',
    console: 'integratedTerminal',
    stopAtEntry: false,
    noDebug: true,
    presentation: { hidden: true },
};
// The project entries are hidden and the compound comes first in Run and Debug: plain F5 runs the selected entry, which
// VS Code picks as the first one of the list for a new folder; a project entry alone would start without the build
const COMPOUND = { name: 'Startup', configurations: ['Both: Api', 'Both: Worker'], preLaunchTask: 'StartupPreBuild', stopAll: true, presentation: { order: 1 } };

describe('startup profiles: the "Startup" launch entry, F5 and Ctrl+F5', () => {
    let solutionPath: string;
    let apiPath: string;
    let listener: { dispose(): void };

    const launchJsonPath = () => path.join(env.workspacePath, '.vscode', 'launch.json');
    const launchJson = () => parseJsonc(fs.readFileSync(launchJsonPath(), 'utf8')).value;
    const tasksJson = () => parseJsonc(fs.readFileSync(path.join(env.workspacePath, '.vscode', 'tasks.json'), 'utf8')).value;

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

    const activate = async (name = 'Both') => {
        await StartupChoice.useProfile(solutionPath, { name, source: 'shared' },
            { projectPath: apiPath, framework: 'net10.0', launchProfile: 'https' });
        await refreshStartup();
    };

    beforeEach(() => {
        env.workspacePath = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'startup-profile-')));
        env.started = [];
        env.warnings = [];
        env.messages = [];
        env.monoOk = true;
        env.unloaded = [];
        env.pick = () => undefined;
        solutionPath = path.join(env.workspacePath, 'Shop.sln');
        apiPath = writeProject('Api', 'net10.0', {
            http: { commandName: 'Project', applicationUrl: 'http://localhost:5181' },
            https: { commandName: 'Project', applicationUrl: 'https://localhost:7275' },
        });
        writeProject('Worker', 'net8.0;net10.0');
        writeProject('Lib', 'net10.0');
        fs.writeFileSync(solutionPath, '');
        fs.writeFileSync(path.join(env.workspacePath, 'Shop.slnLaunch'), PROFILES);
        env.solution = {
            solutionPath,
            configurationProjects: [{ path: 'Api/Api.csproj' }, { path: 'Worker/Worker.csproj' }, { path: 'Lib/Lib.csproj' }],
            projects: new Map(),
        };
        StartupChoice.initialize(new Memento() as any);
        // As in extension.ts
        listener = StartupChoice.onDidChange(() => void refreshStartup());
    });

    afterEach(() => {
        listener.dispose();
        fs.rmSync(env.workspacePath, { recursive: true, force: true });
    });

    it('writes one configuration per project, the "Startup" compound and one solution build, and warns about missing projects', async () => {
        await activate();

        expect(launchJson()).toEqual({ version: '0.2.0', configurations: [API_CONFIG, WORKER_CONFIG], compounds: [COMPOUND] });
        expect(Object.keys(launchJson().configurations[1])).toEqual(Object.keys(WORKER_CONFIG));
        expect(tasksJson().tasks).toEqual([expect.objectContaining({
            label: 'StartupPreBuild',
            args: ['build', 'Shop.sln', '--configuration', 'Debug', '/property:GenerateFullPaths=true', '/consoleloggerparameters:NoSummary', '-property:EmitCompilerGeneratedFiles=true'],
        })]);
        expect(DebugConfigService.hasStartupProfileConfiguration()).toBe(true);
        expect(DebugConfigService.getStartupProject()).toBeNull();

        // Once, not on every refresh
        await refreshStartup();
        expect(env.warnings).toEqual(['The startup profile "Both" names projects the solution does not have, they are skipped: Gone/Gone.csproj']);
    }, 60000);

    it('adds the presentation fields to a launch.json written without them (0.1.1)', async () => {
        await activate();
        const strip = (item: any) => { const { presentation: _presentation, ...rest } = item; return rest; };
        fs.writeFileSync(launchJsonPath(), JSON.stringify({
            version: '0.2.0',
            configurations: [strip(API_CONFIG), strip(WORKER_CONFIG)],
            compounds: [strip(COMPOUND)],
        }, null, 4));

        await DebugConfigService.updateStartupProfileConfiguration(
            [{ name: 'Both: Api', projectPath: apiPath, framework: 'net10.0', launchProfile: 'https', noDebug: false },
             { name: 'Both: Worker', projectPath: path.join(env.workspacePath, 'Worker', 'Worker.csproj'), framework: 'net10.0', noDebug: true }],
            solutionPath);

        expect(launchJson()).toEqual({ version: '0.2.0', configurations: [API_CONFIG, WORKER_CONFIG], compounds: [COMPOUND] });
    }, 60000);

    it('leaves unloaded projects out of the launches, and starts them again once reloaded', async () => {
        await activate();
        env.unloaded = [path.join(env.workspacePath, 'Worker', 'Worker.csproj')];
        await refreshStartup();
        expect(launchJson().configurations).toEqual([API_CONFIG]);
        expect(launchJson().compounds).toEqual([{ ...COMPOUND, configurations: ['Both: Api'] }]);

        env.unloaded = [];
        await refreshStartup();
        // The compound has the order, not the list of configurations
        expect(launchJson().configurations).toEqual(expect.arrayContaining([API_CONFIG, WORKER_CONFIG]));
        expect(launchJson().configurations).toHaveLength(2);
        expect(launchJson().compounds).toEqual([COMPOUND]);
    }, 60000);

    it('replaces the single "Startup" configuration, keeps the others, and puts it back for "Single"', async () => {
        await DebugConfigService.updateStartupConfiguration(apiPath, undefined, false);
        fs.writeFileSync(launchJsonPath(), fs.readFileSync(launchJsonPath(), 'utf8').replace('"configurations": [',
            '// mine\n    "configurations": [\n        { "name": "Mine", "type": "coreclr", "request": "attach" },'));
        const single = launchJson().configurations.find((config: any) => config.name === 'Startup');

        await activate();
        expect(launchJson().configurations.map((config: any) => config.name)).toEqual(['Both: Api', 'Both: Worker', 'Mine']);

        await StartupChoice.useSingle(solutionPath);
        await refreshStartup();

        const text = fs.readFileSync(launchJsonPath(), 'utf8');
        expect(text).toContain('// mine');
        expect(launchJson().compounds).toEqual([]);
        expect(launchJson().configurations).toEqual([{ ...single, launchSettingsProfile: 'https' }, expect.objectContaining({ name: 'Mine' })]);
        expect(DebugConfigService.getStartupProject()).toBe(apiPath);
        expect(tasksJson().tasks[0].args[1]).toBe(path.join('Api', 'Api.csproj'));
    }, 60000);

    it('falls back to the single startup project when the profile file is gone', async () => {
        await activate();
        fs.rmSync(path.join(env.workspacePath, 'Shop.slnLaunch'));

        await refreshStartup();

        expect(launchJson().compounds).toEqual([]);
        expect(launchJson().configurations.map((config: any) => config.name)).toEqual(['Startup']);
        expect(DebugConfigService.getStartupProject()).toBe(apiPath);
        expect(StartupChoice.profileRef(solutionPath)).toEqual({ name: 'Both', source: 'shared' });
    }, 60000);

    it('leaves launch.json alone while the profile file cannot be parsed', async () => {
        await activate();
        const before = fs.readFileSync(launchJsonPath(), 'utf8');
        fs.writeFileSync(path.join(env.workspacePath, 'Shop.slnLaunch'), '[{ "Name": "Both", ');

        await refreshStartup();

        expect(fs.readFileSync(launchJsonPath(), 'utf8')).toBe(before);
        expect(fs.readFileSync(path.join(env.workspacePath, 'Shop.slnLaunch'), 'utf8')).toBe('[{ "Name": "Both", ');
    }, 60000);

    it('Ctrl+F5 runs the whole compound without the debugger, F5\'s button with it', async () => {
        await activate();

        await DebugConfigService.startStartupProject(true);
        await DebugConfigService.startStartupProject(false);

        expect(env.started).toEqual([
            { config: 'Startup', options: { noDebug: true } },
            { config: 'Startup', options: { noDebug: false } },
        ]);
    }, 60000);

    it('says so when the profile starts no project', async () => {
        await activate('Nothing');

        await DebugConfigService.startStartupProject(true);

        expect(launchJson().compounds).toEqual([{ ...COMPOUND, configurations: [] }]);
        expect(env.started).toEqual([]);
        expect(env.messages).toEqual([expect.stringContaining('starts no project')]);
    }, 60000);

    it('checks Mono before starting a profile with a .NET Framework project', async () => {
        fs.mkdirSync(path.join(env.workspacePath, '.vscode'));
        fs.writeFileSync(launchJsonPath(), JSON.stringify({
            configurations: [{ name: 'P: Legacy', type: 'mono', request: 'launch' }],
            compounds: [{ name: 'Startup', configurations: ['P: Legacy'], stopAll: true }],
        }));
        env.monoOk = false;

        await DebugConfigService.startStartupProject(false);

        expect(env.started).toEqual([]);
    });

    it('Select Startup Profile... offers the single project and the profiles, and activates the choice', async () => {
        await DebugConfigService.updateStartupConfiguration(apiPath, undefined, false);
        env.pick = items => items.find(item => item.label === 'Both');

        await selectStartupProfile();
        await refreshStartup();

        expect(env.pickedFrom.map(item => [item.label, item.description])).toEqual([
            ['Single: Api', '(current)'], ['Both', undefined], ['Nothing', undefined],
        ]);
        expect(StartupChoice.activeProfileName(solutionPath)).toBe('Both');
        expect(StartupChoice.rememberedSingle(solutionPath)).toEqual({ projectPath: apiPath, framework: 'net10.0', launchProfile: 'http' });
        expect(launchJson().compounds).toEqual([COMPOUND]);

        env.pick = items => items[0];
        await selectStartupProfile();
        await refreshStartup();

        expect(env.pickedFrom.map(item => [item.label, item.description])).toEqual([
            ['Single: Api', undefined], ['Both', '(current)'], ['Nothing', undefined],
        ]);
        expect(StartupChoice.activeProfileName(solutionPath)).toBeUndefined();
        expect(DebugConfigService.getStartupProject()).toBe(apiPath);
        expect(launchJson().configurations[0].launchSettingsProfile).toBe('http');
    }, 60000);
    it('a profile that goes away when no startup project was set before it: the first project that can start becomes the startup project', async () => {
        const libPath = path.join(env.workspacePath, 'Lib', 'Lib.csproj');
        const workerPath = path.join(env.workspacePath, 'Worker', 'Worker.csproj');
        env.solution = {
            ...env.solution,
            configurationProjects: [{ path: 'Lib/Lib.csproj' }, { path: 'Api/Api.csproj' }, { path: 'Worker/Worker.csproj' }],
            projects: new Map([
                [libPath, { isExecutable: false, isTestProject: false }],
                [apiPath, { isExecutable: true, isTestProject: false }],
                [workerPath, { isExecutable: true, isTestProject: false }],
            ]),
        };
        await StartupChoice.useProfile(solutionPath, { name: 'Both', source: 'shared' });
        await refreshStartup();
        expect(launchJson().compounds).toEqual([COMPOUND]);

        fs.rmSync(path.join(env.workspacePath, 'Shop.slnLaunch'));
        await refreshStartup();

        expect(launchJson().compounds).toEqual([]);
        expect(launchJson().configurations.map((config: any) => config.name)).toEqual(['Startup']);
        expect(DebugConfigService.getStartupProject()).toBe(apiPath);
        expect(env.messages).toEqual([expect.stringContaining('F5 starts Api, the first project of the solution that can be started')]);
    }, 60000);

    it('none of the projects can start: the profile entries go and it says F5 has nothing to start', async () => {
        await StartupChoice.useProfile(solutionPath, { name: 'Both', source: 'shared' });
        await refreshStartup();
        await StartupChoice.useSingle(solutionPath);
        await refreshStartup();

        expect(launchJson().compounds).toEqual([]);
        expect(launchJson().configurations).toEqual([]);
        expect(env.messages).toEqual([expect.stringContaining('F5 has nothing to start')]);
    }, 60000);

    it('defaultStartupProject skips libraries, test projects and unloaded projects, in the solution file\'s order', () => {
        const project = (isExecutable: boolean, isTestProject = false) => ({ isExecutable, isTestProject });
        const at = (name: string) => path.join(env.workspacePath, name, `${name}.csproj`);
        const solution = {
            solutionPath,
            configurationProjects: ['Lib', 'Tests', 'Gone', 'Worker', 'Api'].map(name => ({ path: `${name}/${name}.csproj` })),
            projects: new Map([[at('Lib'), project(false)], [at('Tests'), project(true, true)], [at('Gone'), project(true)], [at('Worker'), project(true)], [at('Api'), project(true)]]),
        };
        env.unloaded = [at('Gone')];
        expect(defaultStartupProject(solution)).toBe(at('Worker'));
        expect(defaultStartupProject({ ...solution, configurationProjects: [{ path: 'Lib/Lib.csproj' }] })).toBeUndefined();
    });
});
