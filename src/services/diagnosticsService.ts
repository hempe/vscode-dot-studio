import * as vscode from 'vscode';
import { DiagnosticCounts } from '../types';
import { FileCounts, normalizePath } from './diagnosticsRollup';
import { SimpleDebounceManager } from './debounceManager';

const CONFIG_SECTION = 'shinobi.solutionExplorer';
const SHOW_INFOS_KEY = 'diagnostics.showInfos';

/** `$msCompile` appends the project to the message: `... [/repo/Api/Api.csproj]` */
const PROJECT_SUFFIX = /\s+\[[^\]]+\]$/;

/**
 * Counts errors, warnings and (optionally) infos and suggestions per file. Duplicates — the same diagnostic
 * from build output and the language server, or from several target frameworks — count once.
 */
export function countDiagnostics(
    entries: ReadonlyArray<readonly [vscode.Uri, readonly vscode.Diagnostic[]]>,
    showInfos: boolean
): Map<string, DiagnosticCounts> {
    const result = new Map<string, DiagnosticCounts>();
    for (const [uri, diagnostics] of entries) {
        if (uri.scheme !== 'file') {
            continue;
        }

        const seen = new Set<string>();
        let errors = 0, warnings = 0, infos = 0;
        for (const diagnostic of diagnostics) {
            const code = typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code;
            const key = [diagnostic.severity, diagnostic.range.start.line, code ?? '', diagnostic.message.replace(PROJECT_SUFFIX, '')].join('|');
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);

            switch (diagnostic.severity) {
                case vscode.DiagnosticSeverity.Error: errors++; break;
                case vscode.DiagnosticSeverity.Warning: warnings++; break;
                case vscode.DiagnosticSeverity.Information: if (showInfos) infos++; break;
                // Roslyn reports suggestions (VS "Messages", the editor's ··· dots) as hints;
                // hints tagged Unnecessary only fade out unused code and are not listed in VS
                case vscode.DiagnosticSeverity.Hint:
                    if (showInfos && !diagnostic.tags?.includes(vscode.DiagnosticTag.Unnecessary)) infos++;
                    break;
            }
        }

        if (errors || warnings || infos) {
            const file = normalizePath(uri.fsPath);
            const existing = result.get(file);
            result.set(file, existing
                ? { errors: existing.errors + errors, warnings: existing.warnings + warnings, infos: existing.infos + infos }
                : { errors, warnings, infos });
        }
    }
    return result;
}

/** Keeps per-file diagnostic counts up to date and fires `onDidChange` after each recompute */
export class DiagnosticsService implements vscode.Disposable {
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

    get counts(): FileCounts {
        return this._counts;
    }

    recompute(): void {
        const showInfos = vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>(SHOW_INFOS_KEY, false);
        this._counts = countDiagnostics(vscode.languages.getDiagnostics(), showInfos);
        this._onDidChange.fire();
    }

    dispose(): void {
        this._debouncer.cancel();
        this._disposables.forEach(d => d.dispose());
    }
}
