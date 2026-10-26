// The namespace question after a move: one per move (drop, Paste, folder rename), only for files that do not match
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ui = {
    answers: [] as (string | undefined)[],
    questions: [] as string[],
    errors: [] as string[],
    notices: [] as string[],
};

jest.mock('vscode', () => {
    const disposable = { dispose: () => { } };
    const watcher = { onDidChange: () => disposable, onDidCreate: () => disposable, onDidDelete: () => disposable, dispose: () => { } };
    class EventEmitter { event = () => disposable; fire() { } dispose() { } }
    const nodeFs = require('fs');
    // A message with buttons is a question (answered from ui.answers); one without is a notice
    const ask = async (message: string, ...rest: unknown[]) => {
        if (!rest.some(item => typeof item === 'string')) {
            ui.notices.push(message);
            return undefined;
        }
        ui.questions.push(message);
        return ui.answers.shift();
    };
    return {
        EventEmitter,
        Position: class { constructor(public line: number, public character: number) { } },
        RelativePattern: class { constructor(public base: string, public pattern: string) { } },
        Uri: { file: (p: string) => ({ fsPath: p }) },
        FileType: { File: 1, Directory: 2 },
        workspace: {
            createFileSystemWatcher: () => watcher,
            workspaceFolders: undefined,
            getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
            // No editor here: NamespaceService falls back to editing the file
            openTextDocument: async () => { throw new Error('no editor in unit tests'); },
            fs: {
                stat: async (uri: any) => ({ type: nodeFs.statSync(uri.fsPath).isDirectory() ? 2 : 1 }),
                rename: async (from: any, to: any) => nodeFs.renameSync(from.fsPath, to.fsPath),
                copy: async (from: any, to: any) => nodeFs.cpSync(from.fsPath, to.fsPath, { recursive: true }),
            },
        },
        window: {
            showInformationMessage: ask,
            showWarningMessage: ask,
            showErrorMessage: async (message: string) => { ui.errors.push(message); },
        },
        commands: { executeCommand: async () => undefined },
    };
}, { virtual: true });

import { namespaceChangesAfterMove, updateNamespacesAfterMove } from '../../../services/namespaceAfterMove';
import { SolutionService } from '../../../services/solutionService';
import { SolutionActionService } from '../../../services/solutionActionService';
import { NodeIdService } from '../../../services/nodeIdService';

describe('namespaces after a move', () => {
    let dir: string;
    let project: string;
    const write = (relative: string, content: string) => {
        const file = path.join(project, ...relative.split('/'));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        return file;
    };
    const read = (relative: string) => fs.readFileSync(path.join(project, ...relative.split('/')), 'utf8');
    const movedFolder = () => {
        write('New/Old/A.cs', 'namespace App.Old;\n\npublic class A { }\n');
        write('New/Old/B.cs', 'namespace App.Old\n{\n    public class B { }\n}\n');
        write('New/Old/Sub/C.cs', 'namespace App.New.Old.Sub;\n\npublic class C { }\n');
        write('New/Old/G.cs', 'public class G { }\n');
        return path.join(project, 'New', 'Old');
    };

    beforeEach(() => {
        ui.answers = [];
        ui.questions = [];
        ui.errors = [];
        ui.notices = [];
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-ns-')));
        project = path.join(dir, 'App');
        write('App.csproj', '<Project Sdk="Microsoft.NET.Sdk" />');
        // NamespaceService finds a file's project through the active solution
        (SolutionService as any).activeSolution = {
            getDotNetProjects: () => [{ projectPath: path.join(project, 'App.csproj'), name: 'App' }],
            forceRefreshAllProjects: async () => { },
        };
    });

    afterEach(() => {
        (SolutionService as any).activeSolution = undefined;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('a moved folder: its C# files that no longer match, not the matching or global ones', async () => {
        const changes = await namespaceChangesAfterMove([movedFolder()]);

        expect(changes.map(c => [path.basename(c.filePath), c.currentNamespace, c.expectedNamespace]).sort()).toEqual([
            ['A.cs', 'App.Old', 'App.New.Old'],
            ['B.cs', 'App.Old', 'App.New.Old'],
        ]);
    });

    test('several files: one question, Update All updates them all', async () => {
        const folder = movedFolder();
        ui.answers = ['Update All'];

        await updateNamespacesAfterMove([folder], 'Moved');

        expect(ui.questions).toEqual([expect.stringContaining('2 C# files')]);
        expect(read('New/Old/A.cs')).toContain('namespace App.New.Old;');
        expect(read('New/Old/B.cs')).toContain('namespace App.New.Old\n{');
        expect(read('New/Old/Sub/C.cs')).toContain('namespace App.New.Old.Sub;');
    });

    test('without the language server action only the declarations change, and the user is told the references did not (review A6-9)', async () => {
        const folder = movedFolder();
        ui.answers = ['Update All'];

        await updateNamespacesAfterMove([folder], 'Moved');

        expect(ui.notices.filter(notice => notice.includes('were not updated'))).toEqual([expect.stringContaining('2 file(s)')]);
    });

    test('Review Each asks per file; Skip changes nothing', async () => {
        const folder = movedFolder();
        ui.answers = ['Review Each', 'Update', 'Skip All Remaining'];
        await updateNamespacesAfterMove([folder], 'Moved');
        expect(ui.questions).toHaveLength(3);
        expect(['A.cs', 'B.cs'].filter(file => read(`New/Old/${file}`).includes('App.New.Old'))).toHaveLength(1);

        ui.questions = [];
        ui.answers = ['Skip'];
        const before = read('New/Old/A.cs') + read('New/Old/B.cs');
        await updateNamespacesAfterMove([folder], 'Moved');
        expect(ui.questions).toHaveLength(1);
        expect(read('New/Old/A.cs') + read('New/Old/B.cs')).toBe(before);
    });

    test('a single file gets the single-file question', async () => {
        const file = write('Models/A.cs', 'namespace App;\n\npublic class A { }\n');
        ui.answers = ['Update Namespace'];

        await updateNamespacesAfterMove([file], 'Moved');

        expect(ui.questions).toEqual([expect.stringContaining("Update namespace in 'A.cs'")]);
        expect(read('Models/A.cs')).toContain('namespace App.Models;');
    });

    test('nothing to update: no question', async () => {
        await updateNamespacesAfterMove([write('Models/A.cs', 'namespace App.Models;\n')], 'Moved');
        expect(ui.questions).toEqual([]);
    });

    test('Cut and Paste of two C# files asks once (it asked for each file before)', async () => {
        const files = [write('A.cs', 'namespace App;\n\npublic class A { }\n'), write('B.cs', 'namespace App;\n\npublic class B { }\n')];
        fs.mkdirSync(path.join(project, 'Models'));
        await SolutionActionService.handleMultiAction('cut', files.map(file => NodeIdService.generateFileId(file)));
        ui.answers = ['Update All'];

        await SolutionActionService.handleProjectAction({ action: 'paste', nodeId: NodeIdService.generateFolderId(path.join(project, 'Models')) });

        expect(ui.questions).toHaveLength(1);
        expect(read('Models/A.cs')).toContain('namespace App.Models;');
        expect(read('Models/B.cs')).toContain('namespace App.Models;');
        expect(ui.errors).toEqual([]);
    });

    test('Copy and Paste asks nothing', async () => {
        const file = write('A.cs', 'namespace App;\n\npublic class A { }\n');
        fs.mkdirSync(path.join(project, 'Models'));
        await SolutionActionService.handleProjectAction({ action: 'copy', nodeId: NodeIdService.generateFileId(file) });

        await SolutionActionService.handleProjectAction({ action: 'paste', nodeId: NodeIdService.generateFolderId(path.join(project, 'Models')) });

        expect(ui.questions).toEqual([]);
        expect(read('Models/A.cs')).toContain('namespace App;');
        expect(fs.existsSync(file)).toBe(true);
    });
});
