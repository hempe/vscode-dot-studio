import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyPackageEdits } from '../../../../services/nuget/centralPackageFiles';
import { ProjectState, globalUninstallEdits, planUninstall, planVersionChange } from '../../../../services/nuget/centralPackagePlan';
import { ProjectItemsService } from '../../../../services/projectItems/projectItemsService';

/** The plans and edits checked against real MSBuild: what each project uses afterwards, not just the text written */
const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip;
const TIMEOUT = 150000;
const fixture = path.resolve(__dirname, '../../../../__fixtures__/central-packages/cpm');
const NAMES = ['App', 'GlobalOnly', 'Legacy', 'OptOut', 'Override'];

describe('central package edits against real MSBuild', () => {
    let root: string;
    const csproj = (name: string) => path.join(root, name, `${name}.csproj`);

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-edits-')));
        fs.cpSync(fixture, root, { recursive: true });
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    /** Every project evaluated afresh (a new service: no cache) */
    const evaluate = async (): Promise<ProjectState[]> => {
        const service = new ProjectItemsService();
        return Promise.all(NAMES.map(async name => ({ name, path: csproj(name), packages: await service.evaluatePackages(csproj(name)) })));
    };
    const versionOf = (states: ProjectState[], name: string, id: string) => {
        const reference = states.find(state => state.name === name)?.packages?.references.find(candidate => candidate.id === id);
        return reference && `${reference.version} ${reference.source}`;
    };

    withDotnet('a central update changes every project that uses the version; "this project only" just one', async () => {
        let states = await evaluate();
        await applyPackageEdits(planVersionChange('Serilog', '4.0.0', [csproj('App')], states).edits);
        states = await evaluate();
        expect(versionOf(states, 'App', 'Serilog')).toBe('4.0.0 central');
        expect(versionOf(states, 'OptOut', 'Serilog')).toBe('4.0.0 central');

        await applyPackageEdits(planVersionChange('Serilog', '4.1.0', [csproj('App')], states, 'project').edits);
        states = await evaluate();
        expect(versionOf(states, 'App', 'Serilog')).toBe('4.1.0 override');
        expect(versionOf(states, 'OptOut', 'Serilog')).toBe('4.0.0 central');
    }, TIMEOUT);

    withDotnet('an override set back to the central version follows the central version again', async () => {
        let states = await evaluate();
        await applyPackageEdits(planVersionChange('Newtonsoft.Json', '13.0.1', [csproj('Override')], states).edits);
        states = await evaluate();
        expect(versionOf(states, 'Override', 'Newtonsoft.Json')).toBe('13.0.1 central');
        expect(fs.readFileSync(csproj('Override'), 'utf8')).not.toContain('VersionOverride');
    }, TIMEOUT);

    withDotnet('install: a new package gets a PackageVersion; one defined in the imported file is changed there', async () => {
        let states = await evaluate();
        await applyPackageEdits(planVersionChange('Humanizer.Core', '2.14.1', [csproj('GlobalOnly')], states).edits);
        await applyPackageEdits(planVersionChange('Polly', '8.2.0', [csproj('OptOut')], states).edits);
        states = await evaluate();
        expect(versionOf(states, 'GlobalOnly', 'Humanizer.Core')).toBe('2.14.1 central');
        expect(versionOf(states, 'OptOut', 'Polly')).toBe('8.2.0 central');
        expect(versionOf(states, 'App', 'Polly')).toBe('8.2.0 central');
        expect(fs.readFileSync(path.join(root, 'Packages.Extra.props'), 'utf8')).toContain('<PackageVersion Include="Polly" Version="8.2.0" />');
        expect(versionOf(states, 'Legacy', 'Polly')).toBe('8.0.0 project');
    }, TIMEOUT);

    withDotnet('a global package: update, opt out one project, then remove it for all', async () => {
        let states = await evaluate();
        await applyPackageEdits(planVersionChange('Microsoft.SourceLink.GitHub', '8.0.1', [csproj('App')], states).edits);
        states = await evaluate();
        expect(versionOf(states, 'GlobalOnly', 'Microsoft.SourceLink.GitHub')).toBe('8.0.1 global');

        await applyPackageEdits(globalUninstallEdits(planUninstall('Microsoft.SourceLink.GitHub', [csproj('App')], states), 'selected', states));
        states = await evaluate();
        expect(versionOf(states, 'App', 'Microsoft.SourceLink.GitHub')).toBeUndefined();
        expect(versionOf(states, 'Override', 'Microsoft.SourceLink.GitHub')).toBe('8.0.1 global');

        await applyPackageEdits(globalUninstallEdits(planUninstall('Microsoft.SourceLink.GitHub', [csproj('Override')], states), 'all', states));
        states = await evaluate();
        expect(states.every(state => !versionOf(states, state.name, 'Microsoft.SourceLink.GitHub'))).toBe(true);
        expect(fs.readFileSync(csproj('App'), 'utf8')).not.toContain('GlobalPackageReference');
        expect(fs.readFileSync(csproj('OptOut'), 'utf8')).not.toContain('GlobalPackageReference');
    }, TIMEOUT);

    withDotnet('installing the global package into the project that opted out brings it back', async () => {
        let states = await evaluate();
        await applyPackageEdits(planVersionChange('Microsoft.SourceLink.GitHub', '8.0.0', [csproj('OptOut')], states).edits);
        states = await evaluate();
        expect(versionOf(states, 'OptOut', 'Microsoft.SourceLink.GitHub')).toBe('8.0.0 global');
    }, TIMEOUT);
});
