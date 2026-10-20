import * as vscode from 'vscode';
import { projectForPath } from '../templates/templateService';
import { runCodeCleanup } from './codeCleanup';

/**
 * Code Cleanup of the file open in the editor (Ctrl+K, Ctrl+E). It saves the file, `dotnet format` rewrites it
 * on disk and VS Code reloads the clean file. Sorting usings is not part of it: the C# server offers it as the
 * "Sort Usings" quick action, not as `source.organizeImports`, which `editor.action.organizeImports` asks for.
 */
export async function runCodeCleanupOnActiveFile(): Promise<void> {
    const document = vscode.window.activeTextEditor?.document;
    if (!document || document.uri.scheme !== 'file' || !document.fileName.toLowerCase().endsWith('.cs')) {
        vscode.window.showInformationMessage('Code Cleanup works on C# files: open one first.');
        return;
    }
    const projectPath = projectForPath(document.fileName);
    if (!projectPath) {
        vscode.window.showInformationMessage('Code Cleanup works on files of a project of the solution.');
        return;
    }
    await runCodeCleanup({ kind: 'file', path: document.fileName, projectPath });
}
