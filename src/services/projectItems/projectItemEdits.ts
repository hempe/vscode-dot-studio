import * as fs from 'fs';
import * as path from 'path';
import { ProjectFileEditor } from '../../parsers/projectFileEditor';
import { BUILD_OUTPUT_FOLDERS } from './folderLayout';
import { ProjectItems } from './projectItems';
import { NewItem, newItemFor } from './defaultItems';

/** Whether `relative` (from path.relative) points below the folder it is relative to */
const isBelow = (relative: string) =>
    relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);

/**
 * MSBuild item paths, relative to the project folder, with backslashes like the project templates, escaped.
 * Throws for the project folder itself and anything outside it: `Remove="\**"` would match the whole drive.
 */
function itemPath(projectDir: string, target: string): string {
    const relative = path.relative(projectDir, target);
    if (!isBelow(relative)) {
        throw new Error(`${target} is not inside the project folder ${projectDir}`);
    }
    return escapeMsbuild(relative.replace(/\//g, '\\'));
}

/**
 * MSBuild's escaping (`%XX`) of the characters it would read as separators, properties, item lists,
 * metadata or wildcards, so the item matches the file literally: `a;b.txt` -> `a%3Bb.txt`.
 */
export function escapeMsbuild(value: string): string {
    return value.replace(/[%;$@'()*?]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
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

/**
 * Whether the file or folder lies in the folder of another of the projects that is below the project's folder: a
 * nested project's file shown in the outer project's tree (the SDK globs include it). Its path alone names the
 * nested project, so its node id also names the project whose tree shows it.
 */
export function inNestedProject(target: string, projectPath: string, projects: readonly string[]): boolean {
    const projectDir = path.dirname(projectPath);
    return projects.some(other => {
        const otherDir = path.dirname(other);
        const toTarget = path.relative(otherDir, target);
        return other !== projectPath && isBelow(path.relative(projectDir, otherDir)) && (toTarget === '' || isBelow(toTarget));
    });
}

/** Whether the project, as evaluated after the edit, has the file or folder out (exclude) or in (include) */
export function membershipApplied(items: ProjectItems, target: string, isFolder: boolean, exclude: boolean): boolean {
    const included = isFolder ? items.itemTypesUnder(target).length > 0 : items.isIncluded(target);
    return included !== exclude;
}

/** Visual Studio's Exclude From Project for an SDK-style project: `Remove` items for the file, or for everything under the folder, per item type */
export function excludeEdit(content: string, projectDir: string, target: string, isFolder: boolean, items: ProjectItems): string {
    const value = removeValue(projectDir, target, isFolder);
    // every item type that lists the file: one left behind keeps it in the project
    const types = isFolder ? items.itemTypesUnder(target) : items.itemTypesOf(target);
    return (types.length > 0 ? types : ['None']).reduce(
        (edited, type) => ProjectFileEditor.excludeItem(edited, type, value), content);
}

/**
 * Include In Project: deletes the `Remove` item that excluded the file or folder; when there is none (the
 * defaults leave it out, `DefaultItemExcludes`) adds `Include` items, one per file for a folder, of the type (and
 * with the output metadata) MSBuild would give the file without the exclude, like Visual Studio.
 * @param filesUnder the files on disk under the folder (only used for a folder)
 * @param newItems itemsWithoutExcludes of the project; without it (or for a file it lacks) the type goes by the extension
 */
export function includeEdit(
    content: string, projectDir: string, target: string, isFolder: boolean, filesUnder: readonly string[],
    newItems?: ReadonlyMap<string, NewItem>,
): string {
    const removed = ProjectFileEditor.removeRemoveItem(content, removeValue(projectDir, target, isFolder));
    if (removed.removed) {
        return removed.content;
    }
    const files = isFolder ? filesUnder : [target];
    return files.reduce((edited, file) => {
        const item = newItemFor(file, newItems);
        return ProjectFileEditor.includeItem(edited, item.itemType, itemPath(projectDir, file), item.metadata);
    }, content);
}

/** Include In Project asks first when it would add more `Include` items than this */
export const INCLUDE_CONFIRM_LIMIT = 200;

/** How many `Include` items includeEdit would add: none when it deletes a `Remove` item instead */
export function includeItemCount(content: string, projectDir: string, target: string, isFolder: boolean, filesUnder: readonly string[]): number {
    if (ProjectFileEditor.removeRemoveItem(content, removeValue(projectDir, target, isFolder)).removed) {
        return 0;
    }
    return isFolder ? filesUnder.length : 1;
}

/** The `Remove` value Exclude writes for the file or folder */
function removeValue(projectDir: string, target: string, isFolder: boolean): string {
    const relative = itemPath(projectDir, target);
    return isFolder ? `${relative}\\**` : relative;
}

/** Folders Include In Project never adds files from: build output, tool folders (.git, .vs...) and packages */
const skipFolder = (name: string) => BUILD_OUTPUT_FOLDERS.includes(name) || name.startsWith('.') || name === 'node_modules';
/** Per-user files Visual Studio keeps next to the project */
const skipFile = (name: string) => /\.(user|suo)$/i.test(name);

/** Every file under a folder that Include In Project would add */
export async function listFilesUnder(folder: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await fs.promises.readdir(folder, { withFileTypes: true })) {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) {
            if (!skipFolder(entry.name)) {
                files.push(...await listFilesUnder(full));
            }
        } else if (!skipFile(entry.name)) {
            files.push(full);
        }
    }
    return files;
}
