import * as fs from 'fs';
import * as path from 'path';
import { ISolutionFileHandler } from './ISolutionFileHandler';
import { SolutionFile } from '../types/solution';
import { SolutionFileParser } from '../parsers/solutionFileParser';
import { logger } from '../core/logger';

const log = logger('SolutionFileHandler');

/**
 * Handler for traditional .sln (text-based) solution files
 */
export class SolutionFileHandler implements ISolutionFileHandler {
    public readonly fileType: '.sln' = '.sln';

    constructor(public readonly filePath: string) {
        if (!filePath.endsWith('.sln')) {
            throw new Error(`Invalid file path for SolutionFileHandler: ${filePath}. Expected .sln file.`);
        }
    }

    async read(): Promise<string> {
        try {
            log.debug(`Reading solution file: ${this.filePath}`);
            const content = await fs.promises.readFile(this.filePath, 'utf8');
            return content;
        } catch (error) {
            log.error(`Error reading solution file: ${this.filePath}`, error);
            throw error;
        }
    }

    async write(content: string): Promise<void> {
        try {
            log.debug(`Writing solution file: ${this.filePath}`);
            await fs.promises.writeFile(this.filePath, content, 'utf8');
            log.info(`Successfully wrote solution file: ${this.filePath}`);
        } catch (error) {
            log.error(`Error writing solution file: ${this.filePath}`, error);
            throw error;
        }
    }

    async parse(content: string): Promise<SolutionFile> {
        try {
            const solutionDir = path.dirname(this.filePath);
            log.debug(`Parsing solution file content from: ${this.filePath}`);
            const solutionFile = await SolutionFileParser.parse(content, solutionDir);
            return solutionFile;
        } catch (error) {
            log.error(`Error parsing solution file: ${this.filePath}`, error);
            throw error;
        }
    }
}
