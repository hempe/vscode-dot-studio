import * as fs from 'fs';
import * as path from 'path';
import { ProjectFileEditor } from '../../parsers/projectFileEditor';
import { BUILD_OUTPUT_FOLDERS } from './folderLayout';
import { ProjectItems } from './projectItems';

/** Whether `relative` (from path.relative) points below the folder it is relative to */
const isBelow = (relative: string) =>
    relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);

/**
 * MSBuild item paths, relative to the project folder, with backslashes like the project templates.
 * Throws for the project folder itself and anything outside it: `Remove="\**"` would match the whole drive.
 */
function itemPath(projectDir: string, target: string): string {
    const relative = path.relative(projectDir, target);
    if (!isBelow(relative)) {
        throw new Error(`${target} is not inside the project folder ${projectDir}`);
    }
    return relative.replace(/\//g, '\\');
}

/**
 * Why Exclude/Include must not touch the node, or undefined when it may: a folder that is (or holds) a
 * project of the solution belongs to that project, editing the outer project file would not remove it.
 */
export function membershipRefusal(target: string, isFolder: boolean, solutionProjects: readonly string[]): string | undefined {
    if (isFolder && holdsProject(target, solutionProjects)) {
        return 'This folder is a project of its own; use Remove or Delete on the project.';
    }
    return undefined;
}

/** Whether the folder is the folder of one of the projects, or one of them lies below it */
export function holdsProject(folder: string, projects: readonly string[]): boolean {
    return projects.some(project => {
        const relative = path.relative(folder, path.dirname(project));
        return relative === '' || isBelow(relative);
    });
}

const itemTypeForNewItem = (file: string) => path.extname(file).toLowerCase() === '.cs' ? 'Compile' : 'None';

/** Visual Studio's Exclude From Project for an SDK-style project: `Remove` items for the file, or for everything under the folder, per item type */
export function excludeEdit(content: string, projectDir: string, target: string, isFolder: boolean, items: ProjectItems): string {
    const relative = itemPath(projectDir, target);
    // every item type that lists the file: one left behind keeps it in the project
    const types = isFolder ? items.itemTypesUnder(target) : items.itemTypesOf(target);
    const value = isFolder ? `${relative}\\**` : relative;
    return (types.length > 0 ? types : ['None']).reduce(
        (edited, type) => ProjectFileEditor.excludeItem(edited, type, value), content);
}

/**
 * Include In Project: deletes the `Remove` item that excluded the file or folder; when there is none (the
 * defaults leave it out, `DefaultItemExcludes`) adds `Include` items, one per file for a folder.
 * @param filesUnder the files on disk under the folder (only used for a folder)
 */
export function includeEdit(content: string, projectDir: string, target: string, isFolder: boolean, filesUnder: readonly string[]): string {
    const relative = itemPath(projectDir, target);
    const removed = ProjectFileEditor.removeRemoveItem(content, isFolder ? `${relative}\\**` : relative);
    if (removed.removed) {
        return removed.content;
    }
    const files = isFolder ? filesUnder : [target];
    return files.reduce((edited, file) =>
        ProjectFileEditor.includeItem(edited, itemTypeForNewItem(file), itemPath(projectDir, file)), content);
}

/** Every file under a folder, skipping bin and obj */
export async function listFilesUnder(folder: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await fs.promises.readdir(folder, { withFileTypes: true })) {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) {
            if (!BUILD_OUTPUT_FOLDERS.includes(entry.name)) {
                files.push(...await listFilesUnder(full));
            }
        } else {
            files.push(full);
        }
    }
    return files;
}
