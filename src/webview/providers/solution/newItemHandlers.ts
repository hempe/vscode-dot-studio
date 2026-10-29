import * as vscode from 'vscode';
import * as path from 'path';
import { itemNameProblem } from '../../../services/project/itemNames';
import { SolutionActionService } from '../../../services/solution/solutionActionService';
import { SolutionExpansionService } from '../../../services/solution/solutionExpansionService';
import { NodeIdService } from '../../../services/solution/nodeIdService';
import { logger } from '../../../core/logger';
import { NodeIdString } from '../../../types/nodeId';
import { sendToUi } from '../../nuget-view/shared';
import { projectForPath } from '../../../services/templates/templateService';
import { openNewItemWizard } from '.././TemplateWizardPanel';

const log = logger('newItemHandlers');

/** What the handlers need from the Solution Explorer provider */
export interface NewItemHost {
    readonly webview: vscode.Webview | undefined;
    readonly context: vscode.ExtensionContext;
    refreshTree(reason: string): Promise<void>;
}

/**
 * Returns the directory new files/folders are created in for a folder or project node
 */
export function getContainerDirectory(nodeId: NodeIdString): string | undefined {
    const node = NodeIdService.parse(nodeId);
    switch (node?.type) {
        case 'folder': return node.path;
        case 'project': return path.dirname(node.path);
        default: return undefined;
    }
}

/**
 * Handles the addFile action by creating a temporary node in edit mode
 */
/** "Add New Item...": the template wizard for the folder (or project root) */
export async function handleAddNewItemAction(parentNodeId: NodeIdString): Promise<void> {
    const parentDir = getContainerDirectory(parentNodeId);
    const projectPath = parentDir && projectForPath(parentDir);
    if (!parentDir || !projectPath) {
        log.error('Add New Item: no project for', parentNodeId);
        return;
    }
    openNewItemWizard(parentDir, projectPath);
}

export async function handleAddFileAction(parentNodeId: NodeIdString, host: NewItemHost): Promise<void> {
    try {
        const parentDir = getContainerDirectory(parentNodeId);
        if (!parentDir) {
            log.error('Invalid parent node ID, cannot extract path:', parentNodeId);
            vscode.window.showErrorMessage(`Error adding file: invalid parent path`);
            return;
        }

        log.info(`Creating temporary file node for parent: ${parentDir}`);

        // Send a message to the webview to create a temporary node in edit mode
        sendToUi(host.webview, {
            type: 'addTemporaryNode',
            payload: {
                parentNodeId: parentNodeId,
                nodeId: NodeIdService.generateTemporaryId('file', parentDir),
                nodeType: 'file'
            }
        });

        log.info(`Sent addTemporaryNode message to webview`);
    } catch (error) {
        log.error('Error handling add file action:', error);
        vscode.window.showErrorMessage(`Error adding file: ${error}`);
    }
}

/**
 * Handles the addFolder action by creating a temporary node in edit mode
 */
export async function handleAddFolderAction(parentNodeId: NodeIdString, host: NewItemHost): Promise<void> {
    try {
        const parentDir = getContainerDirectory(parentNodeId);
        if (!parentDir) {
            log.error('Invalid parent node ID, cannot extract path:', parentNodeId);
            vscode.window.showErrorMessage(`Error adding folder: invalid parent path`);
            return;
        }

        log.info(`Creating temporary folder node for parent: ${parentDir}`);

        // Send a message to the webview to create a temporary node in edit mode
        sendToUi(host.webview, {
            type: 'addTemporaryNode',
            payload: {
                parentNodeId: parentNodeId,
                nodeId: NodeIdService.generateTemporaryId('folder', parentDir),
                nodeType: 'folder'
            }
        });

        log.info(`Sent addTemporaryNode message to webview for folder`);
    } catch (error) {
        log.error('Error handling add folder action:', error);
        vscode.window.showErrorMessage(`Error adding folder: ${error}`);
    }
}

/**
 * Handles actual file creation when a temporary node is confirmed
 */
export async function handleCreateFileAction(parentNodeId: NodeIdString, fileName: string, host: NewItemHost): Promise<void> {
    try {
        const nodeId = NodeIdService.parse(parentNodeId);
        const parentPath = nodeId.path;

        if (!parentPath) {
            log.error('Invalid node ID, cannot extract parent path:', nodeId);
            vscode.window.showErrorMessage(`Error creating file: invalid parent path`);
            return;
        }

        const problem = itemNameProblem(fileName);
        if (problem) {
            vscode.window.showErrorMessage(`Cannot create "${fileName}": ${problem}`);
            return;
        }

        log.info(`Creating actual file: ${fileName} in ${parentPath}`);
        const fullPath = path.join(parentPath, fileName);
        await SolutionActionService.createFile(fullPath);

        log.info(`File created successfully: ${fullPath}`);
        // Send message to remove all temporary nodes for this parent
        /*
        sendToUi(host.webview, {
            type: 'removeTemporaryNodes',
            payload: {
                parentPath: parentPath
            }
        });
*/
        // Ensure parent folder stays expanded by adding it to expansion state AFTER refresh
        const currentExpanded = SolutionExpansionService.getExpansionState(host.context);
        if (!currentExpanded.has(parentNodeId)) {
            currentExpanded.add(parentNodeId);
            SolutionExpansionService.saveExpansionState(currentExpanded, host.context);
            log.info(`Added folder to expansion state: ${parentNodeId}`);
        } else {
            log.info(`Folder already in expansion state: ${parentNodeId}`);
        }

        //return host.refreshTree(`File created: ${fileName}`);
    } catch (error) {
        log.error('Error creating file:', error);
        vscode.window.showErrorMessage(`Error creating file: ${error}`);
    }
}

/**
 * Handles actual folder creation when a temporary node is confirmed
 */
export async function handleCreateFolderAction(parentNodeId: NodeIdString, folderName: string, host: NewItemHost): Promise<void> {
    try {
        const nodeId = NodeIdService.parse(parentNodeId);
        const parentPath = nodeId.path;
        if (!parentPath) {
            log.error('Invalid node ID, cannot extract parent path:', nodeId);
            vscode.window.showErrorMessage(`Error creating folder: invalid parent path`);
            return;
        }

        const problem = itemNameProblem(folderName);
        if (problem) {
            vscode.window.showErrorMessage(`Cannot create "${folderName}": ${problem}`);
            return;
        }

        log.info(`Creating actual folder: ${folderName} in ${parentPath}`);

        const fullPath = path.join(parentPath, folderName);
        await SolutionActionService.createFolder(fullPath);

        log.info(`Folder created successfully: ${fullPath}`);

        // Send message to remove all temporary nodes for this parent
        sendToUi(host.webview, {
            type: 'removeTemporaryNodes',
            payload: {
                parentPath: parentPath
            }
        });

        // Trigger immediate tree refresh
        await host.refreshTree(`folder creation: ${folderName}`);

        const currentExpanded = SolutionExpansionService.getExpansionState(host.context);
        if (!currentExpanded.has(parentNodeId)) {
            currentExpanded.add(parentNodeId);
            SolutionExpansionService.saveExpansionState(currentExpanded, host.context);
            log.info(`Added folder to expansion state: ${parentNodeId}`);

            // Force another tree update to apply the expansion state
            await host.refreshTree(`Folder created: ${folderName}`);
        } else {
            log.info(`Folder already in expansion state: ${parentNodeId}`);
        }
    } catch (error) {
        log.error('Error creating folder:', error);
        vscode.window.showErrorMessage(`Error creating folder: ${error}`);
    }
}
