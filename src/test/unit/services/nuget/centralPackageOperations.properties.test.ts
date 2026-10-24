import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({ window: { showWarningMessage: jest.fn() } }), { virtual: true });
jest.mock('../../../../services/solutionService', () => ({ SolutionService: { getActiveSolution: () => undefined } }));

import { OperationsHost, changePackageVersions, consolidatePackages } from '../../../../services/nuget/centralPackageOperations';
import { ProjectState } from '../../../../services/nuget/centralPackagePlan';
import { ProjectPackages, parseMsbuildPackages } from '../../../../services/nuget/centralPackages';

/** Changing a version written as `$(Property)`: the property, after a question when other packages follow it */
describe('central versions written as properties (operations, real files)', () => {
    let root: string;
    const csproj = (name: string) => path.join(root, name, `${name}.csproj`);
    const props = () => path.join(root, 'Directory.Packages.props');
    const read = (file: string) => fs.readFileSync(file, 'utf8');

    const states = (serilog = '3.1.1'): ProjectState[] => ['A', 'B'].map(name => ({
        name, path: csproj(name), packages: parseMsbuildPackages(JSON.stringify({
            Properties: { ManagePackageVersionsCentrally: 'true', DirectoryPackagesPropsPath: props() },
            Items: {
                PackageReference: [{ Identity: name === 'A' ? 'Serilog' : 'Serilog.Extensions.Logging', DefiningProjectFullPath: csproj(name) }],
                PackageVersion: [
                    { Identity: 'Serilog', Version: serilog, DefiningProjectFullPath: props() },
                    { Identity: 'Serilog.Extensions.Logging', Version: serilog, DefiningProjectFullPath: props() },
                ],
            },
        }), csproj(name)) as ProjectPackages,
    }));

    let host: jest.Mocked<OperationsHost>;
    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-properties-')));
        fs.writeFileSync(props(), `<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
    <SerilogVersion>3.1.1</SerilogVersion>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Serilog" Version="$(SerilogVersion)" />
    <PackageVersion Include="Serilog.Extensions.Logging" Version="$(SerilogVersion)" />
  </ItemGroup>
</Project>
`);
        for (const name of ['A', 'B']) {
            fs.mkdirSync(path.join(root, name));
            fs.writeFileSync(csproj(name), '<Project Sdk="Microsoft.NET.Sdk"></Project>\n');
        }
        host = {
            ask: jest.fn(),
            states: jest.fn().mockImplementation(async () => states()),
            install: jest.fn(),
            uninstall: jest.fn(),
            restore: jest.fn().mockResolvedValue({ success: true, message: 'restored' }),
            solutionPath: jest.fn().mockReturnValue(path.join(root, 'S.slnx')),
            reevaluate: jest.fn().mockResolvedValue(undefined),
        };
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    test('asks, naming the package and the project that follow the property; "Change SerilogVersion" edits the property', async () => {
        host.ask.mockResolvedValue('Change SerilogVersion');
        const outcome = await changePackageVersions([{ id: 'Serilog', version: '4.0.0', projects: [csproj('A')] }], 'shared', host);
        expect(host.ask).toHaveBeenCalledTimes(1);
        expect(host.ask).toHaveBeenCalledWith("Serilog's version is $(SerilogVersion), which other packages follow too.",
            expect.stringContaining('also changes Serilog.Extensions.Logging (used by B)'), 'Change SerilogVersion', 'Set Serilog Only');
        expect(outcome.cancelled).toBe(false);
        expect(read(props())).toContain('<SerilogVersion>4.0.0</SerilogVersion>');
        expect(read(props())).toContain('<PackageVersion Include="Serilog" Version="$(SerilogVersion)" />');
        expect((host.reevaluate.mock.calls[0][0] as string[]).map(file => path.basename(file)).sort()).toEqual(['A.csproj', 'B.csproj']);
    });

    test('"Set Serilog Only" writes a literal version on Serilog alone, as before', async () => {
        host.ask.mockResolvedValue('Set Serilog Only');
        await changePackageVersions([{ id: 'Serilog', version: '4.0.0', projects: [csproj('A')] }], 'shared', host);
        expect(read(props())).toContain('<SerilogVersion>3.1.1</SerilogVersion>');
        expect(read(props())).toContain('<PackageVersion Include="Serilog" Version="4.0.0" />');
        expect(read(props())).toContain('<PackageVersion Include="Serilog.Extensions.Logging" Version="$(SerilogVersion)" />');
    });

    test('Cancel changes nothing', async () => {
        host.ask.mockResolvedValue(undefined);
        const before = read(props());
        expect((await changePackageVersions([{ id: 'Serilog', version: '4.0.0', projects: [csproj('A')] }], 'shared', host)).cancelled).toBe(true);
        expect(read(props())).toBe(before);
        expect(host.restore).not.toHaveBeenCalled();
    });

    test('both packages updated to the same version (Update Selected): the property is changed once, without a question', async () => {
        await changePackageVersions([
            { id: 'Serilog', version: '4.0.0', projects: [csproj('A')] },
            { id: 'Serilog.Extensions.Logging', version: '4.0.0', projects: [csproj('B')] },
        ], 'shared', host);
        expect(host.ask).not.toHaveBeenCalled();
        expect(read(props())).toContain('<SerilogVersion>4.0.0</SerilogVersion>');
        expect(read(props()).match(/\$\(SerilogVersion\)/g)).toHaveLength(2);
    });

    test('Consolidate goes through the same question', async () => {
        host.states.mockImplementation(async () => [states()[0], { ...states()[1], packages: { ...states()[1].packages!, references: [
            { id: 'Serilog', version: '3.0.0', source: 'override', versionFile: csproj('B') },
            { id: 'Serilog.Extensions.Logging', version: '3.1.1', source: 'central', versionFile: props() },
        ] } }]);
        host.ask.mockResolvedValueOnce('Consolidate').mockResolvedValueOnce('Change SerilogVersion');
        await consolidatePackages([{ id: 'Serilog', version: '4.0.0' }], host);
        expect(host.ask).toHaveBeenCalledTimes(2);
        expect(read(props())).toContain('<SerilogVersion>4.0.0</SerilogVersion>');
    });
});
