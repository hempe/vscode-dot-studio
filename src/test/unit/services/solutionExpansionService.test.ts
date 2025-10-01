import { SolutionExpansionService } from '../../../services/solutionExpansionService';
import { SolutionExpansionIdService } from '../../../services/solutionExpansionIdService';
import { ProjectNode } from '../../../webview/solution-view/types';

// Mock vscode module
jest.mock('vscode', () => ({}), { virtual: true });

describe('SolutionExpansionService', () => {
    let mockContext: any;
    const testProjectPath = '/path/to/MyProject.csproj';
    const testSolutionPath = '/path/to/MySolution.sln';

    beforeEach(() => {
        mockContext = {
            workspaceState: {
                get: jest.fn(),
                update: jest.fn()
            }
        } as any;
    });

    describe('getExpandedNodePaths', () => {
        it('should collect expanded node IDs from tree', () => {
            const solutionId = SolutionExpansionIdService.generateSolutionId(testSolutionPath);
            const projectId = SolutionExpansionIdService.generateProjectId(testProjectPath);
            const dependenciesId = SolutionExpansionIdService.generateDependenciesId(testProjectPath);

            const nodes: ProjectNode[] = [
                {
                    type: 'solution',
                    name: 'MySolution',
                    path: testSolutionPath,
                    nodeId: solutionId,
                    expanded: true,
                    children: [
                        {
                            type: 'project',
                            name: 'MyProject',
                            path: testProjectPath,
                            nodeId: projectId,
                            expanded: true,
                            children: [
                                {
                                    type: 'dependencies',
                                    name: 'Dependencies',
                                    path: testProjectPath + '/dependencies',
                                    nodeId: dependenciesId,
                                    expanded: false // Not expanded
                                }
                            ]
                        }
                    ]
                }
            ];

            const expandedPaths = SolutionExpansionService.getExpandedNodePaths(nodes);

            expect(expandedPaths).toContain(solutionId);
            expect(expandedPaths).toContain(projectId);
            expect(expandedPaths).not.toContain(dependenciesId); // Not expanded
        });

        it('should log solution node state correctly', () => {
            const solutionId = SolutionExpansionIdService.generateSolutionId(testSolutionPath);

            const expandedSolution: ProjectNode[] = [
                {
                    type: 'solution',
                    name: 'MySolution',
                    path: testSolutionPath,
                    nodeId: solutionId,
                    expanded: true
                }
            ];

            const collapsedSolution: ProjectNode[] = [
                {
                    type: 'solution',
                    name: 'MySolution',
                    path: testSolutionPath,
                    nodeId: solutionId,
                    expanded: false
                }
            ];

            const expandedPaths1 = SolutionExpansionService.getExpandedNodePaths(expandedSolution);
            const expandedPaths2 = SolutionExpansionService.getExpandedNodePaths(collapsedSolution);

            expect(expandedPaths1).toContain(solutionId);
            expect(expandedPaths2).not.toContain(solutionId);
        });
    });

    describe('saveExpansionState', () => {
        it('should save expansion state to workspace storage', () => {
            const expandedPaths = [
                SolutionExpansionIdService.generateSolutionId(testSolutionPath),
                SolutionExpansionIdService.generateProjectId(testProjectPath)
            ];

            SolutionExpansionService.saveExpansionState(expandedPaths, mockContext);

            expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
                'solutionTreeExpanded',
                expandedPaths
            );
        });

        it('should handle empty expansion state', () => {
            SolutionExpansionService.saveExpansionState([], mockContext);

            expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
                'solutionTreeExpanded',
                []
            );
        });
    });

    describe('getExpansionState', () => {
        it('should retrieve expansion state from workspace storage', () => {
            const savedPaths = [
                SolutionExpansionIdService.generateSolutionId(testSolutionPath),
                SolutionExpansionIdService.generateProjectId(testProjectPath)
            ];

            (mockContext.workspaceState.get as jest.Mock).mockReturnValue(savedPaths);

            const retrievedPaths = SolutionExpansionService.getExpansionState(mockContext);

            expect(mockContext.workspaceState.get).toHaveBeenCalledWith('solutionTreeExpanded', []);
            expect(retrievedPaths).toEqual(savedPaths);
        });

        it('should return empty array if no saved state', () => {
            (mockContext.workspaceState.get as jest.Mock).mockReturnValue([]);

            const retrievedPaths = SolutionExpansionService.getExpansionState(mockContext);

            expect(retrievedPaths).toEqual([]);
        });
    });

    describe('Dependency category expansion state preservation', () => {
        it('should preserve expansion state for packageDependencies nodes', () => {
            const packageCategoryId = SolutionExpansionIdService.generateDependencyCategoryId(testProjectPath, 'packages');

            const nodes: ProjectNode[] = [
                {
                    type: 'packageDependencies',
                    name: 'Packages',
                    path: testProjectPath + '/dependencies/packages',
                    nodeId: packageCategoryId,
                    expanded: true,
                    hasChildren: true,
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

            const expandedPaths = SolutionExpansionService.getExpandedNodePaths(nodes);

            expect(expandedPaths).toContain(packageCategoryId);
        });

        it('should preserve expansion state for projectDependencies nodes', () => {
            const projectCategoryId = SolutionExpansionIdService.generateDependencyCategoryId(testProjectPath, 'projects');

            const nodes: ProjectNode[] = [
                {
                    type: 'projectDependencies',
                    name: 'Projects',
                    path: testProjectPath + '/dependencies/projects',
                    nodeId: projectCategoryId,
                    expanded: true,
                    hasChildren: true,
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

            const expandedPaths = SolutionExpansionService.getExpandedNodePaths(nodes);

            expect(expandedPaths).toContain(projectCategoryId);
        });

        it('should preserve expansion state for assemblyDependencies nodes', () => {
            const assemblyCategoryId = SolutionExpansionIdService.generateDependencyCategoryId(testProjectPath, 'assemblies');

            const nodes: ProjectNode[] = [
                {
                    type: 'assemblyDependencies',
                    name: 'Assemblies',
                    path: testProjectPath + '/dependencies/assemblies',
                    nodeId: assemblyCategoryId,
                    expanded: true,
                    hasChildren: true,
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

            const expandedPaths = SolutionExpansionService.getExpandedNodePaths(nodes);

            expect(expandedPaths).toContain(assemblyCategoryId);
        });
    });

    describe('Expansion state edge cases', () => {
        it('should handle nodes without nodeId gracefully', () => {
            const nodes: ProjectNode[] = [
                {
                    type: 'solution',
                    name: 'MySolution',
                    path: testSolutionPath,
                    nodeId: '', // Empty nodeId
                    expanded: true
                }
            ];

            const expandedPaths = SolutionExpansionService.getExpandedNodePaths(nodes);

            // Should still try to save something (path as fallback)
            expect(expandedPaths.length).toBeGreaterThan(0);
        });

        it('should handle deeply nested expansion correctly', () => {
            const solutionId = SolutionExpansionIdService.generateSolutionId(testSolutionPath);
            const projectId = SolutionExpansionIdService.generateProjectId(testProjectPath);
            const dependenciesId = SolutionExpansionIdService.generateDependenciesId(testProjectPath);
            const packageCategoryId = SolutionExpansionIdService.generateDependencyCategoryId(testProjectPath, 'packages');

            const nodes: ProjectNode[] = [
                {
                    type: 'solution',
                    name: 'MySolution',
                    path: testSolutionPath,
                    nodeId: solutionId,
                    expanded: true,
                    children: [
                        {
                            type: 'project',
                            name: 'MyProject',
                            path: testProjectPath,
                            nodeId: projectId,
                            expanded: true,
                            children: [
                                {
                                    type: 'dependencies',
                                    name: 'Dependencies',
                                    path: testProjectPath + '/dependencies',
                                    nodeId: dependenciesId,
                                    expanded: true,
                                    children: [
                                        {
                                            type: 'packageDependencies',
                                            name: 'Packages',
                                            path: testProjectPath + '/dependencies/packages',
                                            nodeId: packageCategoryId,
                                            expanded: true
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ];

            const expandedPaths = SolutionExpansionService.getExpandedNodePaths(nodes);

            expect(expandedPaths).toContain(solutionId);
            expect(expandedPaths).toContain(projectId);
            expect(expandedPaths).toContain(dependenciesId);
            expect(expandedPaths).toContain(packageCategoryId);
        });
    });
});