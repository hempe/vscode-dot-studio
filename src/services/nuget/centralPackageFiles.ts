import * as fs from 'fs';
import * as path from 'path';
import { ProjectFileEditor as Xml } from '../../parsers/projectFileEditor';
import { PackageEdit, applyEdit, globalPackageReferences } from './centralPackageEdits';
import { CentralEntry } from './centralPackages';
import { OwnWrites } from '../ownWrites';

/**
 * Writes planned edits: each file is read once, gets its edits in order, and is written only when it changed.
 * All files are edited in memory first, so an edit that fails (an entry not found) leaves every file untouched; a
 * file that cannot be written gives the files written before it their old content back (a props file edited
 * without its project files, or the other way round, breaks the restore). Returns the files that changed.
 */
export async function applyPackageEdits(edits: readonly PackageEdit[]): Promise<string[]> {
    const byFile = new Map<string, PackageEdit[]>();
    for (const edit of edits) {
        const file = path.normalize(edit.file);
        byFile.set(file, [...(byFile.get(file) ?? []), edit]);
    }
    const results: { file: string; content: string; edited: string }[] = [];
    for (const [file, fileEdits] of byFile) {
        const content = await fs.promises.readFile(file, 'utf8');
        results.push({ file, content, edited: fileEdits.reduce(applyEdit, content) });
    }
    const changed = results.filter(result => result.edited !== result.content);
    const written: typeof changed = [];
    try {
        for (const result of changed) {
            await fs.promises.writeFile(result.file, result.edited, 'utf8');
            // The caller evaluates the projects after its restore: the watchers leave this version alone
            OwnWrites.record(result.file);
            written.push(result);
        }
    } catch (error) {
        for (const result of written) {
            await fs.promises.writeFile(result.file, result.content, 'utf8').catch(() => undefined);
        }
        throw error;
    }
    return changed.map(result => result.file);
}

/**
 * The path an `<Import Project="..."/>` of `file` names; undefined when it depends on properties other than
 * `$(MSBuildThisFileDirectory)` (or uses wildcards). `$([MSBuild]::GetPathOfFileAbove('name', 'start'))` is looked up.
 */
function importedPath(file: string, project: string): string | undefined {
    const dir = path.dirname(file);
    const thisDir = (value: string) => value.replace(/\$\(MSBuildThisFileDirectory\)/gi, dir + path.sep);
    const above = /^\$\(\[MSBuild\]::GetPathOfFileAbove\(([\s\S]*)\)\)$/i.exec(project.trim());
    if (above) {
        // Quoted or not (the documentation shows both): the file name, then where to start looking
        const comma = above[1].indexOf(',');
        const unquote = (value: string) => value.trim().replace(/^'([\s\S]*)'$/, '$1');
        const name = unquote(comma === -1 ? above[1] : above[1].slice(0, comma));
        let current = path.resolve(dir, thisDir(comma === -1 ? dir : unquote(above[1].slice(comma + 1))));
        if (!name || /[$*?]/.test(name) || current.includes('$(')) {
            return undefined;
        }
        for (; ;) {
            const candidate = path.join(current, name);
            if (fs.existsSync(candidate)) {
                return candidate;
            }
            const parent = path.dirname(current);
            if (parent === current) {
                return undefined;
            }
            current = parent;
        }
    }
    const resolved = thisDir(project.trim());
    return !resolved || /[$@*?]/.test(resolved) ? undefined : path.resolve(dir, resolved);
}

/**
 * `propsPath` and every file it imports, also through the files it imports (in document order), so a file that only
 * defines properties (versions as `$(SerilogVersion)`) is known too. Imports in comments are left out; a missing file
 * is listed (it may be created).
 */
export function importChain(propsPath: string): string[] {
    const chain: string[] = [];
    const visit = (file: string) => {
        const normalized = path.normalize(file);
        if (chain.includes(normalized)) {
            return;
        }
        chain.push(normalized);
        let content: string;
        try {
            content = fs.readFileSync(normalized, 'utf8');
        } catch {
            return;
        }
        const ignored = Xml.ignoredRanges(content);
        for (const match of content.matchAll(/<Import\b(?:[^>"']|"[^"]*"|'[^']*')*?\bProject\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
            const imported = !Xml.inRanges(ignored, match.index!) && importedPath(normalized, Xml.unescape(match[1] ?? match[2]));
            if (imported) {
                visit(imported);
            }
        }
    };
    visit(propsPath);
    return chain;
}

/** The `GlobalPackageReference` entries written in the files (also those every project opted out of); unreadable files skipped */
export function declaredGlobals(files: readonly string[]): CentralEntry[] {
    return files.flatMap(file => {
        try {
            return globalPackageReferences(fs.readFileSync(file, 'utf8')).map(entry => ({ ...entry, file }));
        } catch {
            return [];
        }
    });
}
