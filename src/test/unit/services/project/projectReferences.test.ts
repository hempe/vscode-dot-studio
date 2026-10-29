import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addProjectReferences, projectReferencesIn, referenceRefusal } from '../../../services/projectReferences';

const at = (...parts: string[]) => path.resolve('/repo', ...parts);

describe('project references', () => {
    test('read from the project file, relative to its folder, not from comments', () => {
        const content = '<Project>\n  <ItemGroup>\n    <ProjectReference Include="..\\Lib\\Lib.csproj" />\n'
            + '    <!-- <ProjectReference Include="..\\Old\\Old.csproj" /> -->\n    <ProjectReference Include=\'../Core/Core.csproj\'>\n'
            + '      <Private>false</Private>\n    </ProjectReference>\n  </ItemGroup>\n</Project>\n';
        expect(projectReferencesIn(content, at('Web'))).toEqual([at('Lib', 'Lib.csproj'), at('Core', 'Core.csproj')]);
    });

    test('refused: itself, one it has, and one that would close a circle through others', () => {
        const graph: Record<string, string[]> = {
            [at('Web', 'Web.csproj')]: [at('Lib', 'Lib.csproj')],
            [at('Lib', 'Lib.csproj')]: [at('Core', 'Core.csproj')],
            [at('Core', 'Core.csproj')]: [],
        };
        const of = (project: string) => graph[project] ?? [];
        expect(referenceRefusal(at('Web', 'Web.csproj'), at('Web', 'Web.csproj'), of)).toBe('Web cannot reference itself.');
        expect(referenceRefusal(at('Web', 'Web.csproj'), at('Lib', 'Lib.csproj'), of)).toBe('Web already references Lib.');
        expect(referenceRefusal(at('Core', 'Core.csproj'), at('Web', 'Web.csproj'), of)).toBe('A reference from Core to Web would cause a circular dependency.');
        expect(referenceRefusal(at('Web', 'Web.csproj'), at('Core', 'Core.csproj'), of)).toBeUndefined();
    });

    test('the refused ones are left out of the dotnet call; none left: no call', async () => {
        const run = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
        const of = (project: string) => project === at('Lib', 'Lib.csproj') ? [at('Web', 'Web.csproj')] : [];
        const result = await addProjectReferences(at('Web', 'Web.csproj'), [at('Lib', 'Lib.csproj'), at('Core', 'Core.csproj')], run, of);
        expect(result).toEqual({ added: [at('Core', 'Core.csproj')], refused: ['A reference from Web to Lib would cause a circular dependency.'] });
        expect(run).toHaveBeenCalledWith(['add', at('Web', 'Web.csproj'), 'reference', at('Core', 'Core.csproj')], at('Web'));
        run.mockClear();
        await addProjectReferences(at('Web', 'Web.csproj'), [at('Web', 'Web.csproj')], run, of);
        expect(run).not.toHaveBeenCalled();
    });

    const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip;
    withDotnet('real dotnet: adds the reference, and says why when the target frameworks do not fit', async () => {
        const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'project-references-')));
        try {
            const project = (name: string, framework: string) => {
                fs.mkdirSync(path.join(root, name));
                fs.writeFileSync(path.join(root, name, `${name}.csproj`), `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>${framework}</TargetFramework>\n  </PropertyGroup>\n</Project>\n`);
                return path.join(root, name, `${name}.csproj`);
            };
            const web = project('Web', 'net8.0');
            const lib = project('Lib', 'net8.0');
            const newer = project('Newer', 'net10.0');
            expect(await addProjectReferences(web, [lib])).toEqual({ added: [lib], refused: [] });
            expect(projectReferencesIn(fs.readFileSync(web, 'utf8'), path.dirname(web))).toEqual([lib]);
            expect(await addProjectReferences(lib, [web])).toEqual({ added: [], refused: ['A reference from Lib to Web would cause a circular dependency.'] });
            const failed = await addProjectReferences(web, [newer]);
            expect(failed.added).toEqual([]);
            expect(failed.error).toMatch(/incompatible targeted frameworks/);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    }, 150000);
});
