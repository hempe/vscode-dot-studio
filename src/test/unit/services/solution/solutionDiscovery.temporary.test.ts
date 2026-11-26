// Folders and files without a solution: what the Solution Explorer opens
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ui = { offered: 0 };
jest.mock('vscode', () => ({
    window: {
        showQuickPick: async () => undefined,
        showInformationMessage: async () => { ui.offered++; return undefined; },
    },
    commands: { executeCommand: async () => undefined },
}), { virtual: true });

import { SolutionDiscovery } from '../../../../services/solution/solutionDiscovery';
import { recordPendingOpen } from '../../../../services/solution/pendingOpen';

class Memento {
    private values = new Map<string, unknown>();
    get<T>(key: string): T | undefined { return this.values.get(key) as T | undefined; }
    async update(key: string, value: unknown) { this.values.set(key, value); }
}

describe('SolutionDiscovery.discover', () => {
    let root: string;
    let globalState: Memento;
    const touch = (relative: string) => {
        const file = path.join(root, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '<Project />');
        return file;
    };

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-'));
        globalState = new Memento();
        SolutionDiscovery.initialize(new Memento() as never, globalState as never);
        ui.offered = 0;
    });

    it('a folder with projects and no solution gives them all as a temporary solution', async () => {
        const a = touch('src/A/A.csproj');
        const b = touch('src/B/B.fsproj');
        expect(await SolutionDiscovery.discover([root])).toEqual({ kind: 'temporary', key: root, name: path.basename(root), projects: [a, b] });
        expect(ui.offered).toBe(0);
    });

    it('a pending project file gives exactly that project, even next to others', async () => {
        const a = touch('src/A/A.csproj');
        touch('src/B/B.csproj');
        await recordPendingOpen(globalState, root, a);
        expect(await SolutionDiscovery.discover([root])).toEqual({ kind: 'temporary', key: a, name: 'A', projects: [a] });
    });

    it('a pending solution file is opened as it is, also when there are others', async () => {
        const one = touch('One.slnx');
        touch('Two.slnx');
        await recordPendingOpen(globalState, root, one);
        expect(await SolutionDiscovery.discover([root])).toEqual({ kind: 'solution', solutionPath: one });
    });

    it('a folder with a solution opens that solution', async () => {
        const sln = touch('App.sln');
        touch('src/A/A.csproj');
        expect(await SolutionDiscovery.discover([root])).toEqual({ kind: 'solution', solutionPath: sln });
    });

    it('a folder without projects still offers Open Solution and Create New Project', async () => {
        touch('readme.txt');
        expect(await SolutionDiscovery.discover([root])).toBeNull();
        expect(ui.offered).toBe(1);
    });
});
