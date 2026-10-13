import * as path from 'path';
import { buildErrorList, MISCELLANEOUS_FILES, summarizeErrorList } from '../../../services/errorList';
import { normalizePath } from '../../../services/diagnosticsRollup';
import { FileDiagnostics, ListedDiagnostic, ListedSeverity } from '../../../services/diagnosticsService';

const root = path.resolve('/repo');
const p = (...parts: string[]) => path.join(root, ...parts);

const diag = (severity: ListedSeverity, line: number, character = 0): ListedDiagnostic =>
    ({ severity, message: `${severity} at ${line}`, code: 'X1', range: { start: { line, character } } }) as ListedDiagnostic;

const files = (entries: Record<string, ListedDiagnostic[]>) =>
    new Map<string, FileDiagnostics>(Object.entries(entries).map(([file, diagnostics]) =>
        [normalizePath(file), { uri: { fsPath: file } as FileDiagnostics['uri'], diagnostics }]));

const projects = [
    { name: 'Domain', path: p('Domain', 'Domain.csproj') },
    { name: 'Api', path: p('Api', 'Api.csproj') },
    { name: 'Api.Tests', path: p('Api', 'Tests', 'Api.Tests.csproj') },
];

const all = { errors: true, warnings: true, messages: true };

describe('buildErrorList', () => {
    test('groups files by project, sorted by name, with unmatched files last', () => {
        const list = buildErrorList(files({
            [p('Domain', 'Order.cs')]: [diag('warning', 1)],
            [p('Api', 'Program.cs')]: [diag('error', 3)],
            [p('build', 'tool.cs')]: [diag('error', 1)],
        }), projects, all);
        expect(list.map(project => [project.name, project.files.map(f => path.basename(f.uri.fsPath))])).toEqual([
            ['Api', ['Program.cs']],
            ['Domain', ['Order.cs']],
            [MISCELLANEOUS_FILES, ['tool.cs']],
        ]);
    });

    test('a file belongs to the innermost project directory', () => {
        const list = buildErrorList(files({ [p('Api', 'Tests', 'UserTests.cs')]: [diag('error', 1)] }), projects, all);
        expect(list.map(project => project.name)).toEqual(['Api.Tests']);
    });

    test('sorts diagnostics by line and column', () => {
        const list = buildErrorList(files({
            [p('Api', 'Program.cs')]: [diag('warning', 9), diag('error', 2, 5), diag('error', 2, 1)],
        }), projects, all);
        expect(list[0].files[0].diagnostics.map(d => [d.range.start.line, d.range.start.character])).toEqual([[2, 1], [2, 5], [9, 0]]);
    });

    test('filters severities and drops files and projects left empty', () => {
        const list = buildErrorList(files({
            [p('Api', 'Program.cs')]: [diag('error', 1), diag('info', 2)],
            [p('Domain', 'Order.cs')]: [diag('info', 1)],
        }), projects, { errors: true, warnings: true, messages: false });
        expect(list.map(project => project.name)).toEqual(['Api']);
        expect(list[0].files[0].diagnostics.map(d => d.severity)).toEqual(['error']);
    });
});

describe('summarizeErrorList', () => {
    test('counts every severity regardless of the filter', () => {
        expect(summarizeErrorList(files({
            [p('Api', 'Program.cs')]: [diag('error', 1), diag('info', 2), diag('info', 3)],
            [p('Domain', 'Order.cs')]: [diag('warning', 1)],
        }))).toEqual({ errors: 1, warnings: 1, messages: 2 });
    });
});
