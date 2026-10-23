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

    test('a folder loaded and then collapsed shows the new listing when expanded again after the items changed', async () => {
        const sub = path.join(dir, 'Sub');
        fs.mkdirSync(sub);
        fs.writeFileSync(path.join(sub, 'A.cs'), '');
        fs.writeFileSync(path.join(sub, 'B.cs'), '');
        jest.spyOn(ProjectItemsService.instance, 'get').mockReturnValue(parseMsbuildItems(JSON.stringify({
            Items: { Compile: [{ Identity: 'Sub/A.cs', FullPath: path.join(sub, 'A.cs') }] },
        }), dir));
        const project = await newProject();
        await project.expandFolder(dir);
        expect((await project.expandFolder(sub)).map(node => node.name)).toEqual(['A.cs']);
        project.collapseFolder(sub);
        (ShowAllFiles.isOn as jest.Mock).mockReturnValue(true);
        await project.refresh();
        expect((await project.expandFolder(sub)).map(node => node.name)).toEqual(expect.arrayContaining(['A.cs', 'B.cs']));
        project.collapseFolder(sub);
        (ShowAllFiles.isOn as jest.Mock).mockReturnValue(false);
        await project.refresh();
        expect((await project.expandFolder(sub)).map(node => node.name)).toEqual(['A.cs']);
    });

    test('reloadFileTree reads the folders again and redraws once, without parsing the project file', async () => {
        const project = await newProject();
        await project.getRootChildren();
        const parse = jest.spyOn(project as unknown as { parseProjectFile(): Promise<void> }, 'parseProjectFile');
        fs.writeFileSync(path.join(dir, 'New.cs'), '');
        fired(project).mockClear();
        await project.reloadFileTree();
        expect(fired(project)).toHaveBeenCalledTimes(1);
        expect(parse).not.toHaveBeenCalled();
        expect((await project.getRootChildren()).length).toBeGreaterThan(0);
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

    test('does not offer Exclude on a folder that is a project of the solution', async () => {
        const tools = path.join(dir, 'Tools');
        fs.mkdirSync(tools);
        fs.writeFileSync(path.join(tools, 'T.cs'), '');
        jest.spyOn(ProjectItemsService.instance, 'get').mockReturnValue(parseMsbuildItems(JSON.stringify({
            Items: { Compile: [{ Identity: 'Tools/T.cs', FullPath: path.join(tools, 'T.cs') }] },
        }), dir));
        const project = new Project(projectPath, { name: 'App', path: 'App.csproj', guid: 'g', typeGuid: 't' } as never, () => false,
            () => [projectPath, path.join(tools, 'Tools.csproj')]);
        while (!project.isInitialized) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        const folder = (await project.getFolderChildren(dir)).find(child => child.name === 'Tools');
        expect(folder).toBeDefined();
        expect(folder?.contextValue).toBeUndefined();
    });

    test('does not offer Exclude on a folder without files of the project (empty, or only linked files)', async () => {
        fs.mkdirSync(path.join(dir, 'Empty'));
        fs.mkdirSync(path.join(dir, 'Shared'));
        fs.mkdirSync(path.join(dir, 'Sub'));
        fs.writeFileSync(path.join(dir, 'Sub', 'A.cs'), '');
        const outside = path.join(os.tmpdir(), 'Elsewhere', 'Common.cs');
        jest.spyOn(ProjectItemsService.instance, 'get').mockReturnValue(parseMsbuildItems(JSON.stringify({
            Items: { Compile: [
                { Identity: 'Sub/A.cs', FullPath: path.join(dir, 'Sub', 'A.cs') },
                { Identity: outside, FullPath: outside, Link: 'Shared/Common.cs' },
            ] },
        }), dir));
        const children = await (await newProject()).getFolderChildren(dir);
        expect(children.find(child => child.name === 'Empty')?.contextValue).toBeUndefined();
        expect(children.find(child => child.name === 'Shared')?.contextValue).toBeUndefined();
        expect(children.find(child => child.name === 'Sub')?.contextValue).toBe('included');
    });

    const fired = (project: Project) => (project as unknown as { _changeEmitter: { fire: jest.Mock } })._changeEmitter.fire;

    test('redraws when the evaluation changed the item list', async () => {
        const project = await newProject();
        await project.getRootChildren();
        jest.spyOn(ProjectItemsService.instance, 'version').mockReturnValueOnce(1).mockReturnValueOnce(2);
        fired(project).mockClear();
        await project.evaluateItems();
        expect(fired(project)).toHaveBeenCalledTimes(1);
    });

    test('does not redraw when the evaluation left the item list as it was (same list, or a failure keeping the last one)', async () => {
        const items = withItems();
        const project = await newProject();
        await project.getRootChildren();
        (ProjectItemsService.instance.evaluate as jest.Mock).mockResolvedValue(items.getMockImplementation()!(projectPath));
        jest.spyOn(ProjectItemsService.instance, 'version').mockReturnValue(7);
        const load = jest.spyOn(project, 'loadFolderChildren');
        fired(project).mockClear();
        await project.evaluateItems();
        expect(fired(project)).not.toHaveBeenCalled();
        expect(load).not.toHaveBeenCalled();
    });

    type Created = { handleFileCreated(uri: { fsPath: string }): Promise<void> };
    const create = async (project: Project, name: string) => {
        fs.writeFileSync(path.join(dir, name), '');
        await (project as unknown as Created).handleFileCreated({ fsPath: path.join(dir, name) });
    };

    test('a burst of new files the item list does not know causes one evaluation', async () => {
        withItems();
        const project = await newProject();
        const evaluate = ProjectItemsService.instance.evaluate as jest.Mock;
        evaluate.mockClear();
        jest.useFakeTimers();
        try {
            for (let i = 0; i < 20; i++) {
                await create(project, `New${i}.cs`);
            }
            expect(evaluate).not.toHaveBeenCalled();
            await jest.advanceTimersByTimeAsync(1000);
            expect(evaluate).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });

    test('bursts of new files and a project file edit while MSBuild runs start one more MSBuild, not one per burst', async () => {
        const project = await newProject();
        (ProjectItemsService.instance.evaluate as jest.Mock).mockRestore();
        const finishers: (() => void)[] = [];
        const run = jest.spyOn(ProjectItemsService.instance as unknown as { run(projectPath: string): Promise<string> }, 'run')
            .mockImplementation(() => new Promise<string>(resolve => finishers.push(() => resolve(JSON.stringify({
                Items: { Compile: [{ Identity: 'Program.cs', FullPath: path.join(dir, 'Program.cs') }] },
            })))));
        jest.useFakeTimers();
        try {
            for (let i = 0; i < 5; i++) {
                await create(project, `First${i}.cs`);
            }
            await jest.advanceTimersByTimeAsync(1000);
            expect(run).toHaveBeenCalledTimes(1);
            for (let burst = 0; burst < 3; burst++) {
                for (let i = 0; i < 5; i++) {
                    await create(project, `Later${burst}-${i}.cs`);
                }
                await jest.advanceTimersByTimeAsync(1000);
            }
            // An edit of the project file (Include, Exclude) evaluates again; resolves when the evaluation it asked for ends
            const edited = project.reevaluateItems();
            await jest.advanceTimersByTimeAsync(0);
            expect(run).toHaveBeenCalledTimes(1);
            finishers.shift()!();
            await jest.advanceTimersByTimeAsync(0);
            expect(run).toHaveBeenCalledTimes(2);
            finishers.shift()!();
            await edited;
            await jest.advanceTimersByTimeAsync(1000);
            expect(run).toHaveBeenCalledTimes(2);
            expect(ProjectItemsService.instance.get(projectPath)?.isIncluded(path.join(dir, 'Program.cs'))).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });

    test('the watcher event of a project file edit already evaluated (Include, Exclude) does not evaluate again', async () => {
        const project = await newProject();
        const invalidate = jest.spyOn(ProjectItemsService.instance, 'invalidate');
        const changed = (project as unknown as { handleFileChanged(uri: { fsPath: string }): Promise<void> });
        fs.writeFileSync(projectPath, '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><Compile Remove="Old.cs" /></ItemGroup></Project>');
        await project.reevaluateItems();
        await changed.handleFileChanged({ fsPath: projectPath });
        expect(invalidate).toHaveBeenCalledTimes(1);
        fs.writeFileSync(projectPath, '<Project Sdk="Microsoft.NET.Sdk"></Project>');
        await changed.handleFileChanged({ fsPath: projectPath });
        expect(invalidate).toHaveBeenCalledTimes(2);
    });

    test('a new file the item list already includes does not evaluate again', async () => {
        withItems();
        const project = await newProject();
        const evaluate = ProjectItemsService.instance.evaluate as jest.Mock;
        const invalidate = jest.spyOn(ProjectItemsService.instance, 'invalidate');
        evaluate.mockClear();
        jest.useFakeTimers();
        try {
            await create(project, 'Program.cs');
            await jest.advanceTimersByTimeAsync(1000);
            expect(evaluate).not.toHaveBeenCalled();
            expect(invalidate).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    test('dispose cancels a pending evaluation', async () => {
        withItems();
        const project = await newProject();
        const evaluate = ProjectItemsService.instance.evaluate as jest.Mock;
        evaluate.mockClear();
        jest.useFakeTimers();
        try {
            await create(project, 'New.cs');
            project.dispose();
            await jest.advanceTimersByTimeAsync(1000);
            expect(evaluate).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    test('does not redraw a project whose tree was never loaded (collapsed)', async () => {
        const project = await newProject();
        jest.spyOn(ProjectItemsService.instance, 'version').mockReturnValueOnce(1).mockReturnValueOnce(2);
        const load = jest.spyOn(project, 'loadFolderChildren');
        fired(project).mockClear();
        await project.evaluateItems();
        expect(fired(project)).not.toHaveBeenCalled();
        expect(load).not.toHaveBeenCalled();
    });

    const evaluatedAt = (at: number) => jest.spyOn(ProjectItemsService.instance, 'evaluatedAt').mockReturnValue(at);
    const scheduled = (project: Project) => jest.spyOn(project as unknown as { scheduleReevaluation(): void }, 'scheduleReevaluation');
    const afterDebounce = () => new Promise(resolve => setTimeout(resolve, 500));

    test('a folder read from disk with a file the item list lacks, newer than the evaluation, evaluates again (collapsed project opened)', async () => {
        withItems();
        evaluatedAt(Date.now() - 60000);
        const project = await newProject();
        const invalidate = jest.spyOn(ProjectItemsService.instance, 'invalidate');
        const evaluate = ProjectItemsService.instance.evaluate as jest.Mock;
        evaluate.mockClear();
        fs.writeFileSync(path.join(dir, 'Coupon.cs'), '');
        const names = (await project.getRootChildren()).map(child => child.name);
        // the cached list meanwhile: no flicker
        expect(names).not.toContain('Coupon.cs');
        await afterDebounce();
        expect(invalidate).toHaveBeenCalledWith(projectPath);
        expect(evaluate).toHaveBeenCalledTimes(1);
    });

    test('a subfolder read from disk with a new folder of new files evaluates again', async () => {
        const sub = path.join(dir, 'Sub');
        fs.mkdirSync(path.join(sub, 'Coupons'), { recursive: true });
        fs.writeFileSync(path.join(sub, 'A.cs'), '');
        fs.writeFileSync(path.join(sub, 'Coupons', 'Coupon.cs'), '');
        jest.spyOn(ProjectItemsService.instance, 'get').mockReturnValue(parseMsbuildItems(JSON.stringify({
            Items: { Compile: [{ Identity: 'Program.cs', FullPath: path.join(dir, 'Program.cs') }, { Identity: 'Sub/A.cs', FullPath: path.join(sub, 'A.cs') }] },
        }), dir));
        const project = await newProject();
        // Old.cs at the root is old: only the new folder counts
        evaluatedAt(Date.now() + 60000);
        await project.getRootChildren();
        fs.utimesSync(path.join(sub, 'Coupons'), (Date.now() + 120000) / 1000, (Date.now() + 120000) / 1000);
        const schedule = scheduled(project).mockImplementation(() => undefined);
        await project.getFolderChildren(sub);
        expect(schedule).toHaveBeenCalledTimes(1);
    });

    test('a genuinely excluded file older than the evaluation evaluates nothing and redraws nothing', async () => {
        withItems();
        // evaluated a minute after Old.cs was written
        evaluatedAt(Date.now() + 60000);
        const project = await newProject();
        const invalidate = jest.spyOn(ProjectItemsService.instance, 'invalidate');
        const evaluate = ProjectItemsService.instance.evaluate as jest.Mock;
        evaluate.mockClear();
        fired(project).mockClear();
        await project.getRootChildren();
        await afterDebounce();
        expect(invalidate).not.toHaveBeenCalled();
        expect(evaluate).not.toHaveBeenCalled();
        expect(fired(project)).not.toHaveBeenCalled();
    });

    test('the same unlisted new file evaluates once: reading its folder again does not evaluate again', async () => {
        withItems();
        evaluatedAt(Date.now() - 60000);
        const project = await newProject();
        const schedule = scheduled(project).mockImplementation(() => undefined);
        await project.loadFolderChildren(dir);
        await project.loadFolderChildren(dir);
        expect(schedule).toHaveBeenCalledTimes(1);
        fs.writeFileSync(path.join(dir, 'Another.cs'), '');
        await project.loadFolderChildren(dir);
        expect(schedule).toHaveBeenCalledTimes(2);
    });

    test('a file created while the project was collapsed shows once the evaluation it caused lands', async () => {
        const project = await newProject();
        (ProjectItemsService.instance.evaluate as jest.Mock).mockRestore();
        const listing = (...files: string[]) => JSON.stringify({ Items: { Compile: files.map(file => ({ Identity: file, FullPath: path.join(dir, file) })) } });
        const run = jest.spyOn(ProjectItemsService.instance as unknown as { run(projectPath: string): Promise<string> }, 'run')
            .mockResolvedValueOnce(listing('Program.cs'))
            .mockResolvedValueOnce(listing('Program.cs', 'Coupon.cs'));
        await project.evaluateItems();
        expect(run).toHaveBeenCalledTimes(1);
        // written after the evaluation started, with the project collapsed (no folder watcher)
        fs.writeFileSync(path.join(dir, 'Coupon.cs'), '');
        expect((await project.getRootChildren()).map(child => child.name)).not.toContain('Coupon.cs');
        fired(project).mockClear();
        await afterDebounce();
        expect(run).toHaveBeenCalledTimes(2);
        expect(fired(project)).toHaveBeenCalled();
        expect((await project.getRootChildren()).map(child => child.name)).toContain('Coupon.cs');
        // Reading the root again after the new list (Old.cs is still unlisted and within the margin) evaluates no more
        await afterDebounce();
        expect(run).toHaveBeenCalledTimes(2);
    });

    test('an empty disk folder that holds linked files can be expanded', async () => {
        fs.mkdirSync(path.join(dir, 'Shared'));
        const outside = path.join(os.tmpdir(), 'Elsewhere', 'Common.cs');
        jest.spyOn(ProjectItemsService.instance, 'get').mockReturnValue(parseMsbuildItems(JSON.stringify({
            Items: { Compile: [
                { Identity: 'Program.cs', FullPath: path.join(dir, 'Program.cs') },
                { Identity: outside, FullPath: outside, Link: 'Shared/Common.cs' },
            ] },
        }), dir));
        const project = await newProject();
        const shared = (await project.loadFolderChildren(dir)).find(node => node.name === 'Shared');
        expect(shared?.hasChildren).toBe(true);
    });

    test('a failed evaluation is tried again by itself after its delay, and a redraw follows when that gives a list', async () => {
        const evaluate = ProjectItemsService.instance.evaluate as jest.Mock;
        jest.spyOn(ProjectItemsService.instance, 'retryDelay').mockReturnValueOnce(20).mockReturnValue(undefined);
        const project = await newProject();
        await project.getRootChildren();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(evaluate).toHaveBeenCalledTimes(1);
        let version = 0;
        jest.spyOn(ProjectItemsService.instance, 'version').mockImplementation(() => version);
        evaluate.mockImplementation(async () => { version = 1; return undefined; });
        fired(project).mockClear();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(evaluate).toHaveBeenCalledTimes(2);
        expect(fired(project)).toHaveBeenCalled();
        // no failure any more: no further retry
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(evaluate).toHaveBeenCalledTimes(2);
    });

    test('expanding a folder after a failed evaluation whose delay has passed evaluates again', async () => {
        const project = await newProject();
        const evaluate = ProjectItemsService.instance.evaluate as jest.Mock;
        evaluate.mockClear();
        await project.loadFolderChildren(dir);
        expect(evaluate).not.toHaveBeenCalled();
        jest.spyOn(ProjectItemsService.instance, 'retryDue').mockReturnValue(true);
        await project.loadFolderChildren(dir);
        expect(evaluate).toHaveBeenCalledTimes(1);
    });

    test('dispose cancels a pending retry', async () => {
        jest.spyOn(ProjectItemsService.instance, 'retryDelay').mockReturnValueOnce(20).mockReturnValue(undefined);
        const project = await newProject();
        await new Promise(resolve => setTimeout(resolve, 0));
        const evaluate = ProjectItemsService.instance.evaluate as jest.Mock;
        evaluate.mockClear();
        project.dispose();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(evaluate).not.toHaveBeenCalled();
    });

    test('after a new item list the expanded folders are read again parents first, also when a subfolder was expanded first', async () => {
        const sub = path.join(dir, 'Sub');
        const inner = path.join(sub, 'Inner');
        fs.mkdirSync(inner, { recursive: true });
        fs.writeFileSync(path.join(inner, 'A.cs'), '');
        const project = await newProject();
        // Restoring the expansion asks for the subfolder before its parent is loaded (it is not found yet)
        await project.getFolderChildren(inner);
        await project.getRootChildren();
        await project.getFolderChildren(sub);
        await project.getFolderChildren(inner);
        expect([...project.getCollapsedState().keys()].map(key => path.relative(dir, key))).toEqual([path.join('Sub', 'Inner'), '', 'Sub']);
        let version = 0;
        jest.spyOn(ProjectItemsService.instance, 'version').mockImplementation(() => version);
        (ProjectItemsService.instance.evaluate as jest.Mock).mockImplementation(async () => { version = 1; return undefined; });
        const load = jest.spyOn(project, 'loadFolderChildren');
        await project.evaluateItems();
        expect(load.mock.calls.map(([folder]) => path.relative(dir, folder))).toEqual(['', 'Sub', path.join('Sub', 'Inner')]);
        // The subfolder's new listing is in the tree, not thrown away by reading its parent afterwards
        load.mockClear();
        expect((await project.getFolderChildren(inner)).map(child => child.name)).toEqual(['A.cs']);
        expect(load).not.toHaveBeenCalled();
    });
});
