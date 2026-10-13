jest.mock('vscode', () => ({
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    DiagnosticTag: { Unnecessary: 1, Deprecated: 2 },
}), { virtual: true });

import { collectDiagnostics, countDiagnostics, countFiles } from '../../../services/diagnosticsService';
import { normalizePath } from '../../../services/diagnosticsRollup';

const Error = 0, Warning = 1, Information = 2, Hint = 3;

const uri = (fsPath: string, scheme = 'file') => ({ fsPath, scheme }) as any;
const diag = (severity: number, line: number, message: string, code?: string | { value: string }, tags?: number[]) =>
    ({ severity, message, code, tags, range: { start: { line } } }) as any;

describe('countDiagnostics', () => {
    test('counts errors and warnings per file', () => {
        const result = countDiagnostics([
            [uri('/repo/A.cs'), [diag(Error, 1, 'e1', 'CS1'), diag(Warning, 2, 'w1', 'CS2'), diag(Warning, 3, 'w2', 'CS3')]],
        ], false);
        expect(result.get(normalizePath('/repo/A.cs'))).toEqual({ errors: 1, warnings: 2, infos: 0 });
    });

    test('deduplicates the same error from build output and the language server', () => {
        const result = countDiagnostics([
            [uri('/repo/A.cs'), [
                diag(Error, 4, "The name 'x' does not exist in the current context [/repo/Api/Api.csproj]", 'CS0103'),
                diag(Error, 4, "The name 'x' does not exist in the current context", { value: 'CS0103' }),
                diag(Error, 4, "The name 'x' does not exist in the current context [/repo/Api/Api.csproj]", 'CS0103'),
            ]],
        ], false);
        expect(result.get(normalizePath('/repo/A.cs'))).toEqual({ errors: 1, warnings: 0, infos: 0 });
    });

    test('keeps distinct diagnostics on the same line', () => {
        const result = countDiagnostics([
            [uri('/repo/A.cs'), [diag(Error, 4, 'first', 'CS1'), diag(Error, 4, 'second', 'CS2')]],
        ], false);
        expect(result.get(normalizePath('/repo/A.cs'))?.errors).toBe(2);
    });

    test('counts infos and suggestions (hints) only when enabled', () => {
        const entries = [[uri('/repo/A.cs'), [diag(Information, 1, 'i', 'CA1'), diag(Hint, 2, "'new' expression can be simplified", 'IDE0090')]]] as const;
        expect(countDiagnostics(entries, false).size).toBe(0);
        expect(countDiagnostics(entries, true).get(normalizePath('/repo/A.cs'))).toEqual({ errors: 0, warnings: 0, infos: 2 });
    });

    test('never counts hints that only fade out unnecessary code', () => {
        const entries = [[uri('/repo/A.cs'), [diag(Hint, 1, 'Using directive is unnecessary.', 'IDE0005', [1])]]] as const;
        expect(countDiagnostics(entries, true).size).toBe(0);
    });

    test('ignores non-file URIs and files without counted diagnostics', () => {
        const result = countDiagnostics([
            [uri('/repo/A.cs', 'untitled'), [diag(Error, 1, 'e', 'CS1')]],
            [uri('/repo/B.cs'), []],
        ], false);
        expect(result.size).toBe(0);
    });
});

describe('collectDiagnostics', () => {
    const at = (line: number, character = 0) => ({ start: { line, character } });
    const full = (severity: number, line: number, message: string, code?: string | { value: string }, tags?: number[]) =>
        ({ severity, message, code, tags, range: at(line) }) as any;

    test('lists deduplicated errors, warnings and messages with the project suffix stripped', () => {
        const files = collectForA([
            full(Error, 4, "The name 'x' does not exist [/repo/Api/Api.csproj]", 'CS0103'),
            full(Error, 4, "The name 'x' does not exist", { value: 'CS0103' }),
            full(Warning, 7, 'w', 'CS0168'),
            full(Information, 8, 'i', 'CA1822'),
            full(Hint, 9, "'new' expression can be simplified", 'IDE0090'),
            full(Hint, 1, 'Using directive is unnecessary.', 'IDE0005', [1]),
        ]);
        const file = files.get(normalizePath('/repo/A.cs'))!;
        expect(file.uri.fsPath).toBe('/repo/A.cs');
        expect(file.diagnostics.map(d => [d.severity, d.code, d.message, d.range.start.line])).toEqual([
            ['error', 'CS0103', "The name 'x' does not exist", 4],
            ['warning', 'CS0168', 'w', 7],
            ['info', 'CA1822', 'i', 8],
            ['info', 'IDE0090', "'new' expression can be simplified", 9],
        ]);
    });

    test('merges the same file reported under two URIs', () => {
        const files = collectDiagnostics([
            [uri('/repo/A.cs'), [full(Error, 1, 'e', 'CS1')]],
            [uri('/repo/A.cs'), [full(Error, 1, 'e', 'CS1'), full(Warning, 2, 'w', 'CS2')]],
        ]);
        expect(files.get(normalizePath('/repo/A.cs'))!.diagnostics).toHaveLength(2);
    });

    test('counts derive from the collected diagnostics', () => {
        const files = collectForA([full(Error, 1, 'e', 'CS1'), full(Hint, 2, 'h', 'IDE1')]);
        expect(countFiles(files, false).get(normalizePath('/repo/A.cs'))).toEqual({ errors: 1, warnings: 0, infos: 0 });
        expect(countFiles(files, true).get(normalizePath('/repo/A.cs'))).toEqual({ errors: 1, warnings: 0, infos: 1 });
    });

    function collectForA(diagnostics: any[]) {
        return collectDiagnostics([[uri('/repo/A.cs'), diagnostics]]);
    }
});
