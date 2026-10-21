jest.mock('vscode', () => ({ commands: { executeCommand: jest.fn() } }), { virtual: true });

import * as vscode from 'vscode';
import { ShowAllFiles } from '../../../services/showAllFiles';

const memento = () => {
    const values = new Map<string, unknown>();
    return { get: <T>(key: string, fallback?: T) => (values.has(key) ? values.get(key) : fallback) as T, update: async (key: string, value: unknown) => { values.set(key, value); }, keys: () => [...values.keys()] };
};

describe('ShowAllFiles', () => {
    beforeEach(() => ShowAllFiles.initialize(memento() as never));

    test('is off by default', () => {
        ShowAllFiles.setSolution('/a.sln');
        expect(ShowAllFiles.isOn()).toBe(false);
    });

    test('toggles, and remembers per solution', async () => {
        ShowAllFiles.setSolution('/a.sln');
        await ShowAllFiles.toggle();
        expect(ShowAllFiles.isOn()).toBe(true);
        ShowAllFiles.setSolution('/b.sln');
        expect(ShowAllFiles.isOn()).toBe(false);
        ShowAllFiles.setSolution('/a.sln');
        expect(ShowAllFiles.isOn()).toBe(true);
    });

    test('keeps the context key in step (the title bar button shows it pressed)', async () => {
        ShowAllFiles.setSolution('/a.sln');
        await ShowAllFiles.toggle();
        expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith('setContext', 'shinobi.solutionExplorer.showAllFiles', true);
    });
});
