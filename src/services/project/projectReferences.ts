import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ProjectFileEditor } from '../../parsers/projectFileEditor';
import { pathKey } from './items/projectItems';

const execFileAsync = promisify(execFile);

const key = (file: string) => pathKey(path.normalize(file));

/** The projects a project file references (`<ProjectReference Include="..."/>`, outside comments and targets), as full paths */
export function projectReferencesIn(content: string, projectDir: string): string[] {
    const ignored = ProjectFileEditor.ignoredRanges(content);
    return [...content.matchAll(/<ProjectReference\b(?:[^>"']|"[^"]*"|'[^']*')*?\bInclude\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
        .filter(match => !ProjectFileEditor.inRanges(ignored, match.index!))
        .map(match => path.resolve(projectDir, ProjectFileEditor.unescape(match[1] ?? match[2]).replace(/[\\/]/g, path.sep)));
}

/** The references of a project file on disk; none when it cannot be read */
export function projectReferencesOf(projectPath: string): string[] {
    try {
        return projectReferencesIn(fs.readFileSync(projectPath, 'utf8'), path.dirname(projectPath));
    } catch {
        return [];
    }
}

/**
 * Why `project` must not reference `reference`, or undefined when it may: itself, a reference it has, or one that
 * would close a circle (the reference already depends on the project, directly or through others). Visual Studio
 * refuses the circle; `dotnet add reference` writes it (checked with SDK 10.0.111).
 */
export function referenceRefusal(project: string, reference: string, referencesOf: (projectPath: string) => readonly string[] = projectReferencesOf): string | undefined {
    const name = (file: string) => path.basename(file, path.extname(file));
    if (key(project) === key(reference)) {
        return `${name(project)} cannot reference itself.`;
    }
    if (referencesOf(project).some(existing => key(existing) === key(reference))) {
        return `${name(project)} already references ${name(reference)}.`;
    }
    const seen = new Set<string>();
    const pending = [reference];
    while (pending.length > 0) {
        const current = pending.pop()!;
        if (seen.has(key(current))) {
            continue;
        }
        seen.add(key(current));
        for (const next of referencesOf(current)) {
            if (key(next) === key(project)) {
                return `A reference from ${name(project)} to ${name(reference)} would cause a circular dependency.`;
            }
            pending.push(next);
        }
    }
    return undefined;
}

export type RunDotnet = (args: readonly string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;

const runDotnet: RunDotnet = (args, cwd) => execFileAsync('dotnet', [...args], { cwd, timeout: 120000 });

/**
 * `dotnet add <project> reference <references...>` (it checks the target frameworks); the references that are refused
 * (see referenceRefusal) are left out and returned with the reason
 */
export async function addProjectReferences(
    project: string, references: readonly string[], run: RunDotnet = runDotnet, referencesOf?: (projectPath: string) => readonly string[],
): Promise<{ added: string[]; refused: string[]; error?: string }> {
    const refused: string[] = [];
    const added: string[] = [];
    for (const reference of references) {
        const refusal = referenceRefusal(project, reference, referencesOf);
        if (refusal) {
            refused.push(refusal);
        } else if (!added.some(other => key(other) === key(reference))) {
            added.push(reference);
        }
    }
    if (added.length === 0) {
        return { added, refused };
    }
    try {
        await run(['add', project, 'reference', ...added], path.dirname(project));
        return { added, refused };
    } catch (error) {
        const output = error as { stdout?: string; stderr?: string; message?: string };
        return { added: [], refused, error: `${output.stdout ?? ''}${output.stderr ?? ''}`.trim() || output.message || String(error) };
    }
}
