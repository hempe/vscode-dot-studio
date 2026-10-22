import { spawnSync } from 'child_process';
import * as path from 'path';
import { ProjectItemsService } from '../../../../services/projectItems/projectItemsService';

/** The packages of the fixture as real MSBuild evaluates them (no restore, no network) */
const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip;
const TIMEOUT = 150000;

const fixture = path.resolve(__dirname, '../../../../__fixtures__/central-packages');
const cpm = (...parts: string[]) => path.join(fixture, 'cpm', ...parts);
const props = cpm('Directory.Packages.props');
const sources = async (project: string) => {
    const packages = await new ProjectItemsService().evaluatePackages(project);
    if (!packages) {
        throw new Error(`MSBuild could not evaluate ${project}`);
    }
    return packages.references.map(reference => `${reference.id} ${reference.version} ${reference.source} ${path.basename(reference.versionFile ?? '-')}`);
};

describe('Central Package Management against real MSBuild', () => {
    withDotnet('central versions, an imported props file and the global reference', async () => {
        expect(await sources(cpm('App', 'App.csproj'))).toEqual([
            'Microsoft.SourceLink.GitHub 8.0.0 global Directory.Packages.props',
            'Newtonsoft.Json 13.0.1 central Directory.Packages.props',
            'Polly 8.1.0 central Packages.Extra.props',
            'Serilog 3.1.1 central Directory.Packages.props',
        ]);
    }, TIMEOUT);

    withDotnet('a VersionOverride, a project with only the global reference, and an opt-out', async () => {
        expect(await sources(cpm('Override', 'Override.csproj'))).toEqual([
            'Microsoft.SourceLink.GitHub 8.0.0 global Directory.Packages.props',
            'Newtonsoft.Json 13.0.2 override Override.csproj',
        ]);
        expect(await sources(cpm('GlobalOnly', 'GlobalOnly.csproj'))).toEqual(['Microsoft.SourceLink.GitHub 8.0.0 global Directory.Packages.props']);
        expect(await sources(cpm('OptOut', 'OptOut.csproj'))).toEqual(['Serilog 3.1.1 central Directory.Packages.props']);
    }, TIMEOUT);

    withDotnet('a project that turned CPM off, and a solution without CPM', async () => {
        const legacy = await new ProjectItemsService().evaluatePackages(cpm('Legacy', 'Legacy.csproj'));
        expect(legacy?.centrallyManaged).toBe(false);
        expect(legacy?.propsPath).toBe(props);
        expect(await sources(cpm('Legacy', 'Legacy.csproj'))).toEqual(['Polly 8.0.0 project Legacy.csproj']);
        expect(await sources(path.join(fixture, 'plain', 'Plain', 'Plain.csproj'))).toEqual(['Newtonsoft.Json 13.0.3 project Plain.csproj']);
    }, TIMEOUT);

    withDotnet('the item list of the same evaluation has no package entries', async () => {
        const service = new ProjectItemsService();
        const items = await service.evaluate(cpm('App', 'App.csproj'));
        expect(items?.isIncluded(cpm('App', 'Serilog'))).toBe(false);
        expect(service.packages(cpm('App', 'App.csproj'))?.centrallyManaged).toBe(true);
    }, TIMEOUT);
});
