/**
 * Tests for the new JSON-based NodeId service
 */

import { DependencyNodeId, FolderNodeId, NodeIdService, ProjectNodeId } from '../../../../services/solution/nodeIdService';

describe('NodeIdService', () => {
    describe('Basic functionality', () => {

        it('should generate and parse project nodeId', () => {
            const projectPath = '/home/user/project/MyProject.csproj';
            const nodeId = NodeIdService.generateProjectId(projectPath);

            const parsed = NodeIdService.parse(nodeId) as ProjectNodeId;
            expect(parsed.type).toBe('project');
            expect(parsed.path).toBe(projectPath);
        });

        it('should generate and parse folder nodeId', () => {
            const folderPath = '/home/user/project/src/Services';
            const nodeId = NodeIdService.generateFolderId(folderPath);

            const parsed = NodeIdService.parse(nodeId) as FolderNodeId;
            expect(parsed.type).toBe('folder');
            expect(parsed.path).toBe(folderPath);
        });

        it('should generate and parse dependency nodeId', () => {
            const projectPath = '/home/user/project/MyProject.csproj';
            const categoryName = 'packages';
            const dependencyName = 'Newtonsoft.Json';
            const version = '13.0.1';

            const nodeId = NodeIdService.generateDependencyId(projectPath, categoryName, dependencyName, version);

            const parsed = NodeIdService.parse(nodeId) as DependencyNodeId;
            expect(parsed.type).toBe('dependency');
            expect(parsed.path).toBe(projectPath);
            expect(parsed.category).toBe(categoryName);
            expect(parsed.name).toBe(dependencyName);
            expect(parsed.version).toBe(version);
        });
    });


    describe('Compression efficiency', () => {
    });
});


describe('NodeIdService encoding', () => {
    const id = { type: 'file' as const, path: '/repo/src/Api/Program.cs' };

    it('makes opaque ids (nothing readable for the webview to depend on) without compressing them', () => {
        const nodeId = NodeIdService.generateFileId(id.path);
        expect(nodeId).not.toContain('Program');
        expect(nodeId.startsWith('H4sI')).toBe(false); // no gzip
        expect(NodeIdService.parse(nodeId)).toEqual(id);
    });

    it('still reads ids from before, which were gzipped (kept in the workspace state)', () => {
        const old = require('zlib').gzipSync(Buffer.from(JSON.stringify(id))).toString('base64');
        expect(NodeIdService.parse(old)).toEqual(id);
        expect(NodeIdService.isValid(old)).toBe(true);
    });
});

describe('NodeIdService: the project whose tree shows a file or folder', () => {
    test('file and folder ids carry the project only when it is given', () => {
        const file = NodeIdService.parse(NodeIdService.generateFileId('/s/Outer/Inner/Foo.cs', '/s/Outer/Outer.csproj'));
        expect(file).toEqual({ type: 'file', path: '/s/Outer/Inner/Foo.cs', project: '/s/Outer/Outer.csproj' });
        const folder = NodeIdService.parse(NodeIdService.generateFolderId('/s/Outer/Inner/Sub', '/s/Outer/Outer.csproj'));
        expect(folder).toEqual({ type: 'folder', path: '/s/Outer/Inner/Sub', project: '/s/Outer/Outer.csproj' });
    });

    test('without a project the ids stay as before (persisted expansion state still matches)', () => {
        const before = Buffer.from(JSON.stringify({ type: 'folder', path: '/s/App/Sub' }), 'utf8').toString('base64url');
        expect(NodeIdService.generateFolderId('/s/App/Sub')).toBe(before);
        expect(NodeIdService.generateFolderId('/s/App/Sub', undefined)).toBe(before);
        expect(NodeIdService.parse(NodeIdService.generateFileId('/s/App/A.cs'))).toEqual({ type: 'file', path: '/s/App/A.cs' });
    });
});
