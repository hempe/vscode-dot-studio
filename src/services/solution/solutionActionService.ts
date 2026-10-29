import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../core/logger';
import { SolutionService } from './solutionService';
import { NodeId, NodeIdService } from './nodeIdService';
import { ProjectActionCmd } from '../types/commands/project-action';
import { createDotnetTask, DotnetTaskAction, DOTNET_TASK_TYPE } from './dotnetTaskProvider';
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
import { startWithHotReload } from './hotReload/startWithHotReload';
import { openNewProjectWizard } from '../webview/providers/TemplateWizardPanel';
import { addServiceReference, removeServiceReferenceWithConfirmation, updateServiceReference } from './serviceReferences/serviceReferenceService';
import { removeGrpcReference, updateGrpcReference } from './grpc/grpcReferenceService';
import { runEfAction } from './entityFramework/efCommands';

import { handleAddExistingItem, handleCopy, handleCut, handleDeleteFile, handleItemMembership, handleOpenFile, handlePaste, handleRemoveLink, handleRevealInExplorer } from './solutionActions/fileActions';
import { handleAddExistingProject, handleAddSolutionFolder, handleAddSolutionItem, handleDeleteProject, handleRemoveProject, handleRemoveSolutionFolder, handleRemoveSolutionItem, handleSetStartupProject, solutionFolderPathOf } from './solutionActions/solutionFileActions';
import { handleRename } from './solutionActions/renameActions';
import { handleAddAssemblyReference, handleAddProjectReference, handleManageNuGetPackages, handleManageNuGetPackagesForSolution, handleRemoveDependency, handleRestoreDependencies } from './solutionActions/referenceActions';
import { createFile, createFolder } from './solutionActions/fileActions';
import { moveNodes } from './solutionActions/dragDrop';
import { handleMultiAction, multiSelectActions } from './solutionActions/multiSelect';

const log = logger('SolutionActionService');

/**
 * Routes the actions of the Solution Explorer (context menus, keys, toolbar) to the code that does them. That code lives
 * in `solutionActions/`: files and the clipboard, the solution file (folders, items, projects), renames, references,
 * drag and drop and multi-select.
 */
export class SolutionActionService {

    // The work of the actions lives in solutionActions/, by what they act on; these are what the rest of the code calls
    static readonly createFile = createFile;
    static readonly createFolder = createFolder;
    static readonly moveNodes = moveNodes;
    static readonly multiSelectActions = multiSelectActions;
    static readonly handleMultiAction = handleMultiAction;

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
                await handleOpenFile(nodeId);
                break;

            case 'addExistingItem':
                await handleAddExistingItem(nodeId);
                break;

            case 'startNewInstance':
            case 'startWithoutDebugging':
                await DebugConfigService.startProject(nodeId.path, cmd.action === 'startWithoutDebugging');
                break;

            case 'startWithHotReload':
                await startWithHotReload(nodeId.path);
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

            case 'addMigration':
            case 'updateDatabase':
            case 'removeMigration':
                await runEfAction(cmd.action, nodeId.path);
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
                await handleRename(nodeId, cmd.data.newName, cmd.data.type, cmd.data.oldName);
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
                await handleDeleteFile(nodeId);
                break;

            case 'removeSolutionItem':
                await handleRemoveSolutionItem(nodeId);
                break;

            case 'revealInExplorer':
                await handleRevealInExplorer(nodeId);
                break;

            case 'addExistingProject':
                await handleAddExistingProject(nodeId);
                break;

            case 'addNewProject':
                openNewProjectWizard(nodeId.type === 'solutionFolder' ? solutionFolderPathOf(nodeId) : undefined);
                break;

            case 'manageNuGetPackages':
                await handleManageNuGetPackages(nodeId);
                break;

            case 'manageNuGetPackagesForSolution':
                await handleManageNuGetPackagesForSolution(nodeId);
                break;

            case 'addProjectReference':
                await handleAddProjectReference(nodeId);
                break;

            case 'addAssemblyReference':
                await handleAddAssemblyReference(nodeId);
                break;

            case 'restoreDependencies':
                await handleRestoreDependencies(nodeId);
                break;

            case 'removeDependency':
                await handleRemoveDependency(nodeId);
                break;

            case 'addSolutionFolder':
                await handleAddSolutionFolder(nodeId);
                break;

            case 'removeSolutionFolder':
                await handleRemoveSolutionFolder(nodeId);
                break;

            case 'addSolutionItem':
                await handleAddSolutionItem(nodeId);
                break;

            case 'removeProject':
                await handleRemoveProject(nodeId);
                break;

            case 'deleteProject':
                await handleDeleteProject(nodeId);
                break;

            case 'setStartupProject':
                await handleSetStartupProject(nodeId);
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

            case 'updateGrpcReference':
                if (nodeId.type === 'grpcReference') {
                    await updateGrpcReference(nodeId.project, nodeId.path);
                }
                break;

            case 'removeGrpcReference':
                if (nodeId.type === 'grpcReference') {
                    await removeGrpcReference(nodeId.project, nodeId.path);
                }
                break;

            case 'excludeFromProject':
            case 'includeInProject':
                await handleItemMembership(nodeId, cmd.action === 'excludeFromProject');
                break;

            case 'removeLink':
                await handleRemoveLink(nodeId);
                break;

            case 'copy':
                await handleCopy(nodeId);
                break;

            case 'cut':
                await handleCut(nodeId);
                break;

            case 'paste':
                await handlePaste(nodeId);
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



}