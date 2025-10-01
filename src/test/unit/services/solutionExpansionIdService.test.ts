import { SolutionExpansionIdService } from '../../../services/solutionExpansionIdService';

// Mock vscode module
jest.mock('vscode', () => ({}), { virtual: true });

describe('SolutionExpansionIdService', () => {
    const testProjectPath = '/path/to/MyProject.csproj';
    const testSolutionPath = '/path/to/MySolution.sln';

    describe('generateSolutionId', () => {
        it('should generate unique solution IDs', () => {
            const id1 = SolutionExpansionIdService.generateSolutionId('/path/to/Solution1.sln');
            const id2 = SolutionExpansionIdService.generateSolutionId('/path/to/Solution2.sln');

            expect(id1).not.toBe(id2);
            expect(id1).toContain('sol:');
            expect(id2).toContain('sol:');
        });
    });

    describe('generateProjectId', () => {
        it('should generate unique project IDs', () => {
            const id1 = SolutionExpansionIdService.generateProjectId('/path/to/Project1.csproj');
            const id2 = SolutionExpansionIdService.generateProjectId('/path/to/Project2.csproj');

            expect(id1).not.toBe(id2);
            expect(id1).toContain('proj:');
            expect(id2).toContain('proj:');
        });
    });

    describe('generateDependenciesId', () => {
        it('should generate dependencies ID for project', () => {
            const id = SolutionExpansionIdService.generateDependenciesId(testProjectPath);

            expect(id).toContain('deps:');
            expect(id).toContain(testProjectPath);
        });
    });

    describe('generateDependencyCategoryId', () => {
        it('should generate category IDs for different dependency types', () => {
            const packagesId = SolutionExpansionIdService.generateDependencyCategoryId(testProjectPath, 'packages');
            const projectsId = SolutionExpansionIdService.generateDependencyCategoryId(testProjectPath, 'projects');
            const assembliesId = SolutionExpansionIdService.generateDependencyCategoryId(testProjectPath, 'assemblies');

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
            const id = SolutionExpansionIdService.generateDependencyId(
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
            const id = SolutionExpansionIdService.generateDependencyId(
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
            const solutionId = SolutionExpansionIdService.generateSolutionId(testSolutionPath);
            const projectId = SolutionExpansionIdService.generateProjectId(testProjectPath);
            const dependenciesId = SolutionExpansionIdService.generateDependenciesId(testProjectPath);
            const categoryId = SolutionExpansionIdService.generateDependencyCategoryId(testProjectPath, 'packages');
            const dependencyId = SolutionExpansionIdService.generateDependencyId(testProjectPath, 'packages', 'Test');

            expect(SolutionExpansionIdService.getNodeTypeFromId(solutionId)).toBe('solution');
            expect(SolutionExpansionIdService.getNodeTypeFromId(projectId)).toBe('project');
            expect(SolutionExpansionIdService.getNodeTypeFromId(dependenciesId)).toBe('dependencies');
            expect(SolutionExpansionIdService.getNodeTypeFromId(categoryId)).toBe('dependencyCategory');
            expect(SolutionExpansionIdService.getNodeTypeFromId(dependencyId)).toBe('dependency');
        });

        it('should return null for invalid IDs', () => {
            expect(SolutionExpansionIdService.getNodeTypeFromId('invalid-id')).toBe(null);
            expect(SolutionExpansionIdService.getNodeTypeFromId('')).toBe(null);
        });
    });

    describe('getPathFromId', () => {
        it('should extract path from project ID', () => {
            const projectId = SolutionExpansionIdService.generateProjectId(testProjectPath);
            const extractedPath = SolutionExpansionIdService.getPathFromId(projectId);

            expect(extractedPath).toBe(testProjectPath);
        });

        it('should extract path from solution ID', () => {
            const solutionId = SolutionExpansionIdService.generateSolutionId(testSolutionPath);
            const extractedPath = SolutionExpansionIdService.getPathFromId(solutionId);

            expect(extractedPath).toBe(testSolutionPath);
        });
    });

    describe('getProjectPathFromDependencyId', () => {
        it('should extract project path from dependency category ID', () => {
            const categoryId = SolutionExpansionIdService.generateDependencyCategoryId(testProjectPath, 'packages');
            const extractedPath = SolutionExpansionIdService.getProjectPathFromDependencyId(categoryId);

            expect(extractedPath).toBe(testProjectPath);
        });

        it('should extract project path from dependency ID', () => {
            const dependencyId = SolutionExpansionIdService.generateDependencyId(testProjectPath, 'packages', 'Test');
            const extractedPath = SolutionExpansionIdService.getProjectPathFromDependencyId(dependencyId);

            expect(extractedPath).toBe(testProjectPath);
        });
    });

    describe('nodeIdToPath', () => {
        it('should convert file nodeId to path', () => {
            const filePath = testProjectPath.replace('.csproj', '/Program.cs');
            const fileId = SolutionExpansionIdService.generateFileId(filePath);
            const path = SolutionExpansionIdService.nodeIdToPath(fileId);

            expect(path).toBe(filePath);
        });

        it('should convert folder nodeId to path', () => {
            const folderPath = '/path/to/MyProject/Controllers';
            const folderId = SolutionExpansionIdService.generateFolderId(folderPath, testProjectPath);
            const path = SolutionExpansionIdService.nodeIdToPath(folderId);

            expect(path).toBe(folderPath);
        });

        it('should return null for unsupported node types', () => {
            const dependencyId = SolutionExpansionIdService.generateDependencyId(testProjectPath, 'packages', 'Test');
            const path = SolutionExpansionIdService.nodeIdToPath(dependencyId);

            expect(path).toBe(null);
        });
    });
});