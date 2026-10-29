import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../core/logger';

const log = logger('MonoDebug');
const execFileAsync = promisify(execFile);

/** Microsoft's Mono Debug extension: provides the `mono` debug type that runs and debugs .NET Framework programs on Linux and macOS */
export const MONO_DEBUG_EXTENSION = 'ms-vscode.mono-debug';

/** Splits a launch profile's `commandLineArgs` into arguments, honouring double quotes */
export function splitArguments(commandLine: string | undefined): string[] {
    const args: string[] = [];
    for (const match of (commandLine ?? '').matchAll(/"([^"]*)"|(\S+)/g)) {
        args.push(match[1] ?? match[2]);
    }
    return args;
}

async function hasMono(): Promise<boolean> {
    try {
        await execFileAsync('mono', ['--version']);
        return true;
    } catch {
        return false;
    }
}

/**
 * Makes sure a .NET Framework project can run here: the `mono` runtime and the Mono Debug extension.
 * Tells the user what is missing (and offers to install the extension); returns whether to go on.
 */
export async function ensureMonoDebugging(): Promise<boolean> {
    if (!await hasMono()) {
        log.warn('mono was not found on the PATH');
        void vscode.window.showErrorMessage(
            'Running .NET Framework projects on this system needs Mono. Install it with your package manager so that the `mono` command works.');
        return false;
    }
    if (vscode.extensions.getExtension(MONO_DEBUG_EXTENSION)) {
        return true;
    }

    const install = `Install ${MONO_DEBUG_EXTENSION}`;
    const choice = await vscode.window.showWarningMessage(
        `Running and debugging .NET Framework projects on this system needs the Mono Debug extension (${MONO_DEBUG_EXTENSION}).`,
        install
    );
    if (choice !== install) {
        return false;
    }
    await vscode.commands.executeCommand('workbench.extensions.installExtension', MONO_DEBUG_EXTENSION);
    return vscode.extensions.getExtension(MONO_DEBUG_EXTENSION) !== undefined;
}
