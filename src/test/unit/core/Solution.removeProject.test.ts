// Solution.removeProject passes the path to dotnet without a shell (review A1-04)
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

import { execFileSync } from 'child_process';

const hasDotnet = (() => { try { execFileSync('dotnet', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

(hasDotnet ? describe : describe.skip)('Solution.removeProject', () => {
    it('does not run shell syntax in the path of the project', async () => {
        const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-removeproject-')));
        const marker = path.join(dir, 'injected');
        const folder = `evil$(touch ${marker})`;
        try {
            fs.mkdirSync(path.join(dir, folder), { recursive: true });
            fs.writeFileSync(path.join(dir, folder, 'Evil.csproj'), '<Project Sdk="Microsoft.NET.Sdk"></Project>');
            fs.writeFileSync(path.join(dir, 'App.slnx'), `<Solution>\n  <Project Path="${folder}/Evil.csproj" />\n</Solution>\n`);
            const solution = new Solution(path.join(dir, 'App.slnx'));
            await solution.ready;
            await solution.removeProject(path.join(dir, folder, 'Evil.csproj'));
            expect(fs.existsSync(marker)).toBe(false);
            expect(fs.readFileSync(path.join(dir, 'App.slnx'), 'utf8')).not.toContain('Evil.csproj');
            solution.dispose();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }, 60000);
});
