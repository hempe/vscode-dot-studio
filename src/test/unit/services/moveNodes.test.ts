// Drag & drop in the extension host: SolutionActionService.moveNodes on a copy of src/__fixtures__/solution-hierarchy
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ui = {
    answers: [] as (string | undefined)[],
    questions: [] as string[],
    warnings: [] as string[],
    errors: [] as string[],
};

jest.mock('vscode', () => {
    // As in namespaceAfterMove.test.ts, plus the warnings
    const disposable = { dispose: () => { } };
    const watcher = { onDidChange: () => disposable, onDidCreate: () => disposable, onDidDelete: () => disposable, dispose: () => { } };
    class EventEmitter { event = () => disposable; fire() { } dispose() { } }
    const nodeFs = require('fs');
    const ask = async (message: string, ...rest: unknown[]) => {
        if (!rest.some(item => typeof item === 'string')) {
            return undefined;
        }
        ui.questions.push(message);
        return ui.answers.shift();
    };
    return {
        EventEmitter,
        Position: class { constructor(public line: number, public character: number) { } },
        RelativePattern: class { constructor(public base: string, public pattern: string) { } },
        Uri: { file: (p: string) => ({ fsPath: p }) },
        FileType: { File: 1, Directory: 2 },
        workspace: {
            createFileSystemWatcher: () => watcher,
            workspaceFolders: undefined,
            getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
            openTextDocument: async () => { throw new Error('no editor in unit tests'); },
            fs: {
                stat: async (uri: any) => ({ type: nodeFs.statSync(uri.fsPath).isDirectory() ? 2 : 1 }),
                rename: async (from: any, to: any) => nodeFs.renameSync(from.fsPath, to.fsPath),
                copy: async (from: any, to: any) => nodeFs.cpSync(from.fsPath, to.fsPath, { recursive: true }),
            },
        },
        window: {
            showInformationMessage: ask,
            showWarningMessage: async (message: string, ...rest: unknown[]) => { ui.warnings.push(message); return ask(message, ...rest); },
            showErrorMessage: async (message: string) => { ui.errors.push(message); },
        },
        commands: { executeCommand: async () => undefined },
    };
}, { virtual: true });

jest.mock('../../../core/constants', () => ({
    ...jest.requireActual('../../../core/constants'),
    isSystemPath: () => false,
}));

import { Solution } from '../../../core/Solution';
import { SolutionService } from '../../../services/solutionService';
import { SolutionActionService } from '../../../services/solutionActionService';
import { NodeIdService } from '../../../services/nodeIdService';
import { solutionDropNode } from '../../../services/solutionDropNodes';
import { ProjectItemsService } from '../../../services/projectItems/projectItemsService';

const fixture = path.join(__dirname, '../../../__fixtures__/solution-hierarchy');

describe('SolutionActionService.moveNodes (drag & drop)', () => {
    let dir: string;
    let solution: Solution;
    const at = (...parts: string[]) => path.join(dir, ...parts);
    const write = (content: string, ...parts: string[]) => {
        fs.mkdirSync(path.dirname(at(...parts)), { recursive: true });
        fs.writeFileSync(at(...parts), content);
        return at(...parts);
    };
    const guid = (...names: string[]) => solution.solutionFile!.projects
        .find(p => solution.isSolutionFolder(p) && solution.getSolutionFolderPath(p.guid) === names.join('/'))!.guid;
    const folderNode = (...names: string[]) => NodeIdService.generateSolutionFolderId(names[names.length - 1], solution.solutionPath, guid(...names), undefined);
    const projectNode = (...parts: string[]) => NodeIdService.generateProjectId(at(...parts));
    const fileNode = (...parts: string[]) => NodeIdService.generateFileId(at(...parts));
    const dirNode = (...parts: string[]) => NodeIdService.generateFolderId(at(...parts));
    const parentName = (name: string) => {
        const model = solution.solutionFile!;
        const child = model.projects.find(p => p.name === name)!;
        const parent = model.nestedProjects.find(n => n.childGuid === child.guid)?.parentGuid;
        return parent ? model.projects.find(p => p.guid === parent)!.name : 'root';
    };

    beforeEach(async () => {
        ui.answers = [];
        ui.questions = [];
        ui.warnings = [];
        ui.errors = [];
        jest.spyOn(ProjectItemsService.instance, 'evaluate').mockResolvedValue(undefined);
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-dnd-')));
        fs.cpSync(fixture, dir, { recursive: true });
        solution = new Solution(at('TestHierarchy.sln'));
        for (let i = 0; i < 100 && !solution.isInitialized; i++) await new Promise(r => setTimeout(r, 10));
        (SolutionService as any).activeSolution = solution;
    });

    afterEach(() => {
        (SolutionService as any).activeSolution = undefined;
        solution.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('the rule nodes come from the solution: a file has its folders, project, solution folders and the solution above it', () => {
        write('namespace Utils.Text;\n', 'lib', 'Utils', 'Text', 'Words.cs');

        expect(solutionDropNode(solution, fileNode('lib', 'Utils', 'Text', 'Words.cs'))!.ancestors.map(a => a.type))
            .toEqual(['folder', 'project', 'solutionFolder', 'solutionFolder', 'solution']);
    });

    test('moves a file into a folder of another project and asks once about its namespace', async () => {
        write('namespace CoreLibrary;\n\npublic class Helper { }\n', 'lib', 'CoreLibrary', 'Helper.cs');
        fs.mkdirSync(at('lib', 'Utils', 'Text'));
        ui.answers = ['Update Namespace'];

        await SolutionActionService.moveNodes([fileNode('lib', 'CoreLibrary', 'Helper.cs')], dirNode('lib', 'Utils', 'Text'), false);

        expect(fs.existsSync(at('lib', 'CoreLibrary', 'Helper.cs'))).toBe(false);
        expect(fs.readFileSync(at('lib', 'Utils', 'Text', 'Helper.cs'), 'utf8')).toContain('namespace Utils.Text;');
        expect(ui.questions).toHaveLength(1);
        expect(ui.errors).toEqual([]);
    });

    test('Ctrl copies: the file stays, and nothing is asked', async () => {
        write('namespace CoreLibrary;\n', 'lib', 'CoreLibrary', 'Helper.cs');

        await SolutionActionService.moveNodes([fileNode('lib', 'CoreLibrary', 'Helper.cs')], projectNode('lib', 'Utils', 'Utils.csproj'), true);

        expect(fs.existsSync(at('lib', 'CoreLibrary', 'Helper.cs'))).toBe(true);
        expect(fs.readFileSync(at('lib', 'Utils', 'Helper.cs'), 'utf8')).toBe('namespace CoreLibrary;\n');
        expect(ui.questions).toEqual([]);
    });

    test('a folder of C# files: one question for all of them', async () => {
        write('namespace CoreLibrary.Models;\n\npublic class A { }\n', 'lib', 'CoreLibrary', 'Models', 'A.cs');
        write('namespace CoreLibrary.Models;\n\npublic class B { }\n', 'lib', 'CoreLibrary', 'Models', 'B.cs');
        ui.answers = ['Update All'];

        await SolutionActionService.moveNodes([dirNode('lib', 'CoreLibrary', 'Models')], projectNode('lib', 'Utils', 'Utils.csproj'), false);

        expect(ui.questions).toHaveLength(1);
        for (const file of ['A.cs', 'B.cs']) {
            expect(fs.readFileSync(at('lib', 'Utils', 'Models', file), 'utf8')).toContain('namespace Utils.Models;');
        }
    });

    test('a file dropped on a file goes into that file\'s folder', async () => {
        write('namespace CoreLibrary;\n', 'lib', 'CoreLibrary', 'Helper.cs');
        write('namespace Utils.Text;\n', 'lib', 'Utils', 'Text', 'Words.cs');
        ui.answers = ['Skip'];

        await SolutionActionService.moveNodes([fileNode('lib', 'CoreLibrary', 'Helper.cs')], fileNode('lib', 'Utils', 'Text', 'Words.cs'), false);

        expect(fs.existsSync(at('lib', 'Utils', 'Text', 'Helper.cs'))).toBe(true);
    });

    test('refuses what the rules refuse, whatever the webview sent', async () => {
        write('namespace CoreLibrary.Models;\n', 'lib', 'CoreLibrary', 'Models', 'Sub', 'A.cs');

        await SolutionActionService.moveNodes([dirNode('lib', 'CoreLibrary', 'Models')], dirNode('lib', 'CoreLibrary', 'Models', 'Sub'), false);
        await SolutionActionService.moveNodes([NodeIdService.generateDependenciesId(at('lib', 'Utils', 'Utils.csproj'))], folderNode('Tools'), false);

        expect(fs.existsSync(at('lib', 'CoreLibrary', 'Models', 'Sub', 'A.cs'))).toBe(true);
        expect(ui.warnings).toEqual([expect.stringContaining('cannot be dropped there'), expect.stringContaining('cannot be dropped there')]);
    });

    test('several nodes: the project and the solution item go into the solution folder, the file stays', async () => {
        write('namespace CoreLibrary;\n', 'lib', 'CoreLibrary', 'Helper.cs');
        const readme = NodeIdService.generateSolutionItemId('README.md', guid('Web Projects'), at('README.md'));

        await SolutionActionService.moveNodes(
            [projectNode('src', 'WebApp', 'WebApp.csproj'), readme, fileNode('lib', 'CoreLibrary', 'Helper.cs')], folderNode('Tools'), false);

        expect(parentName('WebApp')).toBe('Tools');
        expect(solution.getSolutionItems(solution.solutionFile!.projects.find(p => p.name === 'Tools')!)).toEqual(['README.md']);
        expect(fs.existsSync(at('lib', 'CoreLibrary', 'Helper.cs'))).toBe(true);
        expect(ui.errors).toEqual([]);
    });

    test('a solution folder to the root, and a refused duplicate name shows the error', async () => {
        const folderPaths = () => solution.solutionFile!.projects.filter(p => solution.isSolutionFolder(p)).map(p => solution.getSolutionFolderPath(p.guid));
        await SolutionActionService.moveNodes([folderNode('Libraries', 'Shared')], NodeIdService.generateSolutionId(solution.solutionPath), false);
        expect(folderPaths()).toEqual(expect.arrayContaining(['Shared']));
        expect(folderPaths()).not.toContain('Libraries/Shared');

        await SolutionActionService.moveNodes([folderNode('Shared')], folderNode('Web Projects'), false);
        expect(ui.errors).toEqual([expect.stringContaining('already contains "Shared"')]);
    });

    test('ids the solution does not have are refused without touching anything', async () => {
        const helper = write('namespace CoreLibrary;\n', 'lib', 'CoreLibrary', 'Helper.cs');
        const before = fs.readFileSync(solution.solutionPath, 'utf8');
        const tools = folderNode('Tools');
        const drops: [string[], string][] = [
            // Not an id at all
            [['not-an-id'], tools],
            [[fileNode('lib', 'CoreLibrary', 'Helper.cs')], 'garbage' as any],
            // A solution folder that is not there
            [[projectNode('src', 'WebApp', 'WebApp.csproj')], NodeIdService.generateSolutionFolderId('Gone', solution.solutionPath, '{DEADBEEF-0000-0000-0000-000000000000}', undefined)],
            // A project that is not in the solution
            [[NodeIdService.generateProjectId(at('elsewhere', 'Other.csproj'))], tools],
            // Another solution
            [[projectNode('src', 'WebApp', 'WebApp.csproj')], NodeIdService.generateSolutionId(at('Other.sln'))],
            // A solution item the folder does not have
            [[NodeIdService.generateSolutionItemId('Other.md', guid('Web Projects'), at('Other.md'))], tools],
            // A file id for a folder, a folder id for a file, a file that is not there
            [[fileNode('lib', 'CoreLibrary')], projectNode('lib', 'Utils', 'Utils.csproj')],
            [[fileNode('lib', 'CoreLibrary', 'Helper.cs')], dirNode('lib', 'Utils', 'Utils.csproj')],
            [[fileNode('lib', 'CoreLibrary', 'Missing.cs')], projectNode('lib', 'Utils', 'Utils.csproj')],
            // A file outside every project
            [[NodeIdService.generateFileId(at('README.md'))], projectNode('lib', 'Utils', 'Utils.csproj')],
        ];

        for (const [nodes, target] of drops) {
            await SolutionActionService.moveNodes(nodes as any, target as any, false);
        }

        expect(ui.warnings).toHaveLength(drops.length);
        expect(ui.warnings.every(w => w.includes('cannot be dropped there'))).toBe(true);
        expect(ui.errors).toEqual([]);
        expect(fs.existsSync(helper)).toBe(true);
        expect(fs.existsSync(at('README.md'))).toBe(true);
        expect(fs.readFileSync(solution.solutionPath, 'utf8')).toBe(before);
    });
});
