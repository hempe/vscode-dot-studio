const env = {
    symbols: undefined as any[] | undefined,
    renameEdit: undefined as any,
    choice: undefined as string | undefined,
    prompts: [] as string[],
    commands: [] as unknown[][],
    appliedEdits: [] as any[],
    fsRenames: [] as string[][],
    saved: [] as string[],
    dirty: new Set<string>(),
};

jest.mock('vscode', () => {
    class Position { constructor(public line: number, public character: number) { } }
    class Range { constructor(public start: Position, public end: Position) { } }
    class WorkspaceEdit {
        operations: string[] = [];
        private uris: { fsPath: string }[] = [];
        replace(uri: { fsPath: string }) { this.operations.push(`edit ${uri.fsPath}`); this.uris.push(uri); }
        renameFile(from: { fsPath: string }, to: { fsPath: string }) { this.operations.push(`rename ${from.fsPath} -> ${to.fsPath}`); }
        entries() { return this.uris.map(uri => [uri, []]); }
    }
    const uri = (fsPath: string) => ({ fsPath, toString: () => fsPath });
    const doc = (fsPath: string) => ({ uri: uri(fsPath), get isDirty() { return env.dirty.has(fsPath); }, save: async () => { env.saved.push(fsPath); env.dirty.delete(fsPath); return true; } });
    return {
        Position, Range, WorkspaceEdit,
        SymbolKind: { Namespace: 2, Class: 4, Enum: 9, Interface: 10, Struct: 22, Method: 5 },
        Uri: { file: uri },
        commands: {
            executeCommand: async (command: string, ...args: unknown[]) => {
                env.commands.push([command, ...args]);
                if (command === 'vscode.executeDocumentSymbolProvider') return env.symbols;
                if (command === 'vscode.executeDocumentRenameProvider') return env.renameEdit;
                return undefined;
            },
        },
        window: {
            showInformationMessage: async (message: string, _options: unknown, ...items: string[]) => {
                env.prompts.push(message);
                return items.find(i => i === env.choice);
            },
        },
        workspace: {
            get textDocuments() { return ['/p/Foo.cs', '/p/Program.cs'].map(doc); },
            openTextDocument: async (u: { fsPath: string }) => doc(u.fsPath),
            applyEdit: async (edit: any) => {
                env.appliedEdits.push(edit);
                // Edited documents become dirty; the renamed one moves to its new path
                for (const [u] of edit.entries()) env.dirty.add(u.fsPath === '/p/Foo.cs' ? '/p/Bar.cs' : u.fsPath);
                return true;
            },
            fs: { rename: async (from: any, to: any) => { env.fsRenames.push([from.fsPath, to.fsPath]); } },
        },
    };
}, { virtual: true });

import * as vscode from 'vscode';
import { renameFileAndType } from '../../../services/typeRename';

const symbol = (name: string, kind: number, line: number, children: any[] = []) => ({
    name,
    kind,
    selectionRange: new vscode.Range(new vscode.Position(line, 13), new vscode.Position(line, 13 + name.length)),
    children,
});

describe('renameFileAndType', () => {
    beforeEach(() => {
        Object.assign(env, { symbols: undefined, renameEdit: undefined, choice: undefined, prompts: [], commands: [], appliedEdits: [], fsRenames: [], saved: [], dirty: new Set() });
    });

    const renameEdit = () => {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(vscode.Uri.file('/p/Foo.cs'), undefined as any, 'Bar');
        edit.replace(vscode.Uri.file('/p/Program.cs'), undefined as any, 'Bar');
        return edit;
    };

    it('renames the type and its references together with the file when confirmed', async () => {
        env.symbols = [symbol('App', vscode.SymbolKind.Namespace, 0, [symbol('Foo', vscode.SymbolKind.Class, 2)])];
        env.renameEdit = renameEdit();
        env.choice = 'Yes';

        await renameFileAndType('/p/Foo.cs', '/p/Bar.cs');

        expect(env.prompts).toEqual(["Would you also like to rename the type 'Foo' to 'Bar' and all references to it?"]);
        const renameCall = env.commands.find(c => c[0] === 'vscode.executeDocumentRenameProvider')!;
        expect(renameCall[1]).toEqual(expect.objectContaining({ fsPath: '/p/Foo.cs' }));
        expect(renameCall[2]).toEqual(new vscode.Position(2, 13));
        expect(renameCall[3]).toBe('Bar');
        expect(env.appliedEdits).toHaveLength(1);
        expect(env.appliedEdits[0].operations).toEqual(['edit /p/Foo.cs', 'edit /p/Program.cs', 'rename /p/Foo.cs -> /p/Bar.cs']);
        expect(env.fsRenames).toEqual([]);
        expect(env.saved.sort()).toEqual(['/p/Bar.cs', '/p/Program.cs']);
    });

    it('does not save documents that already had unsaved changes', async () => {
        env.symbols = [symbol('Foo', vscode.SymbolKind.Class, 0)];
        env.renameEdit = renameEdit();
        env.choice = 'Yes';
        env.dirty.add('/p/Program.cs');

        await renameFileAndType('/p/Foo.cs', '/p/Bar.cs');

        expect(env.saved).toEqual(['/p/Bar.cs']);
    });

    it('only renames the file when declined', async () => {
        env.symbols = [symbol('Foo', vscode.SymbolKind.Interface, 0)];
        env.choice = 'No';

        await renameFileAndType('/p/Foo.cs', '/p/Bar.cs');

        expect(env.prompts).toHaveLength(1);
        expect(env.appliedEdits).toEqual([]);
        expect(env.fsRenames).toEqual([['/p/Foo.cs', '/p/Bar.cs']]);
    });

    it.each([
        ['no type with the file name', '/p/Foo.cs', '/p/Bar.cs', () => [symbol('Other', vscode.SymbolKind.Class, 0)]],
        ['a method with the file name', '/p/Foo.cs', '/p/Bar.cs', () => [symbol('Foo', vscode.SymbolKind.Method, 0)]],
        ['no language server', '/p/Foo.cs', '/p/Bar.cs', () => undefined],
        ['not a code file', '/p/Foo.json', '/p/Bar.json', () => [symbol('Foo', vscode.SymbolKind.Class, 0)]],
        ['extension changed', '/p/Foo.cs', '/p/Foo.txt', () => [symbol('Foo', vscode.SymbolKind.Class, 0)]],
        ['new name is not an identifier', '/p/Foo.cs', '/p/My Foo.cs', () => [symbol('Foo', vscode.SymbolKind.Class, 0)]],
    ])('only renames the file when there is %s', async (_, from, to, symbols) => {
        env.symbols = symbols();

        await renameFileAndType(from, to);

        expect(env.prompts).toEqual([]);
        expect(env.fsRenames).toEqual([[from, to]]);
    });

    it('falls back to a file rename when the language server returns no edit', async () => {
        env.symbols = [symbol('Foo', vscode.SymbolKind.Struct, 0)];
        env.choice = 'Yes';

        await renameFileAndType('/p/Foo.cs', '/p/Bar.cs');

        expect(env.appliedEdits).toEqual([]);
        expect(env.fsRenames).toEqual([['/p/Foo.cs', '/p/Bar.cs']]);
    });
});
