import * as path from 'path';
import { centralFiles, packageVersionFileFor, packagesEqual, parseMsbuildPackages } from '../../../../services/nuget/centralPackages';

const root = path.resolve('/work/repo');
const at = (...parts: string[]) => path.join(root, ...parts);
const props = at('Directory.Packages.props');
const extra = at('Packages.Extra.props');
const project = at('App', 'App.csproj');
const nugetTargets = path.resolve('/sdk/NuGet.targets');

/** The JSON `dotnet msbuild -getProperty:... -getItem:...` prints (only the fields the parser reads) */
const output = (properties: Record<string, string>, items: Record<string, object[]>) =>
    `MSBuild version 18\n${JSON.stringify({ Properties: properties, Items: items }, null, 2)}`;

const cpm = { ManagePackageVersionsCentrally: 'true', DirectoryPackagesPropsPath: props, CentralPackageVersionOverrideEnabled: '' };
const versions = [
    { Identity: 'Newtonsoft.Json', Version: '13.0.1', DefiningProjectFullPath: props },
    { Identity: 'Serilog', Version: '3.1.1', DefiningProjectFullPath: props },
    { Identity: 'Polly', Version: '8.1.0', DefiningProjectFullPath: extra },
    { Identity: 'Microsoft.SourceLink.GitHub', Version: '8.0.0', DefiningProjectFullPath: nugetTargets },
];
const globals = [{ Identity: 'Microsoft.SourceLink.GitHub', Version: '8.0.0', DefiningProjectFullPath: props }];

describe('parseMsbuildPackages', () => {
    const packages = parseMsbuildPackages(output(cpm, {
        PackageReference: [
            { Identity: 'Serilog', DefiningProjectFullPath: project },
            { Identity: 'Polly', DefiningProjectFullPath: project },
            { Identity: 'Newtonsoft.Json', VersionOverride: '13.0.2', DefiningProjectFullPath: project },
            { Identity: 'Microsoft.SourceLink.GitHub', Version: '', DefiningProjectFullPath: nugetTargets },
            { Identity: 'NETStandard.Library', Version: '2.0.3', IsImplicitlyDefined: 'true', DefiningProjectFullPath: nugetTargets },
        ],
        PackageVersion: versions,
        GlobalPackageReference: globals,
    }), project)!;

    test('knows that the project uses CPM, and which Directory.Packages.props', () => {
        expect(packages.centrallyManaged).toBe(true);
        expect(packages.propsPath).toBe(props);
        expect(packages.overridesEnabled).toBe(true);
    });

    test('every reference gets its version and where it comes from, sorted by id, SDK references left out', () => {
        expect(packages.references).toEqual([
            { id: 'Microsoft.SourceLink.GitHub', version: '8.0.0', source: 'global', versionFile: props },
            { id: 'Newtonsoft.Json', version: '13.0.2', source: 'override', versionFile: project },
            { id: 'Polly', version: '8.1.0', source: 'central', versionFile: extra },
            { id: 'Serilog', version: '3.1.1', source: 'central', versionFile: props },
        ]);
    });

    test('central versions without the global one (its PackageVersion comes from NuGet.targets), and the globals', () => {
        expect([...packages.centralVersions.keys()]).toEqual(['newtonsoft.json', 'serilog', 'polly']);
        expect(packages.globals).toEqual([{ id: 'Microsoft.SourceLink.GitHub', version: '8.0.0', file: props }]);
    });

    test('a reference written in a props file (Directory.Build.props) is marked inherited; one of the project file is not', () => {
        const inherited = parseMsbuildPackages(output(cpm, {
            PackageReference: [
                { Identity: 'Serilog', DefiningProjectFullPath: at('Directory.Build.props') },
                { Identity: 'Polly', DefiningProjectFullPath: project },
                { Identity: 'Newtonsoft.Json', VersionOverride: '13.0.2', DefiningProjectFullPath: at('Directory.Build.props') },
            ],
            PackageVersion: versions,
        }), project)!;
        expect(inherited.references.map(reference => `${reference.id} ${reference.inherited ?? false}`))
            .toEqual(['Newtonsoft.Json true', 'Polly false', 'Serilog true']);
    });

    test('a multi-targeted project is marked: only the first target framework was evaluated', () => {
        expect(packages.multiTargeted).toBe(false);
        const multi = (TargetFrameworks: string) => parseMsbuildPackages(output({ ...cpm, TargetFramework: 'net8.0', TargetFrameworks }, {}), project)!.multiTargeted;
        expect(multi('net8.0;net48')).toBe(true);
        expect(multi(' net8.0 ; ')).toBe(false);
    });

    test('a CPM reference without a PackageVersion has no version (never "Unknown")', () => {
        const missing = parseMsbuildPackages(output(cpm, { PackageReference: [{ Identity: 'Nope', DefiningProjectFullPath: project }] }), project)!;
        expect(missing.references).toEqual([{ id: 'Nope', version: '', source: 'central', versionFile: undefined }]);
    });

    test('a project that turned CPM off keeps its own versions and ignores the central and global entries', () => {
        const legacy = parseMsbuildPackages(output({ ...cpm, ManagePackageVersionsCentrally: 'false' }, {
            PackageReference: [{ Identity: 'Polly', Version: '8.0.0', DefiningProjectFullPath: project }],
            PackageVersion: versions,
            GlobalPackageReference: globals,
        }), project)!;
        expect(legacy.centrallyManaged).toBe(false);
        expect(legacy.references).toEqual([{ id: 'Polly', version: '8.0.0', source: 'project', versionFile: project }]);
        expect(legacy.centralVersions.size).toBe(0);
        expect(legacy.globals).toEqual([]);
    });

    test('CentralPackageVersionOverrideEnabled false turns "Set for this project only" off', () => {
        expect(parseMsbuildPackages(output({ ...cpm, CentralPackageVersionOverrideEnabled: 'false' }, {}), project)!.overridesEnabled).toBe(false);
    });

    test('undefined without the CPM properties (an items-only output) or without JSON', () => {
        expect(parseMsbuildPackages(JSON.stringify({ Items: { Compile: [] } }), project)).toBeUndefined();
        expect(parseMsbuildPackages('error MSB1009', project)).toBeUndefined();
    });

    test('centralFiles lists Directory.Packages.props and every file defining an entry, once', () => {
        expect(centralFiles(packages).sort()).toEqual([props, extra].sort());
    });

    test('packagesEqual compares the content', () => {
        const again = parseMsbuildPackages(output(cpm, { PackageVersion: versions, GlobalPackageReference: globals }), project)!;
        const changed = parseMsbuildPackages(output(cpm, { PackageVersion: [{ ...versions[0], Version: '13.0.3' }], GlobalPackageReference: globals }), project)!;
        expect(packagesEqual(again, parseMsbuildPackages(output(cpm, { PackageVersion: versions, GlobalPackageReference: globals }), project)!)).toBe(true);
        expect(packagesEqual(again, changed)).toBe(false);
    });

    test('a new PackageVersion goes into Directory.Packages.props, or into the imported file that holds the versions', () => {
        expect(packageVersionFileFor(packages)).toBe(props);
        const onlyImported = parseMsbuildPackages(output(cpm, { PackageVersion: [versions[2]] }), project)!;
        expect(packageVersionFileFor(onlyImported)).toBe(extra);
        const none = parseMsbuildPackages(output(cpm, {}), project)!;
        expect(packageVersionFileFor(none)).toBe(props);
    });
});
