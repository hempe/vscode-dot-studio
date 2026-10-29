const mockExecFile = jest.fn();
jest.mock('child_process', () => ({ execFile: (...args: unknown[]) => mockExecFile(...args) }));

const mockShowQuickPick = jest.fn();
const mockStartDebugging = jest.fn();
const mockInfo = jest.fn();
const mockWarning = jest.fn();
const mockError = jest.fn();
let csharp = true;
jest.mock('vscode', () => ({
    window: {
        showQuickPick: (...args: unknown[]) => mockShowQuickPick(...args),
        showInformationMessage: (...args: unknown[]) => mockInfo(...args),
        showWarningMessage: (...args: unknown[]) => mockWarning(...args),
        showErrorMessage: (...args: unknown[]) => mockError(...args),
    },
    debug: { startDebugging: (...args: unknown[]) => mockStartDebugging(...args) },
    env: { uriScheme: 'vscode' },
}), { virtual: true });
jest.mock('../../../../../services/solution/solutionService', () => ({ SolutionService: { getActiveSolution: () => undefined } }));
jest.mock('../../../../../services/solution/workspaceFolders', () => ({ solutionWorkspaceFolder: () => ({ name: 'folder' }) }));
jest.mock('../../../../../services/shared/csharpExtensionCheck', () => ({
    hasCSharpExtension: () => csharp,
    recommendedCSharpExtension: () => 'ms-dotnettools.csharp',
}));

import { attachToProcess } from '../../../../../services/debug/attach/attachToProcess';

type Callback = (error: Error | null, stdout?: string) => void;

/** Answers the process listing (ps or PowerShell) and the port listing (ss, lsof or netstat) */
function listings(processes: string | Error, ports: string | Error | { ss: string; lsof: string }): void {
    mockExecFile.mockImplementation((file: string, _args: string[], _options: unknown, callback: Callback) => {
        const result = /^(ps|powershell\.exe)$/.test(file) ? processes : typeof ports === 'object' && !(ports instanceof Error) ? ports[file === 'lsof' ? 'lsof' : 'ss'] : ports;
        if (result instanceof Error) {
            callback(result);
        } else {
            callback(null, result);
        }
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    csharp = true;
});

// The listing format depends on the platform, so these tests run on the POSIX format only
const posix = process.platform === 'win32' ? describe.skip : describe;

posix('attachToProcess', () => {
    it('attaches coreclr to the picked process', async () => {
        // Linux asks ss, macOS lsof: each answers in its own format
        listings('  900   1 dotnet /srv/Shop.Web.dll\n', {
            ss: 'LISTEN 0 512 127.0.0.1:5181 0.0.0.0:* users:(("dotnet",pid=900,fd=1))\n',
            lsof: 'p900\nn127.0.0.1:5181\n',
        });
        mockShowQuickPick.mockImplementation(async (items: unknown[]) => items[0]);
        mockStartDebugging.mockResolvedValue(true);

        await attachToProcess();

        expect(mockShowQuickPick.mock.calls[0][0][0].label).toBe('Shop.Web (pid 900) :5181');
        expect(mockShowQuickPick.mock.calls[0][1]).toMatchObject({ matchOnDescription: true, matchOnDetail: true });
        expect(mockStartDebugging).toHaveBeenCalledWith({ name: 'folder' }, {
            name: 'Attach: Shop.Web (pid 900) :5181', type: 'coreclr', request: 'attach', processId: 900,
        });
    });

    it('still lists the processes when the port listing fails', async () => {
        listings('  900   1 dotnet /srv/Shop.Web.dll\n', new Error('ss missing'));
        mockShowQuickPick.mockResolvedValue(undefined);

        await attachToProcess();

        expect(mockShowQuickPick.mock.calls[0][0][0].label).toBe('Shop.Web (pid 900)');
        expect(mockStartDebugging).not.toHaveBeenCalled();
    });

    it('tells to start the app first when nothing runs', async () => {
        listings('  1   0 /sbin/init\n', '');
        await attachToProcess();
        expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('Start the app first'));
        expect(mockShowQuickPick).not.toHaveBeenCalled();
    });

    it('reports a failing process listing', async () => {
        listings(new Error('ps failed'), '');
        await attachToProcess();
        expect(mockError).toHaveBeenCalledWith(expect.stringContaining('ps failed'));
    });

    it('recommends the C# extension when there is none', async () => {
        csharp = false;
        await attachToProcess();
        expect(mockWarning).toHaveBeenCalledWith(expect.stringContaining('ms-dotnettools.csharp'));
        expect(mockExecFile).not.toHaveBeenCalled();
    });
});
