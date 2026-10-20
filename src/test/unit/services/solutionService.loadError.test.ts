// Loading an invalid solution reports why, once, instead of silently showing an empty tree
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ui = {
    errors: [] as string[],
    folder: '',
};

jest.mock('vscode', () => {
    const disposable = { dispose: () => { } };
    const watcher = { onDidChange: () => disposable, onDidCreate: () => disposable, onDidDelete: () => disposable, dispose: () => { } };
    class EventEmitter { event = () => disposable; fire() { } dispose() { } }
    return {
        EventEmitter,
        RelativePattern: class { constructor(public base: string, public pattern: string) { } },
        workspace: {
            createFileSystemWatcher: () => watcher,
            get workspaceFolders() { return ui.folder ? [{ uri: { fsPath: ui.folder } }] : undefined; },
            getConfiguration: () => ({ get: () => undefined }),
        },
        window: {
            showErrorMessage: async (message: string) => { ui.errors.push(message); },
            showWarningMessage: async () => undefined,
        },
    };
}, { virtual: true });

import { SolutionService } from '../../../services/solutionService';
import { SolutionDiscovery } from '../../../services/solutionDiscovery';

describe('SolutionService.discoverAndInitializeSolution with an invalid .slnx', () => {
    let dir: string;
    let slnxPath: string;

    beforeEach(() => {
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'solution-load-')));
        slnxPath = path.join(dir, 'Test.slnx');
        ui.errors = [];
        jest.spyOn(SolutionDiscovery, 'discoverAndSelectSolution').mockResolvedValue(slnxPath);
    });

    afterEach(() => {
        SolutionService.dispose();
        jest.restoreAllMocks();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('shows the reason once and loads the solution once it is fixed', async () => {
        fs.writeFileSync(slnxPath, '<Solution><Folder Name="Solution Items" /></Solution>');

        expect(await (ui.folder = dir, SolutionService.discoverAndInitializeSolution())).toBeNull();
        expect(await (ui.folder = dir, SolutionService.discoverAndInitializeSolution())).toBeNull();

        expect(ui.errors).toEqual([
            "Could not load Test.slnx: Invalid .slnx file: Solution folder name 'Solution Items' must start and end with '/'"
        ]);

        fs.writeFileSync(slnxPath, '<Solution><Folder Name="/Solution Items/" /></Solution>');

        const solution = await (ui.folder = dir, SolutionService.discoverAndInitializeSolution());
        expect(solution?.isInitialized).toBe(true);
        expect(SolutionService.getActiveSolution()).toBe(solution);
        expect(ui.errors).toHaveLength(1);
    });
});
