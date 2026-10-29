import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { itemsWithoutExcludes, newItemFor } from '../../../../services/projectItems/defaultItems';
import { includeEdit, listFilesUnder } from '../../../../services/projectItems/projectItemEdits';
import { cannotRun } from '../../testSupport/cannotRun';

/** Include In Project against the real SDK: the item types MSBuild gives, and that the build and publish then use the files */
const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip;
const TIMEOUT = 150000;

describe('Include In Project with the item types of the SDK (real MSBuild)', () => {
    let root: string;
    let dir: string;
    let projectPath: string;
    const at = (...parts: string[]) => path.join(dir, ...parts);
    const write = (file: string, content: string) => {
        fs.mkdirSync(path.dirname(at(file)), { recursive: true });
        fs.writeFileSync(at(file), content);
    };

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'default-items-')));
        dir = path.join(root, 'Web');
        projectPath = path.join(dir, 'Web.csproj');
        write('Web.csproj', `<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <DefaultItemExcludes>$(DefaultItemExcludes);Pages\\Legacy\\**;wwwroot\\old\\**</DefaultItemExcludes>
  </PropertyGroup>

</Project>
`);
        write('Program.cs', 'var app = WebApplication.CreateBuilder(args).Build();\napp.MapRazorPages();\napp.Run();\n');
        write('Pages/_ViewImports.cshtml', '@addTagHelper *, Microsoft.AspNetCore.Mvc.TagHelpers\n');
        write('Pages/Legacy/Hello.cshtml', '@page\n@model Web.Pages.Legacy.HelloModel\n<h1>Hello from legacy</h1>\n');
        write('Pages/Legacy/Hello.cshtml.cs', 'using Microsoft.AspNetCore.Mvc.RazorPages;\nnamespace Web.Pages.Legacy;\npublic class HelloModel : PageModel { public void OnGet() { } }\n');
        write('Pages/Legacy/Strings.resx', '<?xml version="1.0" encoding="utf-8"?>\n<root>\n  <data name="Greeting" xml:space="preserve"><value>Hi</value></data>\n</root>\n');
        write('Pages/Legacy/data.json', '{}\n');
        write('Pages/Legacy/notes.txt', 'notes\n');
        write('wwwroot/old/site.css', 'body { }\n');
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    withDotnet('the types and the output metadata MSBuild would give the excluded files', async () => {
        const items = await itemsWithoutExcludes(projectPath);
        expect(newItemFor(at('Pages', 'Legacy', 'Hello.cshtml'), items)).toEqual({ itemType: 'Content', metadata: { CopyToPublishDirectory: 'PreserveNewest', ExcludeFromSingleFile: 'true' } });
        expect(newItemFor(at('Pages', 'Legacy', 'Hello.cshtml.cs'), items)).toEqual({ itemType: 'Compile', metadata: {} });
        expect(newItemFor(at('Pages', 'Legacy', 'Strings.resx'), items)).toEqual({ itemType: 'EmbeddedResource', metadata: {} });
        expect(newItemFor(at('Pages', 'Legacy', 'data.json'), items)).toEqual({
            itemType: 'Content', metadata: { CopyToOutputDirectory: 'PreserveNewest', CopyToPublishDirectory: 'PreserveNewest', ExcludeFromSingleFile: 'true' },
        });
        expect(newItemFor(at('Pages', 'Legacy', 'notes.txt'), items)).toEqual({ itemType: 'None', metadata: {} });
        expect(newItemFor(at('wwwroot', 'old', 'site.css'), items).itemType).toBe('Content');
    }, TIMEOUT);

    withDotnet('in a project of the plain SDK the same .cshtml is None, as MSBuild says', async () => {
        fs.writeFileSync(projectPath, fs.readFileSync(projectPath, 'utf8').replace('Microsoft.NET.Sdk.Web', 'Microsoft.NET.Sdk'));
        expect(newItemFor(at('Pages', 'Legacy', 'Hello.cshtml'), await itemsWithoutExcludes(projectPath)).itemType).toBe('None');
    }, TIMEOUT);

    withDotnet('after Include In Project the page is compiled, the resource embedded and the files published', async () => {
        const items = await itemsWithoutExcludes(projectPath);
        let content = fs.readFileSync(projectPath, 'utf8');
        for (const folder of [at('Pages', 'Legacy'), at('wwwroot', 'old')]) {
            content = includeEdit(content, dir, folder, true, await listFilesUnder(folder), items);
        }
        fs.writeFileSync(projectPath, content);
        const publishDir = path.join(root, 'publish');
        const result = spawnSync('dotnet', ['publish', projectPath, '-o', publishDir, '-nologo'], { cwd: dir, encoding: 'utf8' });
        if (result.status !== 0 && /NU1301|Unable to load the service index/.test(result.stdout + result.stderr)) {
            cannotRun('nuget.org is not reachable and the packages are not in the NuGet cache');
            return;
        }
        expect(result.stdout + result.stderr).not.toMatch(/error/i);
        const dll = fs.readFileSync(path.join(publishDir, 'Web.dll'));
        // The page's HTML is a UTF-16 string literal of the compiled view; the resource is embedded by name
        expect(dll.includes(Buffer.from('<h1>Hello from legacy</h1>', 'utf16le'))).toBe(true);
        expect(dll.includes(Buffer.from('Web.Pages.Legacy.Strings.resources'))).toBe(true);
        expect(fs.existsSync(path.join(publishDir, 'Pages', 'Legacy', 'data.json'))).toBe(true);
        expect(fs.existsSync(path.join(publishDir, 'wwwroot', 'old', 'site.css'))).toBe(true);
        expect(fs.existsSync(path.join(publishDir, 'Pages', 'Legacy', 'notes.txt'))).toBe(false);
    }, TIMEOUT);
});
