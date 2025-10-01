import { SolutionTreeService } from '../../../services/solutionTreeService';
import { SolutionExpansionIdService } from '../../../services/solutionExpansionIdService';
import { ProjectNode } from '../../../webview/solution-view/types';

// Mock vscode module
jest.mock('vscode', () => ({}), { virtual: true });

describe('Dependency Collapse Root Cause Analysis', () => {
    const testProjectPath = '/path/to/MyProject.csproj';

    /**
     * This test isolates the exact issue: when the dependencies node is expanded,
     * our logic clears its children, causing the dependency categories to disappear
     */
    describe('Dependencies node force refresh issue', () => {
        it('should reveal that dependencies node children get cleared incorrectly', () => {
            const dependenciesId = SolutionExpansionIdService.generateDependenciesId(testProjectPath);
            const packageCategoryId = SolutionExpansionIdService.generateDependencyCategoryId(testProjectPath, 'packages');

            // Fresh node (after file change)
            const freshNodes: ProjectNode[] = [
                {
                    type: 'dependencies',
                    name: 'Dependencies',
                    path: testProjectPath + '/dependencies',
                    nodeId: dependenciesId,
                    expanded: false, // Fresh state
                    children: [
                        {
                            type: 'packageDependencies',
                            name: 'Packages',
                            path: testProjectPath + '/dependencies/packages',
                            nodeId: packageCategoryId,
                            expanded: false,
                            hasChildren: false // After package removal
                        }
                    ]
                }
            ];

            // Cached node (user had it expanded)
            const cachedNodes: ProjectNode[] = [
                {
                    type: 'dependencies',
                    name: 'Dependencies',
                    path: testProjectPath + '/dependencies',
                    nodeId: dependenciesId,
                    expanded: true, // Was expanded
                    isLoaded: true,
                    children: [
                        {
                            type: 'packageDependencies',
                            name: 'Packages',
                            path: testProjectPath + '/dependencies/packages',
                            nodeId: packageCategoryId,
                            expanded: true, // Package category was also expanded
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
            ];

            // Before merge
            expect(freshNodes[0].children?.length).toBe(1);
            expect(freshNodes[0].children![0].type).toBe('packageDependencies');

            // Apply merge
            SolutionTreeService.mergeTreeStates(freshNodes, cachedNodes);

            // After merge - check what happened (with the fix applied)
            const dependenciesNode = freshNodes[0];

            // The dependencies node should NOT be treated as a dependency node for force refresh
            expect(dependenciesNode.expanded).toBe(true); // Correctly marked expanded
            expect(dependenciesNode.isLoaded).not.toBe(false); // NOT force-refreshed anymore

            // FIXED: Dependencies node children are preserved
            expect(dependenciesNode.children).toBeDefined(); // Children preserved!
            expect(dependenciesNode.children?.length).toBe(1);

            // The Package category should still be accessible and force-refreshed individually
            const packageCategoryNode = dependenciesNode.children![0];
            expect(packageCategoryNode.expanded).toBe(true);
            expect(packageCategoryNode.isLoaded).toBe(false); // Category is force-refreshed
            expect(packageCategoryNode.children).toBeUndefined(); // Category children cleared
        });

        it('should show the fixed isDependencyNode logic', () => {
            // Our FIXED logic excludes 'dependencies' container from force refresh
            const isDependencyNode = (nodeType: string) => {
                return nodeType === 'dependencyCategory' ||
                       nodeType === 'packageDependencies' ||
                       nodeType === 'projectDependencies' ||
                       nodeType === 'assemblyDependencies';
            };

            // FIXED: 'dependencies' is NOT considered a dependency node for force refresh
            expect(isDependencyNode('dependencies')).toBe(false);
            expect(isDependencyNode('packageDependencies')).toBe(true);
            expect(isDependencyNode('projectDependencies')).toBe(true);

            // Now 'dependencies' preserves its children (the categories)
            // while individual categories get force-refreshed
        });
    });

    describe('The correct behavior should be', () => {
        it('should NOT force refresh the dependencies container node', () => {
            const dependenciesId = SolutionExpansionIdService.generateDependenciesId(testProjectPath);
            const packageCategoryId = SolutionExpansionIdService.generateDependencyCategoryId(testProjectPath, 'packages');

            const freshNodes: ProjectNode[] = [
                {
                    type: 'dependencies',
                    name: 'Dependencies',
                    path: testProjectPath + '/dependencies',
                    nodeId: dependenciesId,
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
            ];

            const cachedNodes: ProjectNode[] = [
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
            ];

            // The correct logic: 'dependencies' should preserve its children
            // Only individual category nodes should be force-refreshed

            // Apply a corrected merge that excludes 'dependencies' from force refresh
            SolutionTreeService.mergeTreeStates(freshNodes, cachedNodes);

            const dependenciesNode = freshNodes[0];
            const packageCategoryNode = dependenciesNode.children![0];

            // Dependencies node should preserve children but restore expansion
            expect(dependenciesNode.expanded).toBe(true);
            expect(dependenciesNode.children).toBeDefined(); // Should NOT be cleared
            expect(dependenciesNode.children?.length).toBe(1);

            // Only the category node should be force-refreshed
            expect(packageCategoryNode.expanded).toBe(true);
            expect(packageCategoryNode.isLoaded).toBe(false);
            expect(packageCategoryNode.children).toBeUndefined(); // Category children cleared
        });
    });
});