import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { excludeEdit } from '../../../../services/projectItems/projectItemEdits';
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
    let dir: string;
    let projectPath: string;
    const at = (...parts: string[]) => path.join(dir, ...parts);

    beforeEach(() => {
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'item-edits-')));
        projectPath = path.join(dir, 'App.csproj');
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

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

    withDotnet('a file listed under two item types leaves the project', async () => {
        setUp(sdkProject('\n  <ItemGroup>\n    <None Include="Scripts\\*.cs" />\n  </ItemGroup>\n'), ['Program.cs', 'Scripts/Sc.cs']);
        expect((await evaluate()).itemTypesOf(at('Scripts', 'Sc.cs'))).toEqual(['Compile', 'None']);
        const after = await exclude(at('Scripts', 'Sc.cs'));
        expect(after.isIncluded(at('Scripts', 'Sc.cs'))).toBe(false);
        expect(after.isIncluded(at('Program.cs'))).toBe(true);
    }, TIMEOUT);
});
