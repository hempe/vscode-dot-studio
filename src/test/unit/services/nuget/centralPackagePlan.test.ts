import * as path from 'path';
import { ProjectPackages, parseMsbuildPackages } from '../../../../services/nuget/centralPackages';
import { ProjectState, confirmationText, consolidationText, globalUninstallEdits, planConsolidate, planUninstall, planVersionChange } from '../../../../services/nuget/centralPackagePlan';

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
const state = (name: string, references: object[], options: { cpm?: boolean; globals?: boolean; overrides?: boolean; multi?: boolean } = {}): ProjectState => {
    const { cpm = true, globals = true, overrides = true, multi = false } = options;
    const globalReference = cpm && globals ? [{ Identity: global.Identity, Version: '', DefiningProjectFullPath: path.join(root, 'NuGet.targets') }] : [];
    const packages = parseMsbuildPackages(JSON.stringify({
        Properties: { ManagePackageVersionsCentrally: String(cpm), DirectoryPackagesPropsPath: props, CentralPackageVersionOverrideEnabled: overrides ? '' : 'false', TargetFrameworks: multi ? 'net8.0;net48' : '' },
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

    test('every project opted out of the global package: installing it takes the opt-out back, no PackageReference or PackageVersion', () => {
        const allOut = [app, override, globalOnly, optOut].map(project => state(project.name, [], { globals: false }));
        const written = [{ id: 'Microsoft.SourceLink.GitHub', version: '8.0.0', file: props }];
        expect(planVersionChange('Microsoft.SourceLink.GitHub', '8.0.0', [allOut[2].path], allOut, 'shared', () => written).edits)
            .toEqual([{ kind: 'removeGlobalOptOut', file: allOut[2].path, id: 'Microsoft.SourceLink.GitHub' }]);
        expect(planVersionChange('Microsoft.SourceLink.GitHub', '8.0.1', [allOut[2].path], allOut, 'shared', () => written).edits).toEqual([
            { kind: 'removeGlobalOptOut', file: allOut[2].path, id: 'Microsoft.SourceLink.GitHub' },
            { kind: 'setGlobalPackageVersion', file: props, id: 'Microsoft.SourceLink.GitHub', version: '8.0.1' },
        ]);
    });

    test('a PackageReference written in Directory.Build.props: no "Set for this project only" (no element of the project for a VersionOverride)', () => {
        const inherited = state('Inherited', [{ Identity: 'Serilog', DefiningProjectFullPath: path.join(root, 'Directory.Build.props') }]);
        const plan = planVersionChange('Serilog', '4.0.0', [inherited.path], [...states, inherited]);
        expect(plan.alsoChanges).toEqual(['App', 'OptOut']);
        expect(plan.canOverride).toBe(false);
        expect(planVersionChange('Serilog', '4.0.0', [app.path], [...states, inherited]).canOverride).toBe(true);
    });

    test('props file paths compare ignoring case on Windows and macOS', () => {
        const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
        Object.defineProperty(process, 'platform', { value: 'win32' });
        try {
            const upper = state('Upper', [{ Identity: 'Serilog' }]);
            const changed = { ...upper, packages: { ...upper.packages!, references: upper.packages!.references.map(reference => ({ ...reference, versionFile: reference.versionFile!.toUpperCase() })) } };
            expect(planVersionChange('Serilog', '4.0.0', [app.path], [app, changed]).alsoChanges).toEqual(['Upper']);
        } finally {
            Object.defineProperty(process, 'platform', platform);
        }
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

    test('no orphan reported while a project is multi-targeted (other frameworks unseen) or could not be evaluated', () => {
        const multi = state('Multi', [{ Identity: 'Newtonsoft.Json' }], { multi: true });
        expect(planUninstall('Polly', [app.path], [...states, multi]).orphanedVersions).toEqual([]);
        const unknown: ProjectState = { name: 'Unknown', path: csproj('Unknown') };
        expect(planUninstall('Polly', [app.path], [...states, unknown]).orphanedVersions).toEqual([]);
        expect(planUninstall('Polly', [app.path], [...states, unknown]).cliProjects).toEqual([app.path]);
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

describe('planConsolidate', () => {
    test('under CPM: the central version set once, the overrides removed', () => {
        const plan = planConsolidate('Newtonsoft.Json', '13.0.3', states);
        expect(plan.edits).toEqual([
            { kind: 'setPackageVersion', file: props, id: 'Newtonsoft.Json', version: '13.0.3' },
            { kind: 'removeVersionOverride', file: override.path, id: 'Newtonsoft.Json' },
        ]);
        expect(plan.changes).toEqual(['Directory.Packages.props: 13.0.1 → 13.0.3', 'Override: VersionOverride 13.0.2 removed']);
        expect(plan.cliProjects).toEqual([]);
    });

    test('to the central version: only the overrides go', () => {
        expect(planConsolidate('Newtonsoft.Json', '13.0.1', states).edits).toEqual([{ kind: 'removeVersionOverride', file: override.path, id: 'Newtonsoft.Json' }]);
    });

    test('a mixed solution: projects without CPM through the CLI, the central version in its imported file', () => {
        const plan = planConsolidate('Polly', '8.1.0', states);
        expect(plan.cliProjects).toEqual([legacy.path]);
        expect(plan.edits).toEqual([]);
        expect(planConsolidate('Polly', '8.2.0', states).edits).toEqual([{ kind: 'setPackageVersion', file: extra, id: 'Polly', version: '8.2.0' }]);
    });

    test('consolidationText lists what changes; nothing to confirm without CPM edits', () => {
        expect(consolidationText([planConsolidate('Newtonsoft.Json', '13.0.3', states)])).toEqual({
            message: 'Consolidate Newtonsoft.Json to 13.0.3?',
            detail: 'Newtonsoft.Json 13.0.3:\n  Directory.Packages.props: 13.0.1 → 13.0.3\n  Override: VersionOverride 13.0.2 removed',
        });
        expect(consolidationText([planConsolidate('Polly', '8.1.0', states)])).toBeUndefined();
    });
});
