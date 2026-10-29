const showInformationMessage = jest.fn();
const runCodeCleanup = jest.fn().mockResolvedValue(undefined);
const projectForPath = jest.fn();
let activeEditor: { document: { uri: { scheme: string }; fileName: string } } | undefined;

jest.mock('vscode', () => ({
    window: {
        showInformationMessage: (...a: unknown[]) => showInformationMessage(...a),
        get activeTextEditor() { return activeEditor; },
    },
}), { virtual: true });
jest.mock('../../../../../services/templates/templateService', () => ({ projectForPath: (...a: unknown[]) => projectForPath(...a) }));
jest.mock('../../../../../services/code/codeCleanup/codeCleanup', () => ({ runCodeCleanup: (...a: unknown[]) => runCodeCleanup(...a) }));

import { runCodeCleanupOnActiveFile } from '../../../../../services/code/codeCleanup/activeFileCleanup';

const editorOf = (fileName: string, scheme = 'file') => ({ document: { uri: { scheme }, fileName } });

describe('runCodeCleanupOnActiveFile', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        projectForPath.mockReturnValue('/repo/App/App.csproj');
    });

    it('cleans the open C# file through its project', async () => {
        activeEditor = editorOf('/repo/App/Program.cs');
        await runCodeCleanupOnActiveFile();
        expect(runCodeCleanup).toHaveBeenCalledWith({ kind: 'file', path: '/repo/App/Program.cs', projectPath: '/repo/App/App.csproj' });
        expect(showInformationMessage).not.toHaveBeenCalled();
    });

    it.each([
        ['no editor is open', undefined],
        ['the file is not C#', editorOf('/repo/App/readme.md')],
        ['the document is not on disk', editorOf('/repo/App/Program.cs', 'untitled')],
    ])('says so when %s', async (_name, editor) => {
        activeEditor = editor;
        await runCodeCleanupOnActiveFile();
        expect(showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('C# files'));
        expect(runCodeCleanup).not.toHaveBeenCalled();
    });

    it('says so when the file is in no project of the solution', async () => {
        activeEditor = editorOf('/elsewhere/Program.cs');
        projectForPath.mockReturnValue(undefined);
        await runCodeCleanupOnActiveFile();
        expect(showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('project of the solution'));
        expect(runCodeCleanup).not.toHaveBeenCalled();
    });
});
