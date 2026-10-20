import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../core/logger';
import { SolutionService } from './solutionService';
import { NodeId, NodeIdService } from './nodeIdService';
import { NamespaceService } from './namespaceService';
import { ProjectActionCmd } from '../types/commands/project-action';
import { NodeIdString } from '../types/nodeId';
import { createDotnetTask, DotnetTaskAction, DOTNET_TASK_TYPE } from './dotnetTaskProvider';
import { ProjectFileEditor } from '../parsers/projectFileEditor';
import { renameFileAndType } from './typeRename';
import { copyExistingItems } from './existingItems';
import { runTask } from './runTask';
import { manageUserSecrets } from './userSecrets';
import { openLaunchSettings } from './launchSettings';
import { UnloadedProjects } from './unloadedProjects';
import { packStarted } from './pack';
import { ConfigurationManagerPanel } from '../webview/providers/ConfigurationManagerPanel';
import { StartupProjectsPanel } from '../webview/providers/StartupProjectsPanel';
import { PublishPanel } from '../webview/providers/PublishPanel';
import { runCodeCleanup } from './codeCleanup/codeCleanup';
import { runSyncNamespaces } from './namespaceSync/runSyncNamespaces';
import { projectForPath } from './templates/templateService';
import { DebugConfigService } from './debugConfigService';
import { dependentRenames } from './templates/dependentRenames';
import { openNewProjectWizard } from '../webview/providers/TemplateWizardPanel';
import { addServiceReference, removeServiceReferenceWithConfirmation, updateServiceReference } from './serviceReferences/serviceReferenceService';

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
            case 'editProjectFile':
                await this._handleOpenFile(nodeId);
                break;

            case 'addExistingItem':
                await this._handleAddExistingItem(nodeId);
                break;

            case 'startNewInstance':
            case 'startWithoutDebugging':
                await DebugConfigService.startProject(nodeId.path, cmd.action === 'startWithoutDebugging');
                break;

            case 'runTests':
            case 'debugTests':
                await vscode.commands.executeCommand('shinobi.internal.runTests', nodeId.path, cmd.action === 'debugTests');
                break;

            case 'openInTerminal':
                vscode.window.createTerminal({
                    name: path.basename(nodeId.path, path.extname(nodeId.path)),
                    cwd: nodeId.type === 'folder' ? nodeId.path : path.dirname(nodeId.path),
                }).show();
                break;

            case 'publish':
                PublishPanel.show(nodeId.path);
                break;

            case 'configurationManager':
                ConfigurationManagerPanel.show();
                break;

            case 'startupProjects':
                StartupProjectsPanel.show();
                break;

            case 'codeCleanup':
                await this._handleCodeCleanup(nodeId);
                break;

            case 'syncNamespaces':
                if (nodeId.type === 'project' || nodeId.type === 'folder') {
                    await runSyncNamespaces({ kind: nodeId.type, path: nodeId.path });
                }
                break;

            case 'manageUserSecrets':
                await manageUserSecrets(nodeId.path);
                break;

            case 'openLaunchSettings':
                await openLaunchSettings(nodeId.path);
                break;

            case 'pack':
                packStarted(nodeId.path);
                await vscode.tasks.executeTask(createDotnetTask({ type: DOTNET_TASK_TYPE, action: 'pack', target: nodeId.path }));
                break;

            case 'unloadProject':
            case 'reloadProject': {
                const solution = SolutionService.getActiveSolution();
                if (solution) {
                    await UnloadedProjects.setUnloaded(solution.solutionPath, nodeId.path, cmd.action === 'unloadProject');
                }
                break;
            }

            case 'copyFullPath':
                await vscode.env.clipboard.writeText(nodeId.path);
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
                await this._handleAddExistingProject(nodeId);
                break;

            case 'addNewProject':
                openNewProjectWizard(nodeId.type === 'solutionFolder' ? this._solutionFolderPathOf(nodeId) : undefined);
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

            case 'addAssemblyReference':
                await this._handleAddAssemblyReference(nodeId);
                break;

            case 'restoreDependencies':
                await this._handleRestoreDependencies(nodeId);
                break;

            case 'removeDependency':
                await this._handleRemoveDependency(nodeId);
                break;

            case 'addSolutionFolder':
                await this._handleAddSolutionFolder(nodeId);
                break;

            case 'removeSolutionFolder':
                await this._handleRemoveSolutionFolder(nodeId);
                break;

            case 'addSolutionItem':
                await this._handleAddSolutionItem(nodeId);
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

            case 'chooseLaunchProfile':
                await DebugConfigService.chooseLaunchProfile(nodeId.path);
                break;

            case 'addServiceReference':
                await addServiceReference(nodeId.path);
                break;

            case 'updateServiceReference':
                await updateServiceReference(nodeId.path);
                break;

            case 'removeServiceReference':
                await removeServiceReferenceWithConfirmation(nodeId.path);
                break;

            case 'copy':
                await this._handleCopy(nodeId);
                break;

            case 'cut':
                await this._handleCut(nodeId);
                break;

            case 'paste':
                await this._handlePaste(nodeId, undefined);
                break;

            case 'addFile':
            case 'addFolder':
            case 'addNewItem':
            case 'cancelTemporaryNode':
                // These actions are handled by the webview provider, not here
                log.info(`${cmd.action} action is handled by webview provider`);
                break;

            case 'startRename':
            case 'collapseParent':
                // This action is handled by the UI - no backend action needed
                log.info(`${cmd.action} action is handled by SolutionTree.tsx`);
                break;
            default:
                // TypeScript exhaustiveness check
                const _exhaustive: never = cmd;
                log.warn(`Unknown project action:`, _exhaustive);
                break;
        }
    }

    // Private action handlers

    private static async _handleCodeCleanup(nodeId: NodeId): Promise<void> {
        if (nodeId.type === 'solution' || nodeId.type === 'project') {
            await runCodeCleanup({ kind: nodeId.type, path: nodeId.path });
            return;
        }
        if (nodeId.type !== 'folder' && nodeId.type !== 'file') {
            return;
        }
        const projectPath = projectForPath(nodeId.path);
        if (!projectPath) {
            vscode.window.showInformationMessage('Code Cleanup works on files and folders of a project of the solution.');
            return;
        }
        await runCodeCleanup({ kind: nodeId.type, path: nodeId.path, projectPath });
    }

    private static async _handleOpenFile(nodeId: NodeId): Promise<void> {
        try {
            // Extract the file system path from the nodeId
            // For solution items, use itemPath instead of filePath
            const filePath = nodeId.path;
            if (!filePath) {
                log.error('Cannot extract file path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine file path to open');
                return;
            }

            const uri = vscode.Uri.file(filePath);
            await vscode.window.showTextDocument(uri);
            if (nodeId.type === 'generatedFile') {
                // Like Visual Studio's generated documents: the next build overwrites them
                await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');
            }
        } catch (error) {
            log.error('Error opening file:', error);
            vscode.window.showErrorMessage(`Error opening file: ${error}`);
        }
    }

    /** Renames the project file like Visual Studio; the startup configuration follows a renamed startup project */
    private static async _renameProject(projectPath: string, newName: string): Promise<void> {
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
    private static async _renameSolution(solutionPath: string, newName: string): Promise<void> {
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

    private static async _handleRename(nodeId: NodeId, newName: string, itemType?: string, oldName?: string): Promise<void> {
        log.info(`Renaming ${itemType || 'item'} from '${oldName}' to '${newName}' for nodeId: ${nodeId}`);

        try {
            if (nodeId.type === 'solutionFolder') {
                const solution = SolutionService.getActiveSolution();
                if (solution) {
                    await solution.renameSolutionFolder(nodeId.guid, newName);
                    log.info(`Solution folder renamed successfully`);
                }
            } else if (nodeId.type === 'solutionItem') {
                await this._renameSolutionItem(nodeId.guid, nodeId.path, newName);
            } else if (nodeId.type === 'project') {
                await this._renameProject(nodeId.path, newName);
            } else if (nodeId.type === 'solution') {
                await this._renameSolution(nodeId.path, newName);
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
                await this._handleNamespaceUpdatesAfterRename(oldPath, newPath, itemType);
            }
        } catch (error) {
            log.error('Error renaming item:', error);
            vscode.window.showErrorMessage(`Error renaming: ${error}`);
        }
    }

    /**
     * Renames a solution item on disk and updates its reference in the solution folder
     */
    private static async _renameSolutionItem(folderGuid: string, oldPath: string, newName: string): Promise<void> {
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

    private static async _handleBuild(nodeId: NodeId, action: DotnetTaskAction): Promise<void> {
        try {
            if (!SolutionService.getActiveSolution()) {
                vscode.window.showErrorMessage('No active solution found');
                return;
            }

            const targetPath = nodeId.path;
            if (!targetPath) {
                log.error('Cannot extract solution or project path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine solution or project path for build action');
                return;
            }

            await vscode.tasks.executeTask(createDotnetTask({ type: DOTNET_TASK_TYPE, action, target: targetPath }));
            log.info(`Started ${action} task for ${targetPath}`);
        } catch (error) {
            log.error(`Error during ${action}:`, error);
            vscode.window.showErrorMessage(`Error during ${action}: ${error}`);
        }
    }

    private static async _handleDeleteFile(nodeId: NodeId): Promise<void> {
        try {
            // Extract the file system path from the nodeId
            const filePath = nodeId.path;
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
                `Delete the ${itemType} '${path.basename(filePath)}'?${isDirectory ? ' Everything in it' : ' It'} is moved to the trash.`,
                { modal: true },
                'Delete'
            );

            if (answer === 'Delete') {
                const uri = vscode.Uri.file(filePath);
                // To the trash, like VS Code's explorer, so a mistake can be undone
                await vscode.workspace.fs.delete(uri, { recursive: isDirectory, useTrash: true });
                log.info(`${itemType} deleted: ${filePath}`);
            }
        } catch (error) {
            log.error('Error deleting file/folder:', error);
            vscode.window.showErrorMessage(`Error deleting: ${error}`);
        }
    }

    private static async _handleRemoveSolutionItem(nodeId: NodeId): Promise<void> {
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

    private static async _handleRevealInExplorer(nodeId: NodeId): Promise<void> {
        try {
            const itemPath = nodeId.path;
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

    /** Matches the project files `dotnet sln add` accepts */
    private static readonly _projectFile = /\.(cs|vb|fs)proj$/i;

    /** `dotnet sln add --solution-folder` path of a solution folder node; undefined for the solution root */
    private static _solutionFolderPathOf(nodeId: NodeId): string | undefined {
        return nodeId.type === 'solutionFolder'
            ? SolutionService.getActiveSolution()?.getSolutionFolderPath(nodeId.guid)
            : undefined;
    }

    private static async _handleAddExistingProject(nodeId: NodeId): Promise<void> {
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
                await solution.addProject(projectFiles[0].fsPath, this._solutionFolderPathOf(nodeId));
                log.info(`Existing project added: ${projectFiles[0].fsPath}`);
            }
        } catch (error) {
            log.error('Error adding existing project:', error);
            vscode.window.showErrorMessage(`Error adding existing project: ${error}`);
        }
    }

    private static async _handleAddSolutionFolder(nodeId: NodeId): Promise<void> {
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

    private static async _handleRemoveSolutionFolder(nodeId: NodeId): Promise<void> {
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

    /** "Add Existing Item...": copies the picked files into the project or folder */
    private static async _handleAddExistingItem(nodeId: NodeId): Promise<void> {
        const targetDir = nodeId.type === 'project' ? path.dirname(nodeId.path) : nodeId.path;
        const files = await vscode.window.showOpenDialog({
            canSelectMany: true,
            canSelectFiles: true,
            canSelectFolders: false,
            defaultUri: vscode.Uri.file(targetDir),
            openLabel: 'Add',
            title: 'Add Existing Item',
        });
        if (!files?.length) {
            return;
        }
        try {
            await copyExistingItems(files.map(file => file.fsPath), targetDir, async fileName => {
                const replace = await vscode.window.showWarningMessage(
                    `A file with the name '${fileName}' already exists. Do you want to replace it?`,
                    { modal: true },
                    'Replace'
                );
                return replace === 'Replace';
            });
        } catch (error) {
            log.error('Error adding existing items:', error);
            vscode.window.showErrorMessage(`Error adding existing items: ${error instanceof Error ? error.message : error}`);
        }
    }

    private static async _handleAddSolutionItem(nodeId: NodeId): Promise<void> {
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
            if (fileUri?.[0] && this._projectFile.test(fileUri[0].fsPath)) {
                await solution.addProject(fileUri[0].fsPath, this._solutionFolderPathOf(nodeId));
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

    private static async _handleRemoveProject(nodeId: NodeId): Promise<void> {
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

    private static async _handleDeleteProject(nodeId: NodeId): Promise<void> {
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
            const answer = await vscode.window.showWarningMessage(
                `Delete project '${projectName}'? It is removed from the solution and its folder is moved to the trash.`,
                { modal: true },
                'Delete'
            );

            if (answer === 'Delete') {
                // First remove from solution
                await solution.removeProject(projectPath);

                // Then delete the project directory
                const projectDir = path.dirname(projectPath);
                const uri = vscode.Uri.file(projectDir);
                await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });

                log.info(`Project deleted: ${projectPath}`);
            }
        } catch (error) {
            log.error('Error deleting project:', error);
            vscode.window.showErrorMessage(`Error deleting project: ${error}`);
        }
    }

    /**
     * Handles managing NuGet packages for a project
     */
    private static async _handleManageNuGetPackages(nodeId: NodeId): Promise<void> {
        try {
            // Extract project path from nodeId
            const projectPath = nodeId.path;
            if (!projectPath) {
                log.error('Cannot extract project path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine project path');
                return;
            }

            log.info(`Managing NuGet packages for project: ${projectPath}`);

            // Open NuGet Package Manager in the main editor area for this specific project
            await vscode.commands.executeCommand('shinobi.openNuGetManager', projectPath);
            log.info(`Opened NuGet Package Manager for: ${projectPath}`);
        } catch (error) {
            log.error('Error opening NuGet webview:', error);
            vscode.window.showErrorMessage(`Error opening NuGet webview: ${error}`);
        }
    }

    private static async _handleManageNuGetPackagesForSolution(nodeId: NodeId): Promise<void> {
        try {
            // Extract solution path from nodeId
            const solutionPath = nodeId.path;
            if (!solutionPath) {
                log.error('Cannot extract solution path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine solution path');
                return;
            }

            log.info(`Managing NuGet packages for solution: ${solutionPath}`);

            // Open NuGet Package Manager in the main editor area for the entire solution
            await vscode.commands.executeCommand('shinobi.openNuGetManagerForSolution', solutionPath);
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
            const projectPath = nodeId.path;
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

            }
        } catch (error) {
            log.error('Error adding project reference:', error);
            vscode.window.showErrorMessage(`Error adding project reference: ${error}`);
        }
    }



    /**
     * Handles adding assembly (.dll) references to a project, written as <Reference> items with a HintPath
     */
    private static async _handleAddAssemblyReference(nodeId: NodeId): Promise<void> {
        try {
            const projectPath = nodeId.path;
            if (!projectPath) {
                log.error('Cannot extract project path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine project path');
                return;
            }

            const assemblyUris = await vscode.window.showOpenDialog({
                canSelectMany: true,
                canSelectFiles: true,
                canSelectFolders: false,
                defaultUri: vscode.Uri.file(path.dirname(projectPath)),
                openLabel: 'Add Reference',
                filters: {
                    'Assemblies': ['dll', 'exe']
                }
            });
            if (!assemblyUris?.length) {
                return;
            }

            let content = await fs.promises.readFile(projectPath, 'utf8');
            const added: string[] = [];
            for (const uri of assemblyUris) {
                const assemblyName = path.basename(uri.fsPath, path.extname(uri.fsPath));
                const hintPath = path.relative(path.dirname(projectPath), uri.fsPath).split(path.sep).join('/');
                try {
                    content = ProjectFileEditor.addAssemblyReference(content, assemblyName, hintPath);
                    added.push(assemblyName);
                } catch (error) {
                    vscode.window.showWarningMessage(`${error instanceof Error ? error.message : error}`);
                }
            }

            if (added.length > 0) {
                await fs.promises.writeFile(projectPath, content, 'utf8');
                const projectName = path.basename(projectPath, path.extname(projectPath));
                log.info(`Added assembly references to ${projectName}: ${added.join(', ')}`);
            }
        } catch (error) {
            log.error('Error adding assembly reference:', error);
            vscode.window.showErrorMessage(`Error adding assembly reference: ${error}`);
        }
    }

    /**
     * Handles restoring dependencies for a project
     */
    private static async _handleRestoreDependencies(nodeId: NodeId): Promise<void> {
        try {
            // Extract project path from nodeId
            const projectPath = nodeId.path;
            if (!projectPath) {
                log.error('Cannot extract project path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine project path');
                return;
            }
            log.info(`Restoring dependencies for project: ${projectPath}`);

            await vscode.tasks.executeTask(createDotnetTask({ type: DOTNET_TASK_TYPE, action: 'restore', target: projectPath }));
            log.info(`Started restore task for ${projectPath}`);
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
        /** The copied or cut files and folders */
        paths: string[];
        operation: 'copy' | 'cut';
    } | null = null;

    /**
     * Handles copying a file or folder to the clipboard
     */
    private static async _handleCopy(nodeId: NodeId): Promise<void> {
        try {
            const itemPath = nodeId.path;
            if (!itemPath) {
                log.error('Cannot extract path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine item path');
                return;
            }

            this.clipboard = { paths: [itemPath], operation: 'copy' };

            log.info(`Copied to clipboard: ${itemPath}`);
        } catch (error) {
            log.error('Error copying item:', error);
            vscode.window.showErrorMessage(`Error copying item: ${error}`);
        }
    }

    /**
     * Handles cutting a file or folder to the clipboard
     */
    private static async _handleCut(nodeId: NodeId): Promise<void> {
        try {
            const itemPath = nodeId.path;
            if (!itemPath) {
                log.error('Cannot extract path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine item path');
                return;
            }

            this.clipboard = { paths: [itemPath], operation: 'cut' };

            log.info(`Cut to clipboard: ${itemPath}`);
        } catch (error) {
            log.error('Error cutting item:', error);
            vscode.window.showErrorMessage(`Error cutting item: ${error}`);
        }
    }

    /**
     * Commands of Visual Studio's multi-select: they act on all selected nodes of the kinds that offer them,
     * asking once. Other commands act on the clicked node only.
     */
    static readonly multiSelectActions: readonly ProjectActionCmd['action'][] = [
        'deleteFile', 'removeProject', 'removeSolutionItem', 'removeDependency', 'copy', 'cut', 'build', 'rebuild', 'clean',
    ];

    static async handleMultiAction(action: ProjectActionCmd['action'], nodeIdStrings: readonly NodeIdString[]): Promise<void> {
        const nodes = nodeIdStrings.map(id => NodeIdService.parse(id));
        const confirm = async (question: string, button: string) =>
            await vscode.window.showWarningMessage(question, { modal: true }, button) === button;
        const solution = SolutionService.getActiveSolution();
        try {
            switch (action) {
                case 'deleteFile':
                    if (await confirm(`Delete ${nodes.length} items? They are moved to the trash.`, 'Delete')) {
                        for (const node of nodes) {
                            await vscode.workspace.fs.delete(vscode.Uri.file(node.path), { recursive: true, useTrash: true });
                        }
                    }
                    break;
                case 'removeProject':
                    if (solution && await confirm(`Remove ${nodes.length} projects from the solution? Their files stay on disk.`, 'Remove')) {
                        for (const node of nodes) {
                            await solution.removeProject(node.path);
                        }
                    }
                    break;
                case 'removeSolutionItem':
                    if (solution && await confirm(`Remove ${nodes.length} items from the solution? The files stay on disk.`, 'Remove')) {
                        for (const node of nodes) {
                            await solution.removeSolutionItem(node.path);
                        }
                    }
                    break;
                case 'removeDependency':
                    if (await confirm(`Remove ${nodes.length} references from their projects?`, 'Remove')) {
                        for (const node of nodes) {
                            const info = NodeIdService.getDependencyInfoFromNode(node);
                            if (info) {
                                await this._removeDependencyFromCsproj(info.projectPath, info.dependencyType, info.dependencyName);
                            }
                        }
                    }
                    break;
                case 'copy':
                case 'cut':
                    this.clipboard = { paths: nodes.map(node => node.path), operation: action };
                    break;
                case 'build':
                case 'rebuild':
                case 'clean':
                    // One after the other, like Visual Studio's Build Selection
                    for (const node of nodes) {
                        const exitCode = await runTask(createDotnetTask({ type: DOTNET_TASK_TYPE, action, target: node.path }));
                        if (exitCode !== 0) {
                            break;
                        }
                    }
                    break;
                default:
                    log.warn(`${action} has no multi-select variant`);
            }
        } catch (error) {
            log.error(`${action} on ${nodes.length} nodes failed:`, error);
            vscode.window.showErrorMessage(`${action} failed: ${error instanceof Error ? error.message : error}`);
        }
    }

    /** Copies or moves one file or folder into `pasteTargetPath`, asking before replacing */
    private static async _pasteOne(sourcePath: string, pasteTargetPath: string, operation: 'copy' | 'cut'): Promise<void> {
        const sourceName = path.basename(sourcePath);
        const destinationPath = path.join(pasteTargetPath, sourceName);

        const sourceUri = vscode.Uri.file(sourcePath);
        const destinationUri = vscode.Uri.file(destinationPath);

        // Check if source still exists
        try {
            await vscode.workspace.fs.stat(sourceUri);
        } catch {
            vscode.window.showErrorMessage('Source item no longer exists');
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

        const wasFileMoved = operation === 'cut' && destinationPath.endsWith('.cs');
        log.debug(`Checking namespace updates: operation=${operation}, destinationPath=${destinationPath}, wasFileMoved=${wasFileMoved}`);

        if (operation === 'copy') {
            // Copy operation using VS Code's workspace API
            await vscode.workspace.fs.copy(sourceUri, destinationUri, { overwrite: true });
            log.info(`Copied ${sourcePath} to ${destinationPath}`);
        } else {
            // Cut operation (move) using VS Code's workspace API
            await vscode.workspace.fs.rename(sourceUri, destinationUri);
            log.info(`Moved ${sourcePath} to ${destinationPath}`);
        }

        // Force refresh the solution tree to ensure UI updates
        const solution = SolutionService.getActiveSolution();
        if (solution) {
            await solution.forceRefreshAllProjects();
        }

        // Now check namespace updates for moved C# files
        if (wasFileMoved) {
            log.info(`Triggering namespace check for moved C# file: ${destinationPath}`);

            // The expected namespace comes from the project the file was moved into
            await this._checkAndUpdateNamespace(destinationPath, 'File moved');
        } else {
            log.debug(`Namespace check skipped - not a moved C# file`);
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
            const targetPath = nodeId.path;
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

            const { paths, operation } = this.clipboard;
            for (const sourcePath of paths) {
                await this._pasteOne(sourcePath, pasteTargetPath, operation);
            }
            if (operation === 'cut') {
                this.clipboard = null;
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