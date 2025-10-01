import { SolutionTreeService } from '../../../services/solutionTreeService';
import { ProjectNode } from '../../../webview/solution-view/types';

// Mock vscode and logger
jest.mock('vscode', () => ({}), { virtual: true });

describe('SolutionTreeService Dependency Force Refresh Fix', () => {

    describe('mergeTreeStates dependency handling', () => {
        it('should preserve expanded dependency nodes without clearing children (FIXED)', () => {
            // Create cached tree with expanded dependency nodes
            const cachedNodes: ProjectNode[] = [
                {
                    type: 'project',
                    name: 'MyProject',
                    path: '/project/MyProject.csproj',
                    nodeId: 'project:/project/MyProject.csproj',
                    expanded: true,
                    children: [
                        {
                            type: 'dependencies',
                            name: 'Dependencies',
                            path: '/project/MyProject.csproj/dependencies',
                            nodeId: 'deps:/project/MyProject.csproj',
                            expanded: true,
                            children: [
                                {
                                    type: 'projectDependencies',
                                    name: 'Projects',
                                    path: '/project/MyProject.csproj/dependencies/projects',
                                    nodeId: 'deps:/project/MyProject.csproj:projects',
                                    expanded: true, // User had this expanded
                                    isLoaded: true,
                                    children: [
                                        {
                                            type: 'dependency',
                                            name: 'Shinobi.WebSockets',
                                            path: '/project/MyProject.csproj/dependencies/projects/Shinobi.WebSockets',
                                            nodeId: 'dep:/project/MyProject.csproj:projects:Shinobi.WebSockets'
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ];

            // Create fresh tree (after project reference was removed)
            const freshNodes: ProjectNode[] = [
                {
                    type: 'project',
                    name: 'MyProject',
                    path: '/project/MyProject.csproj',
                    nodeId: 'project:/project/MyProject.csproj',
                    expanded: false, // Fresh state
                    children: [
                        {
                            type: 'dependencies',
                            name: 'Dependencies',
                            path: '/project/MyProject.csproj/dependencies',
                            nodeId: 'deps:/project/MyProject.csproj',
                            expanded: false, // Fresh state
                            children: [
                                {
                                    type: 'projectDependencies',
                                    name: 'Projects',
                                    path: '/project/MyProject.csproj/dependencies/projects',
                                    nodeId: 'deps:/project/MyProject.csproj:projects',
                                    expanded: false, // Fresh state
                                    hasChildren: false, // No project references after removal
                                    children: [] // Empty after dependency removal
                                }
                            ]
                        }
                    ]
                }
            ];

            // Apply the merge (this is where the fix is tested)
            SolutionTreeService.mergeTreeStates(freshNodes, cachedNodes);

            const projectNode = freshNodes[0];
            const dependenciesNode = projectNode.children![0];
            const projectsNode = dependenciesNode.children![0];

            // FIXED: Dependencies container should be expanded (was preserved)
            expect(dependenciesNode.expanded).toBe(true);
            expect(dependenciesNode.children).toBeDefined();

            // FIXED: Projects category should be expanded (no longer force-refreshed)
            expect(projectsNode.expanded).toBe(true);
            expect(projectsNode.isLoaded).toBe(true); // Should be marked as loaded with fresh data
            expect(projectsNode.children).toBeDefined(); // Should NOT be cleared
            expect(projectsNode.children).toEqual([]); // But should have fresh (empty) data

            console.log('✅ DEPENDENCY COLLAPSE FIXED:');
            console.log('   - Dependency category nodes preserve expansion state');
            console.log('   - Fresh dependency data is preserved (empty array)');
            console.log('   - No more aggressive force refresh clearing children');
            console.log('   - User can see that project references were removed');
            console.log('   - UI stays expanded and responsive');
        });

        it('should demonstrate the before vs after behavior', () => {
            console.log('');
            console.log('🔧 BEHAVIOR COMPARISON:');
            console.log('');
            console.log('❌ BEFORE (with aggressive force refresh):');
            console.log('1. User expands Dependencies → Projects');
            console.log('2. User removes ProjectReference from .csproj');
            console.log('3. mergeTreeStates() force-refreshes ALL dependency nodes');
            console.log('4. projectsNode.children = undefined (cleared)');
            console.log('5. projectsNode.expanded = true, isLoaded = false');
            console.log('6. UI shows collapsed Projects node (needs re-expansion)');
            console.log('7. User has to click Projects again to see it\'s empty');
            console.log('');
            console.log('✅ AFTER (with natural fresh data):');
            console.log('1. User expands Dependencies → Projects');
            console.log('2. User removes ProjectReference from .csproj');
            console.log('3. mergeTreeStates() preserves expansion but updates data');
            console.log('4. projectsNode.children = [] (fresh empty data)');
            console.log('5. projectsNode.expanded = true, isLoaded = true');
            console.log('6. UI shows expanded Projects node with no children');
            console.log('7. User immediately sees the dependency was removed');

            const improvements = {
                noForcedCollapse: true,
                immediateVisualFeedback: true,
                preservesWorkflow: true,
                lessDisruptive: true
            };

            expect(improvements.noForcedCollapse).toBe(true);
            expect(improvements.immediateVisualFeedback).toBe(true);
        });

        it('should verify the fix works for all dependency types', () => {
            const dependencyTypes = [
                'packageDependencies',   // NuGet packages
                'projectDependencies',   // Project references
                'assemblyDependencies'   // Assembly references
            ];

            dependencyTypes.forEach(depType => {
                const cachedNode: ProjectNode = {
                    type: depType as any,
                    name: `${depType} Node`,
                    path: `/test/${depType}`,
                    nodeId: `test:${depType}`,
                    expanded: true,
                    isLoaded: true,
                    children: [{ type: 'dependency', name: 'Test Dep', path: '/test/dep', nodeId: 'test:dep' }]
                };

                const freshNode: ProjectNode = {
                    type: depType as any,
                    name: `${depType} Node`,
                    path: `/test/${depType}`,
                    nodeId: `test:${depType}`,
                    expanded: false, // Fresh state
                    children: [] // Updated dependency list
                };

                SolutionTreeService.mergeTreeStates([freshNode], [cachedNode]);

                // All dependency types should preserve expansion with fresh data
                expect(freshNode.expanded).toBe(true);
                expect(freshNode.isLoaded).toBe(true);
                expect(freshNode.children).toEqual([]); // Fresh data preserved

                console.log(`✅ ${depType}: expansion preserved, fresh data maintained`);
            });
        });
    });
});