const folders = [
    { name: 'web', uri: { fsPath: '/repos/web' } },
    { name: 'api', uri: { fsPath: '/repos/api' } },
];
jest.mock('vscode', () => ({ workspace: { get workspaceFolders() { return folders; } } }), { virtual: true });

import { setActiveSolutionPath, solutionWorkspaceFolder, workspaceFolderOf } from '../../../../services/solution/workspaceFolders';

describe('workspace folders (multi-root workspaces)', () => {
    afterEach(() => setActiveSolutionPath(undefined));

    it('the solution\'s folder is the one that holds the active solution, the first one without a solution', () => {
        expect(solutionWorkspaceFolder()?.name).toBe('web');
        setActiveSolutionPath('/repos/api/src/Api.slnx');
        expect(solutionWorkspaceFolder()?.name).toBe('api');
    });

    it('finds the folder of any file, the first one for files outside the workspace', () => {
        expect(workspaceFolderOf('/repos/api/src/Program.cs')?.name).toBe('api');
        expect(workspaceFolderOf('/repos/apis/x.cs')?.name).toBe('web');
        expect(workspaceFolderOf('/elsewhere/x.cs')?.name).toBe('web');
    });
});
