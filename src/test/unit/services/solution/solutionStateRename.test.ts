// A saved temporary solution: what was remembered for its temporary path moves to the saved file
jest.mock('vscode', () => ({ commands: { executeCommand: async () => undefined } }), { virtual: true });

import { UnloadedProjects } from '../../../../services/solution/unloadedProjects';
import { FrameworkChoice } from '../../../../services/project/frameworkChoice';
import { ShowAllFiles } from '../../../../services/solution/showAllFiles';

class Memento {
    private values = new Map<string, unknown>();
    get<T>(key: string, fallback?: T): T | undefined { return (this.values.has(key) ? this.values.get(key) : fallback) as T | undefined; }
    async update(key: string, value: unknown) { this.values.set(key, value); }
}

describe('per-solution state of a saved temporary solution', () => {
    it('moves unloaded projects, the framework choice and Show All Files to the new solution path', async () => {
        const state = new Memento() as never;
        UnloadedProjects.initialize(state);
        FrameworkChoice.initialize(state);
        ShowAllFiles.initialize(state);
        await UnloadedProjects.setUnloaded('/t/App.slnx', '/r/A.csproj', true);
        await FrameworkChoice.set('/t/App.slnx', 'net8.0');
        ShowAllFiles.setSolution('/t/App.slnx');
        await ShowAllFiles.toggle();

        await UnloadedProjects.rename('/t/App.slnx', '/r/App.slnx');
        await FrameworkChoice.rename('/t/App.slnx', '/r/App.slnx');
        await ShowAllFiles.rename('/t/App.slnx', '/r/App.slnx');

        expect(UnloadedProjects.isUnloaded('/r/App.slnx', '/r/A.csproj')).toBe(true);
        expect(UnloadedProjects.list('/t/App.slnx')).toEqual([]);
        expect(FrameworkChoice.get('/r/App.slnx')).toBe('net8.0');
        expect(FrameworkChoice.get('/t/App.slnx')).toBeUndefined();
        expect(ShowAllFiles.isOn()).toBe(true);
        ShowAllFiles.setSolution('/t/App.slnx');
        expect(ShowAllFiles.isOn()).toBe(false);
    });

    it('leaves the state alone when nothing was remembered', async () => {
        const state = new Memento() as never;
        UnloadedProjects.initialize(state);
        FrameworkChoice.initialize(state);
        ShowAllFiles.initialize(state);
        await UnloadedProjects.rename('/t/A.slnx', '/r/A.slnx');
        await FrameworkChoice.rename('/t/A.slnx', '/r/A.slnx');
        await ShowAllFiles.rename('/t/A.slnx', '/r/A.slnx');
        expect(UnloadedProjects.list('/r/A.slnx')).toEqual([]);
        expect(FrameworkChoice.get('/r/A.slnx')).toBeUndefined();
    });
});
