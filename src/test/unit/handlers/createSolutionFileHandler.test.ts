import { createSolutionFileHandler } from '../../../handlers/createSolutionFileHandler';
import { SolutionFileHandler } from '../../../handlers/SolutionFileHandler';
import { SolutionXFileHandler } from '../../../handlers/SolutionXFileHandler';

describe('createSolutionFileHandler', () => {
    test('should create SolutionFileHandler for .sln files', () => {
        const handler = createSolutionFileHandler('/path/to/solution.sln');
        expect(handler).toBeInstanceOf(SolutionFileHandler);
        expect(handler.fileType).toBe('.sln');
        expect(handler.filePath).toBe('/path/to/solution.sln');
    });

    test('should create SolutionXFileHandler for .slnx files', () => {
        const handler = createSolutionFileHandler('/path/to/solution.slnx');
        expect(handler).toBeInstanceOf(SolutionXFileHandler);
        expect(handler.fileType).toBe('.slnx');
        expect(handler.filePath).toBe('/path/to/solution.slnx');
    });

    test('should throw error for unsupported file types', () => {
        expect(() => createSolutionFileHandler('/path/to/solution.txt')).toThrow(
            'Unsupported solution file type: /path/to/solution.txt. Expected .sln or .slnx file.'
        );
    });

    test('should throw error for files without extension', () => {
        expect(() => createSolutionFileHandler('/path/to/solution')).toThrow(
            'Unsupported solution file type'
        );
    });
});
