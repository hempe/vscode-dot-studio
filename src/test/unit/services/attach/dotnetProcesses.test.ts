import * as path from 'path';
import { findDotnetProcesses, DotnetProcess, sortProcesses } from '../../../../services/attach/dotnetProcesses';
import { buildAttachItems } from '../../../../services/attach/attachItems';
import { ProcessEntry } from '../../../../services/attach/processList';

const root = path.resolve('/work/Contoso');
const projects = [
    { name: 'Shop.Web', directory: path.join(root, 'src', 'Shop.Web') },
    { name: 'Shop.Worker', directory: path.join(root, 'src', 'Shop.Worker') },
];

const linux = (pid: number, args: string): ProcessEntry => ({ pid, ppid: 1, command: args.split(' ')[0], args });

const detect = (entries: ProcessEntry[], files: string[] = []) => findDotnetProcesses(entries, {
    projects,
    selfPid: 5,
    isFile: file => files.includes(file),
    resolveExecutable: () => undefined,
});

describe('findDotnetProcesses', () => {
    it('finds dotnet hosting a dll, with and without exec and options', () => {
        const found = detect([
            linux(10, '/usr/share/dotnet/dotnet /srv/Shop.Web.dll --urls http://localhost:5181'),
            linux(11, 'dotnet exec --runtimeconfig /srv/Shop.Worker.runtimeconfig.json --depsfile /srv/Shop.Worker.deps.json /srv/Shop.Worker.dll'),
            linux(12, 'dotnet bin/Debug/net10.0/Other.dll'),
        ]);

        expect(found.map(p => [p.pid, p.name, p.project])).toEqual([
            [10, 'Shop.Web', 'Shop.Web'],
            [11, 'Shop.Worker', 'Shop.Worker'],
            [12, 'Other', undefined],
        ]);
    });

    it('keeps the test host of a solution project but never the SDK, build servers or language servers', () => {
        const found = detect([
            linux(20, 'dotnet exec /home/me/.nuget/packages/microsoft.testplatform.testhost/17.0/build/net8.0/testhost.dll --port 1'),
            linux(21, 'dotnet build'),
            linux(22, 'dotnet run --project src/Shop.Web'),
            linux(23, 'dotnet watch run'),
            linux(24, 'dotnet test --no-build'),
            linux(25, 'dotnet restore'),
            linux(26, '/usr/share/dotnet/dotnet /usr/share/dotnet/sdk/10.0.111/MSBuild.dll /nologo /nodemode:1'),
            linux(27, '/usr/share/dotnet/sdk/10.0.111/Roslyn/bincore/VBCSCompiler -pipename:abc'),
            linux(28, 'dotnet /usr/share/dotnet/sdk/10.0.111/DotnetTools/dotnet-watch/10.0.111/tools/net10.0/any/dotnet-watch.dll run'),
            linux(29, 'dotnet /home/me/.vscode/extensions/ms-dotnettools.csharp-2.0/.roslyn/Microsoft.CodeAnalysis.LanguageServer.dll --logLevel Information'),
            linux(30, '/usr/share/dotnet/dotnet'),
            linux(31, 'dotnet /home/me/.vscode-oss/extensions/muhammad-sammy.csharp-2.1/.omnisharp/1.39/OmniSharp.dll -lsp'),
            linux(5, 'dotnet /srv/Self.dll'),
            linux(32, '/usr/bin/bash -c dotnet /srv/NotMe.dll'),
        ]);

        expect(found.map(p => p.pid)).toEqual([20]);
    });

    it('handles dll paths with spaces', () => {
        const found = detect([linux(40, 'dotnet /srv/My Apps/Shop.Web.dll --urls http://localhost:5000')]);
        expect(found).toHaveLength(1);
        expect(found[0].name).toBe('Shop.Web');
    });

    it('finds apphosts in a project\'s bin folder, matched to the project', () => {
        const exe = path.join(projects[0].directory, 'bin', 'Debug', 'net10.0', 'Shop.Web');
        const found = detect([
            linux(50, `${exe} --urls http://localhost:5184`),
            linux(51, '/usr/lib/electron42/electron --type=gpu-process'),
        ]);
        expect(found).toEqual([{ pid: 50, name: 'Shop.Web', project: 'Shop.Web', commandLine: `${exe} --urls http://localhost:5184` }]);
    });

    it('finds apphosts outside the solution by the dll and runtimeconfig beside them', () => {
        const dir = path.resolve('/opt/tool');
        const exe = path.join(dir, 'Tool');
        const sibling = path.join(dir, 'Tool.dll');
        const config = path.join(dir, 'Tool.runtimeconfig.json');

        expect(detect([linux(60, exe)], [sibling, config]).map(p => p.name)).toEqual(['Tool']);
        expect(detect([linux(60, exe)], [sibling])).toEqual([]);
    });

    it('resolves apphosts started with a relative path through the resolver', () => {
        const exe = path.join(projects[1].directory, 'bin', 'Debug', 'net10.0', 'Shop.Worker');
        const found = findDotnetProcesses([linux(70, 'bin/Debug/net10.0/Shop.Worker')], {
            projects, selfPid: 5, isFile: () => false, resolveExecutable: pid => (pid === 70 ? exe : undefined),
        });
        expect(found.map(p => [p.name, p.project])).toEqual([['Shop.Worker', 'Shop.Worker']]);
    });

    it('reads Windows command lines: quoted image paths, exe apphosts, null command lines', () => {
        const found = detect([
            { pid: 80, ppid: 1, command: 'C:\\Program Files\\dotnet\\dotnet.exe', args: '"C:\\Program Files\\dotnet\\dotnet.exe" exec C:\\src\\Shop.Web.dll' },
            { pid: 81, ppid: 1, command: 'C:\\Program Files\\dotnet\\dotnet.exe', args: 'C:\\Program Files\\dotnet\\dotnet.exe C:\\src\\Worker.dll' },
            { pid: 82, ppid: 1, command: 'C:\\Program Files\\dotnet\\dotnet.exe', args: '"C:\\Program Files\\dotnet\\dotnet.exe" build' },
            { pid: 83, ppid: 1, command: 'System', args: 'System' },
            { pid: 84, ppid: 1, command: 'C:\\Program Files\\dotnet\\sdk\\10.0.111\\MSBuild.exe', args: 'MSBuild.exe /nodemode:1' },
        ]);
        expect(found.map(p => [p.pid, p.name, p.project])).toEqual([[80, 'Shop.Web', 'Shop.Web'], [81, 'Worker', undefined]]);
    });
});

describe('sorting and items', () => {
    const processes: DotnetProcess[] = [
        { pid: 3, name: 'zeta', commandLine: 'dotnet zeta.dll' },
        { pid: 2, name: 'Shop.Worker', project: 'Shop.Worker', commandLine: 'dotnet Shop.Worker.dll' },
        { pid: 1, name: 'alpha', commandLine: 'dotnet alpha.dll' },
        { pid: 4, name: 'Shop.Web', project: 'Shop.Web', commandLine: 'dotnet Shop.Web.dll' },
    ];

    it('puts the solution\'s projects first, then the others by name', () => {
        expect(sortProcesses(processes).map(p => p.name)).toEqual(['Shop.Web', 'Shop.Worker', 'alpha', 'zeta']);
    });

    it('builds labels with pid and ports, the project as description and the command line as detail', () => {
        const items = buildAttachItems(processes, new Map([[4, [5181, 7237]]]));
        expect(items[0]).toEqual({
            pid: 4,
            label: 'Shop.Web (pid 4) :5181 :7237',
            description: 'Shop.Web',
            detail: 'dotnet Shop.Web.dll',
        });
        expect(items[2]).toEqual({ pid: 1, label: 'alpha (pid 1)', description: '', detail: 'dotnet alpha.dll' });
    });

    it('shortens very long command lines', () => {
        const [item] = buildAttachItems([{ pid: 1, name: 'a', commandLine: 'x'.repeat(500) }], new Map());
        expect(item.detail.length).toBeLessThan(250);
        expect(item.detail.endsWith('...')).toBe(true);
    });
});
