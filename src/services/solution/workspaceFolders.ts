import * as vscode from 'vscode';
import * as path from 'path';

// Multi-root workspaces: the extension works in the workspace folder that holds the active solution
// (its .vscode/launch.json, tasks, tool manifests), not just the first one.

let activeSolutionPath: string | undefined;

/** Set by SolutionService when a solution loads */
export function setActiveSolutionPath(solutionPath: string | undefined): void {
    activeSolutionPath = solutionPath;
}

/** The workspace folder that contains the file, or the first one for files outside the workspace */
export function workspaceFolderOf(filePath: string): vscode.WorkspaceFolder | undefined {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const inside = folders.filter(folder => {
        const relative = path.relative(folder.uri.fsPath, filePath);
        return !relative.startsWith('..') && !path.isAbsolute(relative);
    });
    // Nested workspace folders: the innermost
    return inside.sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length)[0] ?? folders[0];
}

/** The workspace folder of the active solution, or the first one before a solution is loaded */
export function solutionWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
    return activeSolutionPath ? workspaceFolderOf(activeSolutionPath) : vscode.workspace.workspaceFolders?.[0];
}
