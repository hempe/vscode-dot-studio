import { SolutionWebviewProvider } from './SolutionWebviewProvider';
import { SolutionService } from '../../services/solutionService';
import { FrameworkDropdownService } from '../../services/frameworkDropdownService';
import { ProjectFileParser } from '../../parsers/projectFileParser';

// Mock VS Code completely
jest.mock('vscode', () => ({
    Uri: {
        file: jest.fn((path) => ({ fsPath: path })),
        joinPath: jest.fn(() => ({ fsPath: '/mock/path' }))
    },
    window: {
        showTextDocument: jest.fn()
    },
    workspace: {
        workspaceFolders: [{ uri: { fsPath: '/test/workspace' } }],
        fs: {
            stat: jest.fn()
        }
    },
    WebviewViewProvider: class {},
    CancellationToken: {}
}), { virtual: true });

jest.mock('../../services/solutionService');
jest.mock('../../services/frameworkDropdownService');
jest.mock('../../parsers/projectFileParser');
jest.mock('../../services/fileNesting', () => ({
    FileNestingService: {
        nestFiles: jest.fn((files) => files) // Return files as-is for testing
    }
}));

describe('SolutionWebviewProvider', () => {
    let provider: SolutionWebviewProvider;
    let mockExtensionUri: any;
    let mockSolutionService: jest.Mocked<SolutionService>;
    let mockFrameworkService: jest.Mocked<FrameworkDropdownService>;

    beforeEach(() => {
        mockExtensionUri = { fsPath: '/mock/extension' };
        const mockContext = {
            workspaceState: {
                get: jest.fn().mockReturnValue([]),
                update: jest.fn().mockResolvedValue(undefined)
            }
        } as any;
        mockSolutionService = {
            findSolutionFile: jest.fn(),
            parseSolutionFile: jest.fn()
        } as any;
        mockFrameworkService = {
            getAvailableFrameworks: jest.fn(),
            getActiveFramework: jest.fn(),
            setActiveFramework: jest.fn()
        } as any;

        // Setup static method mocks
        (SolutionService.findSolutionFile as jest.Mock) = jest.fn();
        (SolutionService.parseSolutionFile as jest.Mock) = jest.fn();

        // Mock ProjectFileParser instance
        jest.mocked(ProjectFileParser).mockImplementation(() => ({
            parseProjectFiles: jest.fn()
        } as any));

        const mockSolutionProvider = {} as any;

        provider = new SolutionWebviewProvider(
            mockExtensionUri,
            mockContext,
            mockSolutionService,
            mockSolutionProvider,
            mockFrameworkService
        );

        jest.clearAllMocks();
    });

    describe('solution data processing', () => {
        it('should convert relative project paths to absolute paths and handle different item types', async () => {
            const mockSolutionData = {
                projects: [
                    {
                        name: 'TestProject',
                        path: 'src/TestProject/TestProject.csproj',
                        typeGuid: '{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}',
                        guid: '{12345678-1234-1234-1234-123456789012}'
                    },
                    {
                        name: 'Solution Items',
                        path: 'Solution Items',
                        typeGuid: '{2150E333-8FDC-42A3-9474-1A3956D46DE8}',
                        guid: '{87654321-4321-4321-4321-210987654321}'
                    }
                ]
            };

            const mockProjectData = {
                files: [
                    { path: '/test/workspace/src/TestProject/Program.cs', isDirectory: false, relativePath: 'Program.cs' },
                    { path: '/test/workspace/src/TestProject/Services/UserService.cs', isDirectory: false, relativePath: 'Services/UserService.cs' },
                    { path: '/test/workspace/src/TestProject/Controllers/HomeController.cs', isDirectory: false, relativePath: 'Controllers/HomeController.cs' },
                    { path: '/test/workspace/src/TestProject/Models/User.cs', isDirectory: false, relativePath: 'Models/User.cs' }
                ],
                directories: new Set(),
                dependencies: []
            };

            (SolutionService.findSolutionFile as jest.Mock).mockResolvedValue('/test/workspace/TestSolution.sln');
            (SolutionService.parseSolutionFile as jest.Mock).mockResolvedValue(mockSolutionData);

            // Mock the parser instance method
            const mockParseProjectFiles = jest.fn().mockResolvedValue(mockProjectData);
            jest.mocked(ProjectFileParser).mockImplementation(() => ({
                parseProjectFiles: mockParseProjectFiles
            } as any));

            // Mock file exists check
            const vscode = require('vscode');
            vscode.workspace.fs.stat.mockResolvedValue({});

            // Call the private method through reflection
            const getSolutionData = (provider as any)._getSolutionData.bind(provider);
            const result = await getSolutionData();

            expect(result).toHaveLength(1); // Should have solution node
            expect(result[0].type).toBe('solution');
            expect(result[0].children).toHaveLength(2); // Should have project node and solution folder

            // Test project node
            const projectNode = result[0].children[0];
            expect(projectNode.type).toBe('project');
            expect(projectNode.name).toBe('TestProject');
            expect(projectNode.path).toBe('/test/workspace/src/TestProject/TestProject.csproj'); // Should be absolute
            expect(projectNode.children.length).toBeGreaterThan(0); // Should have directories and/or files

            // Check that directories are created (Controllers, Models, Services)
            const folderNames = projectNode.children
                .filter((child: any) => child.type === 'folder')
                .map((child: any) => child.name);
            expect(folderNames).toContain('Controllers');
            expect(folderNames).toContain('Models');
            expect(folderNames).toContain('Services');

            // Check that Program.cs is in the root of the project
            const rootFiles = projectNode.children
                .filter((child: any) => child.type === 'file')
                .map((child: any) => child.name);
            expect(rootFiles).toContain('Program.cs');

            // Test solution folder node
            const folderNode = result[0].children[1];
            expect(folderNode.type).toBe('folder');
            expect(folderNode.name).toBe('Solution Items');
            expect(folderNode.path).toBe('/test/workspace/Solution Items'); // Should be absolute
            expect(folderNode.children).toHaveLength(0); // Solution folders don't have source files
        });

        it('should handle projects without source files gracefully', async () => {
            const mockSolutionData = {
                projects: [
                    {
                        name: 'EmptyProject',
                        path: 'EmptyProject/EmptyProject.csproj',
                        typeGuid: '{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}',
                        guid: '{12345678-1234-1234-1234-123456789012}'
                    }
                ]
            };

            const mockProjectData = {
                files: [],
                directories: new Set(),
                dependencies: []
            };

            (SolutionService.findSolutionFile as jest.Mock).mockResolvedValue('/test/workspace/TestSolution.sln');
            (SolutionService.parseSolutionFile as jest.Mock).mockResolvedValue(mockSolutionData);

            // Mock the parser instance method
            const mockParseProjectFiles = jest.fn().mockResolvedValue(mockProjectData);
            jest.mocked(ProjectFileParser).mockImplementation(() => ({
                parseProjectFiles: mockParseProjectFiles
            } as any));

            // Mock file exists check
            const vscode = require('vscode');
            vscode.workspace.fs.stat.mockResolvedValue({});

            const getSolutionData = (provider as any)._getSolutionData.bind(provider);
            const result = await getSolutionData();

            expect(result).toHaveLength(1);
            const projectNode = result[0].children[0];
            expect(projectNode.children).toHaveLength(0); // No source files
        });

        it('should handle file system errors gracefully', async () => {
            const mockSolutionData = {
                projects: [
                    {
                        name: 'TestProject',
                        path: 'TestProject/TestProject.csproj',
                        typeGuid: '{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}',
                        guid: '{12345678-1234-1234-1234-123456789012}'
                    }
                ]
            };

            (SolutionService.findSolutionFile as jest.Mock).mockResolvedValue('/test/workspace/TestSolution.sln');
            (SolutionService.parseSolutionFile as jest.Mock).mockResolvedValue(mockSolutionData);

            // Mock the parser instance method to throw error
            const mockParseProjectFiles = jest.fn().mockRejectedValue(new Error('File not found'));
            jest.mocked(ProjectFileParser).mockImplementation(() => ({
                parseProjectFiles: mockParseProjectFiles
            } as any));

            // Mock file exists check to return true
            const vscode = require('vscode');
            vscode.workspace.fs.stat.mockResolvedValue({});

            const getSolutionData = (provider as any)._getSolutionData.bind(provider);
            const result = await getSolutionData();

            expect(result).toHaveLength(1);
            const projectNode = result[0].children[0];
            expect(projectNode.children).toHaveLength(0); // Should handle error gracefully
        });
    });

    describe('Visual Studio-style sorting', () => {
        it('should sort tree items in Visual Studio order: Dependencies -> Solution Folders -> Folders -> Files', async () => {
            const mockSolutionData = {
                projects: [
                    {
                        name: 'TestProject',
                        path: 'src/TestProject/TestProject.csproj',
                        typeGuid: '{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}',
                        guid: '{12345678-1234-1234-1234-123456789012}',
                        dependencies: [
                            { name: 'System.Text.Json', version: '6.0.0' }
                        ]
                    }
                ]
            };

            const mockProjectData = {
                files: [
                    { path: '/test/workspace/src/TestProject/Program.cs', isDirectory: false, relativePath: 'Program.cs' },
                    { path: '/test/workspace/src/TestProject/Properties/AssemblyInfo.cs', isDirectory: false, relativePath: 'Properties/AssemblyInfo.cs' }
                ],
                directories: new Set(),
                dependencies: [
                    { name: 'System.Text.Json', version: '6.0.0' }
                ]
            };

            (SolutionService.findSolutionFile as jest.Mock).mockResolvedValue('/test/workspace/TestSolution.sln');
            (SolutionService.parseSolutionFile as jest.Mock).mockResolvedValue(mockSolutionData);

            const mockParseProjectFiles = jest.fn().mockResolvedValue(mockProjectData);
            jest.mocked(ProjectFileParser).mockImplementation(() => ({
                parseProjectFiles: mockParseProjectFiles
            } as any));

            const vscode = require('vscode');
            vscode.workspace.fs.stat.mockResolvedValue({});

            const getSolutionData = (provider as any)._getSolutionData.bind(provider);
            const result = await getSolutionData();

            expect(result).toHaveLength(1);
            const solutionNode = result[0];

            // Find the project node (should have children including Dependencies)
            const projectNode = solutionNode.children.find((child: any) => child.name === 'TestProject');
            expect(projectNode).toBeDefined();

            // Should have Dependencies folder since we provided dependencies
            expect(projectNode.children.some((child: any) => child.name === 'Dependencies')).toBe(true);

            // Get the child names in order
            const childNames = projectNode.children.map((child: any) => child.name);

            // Dependencies should come first if it exists
            const dependenciesIndex = childNames.indexOf('Dependencies');
            if (dependenciesIndex >= 0) {
                expect(dependenciesIndex).toBe(0); // Dependencies first when present
            }

            // Test that folders come before files in general
            const folderIndices = projectNode.children
                .map((child: any, index: number) => child.type === 'folder' ? index : -1)
                .filter((index: number) => index >= 0);

            const fileIndices = projectNode.children
                .map((child: any, index: number) => child.type === 'file' ? index : -1)
                .filter((index: number) => index >= 0);

            if (folderIndices.length > 0 && fileIndices.length > 0) {
                const maxFolderIndex = Math.max(...folderIndices);
                const minFileIndex = Math.min(...fileIndices);
                expect(maxFolderIndex).toBeLessThan(minFileIndex); // All folders before all files
            }
        });

        it('should sort solution folders before regular projects', async () => {
            const mockSolutionData = {
                projects: [
                    {
                        name: 'RegularProject',
                        path: 'src/RegularProject/RegularProject.csproj',
                        typeGuid: '{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}',
                        guid: '{12345678-1234-1234-1234-123456789012}'
                    },
                    {
                        name: 'Solution Items',
                        path: 'Solution Items',
                        typeGuid: '{2150E333-8FDC-42A3-9474-1A3956D46DE8}',
                        guid: '{87654321-4321-4321-4321-210987654321}'
                    },
                    {
                        name: 'Another Solution Folder',
                        path: 'Another Solution Folder',
                        typeGuid: '{2150E333-8FDC-42A3-9474-1A3956D46DE8}',
                        guid: '{11111111-1111-1111-1111-111111111111}'
                    }
                ]
            };

            const mockProjectData = {
                files: [],
                directories: new Set(),
                dependencies: []
            };

            (SolutionService.findSolutionFile as jest.Mock).mockResolvedValue('/test/workspace/TestSolution.sln');
            (SolutionService.parseSolutionFile as jest.Mock).mockResolvedValue(mockSolutionData);

            const mockParseProjectFiles = jest.fn().mockResolvedValue(mockProjectData);
            jest.mocked(ProjectFileParser).mockImplementation(() => ({
                parseProjectFiles: mockParseProjectFiles
            } as any));

            const vscode = require('vscode');
            vscode.workspace.fs.stat.mockResolvedValue({});

            const getSolutionData = (provider as any)._getSolutionData.bind(provider);
            const result = await getSolutionData();

            expect(result).toHaveLength(1);
            const solutionNode = result[0];

            // Verify we have all expected children
            expect(solutionNode.children).toHaveLength(3);

            const childNames = solutionNode.children.map((child: any) => child.name);

            // Solution folders should come before regular projects
            const solutionItemsIndex = childNames.indexOf('Solution Items');
            const anotherFolderIndex = childNames.indexOf('Another Solution Folder');
            const projectIndex = childNames.indexOf('RegularProject');

            // All should be found
            expect(solutionItemsIndex).toBeGreaterThanOrEqual(0);
            expect(anotherFolderIndex).toBeGreaterThanOrEqual(0);
            expect(projectIndex).toBeGreaterThanOrEqual(0);

            // Solution folders should come before regular projects
            expect(solutionItemsIndex).toBeLessThan(projectIndex);
            expect(anotherFolderIndex).toBeLessThan(projectIndex);

            // Solution folders should be sorted alphabetically among themselves
            expect(anotherFolderIndex).toBeLessThan(solutionItemsIndex); // "Another" comes before "Solution"
        });

        it('should identify solution folders correctly using isSolutionFolder flag', async () => {
            const mockSolutionData = {
                projects: [
                    {
                        name: 'Solution Items',
                        path: 'Solution Items',
                        typeGuid: '{2150E333-8FDC-42A3-9474-1A3956D46DE8}',
                        guid: '{87654321-4321-4321-4321-210987654321}'
                    },
                    {
                        name: 'TestProject',
                        path: 'src/TestProject/TestProject.csproj',
                        typeGuid: '{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}',
                        guid: '{12345678-1234-1234-1234-123456789012}'
                    }
                ]
            };

            const mockProjectData = {
                files: [],
                directories: new Set(),
                dependencies: []
            };

            (SolutionService.findSolutionFile as jest.Mock).mockResolvedValue('/test/workspace/TestSolution.sln');
            (SolutionService.parseSolutionFile as jest.Mock).mockResolvedValue(mockSolutionData);

            const mockParseProjectFiles = jest.fn().mockResolvedValue(mockProjectData);
            jest.mocked(ProjectFileParser).mockImplementation(() => ({
                parseProjectFiles: mockParseProjectFiles
            } as any));

            const vscode = require('vscode');
            vscode.workspace.fs.stat.mockResolvedValue({});

            const getSolutionData = (provider as any)._getSolutionData.bind(provider);
            const result = await getSolutionData();

            expect(result).toHaveLength(1);
            const solutionNode = result[0];

            const solutionFolder = solutionNode.children.find((child: any) => child.name === 'Solution Items');
            const project = solutionNode.children.find((child: any) => child.name === 'TestProject');

            expect(solutionFolder.isSolutionFolder).toBe(true);
            expect(project.isSolutionFolder).toBe(false);
        });
    });

    describe('refresh', () => {
        it('should call _updateWebview', () => {
            const updateWebviewSpy = jest.spyOn(provider as any, '_updateWebview').mockImplementation();

            provider.refresh();

            expect(updateWebviewSpy).toHaveBeenCalledTimes(1);
        });
    });
});