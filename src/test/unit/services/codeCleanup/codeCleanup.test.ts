import * as fs from 'fs';

const showInformationMessage = jest.fn();
const showErrorMessage = jest.fn();
const appendLine = jest.fn();
const show = jest.fn();
const saveAll = jest.fn().mockResolvedValue(true);
let severitySetting = 'warn';
let cancelListener: (() => void) | undefined;

jest.mock('vscode', () => ({
    window: {
        showInformationMessage: (...a: unknown[]) => showInformationMessage(...a),
        showErrorMessage: (...a: unknown[]) => showErrorMessage(...a),
        createOutputChannel: () => ({ clear: jest.fn(), appendLine, show }),
        withProgress: (_o: unknown, task: (p: unknown, t: unknown) => Promise<void>) => task(
            { report: jest.fn() },
            { isCancellationRequested: false, onCancellationRequested: (l: () => void) => { cancelListener = l; return { dispose: jest.fn() }; } }),
    },
    workspace: { getConfiguration: () => ({ get: () => severitySetting }), saveAll: (...a: unknown[]) => saveAll(...a) },
    ProgressLocation: { Notification: 15 },
}), { virtual: true });

type Callback = (error: (Error & { code?: number }) | null, stdout: string, stderr: string) => void;
const calls: Array<{ args: string[]; cwd: string }> = [];
let behave: (args: string[]) => { code?: number; stdout?: string; stderr?: string; hang?: boolean };

jest.mock('child_process', () => ({
    execFile: (_cmd: string, args: string[], options: { cwd: string }, callback: Callback) => {
        calls.push({ args, cwd: options.cwd });
        const kill = jest.fn();
        if (args[0] === '--version') {
            callback(null, '10.0.111\n', '');
            return { kill };
        }
        const outcome = behave(args);
        if (outcome.hang) {
            return { kill: () => callback(Object.assign(new Error('killed'), { code: undefined }), '', '') };
        }
        const reportDir = args[args.indexOf('--report') + 1];
        if (outcome.code) {
            callback(Object.assign(new Error('failed'), { code: outcome.code }), outcome.stdout ?? '', outcome.stderr ?? '');
        } else {
            fs.mkdirSync(reportDir, { recursive: true });
            fs.writeFileSync(`${reportDir}/format-report.json`, JSON.stringify(outcome.stdout ? JSON.parse(outcome.stdout) : []));
            callback(null, '', '');
        }
        return { kill };
    },
}));

import { changedFilesFromReports, failureReason, runCodeCleanup } from '../../../../services/codeCleanup/codeCleanup';

beforeEach(() => {
    jest.clearAllMocks();
    calls.length = 0;
    cancelListener = undefined;
    severitySetting = 'warn';
    behave = () => ({});
});

describe('changedFilesFromReports', () => {
    it('lists each changed file once across the reports', () => {
        const a = JSON.stringify([{ FilePath: '/p/A.cs' }, { FilePath: '/p/B.cs' }]);
        const b = JSON.stringify([{ FilePath: '/p/A.cs' }]);
        expect(changedFilesFromReports([a, b, 'not json', '[]'])).toEqual(['/p/A.cs', '/p/B.cs']);
    });
});

describe('failureReason', () => {
    it('is the first line of stderr, not the stack trace after it', () => {
        expect(failureReason('', 'Unhandled exception: System.Exception: Restore operation failed.\n   at X.Y()\n   at Z()')).toBe('Unhandled exception: System.Exception: Restore operation failed.');
    });

    it('falls back to the end of stdout, then to a generic text', () => {
        expect(failureReason('a\nb\nc\nd', '')).toBe('b c d');
        expect(failureReason('', '')).toBe('dotnet format failed');
    });
});

describe('runCodeCleanup', () => {
    it('saves the files, runs the three steps in the project directory and counts the changed files', async () => {
        behave = args => args[1] === 'whitespace' ? { stdout: JSON.stringify([{ FilePath: '/w/A.cs' }]) } : {};
        await runCodeCleanup({ kind: 'project', path: '/w/Web/Web.csproj' });

        expect(saveAll).toHaveBeenCalledWith(false);
        const steps = calls.filter(c => c.args[0] === 'format');
        expect(steps.map(c => c.args.slice(0, 2))).toEqual([['format', 'whitespace'], ['format', 'style'], ['format', 'style']]);
        expect(steps.every(c => c.cwd === '/w/Web')).toBe(true);
        expect(steps[1].args).toContain('hidden');
        expect(steps[2].args).toContain('warn');
        expect(showInformationMessage).toHaveBeenCalledWith('Code Cleanup finished: 1 file changed');
    });

    it('uses the severity setting', async () => {
        severitySetting = 'error';
        await runCodeCleanup({ kind: 'solution', path: '/w/App.sln' });
        const last = calls.filter(c => c.args[0] === 'format')[2];
        expect(last.args.slice(3, 5)).toEqual(['--severity', 'error']);
    });

    it('says nothing had to change', async () => {
        await runCodeCleanup({ kind: 'project', path: '/w/Web/Web.csproj' });
        expect(showInformationMessage).toHaveBeenCalledWith('Code Cleanup finished: nothing to change in Web.csproj');
    });

    it('stops at a failing step, shows why and offers the output', async () => {
        behave = args => args[1] === 'style' ? { code: 1, stderr: 'Unhandled exception: Restore operation failed.\n at x' } : {};
        showErrorMessage.mockResolvedValue('Show Output');
        await runCodeCleanup({ kind: 'project', path: '/w/Web/Web.csproj' });

        expect(calls.filter(c => c.args[0] === 'format')).toHaveLength(2);
        expect(showErrorMessage).toHaveBeenCalledWith('Code Cleanup failed at "Removing unused usings": Unhandled exception: Restore operation failed.', 'Show Output');
        expect(show).toHaveBeenCalled();
        expect(showInformationMessage).not.toHaveBeenCalled();
    });

    it('stops when cancelled', async () => {
        behave = () => ({ hang: true });
        const done = runCodeCleanup({ kind: 'project', path: '/w/Web/Web.csproj' });
        // Wait until the first step is running (a fixed delay is too short on a slow machine)
        while (!calls.some(c => c.args[0] === 'format')) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        cancelListener?.();
        await done;

        expect(calls.filter(c => c.args[0] === 'format')).toHaveLength(1);
        expect(showInformationMessage).toHaveBeenCalledWith('Code Cleanup of Web.csproj was cancelled.');
    });

    it('leaves files that are not C# alone', async () => {
        await runCodeCleanup({ kind: 'file', path: '/w/Web/site.js', projectPath: '/w/Web/Web.csproj' });
        expect(calls).toHaveLength(0);
        expect(showInformationMessage).toHaveBeenCalledWith('Code Cleanup works on C# files.');
    });
});
