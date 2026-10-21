import * as path from 'path';
import { ProjectItems, pathKey } from './projectItems';

export interface DiskEntry {
    readonly name: string;
    readonly isDirectory: boolean;
}

/** `included` is in the project, `excluded` is on disk only, `linked` is in the project but lives elsewhere */
export type ItemState = 'included' | 'excluded' | 'linked';

export interface LaidOutEntry {
    readonly name: string;
    readonly path: string;
    readonly isDirectory: boolean;
    /** Undefined while MSBuild has not told what the project contains */
    readonly state: ItemState | undefined;
}

/** The folders Show All Files reveals on top of the excluded files; other skipped folders (.git, node_modules...) stay hidden */
export const BUILD_OUTPUT_FOLDERS = ['bin', 'obj'];

/**
 * The entries of a folder: what is on disk, judged by what the project contains, plus linked files.
 * A linked entry whose name is already shown from disk is dropped: the disk entry wins.
 * @param nonEmptyFolders disk folders that hold something; an empty folder is shown as included (it carries no exclusion)
 */
export function layoutFolder(
    folderPath: string,
    disk: readonly DiskEntry[],
    items: ProjectItems | undefined,
    showAll: boolean,
    nonEmptyFolders: ReadonlySet<string>,
): LaidOutEntry[] {
    const entries: LaidOutEntry[] = [];
    for (const entry of disk) {
        const entryPath = path.join(folderPath, entry.name);
        const hidden = entry.isDirectory && BUILD_OUTPUT_FOLDERS.includes(entry.name) && !showAll;
        if (hidden) {
            continue;
        }
        if (!items) {
            entries.push({ name: entry.name, path: entryPath, isDirectory: entry.isDirectory, state: undefined });
            continue;
        }
        // build output is never part of the project, empty or not
        const included = entry.isDirectory
            ? items.hasIncludedUnder(entryPath) || (!nonEmptyFolders.has(entryPath) && !BUILD_OUTPUT_FOLDERS.includes(entry.name))
            : items.isIncluded(entryPath);
        if (included || showAll) {
            entries.push({ name: entry.name, path: entryPath, isDirectory: entry.isDirectory, state: included ? 'included' : 'excluded' });
        }
    }

    if (items) {
        const shown = new Set(entries.map(entry => pathKey(entry.name)));
        for (const name of items.linkedFoldersIn(folderPath)) {
            if (!shown.has(pathKey(name))) {
                shown.add(pathKey(name));
                entries.push({ name, path: path.join(folderPath, name), isDirectory: true, state: 'linked' });
            }
        }
        for (const linked of items.linkedFilesIn(folderPath)) {
            const name = path.basename(linked.virtualPath);
            if (!shown.has(pathKey(name))) {
                shown.add(pathKey(name));
                entries.push({ name, path: linked.fullPath, isDirectory: false, state: 'linked' });
            }
        }
    }
    return entries;
}
