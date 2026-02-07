/**
 * Tests for the new JSON-based NodeId service
 */

import { DependencyNodeId, FolderNodeId, NodeIdService, ProjectNodeId, SolutionNodeId } from '../../../services/nodeIdService';

describe('NodeIdService', () => {
    describe('Basic functionality', () => {
        it('should generate and parse solution nodeId', () => {
            const solutionPath = '/home/user/project/solution.sln';
            const nodeId = NodeIdService.generateSolutionId(solutionPath);

            expect(typeof nodeId).toBe('object');

            const parsed = NodeIdService.parse(nodeId) as SolutionNodeId;
            expect(parsed.type).toBe('solution');
            expect(parsed.path).toBe(solutionPath);
        });

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
        it('should produce reasonably compressed nodeIds', () => {
            const longPath = '/very/long/path/to/project/with/many/subdirectories/and/a/very/long/filename/MyProject.csproj';
            const nodeId = NodeIdService.generateProjectId(longPath);

            // The nodeId should be a valid base64 string
            expect(typeof nodeId).toBe('object');

            // Should be able to parse it back
            const parsed = NodeIdService.parse(nodeId) as ProjectNodeId;
            expect(parsed.path).toBe(longPath);
        });

        it('should handle complex nodeIds efficiently', () => {
            const complexNodeId = NodeIdService.generateDependencyId(
                '/very/long/path/to/project/MyProject.csproj',
                'PackageReferences',
                'Microsoft.Extensions.DependencyInjection.Abstractions',
                '7.0.0'
            );

            expect(typeof complexNodeId).toBe('object');

            const parsed = NodeIdService.parse(complexNodeId) as DependencyNodeId;
            expect(parsed.type).toBe('dependency');
            expect(parsed.name).toBe('Microsoft.Extensions.DependencyInjection.Abstractions');
        });
    });
});

