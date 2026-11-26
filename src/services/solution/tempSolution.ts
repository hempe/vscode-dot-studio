import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { shouldSkipDirectory } from '../../core/constants';

/**
 * Visual Studio's temporary solution for a project or a folder without a solution: a real .slnx in the extension's storage
 * (`<root>/<hash of the key>/<Name>.slnx`), outside the user's folders, until it is saved next to the projects.
 */
export const PROJECT_FILE = /\.(csproj|vbproj|fsproj)$/i;

/** Where the temporary solution of a project file or folder (`key`) lives */
export function tempSolutionPath(root: string, key: string, name: string): string {
    const hash = crypto.createHash('sha1').update(path.normalize(key)).digest('hex').slice(0, 16);
    return path.join(root, hash, `${name}.slnx`);
}

/** The .slnx text: the projects relative to the solution's folder (as the rest of the extension compares them) */
export function tempSolutionXml(solutionDir: string, projects: readonly string[]): string {
    const lines = projects.map(project => `  <Project Path="${path.relative(solutionDir, project).split(path.sep).join('/')}" />`);
    return `<Solution>\n${lines.join('\n')}\n</Solution>\n`;
}

/** Whether the solution file is a temporary one (below `root`) */
export function isTemporarySolution(root: string | undefined, solutionPath: string): boolean {
    if (!root) {
        return false;
    }
    const relative = path.relative(root, solutionPath);
    return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** The project files of a folder and up to three levels below it (the depth of the solution search), sorted */
export async function findProjectFiles(root: string, maxDepth = 3): Promise<string[]> {
    const found: string[] = [];
    let level = [root];
    for (let depth = 0; depth <= maxDepth && level.length > 0; depth++) {
        const next: string[] = [];
        for (const dir of level) {
            let entries: fs.Dirent[];
            try {
                entries = await fs.promises.readdir(dir, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const entry of entries) {
                if (entry.isFile() && PROJECT_FILE.test(entry.name)) {
                    found.push(path.join(dir, entry.name));
                } else if (entry.isDirectory() && !entry.name.startsWith('.') && !shouldSkipDirectory(entry.name)) {
                    next.push(path.join(dir, entry.name));
                }
            }
        }
        level = next;
    }
    return found.sort((a, b) => a.localeCompare(b));
}

/** The folders below `root` not touched for `maxAgeDays` days (temporary solutions nobody opened since) */
export function staleTempFolders(root: string, now: number, maxAgeDays = 30): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries.filter(entry => entry.isDirectory())
        .map(entry => path.join(root, entry.name))
        .filter(dir => now - fs.statSync(dir).mtimeMs > maxAgeDays * 86400000);
}
