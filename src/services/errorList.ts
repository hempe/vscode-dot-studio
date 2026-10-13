import * as path from 'path';
import type { CollectedDiagnostics, FileDiagnostics, ListedDiagnostic } from './diagnosticsService';
import { normalizePath } from './diagnosticsRollup';

/** Group for files that belong to no project, as in Visual Studio */
export const MISCELLANEOUS_FILES = 'Miscellaneous Files';

export interface ErrorListFilter {
    readonly errors: boolean;
    readonly warnings: boolean;
    readonly messages: boolean;
}

export interface ErrorListSummary {
    readonly errors: number;
    readonly warnings: number;
    readonly messages: number;
}

export interface ErrorListProject {
    readonly name: string;
    readonly files: readonly FileDiagnostics[];
}

/** Groups the diagnostics that pass the filter by project (innermost project directory) and file */
export function buildErrorList(
    files: CollectedDiagnostics,
    projects: readonly { readonly name: string; readonly path: string }[],
    filter: ErrorListFilter
): ErrorListProject[] {
    const directories = projects
        .map(project => ({ name: project.name, prefix: normalizePath(path.dirname(project.path) + path.sep) }))
        .sort((a, b) => b.prefix.length - a.prefix.length);

    const groups = new Map<string, FileDiagnostics[]>();
    for (const [file, { uri, diagnostics }] of files) {
        const shown = diagnostics.filter(d => isShown(d, filter)).sort(byPosition);
        if (shown.length === 0) {
            continue;
        }
        const name = directories.find(d => file.startsWith(d.prefix))?.name ?? MISCELLANEOUS_FILES;
        groups.set(name, [...(groups.get(name) ?? []), { uri, diagnostics: shown }]);
    }

    return [...groups]
        .map(([name, groupFiles]) => ({ name, files: groupFiles.sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath)) }))
        .sort((a, b) => (a.name === MISCELLANEOUS_FILES ? 1 : 0) - (b.name === MISCELLANEOUS_FILES ? 1 : 0) || a.name.localeCompare(b.name));
}

/** Total errors, warnings and messages, ignoring the filter */
export function summarizeErrorList(files: CollectedDiagnostics): ErrorListSummary {
    let errors = 0, warnings = 0, messages = 0;
    for (const { diagnostics } of files.values()) {
        for (const { severity } of diagnostics) {
            if (severity === 'error') errors++;
            else if (severity === 'warning') warnings++;
            else messages++;
        }
    }
    return { errors, warnings, messages };
}

function isShown({ severity }: ListedDiagnostic, filter: ErrorListFilter): boolean {
    return severity === 'error' ? filter.errors : severity === 'warning' ? filter.warnings : filter.messages;
}

function byPosition(a: ListedDiagnostic, b: ListedDiagnostic): number {
    return a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character;
}
