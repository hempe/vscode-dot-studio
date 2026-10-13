import * as vscode from 'vscode';
import { DiagnosticCounts } from '../types';
import { FileCounts, normalizePath } from './diagnosticsRollup';
import { SimpleDebounceManager } from './debounceManager';

const CONFIG_SECTION = 'shinobi.solutionExplorer';
const SHOW_INFOS_KEY = 'diagnostics.showInfos';

/** `$msCompile` appends the project to the message: `... [/repo/Api/Api.csproj]` */
const PROJECT_SUFFIX = /\s+\[[^\]]+\]$/;

/** Severity as listed in the Error List and the tree: infos include Roslyn's suggestions */
export type ListedSeverity = 'error' | 'warning' | 'info';

export interface ListedDiagnostic {
    readonly severity: ListedSeverity;
    readonly message: string;
    readonly code?: string;
    readonly range: vscode.Range;
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
            const message = diagnostic.message.replace(PROJECT_SUFFIX, '');
            const key = [severity, diagnostic.range.start.line, code ?? '', message].join('|');

            let entry = result.get(file);
            if (!entry) {
                entry = { uri, diagnostics: [], seen: new Set() };
                result.set(file, entry);
            }
            if (!entry.seen.has(key)) {
                entry.seen.add(key);
                entry.diagnostics.push({ severity, message, code, range: diagnostic.range });
            }
        }
    }
    return new Map([...result].map(([file, { uri, diagnostics }]) => [file, { uri, diagnostics }]));
}

/** Counts collected diagnostics per file; infos only count when `showInfos` is on */
export function countFiles(files: CollectedDiagnostics, showInfos: boolean): Map<string, DiagnosticCounts> {
    const result = new Map<string, DiagnosticCounts>();
    for (const [file, { diagnostics }] of files) {
        const errors = diagnostics.filter(d => d.severity === 'error').length;
        const warnings = diagnostics.filter(d => d.severity === 'warning').length;
        const infos = showInfos ? diagnostics.filter(d => d.severity === 'info').length : 0;
        if (errors || warnings || infos) {
            result.set(file, { errors, warnings, infos });
        }
    }
    return result;
}

/** Counts errors, warnings and (optionally) infos and suggestions per file, without duplicates */
export function countDiagnostics(
    entries: ReadonlyArray<readonly [vscode.Uri, readonly vscode.Diagnostic[]]>,
    showInfos: boolean
): Map<string, DiagnosticCounts> {
    return countFiles(collectDiagnostics(entries), showInfos);
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
                if (e.affectsConfiguration(`${CONFIG_SECTION}.${SHOW_INFOS_KEY}`)) {
                    this._debouncer.trigger();
                }
            })
        );
        this.recompute();
    }

    /** Per-file counts for the tree markers (infos depend on the setting) */
    get counts(): FileCounts {
        return this._counts;
    }

    /** All deduplicated errors, warnings and messages per file */
    get files(): CollectedDiagnostics {
        return this._files;
    }

    recompute(): void {
        const showInfos = vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>(SHOW_INFOS_KEY, false);
        this._files = collectDiagnostics(vscode.languages.getDiagnostics());
        this._counts = countFiles(this._files, showInfos);
        this._onDidChange.fire();
    }

    dispose(): void {
        this._debouncer.cancel();
        this._disposables.forEach(d => d.dispose());
    }
}
