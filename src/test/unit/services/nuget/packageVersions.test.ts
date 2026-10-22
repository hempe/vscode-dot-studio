import * as path from 'path';

jest.mock('vscode', () => ({}), { virtual: true });

const env = { projects: [] as any[] };
jest.mock('../../../../services/solutionService', () => ({
    SolutionService: {
        getActiveSolution: () => ({ isInitialized: true, solutionPath: 'Central.slnx', projects: new Map(env.projects.map(project => [project.projectPath, project])) }),
    },
}));

import { VersionUtils } from '../../../../services/versionUtils';
import { NuGetManagerService } from '../../../../services/nuget/nugetManagerService';
import { PackageInstalledService, withVersionSources } from '../../../../services/nuget/packageInstalledService';
import { ProjectPackages } from '../../../../services/nuget/centralPackages';

const props = path.resolve('/repo/Directory.Packages.props');
const appPath = path.resolve('/repo/App/App.csproj');
const project = (name: string, dependencies: object[]) => ({
    name,
    projectPath: path.resolve(`/repo/${name}/${name}.csproj`),
    frameworks: ['net8.0'],
    dependencies,
    evaluateItems: jest.fn().mockResolvedValue(undefined),
});

describe('VersionUtils.isOutdated', () => {
    test('an older known version is outdated, the same or a newer one is not', () => {
        expect(VersionUtils.isOutdated('13.0.1', '13.0.3')).toBe(true);
        expect(VersionUtils.isOutdated('13.0.3', '13.0.3')).toBe(false);
        expect(VersionUtils.isOutdated('14.0.0-beta', '13.0.3')).toBe(false);
        expect(VersionUtils.isOutdated('1.2.3.4', '1.2.3.10')).toBe(true);
    });

    test('an unknown version is never outdated', () => {
        expect(VersionUtils.isOutdated('', '13.0.3')).toBe(false);
        expect(VersionUtils.isOutdated('Unknown', '13.0.3')).toBe(false);
        expect(VersionUtils.isOutdated('13.0.1', undefined)).toBe(false);
    });

    test('a range counts as its lower bound', () => {
        expect(VersionUtils.isOutdated('[2.0.3, )', '2.0.4')).toBe(true);
        expect(VersionUtils.isOutdated('[2.0.3, )', '2.0.3')).toBe(false);
    });
});

describe('NuGet data of a solution with Central Package Management', () => {
    afterEach(() => jest.restoreAllMocks());

    test('versions and sources come from the evaluated dependencies, never "Unknown"', async () => {
        env.projects = [project('App', [
            { name: 'Serilog', version: '3.1.1', type: 'PackageReference', versionSource: 'central', versionFile: props },
            { name: 'Missing', type: 'PackageReference' },
            { name: 'Lib', type: 'ProjectReference' },
        ])];
        const [app] = await PackageInstalledService.getAllProjectsInfoFromActiveSolution();
        expect(env.projects[0].evaluateItems).toHaveBeenCalled();
        expect(app.packages).toEqual([
            { id: 'Serilog', currentVersion: '3.1.1', projectPath: env.projects[0].projectPath, projectName: 'App', versionSource: 'central', versionFile: props },
            { id: 'Missing', currentVersion: '', projectPath: env.projects[0].projectPath, projectName: 'App' },
        ]);
    });

    test('regression: the Updates list is empty when every package is current (it listed all CPM packages)', async () => {
        jest.spyOn(PackageInstalledService, 'getInstalledPackagesWithMetadata').mockResolvedValue([
            { id: 'Serilog', currentVersion: '3.1.1', projectPath: appPath, projectName: 'App', versionSource: 'central', versions: ['3.1.1', '3.0.0'] },
            { id: 'Unknown.Version', currentVersion: '', projectPath: appPath, projectName: 'App', versions: ['2.0.0'] },
            { id: 'Newer.Than.Stable', currentVersion: '2.0.0-rc.1', projectPath: appPath, projectName: 'App', versions: ['2.0.0-rc.1', '1.0.0'] },
        ]);
        expect(await NuGetManagerService.getGroupedOutdatedPackages(false, 'Central.slnx', false, [])).toEqual([]);
    });

    test('a central package with a newer version is listed once', async () => {
        jest.spyOn(PackageInstalledService, 'getInstalledPackagesWithMetadata').mockResolvedValue([
            { id: 'Serilog', currentVersion: '3.1.1', projectPath: appPath, projectName: 'App', versionSource: 'central', versions: ['4.0.0', '3.1.1'] },
            { id: 'Serilog', currentVersion: '3.1.1', projectPath: path.resolve('/repo/Web/Web.csproj'), projectName: 'Web', versionSource: 'central', versions: ['4.0.0', '3.1.1'] },
        ]);
        expect((await NuGetManagerService.getGroupedOutdatedPackages(false, 'Central.slnx', false, [])).map(pkg => pkg.id)).toEqual(['Serilog']);
    });

    test('Consolidate ignores unknown versions', () => {
        const info = { name: 'App', path: appPath, framework: 'net8.0', packages: [] };
        const flat = [
            { id: 'Serilog', currentVersion: '3.1.1', projectPath: appPath, projectName: 'App', projectInfo: info },
            { id: 'Serilog', currentVersion: '', projectPath: appPath, projectName: 'Web', projectInfo: { ...info, name: 'Web' } },
        ];
        expect(NuGetManagerService.getConsolidationDataFromFlatPackages(flat, false).consolidatePackages).toEqual([]);
    });
});

describe('withVersionSources (project context: dotnet list, marked from the evaluation)', () => {
    test('marks overrides and global packages by id, case-insensitively', () => {
        const evaluated = {
            references: [
                { id: 'Newtonsoft.Json', version: '13.0.2', source: 'override', versionFile: appPath },
                { id: 'Microsoft.SourceLink.GitHub', version: '8.0.0', source: 'global', versionFile: props },
            ],
        } as unknown as ProjectPackages;
        const listed = [
            { id: 'newtonsoft.json', currentVersion: '13.0.2', projectPath: appPath, projectName: 'App' },
            { id: 'Microsoft.SourceLink.GitHub', currentVersion: '8.0.0', projectPath: appPath, projectName: 'App' },
            { id: 'Other', currentVersion: '1.0.0', projectPath: appPath, projectName: 'App' },
        ];
        expect(withVersionSources(listed, evaluated).map(pkg => pkg.versionSource)).toEqual(['override', 'global', undefined]);
        expect(withVersionSources(listed, undefined)).toBe(listed);
    });
});
