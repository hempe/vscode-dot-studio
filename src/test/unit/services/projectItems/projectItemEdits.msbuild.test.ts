import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { excludeEdit, includeEdit } from '../../../../services/projectItems/projectItemEdits';
import { ProjectItemsService } from '../../../../services/projectItems/projectItemsService';

/** The edits checked against real MSBuild: what the project contains after them, not just the text they write */
const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip;
const TIMEOUT = 150000;

const sdkProject = (body = '') => `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
${body}
</Project>
`;

describe('Exclude/Include against real MSBuild', () => {
    let root: string;
    let dir: string;
    let projectPath: string;
    const at = (...parts: string[]) => path.join(dir, ...parts);

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'item-edits-')));
        dir = path.join(root, 'App');
        fs.mkdirSync(dir);
        projectPath = path.join(dir, 'App.csproj');
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    const setUp = (project: string, files: string[]) => {
        fs.writeFileSync(projectPath, project);
        for (const file of files) {
            fs.mkdirSync(path.dirname(at(file)), { recursive: true });
            fs.writeFileSync(at(file), '');
        }
    };
    const evaluate = async () => {
        const items = await new ProjectItemsService().evaluate(projectPath);
        if (!items) {
            throw new Error(`MSBuild could not evaluate:\n${fs.readFileSync(projectPath, 'utf8')}`);
        }
        return items;
    };
    const exclude = async (target: string, isFolder = false) => {
        const items = await evaluate();
        fs.writeFileSync(projectPath, excludeEdit(fs.readFileSync(projectPath, 'utf8'), dir, target, isFolder, items));
        return evaluate();
    };
    const include = async (target: string, isFolder = false, filesUnder: string[] = []) => {
        fs.writeFileSync(projectPath, includeEdit(fs.readFileSync(projectPath, 'utf8'), dir, target, isFolder, filesUnder));
        return evaluate();
    };

    withDotnet('a file listed under two item types leaves the project', async () => {
        setUp(sdkProject('\n  <ItemGroup>\n    <None Include="Scripts\\*.cs" />\n  </ItemGroup>\n'), ['Program.cs', 'Scripts/Sc.cs']);
        expect((await evaluate()).itemTypesOf(at('Scripts', 'Sc.cs'))).toEqual(['Compile', 'None']);
        const after = await exclude(at('Scripts', 'Sc.cs'));
        expect(after.isIncluded(at('Scripts', 'Sc.cs'))).toBe(false);
        expect(after.isIncluded(at('Program.cs'))).toBe(true);
    }, TIMEOUT);

    withDotnet('Include of a file in an excluded folder takes effect after an earlier linked Include', async () => {
        fs.mkdirSync(path.join(root, 'Shared'));
        fs.writeFileSync(path.join(root, 'Shared', 'S.cs'), '');
        setUp(sdkProject('\n  <ItemGroup>\n    <Compile Include="..\\Shared\\S.cs" Link="Linked\\S.cs" />\n  </ItemGroup>\n\n'
            + '  <ItemGroup>\n    <Compile Remove="Old\\**" />\n  </ItemGroup>\n'), ['Program.cs', 'Old/O.cs']);
        expect((await evaluate()).isIncluded(at('Old', 'O.cs'))).toBe(false);
        const after = await include(at('Old', 'O.cs'));
        expect(after.isIncluded(at('Old', 'O.cs'))).toBe(true);
    }, TIMEOUT);

    withDotnet('Exclude of an explicitly included file takes effect after an earlier Remove group', async () => {
        setUp(sdkProject('\n  <PropertyGroup>\n    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>\n  </PropertyGroup>\n\n'
            + '  <ItemGroup>\n    <Compile Remove="Old\\**" />\n  </ItemGroup>\n\n'
            + '  <ItemGroup>\n    <Compile Include="K.cs" />\n  </ItemGroup>\n'), ['K.cs']);
        expect((await evaluate()).isIncluded(at('K.cs'))).toBe(true);
        const after = await exclude(at('K.cs'));
        expect(after.isIncluded(at('K.cs'))).toBe(false);
    }, TIMEOUT);

    const specialNames = ['a;b.txt', '$(X).txt', 'a%b.txt', 'a b.txt', 'a@b.txt', "it's (1).txt", 'star*.txt', 'q?.txt'];

    withDotnet('names with MSBuild special characters are excluded and included literally', async () => {
        setUp(sdkProject(), ['Program.cs', 'starry.txt', 'qq.txt', ...specialNames]);
        let items = await evaluate();
        for (const name of specialNames) {
            expect([name, items.isIncluded(at(name))]).toEqual([name, true]);
        }
        for (const name of specialNames) {
            items = await exclude(at(name));
            expect([name, items.isIncluded(at(name))]).toEqual([name, false]);
        }
        // the wildcards were taken literally
        expect(items.isIncluded(at('starry.txt'))).toBe(true);
        expect(items.isIncluded(at('qq.txt'))).toBe(true);
        for (const name of specialNames) {
            items = await include(at(name));
            expect([name, items.isIncluded(at(name))]).toEqual([name, true]);
        }
        expect(fs.readFileSync(projectPath, 'utf8')).toBe(sdkProject());
    }, TIMEOUT);

    withDotnet('names with MSBuild special characters left out by DefaultItemExcludes get a literal Include', async () => {
        setUp(sdkProject('\n  <PropertyGroup>\n    <DefaultItemExcludes>$(DefaultItemExcludes);Out\\**</DefaultItemExcludes>\n  </PropertyGroup>\n'),
            ['Program.cs', 'Out/starry.txt', ...specialNames.map(name => `Out/${name}`)]);
        let items = await evaluate();
        for (const name of specialNames) {
            items = await include(at('Out', name));
            expect([name, items.isIncluded(at('Out', name))]).toEqual([name, true]);
        }
        expect(items.isIncluded(at('Out', 'starry.txt'))).toBe(false);
    }, TIMEOUT);
});
