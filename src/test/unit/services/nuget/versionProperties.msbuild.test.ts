import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({ window: { showWarningMessage: jest.fn() } }), { virtual: true });
jest.mock('../../../../services/solution/solutionService', () => ({ SolutionService: { getActiveSolution: () => undefined } }));

import { OperationsHost, changePackageVersions } from '../../../../services/nuget/centralPackageOperations';
import { ProjectItemsService } from '../../../../services/project/items/projectItemsService';

/** A shared version property against real MSBuild: the projects are evaluated before and after (no restore, no network) */
const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip;
const TIMEOUT = 150000;

describe('central versions written as properties (real MSBuild)', () => {
    let root: string;
    const csproj = (name: string) => path.join(root, name, `${name}.csproj`);
    const write = (file: string, content: string) => {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), content);
    };
    const versions = async () => {
        const service = new ProjectItemsService();
        return Object.fromEntries(await Promise.all(['A', 'B'].map(async name =>
            [name, (await service.evaluatePackages(csproj(name)))?.references.map(reference => `${reference.id} ${reference.version}`)])));
    };
    const host = (answer: string | undefined): jest.Mocked<OperationsHost> => ({
        ask: jest.fn().mockResolvedValue(answer),
        states: jest.fn().mockImplementation(async () => {
            const service = new ProjectItemsService();
            return Promise.all(['A', 'B'].map(async name => ({ name, path: csproj(name), packages: await service.evaluatePackages(csproj(name)) })));
        }),
        install: jest.fn(),
        uninstall: jest.fn(),
        restore: jest.fn().mockResolvedValue({ success: true, message: 'restored' }),
        solutionPath: jest.fn().mockReturnValue(undefined),
        reevaluate: jest.fn().mockResolvedValue(undefined),
    });

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-property-msbuild-')));
        write('Directory.Packages.props', `<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Serilog" Version="$(SerilogVersion)" />
    <PackageVersion Include="Serilog.Extensions.Logging" Version="$(SerilogVersion)" />
  </ItemGroup>
</Project>
`);
        write('Directory.Build.props', '<Project>\n  <PropertyGroup>\n    <SerilogVersion>3.1.1</SerilogVersion>\n  </PropertyGroup>\n</Project>\n');
        for (const [name, id] of [['A', 'Serilog'], ['B', 'Serilog.Extensions.Logging']]) {
            write(`${name}/${name}.csproj`, `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n  </PropertyGroup>\n  <ItemGroup>\n    <PackageReference Include="${id}" />\n  </ItemGroup>\n</Project>\n`);
        }
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    withDotnet('"Change SerilogVersion" edits Directory.Build.props, and MSBuild then gives both packages the new version', async () => {
        expect(await versions()).toEqual({ A: ['Serilog 3.1.1'], B: ['Serilog.Extensions.Logging 3.1.1'] });
        const asked = host('Change SerilogVersion');
        await changePackageVersions([{ id: 'Serilog', version: '4.0.0', projects: [csproj('A')] }], 'shared', asked);
        expect(asked.ask).toHaveBeenCalledWith("Serilog's version is $(SerilogVersion), which other packages follow too.",
            expect.stringContaining('Change SerilogVersion to 4.0.0 in Directory.Build.props: this also changes Serilog.Extensions.Logging (used by B).'),
            'Change SerilogVersion', 'Set Serilog Only');
        expect(fs.readFileSync(path.join(root, 'Directory.Build.props'), 'utf8')).toContain('<SerilogVersion>4.0.0</SerilogVersion>');
        expect(await versions()).toEqual({ A: ['Serilog 4.0.0'], B: ['Serilog.Extensions.Logging 4.0.0'] });
    }, TIMEOUT);

    withDotnet('"Set Serilog Only": Serilog alone gets the literal version, the other package keeps following the property', async () => {
        await changePackageVersions([{ id: 'Serilog', version: '4.0.0', projects: [csproj('A')] }], 'shared', host('Set Serilog Only'));
        expect(await versions()).toEqual({ A: ['Serilog 4.0.0'], B: ['Serilog.Extensions.Logging 3.1.1'] });
    }, TIMEOUT);
});
