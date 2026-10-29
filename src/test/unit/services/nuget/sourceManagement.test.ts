jest.mock('vscode', () => ({ workspace: { workspaceFolders: [] }, window: {}, commands: {}, env: {} }), { virtual: true });
jest.mock('../../../../services/solution/solutionService', () => ({ SolutionService: { getActiveSolution: () => undefined } }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { addSource, addSourceArgs, definingFile, enableSourceArgs, removeSourceArgs, sourceProblem } from '../../../../services/nuget/sourceManagement';

const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? it : it.skip;

describe('definingFile', () => {
    const solution = { path: '/repo/nuget.config', content: '<configuration><packageSources><add key="Company Feed" value="https://c/index.json" /></packageSources></configuration>' };
    const user = { path: '/home/u/.nuget/NuGet/NuGet.Config', content: `<configuration><packageSources>
        <!-- <add key="Old" value="x" /> -->
        <add key='nuget.org' value="https://api.nuget.org/v3/index.json" />
    </packageSources><disabledPackageSources><add key="Company Feed" value="true" /></disabledPackageSources></configuration>` };

    it('finds the closest file that adds the source, case-insensitively, ignoring comments and the disabled list', () => {
        expect(definingFile([solution, user], 'company feed')).toBe('/repo/nuget.config');
        expect(definingFile([solution, user], 'NuGet.org')).toBe('/home/u/.nuget/NuGet/NuGet.Config');
        expect(definingFile([solution, user], 'Old')).toBeUndefined();
        expect(definingFile([], 'x')).toBeUndefined();
    });
});

describe('source management', () => {
    it('refuses empty, duplicate and unusable sources', () => {
        expect(sourceProblem('', 'https://x/index.json', [])).toBe('Enter a name');
        expect(sourceProblem('Feed', '', [])).toMatch(/^Enter the address/);
        expect(sourceProblem('feed', 'https://x/index.json', ['Feed'])).toBe('A source named feed exists');
        expect(sourceProblem('Feed', 'ftp://x', [])).toMatch(/^Use an https/);
        expect(sourceProblem('Feed', 'https://x/index.json', [])).toBeUndefined();
        expect(sourceProblem('Local', path.resolve('/srv/packages'), [])).toBeUndefined();
    });

    it('builds the dotnet nuget commands', () => {
        expect(addSourceArgs(' Feed ', ' https://x/index.json ', '/repo/nuget.config')).toEqual(['nuget', 'add', 'source', 'https://x/index.json', '--name', 'Feed', '--configfile', '/repo/nuget.config']);
        expect(addSourceArgs('Feed', 'https://x/index.json')).toEqual(['nuget', 'add', 'source', 'https://x/index.json', '--name', 'Feed']);
        expect(removeSourceArgs('Feed', '/repo/nuget.config')).toEqual(['nuget', 'remove', 'source', 'Feed', '--configfile', '/repo/nuget.config']);
        expect(enableSourceArgs('Feed', false)).toEqual(['nuget', 'disable', 'source', 'Feed']);
        expect(enableSourceArgs('Feed', true)).toEqual(['nuget', 'enable', 'source', 'Feed']);
    });

    withDotnet('adds a source to a nuget.config next to the solution, creating the file', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuget-sources-'));
        try {
            await addSource('Company Feed', 'https://pkgs.example.org/v3/index.json', 'solution', dir);
            const written = fs.readFileSync(path.join(dir, 'nuget.config'), 'utf8');
            expect(written).toContain('<add key="Company Feed" value="https://pkgs.example.org/v3/index.json" />');
            await expect(addSource('Company Feed', 'https://other.example.org/index.json', 'solution', dir)).rejects.toThrow();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }, 60000);
});
