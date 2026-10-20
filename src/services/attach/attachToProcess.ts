import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as path from 'path';
import { logger } from '../../core/logger';
import { SolutionService } from '../solutionService';
import { solutionWorkspaceFolder } from '../workspaceFolders';
import { hasCSharpExtension, recommendedCSharpExtension } from '../csharpExtensionCheck';
import { parsePsOutput, parseWindowsProcesses, ProcessEntry } from './processList';
import { parseLsof, parseNetstat, parseSs, PortsByPid } from './listeningPorts';
import { findDotnetProcesses, SolutionProjectRef } from './dotnetProcesses';
import { AttachItem, buildAttachItems } from './attachItems';

const log = logger('AttachToProcess');

const LIST_TIMEOUT = 15000;

function run(file: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(file, args, { timeout: LIST_TIMEOUT, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
            if (error) {
                reject(error);
            } else {
                resolve(stdout);
            }
        });
    });
}

async function listProcesses(): Promise<ProcessEntry[]> {
    if (process.platform === 'win32') {
        const script = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress';
        return parseWindowsProcesses(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]));
    }
    return parsePsOutput(await run('ps', ['-ww', '-eo', 'pid=,ppid=,args=']));
}

/** Listening ports per process; whatever fails just means no ports in the list */
async function listPorts(): Promise<PortsByPid> {
    try {
        if (process.platform === 'win32') {
            return parseNetstat(await run('netstat', ['-ano', '-p', 'TCP']));
        }
        if (process.platform === 'darwin') {
            return parseLsof(await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn']));
        }
        try {
            return parseSs(await run('ss', ['-ltnpH']));
        } catch (error) {
            log.debug('ss failed, trying lsof:', error);
            return parseLsof(await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn']));
        }
    } catch (error) {
        log.warn('Listing the listening ports failed:', error);
        return new Map();
    }
}

function solutionProjects(): SolutionProjectRef[] {
    const solution = SolutionService.getActiveSolution();
    return solution
        ? Array.from(solution.projects.values()).map(project => ({ name: project.name, directory: path.dirname(project.projectPath) }))
        : [];
}

/** Visual Studio's Debug > Attach to Process: a picker with the running .NET programs, then a coreclr attach */
export async function attachToProcess(): Promise<void> {
    if (!hasCSharpExtension()) {
        vscode.window.showWarningMessage(
            `Attach to Process needs a C# extension for the debugger. Install ${recommendedCSharpExtension()}.`);
        return;
    }

    let items: AttachItem[];
    try {
        const [entries, ports] = await Promise.all([listProcesses(), listPorts()]);
        items = buildAttachItems(findDotnetProcesses(entries, { projects: solutionProjects(), selfPid: process.pid }), ports);
    } catch (error) {
        log.error('Listing the processes failed:', error);
        vscode.window.showErrorMessage(`Could not list the running processes: ${error instanceof Error ? error.message : String(error)}`);
        return;
    }

    if (items.length === 0) {
        vscode.window.showInformationMessage('No running .NET processes found. Start the app first, then attach.');
        return;
    }

    const picked = await vscode.window.showQuickPick<AttachItem>(items, {
        title: 'Attach to Process',
        placeHolder: 'Select a .NET process (type a project name, port or pid)',
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!picked) {
        return;
    }

    log.info(`Attaching to ${picked.label}`);
    const started = await vscode.debug.startDebugging(solutionWorkspaceFolder(), {
        name: `Attach: ${picked.label}`,
        type: 'coreclr',
        request: 'attach',
        processId: picked.pid,
    });
    if (!started) {
        vscode.window.showErrorMessage(`Could not attach the debugger to ${picked.label}.`);
    }
}
