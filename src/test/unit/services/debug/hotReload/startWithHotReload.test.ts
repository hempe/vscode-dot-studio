import * as path from 'path';

const env = {
    terminals: [] as any[],
    created: [] as any[],
    closeListeners: new Set<(terminal: any) => void>(),
    warnings: [] as string[],
    infos: [] as string[],
    quickPickItems: undefined as any[] | undefined,
    quickPickAnswer: undefined as ((items: any[]) => any) | undefined,
    framework: 'net10.0' as string | null,
    profile: { name: 'https', applicationUrl: 'https://localhost:7237' } as { name: string; applicationUrl?: string } | undefined,
    startupProject: null as string | null,
    projects: [] as Array<{ name: string; projectPath: string; isExecutable: boolean }>,
    unloaded: [] as string[],
    platform: 'Any CPU',
};

jest.mock('vscode', () => ({
    window: {
        get terminals() { return env.terminals; },
        createTerminal: (options: any) => {
            const terminal = {
                name: options.name,
                options,
                shown: false,
                show() { this.shown = true; },
                dispose() { env.terminals = env.terminals.filter(t => t !== terminal); env.closeListeners.forEach(listener => listener(terminal)); },
            };
            env.created.push(terminal);
            env.terminals.push(terminal);
            return terminal;
        },
        onDidCloseTerminal: (listener: (terminal: any) => void) => {
            env.closeListeners.add(listener);
            return { dispose: () => env.closeListeners.delete(listener) };
        },
        showWarningMessage: async (message: string) => { env.warnings.push(message); },
        showInformationMessage: async (message: string) => { env.infos.push(message); },
        showQuickPick: async (items: any[]) => { env.quickPickItems = items; return env.quickPickAnswer?.(items); },
    },
    ThemeIcon: class { constructor(public id: string) { } },
}), { virtual: true });

jest.mock('../../../../services/debugConfigService', () => ({
    DebugConfigService: {
        startFramework: async () => env.framework,
        startLaunchProfile: () => env.profile,
        getStartupProject: () => env.startupProject,
    },
}));

jest.mock('../../../../services/activeBuild', () => ({
    activeProjectBuild: () => ({ configuration: 'Debug', platform: env.platform }),
}));

const devCertChecks: any[][] = [];
jest.mock('../../../../services/devCert/devCertCheck', () => ({
    checkDevCertificateBeforeStart: (profiles: any[]) => { devCertChecks.push(profiles); },
}));

jest.mock('../../../../services/solutionService', () => ({
    SolutionService: {
        getActiveSolution: () => ({
            solutionPath: path.resolve('Contoso.slnx'),
            projects: new Map(env.projects.map(project => [project.projectPath, project])),
        }),
    },
}));

jest.mock('../../../../services/unloadedProjects', () => ({
    UnloadedProjects: { isUnloaded: (_solution: string, projectPath: string) => env.unloaded.includes(projectPath) },
}));

import { startWithHotReload } from '../../../../services/hotReload/startWithHotReload';

describe('startWithHotReload', () => {
    const web = path.resolve('src', 'Shop.Web', 'Shop.Web.csproj');
    const worker = path.resolve('src', 'Shop.Worker', 'Shop.Worker.csproj');
    const library = path.resolve('src', 'Shop.Core', 'Shop.Core.csproj');

    beforeEach(() => {
        env.terminals = [];
        env.created = [];
        env.closeListeners.clear();
        env.warnings = [];
        env.infos = [];
        env.quickPickItems = undefined;
        env.quickPickAnswer = undefined;
        env.framework = 'net10.0';
        env.profile = { name: 'https', applicationUrl: 'https://localhost:7237' };
        env.startupProject = null;
        env.projects = [];
        env.unloaded = [];
        env.platform = 'Any CPU';
        devCertChecks.length = 0;
    });

    it('runs dotnet watch in a "<project> (watch)" terminal in the project folder, with the launch profile', async () => {
        await startWithHotReload(web);

        expect(env.created).toHaveLength(1);
        const { options, shown } = env.created[0];
        expect(options.name).toBe('Shop.Web (watch)');
        expect(options.shellPath).toBe('dotnet');
        expect(options.cwd).toBe(path.dirname(web));
        expect(options.shellArgs).toEqual([
            'watch', 'run', '--project', web, '--launch-profile', 'https', '--non-interactive',
            '--configuration', 'Debug', '--framework', 'net10.0',
        ]);
        expect(shown).toBe(true);
        // The HTTPS certificate is checked like for the other ways of starting
        expect(devCertChecks).toEqual([[env.profile]]);
    });

    it('runs without a launch profile when the project has none, and passes a platform other than Any CPU', async () => {
        env.profile = undefined;
        env.platform = 'x64';

        await startWithHotReload(web);

        const args: string[] = env.created[0].options.shellArgs;
        expect(args).toContain('--no-launch-profile');
        expect(args[args.length - 1]).toBe('-property:Platform=x64');
    });

    it('restarts: starting again closes the terminal of the previous run first', async () => {
        await startWithHotReload(web);
        const first = env.created[0];
        await startWithHotReload(web);

        expect(env.created).toHaveLength(2);
        expect(env.terminals).toEqual([env.created[1]]);
        expect(env.terminals).not.toContain(first);
    });

    it('leaves the terminals of other projects alone', async () => {
        await startWithHotReload(web);
        await startWithHotReload(worker);

        expect(env.terminals.map(terminal => terminal.name)).toEqual(['Shop.Web (watch)', 'Shop.Worker (watch)']);
    });

    it('tells that .NET Framework projects cannot be hot reloaded', async () => {
        env.framework = 'net48';

        await startWithHotReload(web);

        expect(env.created).toHaveLength(0);
        expect(env.warnings).toEqual([expect.stringContaining('targets .NET Framework (net48)')]);
        expect(devCertChecks).toHaveLength(0);
    });

    it('from the command palette runs the startup project', async () => {
        env.startupProject = worker;

        await startWithHotReload();

        expect(env.quickPickItems).toBeUndefined();
        expect(env.created[0].options.name).toBe('Shop.Worker (watch)');
    });

    it('without a startup project asks for one of the loaded projects that can be started', async () => {
        env.projects = [
            { name: 'Shop.Worker', projectPath: worker, isExecutable: true },
            { name: 'Shop.Core', projectPath: library, isExecutable: false },
            { name: 'Shop.Web', projectPath: web, isExecutable: true },
        ];
        env.unloaded = [worker];
        env.quickPickAnswer = items => items[0];

        await startWithHotReload();

        expect(env.quickPickItems?.map(item => item.label)).toEqual(['Shop.Web']);
        expect(env.created[0].options.name).toBe('Shop.Web (watch)');
    });

    it('starts nothing when the pick is cancelled, and says so when nothing can be started', async () => {
        env.projects = [{ name: 'Shop.Web', projectPath: web, isExecutable: true }];
        await startWithHotReload();
        expect(env.created).toHaveLength(0);

        env.projects = [];
        await startWithHotReload();
        expect(env.infos).toEqual([expect.stringContaining('no project to start')]);
    });
});
