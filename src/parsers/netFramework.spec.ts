import * as fs from 'fs';
import * as path from 'path';
import { SolutionFileParser } from './solutionFileParser';
import { createSolutionFileHandler } from '../handlers';
import { ProjectFileParser } from './projectFileParser';

const fixture = path.join(__dirname, '..', '__fixtures__', 'net-framework');

describe('SDK-style projects that target .NET Framework', () => {
    it('reads the target frameworks from a .sln', async () => {
        const solution = await SolutionFileParser.parse(fs.readFileSync(path.join(fixture, 'NetFramework.sln'), 'utf8'), fixture);
        expect(solution.projects.find(p => p.name === 'Legacy.App')?.targetFrameworks).toEqual(['net48']);
        expect(solution.projects.find(p => p.name === 'Multi.Lib')?.targetFrameworks).toEqual(['net48', 'net10.0']);
    });

    it('reads the target frameworks from a .slnx', async () => {
        const handler = createSolutionFileHandler(path.join(fixture, 'NetFramework.slnx'));
        const solution = await handler.parse(await handler.read());
        expect(solution.projects.find(p => p.name === 'Legacy.App')?.targetFrameworks).toEqual(['net48']);
        expect(solution.projects.find(p => p.name === 'Multi.Lib')?.targetFrameworks).toEqual(['net48', 'net10.0']);
    });

    it('lists the files and the package references of the project', async () => {
        const parsed = await new ProjectFileParser().parseProjectFiles(path.join(fixture, 'Legacy.App', 'Legacy.App.csproj'));
        expect(parsed.files.map(file => path.basename(file.path ?? String(file)))).toContain('Program.cs');
        expect(parsed.dependencies).toEqual([{ name: 'Newtonsoft.Json', version: '13.0.3', type: 'PackageReference' }]);
    });
});
