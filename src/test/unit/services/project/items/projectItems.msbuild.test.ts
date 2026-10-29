import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectItemsService, runMsbuild } from '../../../../../services/project/items/projectItemsService';

/** What real MSBuild says a project contains: a file it does not list is hidden in the tree, so every real file must be listed */
const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip;
const TIMEOUT = 150000;

describe('project items from real MSBuild', () => {
    let root: string;
    let dir: string;
    const at = (...parts: string[]) => path.join(dir, ...parts);

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'project-items-')));
        dir = path.join(root, 'App');
        fs.mkdirSync(dir);
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    const evaluate = async (project: string, files: string[]) => {
        const projectPath = at('App.csproj');
        fs.writeFileSync(projectPath, project);
        for (const file of files) {
            fs.mkdirSync(path.dirname(at(file)), { recursive: true });
            fs.writeFileSync(at(file), '');
        }
        const items = await new ProjectItemsService().evaluate(projectPath);
        if (!items) {
            throw new Error(`MSBuild could not evaluate:\n${project}`);
        }
        return items;
    };
    const notIncluded = (items: { isIncluded(file: string): boolean }, files: string[]) => files.filter(file => !items.isIncluded(at(file)));

    withDotnet('every file of a web project with Razor, gRPC, resx and XAML files is included', async () => {
        const files = [
            'Program.cs', 'appsettings.json', 'appsettings.Development.json', 'Properties/launchSettings.json', 'libman.json',
            '.editorconfig', '.gitignore', '.dockerignore', 'Dockerfile', 'README.md', 'web.config', 'App.config', 'Properties/Settings.settings',
            'Components/App.razor', 'Components/Pages/Home.razor', 'Components/Pages/Home.razor.css', 'Components/_Imports.razor',
            'Pages/Index.cshtml', 'Pages/Index.cshtml.cs', 'Views/Home/Index.cshtml', 'Views/_ViewImports.cshtml',
            'wwwroot/css/site.css', 'wwwroot/js/site.js', 'wwwroot/lib/bootstrap/bootstrap.min.css', 'wwwroot/favicon.ico',
            'Protos/greet.proto', 'Resources/Strings.resx', 'Resources/Strings.de.resx', 'Resources/Strings.resw',
            'Views/MainWindow.xaml', 'Views/MainWindow.xaml.cs', 'App.xaml', 'Images/logo.png',
            'Scripts/app.ts', 'tsconfig.json', 'Sql/schema.sql',
        ];
        // The WPF and gRPC SDKs move these out of None; written out here so the test needs no workload or package
        const items = await evaluate(`<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <None Remove="**\\*.xaml;Protos\\*.proto;Images\\*.png" />
    <ApplicationDefinition Include="App.xaml" />
    <Page Include="Views\\*.xaml" />
    <Resource Include="Images\\*.png" />
    <Protobuf Include="Protos\\*.proto" GrpcServices="Server" />
  </ItemGroup>
</Project>
`, files);
        expect(notIncluded(items, ['App.csproj', ...files])).toEqual(['App.csproj']);
        expect(items.itemTypeOf(at('Components', 'App.razor'))).toBe('Content');
        expect(items.itemTypeOf(at('Resources', 'Strings.resx'))).toBe('EmbeddedResource');
        expect(items.itemTypeOf(at('Views', 'MainWindow.xaml'))).toBe('Page');
        expect(items.itemTypeOf(at('Protos', 'greet.proto'))).toBe('Protobuf');
    }, TIMEOUT);

    withDotnet('a file whose build action was changed in Visual Studio (None Remove + other Include) is included', async () => {
        const types = ['CodeAnalysisDictionary', 'DesignData', 'DesignDataWithDesignTimeCreatableTypes', 'EntityDeploy', 'Fakes',
            'Shadow', 'XamlAppDef', 'TypeScriptCompile', 'MauiXaml', 'MauiCss', 'MauiImage', 'PRIResource', 'AdditionalFiles', 'SplashScreen'];
        const files = types.map(itemType => `${itemType}.dat`);
        const items = await evaluate(`<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
${types.map(itemType => `    <None Remove="${itemType}.dat" />\n    <${itemType} Include="${itemType}.dat" />`).join('\n')}
  </ItemGroup>
</Project>
`, files);
        expect(notIncluded(items, files)).toEqual([]);
        expect(types.map(itemType => items.itemTypeOf(at(`${itemType}.dat`)))).toEqual(types);
    }, TIMEOUT);

    withDotnet('a multi-targeted project lists its files (evaluated for the first target framework)', async () => {
        const files = ['Greeter.cs', 'notes.txt', 'Sub/Util.cs'];
        const items = await evaluate(`<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFrameworks>net8.0;net10.0</TargetFrameworks>
  </PropertyGroup>
  <ItemGroup Condition="'$(TargetFramework)' == 'net8.0'">
    <Compile Remove="Sub\\**" />
  </ItemGroup>
</Project>
`, files);
        expect(notIncluded(items, files)).toEqual(['Sub/Util.cs']);
        expect(items.itemTypeOf(at('Greeter.cs'))).toBe('Compile');
    }, TIMEOUT);
    withDotnet('100 changes while MSBuild runs start one more MSBuild, never two at once, and the result follows the last change', async () => {
        const projectPath = at('App.csproj');
        const project = (remove: string) => `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <Compile Remove="${remove}" />
  </ItemGroup>
</Project>
`;
        fs.writeFileSync(projectPath, project('A.cs'));
        fs.writeFileSync(at('A.cs'), '');
        fs.writeFileSync(at('B.cs'), '');
        let started = 0;
        let running = 0;
        let most = 0;
        // Single-targeted: each run is one `dotnet msbuild` process
        const counting = async (projectFile: string) => {
            started++;
            most = Math.max(most, ++running);
            try {
                return await runMsbuild(projectFile);
            } finally {
                running--;
            }
        };
        const service = new ProjectItemsService(counting);
        const first = service.evaluate(projectPath);
        while (started === 0) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        // The project changes while the first MSBuild runs, then 100 requests for a fresh evaluation come
        fs.writeFileSync(projectPath, project('B.cs'));
        const callers = Array.from({ length: 100 }, () => {
            service.invalidate(projectPath);
            return service.evaluate(projectPath);
        });
        const results = await Promise.all([first, ...callers]);
        expect(new Set(results).size).toBe(1);
        expect(results[0]?.isIncluded(at('A.cs'))).toBe(true);
        expect(results[0]?.isIncluded(at('B.cs'))).toBe(false);
        expect(service.get(projectPath)).toBe(results[0]);
        expect({ started, most }).toEqual({ started: 2, most: 1 });
    }, TIMEOUT);

    withDotnet('Protobuf items come with GrpcServices, Link and SourceUrl as written (before any restore)', async () => {
        fs.mkdirSync(path.join(root, 'shared'));
        fs.writeFileSync(path.join(root, 'shared', 'greet.proto'), '');
        const items = await evaluate(`<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <Protobuf Include="..\\shared\\greet.proto" GrpcServices="Client" Link="Protos\\greet.proto" />
    <Protobuf Include="Protos\\remote.proto">
      <SourceUrl>https://example.com/remote.proto</SourceUrl>
    </Protobuf>
  </ItemGroup>
</Project>
`, ['Protos/remote.proto']);
        expect(items.protobuf.map(item => ({ ...item, link: item.link?.replace(/[\\/]/g, '/') }))).toEqual([
            { include: expect.stringMatching(/^\.\.[\\/]shared[\\/]greet\.proto$/), fullPath: path.join(root, 'shared', 'greet.proto'), link: 'Protos/greet.proto', grpcServices: 'Client', definedIn: at('App.csproj') },
            // No Grpc.Tools restored: nothing defaults GrpcServices yet
            { include: expect.stringMatching(/^Protos[\\/]remote\.proto$/), fullPath: at('Protos', 'remote.proto'), sourceUrl: 'https://example.com/remote.proto', definedIn: at('App.csproj'), link: undefined },
        ]);
        expect(items.linkedFilesIn(at('Protos')).map(item => item.fullPath)).toEqual([path.join(root, 'shared', 'greet.proto')]);
    }, TIMEOUT);
});
