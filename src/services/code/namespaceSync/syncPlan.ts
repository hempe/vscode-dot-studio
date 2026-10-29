import { shouldSkipDirectory } from '../../core/constants';

const GENERATED = /\.(g|g\.i|designer|assemblyinfo)\.cs$/i;

/** The folders that are never synced: the usual skipped ones (bin, obj, ...) and hidden ones */
function isSkippedFolder(name: string): boolean {
    return shouldSkipDirectory(name) || name.startsWith('.');
}

/** The C# files of a list of paths that Sync Namespaces considers: no build output, hidden folders or generated code; sorted by path. Only the folders below `root` count (the root may itself live under a hidden folder) */
export function candidateFiles(paths: string[], root?: string): string[] {
    return paths
        .filter(file => {
            if (!file.toLowerCase().endsWith('.cs') || GENERATED.test(file)) {
                return false;
            }
            const below = root && file.startsWith(root) ? file.slice(root.length) : file;
            const parts = below.split(/[\\/]/);
            return !parts.slice(0, -1).some(isSkippedFolder);
        })
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
