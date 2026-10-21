jest.mock('vscode', () => {
    const watcher = () => ({ onDidCreate: jest.fn(), onDidChange: jest.fn(), onDidDelete: jest.fn(), dispose: jest.fn() });
    return {
        workspace: { createFileSystemWatcher: jest.fn(watcher), workspaceFolders: [], getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
        EventEmitter: class { event = jest.fn(); fire = jest.fn(); dispose = jest.fn(); },
        RelativePattern: class { constructor(public base: string, public pattern: string) { } },
        Uri: { file: (fsPath: string) => ({ fsPath }) },
        commands: { executeCommand: jest.fn() },
    };
}, { virtual: true });

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Project } from '../../../core/Project';
import { parseMsbuildItems } from '../../../services/projectItems/projectItems';
import { ProjectItemsService } from '../../../services/projectItems/projectItemsService';
import { ShowAllFiles } from '../../../services/showAllFiles';

describe('Project file tree with the item overlay', () => {
    let dir: string;
    let projectPath: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'items-'));
        projectPath = path.join(dir, 'App.csproj');
        fs.writeFileSync(projectPath, '<Project Sdk="Microsoft.NET.Sdk"></Project>');
        fs.writeFileSync(path.join(dir, 'Program.cs'), '');
        fs.writeFileSync(path.join(dir, 'Old.cs'), '');
        ProjectItemsService.instance.invalidate(projectPath);
        jest.spyOn(ShowAllFiles, 'isOn').mockReturnValue(false);
        // No MSBuild in the tests: the item list is what `get` returns
        jest.spyOn(ProjectItemsService.instance, 'evaluate').mockResolvedValue(undefined);
    });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); jest.restoreAllMocks(); });

    const withItems = () => jest.spyOn(ProjectItemsService.instance, 'get').mockReturnValue(parseMsbuildItems(JSON.stringify({
        Items: { Compile: [{ Identity: 'Program.cs', FullPath: path.join(dir, 'Program.cs') }, { Identity: 'App.csproj', FullPath: projectPath }] },
    }), dir));
    const newProject = async () => {
        const project = new Project(projectPath, { name: 'App', path: 'App.csproj', guid: 'g', typeGuid: 't' } as never);
        // The constructor initializes in the background (parse, file tree)
        while (!project.isInitialized) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        return project;
    };

    test('hides files the project does not contain', async () => {
        withItems();
        const names = (await (await newProject()).loadFolderChildren(dir)).map(node => node.name);
        expect(names).toContain('Program.cs');
        expect(names).not.toContain('Old.cs');
    });

    test('shows them greyed out with Show All Files', async () => {
        withItems();
        (ShowAllFiles.isOn as jest.Mock).mockReturnValue(true);
        const nodes = await (await newProject()).loadFolderChildren(dir);
        expect(nodes.find(node => node.name === 'Old.cs')?.itemState).toBe('excluded');
        expect(nodes.find(node => node.name === 'Program.cs')?.itemState).toBe('included');
    });

    test('shows everything while the item list is not known', async () => {
        const names = (await (await newProject()).loadFolderChildren(dir)).map(node => node.name);
        expect(names).toEqual(expect.arrayContaining(['Program.cs', 'Old.cs']));
    });

    test('offers Exclude on included files and Include on excluded ones, as context values', async () => {
        withItems();
        (ShowAllFiles.isOn as jest.Mock).mockReturnValue(true);
        const project = await newProject();
        const children = await project.getFolderChildren(dir);
        expect(children.find(child => child.name === 'Program.cs')?.contextValue).toBe('included');
        expect(children.find(child => child.name === 'Old.cs')?.contextValue).toBe('excluded');
    });
});
