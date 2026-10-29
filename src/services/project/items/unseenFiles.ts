import * as fs from 'fs';
import * as path from 'path';
import { BUILD_OUTPUT_FOLDERS, DiskEntry } from './folderLayout';
import { ProjectItems, pathKey } from './projectItems';

/**
 * File systems keep coarse timestamps (FAT: 2 s), and a file written while MSBuild was starting may be missing
 * from its list: what changed this long before an evaluation counts as possibly newer than it
 */
export const TIMESTAMP_MARGIN_MS = 2000;

const PROJECT_FILE = /\.(cs|vb|fs)proj$/i;

/**
 * The disk entries of a folder the item list does not include: excluded files, and non-empty folders without
 * included files. Build output and project files are never items (they change all the time), so they are left out.
 */
export function unlistedEntries(folderPath: string, disk: readonly DiskEntry[], items: ProjectItems, nonEmptyFolders: ReadonlySet<string>): string[] {
    const unlisted: string[] = [];
    for (const entry of disk) {
        const entryPath = path.join(folderPath, entry.name);
        if (entry.isDirectory) {
            const isBuildOutput = BUILD_OUTPUT_FOLDERS.some(name => pathKey(name) === pathKey(entry.name));
            if (!isBuildOutput && nonEmptyFolders.has(entryPath) && !items.hasIncludedUnder(entryPath)) {
                unlisted.push(entryPath);
            }
        } else if (!PROJECT_FILE.test(entry.name) && !items.isIncluded(entryPath)) {
            unlisted.push(entryPath);
        }
    }
    return unlisted;
}

/**
 * The entries created or modified after `evaluatedAt` (less the margin for coarse timestamps): an item list
 * evaluated before may lack them because MSBuild did not see them, not because the project excludes them
 */
export async function changedSince(paths: readonly string[], evaluatedAt: number): Promise<{ path: string; changedAt: number }[]> {
    const stats = await Promise.all(paths.map(entryPath => fs.promises.stat(entryPath).catch(() => undefined)));
    const changed: { path: string; changedAt: number }[] = [];
    stats.forEach((stat, i) => {
        // birthtime: a copy or an extracted archive keeps its old mtime (0 where the file system does not know it)
        const changedAt = stat ? Math.max(stat.mtimeMs, stat.birthtimeMs) : undefined;
        if (changedAt !== undefined && changedAt >= evaluatedAt - TIMESTAMP_MARGIN_MS) {
            changed.push({ path: paths[i], changedAt });
        }
    });
    return changed;
}
