jest.mock('vscode', () => ({
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    DiagnosticTag: { Unnecessary: 1, Deprecated: 2 },
}), { virtual: true });

import { countDiagnostics } from '../../../services/diagnosticsService';
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
