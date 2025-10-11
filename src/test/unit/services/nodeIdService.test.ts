import { NodeIdService } from '../../../services/nodeIdService';

// Mock vscode module
jest.mock('vscode', () => ({}), { virtual: true });

describe('NodeIdService', () => {
    const testProjectPath = '/path/to/MyProject.csproj';
    const testSolutionPath = '/path/to/MySolution.sln';

    describe('generateSolutionId', () => {
        it('should generate unique solution IDs', () => {
            const id1 = NodeIdService.generateSolutionId('/path/to/Solution1.sln');
            const id2 = NodeIdService.generateSolutionId('/path/to/Solution2.sln');

            expect(id1).not.toBe(id2);
            expect(id1).toContain('sol:');
            expect(id2).toContain('sol:');
        });
    });

    describe('generateProjectId', () => {
        it('should generate unique project IDs', () => {
            const id1 = NodeIdService.generateProjectId('/path/to/Project1.csproj');
            const id2 = NodeIdService.generateProjectId('/path/to/Project2.csproj');

            expect(id1).not.toBe(id2);
            expect(id1).toContain('proj:');
            expect(id2).toContain('proj:');
        });
    });

    describe('generateDependenciesId', () => {
        it('should generate dependencies ID for project', () => {
            const id = NodeIdService.generateDependenciesId(testProjectPath);

            expect(id).toContain('deps:');
            expect(id).toContain(testProjectPath);
        });
    });

    describe('generateDependencyCategoryId', () => {
        it('should generate category IDs for different dependency types', () => {
            const packagesId = NodeIdService.generateDependencyCategoryId(testProjectPath, 'packages');
            const projectsId = NodeIdService.generateDependencyCategoryId(testProjectPath, 'projects');
            const assembliesId = NodeIdService.generateDependencyCategoryId(testProjectPath, 'assemblies');

            expect(packagesId).toContain('depcat:');
            expect(packagesId).toContain('packages');
            expect(projectsId).toContain('depcat:');
            expect(projectsId).toContain('projects');
            expect(assembliesId).toContain('depcat:');
            expect(assembliesId).toContain('assemblies');

            // All should be unique
            expect(packagesId).not.toBe(projectsId);
            expect(projectsId).not.toBe(assembliesId);
            expect(packagesId).not.toBe(assembliesId);
        });
    });

    describe('generateDependencyId', () => {
        it('should generate dependency ID with version', () => {
            const id = NodeIdService.generateDependencyId(
                testProjectPath,
                'packages',
                'Newtonsoft.Json',
                '13.0.1'
            );

            expect(id).toContain('dep:');
            expect(id).toContain('packages');
            expect(id).toContain('Newtonsoft.Json');
            expect(id).toContain('13.0.1');
        });

        it('should generate dependency ID without version', () => {
            const id = NodeIdService.generateDependencyId(
                testProjectPath,
                'projects',
                'MyOtherProject'
            );

            expect(id).toContain('dep:');
            expect(id).toContain('projects');
            expect(id).toContain('MyOtherProject');
        });
    });

    describe('getNodeTypeFromId', () => {
        it('should extract node type from different ID types', () => {
            const solutionId = NodeIdService.generateSolutionId(testSolutionPath);
            const projectId = NodeIdService.generateProjectId(testProjectPath);
            const dependenciesId = NodeIdService.generateDependenciesId(testProjectPath);
            const categoryId = NodeIdService.generateDependencyCategoryId(testProjectPath, 'packages');
            const dependencyId = NodeIdService.generateDependencyId(testProjectPath, 'packages', 'Test');

            expect(NodeIdService.getNodeTypeFromId(solutionId)).toBe('solution');
            expect(NodeIdService.getNodeTypeFromId(projectId)).toBe('project');
            expect(NodeIdService.getNodeTypeFromId(dependenciesId)).toBe('dependencies');
            expect(NodeIdService.getNodeTypeFromId(categoryId)).toBe('dependencyCategory');
            expect(NodeIdService.getNodeTypeFromId(dependencyId)).toBe('dependency');
        });

        it('should return null for invalid IDs', () => {
            expect(NodeIdService.getNodeTypeFromId('invalid-id')).toBe(null);
            expect(NodeIdService.getNodeTypeFromId('')).toBe(null);
        });
    });

    describe('getPathFromId', () => {
        it('should extract path from project ID', () => {
            const projectId = NodeIdService.generateProjectId(testProjectPath);
            const extractedPath = NodeIdService.getPathFromId(projectId);

            expect(extractedPath).toBe(testProjectPath);
        });

        it('should extract path from solution ID', () => {
            const solutionId = NodeIdService.generateSolutionId(testSolutionPath);
            const extractedPath = NodeIdService.getPathFromId(solutionId);

            expect(extractedPath).toBe(testSolutionPath);
        });
    });

    describe('getProjectPathFromDependencyId', () => {
        it('should extract project path from dependency category ID', () => {
            const categoryId = NodeIdService.generateDependencyCategoryId(testProjectPath, 'packages');
            const extractedPath = NodeIdService.getProjectPathFromDependencyId(categoryId);

            expect(extractedPath).toBe(testProjectPath);
        });

        it('should extract project path from dependency ID', () => {
            const dependencyId = NodeIdService.generateDependencyId(testProjectPath, 'packages', 'Test');
            const extractedPath = NodeIdService.getProjectPathFromDependencyId(dependencyId);

            expect(extractedPath).toBe(testProjectPath);
        });
    });

    describe('nodeIdToPath', () => {
        it('should convert file nodeId to path', () => {
            const filePath = testProjectPath.replace('.csproj', '/Program.cs');
            const fileId = NodeIdService.generateFileId(filePath);
            const path = NodeIdService.nodeIdToPath(fileId);

            expect(path).toBe(filePath);
        });

        it('should convert folder nodeId to path', () => {
            const folderPath = '/path/to/MyProject/Controllers';
            const folderId = NodeIdService.generateFolderId(folderPath, testProjectPath);
            const path = NodeIdService.nodeIdToPath(folderId);

            expect(path).toBe(folderPath);
        });

        it('should return null for unsupported node types', () => {
            const dependencyId = NodeIdService.generateDependencyId(testProjectPath, 'packages', 'Test');
            const path = NodeIdService.nodeIdToPath(dependencyId);

            expect(path).toBe(null);
        });
    });
});