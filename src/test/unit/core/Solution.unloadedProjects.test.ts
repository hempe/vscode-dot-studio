// Unloaded projects are not evaluated by MSBuild until they are reloaded
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
import { UnloadedProjects } from '../../../services/solution/unloadedProjects';
import { ProjectItemsService } from '../../../services/project/items/projectItemsService';

describe('Solution with unloaded projects', () => {
    let dir: string;
    let file: string;
    let solution: Solution | undefined;
    let evaluate: jest.SpyInstance;

    beforeEach(() => {
        watchers.length = 0;
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-unloaded-')));
        file = path.join(dir, 'App.slnx');
        fs.mkdirSync(path.join(dir, 'Api'));
        fs.writeFileSync(path.join(dir, 'Api', 'Api.csproj'), '<Project Sdk="Microsoft.NET.Sdk"></Project>');
        fs.writeFileSync(file, '<Solution>\n  <Project Path="Api/Api.csproj" />\n</Solution>\n');
        const values = new Map<string, unknown>();
        UnloadedProjects.initialize({ get: (key: string) => values.get(key), update: async (key: string, value: unknown) => { values.set(key, value); } } as never);
        // No MSBuild in the unit tests
        evaluate = jest.spyOn(ProjectItemsService.instance, 'evaluate').mockResolvedValue(undefined);
    });

    afterEach(() => {
        solution?.dispose();
        jest.restoreAllMocks();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const settle = () => new Promise(resolve => setTimeout(resolve, 20));

    it('does not evaluate an unloaded project, and evaluates it when it is reloaded', async () => {
        const api = path.join(dir, 'Api', 'Api.csproj');
        await UnloadedProjects.setUnloaded(file, api, true);
        solution = new Solution(file);
        await solution.ready;
        await settle();
        expect(evaluate).not.toHaveBeenCalled();

        await UnloadedProjects.setUnloaded(file, api, false);
        await settle();
        expect(evaluate).toHaveBeenCalledWith(api);
    });

    it('evaluates a loaded project', async () => {
        solution = new Solution(file);
        await solution.ready;
        await settle();
        expect(evaluate).toHaveBeenCalledWith(path.join(dir, 'Api', 'Api.csproj'));
    });
});
