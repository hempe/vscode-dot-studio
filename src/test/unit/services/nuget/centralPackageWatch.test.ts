import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const watcher = () => ({ onDidChange: jest.fn(), onDidCreate: jest.fn(), onDidDelete: jest.fn(), dispose: jest.fn() });
const env = { roots: [] as string[], projects: [] as { projectPath: string }[], open: true, solutionChanged: [] as (() => void)[] };
jest.mock('vscode', () => ({
    workspace: {
        createFileSystemWatcher: jest.fn(() => watcher()),
        get workspaceFolders() { return env.roots.map(fsPath => ({ uri: { fsPath } })); },
    },
    RelativePattern: class { constructor(public base: string, public pattern: string) { } },
}), { virtual: true });
jest.mock('../../../../services/solutionService', () => ({
    SolutionService: {
        getActiveSolution: () => env.open ? { projects: new Map(env.projects.map(project => [project.projectPath, project])) } : undefined,
        onDidChangeActiveSolution: (listener: () => void) => { env.solutionChanged.push(listener); return { dispose: jest.fn() }; },
    },
}));

import * as vscode from 'vscode';
import { changedFiles, Stamp, watchPlan } from '../../../../services/nuget/centralPackageWatch';
import { CentralPackageWatchers } from '../../../../services/nuget/centralPackageWatchers';
import { ProjectItemsService } from '../../../../services/projectItems/projectItemsService';
import { parseMsbuildPackages } from '../../../../services/nuget/centralPackages';

describe('watchPlan', () => {
    const root = path.resolve('/work/repo');
    test('imported props files inside the workspace get a watcher; Directory.Packages.props has one already; outside ones are re-checked', () => {
        const files = [
            path.join(root, 'Directory.Packages.props'),
            path.join(root, 'build', 'Versions.props'),
            path.join(root, 'build', 'Versions.props'),
            path.resolve('/shared/Company.Packages.props'),
        ];
        expect(watchPlan(files, [root])).toEqual({
            watch: [path.join(root, 'build', 'Versions.props')],
            outside: [path.resolve('/shared/Company.Packages.props')],
        });
    });
});

describe('changedFiles', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-watch-')); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    test('a file seen the first time is no change; an edit and a deletion are', () => {
        const file = path.join(dir, 'Company.Packages.props');
        fs.writeFileSync(file, '<Project />');
        const stamps = new Map<string, Stamp>();
        expect(changedFiles([file], stamps)).toEqual([]);
        expect(changedFiles([file], stamps)).toEqual([]);
        fs.writeFileSync(file, '<Project>\n</Project>\n');
        expect(changedFiles([file], stamps)).toEqual([file]);
        fs.rmSync(file);
        expect(changedFiles([file], stamps)).toEqual([file]);
    });
});

describe('CentralPackageWatchers', () => {
    let dir: string;
    let outside: string;
    let listener: () => void;
    let packages: Map<string, ReturnType<typeof parseMsbuildPackages>>;

    beforeEach(() => {
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-watchers-')));
        outside = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-outside-')));
        env.roots = [dir];
        env.projects = [{ projectPath: path.join(dir, 'App', 'App.csproj') }];
        env.open = true;
        env.solutionChanged = [];
        packages = new Map();
        jest.spyOn(ProjectItemsService.instance, 'onDidEvaluate').mockImplementation(callback => { listener = () => callback(''); return { dispose: jest.fn() }; });
        jest.spyOn(ProjectItemsService.instance, 'packages').mockImplementation(projectPath => packages.get(projectPath));
        (vscode.workspace.createFileSystemWatcher as jest.Mock).mockClear();
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
        jest.restoreAllMocks();
    });

    const evaluated = (...files: string[]) => {
        packages.set(env.projects[0].projectPath, parseMsbuildPackages(JSON.stringify({
            Properties: { ManagePackageVersionsCentrally: 'true', DirectoryPackagesPropsPath: path.join(dir, 'Directory.Packages.props') },
            Items: { PackageVersion: files.map((file, index) => ({ Identity: `P${index}`, Version: '1.0.0', DefiningProjectFullPath: file })) },
        }), env.projects[0].projectPath));
        listener();
    };

    test('an imported props file gets a watcher, which goes when no project uses the file any more', () => {
        const watchers = new CentralPackageWatchers(jest.fn());
        evaluated(path.join(dir, 'Directory.Packages.props'), path.join(dir, 'build', 'Versions.props'));
        const created = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results;
        expect(created).toHaveLength(1);
        expect((vscode.workspace.createFileSystemWatcher as jest.Mock).mock.calls[0][0]).toEqual({ base: path.join(dir, 'build'), pattern: 'Versions.props' });
        evaluated(path.join(dir, 'Directory.Packages.props'));
        expect(created[0].value.dispose).toHaveBeenCalled();
        watchers.dispose();
    });

    test('a props file outside the workspace: recheck evaluates again only after it changed', async () => {
        const file = path.join(outside, 'Company.Packages.props');
        fs.writeFileSync(file, '<Project />');
        const reevaluate = jest.fn().mockResolvedValue(undefined);
        const watchers = new CentralPackageWatchers(reevaluate);
        evaluated(file);
        await watchers.recheck();
        expect(reevaluate).not.toHaveBeenCalled();
        fs.writeFileSync(file, '<Project>\n  <ItemGroup />\n</Project>\n');
        await watchers.recheck();
        expect(reevaluate).toHaveBeenCalledTimes(1);
        watchers.dispose();
    });

    const createdWatchers = () => (vscode.workspace.createFileSystemWatcher as jest.Mock).mock;

    test('a change seen by a watcher evaluates the projects again', () => {
        const reevaluate = jest.fn().mockResolvedValue(undefined);
        const watchers = new CentralPackageWatchers(reevaluate);
        evaluated(path.join(dir, 'build', 'Versions.props'));
        const created = createdWatchers().results[0].value;
        for (const event of [created.onDidChange, created.onDidCreate, created.onDidDelete]) {
            event.mock.calls[0][0]();
        }
        expect(reevaluate).toHaveBeenCalledTimes(3);
        watchers.dispose();
    });

    test('a file Directory.Packages.props imports that defines only properties is watched too; outside the workspace it is re-checked', async () => {
        fs.writeFileSync(path.join(dir, 'Directory.Packages.props'),
            `<Project>\n  <Import Project="build/Versions.props" />\n  <Import Project="${path.join(outside, 'Company.props')}" />\n</Project>\n`);
        fs.mkdirSync(path.join(dir, 'build'));
        fs.writeFileSync(path.join(dir, 'build', 'Versions.props'), '<Project><PropertyGroup><SerilogVersion>3.1.1</SerilogVersion></PropertyGroup></Project>');
        const company = path.join(outside, 'Company.props');
        fs.writeFileSync(company, '<Project />');
        const reevaluate = jest.fn().mockResolvedValue(undefined);
        const watchers = new CentralPackageWatchers(reevaluate);
        evaluated(path.join(dir, 'Directory.Packages.props'));
        expect(createdWatchers().calls.map(call => call[0])).toEqual([{ base: path.join(dir, 'build'), pattern: 'Versions.props' }]);
        await watchers.recheck();
        expect(reevaluate).not.toHaveBeenCalled();
        fs.writeFileSync(company, '<Project>\n  <PropertyGroup />\n</Project>\n');
        await watchers.recheck();
        expect(reevaluate).toHaveBeenCalledTimes(1);
        watchers.dispose();
    });

    test('closing the solution drops the watchers', () => {
        const watchers = new CentralPackageWatchers(jest.fn());
        evaluated(path.join(dir, 'build', 'Versions.props'));
        const created = createdWatchers().results[0].value;
        env.open = false;
        env.solutionChanged.forEach(listener => listener());
        expect(created.dispose).toHaveBeenCalled();
        watchers.dispose();
    });
});
