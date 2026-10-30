import * as path from 'path';
import type { CollectedDiagnostics, ListedSeverity } from './diagnosticsService';
import { normalizePath } from './diagnosticsRollup';
import type { ErrorListRow, ErrorListSummary } from '../../types/errorList';

/** Project column for files that belong to no project, as in Visual Studio */
export const MISCELLANEOUS_FILES = 'Miscellaneous Files';

const SEVERITY_ORDER: Record<ListedSeverity, number> = { error: 0, warning: 1, info: 2 };

/**
 * One row per diagnostic, like Visual Studio's Error List: the project is the innermost project directory
 * the file is in, the file is shown relative to it. Sorted by severity, project, file and position.
 */
export function buildErrorRows(
    files: CollectedDiagnostics,
    projects: readonly { readonly name: string; readonly path: string }[]
): ErrorListRow[] {
    const directories = projects
        .map(project => ({ name: project.name, dir: path.dirname(project.path), prefix: normalizePath(path.dirname(project.path) + path.sep) }))
        .sort((a, b) => b.prefix.length - a.prefix.length);

    const rows: ErrorListRow[] = [];
    for (const [file, { uri, diagnostics }] of files) {
        const project = directories.find(d => file.startsWith(d.prefix));
        const shownFile = project ? path.relative(project.dir, uri.fsPath) : path.basename(uri.fsPath);
        for (const diagnostic of diagnostics) {
            const line = diagnostic.range.start.line + 1;
            const column = diagnostic.range.start.character + 1;
            rows.push({
                id: `${file}|${diagnostic.severity}|${line}|${column}|${diagnostic.code ?? ''}|${diagnostic.message}`,
                severity: diagnostic.severity,
                ...(diagnostic.code ? { code: diagnostic.code } : {}),
                ...(diagnostic.codeUrl ? { codeUrl: diagnostic.codeUrl } : {}),
                message: diagnostic.message,
                project: project?.name ?? MISCELLANEOUS_FILES,
                file: shownFile,
                filePath: uri.fsPath,
                line,
                column,
            });
        }
    }
    return rows.sort((a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
        || (a.project === MISCELLANEOUS_FILES ? 1 : 0) - (b.project === MISCELLANEOUS_FILES ? 1 : 0)
        || a.project.localeCompare(b.project)
        || a.file.localeCompare(b.file)
        || a.line - b.line
        || a.column - b.column);
}

/** Total errors, warnings and messages, whatever the filter */
export function summarizeErrorList(files: CollectedDiagnostics): ErrorListSummary {
    let errors = 0, warnings = 0, infos = 0;
    for (const { diagnostics } of files.values()) {
        for (const { severity } of diagnostics) {
            if (severity === 'error') errors++;
            else if (severity === 'warning') warnings++;
            else infos++;
        }
    }
    return { errors, warnings, infos };
}
