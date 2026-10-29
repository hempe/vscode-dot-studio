// Remove and Delete Project, Open File and the commands that open the NuGet manager, run through SolutionActionService against real solution files
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ui = {
    answer: undefined as string | undefined,
    prompts: [] as string[],
    errors: [] as string[],
    deleted: [] as { path: string; options: any }[],
    shown: [] as string[],
    commands: [] as unknown[][],
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
            fs: { delete: async (uri: any, options: any) => { ui.deleted.push({ path: uri.fsPath, options }); } },
        },
        window: {
            showWarningMessage: async (message: string) => { ui.prompts.push(message); return ui.answer; },
            showInformationMessage: async () => undefined,
            showErrorMessage: async (message: string) => { ui.errors.push(message); },
            showTextDocument: async (uri: any) => { ui.shown.push(uri.fsPath); },
        },
        commands: { executeCommand: async (...args: unknown[]) => { ui.commands.push(args); } },
    };
}, { virtual: true });

jest.mock('../../../core/constants', () => ({
    ...jest.requireActual('../../../core/constants'),
    isSystemPath: () => false,
}));

import { Solution } from '../../../core/Solution';
import { SolutionService } from '../../../services/solution/solutionService';
import { SolutionActionService } from '../../../services/solution/solutionActionService';
import { NodeIdService } from '../../../services/solution/nodeIdService';
import { ProjectItemsService } from '../../../services/project/items/projectItemsService';

beforeEach(() => { jest.spyOn(ProjectItemsService.instance, 'evaluate').mockResolvedValue(undefined); });
afterEach(() => jest.restoreAllMocks());

const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip;
const projectXml = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>';

const sln = `
Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Lib", "src\\Lib\\Lib.csproj", "{142F4FE7-2814-4E67-A7EF-97A50F8A2890}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Side", "Side.csproj", "{BBBBBBBB-2814-4E67-A7EF-97A50F8A2890}"
EndProject
Global
EndGlobal
`;
const slnx = `<Solution>
  <Project Path="src/Lib/Lib.csproj" />
  <Project Path="Side.csproj" />
</Solution>
`;

describe.each([['.sln', 'App.sln', sln], ['.slnx', 'App.slnx', slnx]])('project actions (%s)', (_, fileName, content) => {
    let dir: string;
    let file: string;
    let solution: Solution;
    const libPath = () => path.join(dir, 'src', 'Lib', 'Lib.csproj');
    const sidePath = () => path.join(dir, 'Side.csproj');
    const projectId = (projectPath: string) => NodeIdService.generateProjectId(projectPath);

    beforeEach(async () => {
        Object.assign(ui, { answer: undefined, prompts: [], errors: [], deleted: [], shown: [], commands: [] });
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-pa-')));
        fs.mkdirSync(path.dirname(libPath()), { recursive: true });
        fs.writeFileSync(libPath(), projectXml);
        fs.writeFileSync(sidePath(), projectXml);
        file = path.join(dir, fileName);
        fs.writeFileSync(file, content);
        solution = new Solution(file);
        for (let i = 0; i < 100 && !solution.isInitialized; i++) await new Promise(r => setTimeout(r, 10));
        (SolutionService as any).activeSolution = solution;
    });
    afterEach(() => {
        solution.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const names = () => [...solution.projects.keys()].map(p => path.basename(p)).sort();

    withDotnet('Remove Project asks first, then takes the project out of the solution and leaves its files', async () => {
        await SolutionActionService.handleProjectAction({ action: 'removeProject', nodeId: projectId(libPath()) });
        expect(ui.prompts).toEqual(["Are you sure you want to remove project 'Lib' from the solution?"]);
        expect(names()).toEqual(['Lib.csproj', 'Side.csproj']);

        ui.answer = 'Remove';
        await SolutionActionService.handleProjectAction({ action: 'removeProject', nodeId: projectId(libPath()) });
        expect(ui.errors).toEqual([]);
        expect(names()).toEqual(['Side.csproj']);
        expect(fs.existsSync(libPath())).toBe(true);
    }, 60000);

    withDotnet('Delete Project moves the project folder to the trash and removes it from the solution', async () => {
        ui.answer = 'Delete';
        await SolutionActionService.handleProjectAction({ action: 'deleteProject', nodeId: projectId(libPath()) });

        expect(ui.errors).toEqual([]);
        expect(names()).toEqual(['Side.csproj']);
        expect(ui.deleted).toEqual([{ path: path.dirname(libPath()), options: { recursive: true, useTrash: true } }]);
    }, 60000);

    withDotnet('Delete Project beside the solution file trashes only the project file, and says so', async () => {
        ui.answer = 'Delete';
        await SolutionActionService.handleProjectAction({ action: 'deleteProject', nodeId: projectId(sidePath()) });

        expect(ui.prompts[0]).toContain('only the project file is moved to the trash');
        expect(ui.deleted).toEqual([{ path: sidePath(), options: { recursive: false, useTrash: true } }]);
        expect(names()).toEqual(['Lib.csproj']);
    }, 60000);

    test('Delete Project does nothing when the question is declined', async () => {
        await SolutionActionService.handleProjectAction({ action: 'deleteProject', nodeId: projectId(libPath()) });
        expect(ui.deleted).toEqual([]);
        expect(names()).toEqual(['Lib.csproj', 'Side.csproj']);
    });

    test('Open File shows the file; a generated file is made read-only for the session', async () => {
        const source = path.join(dir, 'Side.cs');
        await SolutionActionService.handleProjectAction({ action: 'openFile', nodeId: NodeIdService.generateFileId(source) } as any);
        expect(ui.shown).toEqual([source]);
        expect(ui.commands).toEqual([]);

        await SolutionActionService.handleProjectAction({ action: 'openFile', nodeId: NodeIdService.generateGeneratedFileId(source) } as any);
        expect(ui.shown).toEqual([source, source]);
        expect(ui.commands).toEqual([['workbench.action.files.setActiveEditorReadonlyInSession']]);
    });

    test('Manage NuGet Packages opens the manager for the project, and for the solution', async () => {
        await SolutionActionService.handleProjectAction({ action: 'manageNuGetPackages', nodeId: projectId(libPath()) } as any);
        await SolutionActionService.handleProjectAction({ action: 'manageNuGetPackagesForSolution', nodeId: NodeIdService.generateSolutionId(file) } as any);

        expect(ui.commands).toEqual([['shinobi.openNuGetManager', libPath()], ['shinobi.openNuGetManagerForSolution', file]]);
    });
});
