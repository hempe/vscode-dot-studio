// Exclude From Project / Include In Project from the outer project's tree, on a file in the folder of a nested project
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ui = { warnings: [] as string[], errors: [] as string[] };

jest.mock('vscode', () => {
    const disposable = { dispose: () => { } };
    const watcher = { onDidChange: () => disposable, onDidCreate: () => disposable, onDidDelete: () => disposable, dispose: () => { } };
    class EventEmitter { event = () => disposable; fire() { } dispose() { } }
    return {
        EventEmitter,
        RelativePattern: class { constructor(public base: string, public pattern: string) { } },
        Uri: { file: (p: string) => ({ fsPath: p }) },
        workspace: { createFileSystemWatcher: () => watcher, workspaceFolders: undefined, getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
        window: {
            showWarningMessage: async (message: string) => { ui.warnings.push(message); return undefined; },
            showErrorMessage: async (message: string) => { ui.errors.push(message); return undefined; },
            showInformationMessage: async () => undefined,
        },
        commands: { executeCommand: async () => undefined },
    };
}, { virtual: true });

import { Solution } from '../../../../../core/Solution';
import { SolutionService } from '../../../../../services/solution/solutionService';
import { SolutionActionService } from '../../../../../services/solution/solutionActionService';
import { ProjectItemsService } from '../../../../../services/project/items/projectItemsService';

const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip;
const sdkProject = '<Project Sdk="Microsoft.NET.Sdk">\n\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n  </PropertyGroup>\n\n</Project>\n';

describe('Exclude/Include on a file of a nested project\'s folder, from the outer project\'s tree (real MSBuild)', () => {
    let dir: string;
    let solution: Solution;
    const at = (...parts: string[]) => path.join(dir, ...parts);

    beforeEach(async () => {
        ui.warnings = [];
        ui.errors = [];
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nested-items-')));
        fs.mkdirSync(at('Outer', 'Inner', 'Sub'), { recursive: true });
        fs.writeFileSync(at('Outer', 'Outer.csproj'), sdkProject);
        fs.writeFileSync(at('Outer', 'Inner', 'Inner.csproj'), sdkProject);
        fs.writeFileSync(at('Outer', 'OuterClass.cs'), 'class OuterClass { }\n');
        fs.writeFileSync(at('Outer', 'Inner', 'Foo.cs'), 'class Foo { }\n');
        fs.writeFileSync(at('Outer', 'Inner', 'Sub', 'Bar.cs'), 'class Bar { }\n');
        fs.writeFileSync(at('Nest.slnx'), '<Solution>\n  <Project Path="Outer/Outer.csproj" />\n  <Project Path="Outer/Inner/Inner.csproj" />\n</Solution>\n');
        solution = new Solution(at('Nest.slnx'));
        for (let i = 0; i < 300 && !solution.isInitialized; i++) await new Promise(r => setTimeout(r, 10));
        (SolutionService as any).activeSolution = solution;
    });

    afterEach(() => {
        (SolutionService as any).activeSolution = undefined;
        solution.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    withDotnet('edits the outer project file, not the nested one', async () => {
        const outer = solution.projects.get(at('Outer', 'Outer.csproj'))!;
        await outer.reevaluateItems();
        await outer.getFolderChildren(at('Outer'));
        const inInner = await outer.getFolderChildren(at('Outer', 'Inner'));
        const foo = inInner.find(child => child.name === 'Foo.cs')!;
        const sub = inInner.find(child => child.name === 'Sub')!;
        expect(foo.contextValue).toBe('included');

        await SolutionActionService.handleProjectAction({ action: 'excludeFromProject', nodeId: foo.nodeId } as never);
        await SolutionActionService.handleProjectAction({ action: 'excludeFromProject', nodeId: sub.nodeId } as never);

        expect(fs.readFileSync(at('Outer', 'Inner', 'Inner.csproj'), 'utf8')).toBe(sdkProject);
        expect(fs.readFileSync(at('Outer', 'Outer.csproj'), 'utf8')).toContain('<Compile Remove="Inner\\Foo.cs" />');
        expect(fs.readFileSync(at('Outer', 'Outer.csproj'), 'utf8')).toContain('<Compile Remove="Inner\\Sub\\**" />');
        const items = await ProjectItemsService.instance.evaluate(at('Outer', 'Outer.csproj'));
        expect(items!.isIncluded(at('Outer', 'Inner', 'Foo.cs'))).toBe(false);
        expect(items!.isIncluded(at('Outer', 'Inner', 'Sub', 'Bar.cs'))).toBe(false);
        expect(ui.warnings).toEqual([]);

        await SolutionActionService.handleProjectAction({ action: 'includeInProject', nodeId: foo.nodeId } as never);
        expect(fs.readFileSync(at('Outer', 'Outer.csproj'), 'utf8')).not.toContain('Foo.cs');
        expect(fs.readFileSync(at('Outer', 'Inner', 'Inner.csproj'), 'utf8')).toBe(sdkProject);
        expect(ui.errors).toEqual([]);
    }, 150000);
});
