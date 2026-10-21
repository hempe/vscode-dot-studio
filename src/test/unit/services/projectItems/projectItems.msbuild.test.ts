import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectItemsService } from '../../../../services/projectItems/projectItemsService';

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
});
