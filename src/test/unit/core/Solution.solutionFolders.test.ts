// Solution folder and solution item actions, run through SolutionActionService against real .sln/.slnx files
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ui = {
    inputBox: undefined as string | undefined,
    openDialog: undefined as string | undefined,
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
        workspace: {
            createFileSystemWatcher: () => watcher,
            workspaceFolders: undefined,
            getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
            fs: {
                rename: async (from: any, to: any) => require('fs').renameSync(from.fsPath, to.fsPath),
                delete: async (uri: any) => require('fs').rmSync(uri.fsPath, { recursive: true }),
            },
        },
        window: {
            showInputBox: async () => ui.inputBox,
            showOpenDialog: async () => ui.openDialog ? [{ fsPath: ui.openDialog }] : undefined,
            showWarningMessage: async (_message: string, _options: any, button: string) => button,
            showInformationMessage: async () => undefined,
            showErrorMessage: async (message: string) => { ui.errors.push(message); },
        },
        commands: { executeCommand: async () => undefined },
    };
}, { virtual: true });

// The parsers refuse paths under /tmp (and /var, where macOS keeps its temp dir)
jest.mock('../../../core/constants', () => ({
    ...jest.requireActual('../../../core/constants'),
    isSystemPath: () => false,
}));

import { Solution } from '../../../core/Solution';
import { SolutionService } from '../../../services/solutionService';
import { SolutionActionService } from '../../../services/solutionActionService';
import { SolutionTreeService } from '../../../services/solutionTreeService';
import { NodeIdService } from '../../../services/nodeIdService';
import { ProjectNode } from '../../../types';
import { ProjectActionCmd } from '../../../types/commands/project-action';
import { ProjectItemsService } from '../../../services/projectItems/projectItemsService';

// The Projects created here would ask MSBuild for their items (a `dotnet msbuild` per project): not in unit tests
beforeEach(() => { jest.spyOn(ProjectItemsService.instance, 'evaluate').mockResolvedValue(undefined); });

// As written by `dotnet new sln` + `dotnet sln add src/Lib/Lib.csproj --solution-folder Libs`
const slnContent = `
Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
VisualStudioVersion = 17.0.31903.59
MinimumVisualStudioVersion = 10.0.40219.1
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Libs", "Libs", "{6C4D298B-81FB-2B6B-5AB6-46205EDDC72C}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Lib", "src\\Lib\\Lib.csproj", "{142F4FE7-2814-4E67-A7EF-97A50F8A2890}"
EndProject
Global
	GlobalSection(SolutionConfigurationPlatforms) = preSolution
		Debug|Any CPU = Debug|Any CPU
		Release|Any CPU = Release|Any CPU
	EndGlobalSection
	GlobalSection(ProjectConfigurationPlatforms) = postSolution
		{142F4FE7-2814-4E67-A7EF-97A50F8A2890}.Debug|Any CPU.ActiveCfg = Debug|Any CPU
		{142F4FE7-2814-4E67-A7EF-97A50F8A2890}.Debug|Any CPU.Build.0 = Debug|Any CPU
		{142F4FE7-2814-4E67-A7EF-97A50F8A2890}.Release|Any CPU.ActiveCfg = Release|Any CPU
		{142F4FE7-2814-4E67-A7EF-97A50F8A2890}.Release|Any CPU.Build.0 = Release|Any CPU
	EndGlobalSection
	GlobalSection(SolutionProperties) = preSolution
		HideSolutionNode = FALSE
	EndGlobalSection
	GlobalSection(NestedProjects) = preSolution
		{142F4FE7-2814-4E67-A7EF-97A50F8A2890} = {6C4D298B-81FB-2B6B-5AB6-46205EDDC72C}
	EndGlobalSection
EndGlobal
`;

const slnxContent = `<Solution>
  <Folder Name="/Libs/">
    <Project Path="src/Lib/Lib.csproj" />
  </Folder>
</Solution>
`;

// Adding projects runs `dotnet sln add`
const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip;

const variants: [string, string, string][] = [
    ['.sln', 'App.sln', slnContent],
    ['.sln with CRLF line endings', 'App.sln', slnContent.replace(/\n/g, '\r\n')],
    ['.slnx', 'App.slnx', slnxContent],
];

describe.each(variants)('solution folders and items (%s)', (_, fileName, initialContent) => {
    let dir: string;
    let file: string;
    let solution: Solution;

    const nodes = () => SolutionTreeService.buildSolutionTree(solution);
    const outline = async () => {
        const print = (list: ProjectNode[], indent: string): string[] =>
            list.flatMap(n => [`${indent}${n.type}: ${n.name}`, ...print(n.children ?? [], indent + '  ')]);
        return print((await nodes())[0].children ?? [], '');
    };
    const find = async (type: string, ...names: string[]): Promise<ProjectNode> => {
        let list = await nodes();
        let node: ProjectNode | undefined;
        for (const name of ['', ...names]) {
            const search = (items: ProjectNode[]): ProjectNode | undefined => {
                for (const n of items) {
                    if ((name === '' ? n.type === 'solution' : n.name === name)) return n;
                }
                return undefined;
            };
            node = search(list);
            if (!node) throw new Error(`${type} ${names.join('/')} not found`);
            list = node.children ?? [];
        }
        expect(node!.type).toBe(type);
        return node!;
    };
    const run = async (cmd: ProjectActionCmd) => {
        await SolutionActionService.handleProjectAction(cmd);
        expect(ui.errors).toEqual([]);
    };

    beforeEach(async () => {
        ui.errors = [];
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-sf-')));
        file = path.join(dir, fileName);
        fs.writeFileSync(file, initialContent);
        fs.writeFileSync(path.join(dir, 'README.md'), '# readme');
        fs.writeFileSync(path.join(dir, 'LICENSE'), 'MIT');

        solution = new Solution(file);
        for (let i = 0; i < 100 && !solution.isInitialized; i++) await new Promise(r => setTimeout(r, 10));
        (SolutionService as any).activeSolution = solution;
    });

    afterEach(() => {
        solution.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const createProject = (name: string) => {
        const projectPath = path.join(dir, 'src', name, `${name}.csproj`);
        fs.mkdirSync(path.dirname(projectPath), { recursive: true });
        fs.writeFileSync(projectPath, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>');
        return projectPath;
    };

    withDotnet('adds an existing project into a nested solution folder', async () => {
        ui.inputBox = 'Inner';
        await run({ action: 'addSolutionFolder', nodeId: (await find('solutionFolder', 'Libs')).nodeId });

        ui.openDialog = createProject('Api');
        await run({ action: 'addExistingProject', nodeId: (await find('solutionFolder', 'Libs', 'Inner')).nodeId });

        expect(await outline()).toEqual([
            'solutionFolder: Libs',
            '  solutionFolder: Inner',
            '    project: Api',
            '  project: Lib',
        ]);
    }, 60000);

    withDotnet('an existing project added to the solution stays at the root', async () => {
        ui.openDialog = createProject('Api');
        await run({ action: 'addExistingProject', nodeId: (await find('solution')).nodeId });

        expect(await outline()).toEqual([
            'solutionFolder: Libs',
            '  project: Lib',
            'project: Api',
        ]);
    }, 60000);

    withDotnet('a project file picked as solution item is added as a project', async () => {
        ui.openDialog = createProject('Api');
        await run({ action: 'addSolutionItem', nodeId: (await find('solutionFolder', 'Libs')).nodeId });

        expect(await outline()).toEqual([
            'solutionFolder: Libs',
            '  project: Api',
            '  project: Lib',
        ]);
    }, 60000);

    test('adds solution folders at the root and nested', async () => {
        ui.inputBox = 'Docs';
        await run({ action: 'addSolutionFolder', nodeId: (await find('solution')).nodeId });
        ui.inputBox = 'Inner';
        await run({ action: 'addSolutionFolder', nodeId: (await find('solutionFolder', 'Libs')).nodeId });

        expect(await outline()).toEqual([
            'solutionFolder: Docs',
            'solutionFolder: Libs',
            '  solutionFolder: Inner',
            '  project: Lib',
        ]);
    });

    test('adds solution items to the root ("Solution Items") and to a folder, and removes them', async () => {
        ui.openDialog = path.join(dir, 'README.md');
        await run({ action: 'addSolutionItem', nodeId: (await find('solution')).nodeId });
        ui.openDialog = path.join(dir, 'LICENSE');
        await run({ action: 'addSolutionItem', nodeId: (await find('solutionFolder', 'Libs')).nodeId });

        expect(await outline()).toEqual([
            'solutionFolder: Libs',
            '  project: Lib',
            '  solutionItem: LICENSE',
            'solutionFolder: Solution Items',
            '  solutionItem: README.md',
        ]);

        await run({ action: 'removeSolutionItem', nodeId: (await find('solutionItem', 'Solution Items', 'README.md')).nodeId });

        expect(await outline()).toEqual([
            'solutionFolder: Libs',
            '  project: Lib',
            '  solutionItem: LICENSE',
            'solutionFolder: Solution Items',
        ]);
        expect(fs.existsSync(path.join(dir, 'README.md'))).toBe(true);
    });

    test('renames a solution folder', async () => {
        await run({ action: 'rename', nodeId: (await find('solutionFolder', 'Libs')).nodeId, data: { newName: 'Libraries', oldName: 'Libs', type: 'solutionFolder' } });

        expect(await outline()).toEqual([
            'solutionFolder: Libraries',
            '  project: Lib',
        ]);
    });

    test('renames a solution item on disk and in the solution', async () => {
        ui.openDialog = path.join(dir, 'LICENSE');
        await run({ action: 'addSolutionItem', nodeId: (await find('solutionFolder', 'Libs')).nodeId });

        await run({ action: 'rename', nodeId: (await find('solutionItem', 'Libs', 'LICENSE')).nodeId, data: { newName: 'LICENSE.txt', oldName: 'LICENSE', type: 'solutionItem' } });

        expect(await outline()).toEqual([
            'solutionFolder: Libs',
            '  project: Lib',
            '  solutionItem: LICENSE.txt',
        ]);
        expect(fs.existsSync(path.join(dir, 'LICENSE.txt'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'LICENSE'))).toBe(false);
    });

    test('removes the clicked folder when another folder has the same name', async () => {
        ui.inputBox = 'Docs';
        await run({ action: 'addSolutionFolder', nodeId: (await find('solution')).nodeId });
        ui.inputBox = 'Inner';
        await run({ action: 'addSolutionFolder', nodeId: (await find('solutionFolder', 'Libs')).nodeId });
        await run({ action: 'addSolutionFolder', nodeId: (await find('solutionFolder', 'Docs')).nodeId });

        await run({ action: 'removeSolutionFolder', nodeId: (await find('solutionFolder', 'Docs', 'Inner')).nodeId });

        expect(await outline()).toEqual([
            'solutionFolder: Docs',
            'solutionFolder: Libs',
            '  solutionFolder: Inner',
            '  project: Lib',
        ]);
    });

    test('removes a solution folder together with its projects', async () => {
        await run({ action: 'removeSolutionFolder', nodeId: (await find('solutionFolder', 'Libs')).nodeId });

        expect(await outline()).toEqual([]);
    });

    test('refuses a solution folder name a sibling has, on add and on rename (review A1-05)', async () => {
        ui.inputBox = 'libs';
        await SolutionActionService.handleProjectAction({ action: 'addSolutionFolder', nodeId: (await find('solution')).nodeId });
        expect(ui.errors).toEqual([expect.stringContaining('already')]);

        ui.errors = [];
        ui.inputBox = 'Inner';
        await run({ action: 'addSolutionFolder', nodeId: (await find('solutionFolder', 'Libs')).nodeId });
        await SolutionActionService.handleProjectAction({ action: 'addSolutionFolder', nodeId: (await find('solutionFolder', 'Libs')).nodeId });
        expect(ui.errors).toEqual([expect.stringContaining('already')]);

        // Another parent may have the same name, and a folder may keep its own name in another case
        ui.errors = [];
        ui.inputBox = 'Docs';
        await run({ action: 'addSolutionFolder', nodeId: (await find('solution')).nodeId });
        ui.inputBox = 'Inner';
        await run({ action: 'addSolutionFolder', nodeId: (await find('solutionFolder', 'Docs')).nodeId });
        await run({ action: 'rename', nodeId: (await find('solutionFolder', 'Docs')).nodeId, data: { newName: 'DOCS', oldName: 'Docs', type: 'solutionFolder' } });

        await SolutionActionService.handleProjectAction({ action: 'rename', nodeId: (await find('solutionFolder', 'DOCS')).nodeId, data: { newName: 'libs', oldName: 'DOCS', type: 'solutionFolder' } });
        expect(ui.errors).toEqual([expect.stringContaining('already')]);
        expect(await outline()).toEqual([
            'solutionFolder: DOCS',
            '  solutionFolder: Inner',
            'solutionFolder: Libs',
            '  solutionFolder: Inner',
            '  project: Lib',
        ]);
    });

    test('keeps the line endings of the file', async () => {
        ui.inputBox = 'Docs';
        await run({ action: 'addSolutionFolder', nodeId: (await find('solution')).nodeId });

        const content = fs.readFileSync(file, 'utf8');
        const crlf = initialContent.includes('\r\n');
        expect(/(^|[^\r])\n/.test(content)).toBe(!crlf);
        expect(content.includes('\r\n')).toBe(crlf);
    });

    test('rejects folder names that would corrupt the solution file', async () => {
        ui.inputBox = 'a"b';
        await SolutionActionService.handleProjectAction({ action: 'addSolutionFolder', nodeId: (await find('solution')).nodeId });

        expect(ui.errors).toEqual([expect.stringContaining('Invalid')]);
        expect(await outline()).toEqual(['solutionFolder: Libs', '  project: Lib']);
    });

    test('renames a project file like Visual Studio: same solution folder and GUID, folder unchanged', async () => {
        const libPath = createProject('Lib');
        await solution.refresh();
        const before = fs.readFileSync(file, 'utf8');

        await run({ action: 'rename', nodeId: (await find('project', 'Libs', 'Lib')).nodeId, data: { newName: 'Shop.Lib', type: 'project', oldName: 'Lib' } });

        expect(fs.existsSync(libPath)).toBe(false);
        expect(fs.existsSync(path.join(dir, 'src', 'Lib', 'Shop.Lib.csproj'))).toBe(true);
        expect(await outline()).toEqual(['solutionFolder: Libs', '  project: Shop.Lib']);
        const after = fs.readFileSync(file, 'utf8');
        if (fileName.endsWith('.sln')) {
            expect(after).toContain('"Shop.Lib", "src\\Lib\\Shop.Lib.csproj", "{142F4FE7-2814-4E67-A7EF-97A50F8A2890}"');
            expect(after.split('{142F4FE7-2814-4E67-A7EF-97A50F8A2890}').length).toBe(before.split('{142F4FE7-2814-4E67-A7EF-97A50F8A2890}').length);
        } else {
            expect(after).toContain('<Project Path="src/Lib/Shop.Lib.csproj" />');
        }
    });

    test('renames the solution file and opens it under the new name', async () => {
        await run({ action: 'rename', nodeId: (await find('solution')).nodeId, data: { newName: 'Shop', type: 'solution', oldName: 'App' } });

        const renamed = path.join(dir, `Shop${path.extname(fileName)}`);
        expect(fs.existsSync(file)).toBe(false);
        expect(fs.existsSync(renamed)).toBe(true);
        const active = SolutionService.getActiveSolution()!;
        expect(active.solutionPath).toBe(renamed);
        active.dispose();
    });

    test('removes several selected solution items at once, asking once (multi-select)', async () => {
        ui.openDialog = path.join(dir, 'README.md');
        await run({ action: 'addSolutionItem', nodeId: (await find('solution')).nodeId });
        ui.openDialog = path.join(dir, 'LICENSE');
        await run({ action: 'addSolutionItem', nodeId: (await find('solution')).nodeId });
        const items = [await find('solutionItem', 'Solution Items', 'README.md'), await find('solutionItem', 'Solution Items', 'LICENSE')];

        await SolutionActionService.handleMultiAction('removeSolutionItem', items.map(item => item.nodeId));

        expect(await outline()).toEqual(['solutionFolder: Libs', '  project: Lib', 'solutionFolder: Solution Items']);
        expect(fs.existsSync(path.join(dir, 'README.md'))).toBe(true);
    });

    test('deletes several selected files at once (multi-select)', async () => {
        const a = path.join(dir, 'a.txt');
        const b = path.join(dir, 'b.txt');
        fs.writeFileSync(a, '');
        fs.writeFileSync(b, '');

        await SolutionActionService.handleMultiAction('deleteFile', [a, b].map(file => NodeIdService.generateFileId(file)));

        expect([fs.existsSync(a), fs.existsSync(b)]).toEqual([false, false]);
        expect(ui.errors).toEqual([]);
    });

    test('shows nested files under their parent, at the top of a project and in its folders', async () => {
        const libPath = createProject('Lib');
        const libDir = path.dirname(libPath);
        fs.mkdirSync(path.join(libDir, 'Pages'));
        for (const file of ['appsettings.json', 'appsettings.Development.json', 'Pages/Index.cshtml', 'Pages/Index.cshtml.cs']) {
            fs.writeFileSync(path.join(libDir, file), '');
        }
        await solution.refresh();
        const project = solution.getProject(libPath)!;
        for (let i = 0; i < 100 && !(project as any)._isInitialized; i++) await new Promise(r => setTimeout(r, 10));
        const names = (children: any[]): string[] => children.flatMap(child => [child.name, ...(child.children ?? []).map((nested: any) => `  ${nested.name}`)]);

        expect(names(await project.getRootChildren())).toEqual(expect.arrayContaining(['appsettings.json', '  appsettings.Development.json']));
        expect(names(await project.getFolderChildren(path.join(libDir, 'Pages')))).toEqual(['Index.cshtml', '  Index.cshtml.cs']);
    });
});

describe('removing a .sln solution folder (review A1-06)', () => {
    // GUIDs in lower case, as some tools write them; a SQL project (not a C#, VB or F# one) inside the folder
    const content = `
Microsoft Visual Studio Solution File, Format Version 12.00
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Data", "Data", "{6C4D298B-81FB-2B6B-5AB6-46205EDDC72C}"
EndProject
Project("{fae04ec0-301f-11d3-bf4b-00c04f79efbc}") = "Lib", "src\\Lib\\Lib.csproj", "{142f4fe7-2814-4e67-a7ef-97a50f8a2890}"
EndProject
Project("{00D1A9C2-B5F0-4AF3-8072-F6C62B433612}") = "Db", "src\\Db\\Db.sqlproj", "{AAAAAAAA-2814-4E67-A7EF-97A50F8A2890}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "App", "src\\App\\App.csproj", "{BBBBBBBB-2814-4E67-A7EF-97A50F8A2890}"
EndProject
Global
	GlobalSection(SolutionConfigurationPlatforms) = preSolution
		Debug|Any CPU = Debug|Any CPU
	EndGlobalSection
	GlobalSection(ProjectConfigurationPlatforms) = postSolution
		{142f4fe7-2814-4e67-a7ef-97a50f8a2890}.Debug|Any CPU.ActiveCfg = Debug|Any CPU
		{142f4fe7-2814-4e67-a7ef-97a50f8a2890}.Debug|Any CPU.Build.0 = Debug|Any CPU
		{AAAAAAAA-2814-4E67-A7EF-97A50F8A2890}.Debug|Any CPU.ActiveCfg = Debug|Any CPU
		{BBBBBBBB-2814-4E67-A7EF-97A50F8A2890}.Debug|Any CPU.ActiveCfg = Debug|Any CPU
		{BBBBBBBB-2814-4E67-A7EF-97A50F8A2890}.Debug|Any CPU.Build.0 = Debug|Any CPU
	EndGlobalSection
	GlobalSection(NestedProjects) = preSolution
		{142f4fe7-2814-4e67-a7ef-97a50f8a2890} = {6c4d298b-81fb-2b6b-5ab6-46205eddc72c}
		{AAAAAAAA-2814-4E67-A7EF-97A50F8A2890} = {6C4D298B-81FB-2B6B-5AB6-46205EDDC72C}
	EndGlobalSection
EndGlobal
`;

    test('takes every project in it, whatever its type or the case of the GUIDs, and their configuration lines', async () => {
        const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-rm-')));
        const file = path.join(dir, 'App.sln');
        fs.writeFileSync(file, content);
        const solution = new Solution(file);
        try {
            for (let i = 0; i < 100 && !solution.isInitialized; i++) await new Promise(r => setTimeout(r, 10));
            await solution.removeSolutionFolder('{6C4D298B-81FB-2B6B-5AB6-46205EDDC72C}');

            const after = fs.readFileSync(file, 'utf8');
            expect(after).toContain('"App"');
            expect(after).not.toMatch(/Data|Lib|Db|sqlproj|6c4d298b|142f4fe7|AAAAAAAA/i);
            expect(after).toContain('{BBBBBBBB-2814-4E67-A7EF-97A50F8A2890}.Debug|Any CPU.Build.0');
        } finally {
            solution.dispose();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
