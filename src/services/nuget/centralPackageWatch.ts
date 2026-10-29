import * as fs from 'fs';
import * as path from 'path';
import { pathKey } from '../project/items/projectItems';

/** `mtime|size` of a file; undefined when it does not exist */
export type Stamp = string | undefined;

export function stampOf(file: string): Stamp {
    try {
        const stat = fs.statSync(file);
        return `${stat.mtimeMs}|${stat.size}`;
    } catch {
        return undefined;
    }
}

/** The files whose stamp differs from the remembered one (a file seen for the first time is not a change); remembers the new stamps */
export function changedFiles(files: readonly string[], stamps: Map<string, Stamp>): string[] {
    const changed: string[] = [];
    for (const file of files) {
        const stamp = stampOf(file);
        if (stamps.has(file) && stamps.get(file) !== stamp) {
            changed.push(file);
        }
        stamps.set(file, stamp);
    }
    return changed;
}

/** What the extension's `**\/Directory.{Build.props,Build.targets,Packages.props}` watcher already covers */
const COVERED = /^Directory\.(Packages\.props|Build\.props|Build\.targets)$/i;

const isInside = (file: string, root: string) => {
    const relative = path.relative(root, file);
    return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/**
 * Splits the props files the central versions come from: `watch` needs a watcher of its own (an imported file with
 * another name inside the workspace), `outside` cannot be watched (outside every workspace folder) and is re-checked
 * when the NuGet editor gets focus
 */
export function watchPlan(files: readonly string[], workspaceRoots: readonly string[]): { watch: string[]; outside: string[] } {
    const unique = [...new Map(files.map(file => [pathKey(path.normalize(file)), path.normalize(file)])).values()];
    const inside = (file: string) => workspaceRoots.some(root => isInside(file, root));
    return {
        watch: unique.filter(file => inside(file) && !COVERED.test(path.basename(file))),
        outside: unique.filter(file => !inside(file)),
    };
}
