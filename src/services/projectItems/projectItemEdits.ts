import * as fs from 'fs';
import * as path from 'path';
import { ProjectFileEditor } from '../../parsers/projectFileEditor';
import { BUILD_OUTPUT_FOLDERS } from './folderLayout';
import { ProjectItems } from './projectItems';

/** MSBuild item paths, relative to the project folder, with backslashes like the project templates */
const itemPath = (projectDir: string, target: string) => path.relative(projectDir, target).replace(/\//g, '\\');

const itemTypeForNewItem = (file: string) => path.extname(file).toLowerCase() === '.cs' ? 'Compile' : 'None';

/** Visual Studio's Exclude From Project for an SDK-style project: `Remove` items for the file, or for everything under the folder */
export function excludeEdit(content: string, projectDir: string, target: string, isFolder: boolean, items: ProjectItems): string {
    const relative = itemPath(projectDir, target);
    if (!isFolder) {
        return ProjectFileEditor.excludeItem(content, items.itemTypeOf(target) ?? 'None', relative);
    }
    const types = items.itemTypesUnder(target);
    return (types.length > 0 ? types : ['None']).reduce(
        (edited, type) => ProjectFileEditor.excludeItem(edited, type, `${relative}\\**`), content);
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
