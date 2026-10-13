import * as vscode from 'vscode';
import { DiagnosticCounts } from '../types';
import { FileCounts, normalizePath } from './diagnosticsRollup';
import { SimpleDebounceManager } from './debounceManager';
import { affectsSeverityFilter, readSeverityFilter, SeverityFilter } from './diagnosticsFilter';


/** `$msCompile` appends the project to the message: `... [/repo/Api/Api.csproj]` */
const PROJECT_SUFFIX = /\s+\[[^\]]+\]$/;

/** Severity as listed in the Error List and the tree: infos include Roslyn's suggestions */
export type ListedSeverity = 'error' | 'warning' | 'info';

export interface ListedDiagnostic {
    readonly severity: ListedSeverity;
    readonly message: string;
    readonly code?: string;
    /** Documentation of the code: the analyzer's own link, or the docs page by prefix (CS, IDE, CA, NETSDK) */
    readonly codeUrl?: string;
    readonly range: vscode.Range;
}

const DOCS: [RegExp, (code: string) => string][] = [
    [/^CS\d+$/i, code => `https://learn.microsoft.com/dotnet/csharp/language-reference/compiler-messages/${code.toLowerCase()}`],
    [/^IDE\d+$/i, code => `https://learn.microsoft.com/dotnet/fundamentals/code-analysis/style-rules/${code.toLowerCase()}`],
    [/^CA\d+$/i, code => `https://learn.microsoft.com/dotnet/fundamentals/code-analysis/quality-rules/${code.toLowerCase()}`],
    [/^NETSDK\d+$/i, code => `https://learn.microsoft.com/dotnet/core/tools/sdk-errors/${code.toLowerCase()}`],
];

/** The docs page for a diagnostic code, where its prefix has one */
export function documentationUrl(code: string | undefined): string | undefined {
    const docs = code ? DOCS.find(([pattern]) => pattern.test(code)) : undefined;
    return docs && code ? docs[1](code) : undefined;
}

export interface FileDiagnostics {
    readonly uri: vscode.Uri;
    readonly diagnostics: readonly ListedDiagnostic[];
}

/** Deduplicated diagnostics per file, keyed by `normalizePath(uri.fsPath)` */
export type CollectedDiagnostics = ReadonlyMap<string, FileDiagnostics>;

function listedSeverity(diagnostic: vscode.Diagnostic): ListedSeverity | undefined {
    switch (diagnostic.severity) {
        case vscode.DiagnosticSeverity.Error: return 'error';
        case vscode.DiagnosticSeverity.Warning: return 'warning';
        case vscode.DiagnosticSeverity.Information: return 'info';
        // Roslyn reports suggestions (VS "Messages", the editor's ··· dots) as hints;
        // hints tagged Unnecessary only fade out unused code and are not listed in VS
        case vscode.DiagnosticSeverity.Hint:
            return diagnostic.tags?.includes(vscode.DiagnosticTag.Unnecessary) ? undefined : 'info';
    }
}

/**
 * Collects errors, warnings and messages per file. Duplicates — the same diagnostic from build
 * output and the language server, or from several target frameworks — are listed once.
 */
export function collectDiagnostics(
    entries: ReadonlyArray<readonly [vscode.Uri, readonly vscode.Diagnostic[]]>
): Map<string, FileDiagnostics> {
    const result = new Map<string, { uri: vscode.Uri; diagnostics: ListedDiagnostic[]; seen: Set<string> }>();
    for (const [uri, diagnostics] of entries) {
        if (uri.scheme !== 'file') {
            continue;
        }

        const file = normalizePath(uri.fsPath);
        for (const diagnostic of diagnostics) {
            const severity = listedSeverity(diagnostic);
            if (!severity) {
                continue;
            }

            const rawCode = typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code;
            const code = rawCode === undefined ? undefined : String(rawCode);
            const codeUrl = (typeof diagnostic.code === 'object' ? diagnostic.code.target?.toString() : undefined) ?? documentationUrl(code);
            const message = diagnostic.message.replace(PROJECT_SUFFIX, '');
            const key = [severity, diagnostic.range.start.line, code ?? '', message].join('|');

            let entry = result.get(file);
            if (!entry) {
                entry = { uri, diagnostics: [], seen: new Set() };
                result.set(file, entry);
            }
            if (!entry.seen.has(key)) {
                entry.seen.add(key);
                entry.diagnostics.push({ severity, message, code, ...(codeUrl ? { codeUrl } : {}), range: diagnostic.range });
            }
        }
    }
    return new Map([...result].map(([file, { uri, diagnostics }]) => [file, { uri, diagnostics }]));
}

/** Counts collected diagnostics per file, for the severities the filter shows */
export function countFiles(files: CollectedDiagnostics, filter: SeverityFilter): Map<string, DiagnosticCounts> {
    const result = new Map<string, DiagnosticCounts>();
    for (const [file, { diagnostics }] of files) {
        const errors = filter.errors ? diagnostics.filter(d => d.severity === 'error').length : 0;
        const warnings = filter.warnings ? diagnostics.filter(d => d.severity === 'warning').length : 0;
        const infos = filter.infos ? diagnostics.filter(d => d.severity === 'info').length : 0;
        if (errors || warnings || infos) {
            result.set(file, { errors, warnings, infos });
        }
    }
    return result;
}

/** Counts errors, warnings and infos and suggestions per file, without duplicates, for the severities the filter shows */
export function countDiagnostics(
    entries: ReadonlyArray<readonly [vscode.Uri, readonly vscode.Diagnostic[]]>,
    filter: SeverityFilter
): Map<string, DiagnosticCounts> {
    return countFiles(collectDiagnostics(entries), filter);
}

/** Keeps per-file diagnostics and counts up to date and fires `onDidChange` after each recompute */
export class DiagnosticsService implements vscode.Disposable {
    private _files: CollectedDiagnostics = new Map();
    private _counts: Map<string, DiagnosticCounts> = new Map();
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    private readonly _debouncer = new SimpleDebounceManager(() => this.recompute(), 300);
    private readonly _disposables: vscode.Disposable[] = [];

    readonly onDidChange = this._onDidChange.event;

    constructor() {
        this._disposables.push(
            this._onDidChange,
            vscode.languages.onDidChangeDiagnostics(() => this._debouncer.trigger()),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (affectsSeverityFilter(e)) {
                    this._debouncer.trigger();
                }
            })
        );
        this.recompute();
    }

    /** Per-file counts for the tree markers, for the severities the shared filter shows */
    get counts(): FileCounts {
        return this._counts;
    }

    /** All deduplicated errors, warnings and messages per file */
    get files(): CollectedDiagnostics {
        return this._files;
    }

    recompute(): void {
        this._files = collectDiagnostics(vscode.languages.getDiagnostics());
        this._counts = countFiles(this._files, readSeverityFilter());
        this._onDidChange.fire();
    }

    dispose(): void {
        this._debouncer.cancel();
        this._disposables.forEach(d => d.dispose());
    }
}
