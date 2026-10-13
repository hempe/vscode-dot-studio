const env = {
    solution: undefined as undefined | { solutionPath: string; projects: Map<string, unknown> },
    configuration: 'Debug',
};

jest.mock('vscode', () => {
    class Task {
        group: unknown;
        constructor(
            public definition: any,
            public scope: any,
            public name: string,
            public source: string,
            public execution: any,
            public problemMatchers: string[]
        ) { }
    }
    class ShellExecution {
        constructor(public command: string, public args: string[], public options: any) { }
    }
    return {
        Task,
        ShellExecution,
        TaskGroup: { Build: { id: 'build' } },
        TaskScope: { Workspace: 2 },
        workspace: { workspaceFolders: [{ name: 'repo', uri: { fsPath: '/repo' } }] },
    };
}, { virtual: true });

jest.mock('../../../services/solutionService', () => ({
    SolutionService: { getActiveSolution: () => env.solution },
}));

jest.mock('../../../services/buildConfiguration', () => ({
    BuildConfiguration: { get active() { return env.configuration; } },
}));

import { createDotnetTask, dotnetTaskArgs, DotnetTaskDefinition, DotnetTaskProvider, DOTNET_TASK_TYPE } from '../../../services/dotnetTaskProvider';

describe('dotnetTaskArgs', () => {
    test('build, rebuild, clean and restore', () => {
        expect(dotnetTaskArgs('build', '/repo/All.sln', 'Debug')).toEqual(
            ['build', '/repo/All.sln', '--configuration', 'Debug', '-nologo', '-consoleLoggerParameters:NoSummary', '-property:GenerateFullPaths=true']);
        expect(dotnetTaskArgs('rebuild', '/repo/All.sln', 'Release')).toEqual(
            ['build', '/repo/All.sln', '--configuration', 'Release', '--no-incremental', '-nologo', '-consoleLoggerParameters:NoSummary', '-property:GenerateFullPaths=true']);
        expect(dotnetTaskArgs('clean', '/repo/All.sln', 'Debug')).toEqual(
            ['clean', '/repo/All.sln', '--configuration', 'Debug', '-nologo', '-consoleLoggerParameters:NoSummary']);
        expect(dotnetTaskArgs('restore', '/repo/All.sln', 'Debug')).toEqual(['restore', '/repo/All.sln']);
    });
});

describe('createDotnetTask', () => {
    test('builds a shell task with the $msCompile matcher in the build group', () => {
        const task = createDotnetTask({ type: DOTNET_TASK_TYPE, action: 'build', target: '/repo/Api/Api.csproj' }) as any;
        expect(task.name).toBe('build Api');
        expect(task.source).toBe(DOTNET_TASK_TYPE);
        expect(task.execution.command).toBe('dotnet');
        expect(task.execution.options).toEqual({ cwd: '/repo/Api' });
        expect(task.problemMatchers).toEqual(['$msCompile']);
        expect(task.group).toEqual({ id: 'build' });
        expect(task.scope).toEqual({ name: 'repo', uri: { fsPath: '/repo' } });
    });

    test('the solution build is the default build task', () => {
        const task = createDotnetTask({ type: DOTNET_TASK_TYPE, action: 'build', target: '/repo/All.slnx' }) as any;
        expect(task.name).toBe('build All');
        expect(task.group).toEqual({ id: 'build', isDefault: true });
    });

    test('uses the active solution configuration unless the definition names one', () => {
        env.configuration = 'Release';
        const task = createDotnetTask({ type: DOTNET_TASK_TYPE, action: 'build', target: '/repo/All.sln' }) as any;
        expect(task.execution.args).toContain('Release');

        const pinned = createDotnetTask({ type: DOTNET_TASK_TYPE, action: 'build', target: '/repo/All.sln', configuration: 'Debug' }) as any;
        expect(pinned.execution.args.slice(2, 4)).toEqual(['--configuration', 'Debug']);
        env.configuration = 'Debug';
    });

    test('restore has no problem matcher', () => {
        const task = createDotnetTask({ type: DOTNET_TASK_TYPE, action: 'restore', target: '/repo/All.sln' }) as any;
        expect(task.problemMatchers).toEqual([]);
    });

    test('keeps the given definition object', () => {
        const definition: DotnetTaskDefinition = { type: DOTNET_TASK_TYPE, action: 'clean', target: '/repo/All.sln' };
        expect((createDotnetTask(definition) as any).definition).toBe(definition);
    });
});

describe('DotnetTaskProvider', () => {
    const provider = new DotnetTaskProvider();

    test('provides no tasks without a solution', () => {
        env.solution = undefined;
        expect(provider.provideTasks()).toEqual([]);
    });

    test('provides every action for the solution and each project', () => {
        env.solution = {
            solutionPath: '/repo/All.sln',
            projects: new Map([['/repo/Domain/Domain.csproj', {}], ['/repo/Api/Api.csproj', {}]]),
        };
        const names = provider.provideTasks().map(t => t.name);
        expect(names).toEqual([
            'build All', 'rebuild All', 'clean All', 'restore All',
            'build Api', 'rebuild Api', 'clean Api', 'restore Api',
            'build Domain', 'rebuild Domain', 'clean Domain', 'restore Domain',
        ]);
    });

    test('resolves a tasks.json task and rejects invalid definitions', () => {
        const definition = { type: DOTNET_TASK_TYPE, action: 'build', target: '/repo/All.sln' };
        const resolved = provider.resolveTask({ definition, scope: { name: 'repo' } } as any) as any;
        expect(resolved.definition).toBe(definition);
        expect(resolved.scope).toEqual({ name: 'repo' });
        expect(provider.resolveTask({ definition: { type: DOTNET_TASK_TYPE, action: 'publish', target: '/x' } } as any)).toBeUndefined();
        expect(provider.resolveTask({ definition: { type: DOTNET_TASK_TYPE, action: 'build' } } as any)).toBeUndefined();
    });
});
