// A temporary solution (a folder or project opened without a solution) asks to be saved before its first change
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => {
    const disposable = { dispose: () => { } };
    const watcher = { onDidChange: () => disposable, onDidCreate: () => disposable, onDidDelete: () => disposable, dispose: () => { } };
    class EventEmitter { event = () => disposable; fire() { } dispose() { } }
    return {
        EventEmitter,
        RelativePattern: class { constructor(public base: string, public pattern: string) { } },
        Uri: { file: (p: string) => ({ fsPath: p }) },
        workspace: { createFileSystemWatcher: () => watcher, workspaceFolders: undefined, getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
        window: { showWarningMessage: async () => undefined, showInformationMessage: async () => undefined, showErrorMessage: async () => undefined },
        commands: { executeCommand: async () => undefined },
    };
}, { virtual: true });

// The parsers refuse paths under /tmp (and /var, where macOS keeps its temp dir)
jest.mock('./../../../core/constants', () => ({
    ...jest.requireActual('../../../core/constants'),
    isSystemPath: () => false,
}));

import { Solution } from '../../../core/Solution';
import { SaveCancelledError } from '../../../core/saveCancelled';
import { tempSolutionXml } from '../../../services/solution/tempSolution';
import { ProjectItemsService } from '../../../services/project/items/projectItemsService';

beforeEach(() => { jest.spyOn(ProjectItemsService.instance, 'evaluate').mockResolvedValue(undefined); });

/** A repo with the projects and a temporary solution for them in a separate "storage" folder */
function writeTemp(projects: string[]) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-solution-'));
    const repo = path.join(base, 'repo');
    const storage = path.join(base, 'storage', 'abc');
    const files = projects.map(p => path.join(repo, p));
    for (const file of files) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>');
    }
    fs.mkdirSync(storage, { recursive: true });
    const solutionPath = path.join(storage, 'App.slnx');
    fs.writeFileSync(solutionPath, tempSolutionXml(storage, files));
    return { repo, solutionPath, files };
}

describe('a temporary solution', () => {
    it('asks before its first change, and Cancel changes nothing', async () => {
        const { solutionPath } = writeTemp(['App/App.csproj']);
        const solution = new Solution(solutionPath, { temporary: true });
        await solution.ready;
        expect(solution.isTemporary).toBe(true);
        const before = fs.readFileSync(solutionPath, 'utf8');
        solution.saveGuard = async () => undefined;
        await expect(solution.addSolutionFolder('Libs')).rejects.toBeInstanceOf(SaveCancelledError);
        expect(fs.readFileSync(solutionPath, 'utf8')).toBe(before);
        solution.dispose();
    });

    it('Save moves the same Solution to the saved file, then makes the change there', async () => {
        const { solutionPath, repo, files } = writeTemp(['App/App.csproj']);
        const solution = new Solution(solutionPath, { temporary: true });
        await solution.ready;
        expect([...solution.projects.keys()]).toEqual(files);
        const saved = path.join(repo, 'App.slnx');
        let asked = 0;
        solution.saveGuard = async () => {
            asked++;
            fs.writeFileSync(saved, '<Solution>\n  <Project Path="App/App.csproj" />\n</Solution>\n');
            return saved;
        };
        await Promise.all([solution.addSolutionFolder('Libs'), solution.addSolutionFolder('Tools')]);
        expect(asked).toBe(1);
        expect(solution.solutionPath).toBe(saved);
        expect(solution.isTemporary).toBe(false);
        const xml = fs.readFileSync(saved, 'utf8');
        expect(xml).toContain('/Libs/');
        expect(xml).toContain('/Tools/');
        expect([...solution.projects.keys()]).toEqual(files);
        solution.dispose();
    });

    it('a saved solution never asks', async () => {
        const { repo } = writeTemp(['App/App.csproj']);
        const real = path.join(repo, 'App.slnx');
        fs.writeFileSync(real, '<Solution>\n  <Project Path="App/App.csproj" />\n</Solution>\n');
        const solution = new Solution(real);
        await solution.ready;
        solution.saveGuard = async () => { throw new Error('asked'); };
        await solution.addSolutionFolder('Libs');
        expect(fs.readFileSync(real, 'utf8')).toContain('/Libs/');
        solution.dispose();
    });
});
