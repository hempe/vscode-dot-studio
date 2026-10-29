// The shared frameworks come from the real evaluation: the SDK adds Microsoft.NETCore.App (and for web projects Microsoft.AspNetCore.App)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { parseMsbuildItems } from '../../../../../services/project/items/projectItems';
import { runMsbuild } from '../../../../../services/project/items/projectItemsService';

const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? it : it.skip;

describe('FrameworkReference items from MSBuild', () => {
    let dir: string;
    beforeEach(() => { dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-fw-'))); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    const frameworksOf = async (sdk: string, extra = '') => {
        const projectPath = path.join(dir, 'App.csproj');
        fs.writeFileSync(projectPath, `<Project Sdk="${sdk}"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup>${extra}</Project>`);
        return parseMsbuildItems(await runMsbuild(projectPath), dir)?.frameworks;
    };

    withDotnet('a console project has the implicit Microsoft.NETCore.App', async () => {
        expect(await frameworksOf('Microsoft.NET.Sdk')).toEqual([{ name: 'Microsoft.NETCore.App', implicit: true }]);
    }, 120000);

    withDotnet('a web project also has Microsoft.AspNetCore.App, and an explicit reference is not implicit', async () => {
        const web = await frameworksOf('Microsoft.NET.Sdk.Web');
        expect(web?.map(framework => framework.name).sort()).toEqual(['Microsoft.AspNetCore.App', 'Microsoft.NETCore.App']);

        const explicit = await frameworksOf('Microsoft.NET.Sdk', '<ItemGroup><FrameworkReference Include="Microsoft.AspNetCore.App" /></ItemGroup>');
        expect(explicit).toEqual(expect.arrayContaining([{ name: 'Microsoft.AspNetCore.App', implicit: false }]));
    }, 120000);
});
