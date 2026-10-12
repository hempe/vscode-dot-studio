import * as path from 'path';
import { computeMarkers, normalizePath } from '../../../services/diagnosticsRollup';
import { NodeIdService } from '../../../services/nodeIdService';
import { DiagnosticCounts, ProjectNode } from '../../../types';

const root = path.resolve('/repo');
const p = (...parts: string[]) => path.join(root, ...parts);

const counts = (errors: number, warnings: number, infos = 0): DiagnosticCounts => ({ errors, warnings, infos });
const fileCounts = (entries: Record<string, DiagnosticCounts>) =>
    new Map(Object.entries(entries).map(([file, c]) => [normalizePath(file), c]));

const file = (filePath: string, children?: ProjectNode[]): ProjectNode => ({
    type: 'file', name: path.basename(filePath), nodeId: NodeIdService.generateFileId(filePath), children,
});
const folder = (folderPath: string, children?: ProjectNode[]): ProjectNode => ({
    type: 'folder', name: path.basename(folderPath), nodeId: NodeIdService.generateFolderId(folderPath), children,
});
const project = (projectPath: string, children?: ProjectNode[]): ProjectNode => ({
    type: 'project', name: path.basename(projectPath), nodeId: NodeIdService.generateProjectId(projectPath), children,
});
const solutionFolder = (name: string, children: ProjectNode[]): ProjectNode => ({
    type: 'solutionFolder', name,
    nodeId: NodeIdService.generateSolutionFolderId(name, p('All.sln'), `guid-${name}`), children,
});
const solutionItem = (itemPath: string): ProjectNode => ({
    type: 'solutionItem', name: path.basename(itemPath),
    nodeId: NodeIdService.generateSolutionItemId(path.basename(itemPath), 'guid-items', itemPath),
});
const solution = (children: ProjectNode[]): ProjectNode => ({
    type: 'solution', name: 'All', nodeId: NodeIdService.generateSolutionId(p('All.sln')), children,
});

describe('computeMarkers', () => {
    test('marks a file with its own counts and picks the most severe state', () => {
        const program = file(p('Api', 'Program.cs'));
        const markers = computeMarkers([program], fileCounts({ [p('Api', 'Program.cs')]: counts(2, 3) }));
        expect(markers[program.nodeId]).toEqual({ severity: 'error', errors: 2, warnings: 3, infos: 0 });
    });

    test('leaves out nodes without diagnostics', () => {
        const program = file(p('Api', 'Program.cs'));
        expect(computeMarkers([program], fileCounts({}))).toEqual({});
    });

    test('uses warning and info severities when there are no errors', () => {
        const a = file(p('a.cs'));
        const b = file(p('b.cs'));
        const markers = computeMarkers([a, b], fileCounts({ [p('a.cs')]: counts(0, 1), [p('b.cs')]: counts(0, 0, 4) }));
        expect(markers[a.nodeId].severity).toBe('warning');
        expect(markers[b.nodeId]).toEqual({ severity: 'info', errors: 0, warnings: 0, infos: 4 });
    });

    test('a file includes its nested child files', () => {
        const designer = file(p('Api', 'Form1.Designer.cs'));
        const form = file(p('Api', 'Form1.cs'), [designer]);
        const markers = computeMarkers([form], fileCounts({ [p('Api', 'Form1.Designer.cs')]: counts(1, 0) }));
        expect(markers[form.nodeId]).toEqual({ severity: 'error', errors: 1, warnings: 0, infos: 0 });
        expect(markers[designer.nodeId].errors).toBe(1);
    });

    test('folders and projects sum every file below them, even when not loaded', () => {
        const controllers = folder(p('Api', 'Controllers')); // children never loaded
        const api = project(p('Api', 'Api.csproj'), [controllers]);
        const markers = computeMarkers([api], fileCounts({
            [p('Api', 'Controllers', 'Deep', 'UserController.cs')]: counts(1, 0),
            [p('Api', 'Program.cs')]: counts(0, 2),
        }));
        expect(markers[controllers.nodeId]).toEqual({ severity: 'error', errors: 1, warnings: 0, infos: 0 });
        expect(markers[api.nodeId]).toEqual({ severity: 'error', errors: 1, warnings: 2, infos: 0 });
    });

    test('a folder does not match a sibling that shares its name prefix', () => {
        const foo = folder(p('Api', 'Foo'));
        const markers = computeMarkers([foo], fileCounts({ [p('Api', 'FooBar', 'x.cs')]: counts(1, 0) }));
        expect(markers[foo.nodeId]).toBeUndefined();
    });

    test('solution folders and the solution sum their children', () => {
        const api = project(p('Api', 'Api.csproj'));
        const domain = project(p('Domain', 'Domain.csproj'));
        const readme = solutionItem(p('README.md'));
        const src = solutionFolder('src', [api, readme]);
        const sln = solution([src, domain]);
        const markers = computeMarkers([sln], fileCounts({
            [p('Api', 'Program.cs')]: counts(1, 0),
            [p('Domain', 'Order.cs')]: counts(0, 2),
            [p('README.md')]: counts(0, 1),
        }));
        expect(markers[readme.nodeId]).toEqual({ severity: 'warning', errors: 0, warnings: 1, infos: 0 });
        expect(markers[src.nodeId]).toEqual({ severity: 'error', errors: 1, warnings: 1, infos: 0 });
        expect(markers[sln.nodeId]).toEqual({ severity: 'error', errors: 1, warnings: 3, infos: 0 });
    });

    test('ignores node ids that cannot be decoded', () => {
        const broken: ProjectNode = { type: 'file', name: 'x', nodeId: 'not-a-node-id' as ProjectNode['nodeId'] };
        expect(computeMarkers([broken], fileCounts({}))).toEqual({});
    });
});

describe('normalizePath', () => {
    test('lower-cases on Windows only', () => {
        expect(normalizePath('C:\\Repo\\A.cs', 'win32')).toBe(path.normalize('C:\\Repo\\A.cs').toLowerCase());
        expect(normalizePath('/Repo/A.cs', 'linux')).toBe(path.normalize('/Repo/A.cs'));
    });
});
