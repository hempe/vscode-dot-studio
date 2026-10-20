import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const showInformationMessage = jest.fn();
const showWarningMessage = jest.fn();
const executeCommand = jest.fn();
let hasCSharp = true;
let confirm: string | undefined = 'Sync';

jest.mock('vscode', () => ({
    window: {
        showInformationMessage: (...a: unknown[]) => showInformationMessage(...a),
        showWarningMessage: (...a: unknown[]) => showWarningMessage(...a),
        createOutputChannel: () => ({ clear: jest.fn(), appendLine: jest.fn(), show: jest.fn() }),
        withProgress: (_o: unknown, task: (p: unknown, t: unknown) => Promise<void>) => task({ report: jest.fn() }, { isCancellationRequested: false }),
    },
    workspace: { saveAll: jest.fn().mockResolvedValue(true), openTextDocument: jest.fn().mockResolvedValue({}), applyEdit: jest.fn(), textDocuments: [] },
    commands: { executeCommand: (...a: unknown[]) => executeCommand(...a) },
    Uri: { file: (f: string) => ({ fsPath: f, toString: () => f }) },
    Position: class { constructor(public line: number, public character: number) { } },
    Range: class { constructor(public start: unknown, public end: unknown) { } },
    ProgressLocation: { Notification: 15 },
}), { virtual: true });
jest.mock('../../../../services/csharpExtensionCheck', () => ({
    hasCSharpExtension: () => hasCSharp,
    recommendedCSharpExtension: () => 'muhammad-sammy.csharp',
}));
jest.mock('../../../../services/namespaceService', () => ({
    NamespaceService: {
        parseNamespaceFromContent: jest.requireActual('../../../../services/namespaceService').NamespaceService?.parseNamespaceFromContent,
        calculateExpectedNamespace: jest.fn().mockResolvedValue('Demo'),
    },
}));

import { runSyncNamespaces } from '../../../../services/namespaceSync/runSyncNamespaces';

let dir: string;
beforeEach(() => {
    jest.clearAllMocks();
    hasCSharp = true;
    confirm = 'Sync';
    showInformationMessage.mockImplementation(async (text: string) => (/^Sync namespaces/.test(text) ? confirm : undefined));
    dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'shinobi-ns-')));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('runSyncNamespaces', () => {
    it('stops with the recommendation without a C# extension', async () => {
        hasCSharp = false;
        await runSyncNamespaces({ kind: 'folder', path: dir });
        expect(showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('muhammad-sammy.csharp'));
        expect(executeCommand).not.toHaveBeenCalled();
    });

    it('says so when there are no C# files', async () => {
        fs.mkdirSync(path.join(dir, 'obj'));
        fs.writeFileSync(path.join(dir, 'obj', 'a.cs'), 'namespace X;');
        await runSyncNamespaces({ kind: 'folder', path: dir });
        expect(showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('No C# files'));
    });

    it('asks first and does nothing when declined', async () => {
        fs.writeFileSync(path.join(dir, 'a.cs'), 'namespace X;');
        confirm = undefined;
        await runSyncNamespaces({ kind: 'folder', path: dir });
        expect(showInformationMessage.mock.calls[0][0]).toContain('Sync namespaces of 1 file in');
        expect(executeCommand).not.toHaveBeenCalled();
    });

    it('asks the server at a column inside the name and reports that IDE0130 is missing', async () => {
        fs.writeFileSync(path.join(dir, 'a.cs'), 'namespace Wrong.Place;\nclass A {}\n');
        executeCommand.mockResolvedValue([]);
        await runSyncNamespaces({ kind: 'folder', path: dir });
        const [command, , range, , resolveCount] = executeCommand.mock.calls[0];
        expect(command).toBe('vscode.executeCodeActionProvider');
        expect(range.start).toEqual({ line: 0, character: 11 });
        expect(resolveCount).toBeGreaterThan(5);
        expect(showWarningMessage.mock.calls[0][0]).toContain('IDE0130');
    });
});
