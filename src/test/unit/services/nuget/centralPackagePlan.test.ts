import * as path from 'path';
import { ProjectPackages, parseMsbuildPackages } from '../../../../services/nuget/centralPackages';
import { ProjectState, confirmationText, globalUninstallEdits, planUninstall, planVersionChange } from '../../../../services/nuget/centralPackagePlan';

const root = path.resolve('/repo');
const props = path.join(root, 'Directory.Packages.props');
const extra = path.join(root, 'Packages.Extra.props');
const csproj = (name: string) => path.join(root, name, `${name}.csproj`);
const versions = [
    { Identity: 'Newtonsoft.Json', Version: '13.0.1', DefiningProjectFullPath: props },
    { Identity: 'Serilog', Version: '3.1.1', DefiningProjectFullPath: props },
    { Identity: 'Polly', Version: '8.1.0', DefiningProjectFullPath: extra },
];
const global = { Identity: 'Microsoft.SourceLink.GitHub', Version: '8.0.0', DefiningProjectFullPath: props };

/** A project as MSBuild evaluates it in the fixture layout (`src/__fixtures__/central-packages/cpm`) */
const state = (name: string, references: object[], options: { cpm?: boolean; globals?: boolean; overrides?: boolean } = {}): ProjectState => {
    const { cpm = true, globals = true, overrides = true } = options;
    const globalReference = cpm && globals ? [{ Identity: global.Identity, Version: '', DefiningProjectFullPath: path.join(root, 'NuGet.targets') }] : [];
    const packages = parseMsbuildPackages(JSON.stringify({
        Properties: { ManagePackageVersionsCentrally: String(cpm), DirectoryPackagesPropsPath: props, CentralPackageVersionOverrideEnabled: overrides ? '' : 'false' },
        Items: {
            PackageReference: [...references.map(reference => ({ DefiningProjectFullPath: csproj(name), ...reference })), ...globalReference],
            PackageVersion: versions,
            GlobalPackageReference: globals ? [global] : [],
        },
    }), csproj(name)) as ProjectPackages;
    return { name, path: csproj(name), packages };
};

const app = state('App', [{ Identity: 'Newtonsoft.Json' }, { Identity: 'Serilog' }, { Identity: 'Polly' }]);
const override = state('Override', [{ Identity: 'Newtonsoft.Json', VersionOverride: '13.0.2' }]);
const globalOnly = state('GlobalOnly', []);
const optOut = state('OptOut', [{ Identity: 'Serilog' }], { globals: false });
const legacy = state('Legacy', [{ Identity: 'Polly', Version: '8.0.0' }], { cpm: false });
const states = [app, override, globalOnly, optOut, legacy];

describe('planVersionChange', () => {
    test('a new central version for one project: one edit in the props file, the other users named', () => {
        const plan = planVersionChange('Serilog', '4.0.0', [app.path], states);
        expect(plan.edits).toEqual([{ kind: 'setPackageVersion', file: props, id: 'Serilog', version: '4.0.0' }]);
        expect(plan.alsoChanges).toEqual(['OptOut']);
        expect(plan.canOverride).toBe(true);
        expect(plan.cliProjects).toEqual([]);
    });

    test('all users selected (solution context): one edit, nobody else to name', () => {
        const plan = planVersionChange('Serilog', '4.0.0', [app.path, optOut.path], states);
        expect(plan.edits).toHaveLength(1);
        expect(plan.alsoChanges).toEqual([]);
        expect(confirmationText([plan])).toBeUndefined();
    });

    test('the version is edited in the imported props file that defines it', () => {
        expect(planVersionChange('Polly', '8.2.0', [app.path], states).edits).toEqual([{ kind: 'setPackageVersion', file: extra, id: 'Polly', version: '8.2.0' }]);
    });

    test('"Set for this project only" writes a VersionOverride instead', () => {
        const plan = planVersionChange('Serilog', '4.0.0', [app.path], states, 'project');
        expect(plan.edits).toEqual([{ kind: 'setVersionOverride', file: app.path, id: 'Serilog', version: '4.0.0' }]);
        expect(plan.alsoChanges).toEqual([]);
    });

    test('an override is changed in its project; set to the central version it goes away', () => {
        expect(planVersionChange('Newtonsoft.Json', '13.0.3', [override.path], states).edits)
            .toEqual([{ kind: 'setVersionOverride', file: override.path, id: 'Newtonsoft.Json', version: '13.0.3' }]);
        expect(planVersionChange('Newtonsoft.Json', '13.0.1', [override.path], states).edits)
            .toEqual([{ kind: 'removeVersionOverride', file: override.path, id: 'Newtonsoft.Json' }]);
    });

    test('install of a package without a central version: PackageReference without Version plus a PackageVersion', () => {
        expect(planVersionChange('Humanizer.Core', '2.14.1', [globalOnly.path, optOut.path], states).edits).toEqual([
            { kind: 'addPackageReference', file: globalOnly.path, id: 'Humanizer.Core' },
            { kind: 'addPackageVersion', file: props, id: 'Humanizer.Core', version: '2.14.1' },
            { kind: 'addPackageReference', file: optOut.path, id: 'Humanizer.Core' },
        ]);
    });

    test('install of a package that has a central version in another version: the version-change rule', () => {
        const plan = planVersionChange('Polly', '8.2.0', [globalOnly.path], states);
        expect(plan.edits).toEqual([
            { kind: 'addPackageReference', file: globalOnly.path, id: 'Polly' },
            { kind: 'setPackageVersion', file: extra, id: 'Polly', version: '8.2.0' },
        ]);
        expect(plan.alsoChanges).toEqual(['App']);
    });

    test('a global package: its version in the props file, every project that gets it is named, no override', () => {
        const plan = planVersionChange('Microsoft.SourceLink.GitHub', '8.0.1', [app.path], states);
        expect(plan.edits).toEqual([{ kind: 'setGlobalPackageVersion', file: props, id: 'Microsoft.SourceLink.GitHub', version: '8.0.1' }]);
        expect(plan.alsoChanges).toEqual(['GlobalOnly', 'Override']);
        expect(plan.canOverride).toBe(false);
    });

    test('installing a global package into a project that opted out takes the opt-out back', () => {
        expect(planVersionChange('Microsoft.SourceLink.GitHub', '8.0.0', [optOut.path], states).edits)
            .toEqual([{ kind: 'removeGlobalOptOut', file: optOut.path, id: 'Microsoft.SourceLink.GitHub' }]);
    });

    test('projects without CPM, or not evaluated, go through the CLI', () => {
        const unknown: ProjectState = { name: 'Unknown', path: csproj('Unknown') };
        expect(planVersionChange('Polly', '8.2.0', [legacy.path, unknown.path], [...states, unknown]).cliProjects).toEqual([legacy.path, unknown.path]);
    });

    test('with CentralPackageVersionOverrideEnabled false there is no "Set for this project only"', () => {
        const strict = state('Strict', [{ Identity: 'Serilog' }], { overrides: false });
        expect(planVersionChange('Serilog', '4.0.0', [strict.path], [...states, strict]).canOverride).toBe(false);
        expect(planVersionChange('Serilog', '4.0.0', [strict.path], [...states, strict], 'project').edits[0].kind).toBe('setPackageVersion');
    });
});

describe('confirmationText', () => {
    test('one package', () => {
        expect(confirmationText([planVersionChange('Serilog', '4.0.0', [app.path], states)])).toEqual({
            message: 'Change Serilog to 4.0.0 for every project that uses it?',
            detail: 'The version is set centrally in Directory.Packages.props, so it also changes for OptOut.',
        });
    });

    test('a bulk update: one confirmation listing each package that reaches other projects', () => {
        const text = confirmationText([
            planVersionChange('Serilog', '4.0.0', [app.path], states),
            planVersionChange('Microsoft.SourceLink.GitHub', '8.0.1', [app.path], states),
            planVersionChange('Newtonsoft.Json', '13.0.3', [override.path], states),
        ])!;
        expect(text.message).toBe('Change the central versions of 2 packages?');
        expect(text.detail.split('\n')).toEqual([
            'They are set centrally, so other projects change too:',
            'Serilog 4.0.0 (Directory.Packages.props): also OptOut',
            'Microsoft.SourceLink.GitHub 8.0.1 (Directory.Packages.props): also GlobalOnly, Override',
        ]);
    });
});

describe('planUninstall', () => {
    test('a normal reference goes through the CLI; a central version nobody uses any more is reported', () => {
        expect(planUninstall('Polly', [app.path], states)).toEqual({
            id: 'Polly', cliProjects: [app.path], orphanedVersions: [{ file: extra, id: 'Polly' }],
        });
        expect(planUninstall('Serilog', [app.path], states).orphanedVersions).toEqual([]);
        expect(planUninstall('Serilog', [app.path, optOut.path], states).orphanedVersions).toEqual([{ file: props, id: 'Serilog' }]);
    });

    test('an override still uses the central version', () => {
        expect(planUninstall('Newtonsoft.Json', [app.path], states).orphanedVersions).toEqual([]);
    });

    test('a global package names every project that gets it; "all" removes it and stale opt-outs, "selected" opts out', () => {
        const plan = planUninstall('Microsoft.SourceLink.GitHub', [app.path], states);
        expect(plan.cliProjects).toEqual([]);
        expect(plan.global).toEqual({ file: props, selected: [app.path], appliesTo: ['App', 'GlobalOnly', 'Override'] });
        expect(globalUninstallEdits(plan, 'selected', states)).toEqual([{ kind: 'addGlobalOptOut', file: app.path, id: 'Microsoft.SourceLink.GitHub' }]);
        expect(globalUninstallEdits(plan, 'all', states)).toEqual([
            { kind: 'removeGlobalPackageReference', file: props, id: 'Microsoft.SourceLink.GitHub' },
            ...[app, override, globalOnly, optOut].map(project => ({ kind: 'removeGlobalOptOut', file: project.path, id: 'Microsoft.SourceLink.GitHub' })),
        ]);
    });
});
