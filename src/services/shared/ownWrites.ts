import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pathKey } from '../project/items/projectItems';
import { Stamp, stampOf } from '../nuget/centralPackageWatch';

/** Each file the extension wrote, with its stamp right after the write */
const written = new Map<string, { stamp: Stamp; hash: string | undefined }>();

/** The content's hash: an edit of the same size inside the timestamp's resolution still differs */
const hashOf = (file: string): string | undefined => {
    try {
        return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
    } catch {
        return undefined;
    }
};
const keyOf = (file: string) => pathKey(path.normalize(file));

/**
 * Files the extension wrote itself. The code that writes them evaluates the projects once it is done (the NuGet
 * manager after its restore), so a file watcher that sees that same version must not start another evaluation;
 * a later edit (another `mtime|size` or other content) is not ours any more.
 */
export const OwnWrites = {
    /** Call right after writing the file */
    record(file: string): void {
        written.set(keyOf(file), { stamp: stampOf(file), hash: hashOf(file) });
    },
    /** Whether the file is still as the extension wrote it */
    isOwn(file: string): boolean {
        const recorded = written.get(keyOf(file));
        return recorded !== undefined && recorded.stamp === stampOf(file) && recorded.hash === hashOf(file);
    },
};
