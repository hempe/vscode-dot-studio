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
