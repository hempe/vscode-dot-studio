import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../core/logger';
import { SolutionService } from './solutionService';
import { NodeId, NodeIdService } from './nodeIdService';
import { NamespaceService } from './namespaceService';
import { ProjectActionCmd } from '../types/projectActionCmd';
import { NodeIdString } from '../types/nodeId';

const log = logger('SolutionActionService');

export interface MessageData {
    type?: string;
    newName?: string;
    name?: string;
    isConfirmed?: boolean;
    [key: string]: any;
}

/**
 * Service responsible for handling all solution and project actions
 * Extracted from SolutionWebviewProvider to improve maintainability
 */
export class SolutionActionService {

    /**
     * Handles a project action with strongly-typed command
     */
    static async handleProjectAction(cmd: ProjectActionCmd): Promise<void> {
        const nodeId = NodeIdService.parse(cmd.nodeId);
        if (!nodeId) {
            log.error(`Invalid nodeId: ${cmd.nodeId}`);
            return;
        }

        log.info(`Executing project action: ${cmd.action} on nodeId: ${nodeId}`);

        switch (cmd.action) {
            case 'openFile':
                await this._handleOpenFile(nodeId);
                break;

            case 'contextMenu':
                log.info(`Context menu action on nodeId: ${nodeId}`);
                // Context menu actions are handled by the UI - this is just logging
                break;

            case 'rename':
                await this._handleRename(nodeId, cmd.data.newName, cmd.data.type, cmd.data.oldName);
                break;

            case 'build':
                await this._handleBuild(nodeId, 'build');
                break;

            case 'rebuild':
                await this._handleBuild(nodeId, 'rebuild');
                break;

            case 'clean':
                await this._handleBuild(nodeId, 'clean');
                break;

            case 'restoreNugets':
                await this._handleBuild(nodeId, 'restore');
                break;

            case 'deleteFile':
                await this._handleDeleteFile(nodeId);
                break;

            case 'removeSolutionItem':
                await this._handleRemoveSolutionItem(nodeId);
                break;

            case 'revealInExplorer':
                await this._handleRevealInExplorer(nodeId);
                break;

            case 'addExistingProject':
                await this._handleAddExistingProject();
                break;

            case 'addNewProject':
                await this._handleAddNewProject();
                break;

            case 'startRename':
                // This action is handled by the UI - no backend action needed
                log.info(`Start rename action for nodeId: ${nodeId}`);
                break;

            case 'collapseParent':
                // This action is handled by the UI - no backend action needed
                log.info(`Collapse parent action for nodeId: ${nodeId}`);
                break;

            case 'manageNuGetPackages':
                await this._handleManageNuGetPackages(nodeId);
                break;

            case 'manageNuGetPackagesForSolution':
                await this._handleManageNuGetPackagesForSolution(nodeId);
                break;

            case 'addProjectReference':
                await this._handleAddProjectReference(nodeId);
                break;

            case 'restoreDependencies':
                await this._handleRestoreDependencies(nodeId);
                break;

            case 'removeDependency':
                await this._handleRemoveDependency(nodeId);
                break;

            case 'addSolutionFolder':
                await this._handleAddSolutionFolder(cmd.data);
                break;

            case 'removeSolutionFolder':
                await this._handleRemoveSolutionFolder(nodeId, cmd.data);
                break;

            case 'addSolutionItem':
                await this._handleAddSolutionItem(nodeId, cmd.data);
                break;

            case 'removeProject':
                await this._handleRemoveProject(nodeId);
                break;

            case 'deleteProject':
                await this._handleDeleteProject(nodeId);
                break;

            case 'setStartupProject':
                await this._handleSetStartupProject(nodeId);
                break;

            case 'copy':
                await this._handleCopy(nodeId, cmd.nodeId, cmd.data);
                break;

            case 'cut':
                await this._handleCut(nodeId, cmd.nodeId, cmd.data);
                break;

            case 'paste':
                await this._handlePaste(nodeId, undefined);
                break;

            case 'addFile':
            case 'addFolder':
            case 'cancelTemporaryNode':
                // These actions are handled by the webview provider, not here
                log.info(`${cmd.action} action is handled by webview provider`);
                break;

            default:
                // TypeScript exhaustiveness check
                const _exhaustive: never = cmd;
                log.warn(`Unknown project action:`, _exhaustive);
                break;
        }
    }

    // Private action handlers

    private static async _handleOpenFile(nodeId: NodeId): Promise<void> {
        try {
            // Extract the file system path from the nodeId
            // For solution items, use itemPath instead of filePath
            const filePath = nodeId.filePath ?? nodeId.itemPath;
            if (!filePath) {
                log.error('Cannot extract file path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine file path to open');
                return;
            }

            const uri = vscode.Uri.file(filePath);
            await vscode.window.showTextDocument(uri);
        } catch (error) {
            log.error('Error opening file:', error);
            vscode.window.showErrorMessage(`Error opening file: ${error}`);
        }
    }

    private static async _handleRename(nodeId: NodeId, newName: string, itemType?: string, oldName?: string): Promise<void> {
        log.info(`Renaming ${itemType || 'item'} from '${oldName}' to '${newName}' for nodeId: ${nodeId}`);

        try {
            if (nodeId.type === 'solutionFolder') {
                // Handle solution folder rename - extract the solution folder path
                const itemPath = nodeId.solutionPath;
                if (!itemPath) {
                    log.error('Cannot extract solution folder path from nodeId:', nodeId);
                    vscode.window.showErrorMessage('Error: Cannot determine solution folder path for rename');
                    return;
                }

                const solution = SolutionService.getActiveSolution();
                if (solution) {
                    await solution.renameSolutionFolder(itemPath, newName);
                    log.info(`Solution folder renamed successfully`);
                }
            } else {
                // Handle file/folder rename - extract the file system path
                const oldPath = nodeId.filePath ?? nodeId.folderPath;
                if (!oldPath) {
                    log.error('Cannot extract file path from nodeId:', nodeId);
                    vscode.window.showErrorMessage('Error: Cannot determine file path for rename');
                    return;
                }

                const newPath = path.join(path.dirname(oldPath), newName);

                const oldUri = vscode.Uri.file(oldPath);
                const newUri = vscode.Uri.file(newPath);

                await vscode.workspace.fs.rename(oldUri, newUri);
                log.info(`File/folder renamed from ${oldPath} to ${newPath}`);

                // Check if namespace updates are needed after rename
                await this._handleNamespaceUpdatesAfterRename(oldPath, newPath, itemType);
            }
        } catch (error) {
            log.error('Error renaming item:', error);
            vscode.window.showErrorMessage(`Error renaming: ${error}`);
        }
    }

    private static async _handleBuild(nodeId: NodeId, action: 'build' | 'rebuild' | 'clean' | 'restore'): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                vscode.window.showErrorMessage('No active solution found');
                return;
            }

            const targetPath = nodeId.filePath;
            if (!targetPath) {
                log.error('Cannot extract solution or project path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine solution or project path for build action');
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
            log.info(`Executed ${action} command for ${targetType}: ${command}`);
        } catch (error) {
            log.error(`Error during ${action}:`, error);
            vscode.window.showErrorMessage(`Error during ${action}: ${error}`);
        }
    }

    private static async _handleDeleteFile(nodeId: NodeId): Promise<void> {
        try {
            // Extract the file system path from the nodeId
            const filePath = nodeId.filePath;
            if (!filePath) {
                log.error('Cannot extract file path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine file path for deletion');
                return;
            }

            // Check if it's a directory
            const stats = await fs.promises.stat(filePath);
            const isDirectory = stats.isDirectory();
            const itemType = isDirectory ? 'folder' : 'file';

            const answer = await vscode.window.showWarningMessage(
                `Are you sure you want to delete this ${itemType} '${path.basename(filePath)}'?${isDirectory ? ' This will delete all its contents.' : ''}`,
                { modal: true },
                'Delete'
            );

            if (answer === 'Delete') {
                const uri = vscode.Uri.file(filePath);
                // Use recursive delete for directories, regular delete for files
                await vscode.workspace.fs.delete(uri, { recursive: isDirectory });
                log.info(`${itemType} deleted: ${filePath}`);
                vscode.window.showInformationMessage(`${itemType.charAt(0).toUpperCase() + itemType.slice(1)} deleted: ${path.basename(filePath)}`);
            }
        } catch (error) {
            log.error('Error deleting file/folder:', error);
            vscode.window.showErrorMessage(`Error deleting: ${error}`);
        }
    }

    private static async _handleRemoveSolutionItem(nodeId: NodeId): Promise<void> {
        try {
            const itemPath = nodeId.itemPath;
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
                vscode.window.showInformationMessage(`Solution item '${itemName}' removed from solution`);
            }
        } catch (error) {
            log.error('Error removing solution item:', error);
            vscode.window.showErrorMessage(`Error removing solution item: ${error}`);
        }
    }

    private static async _handleRevealInExplorer(nodeId: NodeId): Promise<void> {
        try {
            const itemPath = nodeId.filePath ?? nodeId.folderPath ?? nodeId.itemPath;
            if (!itemPath) {
                log.error('Cannot extract path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine path to reveal in explorer');
                return;
            }

            const uri = vscode.Uri.file(itemPath);
            await vscode.commands.executeCommand('revealFileInOS', uri);
        } catch (error) {
            log.error('Error revealing in explorer:', error);
            vscode.window.showErrorMessage(`Error revealing in explorer: ${error}`);
        }
    }

    private static async _handleAddExistingProject(): Promise<void> {
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
                log.info(`Existing project added: ${projectFiles[0].fsPath}`);
                vscode.window.showInformationMessage(`Project added: ${path.basename(projectFiles[0].fsPath)}`);
            }
        } catch (error) {
            log.error('Error adding existing project:', error);
            vscode.window.showErrorMessage(`Error adding existing project: ${error}`);
        }
    }

    private static async _handleAddNewProject(): Promise<void> {
        try {
            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                vscode.window.showErrorMessage('No active solution found');
                return;
            }

            // Show a simple message for now - full implementation would require template selection
            vscode.window.showInformationMessage('Add new project functionality would be implemented here');
            log.info('Add new project action triggered');
        } catch (error) {
            log.error('Error adding new project:', error);
            vscode.window.showErrorMessage(`Error adding new project: ${error}`);
        }
    }

    private static async _handleAddSolutionFolder(data?: MessageData): Promise<void> {
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
                // If data contains parent folder info (from solution folder context menu), use it
                const parentFolderName = data?.name;
                await solution.addSolutionFolder(folderName, parentFolderName);
                const parentInfo = parentFolderName ? ` under '${parentFolderName}'` : '';
                log.info(`Solution folder added: ${folderName}${parentInfo}`);
                vscode.window.showInformationMessage(`Solution folder '${folderName}' added${parentInfo}`);
            }
        } catch (error) {
            log.error('Error adding solution folder:', error);
            vscode.window.showErrorMessage(`Error adding solution folder: ${error}`);
        }
    }

    private static async _handleRemoveSolutionFolder(nodeId: NodeId, data?: MessageData): Promise<void> {
        try {
            const folderPath = nodeId.solutionPath;
            if (!folderPath) {
                log.error('Cannot extract solution folder path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine solution folder path for removal');
                return;
            }

            const solution = SolutionService.getActiveSolution();
            if (!solution) {
                vscode.window.showErrorMessage('No active solution found');
                return;
            }

            // Try to get folder name from data first (safer), then fall back to path parsing
            const folderName = data?.name || path.basename(folderPath);
            const folderGuid = data?.guid;

            log.info(`Removing solution folder: name="${folderName}", guid="${folderGuid}"`);

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
                log.info(`Solution folder removed: ${folderName}`);
                vscode.window.showInformationMessage(`Solution folder '${folderName}' removed`);
            }
        } catch (error) {
            log.error('Error removing solution folder:', error);
            vscode.window.showErrorMessage(`Error removing solution folder: ${error}`);
        }
    }

    private static async _handleAddSolutionItem(nodeId: NodeId, data?: MessageData): Promise<void> {
        try {
            const folderPath = nodeId.solutionPath;
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

            if (fileUri && fileUri[0]) {
                // Check if we're adding to the solution root or to a specific folder
                const isSolutionRoot = folderPath.endsWith('.sln');
                let targetFolderName: string;

                if (isSolutionRoot) {
                    // Adding to solution root - ensure "Solution Items" folder exists
                    const solutionItemsFolderName = 'Solution Items';
                    targetFolderName = solutionItemsFolderName;

                    // Check if "Solution Items" folder already exists
                    const existingFolders = solution.getSolutionFolders();
                    const solutionItemsExists = existingFolders.some(folder => folder.name === solutionItemsFolderName);

                    if (!solutionItemsExists) {
                        log.info(`Creating "${solutionItemsFolderName}" folder for solution items`);
                        await solution.addSolutionFolder(solutionItemsFolderName);
                        vscode.window.showInformationMessage(`Created "${solutionItemsFolderName}" folder`);
                    }
                } else {
                    // Adding to an existing solution folder
                    targetFolderName = data?.name || path.basename(folderPath);
                }

                const folderGuid = data?.guid;
                log.info(`Adding solution item to folder: name="${targetFolderName}", guid="${folderGuid}"`);

                await solution.addSolutionItem(targetFolderName, fileUri[0].fsPath);
                log.info(`Solution item added: ${fileUri[0].fsPath}`);
                vscode.window.showInformationMessage(`Solution item added: ${path.basename(fileUri[0].fsPath)}`);
            }
        } catch (error) {
            log.error('Error adding solution item:', error);
            vscode.window.showErrorMessage(`Error adding solution item: ${error}`);
        }
    }

    private static async _handleRemoveProject(nodeId: NodeId): Promise<void> {
        try {
            const projectPath = nodeId.projectPath;
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
                vscode.window.showInformationMessage(`Project '${projectName}' removed from solution`);
            }
        } catch (error) {
            log.error('Error removing project:', error);
            vscode.window.showErrorMessage(`Error removing project: ${error}`);
        }
    }

    private static async _handleDeleteProject(nodeId: NodeId): Promise<void> {
        try {
            const projectPath = nodeId.projectPath;
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

                log.info(`Project deleted: ${projectPath}`);
                vscode.window.showInformationMessage(`Project '${projectName}' deleted`);
            }
        } catch (error) {
            log.error('Error deleting project:', error);
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
            log.info(`Using name-based removal for GUID ${folderGuid} (name: ${folderName})`);
            await solution.removeSolutionFolder(folderName);
        } catch (error) {
            log.error(`Error in GUID-based solution folder removal:`, error);
            throw error;
        }
    }

    /**
     * Handles managing NuGet packages for a project
     */
    private static async _handleManageNuGetPackages(nodeId: NodeId): Promise<void> {
        try {
            // Extract project path from nodeId
            const projectPath = nodeId.projectPath;
            if (!projectPath) {
                log.error('Cannot extract project path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine project path');
                return;
            }

            log.info(`Managing NuGet packages for project: ${projectPath}`);

            // Open NuGet Package Manager in the main editor area for this specific project
            await vscode.commands.executeCommand('dotnet.openNuGetManager', projectPath);
            log.info(`Opened NuGet Package Manager for: ${projectPath}`);
        } catch (error) {
            log.error('Error opening NuGet webview:', error);
            vscode.window.showErrorMessage(`Error opening NuGet webview: ${error}`);
        }
    }

    private static async _handleManageNuGetPackagesForSolution(nodeId: NodeId): Promise<void> {
        try {
            // Extract solution path from nodeId
            const solutionPath = nodeId.solutionPath;
            if (!solutionPath) {
                log.error('Cannot extract solution path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine solution path');
                return;
            }

            log.info(`Managing NuGet packages for solution: ${solutionPath}`);

            // Open NuGet Package Manager in the main editor area for the entire solution
            await vscode.commands.executeCommand('dotnet.openNuGetManagerForSolution', solutionPath);
            log.info(`Opened NuGet Package Manager for solution: ${solutionPath}`);
        } catch (error) {
            log.error('Error opening solution NuGet manager:', error);
            vscode.window.showErrorMessage(`Error opening solution NuGet manager: ${error}`);
        }
    }

    /**
     * Handles adding a reference to a project
     */
    private static async _handleAddProjectReference(nodeId: NodeId): Promise<void> {
        try {
            // Extract project path from nodeId
            const projectPath = nodeId.projectPath;
            if (!projectPath) {
                log.error('Cannot extract project path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine project path');
                return;
            }
            log.info(`Adding project reference for project: ${projectPath}`);

            // Open file picker to select project file
            const projectUri = await vscode.window.showOpenDialog({
                canSelectMany: false,
                canSelectFiles: true,
                canSelectFolders: false,
                openLabel: 'Add Project Reference',
                filters: {
                    'Project Files': ['csproj', 'vbproj', 'fsproj']
                }
            });

            if (projectUri && projectUri[0]) {
                const referencePath = projectUri[0].fsPath;
                const projectName = path.basename(projectPath, path.extname(projectPath));
                const referenceName = path.basename(referencePath, path.extname(referencePath));

                log.info(`Adding reference from ${projectName} to ${referenceName}`);

                // Use dotnet CLI to add the project reference
                const terminal = vscode.window.createTerminal(`Add Project Reference: ${projectName}`);
                terminal.show();
                terminal.sendText(`dotnet add "${projectPath}" reference "${referencePath}"`);

                vscode.window.showInformationMessage(`Adding project reference from ${projectName} to ${referenceName}`);
            }
        } catch (error) {
            log.error('Error adding project reference:', error);
            vscode.window.showErrorMessage(`Error adding project reference: ${error}`);
        }
    }



    /**
     * Handles restoring dependencies for a project
     */
    private static async _handleRestoreDependencies(nodeId: NodeId): Promise<void> {
        try {
            // Extract project path from nodeId
            const projectPath = nodeId.projectPath;
            if (!projectPath) {
                log.error('Cannot extract project path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine project path');
                return;
            }
            log.info(`Restoring dependencies for project: ${projectPath}`);

            const projectName = require('path').basename(projectPath, require('path').extname(projectPath));
            const terminal = vscode.window.createTerminal(`Restore: ${projectName}`);
            terminal.show();

            const command = `dotnet restore "${projectPath}"`;
            terminal.sendText(command);

            log.info(`Executed restore command: ${command}`);
            vscode.window.showInformationMessage(`Restoring dependencies for ${projectName}...`);
        } catch (error) {
            log.error('Error restoring dependencies:', error);
            vscode.window.showErrorMessage(`Error restoring dependencies: ${error}`);
        }
    }

    /**
     * Handles removing a dependency from a project
     */
    private static async _handleRemoveDependency(nodeId: NodeId): Promise<void> {
        try {
            log.info(`Removing dependency with nodeId: ${nodeId}`);

            // Extract dependency information from nodeId
            const dependencyInfo = NodeIdService.getDependencyInfoFromNode(nodeId);
            if (!dependencyInfo) {
                log.error('Cannot extract dependency info from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine dependency information');
                return;
            }

            const { projectPath, dependencyName, dependencyType } = dependencyInfo;

            log.info(`Parsed dependency - Project: ${projectPath}, Type: ${dependencyType}, Name: ${dependencyName}`);

            // Confirm removal with user
            const result = await vscode.window.showWarningMessage(
                `Are you sure you want to remove ${dependencyName} from the project?`,
                { modal: true },
                'Remove'
            );

            if (result !== 'Remove') {
                return;
            }

            const projectName = require('path').basename(projectPath, require('path').extname(projectPath));

            // Remove the dependency by editing the .csproj file directly
            const success = await this._removeDependencyFromCsproj(projectPath, dependencyType, dependencyName);

            if (success) {
                log.info(`Successfully removed ${dependencyName} from ${projectName}`);
                vscode.window.showInformationMessage(`Removed ${dependencyName} from ${projectName}`);
            } else {
                vscode.window.showErrorMessage(`Failed to remove ${dependencyName} from ${projectName}`);
            }

        } catch (error) {
            log.error('Error removing dependency:', error);
            vscode.window.showErrorMessage(`Error removing dependency: ${error}`);
        }
    }

    /**
     * Removes a dependency from a .csproj file by directly editing the XML
     */
    private static async _removeDependencyFromCsproj(projectPath: string, category: string, dependencyName: string): Promise<boolean> {
        try {
            const fs = require('fs').promises;
            const { parseStringPromise } = require('xml2js');
            const xml2js = require('xml2js');

            // Read the project file
            const projectContent = await fs.readFile(projectPath, 'utf8');

            // Check if the original file has an XML declaration
            const hasXmlDeclaration = projectContent.trimStart().startsWith('<?xml');
            log.info(`Original file has XML declaration: ${hasXmlDeclaration}`);

            const parsedXml = await parseStringPromise(projectContent);

            if (!parsedXml.Project) {
                log.error('Invalid project file format - no Project element');
                return false;
            }

            const project = parsedXml.Project;
            let removed = false;

            // Determine the XML element to look for based on category
            let elementName = '';
            switch (category) {
                case 'packages':
                    elementName = 'PackageReference';
                    break;
                case 'projects':
                    elementName = 'ProjectReference';
                    break;
                case 'assemblies':
                    elementName = 'Reference';
                    break;
                case 'frameworks':
                    elementName = 'FrameworkReference';
                    break;
                default:
                    log.error(`Unknown dependency category: ${category}`);
                    return false;
            }

            // Find and remove the dependency from ItemGroup elements
            if (project.ItemGroup) {
                for (let i = 0; i < project.ItemGroup.length; i++) {
                    const itemGroup = project.ItemGroup[i];

                    if (itemGroup[elementName]) {
                        const dependencies = itemGroup[elementName];

                        // Debug: Log all dependencies of this type
                        log.info(`Found ${dependencies.length} ${elementName} items in project:`);
                        dependencies.forEach((dep: any, index: number) => {
                            const include = dep.$ && dep.$.Include;
                            log.info(`  [${index}] Include: "${include}"`);
                        });

                        // Filter out the dependency to remove
                        const filtered = dependencies.filter((dep: any) => {
                            const include = dep.$ && dep.$.Include;

                            if (category === 'packages') {
                                // For packages, match by package name exactly
                                return include !== dependencyName;
                            } else if (category === 'projects') {
                                // For project references, try multiple matching strategies
                                if (!include) return true; // Keep if no Include attribute

                                log.debug(`Checking project reference: "${include}" against "${dependencyName}"`);

                                // Extract project name from various possible formats
                                const projectFileName = require('path').basename(include); // e.g., "Shinobi.WebSockets.csproj"
                                const projectNameFromFile = require('path').basename(include, '.csproj'); // e.g., "Shinobi.WebSockets"
                                const projectNameFromPath = include.split('/').pop()?.replace('.csproj', '') || ''; // Handle forward slashes

                                // Check if any of these match the dependency name
                                const matches = include === dependencyName ||
                                    projectFileName === dependencyName ||
                                    projectNameFromFile === dependencyName ||
                                    projectNameFromPath === dependencyName ||
                                    include.includes(dependencyName + '.csproj') ||
                                    include.endsWith('/' + dependencyName + '.csproj') ||
                                    include.endsWith('\\' + dependencyName + '.csproj');

                                log.debug(`Project reference match check: ${matches ? 'MATCH' : 'NO MATCH'}`);
                                log.debug(`  - include: "${include}"`);
                                log.debug(`  - projectFileName: "${projectFileName}"`);
                                log.debug(`  - projectNameFromFile: "${projectNameFromFile}"`);
                                log.debug(`  - projectNameFromPath: "${projectNameFromPath}"`);

                                return !matches; // Return false (remove) if it matches
                            } else {
                                // For assemblies and frameworks, match by name
                                return include !== dependencyName;
                            }
                        });

                        if (filtered.length < dependencies.length) {
                            removed = true;
                            log.info(`Removed ${elementName} '${dependencyName}' from project`);

                            if (filtered.length === 0) {
                                // Remove the entire element array if empty
                                delete itemGroup[elementName];

                                // Remove the entire ItemGroup if it's now empty
                                const remainingKeys = Object.keys(itemGroup).filter(key => key !== '$');
                                if (remainingKeys.length === 0) {
                                    project.ItemGroup.splice(i, 1);
                                    i--; // Adjust index after removal
                                }
                            } else {
                                // Update with filtered dependencies
                                itemGroup[elementName] = filtered;
                            }
                        }
                    }
                }
            }

            if (!removed) {
                log.warn(`Dependency '${dependencyName}' not found in project file`);
                return false;
            }

            // Build the XML back to string
            const builderOptions: any = {
                renderOpts: { pretty: true, indent: '  ' }
            };

            // Only include XML declaration if the original file had one
            if (hasXmlDeclaration) {
                builderOptions.xmldec = { version: '1.0', encoding: 'utf-8' };
                log.info('Including XML declaration in output');
            } else {
                // Explicitly disable XML declaration - use headless option for xml2js
                builderOptions.headless = true;
                log.info('Excluding XML declaration from output (using headless mode)');
            }

            log.debug('Builder options:', JSON.stringify(builderOptions));
            const builder = new xml2js.Builder(builderOptions);
            let xmlString = builder.buildObject(parsedXml);

            // Additional safety check - remove XML declaration if it shouldn't be there
            if (!hasXmlDeclaration && xmlString.startsWith('<?xml')) {
                xmlString = xmlString.replace(/^<\?xml[^>]*>\s*/, '');
                log.info('Removed XML declaration from output as safety measure');
            }

            log.debug('Final XML starts with:', xmlString.substring(0, 100));

            // Write the modified content back to the file
            await fs.writeFile(projectPath, xmlString, 'utf8');

            log.info(`Successfully updated project file: ${projectPath}`);
            return true;

        } catch (error) {
            log.error('Error editing .csproj file:', error);
            return false;
        }
    }

    /**
     * Handles setting a project as the startup project
     */
    private static async _handleSetStartupProject(nodeId: NodeId): Promise<void> {
        try {
            const projectPath = nodeId.projectPath;
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


            const projectName = require('path').basename(projectPath, require('path').extname(projectPath));
            vscode.window.showInformationMessage(`Set ${projectName} as startup project`);

            log.info(`Successfully set startup project: ${projectPath}`);
        } catch (error) {
            log.error('Error setting startup project:', error);
            vscode.window.showErrorMessage(`Error setting startup project: ${error}`);
        }
    }

    /**
     * Creates a new file at the specified path
     */
    static async createFile(filePath: string): Promise<void> {
        try {
            log.info(`Creating file: ${filePath}`);

            const fs = require('fs').promises;
            const pathModule = require('path');

            // Ensure the directory exists
            const dirPath = pathModule.dirname(filePath);
            await fs.mkdir(dirPath, { recursive: true });

            // Create the file with empty content
            await fs.writeFile(filePath, '', 'utf8');

            log.info(`File created successfully: ${filePath}`);
        } catch (error) {
            log.error('Error creating file:', error);
            throw error;
        }
    }

    /**
     * Creates a new folder at the specified path
     */
    static async createFolder(folderPath: string): Promise<void> {
        try {
            log.info(`Creating folder: ${folderPath}`);

            const fs = require('fs').promises;

            // Create the directory recursively
            await fs.mkdir(folderPath, { recursive: true });

            log.info(`Folder created successfully: ${folderPath}`);
        } catch (error) {
            log.error('Error creating folder:', error);
            throw error;
        }
    }

    // Static clipboard to store copy/cut operations
    private static clipboard: {
        nodeId: NodeIdString;
        path: string;
        operation: 'copy' | 'cut';
        type: string;
    } | null = null;

    /**
     * Handles copying a file or folder to the clipboard
     */
    private static async _handleCopy(nodeId: NodeId, nodeIdString: NodeIdString, data?: MessageData): Promise<void> {
        try {
            const itemPath = nodeId.filePath ?? nodeId.folderPath;
            if (!itemPath) {
                log.error('Cannot extract path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine item path');
                return;
            }

            this.clipboard = {
                nodeId: nodeIdString,
                path: itemPath,
                operation: 'copy',
                type: data?.type || 'unknown'
            };

            const itemName = path.basename(itemPath);
            vscode.window.showInformationMessage(`Copied ${itemName}`);
            log.info(`Copied to clipboard: ${itemPath}`);
        } catch (error) {
            log.error('Error copying item:', error);
            vscode.window.showErrorMessage(`Error copying item: ${error}`);
        }
    }

    /**
     * Handles cutting a file or folder to the clipboard
     */
    private static async _handleCut(nodeId: NodeId, nodeIdString: NodeIdString, data?: MessageData): Promise<void> {
        try {
            const itemPath = nodeId.filePath ?? nodeId.folderPath;
            if (!itemPath) {
                log.error('Cannot extract path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine item path');
                return;
            }

            this.clipboard = {
                nodeId: nodeIdString,
                path: itemPath,
                operation: 'cut',
                type: data?.type || 'unknown'
            };

            const itemName = path.basename(itemPath);
            vscode.window.showInformationMessage(`Cut ${itemName}`);
            log.info(`Cut to clipboard: ${itemPath}`);
        } catch (error) {
            log.error('Error cutting item:', error);
            vscode.window.showErrorMessage(`Error cutting item: ${error}`);
        }
    }

    /**
     * Handles pasting a file or folder from the clipboard
     */
    private static async _handlePaste(nodeId: NodeId, _data?: MessageData): Promise<void> {
        try {
            log.info(`_handlePaste called: nodeId=${nodeId}, clipboard=${JSON.stringify(this.clipboard)}`);

            if (!this.clipboard) {
                vscode.window.showWarningMessage('Nothing to paste');
                return;
            }

            const targetPath = nodeId.folderPath ?? nodeId.filePath;
            if (!targetPath) {
                log.error('Cannot extract target path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine target path');
                return;
            }

            // Determine the actual paste target directory
            let pasteTargetPath = targetPath;
            const targetUri = vscode.Uri.file(targetPath);

            try {
                const stat = await vscode.workspace.fs.stat(targetUri);
                if (stat.type === vscode.FileType.File) {
                    // If target is a file, paste into its parent directory
                    pasteTargetPath = path.dirname(targetPath);
                    log.info(`Target is a file, pasting into parent directory: ${pasteTargetPath}`);
                } else if (stat.type !== vscode.FileType.Directory) {
                    vscode.window.showErrorMessage('Cannot paste to this location');
                    return;
                }
            } catch {
                vscode.window.showErrorMessage('Target path does not exist');
                return;
            }

            const sourcePath = this.clipboard.path;
            const sourceName = path.basename(sourcePath);
            const destinationPath = path.join(pasteTargetPath, sourceName);

            const sourceUri = vscode.Uri.file(sourcePath);
            const destinationUri = vscode.Uri.file(destinationPath);

            // Check if source still exists
            try {
                await vscode.workspace.fs.stat(sourceUri);
            } catch {
                vscode.window.showErrorMessage('Source item no longer exists');
                this.clipboard = null;
                return;
            }

            // Check if destination already exists
            let destinationExists = false;
            try {
                await vscode.workspace.fs.stat(destinationUri);
                destinationExists = true;
            } catch {
                // Destination doesn't exist, which is fine
            }

            if (destinationExists) {
                const choice = await vscode.window.showWarningMessage(
                    `A file or folder with the name '${sourceName}' already exists in the destination folder. Do you want to replace it?`,
                    { modal: true },
                    'Replace',
                    'Cancel'
                );
                if (choice !== 'Replace') {
                    return;
                }
            }

            // Check if namespace updates are needed for moved C# files BEFORE clearing clipboard
            const wasFileMoved = this.clipboard.operation === 'cut' && destinationPath.endsWith('.cs');
            log.debug(`Checking namespace updates: clipboard=${!!this.clipboard}, operation=${this.clipboard?.operation}, destinationPath=${destinationPath}, wasFileMoved=${wasFileMoved}`);

            if (this.clipboard.operation === 'copy') {
                // Copy operation using VS Code's workspace API
                await vscode.workspace.fs.copy(sourceUri, destinationUri, { overwrite: true });
                vscode.window.showInformationMessage(`Copied ${sourceName}`);
                log.info(`Copied ${sourcePath} to ${destinationPath}`);
            } else {
                // Cut operation (move) using VS Code's workspace API
                await vscode.workspace.fs.rename(sourceUri, destinationUri);
                vscode.window.showInformationMessage(`Moved ${sourceName}`);
                log.info(`Moved ${sourcePath} to ${destinationPath}`);
                this.clipboard = null; // Clear clipboard after cut operation
            }

            // Force refresh the solution tree to ensure UI updates
            const solution = SolutionService.getActiveSolution();
            if (solution) {
                await solution.forceRefreshAllProjects();
            }

            // Now check namespace updates for moved C# files
            if (wasFileMoved) {
                log.info(`Triggering namespace check for moved C# file: ${destinationPath}`);

                // Extract project path from the original clipboard nodeId
                const originalNodeId = this.clipboard?.nodeId;
                const projectPath = originalNodeId ? NodeIdService.getProjectPathFromNodeId(originalNodeId) : null;
                log.debug(`Extracted project path from original nodeId: ${projectPath}`);

                await this._checkAndUpdateNamespace(destinationPath, 'File moved', projectPath);
            } else {
                log.debug(`Namespace check skipped - not a moved C# file`);
            }

        } catch (error) {
            log.error('Error pasting item:', error);
            vscode.window.showErrorMessage(`Error pasting item: ${error}`);
        }
    }

    /**
     * Checks and updates namespace for a single C# file
     */
    private static async _checkAndUpdateNamespace(filePath: string, operationDescription: string, projectPath?: string | null): Promise<void> {
        try {
            log.info(`_checkAndUpdateNamespace called for: ${filePath}`);
            log.debug(`Using project path: ${projectPath}`);
            const analysis = await NamespaceService.analyzeNamespaceChanges(filePath, projectPath || undefined);
            log.info(`Namespace analysis result: needsUpdate=${analysis.needsUpdate}, current=${analysis.currentNamespace}, expected=${analysis.expectedNamespace}`);

            if (!analysis.needsUpdate) {
                log.debug(`No namespace update needed for ${filePath}`);
                return;
            }

            log.info(`${operationDescription}: Namespace update needed for ${filePath}`);
            log.info(`Current: ${analysis.currentNamespace}, Expected: ${analysis.expectedNamespace}`);

            // Show user consent dialog
            const fileName = path.basename(filePath);
            const choice = await vscode.window.showInformationMessage(
                `${operationDescription}: Update namespace in '${fileName}'?\n\nFrom: ${analysis.currentNamespace || '(global)'}\nTo: ${analysis.expectedNamespace}`,
                { modal: true },
                'Update Namespace',
                'Skip'
            );

            if (choice === 'Update Namespace' && analysis.currentNamespace && analysis.expectedNamespace) {
                const success = await NamespaceService.updateNamespaceViaRename(
                    filePath,
                    analysis.currentNamespace,
                    analysis.expectedNamespace
                );

                if (success) {
                    vscode.window.showInformationMessage(`Namespace updated in '${fileName}'`);
                } else {
                    vscode.window.showWarningMessage(`Failed to update namespace in '${fileName}'`);
                }
            }

        } catch (error) {
            log.error(`Error checking namespace for ${filePath}:`, error);
        }
    }

    /**
     * Handles namespace updates after file/folder rename operations
     */
    private static async _handleNamespaceUpdatesAfterRename(oldPath: string, newPath: string, _itemType?: string): Promise<void> {
        try {
            const stats = await vscode.workspace.fs.stat(vscode.Uri.file(newPath));

            if (stats.type === vscode.FileType.File && newPath.endsWith('.cs')) {
                // Single C# file renamed
                await this._checkAndUpdateNamespace(newPath, 'File renamed');
            } else if (stats.type === vscode.FileType.Directory) {
                // Folder renamed - check all C# files in the folder
                const csharpFiles = await NamespaceService.getCSharpFilesInDirectory(newPath);

                if (csharpFiles.length === 0) {
                    log.debug(`No C# files found in renamed folder: ${newPath}`);
                    return;
                }

                // Ask user if they want to update namespaces for all files in the folder
                const folderName = path.basename(newPath);
                const choice = await vscode.window.showInformationMessage(
                    `Folder '${folderName}' was renamed. Update namespaces for ${csharpFiles.length} C# file(s)?`,
                    { modal: true },
                    'Update All',
                    'Review Each',
                    'Skip'
                );

                if (choice === 'Update All') {
                    await this._updateNamespacesInFiles(csharpFiles, 'Folder renamed', false);
                } else if (choice === 'Review Each') {
                    await this._updateNamespacesInFiles(csharpFiles, 'Folder renamed', true);
                }
            }

        } catch (error) {
            log.error(`Error handling namespace updates after rename from ${oldPath} to ${newPath}:`, error);
        }
    }

    /**
     * Updates namespaces in multiple files
     */
    private static async _updateNamespacesInFiles(filePaths: string[], operationDescription: string, askForEach: boolean): Promise<void> {
        let updatedCount = 0;
        let skippedCount = 0;

        for (const filePath of filePaths) {
            try {
                const analysis = await NamespaceService.analyzeNamespaceChanges(filePath);

                if (!analysis.needsUpdate) {
                    continue;
                }

                let shouldUpdate = !askForEach;

                if (askForEach) {
                    const fileName = path.basename(filePath);
                    const choice = await vscode.window.showInformationMessage(
                        `${operationDescription}: Update namespace in '${fileName}'?\n\nFrom: ${analysis.currentNamespace || '(global)'}\nTo: ${analysis.expectedNamespace}`,
                        'Update',
                        'Skip',
                        'Skip All Remaining'
                    );

                    if (choice === 'Update') {
                        shouldUpdate = true;
                    } else if (choice === 'Skip All Remaining') {
                        break;
                    }
                }

                if (shouldUpdate && analysis.currentNamespace && analysis.expectedNamespace) {
                    const success = await NamespaceService.updateNamespaceViaRename(
                        filePath,
                        analysis.currentNamespace,
                        analysis.expectedNamespace
                    );

                    if (success) {
                        updatedCount++;
                    } else {
                        log.warn(`Failed to update namespace in ${filePath}`);
                    }
                } else {
                    skippedCount++;
                }

            } catch (error) {
                log.error(`Error updating namespace for ${filePath}:`, error);
                skippedCount++;
            }
        }

        // Show summary message
        if (updatedCount > 0 || skippedCount > 0) {
            let message = '';
            if (updatedCount > 0) {
                message += `Updated ${updatedCount} file(s)`;
            }
            if (skippedCount > 0) {
                if (message) message += ', ';
                message += `skipped ${skippedCount} file(s)`;
            }
            vscode.window.showInformationMessage(`Namespace updates: ${message}`);
        }
    }

}