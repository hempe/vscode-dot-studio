import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

jest.mock('vscode', () => ({
    window: { createOutputChannel: () => ({ appendLine: () => { } }) },
}), { virtual: true });

import { createSolutionWithProject } from '../../../../services/templates/templateService';

const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? it : it.skip;
const consoleTemplate = { identity: 'Microsoft.Common.Console.CSharp', name: 'Console App', shortName: 'console', description: '', language: 'C#', type: 'project', tags: [], options: [] };

describe('createSolutionWithProject (Visual Studio\'s "Create a new project")', () => {
    let root: string;
    beforeEach(() => { root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'newsln-'))); });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    withDotnet('creates a .slnx with the project in its own folder', async () => {
        const result = await createSolutionWithProject(consoleTemplate, 'Shop.Cli', root, 'Shop', false, {});

        expect(result.error).toBeUndefined();
        expect(result.solutionPath).toBe(path.join(root, 'Shop', 'Shop.slnx'));
        expect(fs.existsSync(path.join(root, 'Shop', 'Shop.Cli', 'Shop.Cli.csproj'))).toBe(true);
        expect(fs.readFileSync(result.solutionPath!, 'utf8')).toContain('Shop.Cli/Shop.Cli.csproj');
    }, 120000);

    withDotnet('can put the solution next to the project', async () => {
        const result = await createSolutionWithProject(consoleTemplate, 'Tool', root, 'Tool', true, {});

        expect(result.solutionPath).toBe(path.join(root, 'Tool', 'Tool.slnx'));
        expect(fs.existsSync(path.join(root, 'Tool', 'Tool.csproj'))).toBe(true);
    }, 120000);

    withDotnet('a failing project step takes back the solution folder, so Create can be pressed again (review A6-1)', async () => {
        const failing = { ...consoleTemplate, options: [{ name: 'framework', type: 'choice', description: '', defaultValue: 'net10.0', choices: [{ value: 'net10.0', description: '' }] }] };
        const first = await createSolutionWithProject(failing as never, 'Shop.Cli', root, 'Shop', false, { framework: 'net99.0' });

        expect(first.error).toBeDefined();
        expect(fs.existsSync(path.join(root, 'Shop'))).toBe(false);

        const second = await createSolutionWithProject(consoleTemplate, 'Shop.Cli', root, 'Shop', false, {});
        expect(second.error).toBeUndefined();
        expect(fs.existsSync(path.join(root, 'Shop', 'Shop.Cli', 'Shop.Cli.csproj'))).toBe(true);
    }, 180000);

    it('refuses a folder that is not empty and invalid names', async () => {
        fs.mkdirSync(path.join(root, 'Shop'));
        fs.writeFileSync(path.join(root, 'Shop', 'x.txt'), '');
        expect((await createSolutionWithProject(consoleTemplate, 'Shop.Cli', root, 'Shop', false, {})).error).toMatch(/not empty/);
        expect((await createSolutionWithProject(consoleTemplate, '2Bad', root, 'Other', false, {})).error).toMatch(/not a valid project name/);
        expect((await createSolutionWithProject(consoleTemplate, 'Ok', root, 'Bad/Name', false, {})).error).toMatch(/not a valid solution name/);
    });
});
