import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../../../core/logger';
import { SolutionService } from '../solutionService';
import { NodeId } from '../nodeIdService';
import { deleteProjectPlan } from '../../project/deleteProject';

const log = logger('solutionFileActions');

export async function handleRemoveSolutionItem(nodeId: NodeId): Promise<void> {
    try {
        const itemPath = nodeId.path;
        if (!itemPath) {
            log.error('Cannot extract path from nodeId:', nodeId);
            vscode.window.showErrorMessage('Error: Cannot determine path to remove solution item');
            return;
        }

        const solution = SolutionService.getActiveSolution();
        if (!solution) {
            vscode.window.showErrorMessage('No active solution found');
            return;
        }

        const itemName = path.basename(itemPath);

        const answer = await vscode.window.showWarningMessage(
            `Are you sure you want to remove solution item '${itemName}' from the solution?\n\nNote: The file will not be deleted from disk.`,
            { modal: true },
            'Remove'
        );

        if (answer === 'Remove') {
            await solution.removeSolutionItem(itemPath);
            log.info(`Solution item removed: ${itemPath}`);
        }
    } catch (error) {
        log.error('Error removing solution item:', error);
        vscode.window.showErrorMessage(`Error removing solution item: ${error}`);
    }
}

/** Matches the project files `dotnet sln add` accepts */
export const projectFile = /\.(cs|vb|fs)proj$/i;

/** `dotnet sln add --solution-folder` path of a solution folder node; undefined for the solution root */
export function solutionFolderPathOf(nodeId: NodeId): string | undefined {
    return nodeId.type === 'solutionFolder'
        ? SolutionService.getActiveSolution()?.getSolutionFolderPath(nodeId.guid)
        : undefined;
}

export async function handleAddExistingProject(nodeId: NodeId): Promise<void> {
    try {
        const solution = SolutionService.getActiveSolution();
        if (!solution) {
            vscode.window.showErrorMessage('No active solution found');
            return;
        }

        const projectFiles = await vscode.window.showOpenDialog({
            canSelectMany: false,
            canSelectFiles: true,
            canSelectFolders: false,
            filters: {
                'Project Files': ['csproj', 'vbproj', 'fsproj']
            },
            openLabel: 'Add Project'
        });

        if (projectFiles && projectFiles[0]) {
            await solution.addProject(projectFiles[0].fsPath, solutionFolderPathOf(nodeId));
            log.info(`Existing project added: ${projectFiles[0].fsPath}`);
        }
    } catch (error) {
        log.error('Error adding existing project:', error);
        vscode.window.showErrorMessage(`Error adding existing project: ${error}`);
    }
}

export async function handleAddSolutionFolder(nodeId: NodeId): Promise<void> {
    try {
        const solution = SolutionService.getActiveSolution();
        if (!solution) {
            vscode.window.showErrorMessage('No active solution found');
            return;
        }

        const folderName = await vscode.window.showInputBox({
            prompt: 'Enter solution folder name',
            placeHolder: 'Solution folder name'
        });

        if (folderName) {
            await solution.addSolutionFolder(folderName, nodeId.type == 'solutionFolder' ? nodeId : undefined);
            log.info(`Solution folder added: ${folderName}`);
        }
    } catch (error) {
        log.error('Error adding solution folder:', error);
        vscode.window.showErrorMessage(`Error adding solution folder: ${error}`);
    }
}

export async function handleRemoveSolutionFolder(nodeId: NodeId): Promise<void> {
    try {
        const folderPath = nodeId.path;
        if (!folderPath || nodeId.type !== 'solutionFolder') {
            log.error('Cannot extract solution folder path from nodeId:', nodeId);
            vscode.window.showErrorMessage('Error: Cannot determine solution folder path for removal');
            return;
        }

        const solution = SolutionService.getActiveSolution();
        if (!solution) {
            vscode.window.showErrorMessage('No active solution found');
            return;
        }

        const folderName = nodeId.name;
        log.info(`Removing solution folder: name="${folderName}", guid="${nodeId.guid}"`);

        const answer = await vscode.window.showWarningMessage(
            `Are you sure you want to remove solution folder '${folderName}'?`,
            { modal: true },
            'Remove'
        );

        if (answer === 'Remove') {
            await solution.removeSolutionFolder(nodeId.guid);
            log.info(`Solution folder removed: ${folderName}`);
        }
    } catch (error) {
        log.error('Error removing solution folder:', error);
        vscode.window.showErrorMessage(`Error removing solution folder: ${error}`);
    }
}

export async function handleAddSolutionItem(nodeId: NodeId): Promise<void> {
    try {
        const folderPath = nodeId.path;
        if (!folderPath) {
            log.error('Cannot extract folder path from nodeId:', nodeId);
            return
        }

        const solution = SolutionService.getActiveSolution();
        if (!solution) {
            vscode.window.showErrorMessage('No active solution found');
            return;
        }

        const fileUri = await vscode.window.showOpenDialog({
            canSelectMany: false,
            canSelectFiles: true,
            canSelectFolders: false,
            openLabel: 'Add to Solution'
        });

        // A project file belongs in the solution as a project, not as a plain item
        if (fileUri?.[0] && projectFile.test(fileUri[0].fsPath)) {
            await solution.addProject(fileUri[0].fsPath, solutionFolderPathOf(nodeId));
            return;
        }

        if (fileUri && fileUri[0]) {
            // Check if we're adding to the solution root or to a specific folder
            let targetFolderGuid: string | null | undefined;

            if (nodeId.type === 'solution') {
                // Adding to solution root - ensure "Solution Items" folder exists
                const solutionItemsFolderName = 'Solution Items';
                // Check if "Solution Items" folder already exists
                const existingFolders = solution.getSolutionFolders();
                const solutionItemsExists = existingFolders.some(folder => folder.name === solutionItemsFolderName);

                if (!solutionItemsExists) {
                    log.info(`Creating "${solutionItemsFolderName}" folder for solution items`);
                    await solution.addSolutionFolder(solutionItemsFolderName);
                }
                targetFolderGuid = solution.findSolutionFolderGuid(solutionItemsFolderName);
            } else if (nodeId.type == 'solutionFolder') {
                // Adding to an existing solution folder
                targetFolderGuid = nodeId.guid;
            }

            log.info(`Adding solution item to folder: guid="${targetFolderGuid}"`);

            await solution.addSolutionItem(targetFolderGuid!, fileUri[0].fsPath);
            log.info(`Solution item added: ${fileUri[0].fsPath}`);
        }
    } catch (error) {
        log.error('Error adding solution item:', error);
        vscode.window.showErrorMessage(`Error adding solution item: ${error}`);
    }
}

export async function handleRemoveProject(nodeId: NodeId): Promise<void> {
    try {
        const projectPath = nodeId.path;
        if (!projectPath) {
            log.error('Cannot extract project path from nodeId:', nodeId);
            vscode.window.showErrorMessage('Error: Cannot determine project path');
            return;
        }

        const solution = SolutionService.getActiveSolution();
        if (!solution) {
            vscode.window.showErrorMessage('No active solution found');
            return;
        }

        const projectName = path.basename(projectPath, path.extname(projectPath));
        const answer = await vscode.window.showWarningMessage(
            `Are you sure you want to remove project '${projectName}' from the solution?`,
            { modal: true },
            'Remove'
        );

        if (answer === 'Remove') {
            await solution.removeProject(projectPath);
            log.info(`Project removed from solution: ${projectPath}`);
        }
    } catch (error) {
        log.error('Error removing project:', error);
        vscode.window.showErrorMessage(`Error removing project: ${error}`);
    }
}

export async function handleDeleteProject(nodeId: NodeId): Promise<void> {
    try {
        const projectPath = nodeId.path;
        if (!projectPath) {
            log.error('Cannot extract project path from nodeId:', nodeId);
            vscode.window.showErrorMessage('Error: Cannot determine project path for deletion');
            return;
        }
        const solution = SolutionService.getActiveSolution();
        if (!solution) {
            vscode.window.showErrorMessage('No active solution found');
            return;
        }

        const projectName = path.basename(projectPath, path.extname(projectPath));
        const plan = deleteProjectPlan(projectPath, solution.solutionPath, [...solution.projects.values()].map(project => project.projectPath));
        const what = plan.kind === 'folder'
            ? 'its folder is moved to the trash'
            : `only the project file is moved to the trash, because ${plan.reason}`;
        const answer = await vscode.window.showWarningMessage(
            `Delete project '${projectName}'? It is removed from the solution and ${what}.`,
            { modal: true },
            'Delete'
        );

        if (answer === 'Delete') {
            // First remove from solution
            await solution.removeProject(projectPath);

            await vscode.workspace.fs.delete(vscode.Uri.file(plan.path), { recursive: plan.kind === 'folder', useTrash: true });

            log.info(`Project deleted: ${projectPath}`);
        }
    } catch (error) {
        log.error('Error deleting project:', error);
        vscode.window.showErrorMessage(`Error deleting project: ${error}`);
    }
}

/**
 * Handles setting a project as the startup project
 */
export async function handleSetStartupProject(nodeId: NodeId): Promise<void> {
    try {
        const projectPath = nodeId.path;
        if (!projectPath) {
            log.error('Cannot extract project path from nodeId:', nodeId);
            vscode.window.showErrorMessage('Error: Cannot determine project path');
            return;
        }

        log.info(`Setting startup project: ${projectPath}`);

        const solution = SolutionService.getActiveSolution();
        if (!solution) {
            vscode.window.showErrorMessage('No solution is currently open');
            return;
        }

        // Set the startup project in the solution
        await solution.setStartupProject(projectPath);



        log.info(`Successfully set startup project: ${projectPath}`);
    } catch (error) {
        log.error('Error setting startup project:', error);
        vscode.window.showErrorMessage(`Error setting startup project: ${error}`);
    }
}
