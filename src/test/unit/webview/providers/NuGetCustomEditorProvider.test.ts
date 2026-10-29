jest.mock('vscode', () => ({
    window: {
        withProgress: jest.fn((_options: unknown, task: () => Promise<unknown>) => task()),
        showInformationMessage: jest.fn(),
        showWarningMessage: jest.fn(),
        showErrorMessage: jest.fn(),
    },
    ProgressLocation: { Notification: 15 },
    Uri: { joinPath: jest.fn(() => ({})) },
}), { virtual: true });
jest.mock('../../../../services/shared/settings', () => ({ Settings: { nugetIncludePrerelease: () => false, nugetPackageSources: () => false } }));
jest.mock('../../../../services/solution/solutionService', () => ({ SolutionService: { getActiveSolution: () => ({ solutionPath: '/repo/App.sln' }) } }));
jest.mock('../../../../services/solution/workspaceFolders', () => ({ solutionWorkspaceFolder: () => undefined }));
jest.mock('../../../../webview/providers/views/NuGetWebview', () => ({ NuGetWebview: { getHtmlForWebview: () => '<html />' } }));
jest.mock('../../../../services/nuget/nugetManagerService', () => ({
    NuGetManagerService: { getSolutionNuGetData: jest.fn(), getProjectNuGetData: jest.fn() },
}));
jest.mock('../../../../services/nuget/centralPackageOperations', () => ({
    changePackageVersions: jest.fn().mockResolvedValue({ cancelled: false, results: [{ success: true, message: 'ok' }] }),
    consolidatePackages: jest.fn().mockResolvedValue({ cancelled: false, results: [{ success: true, message: 'ok' }] }),
    uninstallPackages: jest.fn(),
}));

import { NuGetCustomEditorProvider } from '../../../../webview/providers/NuGetCustomEditorProvider';
import { NuGetManagerService } from '../../../../services/nuget/nugetManagerService';
import { ProjectItemsService } from '../../../../services/project/items/projectItemsService';

// Lets the provider's promise chains finish (works with fake timers too)
const flush = async () => {
    for (let i = 0; i < 20; i++) {
        await Promise.resolve();
    }
};

describe('NuGetCustomEditorProvider refreshes', () => {
    let evaluated: (projectPath: string) => void;
    let packagesVersion: number;
    let installedVersion: string;

    const openEditor = async (provider: NuGetCustomEditorProvider) => {
        let receive: (message: unknown) => Promise<void> = async () => { };
        let viewState: (event: unknown) => void = () => { };
        const webview = {
            options: {},
            html: '',
            postMessage: jest.fn(),
            onDidReceiveMessage: jest.fn((listener: (message: unknown) => Promise<void>) => { receive = listener; }),
        };
        const panel = {
            webview,
            active: true,
            onDidDispose: jest.fn(),
            onDidChangeViewState: jest.fn((listener: (event: unknown) => void) => { viewState = listener; }),
        };
        const document = { uri: { toString: () => 'untitled:NuGet.nuget', query: 'context=solution&target=%2Frepo%2FApp.sln' } };
        await provider.resolveCustomTextEditor(document as any, panel as any, {} as any);
        await flush();
        return { webview, panel, receive: (message: unknown) => receive(message), viewState: (event: unknown) => viewState(event) };
    };
    const installedVersions = (webview: { postMessage: jest.Mock }) => webview.postMessage.mock.calls
        .map(([message]) => message)
        .filter(message => message.type === 'nugetData')
        .map(message => message.payload.installedPackages[0].version);

    let subscription: { dispose: jest.Mock };
    beforeEach(() => {
        jest.useRealTimers();
        packagesVersion = 1;
        installedVersion = '1.0.0';
        subscription = { dispose: jest.fn() };
        jest.spyOn(ProjectItemsService.instance, 'onDidEvaluate').mockImplementation(listener => { evaluated = listener; return subscription; });
        jest.spyOn(ProjectItemsService.instance, 'packagesVersion').mockImplementation(() => packagesVersion);
        (NuGetManagerService.getSolutionNuGetData as jest.Mock).mockImplementation(async () => ({
            installedPackages: [{ id: 'Serilog', currentVersion: installedVersion }],
            outdatedPackages: [],
            transitivePackages: [],
            consolidatePackages: [],
            projects: [],
        }));
    });
    afterEach(() => jest.restoreAllMocks());

    test('after Consolidate the Installed data is sent again, with the new versions', async () => {
        const { webview, receive } = await openEditor(new NuGetCustomEditorProvider({} as any, {} as any));
        installedVersion = '2.0.0';
        await receive({ type: 'bulkConsolidatePackages', payload: { packages: [{ id: 'Serilog', currentVersion: '1.0.0', versions: ['2.0.0'] }], includePrerelease: false } });
        expect(installedVersions(webview)).toEqual(['1.0.0', '2.0.0']);
        const types = webview.postMessage.mock.calls.map(([message]) => message.type);
        expect(types.indexOf('nugetData', 1)).toBeLessThan(types.indexOf('bulkConsolidateComplete'));
    });

    test('after a bulk update the Installed data is sent again, with the new versions', async () => {
        const { webview, receive } = await openEditor(new NuGetCustomEditorProvider({} as any, {} as any));
        installedVersion = '2.0.0';
        await receive({
            type: 'bulkUpdatePackages',
            payload: { packages: [{ id: 'Serilog', currentVersion: '1.0.0', versions: ['2.0.0'], projects: [{ path: '/repo/App/App.csproj' }] }], includePrerelease: false },
        });
        expect(installedVersions(webview)).toEqual(['1.0.0', '2.0.0']);
    });

    test('an evaluation with new package versions refreshes the open editors once, with their prerelease choice', async () => {
        jest.useFakeTimers();
        const provider = new NuGetCustomEditorProvider({} as any, {} as any);
        evaluated('/repo/App/App.csproj');
        const { webview, receive } = await openEditor(provider);
        await receive({ type: 'getNuGetData', payload: { includePrerelease: true } });
        (NuGetManagerService.getSolutionNuGetData as jest.Mock).mockClear();
        webview.postMessage.mockClear();

        // Same packages: nothing to show
        evaluated('/repo/App/App.csproj');
        jest.advanceTimersByTime(1000);
        expect(NuGetManagerService.getSolutionNuGetData).not.toHaveBeenCalled();

        // Directory.Packages.props changed: two projects evaluated, one refresh
        packagesVersion = 2;
        installedVersion = '2.0.0';
        evaluated('/repo/App/App.csproj');
        evaluated('/repo/Lib/Lib.csproj');
        jest.advanceTimersByTime(1000);
        await flush();
        expect(NuGetManagerService.getSolutionNuGetData).toHaveBeenCalledTimes(1);
        expect(NuGetManagerService.getSolutionNuGetData).toHaveBeenCalledWith('/repo/App.sln', true);
        expect(installedVersions(webview)).toEqual(['2.0.0']);
    });

    test('coming to the front re-checks the props files no watcher sees', async () => {
        const onFocus = jest.fn().mockResolvedValue(undefined);
        const { viewState } = await openEditor(new NuGetCustomEditorProvider({} as any, {} as any, onFocus));
        viewState({ webviewPanel: { active: false } });
        expect(onFocus).not.toHaveBeenCalled();
        viewState({ webviewPanel: { active: true } });
        expect(onFocus).toHaveBeenCalledTimes(1);
    });

    test('dispose ends the evaluation subscription and a pending refresh', async () => {
        jest.useFakeTimers();
        const provider = new NuGetCustomEditorProvider({} as any, {} as any);
        await openEditor(provider);
        (NuGetManagerService.getSolutionNuGetData as jest.Mock).mockClear();
        packagesVersion = 2;
        evaluated('/repo/App/App.csproj');
        provider.dispose();
        expect(subscription.dispose).toHaveBeenCalled();
        jest.advanceTimersByTime(1000);
        await flush();
        expect(NuGetManagerService.getSolutionNuGetData).not.toHaveBeenCalled();
    });
});
