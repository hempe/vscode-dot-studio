import { SolutionTreeService } from '../../../services/solutionTreeService';
import { SolutionExpansionIdService } from '../../../services/solutionExpansionIdService';
import { ProjectNode } from '../../../webview/solution-view/types';

// Mock vscode module
jest.mock('vscode', () => ({}), { virtual: true });

describe('SolutionTreeService.mergeTreeStates', () => {
    const testProjectPath = '/path/to/MyProject.csproj';

    describe('Dependency node state merging', () => {
        it('should force refresh expanded packageDependencies nodes', () => {
            const packageCategoryId = SolutionExpansionIdService.generateDependencyCategoryId(testProjectPath, 'packages');

            // Fresh node from server (no children loaded yet)
            const freshNodes: ProjectNode[] = [
                {
                    type: 'packageDependencies',
                    name: 'Packages',
                    path: testProjectPath + '/dependencies/packages',
                    nodeId: packageCategoryId,
                    expanded: false,
                    hasChildren: true
                }
            ];

            // Cached node that was previously expanded with children
            const cachedNodes: ProjectNode[] = [
                {
                    type: 'packageDependencies',
                    name: 'Packages',
                    path: testProjectPath + '/dependencies/packages',
                    nodeId: packageCategoryId,
                    expanded: true,
                    hasChildren: true,
                    isLoaded: true,
                    children: [
                        {
                            type: 'dependency',
                            name: 'Newtonsoft.Json (13.0.1)',
                            path: testProjectPath + '/dependencies/packages/Newtonsoft.Json@13.0.1',
                            nodeId: SolutionExpansionIdService.generateDependencyId(testProjectPath, 'packages', 'Newtonsoft.Json', '13.0.1')
                        }
                    ]
                }
            ];

            SolutionTreeService.mergeTreeStates(freshNodes, cachedNodes);

            const freshNode = freshNodes[0];

            // Should be marked as expanded but force refresh
            expect(freshNode.expanded).toBe(true);
            expect(freshNode.isLoaded).toBe(false);
            expect(freshNode.hasChildren).toBe(true);
            expect(freshNode.children).toBeUndefined(); // Children cleared to force reload
        });

        it('should force refresh expanded projectDependencies nodes', () => {
            const projectCategoryId = SolutionExpansionIdService.generateDependencyCategoryId(testProjectPath, 'projects');

            const freshNodes: ProjectNode[] = [
                {
                    type: 'projectDependencies',
                    name: 'Projects',
                    path: testProjectPath + '/dependencies/projects',
                    nodeId: projectCategoryId,
                    expanded: false,
                    hasChildren: true
                }
            ];

            const cachedNodes: ProjectNode[] = [
                {
                    type: 'projectDependencies',
                    name: 'Projects',
                    path: testProjectPath + '/dependencies/projects',
                    nodeId: projectCategoryId,
                    expanded: true,
                    hasChildren: true,
                    isLoaded: true,
                    children: [
                        {
                            type: 'dependency',
                            name: 'MyOtherProject',
                            path: testProjectPath + '/dependencies/projects/MyOtherProject',
                            nodeId: SolutionExpansionIdService.generateDependencyId(testProjectPath, 'projects', 'MyOtherProject')
                        }
                    ]
                }
            ];

            SolutionTreeService.mergeTreeStates(freshNodes, cachedNodes);

            const freshNode = freshNodes[0];

            expect(freshNode.expanded).toBe(true);
            expect(freshNode.isLoaded).toBe(false);
            expect(freshNode.hasChildren).toBe(true);
            expect(freshNode.children).toBeUndefined();
        });

        it('should force refresh expanded assemblyDependencies nodes', () => {
            const assemblyCategoryId = SolutionExpansionIdService.generateDependencyCategoryId(testProjectPath, 'assemblies');

            const freshNodes: ProjectNode[] = [
                {
                    type: 'assemblyDependencies',
                    name: 'Assemblies',
                    path: testProjectPath + '/dependencies/assemblies',
                    nodeId: assemblyCategoryId,
                    expanded: false,
                    hasChildren: true
                }
            ];

            const cachedNodes: ProjectNode[] = [
                {
                    type: 'assemblyDependencies',
                    name: 'Assemblies',
                    path: testProjectPath + '/dependencies/assemblies',
                    nodeId: assemblyCategoryId,
                    expanded: true,
                    hasChildren: true,
                    isLoaded: true,
                    children: [
                        {
                            type: 'dependency',
                            name: 'System.Data',
                            path: testProjectPath + '/dependencies/assemblies/System.Data',
                            nodeId: SolutionExpansionIdService.generateDependencyId(testProjectPath, 'assemblies', 'System.Data')
                        }
                    ]
                }
            ];

            SolutionTreeService.mergeTreeStates(freshNodes, cachedNodes);

            const freshNode = freshNodes[0];

            expect(freshNode.expanded).toBe(true);
            expect(freshNode.isLoaded).toBe(false);
            expect(freshNode.hasChildren).toBe(true);
            expect(freshNode.children).toBeUndefined();
        });

        it('should NOT merge children for dependency nodes', () => {
            const packageCategoryId = SolutionExpansionIdService.generateDependencyCategoryId(testProjectPath, 'packages');

            // Fresh node that has some children loaded
            const freshNodes: ProjectNode[] = [
                {
                    type: 'packageDependencies',
                    name: 'Packages',
                    path: testProjectPath + '/dependencies/packages',
                    nodeId: packageCategoryId,
                    expanded: false,
                    hasChildren: true,
                    children: [
                        {
                            type: 'dependency',
                            name: 'UpdatedPackage (2.0.0)',
                            path: testProjectPath + '/dependencies/packages/UpdatedPackage@2.0.0',
                            nodeId: SolutionExpansionIdService.generateDependencyId(testProjectPath, 'packages', 'UpdatedPackage', '2.0.0')
                        }
                    ]
                }
            ];

            // Cached node that was expanded with different children
            const cachedNodes: ProjectNode[] = [
                {
                    type: 'packageDependencies',
                    name: 'Packages',
                    path: testProjectPath + '/dependencies/packages',
                    nodeId: packageCategoryId,
                    expanded: true,
                    hasChildren: true,
                    isLoaded: true,
                    children: [
                        {
                            type: 'dependency',
                            name: 'OldPackage (1.0.0)',
                            path: testProjectPath + '/dependencies/packages/OldPackage@1.0.0',
                            nodeId: SolutionExpansionIdService.generateDependencyId(testProjectPath, 'packages', 'OldPackage', '1.0.0')
                        }
                    ]
                }
            ];

            SolutionTreeService.mergeTreeStates(freshNodes, cachedNodes);

            const freshNode = freshNodes[0];

            // Children should be cleared, not merged
            expect(freshNode.children).toBeUndefined();
            expect(freshNode.expanded).toBe(true);
            expect(freshNode.isLoaded).toBe(false);
        });

        it('should preserve normal node children merging for non-dependency nodes', () => {
            const projectId = SolutionExpansionIdService.generateProjectId(testProjectPath);

            const freshNodes: ProjectNode[] = [
                {
                    type: 'project',
                    name: 'MyProject',
                    path: testProjectPath,
                    nodeId: projectId,
                    expanded: false,
                    children: [
                        {
                            type: 'file',
                            name: 'NewFile.cs',
                            path: testProjectPath + '/NewFile.cs',
                            nodeId: SolutionExpansionIdService.generateFileId(testProjectPath + '/NewFile.cs')
                        }
                    ]
                }
            ];

            const cachedNodes: ProjectNode[] = [
                {
                    type: 'project',
                    name: 'MyProject',
                    path: testProjectPath,
                    nodeId: projectId,
                    expanded: true,
                    children: [
                        {
                            type: 'file',
                            name: 'OldFile.cs',
                            path: testProjectPath + '/OldFile.cs',
                            nodeId: SolutionExpansionIdService.generateFileId(testProjectPath + '/OldFile.cs')
                        }
                    ]
                }
            ];

            SolutionTreeService.mergeTreeStates(freshNodes, cachedNodes);

            const freshNode = freshNodes[0];

            // For non-dependency nodes, children should be preserved and expansion state merged
            expect(freshNode.expanded).toBe(true);
            expect(freshNode.children).toBeDefined();
            expect(freshNode.children?.length).toBe(1);
            expect(freshNode.children?.[0].name).toBe('NewFile.cs'); // Fresh children preserved
        });
    });

    describe('Edge cases', () => {
        it('should handle nodes with same nodeId but different types', () => {
            // This shouldn't happen in practice, but tests robustness
            const nodeId = 'test-id';

            const freshNodes: ProjectNode[] = [
                {
                    type: 'packageDependencies',
                    name: 'Packages',
                    path: testProjectPath + '/dependencies/packages',
                    nodeId: nodeId,
                    expanded: false
                }
            ];

            const cachedNodes: ProjectNode[] = [
                {
                    type: 'file', // Different type
                    name: 'SomeFile.cs',
                    path: testProjectPath + '/SomeFile.cs',
                    nodeId: nodeId,
                    expanded: true
                }
            ];

            SolutionTreeService.mergeTreeStates(freshNodes, cachedNodes);

            const freshNode = freshNodes[0];

            // Should still apply dependency node logic since fresh node is dependency type
            expect(freshNode.expanded).toBe(true);
            expect(freshNode.isLoaded).toBe(false);
        });

        it('should handle empty cached nodes', () => {
            const packageCategoryId = SolutionExpansionIdService.generateDependencyCategoryId(testProjectPath, 'packages');

            const freshNodes: ProjectNode[] = [
                {
                    type: 'packageDependencies',
                    name: 'Packages',
                    path: testProjectPath + '/dependencies/packages',
                    nodeId: packageCategoryId,
                    expanded: false
                }
            ];

            SolutionTreeService.mergeTreeStates(freshNodes, []);

            const freshNode = freshNodes[0];

            // Should remain unchanged
            expect(freshNode.expanded).toBe(false);
        });
    });
});