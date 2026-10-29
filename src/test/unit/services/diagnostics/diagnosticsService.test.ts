jest.mock('vscode', () => ({
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    DiagnosticTag: { Unnecessary: 1, Deprecated: 2 },
}), { virtual: true });

import { collectDiagnostics, countDiagnostics, countFiles, documentationUrl } from '../../../../services/diagnostics/diagnosticsService';
import { normalizePath } from '../../../../services/diagnostics/diagnosticsRollup';

const ALL = { errors: true, warnings: true, infos: true };
const WITHOUT_INFOS = { errors: true, warnings: true, infos: false };

const Error = 0, Warning = 1, Information = 2, Hint = 3;

const uri = (fsPath: string, scheme = 'file') => ({ fsPath, scheme }) as any;
const diag = (severity: number, line: number, message: string, code?: string | { value: string }, tags?: number[]) =>
    ({ severity, message, code, tags, range: { start: { line } } }) as any;

describe('countDiagnostics', () => {
    test('counts errors and warnings per file', () => {
        const result = countDiagnostics([
            [uri('/repo/A.cs'), [diag(Error, 1, 'e1', 'CS1'), diag(Warning, 2, 'w1', 'CS2'), diag(Warning, 3, 'w2', 'CS3')]],
        ], WITHOUT_INFOS);
        expect(result.get(normalizePath('/repo/A.cs'))).toEqual({ errors: 1, warnings: 2, infos: 0 });
    });

    test('deduplicates the same error from build output and the language server', () => {
        const result = countDiagnostics([
            [uri('/repo/A.cs'), [
                diag(Error, 4, "The name 'x' does not exist in the current context [/repo/Api/Api.csproj]", 'CS0103'),
                diag(Error, 4, "The name 'x' does not exist in the current context", { value: 'CS0103' }),
                diag(Error, 4, "The name 'x' does not exist in the current context [/repo/Api/Api.csproj]", 'CS0103'),
            ]],
        ], WITHOUT_INFOS);
        expect(result.get(normalizePath('/repo/A.cs'))).toEqual({ errors: 1, warnings: 0, infos: 0 });
    });

    test('keeps distinct diagnostics on the same line', () => {
        const result = countDiagnostics([
            [uri('/repo/A.cs'), [diag(Error, 4, 'first', 'CS1'), diag(Error, 4, 'second', 'CS2')]],
        ], WITHOUT_INFOS);
        expect(result.get(normalizePath('/repo/A.cs'))?.errors).toBe(2);
    });

    test('counts infos and suggestions (hints) only when enabled', () => {
        const entries = [[uri('/repo/A.cs'), [diag(Information, 1, 'i', 'CA1'), diag(Hint, 2, "'new' expression can be simplified", 'IDE0090')]]] as const;
        expect(countDiagnostics(entries, WITHOUT_INFOS).size).toBe(0);
        expect(countDiagnostics(entries, ALL).get(normalizePath('/repo/A.cs'))).toEqual({ errors: 0, warnings: 0, infos: 2 });
    });

    test('never counts hints that only fade out unnecessary code', () => {
        const entries = [[uri('/repo/A.cs'), [diag(Hint, 1, 'Using directive is unnecessary.', 'IDE0005', [1])]]] as const;
        expect(countDiagnostics(entries, ALL).size).toBe(0);
    });

    test('ignores non-file URIs and files without counted diagnostics', () => {
        const result = countDiagnostics([
            [uri('/repo/A.cs', 'untitled'), [diag(Error, 1, 'e', 'CS1')]],
            [uri('/repo/B.cs'), []],
        ], WITHOUT_INFOS);
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
        expect(countFiles(files, WITHOUT_INFOS).get(normalizePath('/repo/A.cs'))).toEqual({ errors: 1, warnings: 0, infos: 0 });
        expect(countFiles(files, ALL).get(normalizePath('/repo/A.cs'))).toEqual({ errors: 1, warnings: 0, infos: 1 });
    });

    function collectForA(diagnostics: any[]) {
        return collectDiagnostics([[uri('/repo/A.cs'), diagnostics]]);
    }
});

describe('severity filter and documentation links', () => {
    it('counts only the severities the filter shows', () => {
        const entries = [[uri('/repo/A.cs'), [diag(Error, 1, 'e'), diag(Warning, 2, 'w'), diag(Hint, 3, 'h')]]] as const;
        expect(countDiagnostics(entries, { errors: false, warnings: true, infos: true }).get(normalizePath('/repo/A.cs')))
            .toEqual({ errors: 0, warnings: 1, infos: 1 });
        expect(countDiagnostics(entries, { errors: false, warnings: false, infos: false }).size).toBe(0);
    });

    it('keeps the analyzer link, or finds the docs page by prefix', () => {
        const target = { toString: () => 'https://example.com/rules/XY1' };
        const files = collectDiagnostics([[uri('/repo/A.cs'), [
            diag(Warning, 1, 'w', { value: 'XY1', target } as any),
            diag(Error, 2, 'e', 'CS0103'),
            diag(Warning, 3, 'x', 'MY001'),
        ]]]);
        expect(files.get(normalizePath('/repo/A.cs'))!.diagnostics.map(d => d.codeUrl)).toEqual([
            'https://example.com/rules/XY1',
            'https://learn.microsoft.com/dotnet/csharp/language-reference/compiler-messages/cs0103',
            undefined,
        ]);
        expect(documentationUrl('IDE0090')).toBe('https://learn.microsoft.com/dotnet/fundamentals/code-analysis/style-rules/ide0090');
        expect(documentationUrl('CA1822')).toBe('https://learn.microsoft.com/dotnet/fundamentals/code-analysis/quality-rules/ca1822');
        expect(documentationUrl('NETSDK1226')).toBe('https://learn.microsoft.com/dotnet/core/tools/sdk-errors/netsdk1226');
    });
});
