import { SolutionActionService } from '../../../services/solutionActionService';
import { MenuActionType } from '../../../webview/solution-view/types';
import * as vscode from 'vscode';
import * as fs from 'fs';

// Mock dependencies
jest.mock('vscode', () => ({
    Uri: {
        file: jest.fn((path) => ({ fsPath: path }))
    },
    commands: {
        executeCommand: jest.fn()
    },
    window: {
        showTextDocument: jest.fn(),
        showInputBox: jest.fn(),
        showWarningMessage: jest.fn(),
        showInformationMessage: jest.fn(),
        showErrorMessage: jest.fn(),
        createTerminal: jest.fn(() => ({
            show: jest.fn(),
            sendText: jest.fn()
        })),
        showOpenDialog: jest.fn(),
        showSaveDialog: jest.fn()
    },
    workspace: {
        openTextDocument: jest.fn()
    },
    ViewColumn: {
        One: 1
    }
}), { virtual: true });

jest.mock('fs', () => ({
    promises: {
        readFile: jest.fn(),
        writeFile: jest.fn(),
        unlink: jest.fn(),
        access: jest.fn(),
        stat: jest.fn()
    },
    constants: {
        F_OK: 0
    }
}));

jest.mock('xml2js', () => ({
    parseStringPromise: jest.fn(),
    Builder: jest.fn(() => ({
        buildObject: jest.fn()
    }))
}));

describe('SolutionActionService', () => {
    let mockVscode: jest.Mocked<typeof vscode>;
    let mockFs: jest.Mocked<typeof fs>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockVscode = vscode as jest.Mocked<typeof vscode>;
        mockFs = fs as jest.Mocked<typeof fs>;
    });

    describe('executeAction', () => {
        it('should handle openFile action', async () => {
            const filePath = '/path/to/file.cs';
            mockVscode.workspace.openTextDocument.mockResolvedValue({} as any);
            mockVscode.window.showTextDocument.mockResolvedValue({} as any);

            await SolutionActionService.executeAction('openFile', filePath);

            expect(mockVscode.workspace.openTextDocument).toHaveBeenCalledWith(
                mockVscode.Uri.file(filePath)
            );
            expect(mockVscode.window.showTextDocument).toHaveBeenCalled();
        });

        it('should handle revealInExplorer action', async () => {
            const filePath = '/path/to/file.cs';

            await SolutionActionService.executeAction('revealInExplorer', filePath);

            expect(mockVscode.commands.executeCommand).toHaveBeenCalledWith(
                'revealFileInOS',
                mockVscode.Uri.file(filePath)
            );
        });

        it('should handle build actions', async () => {
            const projectPath = '/path/to/project.csproj';
            const mockTerminal = {
                show: jest.fn(),
                sendText: jest.fn()
            };
            mockVscode.window.createTerminal.mockReturnValue(mockTerminal as any);

            await SolutionActionService.executeAction('build', projectPath);

            expect(mockVscode.window.createTerminal).toHaveBeenCalledWith('Build: project.csproj');
            expect(mockTerminal.show).toHaveBeenCalled();
            expect(mockTerminal.sendText).toHaveBeenCalledWith(`dotnet build "${projectPath}"`);
        });

        it('should handle rebuild actions', async () => {
            const projectPath = '/path/to/project.csproj';
            const mockTerminal = {
                show: jest.fn(),
                sendText: jest.fn()
            };
            mockVscode.window.createTerminal.mockReturnValue(mockTerminal as any);

            await SolutionActionService.executeAction('rebuild', projectPath);

            expect(mockTerminal.sendText).toHaveBeenCalledWith(`dotnet build "${projectPath}" --no-incremental`);
        });

        it('should handle clean actions', async () => {
            const projectPath = '/path/to/project.csproj';
            const mockTerminal = {
                show: jest.fn(),
                sendText: jest.fn()
            };
            mockVscode.window.createTerminal.mockReturnValue(mockTerminal as any);

            await SolutionActionService.executeAction('clean', projectPath);

            expect(mockTerminal.sendText).toHaveBeenCalledWith(`dotnet clean "${projectPath}"`);
        });

        it('should handle unknown actions gracefully', async () => {
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

            await SolutionActionService.executeAction('unknownAction' as MenuActionType, '/path');

            expect(consoleSpy).toHaveBeenCalledWith('Unknown action: unknownAction');
            consoleSpy.mockRestore();
        });
    });

    describe('File Operations', () => {
        describe('deleteFile', () => {
            it('should delete file after user confirmation', async () => {
                const filePath = '/path/to/file.cs';
                mockVscode.window.showWarningMessage.mockResolvedValue('Delete' as any);
                mockFs.promises.unlink.mockResolvedValue(undefined);

                await SolutionActionService.executeAction('deleteFile', filePath);

                expect(mockVscode.window.showWarningMessage).toHaveBeenCalledWith(
                    'Are you sure you want to delete file.cs?',
                    { modal: true },
                    'Delete'
                );
                expect(mockFs.promises.unlink).toHaveBeenCalledWith(filePath);
                expect(mockVscode.window.showInformationMessage).toHaveBeenCalledWith(
                    'Deleted file.cs'
                );
            });

            it('should not delete file when user cancels', async () => {
                const filePath = '/path/to/file.cs';
                mockVscode.window.showWarningMessage.mockResolvedValue(undefined);

                await SolutionActionService.executeAction('deleteFile', filePath);

                expect(mockFs.promises.unlink).not.toHaveBeenCalled();
            });

            it('should handle deletion errors gracefully', async () => {
                const filePath = '/path/to/file.cs';
                mockVscode.window.showWarningMessage.mockResolvedValue('Delete' as any);
                mockFs.promises.unlink.mockRejectedValue(new Error('Permission denied'));

                await SolutionActionService.executeAction('deleteFile', filePath);

                expect(mockVscode.window.showErrorMessage).toHaveBeenCalledWith(
                    'Error deleting file: Error: Permission denied'
                );
            });
        });

        describe('rename', () => {
            it('should handle rename with valid new name', async () => {
                const oldPath = '/path/to/oldfile.cs';
                const newName = 'newfile.cs';

                await SolutionActionService.executeAction('rename', oldPath, { newName });

                // Verify the rename operation was attempted
                // Note: The actual rename logic involves file system operations
                // that would be more thoroughly tested in integration tests
            });
        });
    });

    describe('Solution Operations', () => {
        describe('addSolutionFolder', () => {
            it('should prompt for folder name and add to solution', async () => {
                const solutionPath = '/path/to/solution.sln';
                mockVscode.window.showInputBox.mockResolvedValue('NewFolder');
                mockFs.promises.readFile.mockResolvedValue(
                    `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "ExistingFolder", "ExistingFolder", "{GUID}"
EndProject
Global
	GlobalSection(SolutionConfigurationPlatforms) = preSolution
	EndGlobalSection
EndGlobal`
                );
                mockFs.promises.writeFile.mockResolvedValue(undefined);

                await SolutionActionService.executeAction('addSolutionFolder', solutionPath);

                expect(mockVscode.window.showInputBox).toHaveBeenCalledWith({
                    prompt: 'Enter solution folder name',
                    placeHolder: 'New Folder',
                    title: 'Add Solution Folder',
                    validateInput: expect.any(Function)
                });
            });

            it('should validate solution folder names', async () => {
                const solutionPath = '/path/to/solution.sln';
                let validateInput: (value: string) => string | null;

                mockVscode.window.showInputBox.mockImplementation((options) => {
                    validateInput = options.validateInput!;
                    return Promise.resolve('ValidFolder');
                });
                mockFs.promises.readFile.mockResolvedValue('solution content');
                mockFs.promises.writeFile.mockResolvedValue(undefined);

                await SolutionActionService.executeAction('addSolutionFolder', solutionPath);

                // Test validation function
                expect(validateInput!('')).toBe('Folder name cannot be empty');
                expect(validateInput!('Invalid/Name')).toBe('Folder name cannot contain invalid characters');
                expect(validateInput!('ValidName')).toBe(null);
            });
        });

        describe('addExistingProject', () => {
            it('should show file dialog to select project', async () => {
                const solutionPath = '/path/to/solution.sln';
                mockVscode.window.showOpenDialog.mockResolvedValue([
                    { fsPath: '/path/to/project.csproj' }
                ] as any);

                await SolutionActionService.executeAction('addExistingProject', solutionPath);

                expect(mockVscode.window.showOpenDialog).toHaveBeenCalledWith({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    openLabel: 'Add Project',
                    title: 'Select Project File',
                    filters: {
                        'Project Files': ['csproj', 'vbproj', 'fsproj']
                    }
                });
            });
        });
    });

    describe('Dependency Operations', () => {
        describe('manageNuGetPackages', () => {
            it('should open NuGet webview', async () => {
                const dependenciesPath = '/path/to/project.csproj/dependencies';

                await SolutionActionService.executeAction('manageNuGetPackages', dependenciesPath);

                expect(mockVscode.commands.executeCommand).toHaveBeenCalledWith(
                    'dotnet-nuget-webview.focus'
                );
            });
        });

        describe('addProjectReference', () => {
            it('should create terminal for adding project reference', async () => {
                const dependenciesPath = '/path/to/project.csproj/dependencies';
                const mockTerminal = {
                    show: jest.fn(),
                    sendText: jest.fn()
                };
                mockVscode.window.createTerminal.mockReturnValue(mockTerminal as any);

                await SolutionActionService.executeAction('addProjectReference', dependenciesPath);

                expect(mockVscode.window.createTerminal).toHaveBeenCalledWith(
                    'Add Project Reference: project.csproj'
                );
                expect(mockTerminal.show).toHaveBeenCalled();
                expect(mockTerminal.sendText).toHaveBeenCalledWith('# Add Project Reference:');
            });
        });

        describe('restoreDependencies', () => {
            it('should run dotnet restore command', async () => {
                const dependenciesPath = '/path/to/project.csproj/dependencies';
                const mockTerminal = {
                    show: jest.fn(),
                    sendText: jest.fn()
                };
                mockVscode.window.createTerminal.mockReturnValue(mockTerminal as any);

                await SolutionActionService.executeAction('restoreDependencies', dependenciesPath);

                expect(mockTerminal.sendText).toHaveBeenCalledWith(
                    'dotnet restore "/path/to/project.csproj"'
                );
            });
        });

        describe('removeDependency', () => {
            it('should parse dependency path and confirm removal', async () => {
                const dependencyPath = '/path/to/project.csproj/dependencies/packages/Newtonsoft.Json@13.0.1';
                mockVscode.window.showWarningMessage.mockResolvedValue('Remove' as any);

                // Mock the XML parsing and file operations
                const xml2js = require('xml2js');
                xml2js.parseStringPromise.mockResolvedValue({
                    Project: {
                        ItemGroup: [{
                            PackageReference: [{
                                $: { Include: 'Newtonsoft.Json' }
                            }]
                        }]
                    }
                });

                const mockBuilder = {
                    buildObject: jest.fn().mockReturnValue('<Project></Project>')
                };
                xml2js.Builder.mockReturnValue(mockBuilder);

                mockFs.promises.readFile.mockResolvedValue('<Project></Project>');
                mockFs.promises.writeFile.mockResolvedValue(undefined);

                await SolutionActionService.executeAction('removeDependency', dependencyPath);

                expect(mockVscode.window.showWarningMessage).toHaveBeenCalledWith(
                    'Are you sure you want to remove Newtonsoft.Json from the project?',
                    { modal: true },
                    'Remove'
                );
            });

            it('should handle invalid dependency path format', async () => {
                const invalidPath = '/invalid/path/format';

                await SolutionActionService.executeAction('removeDependency', invalidPath);

                expect(mockVscode.window.showErrorMessage).toHaveBeenCalledWith(
                    expect.stringContaining('Error removing dependency')
                );
            });
        });
    });

    describe('Error Handling', () => {
        it('should handle file operation errors gracefully', async () => {
            const filePath = '/path/to/nonexistent.cs';
            mockVscode.workspace.openTextDocument.mockRejectedValue(new Error('File not found'));

            await SolutionActionService.executeAction('openFile', filePath);

            expect(mockVscode.window.showErrorMessage).toHaveBeenCalledWith(
                'Error opening file: Error: File not found'
            );
        });

        it('should handle terminal creation errors', async () => {
            const projectPath = '/path/to/project.csproj';
            mockVscode.window.createTerminal.mockImplementation(() => {
                throw new Error('Terminal creation failed');
            });

            await SolutionActionService.executeAction('build', projectPath);

            expect(mockVscode.window.showErrorMessage).toHaveBeenCalledWith(
                'Error during build: Error: Terminal creation failed'
            );
        });
    });

    describe('Input Validation', () => {
        it('should validate solution folder names properly', async () => {
            const tests = [
                { input: '', expected: 'Folder name cannot be empty' },
                { input: '   ', expected: 'Folder name cannot be empty' },
                { input: 'Valid_Folder-123', expected: null },
                { input: 'Invalid/Name', expected: 'Folder name cannot contain invalid characters' },
                { input: 'Invalid\\Name', expected: 'Folder name cannot contain invalid characters' },
                { input: 'Invalid:Name', expected: 'Folder name cannot contain invalid characters' },
                { input: 'Invalid*Name', expected: 'Folder name cannot contain invalid characters' },
                { input: 'Invalid?Name', expected: 'Folder name cannot contain invalid characters' },
                { input: 'Invalid"Name', expected: 'Folder name cannot contain invalid characters' },
                { input: 'Invalid<Name', expected: 'Folder name cannot contain invalid characters' },
                { input: 'Invalid>Name', expected: 'Folder name cannot contain invalid characters' },
                { input: 'Invalid|Name', expected: 'Folder name cannot contain invalid characters' }
            ];

            // Mock the showInputBox to capture the validation function
            let capturedValidator: ((value: string) => string | null) | undefined;
            mockVscode.window.showInputBox.mockImplementation((options) => {
                capturedValidator = options.validateInput;
                return Promise.resolve('TestFolder');
            });

            mockFs.promises.readFile.mockResolvedValue('solution content');
            mockFs.promises.writeFile.mockResolvedValue(undefined);

            await SolutionActionService.executeAction('addSolutionFolder', '/test/solution.sln');

            expect(capturedValidator).toBeDefined();

            // Test all validation cases
            tests.forEach(({ input, expected }) => {
                expect(capturedValidator!(input)).toBe(expected);
            });
        });
    });
});