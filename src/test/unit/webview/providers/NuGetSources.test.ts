// The Sources tab messages: only with the setting, validated and confirmed on the host
let enabled = false;
const mockVscode = { showWarningMessage: jest.fn() };
jest.mock('vscode', () => ({ window: mockVscode, Uri: { joinPath: jest.fn(() => ({})) } }), { virtual: true });
jest.mock('../../../../services/settings', () => ({ Settings: { nugetIncludePrerelease: () => false, nugetPackageSources: () => enabled } }));
jest.mock('../../../../services/solutionService', () => ({ SolutionService: { getActiveSolution: () => undefined } }));
jest.mock('../../../../services/workspaceFolders', () => ({ solutionWorkspaceFolder: () => undefined }));
jest.mock('../../../../webview/providers/views/NuGetWebview', () => ({ NuGetWebview: { getHtmlForWebview: () => '<html />' } }));
jest.mock('../../../../services/nuget/nugetManagerService', () => ({ NuGetManagerService: { getSolutionNuGetData: jest.fn(async () => ({ installedPackages: [], outdatedPackages: [], projects: [] })) } }));
const sources = [{ name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json', enabled: true }];
const mockManage = {
    addSource: jest.fn(async () => undefined),
    removeSource: jest.fn(async () => undefined),
    setSourceEnabled: jest.fn(async () => undefined),
    listManagedSources: jest.fn(async () => sources),
};
jest.mock('../../../../services/nuget/sourceManagement', () => ({
    ...jest.requireActual('../../../../services/nuget/sourceManagement'),
    addSource: (...args: unknown[]) => (mockManage.addSource as any)(...args),
    removeSource: (...args: unknown[]) => (mockManage.removeSource as any)(...args),
    setSourceEnabled: (...args: unknown[]) => (mockManage.setSourceEnabled as any)(...args),
    listManagedSources: () => mockManage.listManagedSources(),
}));

import { NuGetCustomEditorProvider } from '../../../../webview/providers/NuGetCustomEditorProvider';

const open = async () => {
    const provider = new NuGetCustomEditorProvider({} as any, {} as any);
    let receive: (message: unknown) => Promise<void> = async () => { };
    const webview = { options: {}, html: '', postMessage: jest.fn(), onDidReceiveMessage: jest.fn((l: any) => { receive = l; }) };
    const panel = { webview, active: true, onDidDispose: jest.fn(), onDidChangeViewState: jest.fn() };
    await provider.resolveCustomTextEditor({ uri: { toString: () => 'untitled:NuGet.nuget', query: 'context=solution&target=%2Frepo%2FApp.sln' } } as any, panel as any, {} as any);
    webview.postMessage.mockClear();
    return { webview, send: (message: unknown) => receive(message) };
};
const replies = (webview: { postMessage: jest.Mock }) => webview.postMessage.mock.calls.map(([m]) => m).filter(m => m.type === 'packageSources');

beforeEach(() => { enabled = true; Object.values(mockManage).forEach(mock => mock.mockClear()); mockVscode.showWarningMessage.mockReset(); });

describe('Sources tab on the host', () => {
    it('ignores every message without the setting', async () => {
        enabled = false;
        const { webview, send } = await open();
        await send({ type: 'addSource', payload: { name: 'A', url: 'https://a/index.json', location: 'user' } });
        await send({ type: 'getSources' });
        expect(mockManage.addSource).not.toHaveBeenCalled();
        expect(replies(webview)).toEqual([]);
    });

    it('adds a valid source and answers with the list; an invalid one answers with the problem and adds nothing', async () => {
        const { webview, send } = await open();
        await send({ type: 'addSource', payload: { name: 'Mirror', url: 'https://mirror/index.json', location: 'solution' } });
        expect(mockManage.addSource).toHaveBeenCalledWith('Mirror', 'https://mirror/index.json', 'solution');

        await send({ type: 'addSource', payload: { name: 'NuGet.org', url: 'https://x/index.json', location: 'user' } });
        expect(mockManage.addSource).toHaveBeenCalledTimes(1);
        const [first, second] = replies(webview);
        expect(first.payload).toEqual({ sources, error: undefined });
        expect(second.payload.error).toBe('A source named NuGet.org exists');
    });

    it('removes a source only after the modal question is answered with Remove', async () => {
        const { send } = await open();
        mockVscode.showWarningMessage.mockResolvedValueOnce(undefined);
        await send({ type: 'removeSource', payload: { name: 'Mirror' } });
        expect(mockManage.removeSource).not.toHaveBeenCalled();

        mockVscode.showWarningMessage.mockResolvedValueOnce('Remove');
        await send({ type: 'removeSource', payload: { name: 'Mirror' } });
        expect(mockManage.removeSource).toHaveBeenCalledWith('Mirror');
    });

    it('enables and disables, and reports a failure', async () => {
        const { webview, send } = await open();
        await send({ type: 'setSourceEnabled', payload: { name: 'Mirror', enabled: false } });
        expect(mockManage.setSourceEnabled).toHaveBeenCalledWith('Mirror', false);

        mockManage.setSourceEnabled.mockRejectedValueOnce(new Error('config is read-only'));
        await send({ type: 'setSourceEnabled', payload: { name: 'Mirror', enabled: true } });
        expect(replies(webview).slice(-1)[0].payload.error).toBe('config is read-only');
    });
});
