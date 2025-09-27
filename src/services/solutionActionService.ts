import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../core/logger';
import { SolutionService } from './solutionService';
import { ProjectActionType } from '../webview/solution-view/types';

export interface MessageData {
    type?: string;
    newName?: string;
    [key: string]: any;
}

/**
 * Service responsible for handling all solution and project actions
 * Extracted from SolutionWebviewProvider to improve maintainability
 */
export class SolutionActionService {
    private static readonly logger = logger('SolutionActionService');

    /**
     * Handles a project action with the specified parameters
     */
    static async handleProjectAction(action: ProjectActionType, projectPath: string, data?: MessageData): Promise<void> {
        this.logger.info(`Executing project action: ${action} on ${projectPath}`);

        switch (action) {
            case 'openFile':
                await this._handleOpenFile(projectPath);
                break;

            case 'contextMenu':
                this.logger.info(`Context menu action for ${data?.type || 'unknown'} at ${projectPath}`);
                // Context menu actions are handled by the UI - this is just logging
                break;

            case 'rename':
                if (data?.newName) {
                    await this._handleRename(projectPath, data.newName, data.type, data.oldName);
                }
                break;

            case 'build':
                await this._handleBuild(projectPath, 'build');
                break;

            case 'rebuild':
                await this._handleBuild(projectPath, 'rebuild');
                break;

            case 'clean':
                await this._handleBuild(projectPath, 'clean');
                break;

            case 'restoreNugets':
                await this._handleBuild(projectPath, 'restore');
                break;

            case 'deleteFile':
                await this._handleDeleteFile(projectPath);
                break;

            case 'removeSolutionItem':
                await this._handleRemoveSolutionItem(projectPath);
                break;

            case 'revealInExplorer':
                await this._handleRevealInExplorer(projectPath);
                break;

            case 'addExistingProject':
                await this._handleAddExistingProject(projectPath);
                break;

            case 'addNewProject':
                await this._handleAddNewProject(projectPath);
                break;

            case 'startRename':
                // This action is handled by the UI - no backend action needed
                this.logger.info(`Start rename action for: ${projectPath}`);
                break;

            case 'collapseParent':
                // This action is handled by the UI - no backend action needed
                this.logger.info(`Collapse parent action for: ${projectPath}`);
                break;

            case 'addSolutionFolder':
                await this._handleAddSolutionFolder(projectPath, data);
                break;

            case 'removeSolutionFolder':
                await this._handleRemoveSolutionFolder(projectPath, data);
                break;

            case 'addSolutionItem':
                await this._handleAddSolutionItem(projectPath, data);
                break;

            case 'removeProject':
                await this._handleRemoveProject(projectPath);
                break;

            case 'deleteProject':
                await this._handleDeleteProject(projectPath);
                break;

            default:
                this.logger.warn(`Unknown project action: ${action}`);
                break;
        }
    }

    // Private action handlers

    private static async _handleOpenFile(filePath: string): Promise<void> {
        try {
            const uri = vscode.Uri.file(filePath);
            await vscode.window.showTextDocument(uri);
        } catch (error) {
            this.logger.error('Error opening file:', error);
            vscode.window.showErrorMessage(`Error opening file: ${error}`);
        }
    }

    private static async _handleRename(itemPath: string, newName: string, itemType?: string, oldName?: string): Promise<void> {
        this.logger.info(`Renaming ${itemType || 'item'} from '${oldName}' to '${newName}' at path: ${itemPath}`);

        try {
            if (itemType === 'solutionFolder') {
                // Handle solution folder rename
                const solution = SolutionService.getActiveSolution();
                if (solution) {
                    await solution.renameSolutionFolder(itemPath, newName);
                    this.logger.info(`Solution folder renamed successfully`);
                }
            } else {
                // Handle file/folder rename
                const oldPath = itemPath;
                const newPath = path.join(path.dirname(oldPath), newName);

                const oldUri = vscode.Uri.file(oldPath);
                const newUri = vscode.Uri.file(newPath);

                await vscode.workspace.fs.rename(oldUri, newUri);
                this.logger.info(`File/folder renamed from ${oldPath} to ${newPath}`);
            }
        } catch (error) {
            this.logger.error('Error renaming item:', error);
            vscode.window.showErrorMessage(`Error renaming: ${error}`);
        }
    }

    private static async _handleBuild(targetPath: string, action: 'build' | 'rebuild' | 'clean' | 'restore'): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                vscode.window.showErrorMessage('No active solution found');
                return;
            }

            // Determine if this is a solution or project
            const isSolution = targetPath.endsWith('.sln');
            const targetName = path.basename(targetPath, isSolution ? '.sln' : path.extname(targetPath));
            const targetType = isSolution ? 'Solution' : 'Project';

            const terminal = vscode.window.createTerminal(`${action} ${targetType}: ${targetName}`);
            terminal.show();

            let command = '';
            switch (action) {
                case 'build':
                    command = `dotnet build "${targetPath}"`;
                    break;
                case 'rebuild':
                    command = `dotnet clean "${targetPath}" && dotnet build "${targetPath}"`;
                    break;
                case 'clean':
                    command = `dotnet clean "${targetPath}"`;
                    break;
                case 'restore':
                    command = `dotnet restore "${targetPath}"`;
                    break;
            }

            terminal.sendText(command);
            this.logger.info(`Executed ${action} command for ${targetType}: ${command}`);
        } catch (error) {
            this.logger.error(`Error during ${action}:`, error);
            vscode.window.showErrorMessage(`Error during ${action}: ${error}`);
        }
    }

    private static async _handleDeleteFile(filePath: string): Promise<void> {
        try {
            const answer = await vscode.window.showWarningMessage(
                `Are you sure you want to delete '${path.basename(filePath)}'?`,
                { modal: true },
                'Delete'
            );

            if (answer === 'Delete') {
                const uri = vscode.Uri.file(filePath);
                await vscode.workspace.fs.delete(uri);
                this.logger.info(`File deleted: ${filePath}`);
                vscode.window.showInformationMessage(`File deleted: ${path.basename(filePath)}`);
            }
        } catch (error) {
            this.logger.error('Error deleting file:', error);
            vscode.window.showErrorMessage(`Error deleting file: ${error}`);
        }
    }

    private static async _handleRemoveSolutionItem(itemPath: string): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                vscode.window.showErrorMessage('No active solution found');
                return;
            }

            await solution.removeSolutionItem(itemPath);
            this.logger.info(`Solution item removed: ${itemPath}`);
            vscode.window.showInformationMessage(`Solution item removed: ${path.basename(itemPath)}`);
        } catch (error) {
            this.logger.error('Error removing solution item:', error);
            vscode.window.showErrorMessage(`Error removing solution item: ${error}`);
        }
    }

    private static async _handleRevealInExplorer(itemPath: string): Promise<void> {
        try {
            const uri = vscode.Uri.file(itemPath);
            await vscode.commands.executeCommand('revealFileInOS', uri);
        } catch (error) {
            this.logger.error('Error revealing in explorer:', error);
            vscode.window.showErrorMessage(`Error revealing in explorer: ${error}`);
        }
    }

    private static async _handleAddExistingProject(solutionPath: string): Promise<void> {
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
                await solution.addProject(projectFiles[0].fsPath);
                this.logger.info(`Existing project added: ${projectFiles[0].fsPath}`);
                vscode.window.showInformationMessage(`Project added: ${path.basename(projectFiles[0].fsPath)}`);
            }
        } catch (error) {
            this.logger.error('Error adding existing project:', error);
            vscode.window.showErrorMessage(`Error adding existing project: ${error}`);
        }
    }

    private static async _handleAddNewProject(solutionPath: string): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                vscode.window.showErrorMessage('No active solution found');
                return;
            }

            // Show a simple message for now - full implementation would require template selection
            vscode.window.showInformationMessage('Add new project functionality would be implemented here');
            this.logger.info('Add new project action triggered');
        } catch (error) {
            this.logger.error('Error adding new project:', error);
            vscode.window.showErrorMessage(`Error adding new project: ${error}`);
        }
    }

    private static async _handleAddSolutionFolder(solutionPath: string, data?: MessageData): Promise<void> {
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
                await solution.addSolutionFolder(folderName);
                this.logger.info(`Solution folder added: ${folderName}`);
                vscode.window.showInformationMessage(`Solution folder '${folderName}' added`);
            }
        } catch (error) {
            this.logger.error('Error adding solution folder:', error);
            vscode.window.showErrorMessage(`Error adding solution folder: ${error}`);
        }
    }

    private static async _handleRemoveSolutionFolder(folderPath: string, data?: MessageData): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                vscode.window.showErrorMessage('No active solution found');
                return;
            }

            // Try to get folder name from data first (safer), then fall back to path parsing
            const folderName = data?.name || path.basename(folderPath);
            const folderGuid = data?.guid;

            this.logger.info(`Removing solution folder: name="${folderName}", guid="${folderGuid}"`);

            const answer = await vscode.window.showWarningMessage(
                `Are you sure you want to remove solution folder '${folderName}'?`,
                { modal: true },
                'Remove'
            );

            if (answer === 'Remove') {
                // Use GUID-based removal if available, otherwise fall back to name-based
                if (folderGuid) {
                    await this._removeSolutionFolderByGuid(solution, folderGuid, folderName);
                } else {
                    await solution.removeSolutionFolder(folderName);
                }
                this.logger.info(`Solution folder removed: ${folderName}`);
                vscode.window.showInformationMessage(`Solution folder '${folderName}' removed`);
            }
        } catch (error) {
            this.logger.error('Error removing solution folder:', error);
            vscode.window.showErrorMessage(`Error removing solution folder: ${error}`);
        }
    }

    private static async _handleAddSolutionItem(folderPath: string, data?: MessageData): Promise<void> {
        try {
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

            if (fileUri && fileUri[0]) {
                // Try to get folder name from data first (safer), then fall back to path parsing
                const folderName = data?.name || path.basename(folderPath);
                const folderGuid = data?.guid;

                this.logger.info(`Adding solution item to folder: name="${folderName}", guid="${folderGuid}"`);

                await solution.addSolutionItem(folderName, fileUri[0].fsPath);
                this.logger.info(`Solution item added: ${fileUri[0].fsPath}`);
                vscode.window.showInformationMessage(`Solution item added: ${path.basename(fileUri[0].fsPath)}`);
            }
        } catch (error) {
            this.logger.error('Error adding solution item:', error);
            vscode.window.showErrorMessage(`Error adding solution item: ${error}`);
        }
    }

    private static async _handleRemoveProject(projectPath: string): Promise<void> {
        try {
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
                this.logger.info(`Project removed from solution: ${projectPath}`);
                vscode.window.showInformationMessage(`Project '${projectName}' removed from solution`);
            }
        } catch (error) {
            this.logger.error('Error removing project:', error);
            vscode.window.showErrorMessage(`Error removing project: ${error}`);
        }
    }

    private static async _handleDeleteProject(projectPath: string): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                vscode.window.showErrorMessage('No active solution found');
                return;
            }

            const projectName = path.basename(projectPath, path.extname(projectPath));
            const answer = await vscode.window.showWarningMessage(
                `Are you sure you want to delete project '${projectName}' from disk? This action cannot be undone.`,
                { modal: true },
                'Delete'
            );

            if (answer === 'Delete') {
                // First remove from solution
                await solution.removeProject(projectPath);

                // Then delete the project directory
                const projectDir = path.dirname(projectPath);
                const uri = vscode.Uri.file(projectDir);
                await vscode.workspace.fs.delete(uri, { recursive: true });

                this.logger.info(`Project deleted: ${projectPath}`);
                vscode.window.showInformationMessage(`Project '${projectName}' deleted`);
            }
        } catch (error) {
            this.logger.error('Error deleting project:', error);
            vscode.window.showErrorMessage(`Error deleting project: ${error}`);
        }
    }

    /**
     * Removes a solution folder by GUID (safer than name-based removal)
     */
    private static async _removeSolutionFolderByGuid(solution: any, folderGuid: string, folderName: string): Promise<void> {
        try {
            // For now, fall back to the name-based method since Solution class doesn't have GUID-based methods yet
            // TODO: Implement GUID-based removal in Solution class for better safety
            this.logger.info(`Using name-based removal for GUID ${folderGuid} (name: ${folderName})`);
            await solution.removeSolutionFolder(folderName);
        } catch (error) {
            this.logger.error(`Error in GUID-based solution folder removal:`, error);
            throw error;
        }
    }
}