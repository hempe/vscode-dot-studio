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
import { ProjectItemsService } from '../../../services/project/items/projectItemsService';

// What the menus, the startup choices and Hot Reload offer depends on these: libraries and test projects cannot be started
describe('Project kind', () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'project-kind-')));
        jest.spyOn(ProjectItemsService.instance, 'evaluate').mockResolvedValue(undefined);
    });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); jest.restoreAllMocks(); });

    const project = async (name: string, xml: string) => {
        const projectPath = path.join(dir, `${name}.csproj`);
        fs.writeFileSync(projectPath, xml);
        const created = new Project(projectPath, { name, path: `${name}.csproj`, guid: 'g', typeGuid: 't' } as never);
        while (!created.isInitialized) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        return created;
    };
    const kind = (p: Project) => ({ executable: p.isExecutable, library: p.isLibrary, test: p.isTestProject });

    test('an xUnit v3 test project is an Exe but cannot be started (no Microsoft.NET.Test.Sdk)', async () => {
        const tests = await project('Shop.Core.Tests', '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n    <OutputType>Exe</OutputType>\n  </PropertyGroup>\n'
            + '  <ItemGroup>\n    <PackageReference Include="xunit.v3" Version="3.2.2" />\n  </ItemGroup>\n</Project>\n');
        expect(kind(tests)).toEqual({ executable: false, library: false, test: true });
    });

    test('a console app can be started, a class library cannot', async () => {
        const app = await project('App', '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <OutputType>Exe</OutputType>\n  </PropertyGroup>\n</Project>\n');
        const lib = await project('Lib', '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n  </PropertyGroup>\n</Project>\n');
        expect(kind(app)).toEqual({ executable: true, library: false, test: false });
        expect(kind(lib)).toEqual({ executable: false, library: true, test: false });
    });
});
