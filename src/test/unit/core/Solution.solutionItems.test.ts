// Solution items written by Visual Studio use backslashes (review A1-03)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => {
    const disposable = { dispose: () => { } };
    class EventEmitter<T> {
        private listeners: Array<(value: T) => void> = [];
        event = (listener: (value: T) => void) => { this.listeners.push(listener); return disposable; };
        fire(value?: T) { this.listeners.forEach(listener => listener(value as T)); }
        dispose() { this.listeners = []; }
    }
    return {
        EventEmitter,
        RelativePattern: class { constructor(public base: string, public pattern: string) { } },
        Uri: { file: (p: string) => ({ fsPath: p }) },
        workspace: {
            createFileSystemWatcher: () => ({ onDidChange: () => disposable, onDidCreate: () => disposable, onDidDelete: () => disposable, dispose: () => { } }),
            workspaceFolders: undefined,
            getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
        },
        window: { showWarningMessage: async () => undefined },
        commands: { executeCommand: async () => undefined },
    };
}, { virtual: true });

jest.mock('../../../core/constants', () => ({
    ...jest.requireActual('../../../core/constants'),
    isSystemPath: () => false,
}));

import { Solution } from '../../../core/Solution';
import { ProjectItemsService } from '../../../services/projectItems/projectItemsService';

beforeEach(() => { jest.spyOn(ProjectItemsService.instance, 'evaluate').mockResolvedValue(undefined); });
afterEach(() => jest.restoreAllMocks());


const SLN = [
    '',
    'Microsoft Visual Studio Solution File, Format Version 12.00',
    'Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Docs", "Docs", "{11111111-1111-1111-1111-111111111111}"',
    '\tProjectSection(SolutionItems) = preProject',
    '\t\tdocs\\readme.md = docs\\readme.md',
    '\t\tNOTICE.txt = NOTICE.txt',
    '\tEndProjectSection',
    'EndProject',
    'Global',
    'EndGlobal',
    '',
].join('\r\n');

describe('solution items with backslash paths', () => {
    let dir: string;
    let solution: Solution;

    beforeEach(async () => {
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-slnitems-')));
        fs.mkdirSync(path.join(dir, 'docs'));
        fs.writeFileSync(path.join(dir, 'docs', 'readme.md'), 'x');
        fs.writeFileSync(path.join(dir, 'App.sln'), SLN);
        solution = new Solution(path.join(dir, 'App.sln'));
        await solution.ready;
    });
    afterEach(() => { solution.dispose(); fs.rmSync(dir, { recursive: true, force: true }); });

    it('lists the item with forward slashes so its name and path are right on every system', () => {
        const items = Object.values((solution as unknown as { _fileTree: Record<string, { files: { name: string; path: string }[] }> })._fileTree)
            .flatMap(entry => entry.files);
        const readme = items.find(item => item.name === 'readme.md');
        expect(readme?.path).toBe(path.join(dir, 'docs', 'readme.md'));
        expect(fs.existsSync(readme!.path)).toBe(true);
    });

    it('Remove from Solution removes the entry Visual Studio wrote', async () => {
        await solution.removeSolutionItem(path.join(dir, 'docs', 'readme.md'));
        const content = fs.readFileSync(path.join(dir, 'App.sln'), 'utf8');
        expect(content).not.toContain('readme.md');
        expect(content).toContain('NOTICE.txt = NOTICE.txt');
        expect(fs.existsSync(path.join(dir, 'docs', 'readme.md'))).toBe(true);
    });
});

describe('quick successive solution edits', () => {
    it('keeps every edit when they start together', async () => {
        const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-slnqueue-')));
        try {
            fs.writeFileSync(path.join(dir, 'App.sln'), SLN);
            const solution = new Solution(path.join(dir, 'App.sln'));
            await solution.ready;
            await Promise.all(['One', 'Two', 'Three', 'Four'].map(name => solution.addSolutionFolder(name)));
            const content = fs.readFileSync(path.join(dir, 'App.sln'), 'utf8');
            for (const name of ['One', 'Two', 'Three', 'Four']) {
                expect(content).toContain(`= "${name}", "${name}"`);
            }
            solution.dispose();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
