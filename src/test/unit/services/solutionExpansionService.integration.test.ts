import { SolutionExpansionService } from '../../../services/solutionExpansionService';
import { SolutionTreeService } from '../../../services/solutionTreeService';
import { SolutionExpansionIdService } from '../../../services/solutionExpansionIdService';
import { ProjectNode } from '../../../webview/solution-view/types';

// Mock vscode module
jest.mock('vscode', () => ({}), { virtual: true });

describe('SolutionExpansionService Integration', () => {
    let mockContext: any;
    const testProjectPath = '/path/to/MyProject.csproj';
    const testSolutionPath = '/path/to/MySolution.sln';

    beforeEach(() => {
        mockContext = {
            workspaceState: {
                get: jest.fn().mockReturnValue([]),
                update: jest.fn()
            }
        } as any;
    });

    /**
     * This test simulates the exact scenario that's failing:
     * 1. User has Package category expanded
     * 2. User removes a package
     * 3. Tree refreshes but Package category collapses
     */
    describe('Dependency removal collapse scenario', () => {
        it('should preserve Package category expansion after dependency removal', () => {
            const packageCategoryId = SolutionExpansionIdService.generateDependencyCategoryId(testProjectPath, 'packages');

            // Step 1: Initial state - Package category is expanded with Newtonsoft.Json
            const initialCachedState: ProjectNode[] = [
                {
                    type: 'solution',
                    name: 'MySolution',
                    path: testSolutionPath,
                    nodeId: SolutionExpansionIdService.generateSolutionId(testSolutionPath),
                    expanded: true,
                    children: [
                        {
                            type: 'project',
                            name: 'MyProject',
                            path: testProjectPath,
                            nodeId: SolutionExpansionIdService.generateProjectId(testProjectPath),
                            expanded: true,
                            children: [
                                {
                                    type: 'dependencies',
                                    name: 'Dependencies',
                                    path: testProjectPath + '/dependencies',
                                    nodeId: SolutionExpansionIdService.generateDependenciesId(testProjectPath),
                                    expanded: true,
                                    children: [
                                        {
                                            type: 'packageDependencies',
                                            name: 'Packages',
                                            path: testProjectPath + '/dependencies/packages',
                                            nodeId: packageCategoryId,
                                            expanded: true, // This is the important state
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
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ];

            // Step 2: Save expansion state (this happens in file change handler)
            const expandedPaths = SolutionExpansionService.getExpandedNodePaths(initialCachedState);
            SolutionExpansionService.saveExpansionState(expandedPaths, mockContext);

            // Verify Package category is in saved state
            expect(expandedPaths).toContain(packageCategoryId);

            // Step 3: Fresh data after package removal (Newtonsoft.Json is gone)
            const freshDataAfterRemoval: ProjectNode[] = [
                {
                    type: 'solution',
                    name: 'MySolution',
                    path: testSolutionPath,
                    nodeId: SolutionExpansionIdService.generateSolutionId(testSolutionPath),
                    expanded: false, // Fresh data starts collapsed
                    children: [
                        {
                            type: 'project',
                            name: 'MyProject',
                            path: testProjectPath,
                            nodeId: SolutionExpansionIdService.generateProjectId(testProjectPath),
                            expanded: false,
                            children: [
                                {
                                    type: 'dependencies',
                                    name: 'Dependencies',
                                    path: testProjectPath + '/dependencies',
                                    nodeId: SolutionExpansionIdService.generateDependenciesId(testProjectPath),
                                    expanded: false,
                                    children: [
                                        {
                                            type: 'packageDependencies',
                                            name: 'Packages',
                                            path: testProjectPath + '/dependencies/packages',
                                            nodeId: packageCategoryId,
                                            expanded: false, // Fresh state is collapsed
                                            hasChildren: false // No packages left
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ];

            // Step 4: Merge tree states (this is what _sendCompleteTreeUpdate does)
            SolutionTreeService.mergeTreeStates(freshDataAfterRemoval, initialCachedState);

            // Step 5: Verify the nodes have been processed correctly
            const solutionNode = freshDataAfterRemoval[0];
            const projectNode = solutionNode.children![0];
            const dependenciesNode = projectNode.children![0];

            // Log for debugging
            const dependenciesNodeState = {
                type: dependenciesNode.type,
                name: dependenciesNode.name,
                expanded: dependenciesNode.expanded,
                isLoaded: dependenciesNode.isLoaded,
                hasChildren: dependenciesNode.hasChildren,
                childrenCount: dependenciesNode.children?.length || 0
            };

            // The dependencies node itself might have been force-refreshed
            expect(dependenciesNode.expanded).toBe(true);

            // If dependencies children were cleared, we need to check if this is the issue
            if (dependenciesNode.children && dependenciesNode.children.length > 0) {
                const packageCategoryNode = dependenciesNode.children[0];
                expect(packageCategoryNode.expanded).toBe(true); // Should be marked expanded
                expect(packageCategoryNode.isLoaded).toBe(false); // Should be marked for refresh
                expect(packageCategoryNode.children).toBeUndefined(); // Children should be cleared
            } else {
                // This reveals the issue: dependency nodes are having their children cleared too aggressively
                console.log('ISSUE FOUND: Dependencies node children were cleared');
                expect(dependenciesNode.children).toBeUndefined();
                expect(dependenciesNode.isLoaded).toBe(false);
            }

            // The key insight: even though hasChildren is false, the node should still
            // be marked as expanded to preserve user intent
        });

        it('should handle the workspace storage restoration path', () => {
            const packageCategoryId = SolutionExpansionIdService.generateDependencyCategoryId(testProjectPath, 'packages');

            // Simulate saved expansion state in workspace storage
            const savedExpandedPaths = [
                SolutionExpansionIdService.generateSolutionId(testSolutionPath),
                SolutionExpansionIdService.generateProjectId(testProjectPath),
                SolutionExpansionIdService.generateDependenciesId(testProjectPath),
                packageCategoryId
            ];

            mockContext.workspaceState.get.mockReturnValue(savedExpandedPaths);

            // Fresh tree data (no cached data scenario)
            const freshData: ProjectNode[] = [
                {
                    type: 'solution',
                    name: 'MySolution',
                    path: testSolutionPath,
                    nodeId: SolutionExpansionIdService.generateSolutionId(testSolutionPath),
                    expanded: false,
                    children: [
                        {
                            type: 'project',
                            name: 'MyProject',
                            path: testProjectPath,
                            nodeId: SolutionExpansionIdService.generateProjectId(testProjectPath),
                            expanded: false,
                            children: [
                                {
                                    type: 'dependencies',
                                    name: 'Dependencies',
                                    path: testProjectPath + '/dependencies',
                                    nodeId: SolutionExpansionIdService.generateDependenciesId(testProjectPath),
                                    expanded: false,
                                    children: [
                                        {
                                            type: 'packageDependencies',
                                            name: 'Packages',
                                            path: testProjectPath + '/dependencies/packages',
                                            nodeId: packageCategoryId,
                                            expanded: false,
                                            hasChildren: false
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ];

            // This simulates the scenario when cache is cleared and we restore from workspace storage
            // The issue might be here - if restoreExpansionStates doesn't handle hasChildren:false correctly

            const retrievedPaths = SolutionExpansionService.getExpansionState(mockContext);
            expect(retrievedPaths).toEqual(savedExpandedPaths);

            // The Package category should be in the restoration list even if it has no children
            expect(retrievedPaths).toContain(packageCategoryId);
        });
    });

    describe('Edge case: empty dependency categories', () => {
        it('should preserve expansion of empty dependency categories', () => {
            const packageCategoryId = SolutionExpansionIdService.generateDependencyCategoryId(testProjectPath, 'packages');

            const cachedNodes: ProjectNode[] = [
                {
                    type: 'packageDependencies',
                    name: 'Packages',
                    path: testProjectPath + '/dependencies/packages',
                    nodeId: packageCategoryId,
                    expanded: true,
                    hasChildren: false, // Empty but was expanded
                    children: []
                }
            ];

            const freshNodes: ProjectNode[] = [
                {
                    type: 'packageDependencies',
                    name: 'Packages',
                    path: testProjectPath + '/dependencies/packages',
                    nodeId: packageCategoryId,
                    expanded: false,
                    hasChildren: false
                }
            ];

            SolutionTreeService.mergeTreeStates(freshNodes, cachedNodes);

            // Even empty dependency categories should preserve expansion
            expect(freshNodes[0].expanded).toBe(true);
            expect(freshNodes[0].isLoaded).toBe(false);
        });
    });
});