import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../../core/logger';
import { t } from '../../core/i18n';
import { refreshProjectForNewFile } from '../refactoring/newFileRefresh';

const log = logger('TypeRename');

const codeExtensions = ['.cs', '.vb'];

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Files this extension is renaming itself (by their new path): the rename hook of VS Code's Explorer leaves them alone */
const ownRenames = new Set<string>();

export function isOwnRename(newPath: string): boolean {
    return ownRenames.has(newPath);
}

/** Runs a file rename of ours; the hook for renames made elsewhere does not ask about it again */
export async function ownRename<T>(newPath: string, action: () => Promise<T>): Promise<T> {
    ownRenames.add(newPath);
    try {
        return await action();
    } finally {
        // the event of the rename arrives after it, not within the awaited action
        setTimeout(() => ownRenames.delete(newPath), 2000).unref?.();
    }
}

/**
 * Renames a file like Visual Studio: if a C#/VB file declares a type named after the file,
 * offers to rename the type and all references to it through the language server, together with the file.
 * Otherwise (declined, no matching type, no language server) only the file is renamed.
 */
export async function renameFileAndType(oldPath: string, newPath: string): Promise<void> {
    return ownRename(newPath, () => renameFileAndTypeNow(oldPath, newPath));
}

async function renameFileAndTypeNow(oldPath: string, newPath: string): Promise<void> {
    const oldUri = vscode.Uri.file(oldPath);
    const newUri = vscode.Uri.file(newPath);

    const edit = await typeRenameEdit(oldPath, newPath);
    if (!edit) {
        await vscode.workspace.fs.rename(oldUri, newUri);
        refreshForRenamedFile(newPath);
        return;
    }

    const dirtyBefore = dirtyDocuments();

    // Text edits apply to the old path, then the file moves, all in one undoable operation
    edit.renameFile(oldUri, newUri);
    if (!await vscode.workspace.applyEdit(edit)) {
        throw new Error(t('Could not rename {0}', path.basename(oldPath)));
    }

    await saveChanged(edit, dirtyBefore, uri => uri.fsPath === oldPath ? newUri : uri);
    refreshForRenamedFile(newPath);
}

/** A renamed file is a new file to the C# server in a project with several target frameworks: the files that use it keep their errors until the project is read again */
export function refreshForRenamedFile(newPath: string): void {
    if (refreshProjectForNewFile(newPath)) {
        log.debug(`Touched the project file: the language server does not see the renamed file ${path.basename(newPath)} in a multi-targeted project otherwise`);
    }
}

/** The documents that were open with unsaved changes before a rename */
export function dirtyDocuments(): Set<string> {
    return new Set(vscode.workspace.textDocuments.filter(d => d.isDirty).map(d => d.uri.toString()));
}

/** Saves what a rename changed, like Visual Studio; other unsaved changes are left alone */
export async function saveChanged(edit: vscode.WorkspaceEdit, dirtyBefore: Set<string>, moved: (uri: vscode.Uri) => vscode.Uri = uri => uri): Promise<void> {
    for (const uri of edit.entries().map(([uri]) => moved(uri))) {
        if (dirtyBefore.has(uri.toString())) {
            continue;
        }
        const document = await vscode.workspace.openTextDocument(uri);
        if (document.isDirty) {
            await document.save();
        }
    }
}

/** The type name a file stands for before and after a rename (a code file keeping its extension, to a name that is an identifier), or undefined */
export function typeNamesOfRename(oldPath: string, newPath: string): { oldName: string; newName: string } | undefined {
    const ext = path.extname(oldPath);
    if (!codeExtensions.includes(ext.toLowerCase()) || path.extname(newPath) !== ext) {
        return undefined;
    }
    const oldName = path.basename(oldPath, ext);
    const newName = path.basename(newPath, ext);
    return oldName === newName || !identifier.test(newName) ? undefined : { oldName, newName };
}

/** The language server's edit renaming the file's type, or undefined if not applicable or declined */
async function typeRenameEdit(oldPath: string, newPath: string): Promise<vscode.WorkspaceEdit | undefined> {
    const names = typeNamesOfRename(oldPath, newPath);
    if (!names) {
        return undefined;
    }
    return renameTypeOfFile(vscode.Uri.file(oldPath), names.oldName, names.newName, true);
}

/**
 * The language server's edit renaming the type `oldName` that `uri` declares (and its references) to `newName`, after asking;
 * undefined when the file has no such type, the user declines or there is no language server
 */
export async function renameTypeOfFile(uri: vscode.Uri, oldName: string, newName: string, modal: boolean): Promise<vscode.WorkspaceEdit | undefined> {
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>('vscode.executeDocumentSymbolProvider', uri);
    const type = findType(symbols ?? [], oldName);
    if (!type) {
        log.debug(`No type '${oldName}' found in ${uri.fsPath} (or no language server)`);
        return undefined;
    }

    const choice = await vscode.window.showInformationMessage(
        t('Would you also like to rename the type \'{0}\' to \'{1}\' and all references to it?', oldName, newName),
        { modal },
        t('Yes'),
        t('No')
    );
    if (choice !== t('Yes')) {
        return undefined;
    }

    const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit | undefined>('vscode.executeDocumentRenameProvider', uri, type.selectionRange.start, newName);
    if (!edit) {
        log.warn(`Language server returned no edit to rename '${oldName}' to '${newName}'`);
    } else {
        // what the server found: a rename that touches one file only has found no reference to the type
        const files = edit.entries().map(([target]) => target.fsPath);
        log.info(`Renaming the type '${oldName}' to '${newName}': the language server's edit touches ${new Set(files).size} file(s): ${[...new Set(files)].map(file => path.basename(file)).join(', ')}`);
    }
    return edit;
}

const typeKinds = (): vscode.SymbolKind[] => [
    vscode.SymbolKind.Class, // also records
    vscode.SymbolKind.Struct,
    vscode.SymbolKind.Interface,
    vscode.SymbolKind.Enum,
];

export function findType(symbols: vscode.DocumentSymbol[], name: string): vscode.DocumentSymbol | undefined {
    for (const symbol of symbols) {
        // Only DocumentSymbol has selectionRange (the name itself), which the rename needs
        if (symbol.name === name && typeKinds().includes(symbol.kind) && symbol.selectionRange) {
            return symbol;
        }
        const nested = findType(symbol.children ?? [], name);
        if (nested) {
            return nested;
        }
    }
    return undefined;
}

/** The type declared where the cursor was (its name starts there), whatever it is called now */
export function typeStartingAt(symbols: vscode.DocumentSymbol[], start: vscode.Position): vscode.DocumentSymbol | undefined {
    for (const symbol of symbols) {
        if (typeKinds().includes(symbol.kind) && symbol.selectionRange?.start.isEqual(start)) {
            return symbol;
        }
        const nested = typeStartingAt(symbol.children ?? [], start);
        if (nested) {
            return nested;
        }
    }
    return undefined;
}
