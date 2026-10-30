import * as path from 'path';
import { buildErrorRows, MISCELLANEOUS_FILES, nodeRows, summarizeErrorList } from '../../../../services/diagnostics/errorList';
import { normalizePath, scopeOf } from '../../../../services/diagnostics/diagnosticsRollup';
import { NodeIdService } from '../../../../services/solution/nodeIdService';
import { ProjectNode } from '../../../../types';
import { FileDiagnostics, ListedDiagnostic, ListedSeverity } from '../../../../services/diagnostics/diagnosticsService';

const root = path.resolve('/repo');
const p = (...parts: string[]) => path.join(root, ...parts);

const diag = (severity: ListedSeverity, line: number, character = 0, code = 'X1'): ListedDiagnostic =>
    ({ severity, message: `${severity} at ${line}`, code, range: { start: { line, character } } }) as ListedDiagnostic;

const files = (entries: Record<string, ListedDiagnostic[]>) =>
    new Map<string, FileDiagnostics>(Object.entries(entries).map(([file, diagnostics]) =>
        [normalizePath(file), { uri: { fsPath: file } as FileDiagnostics['uri'], diagnostics }]));

const projects = [
    { name: 'Domain', path: p('Domain', 'Domain.csproj') },
    { name: 'Api', path: p('Api', 'Api.csproj') },
    { name: 'Api.Tests', path: p('Api', 'Tests', 'Api.Tests.csproj') },
];

describe('buildErrorRows', () => {
    test('one row per diagnostic with project, file relative to it, 1-based position', () => {
        const rows = buildErrorRows(files({ [p('Api', 'Controllers', 'Values.cs')]: [{ ...diag('warning', 4, 2, 'CS0168'), codeUrl: 'https://docs/cs0168' }] }), projects);
        expect(rows).toEqual([{
            id: expect.any(String), severity: 'warning', code: 'CS0168', codeUrl: 'https://docs/cs0168', message: 'warning at 4',
            project: 'Api', file: path.join('Controllers', 'Values.cs'), filePath: p('Api', 'Controllers', 'Values.cs'), line: 5, column: 3,
        }]);
    });

    test('a file belongs to the innermost project directory; others are Miscellaneous Files', () => {
        const rows = buildErrorRows(files({
            [p('Api', 'Tests', 'UserTests.cs')]: [diag('error', 1)],
            [p('build', 'tool.cs')]: [diag('error', 1)],
        }), projects);
        expect(rows.map(r => [r.project, r.file])).toEqual([['Api.Tests', 'UserTests.cs'], [MISCELLANEOUS_FILES, 'tool.cs']]);
    });

    test('sorted by severity, project, file and position', () => {
        const rows = buildErrorRows(files({
            [p('Domain', 'Order.cs')]: [diag('info', 1), diag('error', 9)],
            [p('Api', 'Program.cs')]: [diag('warning', 2, 5), diag('error', 3), diag('warning', 2, 1)],
        }), projects);
        expect(rows.map(r => `${r.severity} ${r.project} ${r.line}:${r.column}`)).toEqual([
            'error Api 4:1', 'error Domain 10:1', 'warning Api 3:2', 'warning Api 3:6', 'info Domain 2:1',
        ]);
        expect(new Set(rows.map(r => r.id)).size).toBe(rows.length);
    });
});

describe('summarizeErrorList', () => {
    test('counts every severity', () => {
        expect(summarizeErrorList(files({ [p('Api', 'A.cs')]: [diag('error', 1), diag('info', 2), diag('info', 3)] })))
            .toEqual({ errors: 1, warnings: 0, infos: 2 });
    });
});

describe('nodeRows', () => {
    const all = { errors: true, warnings: true, infos: true };
    const entries = files({
        [p('Api', 'Controllers', 'Values.cs')]: [diag('warning', 1), diag('info', 2)],
        [p('Domain', 'User.cs')]: [diag('error', 3)],
    });
    const folder = { type: 'folder', name: 'Controllers', nodeId: NodeIdService.generateFolderId(p('Api', 'Controllers')) } as ProjectNode;

    test('only the files below the node, for the severities the filter shows', () => {
        const scope = scopeOf(folder);
        expect(nodeRows(entries, scope, all, projects).map(r => r.severity)).toEqual(['warning', 'info']);
        expect(nodeRows(entries, scope, { ...all, infos: false }, projects).map(r => r.severity)).toEqual(['warning']);
    });
});
