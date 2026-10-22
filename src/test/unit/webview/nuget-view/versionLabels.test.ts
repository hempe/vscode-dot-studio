import { canSetForProjectOnly, centralNote, isGlobal, versionLabel } from '../../../../webview/nuget-view/versionLabels';

const entry = (project: string, id: string, currentVersion: string, versionSource?: string, versionFile = '/repo/Directory.Packages.props') =>
    ({ id, currentVersion, versionSource, versionFile, projectPath: `/repo/${project}.csproj`, projectName: project });
const project = (name: string, ...packages: object[]) => ({ name, path: `/repo/${name}.csproj`, framework: 'net8.0', packages });

const app = project('App', entry('App', 'Serilog', '3.1.1', 'central'), entry('App', 'SourceLink', '8.0.0', 'global'));
const web = project('Web', entry('Web', 'Serilog', '3.1.1', 'central'));
const override = project('Override', entry('Override', 'Serilog', '4.0.0', 'override', '/repo/Override.csproj'));
const legacy = project('Legacy', entry('Legacy', 'Polly', '8.0.0', 'project'));
const all = [app, web, override, legacy] as any[];

describe('versionLabel', () => {
    test('version with its source; unknown said plainly', () => {
        expect(versionLabel({ currentVersion: '3.1.1', versionSource: 'central' })).toBe('v3.1.1');
        expect(versionLabel({ currentVersion: '13.0.2', versionSource: 'override' })).toBe('v13.0.2 (override)');
        expect(versionLabel({ currentVersion: '8.0.0', versionSource: 'global' })).toBe('v8.0.0 (global)');
        expect(versionLabel({ currentVersion: '' })).toBe('version not known');
    });
});

describe('centralNote', () => {
    test('a central version names its file and, in the solution, the projects using it; overrides are named', () => {
        expect(centralNote({ id: 'Serilog', currentVersion: '3.1.1' }, all)).toBe(
            'Version set centrally in Directory.Packages.props, used by App, Web. A new version changes it for every project that uses it '
            + '(you are asked first); Set for This Project Only writes a VersionOverride instead. Override sets its own version (VersionOverride).');
    });

    test('a global package', () => {
        expect(centralNote({ id: 'SourceLink', currentVersion: '8.0.0' }, all)).toContain('Global package (GlobalPackageReference in Directory.Packages.props)');
        expect(isGlobal({ id: 'SourceLink', currentVersion: '8.0.0' }, all)).toBe(true);
        expect(isGlobal({ id: 'Serilog', currentVersion: '3.1.1' }, all)).toBe(false);
    });

    test('nothing without CPM; the project context does not claim to know the other projects', () => {
        expect(centralNote({ id: 'Polly', currentVersion: '8.0.0' }, all)).toBeUndefined();
        expect(centralNote({ id: 'Serilog', currentVersion: '3.1.1' }, [app] as any[])).toMatch(/^Version set centrally in Directory\.Packages\.props\. A new version/);
    });
});

describe('canSetForProjectOnly', () => {
    test('only when every selected project takes the version from a central entry (or overrides it)', () => {
        expect(canSetForProjectOnly({ id: 'Serilog', currentVersion: '3.1.1' }, all, new Set([app.path]))).toBe(true);
        expect(canSetForProjectOnly({ id: 'Serilog', currentVersion: '3.1.1' }, all, new Set([app.path, override.path]))).toBe(true);
        expect(canSetForProjectOnly({ id: 'Serilog', currentVersion: '3.1.1' }, all, new Set([app.path, legacy.path]))).toBe(false);
        expect(canSetForProjectOnly({ id: 'SourceLink', currentVersion: '8.0.0' }, all, new Set([app.path]))).toBe(false);
        expect(canSetForProjectOnly({ id: 'Polly', currentVersion: '8.0.0' }, all, new Set([legacy.path]))).toBe(false);
        expect(canSetForProjectOnly({ id: 'Serilog', currentVersion: '3.1.1' }, all, new Set())).toBe(false);
    });
});
