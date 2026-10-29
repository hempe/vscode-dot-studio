import * as path from 'path';
import * as crypto from 'crypto';
import { SolutionFileParser } from '../parsers/solutionFileParser';
import { SolutionXFileEditor } from '../parsers/solutionXFileEditor';
import { SolutionFileEditor } from '../parsers/solutionFileEditor';
import { SolutionFile, SolutionProject, PROJECT_TYPE_GUIDS } from '../types/solution';
import { ISolutionFileHandler } from '../handlers';
import { SolutionFolderNodeId } from '../services/solution/nodeIdService';
import { logger } from './logger';

const log = logger('SolutionFolderEditor');
const sameGuid = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A node of the solution file that drag & drop moves to another solution folder */
export type SolutionNodeMove =
    | { readonly kind: 'project'; readonly projectPath: string }
    | { readonly kind: 'solutionFolder'; readonly folderGuid: string }
    | { readonly kind: 'solutionItem'; readonly filePath: string; readonly folderGuid: string };

/** What the editor needs from the solution it edits */
export interface SolutionEditHost {
    handler(): ISolutionFileHandler;
    solutionFile(): SolutionFile | undefined;
    solutionPath(): string;
    isSlnx(): boolean;
    /** Reads the solution file again, so the model is fresh */
    parse(): Promise<void>;
    editSlnx(edit: (content: string) => string): Promise<void>;
    editSlnLines(edit: (lines: string[]) => string[]): Promise<void>;
    getSolutionItems(project: SolutionProject): string[];
}

/**
 * The edits of a solution's folders and items, for .sln and .slnx: add, rename, remove and move folders, add and remove
 * solution items. The solution passes itself as `host`; the file formats are in SolutionFileEditor and SolutionXFileEditor.
 */
export class SolutionFolderEditor {
    constructor(private readonly host: SolutionEditHost) { }

    /**
     * Returns the path segments of a solution folder (e.g. ['src', 'libs']) by walking up the nesting
     */
    private getSolutionFolderSegments(folderGuid: string): string[] {
        const segments: string[] = [];
        let guid: string | undefined = folderGuid;

        while (guid) {
            const folder = this.host.solutionFile()?.projects.find(p => p.guid === guid && SolutionFileParser.isSolutionFolder(p));
            if (!folder) {
                throw new Error(`Solution folder "${guid}" not found`);
            }
            segments.unshift(folder.name);
            guid = this.host.solutionFile()?.nestedProjects.find(n => n.childGuid === guid)?.parentGuid;
        }

        return segments;
    }

    /**
     * Adds a solution folder to the solution file
     */
    async addSolutionFolder(folderName: string, parentNode?: SolutionFolderNodeId): Promise<void> {
        log.info(`Adding solution folder: ${folderName}${parentNode?.name ? ` under ${parentNode.name}` : ''}`);

        try {
            if (!folderName.trim() || /["\/\\]/.test(folderName)) {
                throw new Error(`Invalid solution folder name "${folderName}"`);
            }
            this.assertFolderNameFree(folderName, parentNode?.guid);

            if (this.host.isSlnx()) {
                const parentSegments = parentNode ? this.getSolutionFolderSegments(parentNode.guid) : [];
                await this.host.editSlnx(content => SolutionXFileEditor.addFolder(content, [...parentSegments, folderName]));
                log.info(`Successfully added solution folder "${folderName}" to solution`);
                return;
            }

            // Edit the .sln lines (read, write and re-parse happen together, one edit at a time)
            await this.host.editSlnLines(lines => {

                // Generate a new GUID for the solution folder
                const folderGuid = `{${crypto.randomUUID().toUpperCase()}}`;
                const solutionFolderTypeGuid = PROJECT_TYPE_GUIDS.SOLUTION_FOLDER;

                // Create the solution folder entry
                const folderEntry = `Project("${solutionFolderTypeGuid}") = "${folderName}", "${folderName}", "${folderGuid}"`;
                const folderEndEntry = 'EndProject';

                // Find the right place to insert the solution folder (after other projects but before GlobalSection)
                let insertIndex = -1;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();

                    if (line === 'Global' || line.startsWith('Global')) {
                        insertIndex = i;
                        break;
                    }
                }

                // If no Global section found, append at the end
                if (insertIndex === -1) {
                    insertIndex = lines.length;
                }

                // Insert the solution folder
                let newLines = [
                    ...lines.slice(0, insertIndex),
                    folderEntry,
                    folderEndEntry,
                    ...lines.slice(insertIndex)
                ];

                // If this is a nested folder, we need to add/update the NestedProjects section
                if (parentNode) {
                    // Find the parent folder's GUID
                    if (!parentNode.guid) {
                        throw new Error(`Parent solution folder "${parentNode.name}" not found`);
                    }

                    // Add or update NestedProjects section
                    newLines = SolutionFileEditor.addNestedProjectEntry(newLines, folderGuid, parentNode?.guid);
                }

                return newLines;
            });

            log.info(`Successfully added solution folder "${folderName}" to solution`);


        } catch (error) {
            log.error(`Error adding solution folder to solution:`, error);
            throw error;
        }
    }

    /**
     * Finds the GUID of a solution folder by its name
     */
    findSolutionFolderGuid(folderName: string): string | null {
        if (!this.host.solutionFile()?.projects) {
            return null;
        }
        const folder = this.host.solutionFile()!.projects.find(
            p => p.name === folderName && SolutionFileParser.isSolutionFolder(p)
        );
        return folder ? folder.guid : null;
    }

    /**
     * Throws when a sibling already has the name (MSBuild refuses a solution with two folders of one name in one
     * folder, MSB5004); `ownGuid` is the folder being renamed, which may change the case of its own name
     */
    private assertFolderNameFree(name: string, parentGuid: string | undefined, ownGuid?: string): void {
        const parent = parentGuid?.toUpperCase();
        const taken = (this.host.solutionFile()?.projects ?? []).some(project =>
            SolutionFileParser.isSolutionFolder(project)
            && project.guid.toUpperCase() !== ownGuid?.toUpperCase()
            && project.name.toLowerCase() === name.toLowerCase()
            && this.host.solutionFile()!.nestedProjects.find(n => n.childGuid.toUpperCase() === project.guid.toUpperCase())?.parentGuid.toUpperCase() === parent);
        if (taken) {
            throw new Error(`A solution folder named "${name}" already exists here`);
        }
    }

    /**
     * Gets the name of a solution folder by its GUID
     */
    private getSolutionFolderName(folderGuid: string): string {
        const folder = this.host.solutionFile()?.projects.find(
            p => p.guid === folderGuid && SolutionFileParser.isSolutionFolder(p)
        );
        if (!folder) {
            throw new Error(`Solution folder "${folderGuid}" not found`);
        }
        return folder.name;
    }

    /**
     * Removes a solution folder from the solution file
     */
    async removeSolutionFolder(folderGuid: string): Promise<void> {
        log.info(`Removing solution folder: ${folderGuid}`);

        try {
            // Identify the folder by GUID: names are only unique among siblings
            const folderName = this.getSolutionFolderName(folderGuid);

            if (this.host.isSlnx()) {
                const segments = this.getSolutionFolderSegments(folderGuid);
                await this.host.editSlnx(content => SolutionXFileEditor.removeFolder(content, segments));
                log.info(`Successfully removed solution folder "${folderName}" from solution`);
                return;
            }

            // Note: folder info captured but not currently used for event firing

            // Edit the .sln lines (read, write and re-parse happen together, one edit at a time)
            await this.host.editSlnLines(lines => {
                // Find all child items (projects and folders) that need to be removed recursively
                const allItemsToRemove = this.findAllChildItemsRecursively(folderGuid);
                log.info(`Found ${allItemsToRemove.length} child items to remove recursively`);

                // Remove all child projects and folders recursively, of any project type (a SQL project is not a .NET one)
                let newLines = lines;
                for (const itemGuid of allItemsToRemove) {
                    const itemProject = this.host.solutionFile()?.projects.find(p => sameGuid(p.guid, itemGuid));
                    if (itemProject) {
                        if (SolutionFileParser.isSolutionFolder(itemProject)) {
                            newLines = SolutionFileEditor.removeSolutionFolderProject(newLines, itemProject.name, itemGuid);
                            log.info(`Removed child solution folder: ${itemProject.name}`);
                        } else {
                            newLines = SolutionFileEditor.removeProjectByGuid(newLines, itemGuid);
                            newLines = SolutionFileEditor.removeProjectConfigurationLines(newLines, itemGuid);
                            log.info(`Removed child project: ${itemProject.name}`);
                        }
                    }
                }

                // Remove the solution folder Project/EndProject block
                newLines = SolutionFileEditor.removeSolutionFolderProject(newLines, folderName, folderGuid);

                // Remove all NestedProjects entries that reference this folder or any of its children
                newLines = SolutionFileEditor.removeNestedProjectEntries(newLines, folderGuid);
                for (const itemGuid of allItemsToRemove) {
                    newLines = SolutionFileEditor.removeNestedProjectEntries(newLines, itemGuid);
                }

                log.info(`Successfully removed solution folder "${folderName}" and ${allItemsToRemove.length} child items from solution`);
                return newLines;
            });

            // File watcher will handle the tree update

        } catch (error) {
            log.error(`Error removing solution folder from solution:`, error);
            throw error;
        }
    }

    /**
     * Renames a solution folder in the solution file
     */
    async renameSolutionFolder(folderGuid: string, newName: string): Promise<void> {
        try {
            const oldName = this.getSolutionFolderName(folderGuid);
            log.info(`Renaming solution folder from "${oldName}" to "${newName}"`);

            if (!newName.trim() || /["\/\\]/.test(newName)) {
                throw new Error(`Invalid solution folder name "${newName}"`);
            }
            this.assertFolderNameFree(newName, this.host.solutionFile()?.nestedProjects.find(n => n.childGuid === folderGuid)?.parentGuid, folderGuid);

            if (this.host.isSlnx()) {
                const segments = this.getSolutionFolderSegments(folderGuid);
                await this.host.editSlnx(content => SolutionXFileEditor.renameFolder(content, segments, newName));
                log.info(`Successfully renamed solution folder from "${oldName}" to "${newName}"`);
                return;
            }

            // Edit the .sln lines (read, write and re-parse happen together, one edit at a time)
            await this.host.editSlnLines(lines => {

                // Find and update the Project line for this solution folder
                const solutionFolderTypeGuid = PROJECT_TYPE_GUIDS.SOLUTION_FOLDER;
                const updatedLines = lines.map(line => {
                    const trimmedLine = line.trim();

                    // Check if this is the Project line for our solution folder
                    if (trimmedLine.includes(`Project("${solutionFolderTypeGuid}")`) &&
                        trimmedLine.includes(`"${oldName}"`) &&
                        trimmedLine.includes(folderGuid)) {
                        // Replace the old name with the new name in the Project line
                        // Format: Project("{guid}") = "OldName", "OldName", "{folder-guid}"
                        return line.split(`"${oldName}"`).join(`"${newName}"`);
                    }

                    return line;
                });

                return updatedLines;
            });

            log.info(`Successfully renamed solution folder from "${oldName}" to "${newName}"`);


            // File watcher will handle the tree update

        } catch (error) {
            log.error(`Error renaming solution folder:`, error);
            throw error;
        }
    }

    /**
     * Adds a solution item (file) to a solution folder
     */
    async addSolutionItem(folderGuid: string, filePath: string): Promise<void> {
        log.info(`Adding solution item "${filePath}" to folder "${folderGuid}"`);

        try {
            // Find the solution folder to get its GUID
            if (!folderGuid) {
                throw new Error(`Solution folder "${folderGuid}" not found`);
            }

            // Calculate relative path from solution directory
            const solutionDir = path.dirname(this.host.solutionPath());
            const relativePath = path.relative(solutionDir, filePath).replace(/\\/g, '/');

            if (this.host.isSlnx()) {
                const segments = this.getSolutionFolderSegments(folderGuid);
                await this.host.editSlnx(content => SolutionXFileEditor.addFile(content, segments, relativePath));
                log.info(`Successfully added solution item "${path.basename(filePath)}" to folder "${folderGuid}"`);
                return;
            }

            // Edit the .sln lines (read, write and re-parse happen together, one edit at a time)
            await this.host.editSlnLines(lines => {

                // Find the solution folder's Project block and add the file to it
                const updatedLines = SolutionFileEditor.addSolutionItemToFolder(lines, folderGuid, relativePath);

                return updatedLines;
            });

            log.info(`Successfully added solution item "${path.basename(filePath)}" to folder "${folderGuid}"`);


            // File watcher will handle the tree update

        } catch (error) {
            log.error(`Error adding solution item:`, error);
            throw error;
        }
    }

    /**
     * Removes a solution item (file) from a solution folder
     */
    async removeSolutionItem(filePath: string): Promise<void> {
        log.info(`Removing solution item from solution: ${filePath}`);

        try {
            // Calculate relative path from solution directory
            const solutionDir = path.dirname(this.host.solutionPath());
            const relativePath = path.relative(solutionDir, filePath).replace(/\\/g, '/');

            if (this.host.isSlnx()) {
                await this.host.editSlnx(content => SolutionXFileEditor.removeFile(content, relativePath));
                log.info(`Successfully removed solution item "${path.basename(filePath)}" from solution`);
                return;
            }

            // Edit the .sln lines (read, write and re-parse happen together, one edit at a time)
            await this.host.editSlnLines(lines => {

                // Remove the file reference from the solution file
                const updatedLines = SolutionFileEditor.removeSolutionItemFromFile(lines, relativePath);

                return updatedLines;
            });

            log.info(`Successfully removed solution item "${path.basename(filePath)}" from solution`);


            // File watcher will handle the tree update

        } catch (error) {
            log.error(`Error removing solution item:`, error);
            throw error;
        }
    }

    /**
     * Moves a project, solution folder or solution item into another solution folder (`undefined`: the solution root,
     * not for solution items), like Visual Studio's drag & drop. Refuses a folder into itself or a folder inside it and
     * a name the target already has; a node already there is left alone.
     */
    async moveToSolutionFolder(node: SolutionNodeMove, targetFolderGuid: string | undefined): Promise<void> {
        const solutionFile = this.host.solutionFile();
        if (!solutionFile) {
            throw new Error('The solution is not loaded');
        }
        const same = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toUpperCase() === b.toUpperCase();
        const parentOf = (guid: string) => solutionFile.nestedProjects.find(n => same(n.childGuid, guid))?.parentGuid;
        const folderOf = (guid: string) => solutionFile.projects.find(p => same(p.guid, guid) && SolutionFileParser.isSolutionFolder(p));
        const target = targetFolderGuid === undefined ? undefined : folderOf(targetFolderGuid);
        if (targetFolderGuid !== undefined && !target) {
            throw new Error(`Solution folder "${targetFolderGuid}" not found`);
        }
        const targetName = target ? `"${target.name}"` : 'The solution';
        const solutionDir = path.dirname(this.host.solutionPath());
        const relative = (file: string) => path.relative(solutionDir, file).split(path.sep).join('/');

        if (node.kind === 'solutionItem') {
            const from = folderOf(node.folderGuid);
            if (!target) {
                throw new Error('Solution items belong in a solution folder');
            }
            if (!from) {
                throw new Error(`Solution folder "${node.folderGuid}" not found`);
            }
            if (same(from.guid, target.guid)) {
                return;
            }
            const itemPath = relative(node.filePath);
            const key = (item: string) => item.replace(/\\/g, '/').toLowerCase();
            if (this.host.getSolutionItems(target).some(item => key(item) === key(itemPath))) {
                throw new Error(`${targetName} already contains ${path.basename(node.filePath)}`);
            }
            if (this.host.isSlnx()) {
                await this.host.editSlnx(content => SolutionXFileEditor.moveFile(
                    content, this.getSolutionFolderSegments(from.guid), itemPath, this.getSolutionFolderSegments(target.guid)));
            } else {
                await this.host.editSlnLines(lines => SolutionFileEditor.moveSolutionItemLines(lines, from.guid, target.guid, itemPath));
            }
            log.info(`Moved solution item ${itemPath} to ${targetName}`);
            return;
        }

        const moving = node.kind === 'project'
            ? solutionFile.projects.find(p => !SolutionFileParser.isSolutionFolder(p)
                && path.resolve(solutionDir, p.path) === path.resolve(node.projectPath))
            : folderOf(node.folderGuid);
        if (!moving) {
            throw new Error(`${node.kind === 'project' ? path.basename(node.projectPath) : 'The solution folder'} is not in the solution`);
        }
        const currentParent = parentOf(moving.guid);
        if (target ? same(currentParent, target.guid) : !currentParent) {
            return;
        }
        for (let guid = target?.guid, depth = 0; guid && depth < 64; guid = parentOf(guid), depth++) {
            if (same(guid, moving.guid)) {
                throw new Error(`"${moving.name}" cannot be moved into itself or a folder inside it`);
            }
        }
        const siblings = solutionFile.projects.filter(p => target ? same(parentOf(p.guid), target.guid) : !parentOf(p.guid));
        if (siblings.some(p => p.name.toLowerCase() === moving.name.toLowerCase())) {
            throw new Error(`${targetName} already contains "${moving.name}"`);
        }

        if (this.host.isSlnx()) {
            const targetSegments = target ? this.getSolutionFolderSegments(target.guid) : [];
            await this.host.editSlnx(content => node.kind === 'project'
                ? SolutionXFileEditor.moveProject(content, relative(node.projectPath), targetSegments)
                : SolutionXFileEditor.moveFolder(content, this.getSolutionFolderSegments(moving.guid), targetSegments));
        } else {
            await this.host.editSlnLines(lines => SolutionFileEditor.setNestedParent(lines, moving.guid, target?.guid));
        }
        log.info(`Moved "${moving.name}" to ${targetName}`);
    }

    /**
     * Finds all child items (projects and folders) recursively for a given parent folder GUID
     */
    private findAllChildItemsRecursively(parentGuid: string): string[] {
        if (!this.host.solutionFile()) return [];

        const childGuids: string[] = [];
        const hierarchy = SolutionFileParser.buildProjectHierarchy(this.host.solutionFile()!);

        // Get direct children
        const directChildren = hierarchy.get(parentGuid) || [];

        for (const child of directChildren) {
            childGuids.push(child.guid);

            // If this child is a solution folder, recursively find its children
            if (SolutionFileParser.isSolutionFolder(child)) {
                const grandchildren = this.findAllChildItemsRecursively(child.guid);
                childGuids.push(...grandchildren);
            }
        }

        return childGuids;
    }

    /**
     * Path of a solution folder as `dotnet sln add --solution-folder` expects it, e.g. `Libs/Inner`
     */
    getSolutionFolderPath(folderGuid: string): string | undefined {
        const solutionFile = this.host.solutionFile();
        if (!solutionFile) {
            return undefined;
        }
        const same = (a: string | undefined, b: string) => a?.toUpperCase() === b.toUpperCase();
        const names: string[] = [];
        const seen = new Set<string>();
        let guid: string | undefined = folderGuid;
        while (guid && !seen.has(guid.toUpperCase())) {
            seen.add(guid.toUpperCase());
            const current: string = guid;
            const folder = solutionFile.projects.find(p => same(p.guid, current));
            if (!folder) {
                return undefined;
            }
            names.unshift(folder.name);
            guid = solutionFile.nestedProjects.find(n => same(n.childGuid, current))?.parentGuid;
        }
        return names.join('/');
    }
}
