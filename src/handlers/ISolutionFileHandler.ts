import { SolutionFile } from '../types/solution';

/**
 * Interface for handling solution file operations (.sln or .slnx)
 */
export interface ISolutionFileHandler {
    /**
     * The absolute path to the solution file
     */
    readonly filePath: string;

    /**
     * The type of solution file
     */
    readonly fileType: '.sln' | '.slnx';

    /**
     * Reads the raw content of the solution file
     */
    read(): Promise<string>;

    /**
     * Writes raw content to the solution file
     */
    write(content: string): Promise<void>;

    /**
     * Parses the raw content into a SolutionFile object
     */
    parse(content: string): Promise<SolutionFile>;
}
