import { ISolutionFileHandler } from './ISolutionFileHandler';
import { SolutionFileHandler } from './SolutionFileHandler';
import { SolutionXFileHandler } from './SolutionXFileHandler';

/**
 * Factory function to create the appropriate solution file handler based on file extension
 *
 * @param filePath - The absolute path to the solution file (.sln or .slnx)
 * @returns An ISolutionFileHandler implementation for the given file type
 * @throws Error if the file extension is not supported
 */
export function createSolutionFileHandler(filePath: string): ISolutionFileHandler {
    if (filePath.endsWith('.sln')) {
        return new SolutionFileHandler(filePath);
    } else if (filePath.endsWith('.slnx')) {
        return new SolutionXFileHandler(filePath);
    } else {
        throw new Error(`Unsupported solution file type: ${filePath}. Expected .sln or .slnx file.`);
    }
}
