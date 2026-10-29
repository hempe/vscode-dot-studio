import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { logger } from '../../../core/logger';
import { DevCertStatus, parseDevCertStatus, shouldCheck } from './devCertStatus';

const log = logger('DevCert');

const DISMISSED_KEY = 'shinobi.devCert.dismissed';
const CHECK_TIMEOUT = 15000;
const DEV_CERTS_DOCS = 'https://learn.microsoft.com/dotnet/core/tools/dotnet-dev-certs';

const TERMINAL_NAME = 'HTTPS certificate';
const TRUST = 'Trust Certificate';
const NOT_NOW = 'Not Now';
const DONT_ASK = "Don't Ask Again";

let globalState: vscode.Memento | undefined;
/** The check of this window session: set when it starts, cleared when the user chose Trust */
let session: Promise<DevCertStatus | undefined> | undefined;

/** Needs the extension's global state ("Don't Ask Again"); until it is called nothing is checked */
export function initDevCertCheck(context: vscode.ExtensionContext): void {
    globalState = context.globalState;
    context.subscriptions.push(vscode.window.onDidCloseTerminal(terminal => {
        if (terminal.name === TERMINAL_NAME) {
            session = undefined;
        }
    }));
}

function readStatus(): Promise<DevCertStatus> {
    return new Promise((resolve, reject) => {
        execFile('dotnet', ['dev-certs', 'https', '--check-trust-machine-readable'],
            { timeout: CHECK_TIMEOUT, maxBuffer: 1024 * 1024, windowsHide: true },
            (error, stdout) => {
                const status = error ? undefined : parseDevCertStatus(stdout);
                return status ? resolve(status) : reject(error ?? new Error(`Unexpected output: ${stdout.slice(0, 200)}`));
            });
    });
}

const linuxNote = () => process.platform === 'linux'
    ? ` Trusting is only partial on Linux, browsers need manual steps: ${DEV_CERTS_DOCS}`
    : '';

function message(status: DevCertStatus): string {
    return status.state === 'none'
        ? `There is no HTTPS development certificate: trusting one creates it, https://localhost shows a certificate warning in the browser until then.${linuxNote()}`
        : `The HTTPS development certificate is not trusted: https://localhost will show a certificate warning in the browser.${linuxNote()}`;
}

/** Runs `dotnet dev-certs https --trust` in a visible terminal; the next start checks the certificate again */
function runTrust(): void {
    const terminal = vscode.window.createTerminal(TERMINAL_NAME);
    terminal.show();
    terminal.sendText('dotnet dev-certs https --trust');
    session = undefined;
}

async function prompt(status: DevCertStatus): Promise<void> {
    const choice = await vscode.window.showWarningMessage(message(status), TRUST, NOT_NOW, DONT_ASK);
    if (choice === TRUST) {
        runTrust();
    } else if (choice === DONT_ASK) {
        await globalState?.update(DISMISSED_KEY, true);
    }
}

async function checkAndPrompt(): Promise<DevCertStatus | undefined> {
    try {
        const status = await readStatus();
        log.info(`HTTPS development certificate: ${status.state}`);
        if (status.state === 'none' || status.state === 'untrusted') {
            // Not awaited: the check is done, the user's answer is not part of it
            void prompt(status).catch(error => log.error('Prompt failed:', error));
        }
        return status;
    } catch (error) {
        log.warn('Checking the HTTPS development certificate failed:', error);
        return undefined;
    }
}

/**
 * Called by every way of starting a project with its launch profiles: when one has an https:// applicationUrl, the
 * certificate is checked once per window session. Returns at once, the start never waits for the check.
 */
export function checkDevCertificateBeforeStart(profiles: ReadonlyArray<{ applicationUrl?: string } | undefined>): void {
    if (!globalState) {
        return;
    }
    const enabled = vscode.workspace.getConfiguration('shinobi.debug').get<boolean>('checkDevCertificate', true)
        && !globalState.get<boolean>(DISMISSED_KEY);
    if (profiles.some(profile => shouldCheck(profile, enabled, session !== undefined))) {
        session = checkAndPrompt();
    }
}

/** "Trust HTTPS Development Certificate": trusts on demand, even when the setting or Don't Ask Again silences the start check */
export async function trustDevCertificate(): Promise<void> {
    let status: DevCertStatus;
    try {
        status = await readStatus();
    } catch (error) {
        log.warn('Checking the HTTPS development certificate failed:', error);
        runTrust();
        return;
    }
    if (status.state === 'trusted') {
        vscode.window.showInformationMessage('The HTTPS development certificate is trusted.');
    } else if (status.state === 'partial') {
        vscode.window.showInformationMessage(`The HTTPS development certificate is trusted by some stores only (partial).${linuxNote()}`);
    } else {
        runTrust();
    }
}
