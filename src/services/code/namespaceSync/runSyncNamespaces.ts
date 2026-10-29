import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../core/logger';
import { isSystemPath, shouldSkipDirectory } from '../../core/constants';
import { hasCSharpExtension, recommendedCSharpExtension } from '../csharpExtensionCheck';
import { NamespaceService } from '../namespaceService';
import { candidateFiles } from './syncPlan';
import { SyncAction, SyncDeps, syncNamespaces, syncSummary } from './namespaceSync';

const log = logger('NamespaceSync');

let outputChannel: vscode.OutputChannel | undefined;

/**
 * How many code actions the server resolves before they are returned. The Roslyn server offers
 * "Change namespace to '...'" WITHOUT an edit (probe of muhammad-sammy.csharp 2.160.9: kind `refactor`, only `data`;
 * the edit comes from `codeAction/resolve`). `vscode.executeCodeActionProvider` resolves the first N items
 * (`itemResolveCount`) before returning them, and the position of our action among them is not known (it was third
 * of four), so a generous N resolves all of them; they are few. An action that still has no edit then is reported.
 */
const RESOLVE_COUNT = 20;

/** The C# files below a directory, without descending into build output, hidden folders or system paths */
async function listCSharpFiles(root: string): Promise<string[]> {
    const found: string[] = [];
    const walk = async (dir: string): Promise<void> => {
        let entries: fs.Dirent[];
        try {
            entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch (error) {
            log.warn(`Cannot read ${dir}: ${error}`);
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!shouldSkipDirectory(entry.name) && !entry.name.startsWith('.') && !isSystemPath(full)) {
                    await walk(full);
                }
            } else if (entry.isFile()) {
                found.push(full);
            }
        }
    };
    await walk(root);
    return candidateFiles(found, root);
}

function createDeps(projectPath: string | undefined): SyncDeps {
    // the vscode.CodeAction behind each SyncAction, to apply its edit
    const originals = new Map<SyncAction, vscode.CodeAction>();

    return {
        parseNamespace: async file => {
            const content = await fs.promises.readFile(file, 'utf8');
            const info = NamespaceService.parseNamespaceFromContent(content);
            if (!info?.namespace) {
                return null;
            }
            // a column inside the name: the server offers the action there, not on a range from the start of the line
            const text = content.split('\n')[info.line];
            return { namespace: info.namespace, line: info.line, character: text.indexOf(info.namespace) + 1 };
        },
        expectedNamespace: file => NamespaceService.calculateExpectedNamespace(file, projectPath),
        codeActions: async (file, line, character) => {
            const uri = vscode.Uri.file(file);
            await vscode.workspace.openTextDocument(uri);
            const position = new vscode.Position(line, character);
            const actions = await vscode.commands.executeCommand<Array<vscode.CodeAction | vscode.Command> | undefined>(
                'vscode.executeCodeActionProvider', uri, new vscode.Range(position, position), undefined, RESOLVE_COUNT);
            return (actions ?? []).map(item => {
                const action = item as vscode.CodeAction;
                const mapped: SyncAction = {
                    title: item.title,
                    edit: action.edit,
                    command: typeof action.command === 'string' ? action.command : action.command?.command ?? (item as vscode.Command).command,
                };
                originals.set(mapped, action);
                return mapped;
            });
        },
        applyAndSave: async action => {
            const original = originals.get(action);
            if (!original?.edit || !await vscode.workspace.applyEdit(original.edit)) {
                return false;
            }
            for (const [uri] of original.edit.entries()) {
                const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
                if (document?.isDirty) {
                    await document.save();
                }
            }
            return true;
        },
    };
}

/**
 * The namespace of one file changed to the one its folder asks for, through the server's "Change namespace to ..." action
 * (which also updates the files that use it, and saves them). False when the server offers no such action (no C# extension,
 * IDE0130 not reported, project not loaded yet).
 */
export async function syncFileNamespace(file: string): Promise<boolean> {
    if (!hasCSharpExtension()) {
        return false;
    }
    const result = await syncNamespaces([file], createDeps(undefined));
    return result.changed.includes(file);
}

/**
 * Sync Namespaces like Visual Studio's: every C# file of a project or folder gets the namespace its folder asks
 * for, by applying the C# language server's "Change namespace to ..." action (which also updates the files that use it)
 */
export async function runSyncNamespaces(node: { kind: 'project' | 'folder'; path: string }): Promise<void> {
    const name = path.basename(node.path);
    if (!hasCSharpExtension()) {
        vscode.window.showWarningMessage(
            `Sync Namespaces needs a C# extension. Install ${recommendedCSharpExtension()}.`);
        return;
    }

    const root = node.kind === 'project' ? path.dirname(node.path) : node.path;
    const files = await listCSharpFiles(root);
    if (files.length === 0) {
        vscode.window.showInformationMessage(`No C# files to sync in ${name}.`);
        return;
    }

    const sync = 'Sync';
    const choice = await vscode.window.showInformationMessage(
        `Sync namespaces of ${files.length} ${files.length === 1 ? 'file' : 'files'} in ${name} to match their folders? Other files that use them are updated too.`,
        { modal: true }, sync);
    if (choice !== sync) {
        return;
    }

    await vscode.workspace.saveAll(false);

    const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Sync Namespaces: ${name}`, cancellable: true },
        (progress, token) => {
            let last = 0;
            return syncNamespaces(files, createDeps(node.kind === 'project' ? node.path : undefined), token, (index, total, file) => {
                progress.report({ message: `${index} of ${total}: ${path.relative(root, file)}`, increment: (index - last) * 100 / total });
                last = index;
            });
        });

    const output = outputChannel ??= vscode.window.createOutputChannel('Sync Namespaces');
    output.clear();
    output.appendLine(`Sync Namespaces: ${name}`);
    output.appendLine(`Changed (${result.changed.length}):`);
    result.changed.forEach(f => output.appendLine(`  ${path.relative(root, f)}`));
    output.appendLine(`Failed (${result.failed.length}):`);
    result.failed.forEach(f => output.appendLine(`  ${path.relative(root, f.file)}: ${f.reason}`));

    const summary = syncSummary(result, files.length);
    log.info(summary.text);
    const show = summary.details ? 'Show Details' : undefined;
    const items = show ? [show] : [];
    const picked = summary.level === 'warning'
        ? await vscode.window.showWarningMessage(summary.text, ...items)
        : await vscode.window.showInformationMessage(summary.text, ...items);
    if (picked === show) {
        output.show();
    }
}
