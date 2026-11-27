import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { solutionForProject } from '../../../../services/solution/solutionForProject';

describe('the solution of a project file opened on its own (Visual Studio: its folder and the one above)', () => {
    let root: string;
    const write = (relative: string, text: string) => {
        const file = path.join(root, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
        return file;
    };
    const slnx = (...projects: string[]) => `<Solution>\n${projects.map(p => `  <Project Path="${p}" />`).join('\n')}\n</Solution>\n`;
    const sln = (...projects: string[]) => projects.map(p => `Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "X", "${p}", "{00000000-0000-0000-0000-000000000001}"\nEndProject`).join('\n');

    beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'sln-for-project-')); });

    it('finds a solution in the project\'s folder that contains it', async () => {
        const project = write('App/App.csproj', '<Project />');
        const solution = write('App/App.slnx', slnx('App.csproj'));
        expect(await solutionForProject(project)).toBe(solution);
    });

    it('finds one a folder up (.sln, backslashes)', async () => {
        const project = write('repo/App/App.csproj', '<Project />');
        const solution = write('repo/Repo.sln', sln('App\\App.csproj'));
        expect(await solutionForProject(project)).toBe(solution);
    });

    it('prefers the project\'s own folder over the one above', async () => {
        const project = write('repo/App/App.csproj', '<Project />');
        write('repo/Repo.slnx', slnx('App/App.csproj'));
        const own = write('repo/App/App.slnx', slnx('App.csproj'));
        expect(await solutionForProject(project)).toBe(own);
    });

    it('leaves out solutions that do not contain the project, and does not look two folders up', async () => {
        const project = write('repo/src/App/App.csproj', '<Project />');
        write('repo/src/Other.slnx', slnx('Lib/Lib.csproj'));
        write('repo/All.slnx', slnx('src/App/App.csproj'));
        expect(await solutionForProject(project)).toBeUndefined();
    });
});
