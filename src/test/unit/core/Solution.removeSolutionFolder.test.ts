import { Solution } from '../../../core/Solution';
import * as fs from 'fs';
import * as path from 'path';

// Mock dependencies
jest.mock('vscode', () => ({}), { virtual: true });

jest.mock('uuid', () => ({
    v4: jest.fn(() => '12345678-1234-1234-1234-123456789012')
}));

jest.mock('fs', () => ({
    promises: {
        readFile: jest.fn(),
        writeFile: jest.fn(),
    },
}));

jest.mock('../../../core/logger', () => ({
    logger: jest.fn(() => ({
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn()
    }))
}));

jest.mock('../../../parsers/solutionFileParser');
jest.mock('../../../core/Project');

const mockedFs = fs as jest.Mocked<typeof fs>;

describe('Solution.removeSolutionFolder', () => {
    let solution: Solution;
    let testSolutionPath: string;

    beforeEach(async () => {
        testSolutionPath = '/test/TestSolution.sln';

        // Mock initial solution file for initialization
        (mockedFs.promises.readFile as jest.Mock).mockResolvedValue(`
Microsoft Visual Studio Solution File, Format Version 12.00
Global
EndGlobal
        `);

        // Create solution instance
        solution = new Solution(testSolutionPath);

        // Mock the initialization to avoid side effects
        jest.spyOn(solution as any, 'initialize').mockImplementation(() => {});
        jest.spyOn(solution as any, 'parseSolutionFile').mockResolvedValue(undefined);

        // Clear all mocks
        jest.clearAllMocks();
    });

    describe('successful removal scenarios', () => {
        test('should remove solution folder and its nested projects', async () => {
            const mockSolutionContent = `Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Libraries", "Libraries", "{22222222-2222-2222-2222-222222222222}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "CoreLibrary", "lib\\CoreLibrary\\CoreLibrary.csproj", "{55555555-5555-5555-5555-555555555555}"
EndProject
Global
\tGlobalSection(NestedProjects) = preSolution
\t\t{55555555-5555-5555-5555-555555555555} = {22222222-2222-2222-2222-222222222222}
\tEndGlobalSection
EndGlobal`;

            const expectedContent = `Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "CoreLibrary", "lib\\CoreLibrary\\CoreLibrary.csproj", "{55555555-5555-5555-5555-555555555555}"
EndProject
Global
\tGlobalSection(NestedProjects) = preSolution
\tEndGlobalSection
EndGlobal`;

            // Mock file system operations
            (mockedFs.promises.readFile as jest.Mock).mockResolvedValue(mockSolutionContent);
            (mockedFs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

            // Mock parseSolutionFile method
            jest.spyOn(solution as any, 'parseSolutionFile').mockResolvedValue(undefined);

            // Mock findSolutionFolderGuid to return the GUID
            jest.spyOn(solution as any, 'findSolutionFolderGuid').mockReturnValue('{22222222-2222-2222-2222-222222222222}');

            // Execute the test
            await solution.removeSolutionFolder('Libraries');

            // Verify the solution file was read
            expect(mockedFs.promises.readFile as jest.Mock).toHaveBeenCalledWith(testSolutionPath, 'utf8');

            // Verify the solution file was written with the expected content
            expect(mockedFs.promises.writeFile as jest.Mock).toHaveBeenCalledWith(testSolutionPath, expectedContent, 'utf8');

            // Verify parseSolutionFile was called to refresh the internal state
            expect(solution['parseSolutionFile']).toHaveBeenCalled();

            // The test passes if no error is thrown
        });

        test('should remove solution folder with no nested projects', async () => {
            const mockSolutionContent = `Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "EmptyFolder", "EmptyFolder", "{11111111-1111-1111-1111-111111111111}"
EndProject
Global
EndGlobal`;

            const expectedContent = `Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
Global
EndGlobal`;

            // Mock file system operations
            (mockedFs.promises.readFile as jest.Mock).mockResolvedValue(mockSolutionContent);
            (mockedFs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

            // Mock parseSolutionFile method
            jest.spyOn(solution as any, 'parseSolutionFile').mockResolvedValue(undefined);

            // Mock findSolutionFolderGuid to return the GUID
            jest.spyOn(solution as any, 'findSolutionFolderGuid').mockReturnValue('{11111111-1111-1111-1111-111111111111}');

            // Execute the test
            await solution.removeSolutionFolder('EmptyFolder');

            // Verify the solution file was written with the expected content
            expect(mockedFs.promises.writeFile as jest.Mock).toHaveBeenCalledWith(testSolutionPath, expectedContent, 'utf8');
        });

        test('should remove multiple nested project entries for the same folder', async () => {
            const mockSolutionContent = `Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Libraries", "Libraries", "{22222222-2222-2222-2222-222222222222}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Library1", "lib\\Library1\\Library1.csproj", "{55555555-5555-5555-5555-555555555555}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Library2", "lib\\Library2\\Library2.csproj", "{66666666-6666-6666-6666-666666666666}"
EndProject
Global
\tGlobalSection(NestedProjects) = preSolution
\t\t{55555555-5555-5555-5555-555555555555} = {22222222-2222-2222-2222-222222222222}
\t\t{66666666-6666-6666-6666-666666666666} = {22222222-2222-2222-2222-222222222222}
\tEndGlobalSection
EndGlobal`;

            const expectedContent = `Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Library1", "lib\\Library1\\Library1.csproj", "{55555555-5555-5555-5555-555555555555}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Library2", "lib\\Library2\\Library2.csproj", "{66666666-6666-6666-6666-666666666666}"
EndProject
Global
\tGlobalSection(NestedProjects) = preSolution
\tEndGlobalSection
EndGlobal`;

            // Mock file system operations
            (mockedFs.promises.readFile as jest.Mock).mockResolvedValue(mockSolutionContent);
            (mockedFs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

            // Mock parseSolutionFile method
            jest.spyOn(solution as any, 'parseSolutionFile').mockResolvedValue(undefined);

            // Mock findSolutionFolderGuid to return the GUID
            jest.spyOn(solution as any, 'findSolutionFolderGuid').mockReturnValue('{22222222-2222-2222-2222-222222222222}');

            // Execute the test
            await solution.removeSolutionFolder('Libraries');

            // Verify the solution file was written with the expected content
            expect(mockedFs.promises.writeFile as jest.Mock).toHaveBeenCalledWith(testSolutionPath, expectedContent, 'utf8');
        });
    });

    describe('error scenarios', () => {
        test('should throw error when solution folder is not found', async () => {
            // Mock findSolutionFolderGuid to return null (folder not found)
            jest.spyOn(solution as any, 'findSolutionFolderGuid').mockReturnValue(null);

            // Execute and expect error
            await expect(solution.removeSolutionFolder('NonExistentFolder')).rejects.toThrow(
                'Solution folder "NonExistentFolder" not found'
            );

            // The error should be thrown to the caller
        });

        test('should throw error when file read fails', async () => {
            const readError = new Error('File not found');

            // Mock file system to throw error
            (mockedFs.promises.readFile as jest.Mock).mockRejectedValue(readError);

            // Mock findSolutionFolderGuid to return a valid GUID
            jest.spyOn(solution as any, 'findSolutionFolderGuid').mockReturnValue('{22222222-2222-2222-2222-222222222222}');

            // Execute and expect error
            await expect(solution.removeSolutionFolder('Libraries')).rejects.toThrow('File not found');

            // The error should be thrown to the caller
        });

        test('should throw error when file write fails', async () => {
            const writeError = new Error('Permission denied');
            const mockSolutionContent = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Libraries", "Libraries", "{22222222-2222-2222-2222-222222222222}"
EndProject
Global
EndGlobal`;

            // Mock file system operations
            (mockedFs.promises.readFile as jest.Mock).mockResolvedValue(mockSolutionContent);
            (mockedFs.promises.writeFile as jest.Mock).mockRejectedValue(writeError);

            // Mock findSolutionFolderGuid to return the GUID
            jest.spyOn(solution as any, 'findSolutionFolderGuid').mockReturnValue('{22222222-2222-2222-2222-222222222222}');

            // Execute and expect error
            await expect(solution.removeSolutionFolder('Libraries')).rejects.toThrow('Permission denied');

            // The error should be thrown to the caller
        });
    });

    describe('edge cases', () => {
        test('should handle solution file with no NestedProjects section', async () => {
            const mockSolutionContent = `Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Libraries", "Libraries", "{22222222-2222-2222-2222-222222222222}"
EndProject
Global
EndGlobal`;

            const expectedContent = `Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
Global
EndGlobal`;

            // Mock file system operations
            (mockedFs.promises.readFile as jest.Mock).mockResolvedValue(mockSolutionContent);
            (mockedFs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

            // Mock parseSolutionFile method
            jest.spyOn(solution as any, 'parseSolutionFile').mockResolvedValue(undefined);

            // Mock findSolutionFolderGuid to return the GUID
            jest.spyOn(solution as any, 'findSolutionFolderGuid').mockReturnValue('{22222222-2222-2222-2222-222222222222}');

            // Execute the test
            await solution.removeSolutionFolder('Libraries');

            // Verify the solution file was written with the expected content
            expect(mockedFs.promises.writeFile as jest.Mock).toHaveBeenCalledWith(testSolutionPath, expectedContent, 'utf8');
        });

        test('should handle folder with nested sub-folders', async () => {
            const mockSolutionContent = `Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "ParentFolder", "ParentFolder", "{11111111-1111-1111-1111-111111111111}"
EndProject
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "ChildFolder", "ChildFolder", "{22222222-2222-2222-2222-222222222222}"
EndProject
Global
\tGlobalSection(NestedProjects) = preSolution
\t\t{22222222-2222-2222-2222-222222222222} = {11111111-1111-1111-1111-111111111111}
\tEndGlobalSection
EndGlobal`;

            const expectedContent = `Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "ChildFolder", "ChildFolder", "{22222222-2222-2222-2222-222222222222}"
EndProject
Global
\tGlobalSection(NestedProjects) = preSolution
\tEndGlobalSection
EndGlobal`;

            // Mock file system operations
            (mockedFs.promises.readFile as jest.Mock).mockResolvedValue(mockSolutionContent);
            (mockedFs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

            // Mock parseSolutionFile method
            jest.spyOn(solution as any, 'parseSolutionFile').mockResolvedValue(undefined);

            // Mock findSolutionFolderGuid to return the GUID for ParentFolder
            jest.spyOn(solution as any, 'findSolutionFolderGuid').mockReturnValue('{11111111-1111-1111-1111-111111111111}');

            // Execute the test - remove parent folder which should also remove the nested relationship
            await solution.removeSolutionFolder('ParentFolder');

            // Verify the solution file was written with the expected content
            expect(mockedFs.promises.writeFile as jest.Mock).toHaveBeenCalledWith(testSolutionPath, expectedContent, 'utf8');
        });
    });
});