import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../../core/logger';
import { SolutionService } from '../solutionService';
import { NodeId } from '../nodeIdService';
import { updateNamespacesAfterMove } from '../namespaceAfterMove';
import { renameFileAndType } from '../typeRename';
import { itemNameProblem } from '../itemNames';
import { DebugConfigService } from '../debugConfigService';
import { dependentRenames } from '../templates/dependentRenames';

const log = logger('renameActions');

/** Renames the project file like Visual Studio; the startup configuration follows a renamed startup project */
export async function renameProject(projectPath: string, newName: string): Promise<void> {
    const solution = SolutionService.getActiveSolution();
    if (!solution) {
        return;
    }
    const wasStartup = DebugConfigService.getStartupProject() === projectPath;
    const framework = DebugConfigService.getActiveFramework() ?? undefined;
    const newPath = await solution.renameProject(projectPath, newName);
    if (wasStartup && newPath !== projectPath) {
        await DebugConfigService.updateStartupConfiguration(newPath, framework);
    }
}

/** Renames the solution file and opens it under its new name */
export async function renameSolution(solutionPath: string, newName: string): Promise<void> {
    const name = newName.trim();
    if (!name || /[\\/:*?"<>|]/.test(name)) {
        throw new Error(`Invalid solution name "${newName}"`);
    }
    const newPath = path.join(path.dirname(solutionPath), name + path.extname(solutionPath));
    if (newPath === solutionPath) {
        return;
    }
    if (fs.existsSync(newPath) && newPath.toLowerCase() !== solutionPath.toLowerCase()) {
        throw new Error(`${path.basename(newPath)} already exists`);
    }
    await fs.promises.rename(solutionPath, newPath);
    await SolutionService.openSolution(newPath);
    await vscode.commands.executeCommand('shinobi.internal.refreshSolution');
}

export async function handleRename(nodeId: NodeId, newName: string, itemType?: string, oldName?: string): Promise<void> {
    log.info(`Renaming ${itemType || 'item'} from '${oldName}' to '${newName}' for nodeId: ${nodeId}`);

    try {
        if (nodeId.type === 'file' || nodeId.type === 'folder' || nodeId.type === 'project' || nodeId.type === 'solutionItem') {
            const problem = itemNameProblem(newName);
            if (problem) {
                vscode.window.showErrorMessage(`Cannot rename to "${newName}": ${problem}`);
                return;
            }
        }
        if (nodeId.type === 'solutionFolder') {
            const solution = SolutionService.getActiveSolution();
            if (solution) {
                await solution.renameSolutionFolder(nodeId.guid, newName);
                log.info(`Solution folder renamed successfully`);
            }
        } else if (nodeId.type === 'solutionItem') {
            await renameSolutionItem(nodeId.guid, nodeId.path, newName);
        } else if (nodeId.type === 'project') {
            await renameProject(nodeId.path, newName);
        } else if (nodeId.type === 'solution') {
            await renameSolution(nodeId.path, newName);
        } else {
            // Handle file/folder rename - extract the file system path
            const oldPath = nodeId.type == 'file' ? nodeId.path
                : nodeId.type == 'folder' ? nodeId.path
                    : '';

            if (!oldPath) {
                log.error('Cannot extract file path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine file path for rename');
                return;
            }

            const newPath = path.join(path.dirname(oldPath), newName);

            if (nodeId.type === 'file') {
                // Nested files (Form1.Designer.cs, Index.cshtml.cs) move with their parent
                const directory = path.dirname(oldPath);
                const dependents = dependentRenames(
                    (await fs.promises.readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => path.join(directory, entry.name)),
                    oldPath,
                    newName
                );
                await renameFileAndType(oldPath, newPath);
                for (const [from, to] of dependents) {
                    if (fs.existsSync(to)) {
                        log.warn(`Not renaming ${from}: ${to} already exists`);
                        continue;
                    }
                    await vscode.workspace.fs.rename(vscode.Uri.file(from), vscode.Uri.file(to));
                }
            } else {
                await vscode.workspace.fs.rename(vscode.Uri.file(oldPath), vscode.Uri.file(newPath));
            }
            log.info(`File/folder renamed from ${oldPath} to ${newPath}`);

            // Check if namespace updates are needed after rename
            await updateNamespacesAfterMove([newPath], nodeId.type === 'folder' ? 'Folder renamed' : 'File renamed');
        }
    } catch (error) {
        log.error('Error renaming item:', error);
        vscode.window.showErrorMessage(`Error renaming: ${error}`);
    }
}

/**
 * Renames a solution item on disk and updates its reference in the solution folder
 */
export async function renameSolutionItem(folderGuid: string, oldPath: string, newName: string): Promise<void> {
    const solution = SolutionService.getActiveSolution();
    if (!solution) {
        vscode.window.showErrorMessage('No active solution found');
        return;
    }
    if (!newName.trim() || /[\\/]/.test(newName)) {
        vscode.window.showErrorMessage(`Invalid file name '${newName}'`);
        return;
    }

    const newPath = path.join(path.dirname(oldPath), newName);
    if (fs.existsSync(oldPath)) {
        await vscode.workspace.fs.rename(vscode.Uri.file(oldPath), vscode.Uri.file(newPath));
        log.info(`Solution item file renamed from ${oldPath} to ${newPath}`);
    }

    await solution.removeSolutionItem(oldPath);
    await solution.addSolutionItem(folderGuid, newPath);
    log.info(`Solution item reference updated to ${newPath}`);
}
