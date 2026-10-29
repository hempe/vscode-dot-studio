import { SolutionDiscovery } from '../../../services/solutionDiscovery';
import * as vscode from 'vscode';

// Mock dependencies
jest.mock('vscode', () => ({
    window: {
        showQuickPick: jest.fn(),
        showInformationMessage: jest.fn(),
        showInputBox: jest.fn(),
        showErrorMessage: jest.fn()
    },
    commands: { executeCommand: jest.fn() }
}), { virtual: true });

describe('SolutionDiscovery', () => {
    let mockVscode: jest.Mocked<typeof vscode>;

    beforeEach(() => {
        jest.clearAllMocks();
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

    describe('offerSolution (no solution found)', () => {
        it('offers to open a solution or create a new project', async () => {
            (mockVscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Create New Project...');

            expect(await SolutionDiscovery.offerSolution()).toBeNull();

            expect(mockVscode.window.showInformationMessage).toHaveBeenCalledWith(
                expect.stringContaining('No solution found'), 'Open Solution...', 'Create New Project...');
            expect(mockVscode.commands.executeCommand).toHaveBeenCalledWith('shinobi.solution.new');
        });

        it('does nothing when dismissed', async () => {
            (mockVscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined);
            await SolutionDiscovery.offerSolution();
            expect(mockVscode.commands.executeCommand).not.toHaveBeenCalled();
        });
    });
});