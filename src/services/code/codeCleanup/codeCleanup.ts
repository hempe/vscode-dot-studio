import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile, ChildProcess } from 'child_process';
import { logger } from '../../../core/logger';
import { CleanupSeverity, CleanupTarget, cleanupSteps, unusedUsingsSeverityFor } from './cleanupSteps';

const log = logger('CodeCleanup');

let outputChannel: vscode.OutputChannel | undefined;

/** The files `dotnet format --report` lists as changed, de-duplicated across the reports of the steps */
export function changedFilesFromReports(reports: string[]): string[] {
    const files = new Set<string>();
    for (const report of reports) {
        try {
            const entries = JSON.parse(report) as Array<{ FilePath?: string }>;
            for (const entry of entries) {
                if (entry.FilePath) {
                    files.add(entry.FilePath);
                }
            }
        } catch {
            // an unreadable report counts nothing
        }
    }
    return [...files];
}

/** What went wrong in a failed `dotnet format`: its message (first line of stderr, the lines after it are a stack trace), else the end of its output */
export function failureReason(stdout: string, stderr: string): string {
    const lines = (text: string) => text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    return lines(stderr)[0] || lines(stdout).slice(-3).join(' ') || 'dotnet format failed';
}

interface StepResult {
    code: number | null;
    stdout: string;
    stderr: string;
    cancelled: boolean;
}

function run(args: string[], cwd: string, token: vscode.CancellationToken): Promise<StepResult> {
    return new Promise(resolve => {
        let cancelled = false;
        // The cancel listener and the exit callback need each other: the child is assigned after the listener exists
        // eslint-disable-next-line prefer-const
        let child: ChildProcess | undefined;
        const subscription = token.onCancellationRequested(() => {
            cancelled = true;
            child?.kill();
        });
        child = execFile('dotnet', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
            subscription.dispose();
            const code = error ? (typeof error.code === 'number' ? error.code : null) : 0;
            resolve({ code, stdout, stderr: stderr || (error && typeof error.code !== 'number' ? error.message : ''), cancelled });
        });
    });
}

/** The SDK `dotnet` resolves in that directory (global.json counts); decides how unused usings are asked for */
async function dotnetVersion(cwd: string): Promise<string> {
    return new Promise(resolve => {
        execFile('dotnet', ['--version'], { cwd, timeout: 30000 }, (error, stdout) => resolve(error ? '' : stdout.trim()));
    });
}

/**
 * Code Cleanup like Visual Studio's: formatting, unused usings and the `.editorconfig` code style fixes, run
 * with `dotnet format` on a solution, project, folder or file, in a progress notification that can be cancelled
 */
export async function runCodeCleanup(target: CleanupTarget): Promise<void> {
    const name = path.basename(target.path);
    if (target.kind === 'file' && !target.path.toLowerCase().endsWith('.cs')) {
        vscode.window.showInformationMessage('Code Cleanup works on C# files.');
        return;
    }

    const severity = vscode.workspace.getConfiguration('shinobi.codeCleanup').get<CleanupSeverity>('severity', 'warn');
    await vscode.workspace.saveAll(false);

    let planned;
    try {
        planned = cleanupSteps(target, severity);
    } catch (error) {
        vscode.window.showErrorMessage(`Code Cleanup: ${error instanceof Error ? error.message : error}`);
        return;
    }
    const version = await dotnetVersion(planned.cwd);
    const { cwd, steps } = cleanupSteps(target, severity, unusedUsingsSeverityFor(version));

    const output = outputChannel ??= vscode.window.createOutputChannel('Code Cleanup');
    output.clear();
    const reportRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'shinobi-cleanup-'));

    try {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Code Cleanup: ${name}`, cancellable: true },
            async (progress, token) => {
                const reports: string[] = [];
                for (const [index, step] of steps.entries()) {
                    progress.report({ message: `${step.label} (${index + 1} of ${steps.length})` });
                    const reportDir = path.join(reportRoot, String(index));
                    const args = [...step.args, '--report', reportDir];
                    log.info(`dotnet ${args.join(' ')} (in ${cwd})`);
                    output.appendLine(`> dotnet ${args.join(' ')}`);
                    const result = await run(args, cwd, token);
                    output.appendLine(result.stdout);
                    output.appendLine(result.stderr);

                    if (result.cancelled || token.isCancellationRequested) {
                        log.info('Code Cleanup cancelled');
                        vscode.window.showInformationMessage(`Code Cleanup of ${name} was cancelled${reports.length ? ', files changed by earlier steps stay changed' : ''}.`);
                        return;
                    }
                    if (result.code !== 0) {
                        const reason = failureReason(result.stdout, result.stderr);
                        log.error(`Step "${step.label}" failed (exit ${result.code}): ${reason}`);
                        const choice = await vscode.window.showErrorMessage(`Code Cleanup failed at "${step.label}": ${reason}`, 'Show Output');
                        if (choice === 'Show Output') {
                            output.show();
                        }
                        return;
                    }
                    try {
                        reports.push(await fs.promises.readFile(path.join(reportDir, 'format-report.json'), 'utf8'));
                    } catch {
                        log.warn(`No report of step "${step.label}"`);
                    }
                }

                const changed = changedFilesFromReports(reports);
                log.info(`Code Cleanup finished, ${changed.length} files changed`);
                vscode.window.showInformationMessage(changed.length === 0
                    ? `Code Cleanup finished: nothing to change in ${name}`
                    : `Code Cleanup finished: ${changed.length} ${changed.length === 1 ? 'file' : 'files'} changed`);
            });
    } finally {
        fs.promises.rm(reportRoot, { recursive: true, force: true }).catch(() => undefined);
    }
}
