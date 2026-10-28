import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../../core/logger';
import { SolutionService } from '../solutionService';
import { NodeId } from '../nodeIdService';
import { updateNamespacesAfterMove } from '../namespaceAfterMove';
import { copyExistingItems } from '../existingItems';
import { projectForPath } from '../templates/templateService';
import { ProjectItemsService } from '../projectItems/projectItemsService';
import { excludeEdit, includeEdit, includeItemCount, INCLUDE_CONFIRM_LIMIT, listFilesUnder, membershipApplied, membershipRefusal } from '../projectItems/projectItemEdits';
import { itemsWithoutExcludes } from '../projectItems/defaultItems';
import { linkedDeleteDetail, removeLinkedItem } from '../projectItems/linkedItems';
import { pathKey } from '../projectItems/projectItems';
import type { Project } from '../../core/Project';

const log = logger('fileActions');

export async function handleOpenFile(nodeId: NodeId): Promise<void> {
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

export async function handleDeleteFile(nodeId: NodeId): Promise<void> {
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

        // A linked file lives outside the project: say that the real file goes, and offer to remove only the link
        const linking = isDirectory ? [] : projectsLinking(filePath);
        if (linking.length > 0) {
            const choice = await vscode.window.showWarningMessage(`Delete the linked file '${path.basename(filePath)}'?`,
                { modal: true, detail: linkedDeleteDetail(filePath, linking.map(project => project.name)) }, 'Remove Link', 'Delete');
            if (choice === 'Remove Link') {
                await handleRemoveLink(nodeId);
            } else if (choice === 'Delete') {
                await vscode.workspace.fs.delete(vscode.Uri.file(filePath), { recursive: false, useTrash: true });
                log.info(`linked file deleted: ${filePath}`);
            }
            return;
        }

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

/** The loaded projects of the solution that link the file (their evaluation lists it at a `Link` path) */
export function projectsLinking(filePath: string): Project[] {
    const solution = SolutionService.getActiveSolution();
    return [...(solution?.projects.values() ?? [])]
        .filter(project => ProjectItemsService.instance.get(project.projectPath)?.isLinked(filePath));
}

/** Remove Link: deletes the item that links the file from the project file; the file itself stays */
export async function handleRemoveLink(nodeId: NodeId): Promise<void> {
    const filePath = nodeId.path;
    const name = path.basename(filePath);
    const linking = projectsLinking(filePath);
    if (linking.length === 0) {
        vscode.window.showWarningMessage(`${name} is not a linked file of a project.`);
        return;
    }
    // A file id can name the project whose tree shows it (a nested project's folder): that one, without asking
    const owner = nodeId.type === 'file' && nodeId.project
        ? linking.find(candidate => pathKey(path.normalize(candidate.projectPath)) === pathKey(path.normalize(nodeId.project!)))
        : undefined;
    let project = owner ?? linking[0];
    if (!owner && linking.length > 1) {
        // The node id is the file: the tree row it was clicked in is not known
        const picked = await vscode.window.showQuickPick(linking.map(candidate => ({ label: candidate.name, project: candidate })),
            { placeHolder: `${name} is linked by several projects: remove the link from which one?` });
        if (!picked) {
            return;
        }
        project = picked.project;
    }
    const projectPath = project.projectPath;
    try {
        const itemTypes = ProjectItemsService.instance.get(projectPath)?.itemTypesOf(filePath) ?? [];
        const content = await fs.promises.readFile(projectPath, 'utf8');
        const edit = removeLinkedItem(content, path.dirname(projectPath), filePath, itemTypes);
        if (!edit.removed) {
            vscode.window.showWarningMessage(`The link to ${name} is not an item of its own in ${path.basename(projectPath)}: `
                + 'a wildcard or another file (Directory.Build.props, an import) adds it. Remove it there.');
            return;
        }
        await fs.promises.writeFile(projectPath, edit.content, 'utf8');
        await project.reevaluateItems();
    } catch (error) {
        log.error(`Remove Link failed for ${filePath}:`, error);
        vscode.window.showErrorMessage(`Could not remove the link to ${name}: ${error instanceof Error ? error.message : error}`);
    }
}

export async function handleRevealInExplorer(nodeId: NodeId): Promise<void> {
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

/** "Add Existing Item...": copies the picked files into the project or folder */
export async function handleAddExistingItem(nodeId: NodeId): Promise<void> {
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

/**
 * Creates a new, empty file at the specified path; an existing file is never touched
 */
export async function createFile(filePath: string): Promise<void> {
    try {
        log.info(`Creating file: ${filePath}`);
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        // `wx`: fails when the file exists instead of emptying it
        await fs.promises.writeFile(filePath, '', { encoding: 'utf8', flag: 'wx' });
        log.info(`File created successfully: ${filePath}`);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new Error(`${path.basename(filePath)} already exists`);
        }
        log.error('Error creating file:', error);
        throw error;
    }
}

/**
 * Creates a new folder at the specified path
 */
export async function createFolder(folderPath: string): Promise<void> {
    try {
        log.info(`Creating folder: ${folderPath}`);
        if (fs.existsSync(folderPath)) {
            throw new Error(`${path.basename(folderPath)} already exists`);
        }
        await fs.promises.mkdir(folderPath, { recursive: true });
        log.info(`Folder created successfully: ${folderPath}`);
    } catch (error) {
        log.error('Error creating folder:', error);
        throw error;
    }
}

// Static clipboard to store copy/cut operations
export const clipboard: { current: {
    /** The copied or cut files and folders */
    paths: string[];
    operation: 'copy' | 'cut';
} | null } = { current: null };

/** Exclude From Project / Include In Project: edits the project file, then evaluates the project again */
export async function handleItemMembership(nodeId: NodeId, exclude: boolean): Promise<void> {
    const target = nodeId.path;
    const isFolder = nodeId.type === 'folder';
    const solution = SolutionService.getActiveSolution();
    const refusal = membershipRefusal(target, isFolder, [...(solution?.projects.keys() ?? [])]);
    if (refusal) {
        vscode.window.showWarningMessage(refusal);
        return;
    }
    // The project whose tree was clicked: in a nested project's folder the id names the outer one when it was there
    const shownIn = nodeId.type === 'file' || nodeId.type === 'folder' ? nodeId.project : undefined;
    const projectPath = shownIn ?? projectForPath(target);
    const project = projectPath ? solution?.projects.get(projectPath) : undefined;
    if (!projectPath || !project) {
        vscode.window.showWarningMessage('The item is not in a project.');
        return;
    }
    try {
        const items = await ProjectItemsService.instance.evaluate(projectPath);
        if (exclude && !items) {
            vscode.window.showErrorMessage('Could not read the project items (is the .NET SDK installed?).');
            return;
        }
        const projectDir = path.dirname(projectPath);
        const content = await fs.promises.readFile(projectPath, 'utf8');
        const filesUnder = !exclude && isFolder ? await listFilesUnder(target) : [];
        const adding = exclude ? 0 : includeItemCount(content, projectDir, target, isFolder, filesUnder);
        if (adding > INCLUDE_CONFIRM_LIMIT) {
            const choice = await vscode.window.showWarningMessage(`Include ${adding} files?`, {
                modal: true,
                detail: `${path.basename(target)} is not excluded by a Remove item, so each file under it gets an Include item in the project file.`,
            }, 'Include');
            if (choice !== 'Include') {
                return;
            }
        }
        // The item types MSBuild would give the files without the exclude (one more evaluation, only when Include adds items)
        const newItems = adding > 0 ? await itemsWithoutExcludes(projectPath) : undefined;
        const edited = exclude
            ? excludeEdit(content, projectDir, target, isFolder, items!)
            : includeEdit(content, projectDir, target, isFolder, filesUnder, newItems);
        if (edited !== content) {
            await fs.promises.writeFile(projectPath, edited, 'utf8');
        }
        await project.reevaluateItems();
        const after = await ProjectItemsService.instance.evaluate(projectPath);
        if (after && !membershipApplied(after, target, isFolder, exclude)) {
            vscode.window.showWarningMessage(`${path.basename(target)} is still ${exclude ? 'in' : 'not in'} the project: `
                + 'other items decide it (an explicit Include or Remove, Directory.Build.props or .targets, an imported file). Check the project file.');
        }
    } catch (error) {
        log.error(`${exclude ? 'Exclude' : 'Include'} failed for ${target}:`, error);
        vscode.window.showErrorMessage(`Could not ${exclude ? 'exclude' : 'include'} ${path.basename(target)}: ${error instanceof Error ? error.message : error}`);
    }
}

/**
 * Handles copying a file or folder to the clipboard
 */
export async function handleCopy(nodeId: NodeId): Promise<void> {
    try {
        const itemPath = nodeId.path;
        if (!itemPath) {
            log.error('Cannot extract path from nodeId:', nodeId);
            vscode.window.showErrorMessage('Error: Cannot determine item path');
            return;
        }

        clipboard.current = { paths: [itemPath], operation: 'copy' };

        log.info(`Copied to clipboard: ${itemPath}`);
    } catch (error) {
        log.error('Error copying item:', error);
        vscode.window.showErrorMessage(`Error copying item: ${error}`);
    }
}

/**
 * Handles cutting a file or folder to the clipboard
 */
export async function handleCut(nodeId: NodeId): Promise<void> {
    try {
        const itemPath = nodeId.path;
        if (!itemPath) {
            log.error('Cannot extract path from nodeId:', nodeId);
            vscode.window.showErrorMessage('Error: Cannot determine item path');
            return;
        }

        clipboard.current = { paths: [itemPath], operation: 'cut' };

        log.info(`Cut to clipboard: ${itemPath}`);
    } catch (error) {
        log.error('Error cutting item:', error);
        vscode.window.showErrorMessage(`Error cutting item: ${error}`);
    }
}

/** Copies or moves one file or folder into `pasteTargetPath`, asking before replacing; returns where it went (undefined: not done) */
export async function pasteOne(sourcePath: string, pasteTargetPath: string, operation: 'copy' | 'cut'): Promise<string | undefined> {
    const sourceName = path.basename(sourcePath);
    const destinationPath = path.join(pasteTargetPath, sourceName);

    const sourceUri = vscode.Uri.file(sourcePath);
    const destinationUri = vscode.Uri.file(destinationPath);

    // Check if source still exists
    try {
        await vscode.workspace.fs.stat(sourceUri);
    } catch {
        vscode.window.showErrorMessage('Source item no longer exists');
        return undefined;
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
            return undefined;
        }
    }

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

    return destinationPath;
}

/**
 * Handles pasting a file or folder from the clipboard
 */
export async function handlePaste(nodeId: NodeId): Promise<void> {
    try {
        log.info(`_handlePaste called: nodeId=${nodeId}, clipboard=${JSON.stringify(clipboard.current)}`);

        if (!clipboard.current) {
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

        const { paths, operation } = clipboard.current;
        const moved: string[] = [];
        for (const sourcePath of paths) {
            const destination = await pasteOne(sourcePath, pasteTargetPath, operation);
            if (destination && operation === 'cut') {
                moved.push(destination);
            }
        }
        if (operation === 'cut') {
            clipboard.current = null;
            // One question for everything that was moved, as after a drop
            await updateNamespacesAfterMove(moved, 'Moved');
        }
    } catch (error) {
        log.error('Error pasting item:', error);
        vscode.window.showErrorMessage(`Error pasting item: ${error}`);
    }
}
