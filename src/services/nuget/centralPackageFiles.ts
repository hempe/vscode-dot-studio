import * as fs from 'fs';
import * as path from 'path';
import { PackageEdit, applyEdit } from './centralPackageEdits';

/**
 * Writes planned edits: each file is read once, gets its edits in order, and is written only when it changed.
 * All files are edited in memory first, so an edit that fails (an entry not found) leaves every file untouched.
 * Returns the files that changed.
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
    for (const result of changed) {
        await fs.promises.writeFile(result.file, result.edited, 'utf8');
    }
    return changed.map(result => result.file);
}
