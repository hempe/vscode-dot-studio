import * as path from 'path';
import { pathKey } from './projectItems/projectItems';
import { Stamp, stampOf } from './nuget/centralPackageWatch';

/** Each file the extension wrote, with its stamp right after the write */
const written = new Map<string, Stamp>();
const keyOf = (file: string) => pathKey(path.normalize(file));

/**
 * Files the extension wrote itself. The code that writes them evaluates the projects once it is done (the NuGet
 * manager after its restore), so a file watcher that sees that same version must not start another evaluation;
 * a later edit (another `mtime|size`) is not ours any more.
 */
export const OwnWrites = {
    /** Call right after writing the file */
    record(file: string): void {
        written.set(keyOf(file), stampOf(file));
    },
    /** Whether the file is still as the extension wrote it */
    isOwn(file: string): boolean {
        const recorded = written.get(keyOf(file));
        return recorded !== undefined && recorded === stampOf(file);
    },
};
