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
import { Project, dependencyLabel } from '../../../core/Project';
import { parseMsbuildPackages } from '../../../services/nuget/centralPackages';
import { ProjectItemsService } from '../../../services/projectItems/projectItemsService';
import { NodeIdService } from '../../../services/nodeIdService';

describe('Project dependencies with Central Package Management', () => {
    let dir: string;
    let projectPath: string;
    let props: string;

    beforeEach(() => {
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-project-')));
        projectPath = path.join(dir, 'App.csproj');
        props = path.join(dir, 'Directory.Packages.props');
        // What the parser sees: no versions
        fs.writeFileSync(projectPath, '<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup>\n    <PackageReference Include="Serilog" />\n'
            + '    <PackageReference Include="Newtonsoft.Json" VersionOverride="13.0.2" />\n    <ProjectReference Include="..\\Lib\\Lib.csproj" />\n  </ItemGroup>\n</Project>\n');
        jest.spyOn(ProjectItemsService.instance, 'evaluate').mockResolvedValue(undefined);
    });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); jest.restoreAllMocks(); });

    const evaluated = () => parseMsbuildPackages(JSON.stringify({
        Properties: { ManagePackageVersionsCentrally: 'true', DirectoryPackagesPropsPath: props },
        Items: {
            PackageReference: [
                { Identity: 'Serilog', DefiningProjectFullPath: projectPath },
                { Identity: 'Newtonsoft.Json', VersionOverride: '13.0.2', DefiningProjectFullPath: projectPath },
                { Identity: 'Microsoft.SourceLink.GitHub', Version: '', DefiningProjectFullPath: path.join(dir, 'NuGet.targets') },
            ],
            PackageVersion: [{ Identity: 'Serilog', Version: '3.1.1', DefiningProjectFullPath: props }],
            GlobalPackageReference: [{ Identity: 'Microsoft.SourceLink.GitHub', Version: '8.0.0', DefiningProjectFullPath: props }],
        },
    }), projectPath);

    const newProject = async () => {
        const project = new Project(projectPath, { name: 'App', path: 'App.csproj', guid: 'g', typeGuid: 't' } as never);
        while (!project.isInitialized) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        return project;
    };
    const packageNames = (project: Project) => project.getDependenciesByCategory(NodeIdService.parse(NodeIdService.generateDependencyCategoryId(projectPath, 'packages')))
        .map(child => child.name);

    test('before MSBuild has evaluated the project, the tree shows what the project file says', async () => {
        jest.spyOn(ProjectItemsService.instance, 'packages').mockReturnValue(undefined);
        expect(packageNames(await newProject())).toEqual(['Newtonsoft.Json', 'Serilog']);
    });

    test('then the central versions, the override and the global package', async () => {
        jest.spyOn(ProjectItemsService.instance, 'packages').mockReturnValue(evaluated());
        const project = await newProject();
        expect(packageNames(project)).toEqual(['Microsoft.SourceLink.GitHub (8.0.0, global)', 'Newtonsoft.Json (13.0.2, override)', 'Serilog (3.1.1)']);
        expect(project.dependencies.filter(dependency => dependency.type === 'ProjectReference').map(dependency => dependency.name)).toEqual(['Lib']);
        expect(project.dependencies.find(dependency => dependency.name === 'Serilog')).toEqual(
            { name: 'Serilog', version: '3.1.1', type: 'PackageReference', versionSource: 'central', versionFile: props });
    });

    test('the dependency node ids keep the plain version', async () => {
        jest.spyOn(ProjectItemsService.instance, 'packages').mockReturnValue(evaluated());
        const project = await newProject();
        const node = project.getDependenciesByCategory(NodeIdService.parse(NodeIdService.generateDependencyCategoryId(projectPath, 'packages')))
            .find(child => child.name.startsWith('Newtonsoft.Json'))!;
        expect(node.nodeId).toBe(NodeIdService.generateDependencyId(projectPath, 'packages', 'Newtonsoft.Json', '13.0.2'));
    });

    test('dependencyLabel', () => {
        expect(dependencyLabel({ name: 'A', version: '1.0.0', versionSource: 'central' })).toBe('A (1.0.0)');
        expect(dependencyLabel({ name: 'A', versionSource: 'global' })).toBe('A (global)');
        expect(dependencyLabel({ name: 'A' })).toBe('A');
    });
});
