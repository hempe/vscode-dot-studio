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

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Project } from '../../../core/Project';
import { ProjectItemsService } from '../../../services/projectItems/projectItemsService';
import { ShowAllFiles } from '../../../services/showAllFiles';

/** Files created on disk while their folder was not shown (no watcher) show once the folder is read, with real MSBuild */
const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip;
const TIMEOUT = 150000;

describe('files created while their folder was collapsed, with real MSBuild', () => {
    let root: string;
    let dir: string;
    let project: Project | undefined;
    const at = (...parts: string[]) => path.join(dir, ...parts);

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'project-new-files-')));
        dir = path.join(root, 'App');
        fs.mkdirSync(path.join(dir, 'Sub'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'Legacy'));
        jest.spyOn(ShowAllFiles, 'isOn').mockReturnValue(false);
    });
    afterEach(() => {
        project?.dispose();
        jest.restoreAllMocks();
        fs.rmSync(root, { recursive: true, force: true });
    });

    const until = async (what: string, condition: () => Promise<boolean>) => {
        const deadline = Date.now() + 120000;
        while (!(await condition())) {
            if (Date.now() > deadline) {
                throw new Error(`Timed out waiting for ${what}`);
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    };
    const names = async (children: Promise<{ name: string }[]>) => (await children).map(child => child.name);

    withDotnet('a new file at the project root and in a subfolder shows after the evaluation its folder caused', async () => {
        const projectPath = at('App.csproj');
        fs.writeFileSync(projectPath, `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <Compile Remove="Legacy/**" />
  </ItemGroup>
</Project>
`);
        fs.writeFileSync(at('Program.cs'), '');
        fs.writeFileSync(at('Sub', 'A.cs'), '');
        fs.writeFileSync(at('Legacy', 'Old.cs'), '');
        const service = ProjectItemsService.instance;
        project = new Project(projectPath, { name: 'App', path: 'App.csproj', guid: 'g', typeGuid: 't' } as never);
        // Initializing evaluates the project in the background, collapsed: nothing of its tree is loaded
        await until('the first evaluation', async () => service.evaluatedAt(projectPath) !== undefined);
        const loaded = project;

        fs.writeFileSync(at('Coupon.cs'), '');
        fs.writeFileSync(at('Sub', 'B.cs'), '');
        expect(await names(loaded.getRootChildren())).not.toContain('Coupon.cs');
        await until('Coupon.cs to show at the root', async () => (await names(loaded.getRootChildren())).includes('Coupon.cs'));
        expect(service.get(projectPath)?.isIncluded(at('Coupon.cs'))).toBe(true);
        expect(await names(loaded.getRootChildren())).not.toContain('Legacy');

        // The evaluation for the root already saw Sub/B.cs; a file written after it is caught when Sub is read
        const evaluated = service.evaluatedAt(projectPath)!;
        await until('a clock tick after the evaluation', async () => Date.now() > evaluated + 10);
        fs.writeFileSync(at('Sub', 'C.cs'), '');
        expect(await names(loaded.getFolderChildren(at('Sub')))).toEqual(expect.arrayContaining(['A.cs', 'B.cs']));
        await until('Sub/C.cs to show', async () => (await names(loaded.getFolderChildren(at('Sub')))).includes('C.cs'));
        expect(service.evaluatedAt(projectPath)).toBeGreaterThan(evaluated);
    }, TIMEOUT);
});
