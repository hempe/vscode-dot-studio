// Add New Project and Add New Item end to end with the real dotnet new, against a temporary .slnx solution
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ui = {
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
import { createItem, createProject, newItemWizard, newProjectWizard } from '../../../../services/templates/templateService';
import { initialValues } from '../../../../webview/template-wizard/App';

const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? it : it.skip;

describe('templates with dotnet new', () => {
    jest.setTimeout(180000);
    let dir: string;
    let solution: Solution;
    let libProject: string;

    beforeEach(async () => {
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

    withDotnet('creates a project with the chosen options next to the others, in the solution folder', async () => {
        const wizard = await newProjectWizard('Libs');
        expect(wizard).toMatchObject({ kind: 'project', location: 'src', preferredValues: { framework: 'net8.0' } });
        const classlib = wizard.templates.find(t => t.shortName === 'classlib')!;
        expect(classlib.language).toBe('C#');
        const values = initialValues(classlib, wizard.preferredValues);
        expect(values.framework).toBe('net8.0');

        expect(await createProject(classlib.id, 'Utils', 'src/Utils', values, 'Libs')).toBeUndefined();

        expect(fs.readFileSync(path.join(dir, 'src', 'Utils', 'Utils.csproj'), 'utf8')).toContain('<TargetFramework>net8.0</TargetFramework>');
        expect(fs.readFileSync(path.join(dir, 'App.slnx'), 'utf8')).toMatch(/<Folder Name="\/Libs\/">[\s\S]*Utils\.csproj[\s\S]*<\/Folder>/);
        expect(await createProject(classlib.id, 'Lib', 'src/Lib2', values)).toBe('The solution already has a project Lib.');
    });

    withDotnet('writes built-in items with the folder namespace', async () => {
        const models = path.join(dir, 'src', 'Lib', 'Models');
        fs.mkdirSync(models);
        const wizard = await newItemWizard(models, libProject);
        expect(wizard.templates.slice(0, 5).map(t => t.name)).toEqual(['Class', 'Interface', 'Record', 'Enum', 'Struct']);

        const result = await createItem('builtin:class', models, 'Customer', libProject, {});

        expect(result.file).toBe(path.join(models, 'Customer.cs'));
        expect(fs.readFileSync(result.file!, 'utf8')).toBe('namespace Lib.Models;\n\npublic class Customer\n{\n}\n');
        expect(await createItem('builtin:class', models, 'Customer.cs', libProject, {})).toEqual({ error: 'Customer.cs already exists.' });
    });

    withDotnet('passes template options and the folder namespace to dotnet new items', async () => {
        const controllers = path.join(dir, 'src', 'Lib', 'Controllers');
        fs.mkdirSync(controllers);
        const wizard = await newItemWizard(controllers, libProject);
        expect(wizard.preferredValues).toEqual({ namespace: 'Lib.Controllers' });
        const apicontroller = wizard.templates.find(t => t.shortName === 'apicontroller')!;
        const values = { ...initialValues(apicontroller, wizard.preferredValues), actions: true };

        const result = await createItem(apicontroller.id, controllers, 'ValuesController.cs', libProject, values);

        expect(result.error).toBeUndefined();
        expect(result.file).toBe(path.join(controllers, 'ValuesController.cs'));
        const code = fs.readFileSync(result.file!, 'utf8');
        expect(code).toMatch(/namespace Lib\.Controllers\b/);
        expect(code).toContain('[HttpPost]');
    });
});
