// onDidParse fires when the solution file is read again, which the startup profile follows
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const watchers: Array<{ pattern: any; change: Array<() => unknown> }> = [];

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
            createFileSystemWatcher: (pattern: any) => {
                const entry = { pattern, change: [] as Array<() => unknown> };
                watchers.push(entry);
                return {
                    onDidChange: (handler: () => unknown, thisArg?: unknown) => { entry.change.push(handler.bind(thisArg)); return disposable; },
                    onDidCreate: () => disposable, onDidDelete: () => disposable, dispose: () => { },
                };
            },
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

describe('Solution.onDidParse', () => {
    let dir: string;
    let solution: Solution;
    let file: string;

    beforeEach(async () => {
        watchers.length = 0;
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-parse-')));
        file = path.join(dir, 'App.slnx');
        fs.writeFileSync(file, '<Solution>\n  <Project Path="Api/Api.csproj" />\n</Solution>\n');
        solution = new Solution(file);
        await solution.ready;
    });

    afterEach(() => {
        solution.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('fires once for a changed solution file, with the new project list', async () => {
        const seen: string[][] = [];
        solution.onDidParse(() => seen.push(solution.configurationProjects.map(project => project.path)));

        fs.writeFileSync(file, '<Solution>\n  <Project Path="Api/Api.csproj" />\n  <Project Path="Worker/Worker.csproj" />\n</Solution>\n');
        const handlers = watchers.filter(watcher => watcher.pattern === file).flatMap(watcher => watcher.change);
        expect(handlers).toHaveLength(1);
        await Promise.all(handlers.map(handler => handler()));

        expect(seen).toEqual([['Api/Api.csproj', 'Worker/Worker.csproj']]);
    });
});
