import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ui = { picks: 0 };
jest.mock('vscode', () => ({
    window: {
        showQuickPick: async (items: any[]) => { ui.picks++; return items[1]; },
    },
}), { virtual: true });

import { SolutionDiscovery } from '../../../services/solutionDiscovery';

describe('SolutionDiscovery.findSolutionFiles', () => {
    let root: string;
    const touch = (relative: string) => {
        const file = path.join(root, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '');
        return file;
    };

    beforeEach(() => { root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-'))); });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('finds a solution in the opened folder', async () => {
        const app = touch('App.slnx');
        touch('src/Other.sln');
        expect(await SolutionDiscovery.findSolutionFiles(root)).toEqual([app]);
    });

    it('offers all solutions of the opened folder', async () => {
        const a = touch('A.sln');
        const b = touch('B.slnx');
        expect(await SolutionDiscovery.findSolutionFiles(root)).toEqual([a, b]);
    });

    it('looks in subfolders when the opened folder has none (src/App.sln), shallow ones first', async () => {
        const deep = touch('samples/demo/Demo.sln');
        const src = touch('src/App.sln');
        touch('node_modules/pkg/Wrong.sln');
        touch('src/App/bin/Debug/Copied.sln');
        touch('.git/Weird.sln');
        touch('a/b/c/d/TooDeep.sln');

        expect(await SolutionDiscovery.findSolutionFiles(root)).toEqual([src, deep]);
    });

    it('finds nothing in a folder without solutions', async () => {
        touch('README.md');
        expect(await SolutionDiscovery.findSolutionFiles(root)).toEqual([]);
        expect(await SolutionDiscovery.findSolutionFiles(path.join(root, 'missing'))).toEqual([]);
    });
});

describe('SolutionDiscovery.discoverAndSelectSolution', () => {
    let root: string;
    const state = new Map<string, unknown>();
    const touch = (relative: string) => {
        const file = path.join(root, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '');
        return file;
    };

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-')));
        state.clear();
        ui.picks = 0;
        SolutionDiscovery.initialize({ get: (key: string) => state.get(key), update: async (key: string, value: unknown) => { state.set(key, value); } } as any);
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('asks once which of several solutions to open, then remembers it', async () => {
        touch('src/A.sln');
        const b = touch('src/B.slnx');

        expect(await SolutionDiscovery.discoverAndSelectSolution(root)).toBe(b);
        expect(await SolutionDiscovery.discoverAndSelectSolution(root)).toBe(b);
        expect(ui.picks).toBe(1);
    });

    it('opens the solution chosen with Open Solution, even outside the search, while it exists', async () => {
        touch('App.sln');
        const elsewhere = touch('deep/a/b/c/d/Other.slnx');
        await SolutionDiscovery.remember(elsewhere);

        expect(await SolutionDiscovery.discoverAndSelectSolution(root)).toBe(elsewhere);
        fs.rmSync(elsewhere);
        expect(await SolutionDiscovery.discoverAndSelectSolution(root)).toBe(path.join(root, 'App.sln'));
    });

    it('looks in every folder of a multi-root workspace', async () => {
        const second = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-')));
        try {
            touch('src/Web.slnx');
            const api = path.join(second, 'Api.sln');
            fs.writeFileSync(api, '');

            expect(await SolutionDiscovery.discoverAndSelectSolution([root, second])).toBe(api);
            expect(ui.picks).toBe(1);
        } finally {
            fs.rmSync(second, { recursive: true, force: true });
        }
    });
});

