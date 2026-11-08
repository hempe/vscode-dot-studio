import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../../core/logger';
import { t } from '../../core/i18n';
import { dirtyDocuments, findType, refreshForRenamedFile, isOwnRename, ownRename, renameTypeOfFile, saveChanged, typeNamesOfRename, typeStartingAt } from './typeRename';

const log = logger('RenameSync');

export const RENAME_SYMBOL_COMMAND = 'shinobi.renameSymbol';

const symbolsOf = async (uri: vscode.Uri) =>
    (await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>('vscode.executeDocumentSymbolProvider', uri)) ?? [];

/**
 * A file renamed in VS Code's Explorer (or anywhere but our Solution Explorer, which asks before the rename): like Visual Studio,
 * offers to rename the type named after the file and all references to it.
 */
export async function typeFollowsRenamedFiles(files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[]): Promise<void> {
    for (const { oldUri, newUri } of files) {
        // whatever the file's type: the server has to see the new name
        if (path.extname(newUri.fsPath).toLowerCase() === '.cs' && !isOwnRename(newUri.fsPath)) {
            refreshForRenamedFile(newUri.fsPath);
        }
        const names = typeNamesOfRename(oldUri.fsPath, newUri.fsPath);
        if (!names || isOwnRename(newUri.fsPath)) {
            continue;
        }
        try {
            // the file is at its new path already: the type is looked for there, under its old name
            const edit = await renameTypeOfFile(newUri, names.oldName, names.newName, false);
            if (!edit) {
                continue;
            }
            const dirtyBefore = dirtyDocuments();
            if (!await vscode.workspace.applyEdit(edit)) {
                void vscode.window.showWarningMessage(t('Could not rename the type \'{0}\'.', names.oldName));
                continue;
            }
            await saveChanged(edit, dirtyBefore);
        } catch (error) {
            log.warn(`Renaming the type of ${newUri.fsPath} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

/** How long the rename box may stay open before we stop waiting for its result, and how long the server gets to report the new name */
const WATCH_MS = 120_000;
const SETTLE_MS = 400;
const CHECKS = 4;

/**
 * F2 on the type of a file named after it: the rename of VS Code runs as it always does, then the file is offered the new name.
 * (A symbol rename raises no event, so the command wraps the rename and watches the file for the change.) Anywhere else F2 is the plain rename.
 */
export async function renameSymbol(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const named = editor?.document.languageId === 'csharp' ? await typeNamedAfterFile(editor) : undefined;
    if (!editor || !named) {
        await vscode.commands.executeCommand('editor.action.rename');
        return;
    }
    const uri = editor.document.uri;
    log.info(`F2 on the type ${named.oldName} of ${path.basename(uri.fsPath)}: the file is offered the new name after the rename`);
    // the command may return before the rename box closes (and the box may stay open for a while): the file is watched
    const renamed = watchTypeRename(uri, named.start, named.oldName);
    await vscode.commands.executeCommand('editor.action.rename');
    try {
        const newName = await renamed;
        if (!newName) {
            log.info(`The type ${named.oldName} was not renamed (cancelled?), the file keeps its name`);
            return;
        }
        await offerFileRename(uri, newName);
    } catch (error) {
        log.warn(`Renaming the file of ${uri.fsPath} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/** The new name of the type that starts at `start`, once the file changed and the server reports it; undefined when no rename came within the time */
function watchTypeRename(uri: vscode.Uri, start: vscode.Position, oldName: string): Promise<string | undefined> {
    return new Promise(resolve => {
        let settle: ReturnType<typeof setTimeout> | undefined;
        const finish = (name?: string) => {
            subscription.dispose();
            clearTimeout(limit);
            if (settle) { clearTimeout(settle); }
            resolve(name);
        };
        const check = async (left: number): Promise<void> => {
            const type = typeStartingAt(await symbolsOf(uri), start);
            if (type && type.name !== oldName) {
                finish(type.name);
            } else if (left > 1) {
                // the server may not have the change yet
                settle = setTimeout(() => void check(left - 1), SETTLE_MS);
            }
        };
        const subscription = vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.uri.toString() !== uri.toString() || event.contentChanges.length === 0) {
                return;
            }
            if (settle) { clearTimeout(settle); }
            settle = setTimeout(() => void check(CHECKS), SETTLE_MS);
        });
        const limit = setTimeout(() => finish(undefined), WATCH_MS);
    });
}

/** The type under the cursor when the file carries its name */
async function typeNamedAfterFile(editor: vscode.TextEditor): Promise<{ start: vscode.Position; oldName: string } | undefined> {
    const uri = editor.document.uri;
    const oldName = path.basename(uri.fsPath, path.extname(uri.fsPath));
    const type = findType(await symbolsOf(uri), oldName);
    return type?.selectionRange.contains(editor.selection.active) ? { start: type.selectionRange.start, oldName } : undefined;
}

async function offerFileRename(uri: vscode.Uri, newTypeName: string): Promise<void> {
    const newPath = path.join(path.dirname(uri.fsPath), newTypeName + path.extname(uri.fsPath));
    if (typeNamesOfRename(uri.fsPath, newPath) === undefined) {
        return;
    }
    const oldFile = path.basename(uri.fsPath);
    const newFile = path.basename(newPath);
    if (await exists(vscode.Uri.file(newPath))) {
        void vscode.window.showWarningMessage(t('\'{0}\' exists already, so the file keeps the name \'{1}\'.', newFile, oldFile));
        return;
    }
    const choice = await vscode.window.showInformationMessage(t('Would you also like to rename the file \'{0}\' to \'{1}\'?', oldFile, newFile), t('Yes'), t('No'));
    if (choice !== t('Yes')) {
        return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(uri, vscode.Uri.file(newPath));
    if (!await ownRename(newPath, () => Promise.resolve(vscode.workspace.applyEdit(edit)))) {
        void vscode.window.showWarningMessage(t('Could not rename {0}', oldFile));
        return;
    }
    refreshForRenamedFile(newPath);
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

export function registerRenameSync(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.workspace.onDidRenameFiles(event => void typeFollowsRenamedFiles(event.files)),
        vscode.commands.registerCommand(RENAME_SYMBOL_COMMAND, () => renameSymbol())
    );
}
