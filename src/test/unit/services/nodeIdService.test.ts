/**
 * Tests for the new JSON-based NodeId service
 */

import { NodeIdService } from '../../../services/nodeIdService';

describe('NodeIdService', () => {
    describe('Basic functionality', () => {
        it('should generate and parse solution nodeId', () => {
            const solutionPath = '/home/user/project/solution.sln';
            const nodeId = NodeIdService.generateSolutionId(solutionPath);

            expect(typeof nodeId).toBe('object');

            const parsed = NodeIdService.parse(nodeId);
            expect(parsed.type).toBe('solution');
            expect(parsed.solutionPath).toBe(solutionPath);
        });

        it('should generate and parse project nodeId', () => {
            const projectPath = '/home/user/project/MyProject.csproj';
            const nodeId = NodeIdService.generateProjectId(projectPath);

            const parsed = NodeIdService.parse(nodeId);
            expect(parsed.type).toBe('project');
            expect(parsed.projectPath).toBe(projectPath);
        });

        it('should generate and parse file nodeId', () => {
            const filePath = '/home/user/project/src/MyFile.cs';
            const projectPath = '/home/user/project/MyProject.csproj';
            const nodeId = NodeIdService.generateFileId(filePath, projectPath);

            const parsed = NodeIdService.parse(nodeId);
            expect(parsed.type).toBe('file');
            expect(parsed.filePath).toBe(filePath);
            expect(parsed.projectPath).toBe(projectPath);
        });

        it('should generate and parse folder nodeId', () => {
            const folderPath = '/home/user/project/src/Services';
            const projectPath = '/home/user/project/MyProject.csproj';
            const nodeId = NodeIdService.generateFolderId(folderPath, projectPath);

            const parsed = NodeIdService.parse(nodeId);
            expect(parsed.type).toBe('folder');
            expect(parsed.folderPath).toBe(folderPath);
            expect(parsed.projectPath).toBe(projectPath);
        });

        it('should generate and parse dependency nodeId', () => {
            const projectPath = '/home/user/project/MyProject.csproj';
            const categoryName = 'packages';
            const dependencyName = 'Newtonsoft.Json';
            const version = '13.0.1';

            const nodeId = NodeIdService.generateDependencyId(projectPath, categoryName, dependencyName, version);

            const parsed = NodeIdService.parse(nodeId);
            expect(parsed.type).toBe('dependency');
            expect(parsed.projectPath).toBe(projectPath);
            expect(parsed.categoryName).toBe(categoryName);
            expect(parsed.dependencyName).toBe(dependencyName);
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
            const parsed = NodeIdService.parse(nodeId);
            expect(parsed.projectPath).toBe(longPath);
        });

        it('should handle complex nodeIds efficiently', () => {
            const complexNodeId = NodeIdService.generateDependencyId(
                '/very/long/path/to/project/MyProject.csproj',
                'PackageReferences',
                'Microsoft.Extensions.DependencyInjection.Abstractions',
                '7.0.0'
            );

            expect(typeof complexNodeId).toBe('object');

            const parsed = NodeIdService.parse(complexNodeId);
            expect(parsed.type).toBe('dependency');
            expect(parsed.dependencyName).toBe('Microsoft.Extensions.DependencyInjection.Abstractions');
        });
    });
});

