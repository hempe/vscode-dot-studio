// Add New Project and Add New Item end to end with the real dotnet new, against a temporary .slnx solution
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ui = {
    picks: [] as string[],
    inputs: [] as (string | undefined)[],
    prefilled: [] as (string | undefined)[],
    errors: [] as string[],
};

jest.mock('vscode', () => {
    const disposable = { dispose: () => { } };
    const watcher = { onDidChange: () => disposable, onDidCreate: () => disposable, onDidDelete: () => disposable, dispose: () => { } };
    class EventEmitter { event = () => disposable; fire() { } dispose() { } }
    return {
        EventEmitter,
        RelativePattern: class { constructor(public base: string, public pattern: string) { } },
        Uri: { file: (p: string) => ({ fsPath: p }) },
        QuickPickItemKind: { Separator: -1 },
        ProgressLocation: { Notification: 15, Window: 10 },
        workspace: { createFileSystemWatcher: () => watcher, workspaceFolders: undefined },
        window: {
            showQuickPick: async (items: { label: string; kind?: number }[]) => {
                const label = ui.picks.shift();
                return items.find(item => item.kind === undefined && item.label === label);
            },
            showInputBox: async (options: { value?: string }) => {
                ui.prefilled.push(options.value);
                const input = ui.inputs.shift();
                return input === undefined ? options.value : input;
            },
            withProgress: async (_options: unknown, task: () => Promise<unknown>) => task(),
            createOutputChannel: () => ({ appendLine: () => { }, show: () => { } }),
            showInformationMessage: async () => undefined,
            showErrorMessage: async (message: string) => { ui.errors.push(message); },
        },
        commands: { executeCommand: async () => undefined },
    };
}, { virtual: true });

// The parsers refuse paths under /tmp
jest.mock('../../../../core/constants', () => ({
    ...jest.requireActual('../../../../core/constants'),
    isSystemPath: () => false,
}));

import { Solution } from '../../../../core/Solution';
import { SolutionService } from '../../../../services/solutionService';
import { addNewProject, createItem } from '../../../../services/templates/templateService';

const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? it : it.skip;

describe('templates with dotnet new', () => {
    jest.setTimeout(180000);
    let dir: string;
    let solution: Solution;
    let libProject: string;

    beforeEach(async () => {
        ui.picks = [];
        ui.inputs = [];
        ui.prefilled = [];
        ui.errors = [];
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-tpl-'));
        libProject = path.join(dir, 'src', 'Lib', 'Lib.csproj');
        fs.mkdirSync(path.dirname(libProject), { recursive: true });
        fs.writeFileSync(libProject, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>');
        fs.writeFileSync(path.join(dir, 'App.slnx'), '<Solution>\n  <Folder Name="/Libs/">\n    <Project Path="src/Lib/Lib.csproj" />\n  </Folder>\n</Solution>\n');
        solution = new Solution(path.join(dir, 'App.slnx'));
        for (let i = 0; i < 100 && !solution.isInitialized; i++) await new Promise(r => setTimeout(r, 10));
        (SolutionService as any).activeSolution = solution;
    });

    afterEach(() => {
        solution.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    withDotnet('creates a project next to the others, for their framework, in the solution folder', async () => {
        ui.picks = ['Class Library'];
        ui.inputs = ['Utils', undefined];

        await addNewProject('Libs');

        expect(ui.errors).toEqual([]);
        expect(ui.prefilled[1]).toBe(path.join('src', 'Utils'));
        const project = fs.readFileSync(path.join(dir, 'src', 'Utils', 'Utils.csproj'), 'utf8');
        expect(project).toContain('<TargetFramework>net8.0</TargetFramework>');
        expect(fs.readFileSync(path.join(dir, 'App.slnx'), 'utf8')).toMatch(/<Folder Name="\/Libs\/">[\s\S]*Utils\.csproj[\s\S]*<\/Folder>/);
    });

    it('writes built-in items with the folder namespace', async () => {
        const models = path.join(dir, 'src', 'Lib', 'Models');
        fs.mkdirSync(models);

        const file = await createItem({ kind: 'builtin', item: 'class', defaultName: 'Class1.cs' }, models, 'Customer', libProject);

        expect(file).toBe(path.join(models, 'Customer.cs'));
        expect(fs.readFileSync(file!, 'utf8')).toBe('namespace Lib.Models;\n\npublic class Customer\n{\n}\n');
        expect(await createItem({ kind: 'builtin', item: 'class', defaultName: 'Class1.cs' }, models, 'Customer.cs', libProject)).toBeUndefined();
        expect(ui.errors).toEqual(['Customer.cs already exists.']);
    });

    withDotnet('gives dotnet new items the folder namespace', async () => {
        const controllers = path.join(dir, 'src', 'Lib', 'Controllers');
        fs.mkdirSync(controllers);
        const template = { name: 'API Controller', shortNames: ['apicontroller'], languages: ['C#'], defaultLanguage: 'C#', tags: ['Web', 'ASP.NET'] };

        const file = await createItem({ kind: 'template', template, language: 'C#', defaultName: 'APIController1' }, controllers, 'ValuesController.cs', libProject);

        expect(ui.errors).toEqual([]);
        expect(file).toBe(path.join(controllers, 'ValuesController.cs'));
        expect(fs.readFileSync(file!, 'utf8')).toMatch(/namespace Lib\.Controllers\b/);
    });
});
