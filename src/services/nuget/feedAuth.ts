import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../core/logger';
import { SolutionService } from '../solutionService';
import { PackageSource } from './types';
import { feedHelp } from './feedHelp';
import { matchSource, nugetConfigFiles, readSourceCredential, setClearTextPassword, SourceCredential, userConfigDir } from './nugetCredentials';
import { solutionWorkspaceFolder } from '../workspaceFolders';

const log = logger('FeedAuth');

/** Where NuGet starts looking for NuGet.Config files: the solution folder, else the workspace */
export function configStartDir(): string {
    const solution = SolutionService.getActiveSolution();
    return solution ? path.dirname(solution.solutionPath) : solutionWorkspaceFolder()?.uri.fsPath ?? process.cwd();
}

/** The value for `Authorization: Basic ...`, as NuGet sends the stored Username and ClearTextPassword */
export function basicAuth(credential: SourceCredential): string | undefined {
    return credential.kind === 'clearText' ? Buffer.from(`${credential.username ?? ''}:${credential.password}`).toString('base64') : undefined;
}

/** One search fires several requests: one message per source and credential and minute */
const REPEAT_AFTER_MS = 60000;
const reported = new Map<string, number>();
let sourcesProvider: () => Promise<PackageSource[]> = async () => [];

/** Tells the reporter how to find the configured sources (PackageBrowseService) */
export function setFeedSources(provider: () => Promise<PackageSource[]>): void {
    sourcesProvider = provider;
}

const plainStatus = (status: number) => status === 401 ? '401 Unauthorized' : status === 403 ? '403 Forbidden' : String(status);

/** A request to a feed came back 401/403: explain once per source and credential what to do */
export async function reportRejectedCredentials(requestUrl: string, status: number): Promise<void> {
    const source = matchSource(requestUrl, await sourcesProvider());
    if (!source) {
        log.warn(`${requestUrl} rejected the request (${status}), but it matches no configured source`);
        return;
    }
    const startDir = configStartDir();
    const credential = readSourceCredential(source.name, startDir);
    const key = `${source.name}|${credential.kind}|${credential.kind === 'clearText' ? credential.password : ''}`;
    const last = reported.get(key);
    if (last !== undefined && Date.now() - last < REPEAT_AFTER_MS) {
        return;
    }
    reported.set(key, Date.now());

    const help = feedHelp(source.url);
    const where = credential.kind === 'none' ? '' : `${credential.file}:${credential.line}`;
    const message = credential.kind === 'clearText'
        ? `NuGet feed '${source.name}' rejected its credentials (${plainStatus(status)}): the token in ${path.basename(credential.file)} has probably expired.`
        : credential.kind === 'encrypted'
            ? `NuGet feed '${source.name}' needs credentials (${plainStatus(status)}): its password in ${path.basename(credential.file)} is encrypted with Windows DPAPI, which only works on Windows.`
            : `NuGet feed '${source.name}' needs credentials (${plainStatus(status)}), but no NuGet.Config has any for it.`;

    const enterToken = credential.kind === 'none' ? 'Enter Token...' : 'Enter New Token...';
    const openConfig = 'Open NuGet.Config';
    const details = 'What to Do';
    const actions = [enterToken, ...(credential.kind !== 'none' ? [openConfig] : []), details];
    let choice = await vscode.window.showWarningMessage(message, ...actions);

    if (choice === details) {
        const detail = [
            ...help.steps.map(step => `• ${step}`),
            '',
            where ? `Credentials: ${where}` : `Checked: ${nugetConfigFiles(startDir).join(', ') || 'no NuGet.Config files found'}`,
            `Source: ${source.url}`,
        ].join('\n');
        const howTo = help.tokenUrl ? `Create a Token${help.provider ? ` (${help.provider})` : ''}` : undefined;
        choice = await vscode.window.showWarningMessage(message, { modal: true, detail },
            enterToken, ...(howTo ? [howTo] : []), ...(credential.kind !== 'none' ? [openConfig] : []));
        if (howTo && choice === howTo) {
            await vscode.env.openExternal(vscode.Uri.parse(help.tokenUrl!));
            return;
        }
    }
    if (choice === openConfig && credential.kind !== 'none') {
        const position = new vscode.Position(credential.line - 1, 0);
        await vscode.window.showTextDocument(vscode.Uri.file(credential.file), { selection: new vscode.Range(position, position) });
    } else if (choice === enterToken) {
        await enterNewToken(source, credential, help.provider);
    }
}

/** Whether the file lies in an open workspace folder or a git checkout (where a token could get committed) */
function isInWorkspace(file: string): boolean {
    const dir = path.dirname(file);
    if ((vscode.workspace.workspaceFolders ?? []).some(folder => {
        const relative = path.relative(folder.uri.fsPath, file);
        return !relative.startsWith('..') && !path.isAbsolute(relative);
    })) {
        return true;
    }
    for (let current = dir; ; current = path.dirname(current)) {
        if (fs.existsSync(path.join(current, '.git'))) {
            return true;
        }
        if (path.dirname(current) === current) {
            return false;
        }
    }
}

/** Asks for a token (and user name) and stores it as ClearTextPassword where NuGet will read it */
async function enterNewToken(source: PackageSource, credential: SourceCredential, provider: string | undefined): Promise<void> {
    const username = await vscode.window.showInputBox({
        prompt: `User name for '${source.name}'${provider === 'Azure DevOps' ? ' (any non-empty name works for Azure DevOps)' : ''}`,
        value: credential.kind !== 'none' ? credential.username ?? '' : provider === 'Azure DevOps' ? 'token' : '',
        ignoreFocusOut: true,
        validateInput: value => value.trim() ? undefined : 'Enter a user name',
    });
    if (!username) {
        return;
    }
    const token = await vscode.window.showInputBox({ prompt: `Token or password for '${source.name}'`, password: true, ignoreFocusOut: true });
    if (!token) {
        return;
    }

    // Credentials stay where they are; new ones go to the user config, not into a repository's NuGet.Config
    let file = credential.kind !== 'none' ? credential.file : path.join(userConfigDir(), 'NuGet.Config');
    if (credential.kind !== 'none' && isInWorkspace(file)) {
        const userConfig = 'Save to user NuGet.Config';
        const choice = await vscode.window.showWarningMessage(
            `The credentials for '${source.name}' are in ${file}, which is part of your workspace. A token saved there can end up in source control.`,
            { modal: true }, userConfig, 'Save Here Anyway');
        if (!choice) {
            return;
        }
        if (choice === userConfig) {
            file = path.join(userConfigDir(), 'NuGet.Config');
        }
    }
    try {
        const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, setClearTextPassword(content, source.name, username.trim(), token));
        vscode.window.showInformationMessage(`Saved the token for '${source.name}' in ${file}. Search or install again.`);
    } catch (error) {
        log.error('Saving the token failed:', error);
        vscode.window.showErrorMessage(`Could not save the token in ${file}: ${error}`);
    }
}

/** `dotnet add package`/restore output with a 401/403 from a feed: report the feeds it names */
export async function reportRejectedInOutput(output: string): Promise<void> {
    const status = /\b403\b|Forbidden/i.test(output) ? 403 : /\b401\b|Unauthorized/i.test(output) ? 401 : undefined;
    if (!status) {
        return;
    }
    const urls = [...new Set(output.match(/https?:\/\/[^\s'"<>]+/g) ?? [])];
    for (const url of urls) {
        await reportRejectedCredentials(url.replace(/[.,;:)\]]+$/, ''), status);
    }
}
