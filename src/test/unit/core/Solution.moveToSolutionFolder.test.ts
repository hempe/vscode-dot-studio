// Solution.moveToSolutionFolder: drag & drop of projects, solution folders and solution items, on a copy of
// src/__fixtures__/solution-hierarchy
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
        },
        window: { showInformationMessage: async () => undefined, showWarningMessage: async () => undefined, showErrorMessage: async () => undefined },
        commands: { executeCommand: async () => undefined },
    };
}, { virtual: true });

// The parsers refuse paths under /tmp (and /var, where macOS keeps its temp dir)
jest.mock('../../../core/constants', () => ({
    ...jest.requireActual('../../../core/constants'),
    isSystemPath: () => false,
}));

import { Solution, SolutionNodeMove } from '../../../core/Solution';
import { ProjectItemsService } from '../../../services/projectItems/projectItemsService';

beforeEach(() => { jest.spyOn(ProjectItemsService.instance, 'evaluate').mockResolvedValue(undefined); });

const fixture = path.join(__dirname, '../../../__fixtures__/solution-hierarchy');

const openSolution = async (file: string) => {
    const solution = new Solution(file);
    for (let i = 0; i < 100 && !solution.isInitialized; i++) await new Promise(r => setTimeout(r, 10));
    return solution;
};

const variants: [string, string, (text: string) => string][] = [
    ['.sln', 'TestHierarchy.sln', text => text],
    ['.sln with CRLF line endings', 'TestHierarchy.sln', text => text.replace(/\n/g, '\r\n')],
    ['.slnx', 'TestHierarchy.slnx', text => text],
    ['.slnx with CRLF line endings', 'TestHierarchy.slnx', text => text.replace(/\n/g, '\r\n')],
];

describe.each(variants)('Solution.moveToSolutionFolder (%s)', (_, fileName, transform) => {
    let dir: string;
    let file: string;
    let solution: Solution;
    const isSln = fileName.endsWith('.sln');

    beforeEach(async () => {
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-move-')));
        fs.cpSync(fixture, dir, { recursive: true });
        file = path.join(dir, fileName);
        fs.writeFileSync(file, transform(fs.readFileSync(file, 'utf8')));
        solution = await openSolution(file);
    });

    afterEach(() => {
        solution.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    // Folders and projects by name, nested by indentation; solution items as "- path"
    const outline = (): string[] => {
        const model = solution.solutionFile!;
        const parentOf = (guid: string) => model.nestedProjects.find(n => n.childGuid === guid)?.parentGuid;
        const print = (parent: string | undefined, indent: string): string[] => model.projects
            .filter(p => parentOf(p.guid) === parent)
            .sort((a, b) => a.name.localeCompare(b.name))
            .flatMap(p => [
                `${indent}${p.name}`,
                ...solution.getSolutionItems(p).map(item => `${indent}  - ${item.replace(/\\/g, '/')}`),
                ...(solution.isSolutionFolder(p) ? print(p.guid, `${indent}  `) : []),
            ]);
        return print(undefined, '');
    };
    const folder = (...names: string[]) => solution.solutionFile!.projects
        .find(p => solution.isSolutionFolder(p) && solution.getSolutionFolderPath(p.guid) === names.join('/'))!.guid;
    const project = (...parts: string[]): SolutionNodeMove => ({ kind: 'project', projectPath: path.join(dir, ...parts) });
    const text = () => fs.readFileSync(file, 'utf8');
    /** The .slnx with LF line endings, after checking the CRLF variant has no LF left */
    const slnxText = () => {
        const content = text();
        if (content.includes('\r\n')) expect(content.replace(/\r\n/g, '')).not.toContain('\n');
        return content.replace(/\r\n/g, '\n');
    };
    /** Lines only in `before`, and lines only in `after` */
    const diff = (before: string, after: string) => {
        const a = before.split(/\r?\n/);
        const b = after.split(/\r?\n/);
        return { removed: a.filter(line => !b.includes(line)), added: b.filter(line => !a.includes(line)) };
    };
    const webProjects = ['Web Projects', '  - README.md', '  Shared', '  WebApi', '  WebApp'];

    test('the fixture', () => {
        expect(outline()).toEqual(['Libraries', '  CoreLibrary', '  Shared', '    Utils', 'StandaloneProject', 'Tools', ...webProjects]);
    });

    test('moves a project into a solution folder', async () => {
        const before = text();
        await solution.moveToSolutionFolder(project('src', 'WebApp', 'WebApp.csproj'), folder('Tools'));

        expect(outline()).toEqual(['Libraries', '  CoreLibrary', '  Shared', '    Utils', 'StandaloneProject', 'Tools', '  WebApp',
            'Web Projects', '  - README.md', '  Shared', '  WebApi']);
        if (isSln) {
            expect(diff(before, text())).toEqual({
                removed: ['\t\t{33333333-3333-3333-3333-333333333333} = {11111111-1111-1111-1111-111111111111}'],
                added: ['\t\t{33333333-3333-3333-3333-333333333333} = {99999999-9999-9999-9999-999999999999}'],
            });
        } else {
            expect(slnxText()).toContain('  <Folder Name="/Tools/">\n    <Project Path="src/WebApp/WebApp.csproj" />\n  </Folder>\n');
        }
    });

    test('moves a project to the solution root', async () => {
        const before = text();
        await solution.moveToSolutionFolder(project('lib', 'CoreLibrary', 'CoreLibrary.csproj'), undefined);

        expect(outline()).toEqual(['CoreLibrary', 'Libraries', '  Shared', '    Utils', 'StandaloneProject', 'Tools', ...webProjects]);
        if (isSln) {
            expect(diff(before, text())).toEqual({
                removed: ['\t\t{55555555-5555-5555-5555-555555555555} = {22222222-2222-2222-2222-222222222222}'],
                added: [],
            });
        } else {
            expect(slnxText()).toContain('  <Folder Name="/Libraries/" />\n');
            expect(slnxText()).toContain('  <Project Path="standalone/StandaloneProject.csproj" />\n  <Project Path="lib/CoreLibrary/CoreLibrary.csproj" />\n</Solution>');
        }
    });

    test('moves a solution folder with what is in it', async () => {
        await solution.moveToSolutionFolder({ kind: 'solutionFolder', folderGuid: folder('Libraries', 'Shared') }, folder('Tools'));

        expect(outline()).toEqual(['Libraries', '  CoreLibrary', 'StandaloneProject', 'Tools', '  Shared', '    Utils', ...webProjects]);
        if (!isSln) expect(slnxText()).toContain('<Folder Name="/Tools/Shared/">');
    });

    test('moves a solution folder to the root', async () => {
        await solution.moveToSolutionFolder({ kind: 'solutionFolder', folderGuid: folder('Libraries', 'Shared') }, undefined);

        expect(outline()).toEqual(['Libraries', '  CoreLibrary', 'Shared', '  Utils', 'StandaloneProject', 'Tools', ...webProjects]);
        if (!isSln) expect(slnxText()).toContain('<Folder Name="/Shared/">');
    });

    test('moves a solution item to another solution folder', async () => {
        await solution.moveToSolutionFolder(
            { kind: 'solutionItem', filePath: path.join(dir, 'README.md'), folderGuid: folder('Web Projects') }, folder('Tools'));

        expect(outline()).toEqual(['Libraries', '  CoreLibrary', '  Shared', '    Utils', 'StandaloneProject', 'Tools', '  - README.md',
            'Web Projects', '  Shared', '  WebApi', '  WebApp']);
        if (isSln) {
            const lines = text().split(/\r?\n/);
            const block = (name: string) => {
                const start = lines.findIndex(line => line.includes(`= "${name}", "${name}"`));
                return lines.slice(start + 1, lines.indexOf('EndProject', start));
            };
            expect(block('Web Projects')).toEqual([]);
            expect(block('Tools')).toEqual(['\tProjectSection(SolutionItems) = preProject', '\t\tREADME.md = README.md', '\tEndProjectSection']);
        } else {
            expect(slnxText()).toContain('  <Folder Name="/Tools/">\n    <File Path="README.md" />\n  </Folder>\n');
        }
    });

    test('refuses a name the target already has, and leaves the file alone', async () => {
        const before = text();
        await expect(solution.moveToSolutionFolder({ kind: 'solutionFolder', folderGuid: folder('Libraries', 'Shared') }, folder('Web Projects')))
            .rejects.toThrow('already contains "Shared"');
        expect(text()).toBe(before);

        // The same file in two solution folders: moving one copy onto the other is refused
        await solution.addSolutionItem(folder('Tools'), path.join(dir, 'README.md'));
        const withItem = text();
        await expect(solution.moveToSolutionFolder(
            { kind: 'solutionItem', filePath: path.join(dir, 'README.md'), folderGuid: folder('Web Projects') }, folder('Tools')))
            .rejects.toThrow('already contains README.md');
        expect(text()).toBe(withItem);
    });

    test('refuses a solution folder into itself or a folder inside it', async () => {
        const before = text();
        await expect(solution.moveToSolutionFolder({ kind: 'solutionFolder', folderGuid: folder('Libraries') }, folder('Libraries', 'Shared')))
            .rejects.toThrow('cannot be moved into itself');
        await expect(solution.moveToSolutionFolder({ kind: 'solutionFolder', folderGuid: folder('Libraries') }, folder('Libraries')))
            .rejects.toThrow('cannot be moved into itself');
        expect(text()).toBe(before);
    });

    test('solution items stay in solution folders', async () => {
        await expect(solution.moveToSolutionFolder(
            { kind: 'solutionItem', filePath: path.join(dir, 'README.md'), folderGuid: folder('Web Projects') }, undefined))
            .rejects.toThrow('Solution items belong in a solution folder');
    });

    test('a node dropped where it already is changes nothing', async () => {
        const before = text();
        await solution.moveToSolutionFolder(project('src', 'WebApp', 'WebApp.csproj'), folder('Web Projects'));
        await solution.moveToSolutionFolder(project('standalone', 'StandaloneProject.csproj'), undefined);
        await solution.moveToSolutionFolder(
            { kind: 'solutionItem', filePath: path.join(dir, 'README.md'), folderGuid: folder('Web Projects') }, folder('Web Projects'));
        expect(text()).toBe(before);
    });
});

test('.slnx: a moved solution folder without an Id gets the GUID of its new path; what is in it goes along', async () => {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-move-')));
    fs.cpSync(fixture, dir, { recursive: true });
    const solution = await openSolution(path.join(dir, 'TestHierarchy.slnx'));
    try {
        const model = () => solution.solutionFile!;
        const guidOf = (folderPath: string) => model().projects
            .find(p => solution.isSolutionFolder(p) && solution.getSolutionFolderPath(p.guid) === folderPath)?.guid;
        const utils = () => model().projects.find(p => p.name === 'Utils')!.guid;
        const before = { shared: guidOf('Libraries/Shared')!, utils: utils() };

        await solution.moveToSolutionFolder({ kind: 'solutionFolder', folderGuid: before.shared }, guidOf('Tools'));

        const shared = guidOf('Tools/Shared')!;
        expect(shared).toBeDefined();
        expect(shared).not.toBe(before.shared);
        expect(utils()).toBe(before.utils);
        expect(model().nestedProjects).toContainEqual({ childGuid: before.utils, parentGuid: shared });
    } finally {
        solution.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('.sln: a NestedProjects section left empty goes, as Visual Studio writes none', async () => {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-move-')));
    const projectPath = path.join(dir, 'src', 'Lib', 'Lib.csproj');
    fs.mkdirSync(path.dirname(projectPath), { recursive: true });
    fs.writeFileSync(projectPath, '<Project Sdk="Microsoft.NET.Sdk" />');
    const file = path.join(dir, 'App.sln');
    fs.writeFileSync(file, [
        'Microsoft Visual Studio Solution File, Format Version 12.00',
        'Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Libs", "Libs", "{6C4D298B-81FB-2B6B-5AB6-46205EDDC72C}"',
        'EndProject',
        'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Lib", "src\\Lib\\Lib.csproj", "{142F4FE7-2814-4E67-A7EF-97A50F8A2890}"',
        'EndProject',
        'Global',
        '\tGlobalSection(SolutionProperties) = preSolution',
        '\t\tHideSolutionNode = FALSE',
        '\tEndGlobalSection',
        '\tGlobalSection(NestedProjects) = preSolution',
        '\t\t{142F4FE7-2814-4E67-A7EF-97A50F8A2890} = {6C4D298B-81FB-2B6B-5AB6-46205EDDC72C}',
        '\tEndGlobalSection',
        'EndGlobal',
        '',
    ].join('\n'));
    const solution = await openSolution(file);
    try {
        await solution.moveToSolutionFolder({ kind: 'project', projectPath }, undefined);

        expect(fs.readFileSync(file, 'utf8')).toBe([
            'Microsoft Visual Studio Solution File, Format Version 12.00',
            'Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Libs", "Libs", "{6C4D298B-81FB-2B6B-5AB6-46205EDDC72C}"',
            'EndProject',
            'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Lib", "src\\Lib\\Lib.csproj", "{142F4FE7-2814-4E67-A7EF-97A50F8A2890}"',
            'EndProject',
            'Global',
            '\tGlobalSection(SolutionProperties) = preSolution',
            '\t\tHideSolutionNode = FALSE',
            '\tEndGlobalSection',
            'EndGlobal',
            '',
        ].join('\n'));
    } finally {
        solution.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
