import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({ window: { showWarningMessage: jest.fn() } }), { virtual: true });
jest.mock('../../../../services/solution/solutionService', () => ({ SolutionService: { getActiveSolution: () => undefined } }));

import { OperationsHost, changePackageVersions, consolidatePackages, uninstallPackages } from '../../../../services/nuget/centralPackageOperations';
import { ProjectState } from '../../../../services/nuget/centralPackagePlan';
import { ProjectPackages, parseMsbuildPackages } from '../../../../services/nuget/centralPackages';

const fixture = path.resolve(__dirname, '../../../../__fixtures__/central-packages/cpm');

describe('central package operations (confirmations, edits, CLI, restore)', () => {
    let root: string;
    const csproj = (name: string) => path.join(root, name, `${name}.csproj`);
    const props = () => path.join(root, 'Directory.Packages.props');
    const extra = () => path.join(root, 'Packages.Extra.props');
    const read = (file: string) => fs.readFileSync(file, 'utf8');

    /** The fixture's projects as MSBuild evaluates them (see centralPackages.msbuild.test.ts), without running MSBuild */
    const states = (): ProjectState[] => {
        const versions = [
            { Identity: 'Newtonsoft.Json', Version: '13.0.1', DefiningProjectFullPath: props() },
            { Identity: 'Serilog', Version: '3.1.1', DefiningProjectFullPath: props() },
            { Identity: 'Polly', Version: '8.1.0', DefiningProjectFullPath: extra() },
        ];
        const global = { Identity: 'Microsoft.SourceLink.GitHub', Version: '8.0.0', DefiningProjectFullPath: props() };
        const state = (name: string, references: object[], cpm = true, globals = true): ProjectState => ({
            name, path: csproj(name), packages: parseMsbuildPackages(JSON.stringify({
                Properties: { ManagePackageVersionsCentrally: String(cpm), DirectoryPackagesPropsPath: props() },
                Items: {
                    PackageReference: [...references.map(reference => ({ DefiningProjectFullPath: csproj(name), ...reference })),
                        ...(cpm && globals ? [{ Identity: global.Identity }] : [])],
                    PackageVersion: versions,
                    GlobalPackageReference: globals ? [global] : [],
                },
            }), csproj(name)) as ProjectPackages,
        });
        return [
            state('App', [{ Identity: 'Newtonsoft.Json' }, { Identity: 'Serilog' }, { Identity: 'Polly' }]),
            state('Override', [{ Identity: 'Newtonsoft.Json', VersionOverride: '13.0.2' }]),
            state('GlobalOnly', []),
            state('OptOut', [{ Identity: 'Serilog' }], true, false),
            state('Legacy', [{ Identity: 'Polly', Version: '8.0.0' }], false),
        ];
    };

    let host: jest.Mocked<OperationsHost>;
    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-operations-')));
        fs.cpSync(fixture, root, { recursive: true });
        host = {
            ask: jest.fn(),
            states: jest.fn().mockImplementation(async () => states()),
            install: jest.fn().mockResolvedValue({ success: true, message: 'installed' }),
            uninstall: jest.fn().mockResolvedValue({ success: true, message: 'uninstalled' }),
            restore: jest.fn().mockResolvedValue({ success: true, message: 'restored' }),
            solutionPath: jest.fn().mockReturnValue(path.join(root, 'Central.slnx')),
            reevaluate: jest.fn().mockResolvedValue(undefined),
        };
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    test('a central update that reaches other projects asks first; "Update All Projects" edits the props file once', async () => {
        host.ask.mockResolvedValue('Update All Projects');
        const outcome = await changePackageVersions([{ id: 'Serilog', version: '4.0.0', projects: [csproj('App')] }], 'shared', host);
        expect(host.ask).toHaveBeenCalledWith('Change Serilog to 4.0.0 for every project that uses it?',
            'The version is set centrally in Directory.Packages.props, so it also changes for OptOut.', 'Update All Projects', 'Set for This Project Only');
        expect(outcome.cancelled).toBe(false);
        expect(read(props())).toContain('<PackageVersion Include="Serilog" Version="4.0.0" />');
        expect(host.install).not.toHaveBeenCalled();
        expect(host.restore).toHaveBeenCalledWith(path.join(root, 'Central.slnx'));
        expect((host.reevaluate.mock.calls[0][0] as string[]).map(file => path.basename(file)).sort())
            .toEqual(['App.csproj', 'GlobalOnly.csproj', 'Override.csproj', 'OptOut.csproj'].sort());
    });

    test('"Set for This Project Only" writes a VersionOverride and leaves the props file alone', async () => {
        host.ask.mockResolvedValue('Set for This Project Only');
        const before = read(props());
        await changePackageVersions([{ id: 'Serilog', version: '4.0.0', projects: [csproj('App')] }], 'shared', host);
        expect(read(props())).toBe(before);
        expect(read(csproj('App'))).toContain('<PackageReference Include="Serilog" VersionOverride="4.0.0" />');
        expect(host.restore).toHaveBeenCalledWith(csproj('App'));
    });

    test('Cancel changes nothing', async () => {
        host.ask.mockResolvedValue(undefined);
        const before = read(props());
        expect(await changePackageVersions([{ id: 'Serilog', version: '4.0.0', projects: [csproj('App')] }], 'shared', host)).toEqual({ cancelled: true, results: [] });
        expect(read(props())).toBe(before);
        expect(host.restore).not.toHaveBeenCalled();
    });

    test('no question when every project that uses the version was selected; a bulk update asks once', async () => {
        await changePackageVersions([{ id: 'Serilog', version: '4.0.0', projects: [csproj('App'), csproj('OptOut')] }], 'shared', host);
        expect(host.ask).not.toHaveBeenCalled();
        host.ask.mockResolvedValue('Update All Projects');
        await changePackageVersions([
            { id: 'Polly', version: '8.2.0', projects: [csproj('GlobalOnly')] },
            { id: 'Microsoft.SourceLink.GitHub', version: '8.0.1', projects: [csproj('App')] },
        ], 'shared', host);
        expect(host.ask).toHaveBeenCalledTimes(1);
        // a global package cannot be set for one project: only "Update All Projects"
        expect(host.ask.mock.calls[0].slice(2)).toEqual(['Update All Projects']);
    });

    test('a project without CPM is updated with the CLI, as before', async () => {
        await changePackageVersions([{ id: 'Polly', version: '8.2.0', projects: [csproj('Legacy')] }], 'shared', host);
        expect(host.install).toHaveBeenCalledWith(csproj('Legacy'), 'Polly', '8.2.0');
        expect(read(extra())).toContain('Version="8.1.0"');
    });

    test('projects updated with the CLI are evaluated again; a failed CLI update is not', async () => {
        await changePackageVersions([{ id: 'Polly', version: '8.2.0', projects: [csproj('Legacy')] }], 'shared', host);
        expect(host.reevaluate).toHaveBeenCalledWith([csproj('Legacy')]);

        host.reevaluate.mockClear();
        host.install.mockResolvedValue({ success: false, message: 'failed' });
        await changePackageVersions([{ id: 'Polly', version: '8.2.0', projects: [csproj('Legacy')] }], 'shared', host);
        expect(host.reevaluate).not.toHaveBeenCalled();
    });

    test('an edit that fails leaves every file as it was and reports the error', async () => {
        fs.writeFileSync(extra(), '<Project>\n</Project>\n');
        const before = read(props());
        host.ask.mockResolvedValue('Update All Projects');
        const outcome = await changePackageVersions([
            { id: 'Serilog', version: '4.0.0', projects: [csproj('App'), csproj('OptOut')] },
            { id: 'Polly', version: '8.2.0', projects: [csproj('App')] },
        ], 'shared', host);
        expect(outcome.results).toEqual([expect.objectContaining({ success: false, message: expect.stringContaining('No <PackageVersion Include="Polly">') })]);
        expect(read(props())).toBe(before);
    });

    test('uninstall: the CLI removes the reference, then a now unused central version is removed only when the user says so', async () => {
        host.ask.mockResolvedValueOnce('Remove');
        await uninstallPackages('Polly', [csproj('App')], host);
        expect(host.uninstall).toHaveBeenCalledWith(csproj('App'), 'Polly');
        expect(host.ask).toHaveBeenCalledWith('No project uses Polly any more. Remove its version from Packages.Extra.props?', expect.any(String), 'Remove');
        expect(read(extra())).not.toContain('Polly');

        host.ask.mockReset().mockResolvedValue(undefined);
        await uninstallPackages('Serilog', [csproj('App'), csproj('OptOut')], host);
        expect(read(props())).toContain('Include="Serilog"');
    });

    test('uninstall of a global package names every project; "only this project" adds an opt-out', async () => {
        host.ask.mockResolvedValue('Remove from This Project Only');
        await uninstallPackages('Microsoft.SourceLink.GitHub', [csproj('App')], host);
        expect(host.ask).toHaveBeenCalledWith('Microsoft.SourceLink.GitHub is a global package: every project gets it from Directory.Packages.props.',
            expect.stringContaining('It applies to App, GlobalOnly, Override.'), 'Remove for All Projects', 'Remove from This Project Only');
        expect(read(csproj('App'))).toContain('<GlobalPackageReference Remove="Microsoft.SourceLink.GitHub" />');
        expect(host.uninstall).not.toHaveBeenCalled();
        expect(read(props())).toContain('GlobalPackageReference Include');
    });

    test('uninstall of a global package for all projects removes it from the props file', async () => {
        host.ask.mockResolvedValue('Remove for All Projects');
        await uninstallPackages('Microsoft.SourceLink.GitHub', [csproj('App')], host);
        expect(read(props())).not.toContain('GlobalPackageReference');
        expect(read(csproj('OptOut'))).not.toContain('GlobalPackageReference');
    });

    test('consolidate under CPM: one confirmation, the central version set, the override removed', async () => {
        host.ask.mockResolvedValue('Consolidate');
        const outcome = await consolidatePackages([{ id: 'Newtonsoft.Json', version: '13.0.3' }], host);
        expect(host.ask).toHaveBeenCalledWith('Consolidate Newtonsoft.Json to 13.0.3?', expect.stringContaining('Override: VersionOverride 13.0.2 removed'), 'Consolidate');
        expect(outcome.results).toEqual([expect.objectContaining({ success: true, packageId: 'Newtonsoft.Json' })]);
        expect(read(props())).toContain('<PackageVersion Include="Newtonsoft.Json" Version="13.0.3" />');
        expect(read(csproj('Override'))).not.toContain('VersionOverride');
        expect(host.restore).toHaveBeenCalledWith(path.join(root, 'Central.slnx'));
    });

    test('consolidate: Cancel changes nothing; projects without CPM use the CLI', async () => {
        host.ask.mockResolvedValue(undefined);
        expect((await consolidatePackages([{ id: 'Newtonsoft.Json', version: '13.0.3' }], host)).cancelled).toBe(true);
        expect(read(csproj('Override'))).toContain('VersionOverride="13.0.2"');
        await consolidatePackages([{ id: 'Polly', version: '8.1.0' }], host);
        expect(host.install).toHaveBeenCalledWith(csproj('Legacy'), 'Polly', '8.1.0');
        expect(host.reevaluate).toHaveBeenCalledWith([csproj('Legacy')]);
    });
});
