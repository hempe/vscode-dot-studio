import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyPackageEdits, declaredGlobals, importChain } from '../../../../services/nuget/centralPackageFiles';

describe('central package files', () => {
    let dir: string;
    const write = (relative: string, content: string) => {
        const file = path.join(dir, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        return file;
    };

    beforeEach(() => { dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-files-'))); });
    afterEach(() => {
        for (const file of fs.readdirSync(dir, { recursive: true }) as string[]) {
            fs.chmodSync(path.join(dir, file), 0o755);
        }
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const props = '<Project>\n  <ItemGroup>\n    <PackageVersion Include="Serilog" Version="3.1.1" />\n  </ItemGroup>\n</Project>\n';
    const project = '<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup>\n    <PackageReference Include="Newtonsoft.Json" />\n  </ItemGroup>\n</Project>\n';

    // chmod does not keep root (or Windows) from writing
    const readOnlyApplies = process.platform !== 'win32' && process.getuid?.() !== 0;
    (readOnlyApplies ? test : test.skip)('a file that cannot be written: the files written before it get their old content back, the error is passed on', async () => {
        const propsFile = write('Directory.Packages.props', props);
        const projectFile = write('App/App.csproj', project);
        fs.chmodSync(projectFile, 0o444);
        await expect(applyPackageEdits([
            { kind: 'addPackageVersion', file: propsFile, id: 'Polly', version: '8.1.0' },
            { kind: 'addPackageReference', file: projectFile, id: 'Polly' },
        ])).rejects.toThrow();
        expect(fs.readFileSync(propsFile, 'utf8')).toBe(props);
        expect(fs.readFileSync(projectFile, 'utf8')).toBe(project);
    });

    test('importChain: Directory.Packages.props and every file it imports, also through the imported ones', () => {
        const root = write('Directory.Packages.props', `<Project>
  <Import Project="build/Versions.props" />
  <Import Project="$(MSBuildThisFileDirectory)Shared.props" Condition="Exists('$(MSBuildThisFileDirectory)Shared.props')" />
  <!-- <Import Project="Old.props" /> -->
  <Import Project="$(SomethingUnknown)/X.props" />
</Project>`);
        write('build/Versions.props', '<Project>\n  <Import Project="../Company.props" />\n  <PropertyGroup><SerilogVersion>3.1.1</SerilogVersion></PropertyGroup>\n</Project>');
        write('Company.props', '<Project>\n  <Import Project="Directory.Packages.props" />\n</Project>');
        const nested = write('src/Directory.Packages.props',
            `<Project>\n  <Import Project="$([MSBuild]::GetPathOfFileAbove('Directory.Packages.props', '$(MSBuildThisFileDirectory)..'))" />\n</Project>`);
        expect(importChain(root)).toEqual([
            root, path.join(dir, 'build', 'Versions.props'), path.join(dir, 'Company.props'), path.join(dir, 'Shared.props'),
        ]);
        expect(importChain(nested)).toEqual([nested, ...importChain(root)]);
    });

    test('importChain follows GetPathOfFileAbove without quotes, the form the Central Package Management docs show (review A4-15)', () => {
        const root = write('Directory.Packages.props', '<Project />');
        const nested = write('src/Directory.Packages.props',
            '<Project>\n  <Import Project="$([MSBuild]::GetPathOfFileAbove(Directory.Packages.props, $(MSBuildThisFileDirectory)..))" />\n</Project>');
        expect(importChain(nested)).toEqual([nested, root]);
    });

    test('declaredGlobals: the GlobalPackageReference entries written in the files, missing files skipped', () => {
        const file = write('Directory.Packages.props',
            '<Project>\n  <ItemGroup>\n    <GlobalPackageReference Include="Microsoft.SourceLink.GitHub" Version="8.0.0" />\n  </ItemGroup>\n</Project>');
        expect(declaredGlobals([file, path.join(dir, 'Missing.props')])).toEqual([{ id: 'Microsoft.SourceLink.GitHub', version: '8.0.0', file }]);
    });
});
