import { SolutionDiscovery } from '../../../services/solutionDiscovery';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

// Mock dependencies
jest.mock('vscode', () => ({
    window: {
        showQuickPick: jest.fn(),
        showInformationMessage: jest.fn(),
        showInputBox: jest.fn(),
        showErrorMessage: jest.fn()
    }
}), { virtual: true });

jest.mock('fs', () => ({
    promises: {
        readdir: jest.fn(),
        writeFile: jest.fn()
    }
}));

jest.mock('crypto', () => ({
    randomUUID: jest.fn(() => '12345678-1234-1234-1234-123456789012')
}));

describe('SolutionDiscovery', () => {
    const mockWorkspaceRoot = '/workspace/root';
    let mockFs: jest.Mocked<typeof fs>;
    let mockVscode: jest.Mocked<typeof vscode>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockFs = fs as jest.Mocked<typeof fs>;
        mockVscode = vscode as jest.Mocked<typeof vscode>;
    });

    // discoverSolutions: solutionDiscovery.find.test.ts (real folders)

    describe('selectSolution', () => {
        it('should show quick pick with solution options', async () => {
            const availableSolutions = [
                '/workspace/Solution1.sln',
                '/workspace/subfolder/Solution2.sln',
                '/workspace/MyApp.sln'
            ];

            const expectedItems = [
                {
                    label: 'Solution1.sln',
                    description: '/workspace',
                    solutionPath: '/workspace/Solution1.sln'
                },
                {
                    label: 'Solution2.sln',
                    description: '/workspace/subfolder',
                    solutionPath: '/workspace/subfolder/Solution2.sln'
                },
                {
                    label: 'MyApp.sln',
                    description: '/workspace',
                    solutionPath: '/workspace/MyApp.sln'
                }
            ];

            (mockVscode.window.showQuickPick as jest.Mock).mockResolvedValue(expectedItems[1]);

            const result = await SolutionDiscovery.selectSolution(availableSolutions);

            expect(mockVscode.window.showQuickPick).toHaveBeenCalledWith(
                expectedItems,
                {
                    placeHolder: 'Select a solution to open',
                    title: 'Multiple Solution Files Found'
                }
            );
            expect(result).toBe('/workspace/subfolder/Solution2.sln');
        });

        it('should return null when user cancels selection', async () => {
            const availableSolutions = ['/workspace/Solution1.sln'];
            (mockVscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

            const result = await SolutionDiscovery.selectSolution(availableSolutions);

            expect(result).toBe(null);
        });

        it('should handle empty solutions array', async () => {
            (mockVscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);

            const result = await SolutionDiscovery.selectSolution([]);

            expect(mockVscode.window.showQuickPick).toHaveBeenCalledWith(
                [],
                expect.any(Object)
            );
            expect(result).toBe(null);
        });
    });

    describe('promptCreateSolution', () => {
        it('should create solution when user confirms and provides valid name', async () => {
            (mockVscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Create Solution');
            (mockVscode.window.showInputBox as jest.Mock).mockResolvedValue('MyNewSolution');
            (mockFs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

            const result = await SolutionDiscovery.promptCreateSolution(mockWorkspaceRoot);

            expect(mockVscode.window.showInformationMessage).toHaveBeenCalledWith(
                'No solution file found in the workspace. Would you like to create one?',
                'Create Solution',
                'Skip'
            );
            expect(mockVscode.window.showInputBox).toHaveBeenCalledWith({
                prompt: 'Enter solution name',
                placeHolder: 'MySolution',
                title: 'Create New Solution',
                validateInput: expect.any(Function)
            });
            expect(result).toBe(path.join(mockWorkspaceRoot, 'MyNewSolution.sln'));
        });

        it('should return null when user chooses to skip', async () => {
            (mockVscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Skip');

            const result = await SolutionDiscovery.promptCreateSolution(mockWorkspaceRoot);

            expect(result).toBe(null);
            expect(mockVscode.window.showInputBox).not.toHaveBeenCalled();
        });

        it('should return null when user cancels information dialog', async () => {
            (mockVscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);

            const result = await SolutionDiscovery.promptCreateSolution(mockWorkspaceRoot);

            expect(result).toBe(null);
            expect(mockVscode.window.showInputBox).not.toHaveBeenCalled();
        });

        it('should return null when user cancels input dialog', async () => {
            (mockVscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Create Solution');
            (mockVscode.window.showInputBox as jest.Mock).mockResolvedValue(undefined);

            const result = await SolutionDiscovery.promptCreateSolution(mockWorkspaceRoot);

            expect(result).toBe(null);
        });

        it('should handle file creation errors gracefully', async () => {
            (mockVscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Create Solution');
            (mockVscode.window.showInputBox as jest.Mock).mockResolvedValue('ValidName');
            (mockFs.promises.writeFile as jest.Mock).mockRejectedValue(new Error('Permission denied'));

            const result = await SolutionDiscovery.promptCreateSolution(mockWorkspaceRoot);

            expect(mockVscode.window.showErrorMessage).toHaveBeenCalledWith(
                'Failed to create solution: Error: Permission denied'
            );
            expect(result).toBe(null);
        });

        describe('solution name validation', () => {
            let validateInput: (value: string) => string | null;

            beforeEach(async () => {
                (mockVscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Create Solution');
                (mockVscode.window.showInputBox as jest.Mock).mockImplementation((options) => {
                    validateInput = options.validateInput!;
                    return Promise.resolve('ValidName');
                });

                await SolutionDiscovery.promptCreateSolution(mockWorkspaceRoot);
            });

            it('should reject empty names', () => {
                expect(validateInput('')).toBe('Solution name cannot be empty');
                expect(validateInput('   ')).toBe('Solution name cannot be empty');
            });

            it('should reject names that don\'t start with a letter', () => {
                expect(validateInput('123Solution')).toBe('Solution name must start with a letter and contain only letters, numbers, dots, hyphens, and underscores');
                expect(validateInput('-Solution')).toBe('Solution name must start with a letter and contain only letters, numbers, dots, hyphens, and underscores');
                expect(validateInput('.Solution')).toBe('Solution name must start with a letter and contain only letters, numbers, dots, hyphens, and underscores');
            });

            it('should reject names with invalid characters', () => {
                expect(validateInput('My Solution')).toBe('Solution name must start with a letter and contain only letters, numbers, dots, hyphens, and underscores'); // space
                expect(validateInput('MySolution!')).toBe('Solution name must start with a letter and contain only letters, numbers, dots, hyphens, and underscores'); // !
                expect(validateInput('My/Solution')).toBe('Solution name must start with a letter and contain only letters, numbers, dots, hyphens, and underscores'); // /
            });

            it('should accept valid names', () => {
                expect(validateInput('MySolution')).toBe(null);
                expect(validateInput('My.Solution')).toBe(null);
                expect(validateInput('My-Solution')).toBe(null);
                expect(validateInput('My_Solution')).toBe(null);
                expect(validateInput('MySolution123')).toBe(null);
                expect(validateInput('M')).toBe(null); // Single letter
                expect(validateInput('My.Complex-Solution_123')).toBe(null);
            });
        });
    });
});