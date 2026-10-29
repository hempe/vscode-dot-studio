import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../../core/logger';

const log = logger('TypeRename');

const codeExtensions = ['.cs', '.vb'];

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Renames a file like Visual Studio: if a C#/VB file declares a type named after the file,
 * offers to rename the type and all references to it through the language server, together with the file.
 * Otherwise (declined, no matching type, no language server) only the file is renamed.
 */
export async function renameFileAndType(oldPath: string, newPath: string): Promise<void> {
    const oldUri = vscode.Uri.file(oldPath);
    const newUri = vscode.Uri.file(newPath);

    const edit = await typeRenameEdit(oldPath, newPath);
    if (!edit) {
        await vscode.workspace.fs.rename(oldUri, newUri);
        return;
    }

    const dirtyBefore = new Set(vscode.workspace.textDocuments.filter(d => d.isDirty).map(d => d.uri.toString()));

    // Text edits apply to the old path, then the file moves, all in one undoable operation
    edit.renameFile(oldUri, newUri);
    if (!await vscode.workspace.applyEdit(edit)) {
        throw new Error(`Could not rename ${path.basename(oldPath)}`);
    }

    // Save what the rename changed, like Visual Studio; leave other unsaved changes alone
    const changed = edit.entries().map(([uri]) => uri.fsPath === oldPath ? newUri : uri);
    for (const uri of changed) {
        if (dirtyBefore.has(uri.toString())) {
            continue;
        }
        const document = await vscode.workspace.openTextDocument(uri);
        if (document.isDirty) {
            await document.save();
        }
    }
}

/** The language server's edit renaming the file's type, or undefined if not applicable or declined */
async function typeRenameEdit(oldPath: string, newPath: string): Promise<vscode.WorkspaceEdit | undefined> {
    const ext = path.extname(oldPath);
    if (!codeExtensions.includes(ext.toLowerCase()) || path.extname(newPath) !== ext) {
        return undefined;
    }

    const oldName = path.basename(oldPath, ext);
    const newName = path.basename(newPath, ext);
    if (oldName === newName || !identifier.test(newName)) {
        return undefined;
    }

    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>(
        'vscode.executeDocumentSymbolProvider',
        vscode.Uri.file(oldPath)
    );
    const type = findType(symbols ?? [], oldName);
    if (!type) {
        log.debug(`No type '${oldName}' found in ${oldPath} (or no language server)`);
        return undefined;
    }

    const choice = await vscode.window.showInformationMessage(
        `Would you also like to rename the type '${oldName}' to '${newName}' and all references to it?`,
        { modal: true },
        'Yes',
        'No'
    );
    if (choice !== 'Yes') {
        return undefined;
    }

    const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit | undefined>(
        'vscode.executeDocumentRenameProvider',
        vscode.Uri.file(oldPath),
        type.selectionRange.start,
        newName
    );
    if (!edit) {
        log.warn(`Language server returned no edit to rename '${oldName}' to '${newName}'`);
    }
    return edit;
}

function findType(symbols: vscode.DocumentSymbol[], name: string): vscode.DocumentSymbol | undefined {
    const typeKinds = [
        vscode.SymbolKind.Class, // also records
        vscode.SymbolKind.Struct,
        vscode.SymbolKind.Interface,
        vscode.SymbolKind.Enum,
    ];
    for (const symbol of symbols) {
        // Only DocumentSymbol has selectionRange (the name itself), which the rename needs
        if (symbol.name === name && typeKinds.includes(symbol.kind) && symbol.selectionRange) {
            return symbol;
        }
        const nested = findType(symbol.children ?? [], name);
        if (nested) {
            return nested;
        }
    }
    return undefined;
}
