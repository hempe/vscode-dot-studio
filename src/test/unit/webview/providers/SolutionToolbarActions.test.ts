// What the host does with the toolbar's messages: its buttons run commands, its configuration menu sets the configuration or
// platform, and nothing the webview makes up is run
const mockExecuted: string[] = [];
jest.mock('vscode', () => ({
    commands: { executeCommand: async (command: string) => { mockExecuted.push(command); } },
    window: {}, workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (_k: string, d: unknown) => d }) },
    Uri: { joinPath: () => ({}) }, EventEmitter: class { event = () => ({ dispose() { } }); fire() { } dispose() { } },
}), { virtual: true });
const mockSet = jest.fn();
const mockSetPlatform = jest.fn();
jest.mock('../../../../services/buildConfiguration', () => ({
    BuildConfiguration: {
        available: ['Debug', 'Release'], availablePlatforms: ['Any CPU', 'x64'], active: 'Debug', activePlatform: 'Any CPU',
        set: (...args: unknown[]) => mockSet(...args), setPlatform: (...args: unknown[]) => mockSetPlatform(...args),
        onDidChange: () => ({ dispose() { } }),
    },
    solutionConfigurations: () => [], solutionPlatforms: () => [],
}));
jest.mock('../../../../services/solutionService', () => ({ SolutionService: { getActiveSolution: () => undefined } }));
jest.mock('../../../../services/workspaceFolders', () => ({ solutionWorkspaceFolder: () => undefined }));
jest.mock('../../../../services/settings', () => ({ Settings: {} }));
jest.mock('../../../../services/startupProfiles/startProfile', () => ({ refreshStartup: async () => { } }));

import { SolutionWebviewProvider } from '../../../../webview/providers/SolutionWebviewProvider';

const provider = () => new SolutionWebviewProvider({} as any, { workspaceState: { get: () => [], update: async () => { } } } as any,
    {} as any, { onDidChange: () => ({ dispose() { } }) } as any, { onDidChange: () => ({ dispose() { } }) } as any);
const send = (payload: object) => (provider() as any)._handleMessage({ type: 'toolbarAction', payload });

beforeEach(() => { mockExecuted.length = 0; mockSet.mockReset(); mockSetPlatform.mockReset(); });

describe('toolbar messages on the host', () => {
    it('runs the command of a button', async () => {
        await send({ action: 'debug' });
        await send({ action: 'configurationManager' });
        expect(mockExecuted).toEqual(['shinobi.solution.debug', 'shinobi.configurationManager.open']);
    });

    it('sets the configuration or the platform the menu picked', async () => {
        await send({ action: 'setConfiguration', value: 'Release' });
        await send({ action: 'setPlatform', value: 'x64' });
        expect(mockSet).toHaveBeenCalledWith('Release');
        expect(mockSetPlatform).toHaveBeenCalledWith('x64');
    });

    it('ignores a configuration or platform the solution does not have, and an action that is no button', async () => {
        await send({ action: 'setConfiguration', value: 'Nope' });
        await send({ action: 'setPlatform', value: 'arm' });
        await send({ action: 'workbench.action.quit' });
        await send({ action: 'setConfiguration' });
        expect(mockSet).not.toHaveBeenCalled();
        expect(mockSetPlatform).not.toHaveBeenCalled();
        expect(mockExecuted).toEqual([]);
    });
});
