jest.mock('vscode', () => ({ workspace: { workspaceFolders: [] } }), { virtual: true });
jest.mock('../../../../services/solution/solutionService', () => ({ SolutionService: { getActiveSolution: () => undefined } }));
jest.mock('../../../../services/nuget/dotnetCli', () => ({ execDotnet: jest.fn() }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execDotnet } from '../../../../services/nuget/dotnetCli';
import { PackageInstalledService } from '../../../../services/nuget/packageInstalledService';

describe('one dotnet list package answers the callers that ask for a project in a row (review A4-16)', () => {
    let dir: string;
    let project: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'list-share-'));
        project = path.join(dir, 'App.csproj');
        fs.writeFileSync(project, '<Project />');
        (execDotnet as jest.Mock).mockReset().mockResolvedValue({ stdout: JSON.stringify({ projects: [] }), stderr: '' });
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('runs it once for concurrent and quick repeated asks', async () => {
        await Promise.all([PackageInstalledService.getProjectPackages(project), PackageInstalledService.getProjectPackages(project)]);
        await PackageInstalledService.getProjectPackages(project);
        expect(execDotnet).toHaveBeenCalledTimes(1);
    });

    it('runs it again once the project or its restore result changed', async () => {
        await PackageInstalledService.getProjectPackages(project);
        const later = (Date.now() + 60000) / 1000;
        fs.utimesSync(project, later, later);
        await PackageInstalledService.getProjectPackages(project);
        expect(execDotnet).toHaveBeenCalledTimes(2);
    });
});
