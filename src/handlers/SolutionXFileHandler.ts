import * as fs from 'fs';
import * as path from 'path';
import { ISolutionFileHandler } from './ISolutionFileHandler';
import { SolutionFile } from '../types/solution';
import { SolutionXFileParser } from '../parsers/solutionXFileParser';
import { SolutionFileParser } from '../parsers/solutionFileParser';
import { logger } from '../core/logger';

const log = logger('SolutionXFileHandler');

/**
 * Handler for modern .slnx (XML-based) solution files
 *
 * The .slnx format is a new XML-based solution format introduced by Microsoft
 * for better source control integration and easier parsing.
 */
export class SolutionXFileHandler implements ISolutionFileHandler {
    public readonly fileType = '.slnx' as const;

    constructor(public readonly filePath: string) {
        if (!filePath.endsWith('.slnx')) {
            throw new Error(`Invalid file path for SolutionXFileHandler: ${filePath}. Expected .slnx file.`);
        }
    }

    async read(): Promise<string> {
        try {
            log.debug(`Reading .slnx file: ${this.filePath}`);
            const content = await fs.promises.readFile(this.filePath, 'utf8');
            return content;
        } catch (error) {
            log.error(`Error reading .slnx file: ${this.filePath}`, error);
            throw error;
        }
    }

    async write(content: string): Promise<void> {
        try {
            log.debug(`Writing .slnx file: ${this.filePath}`);
            await fs.promises.writeFile(this.filePath, content, 'utf8');
            log.info(`Successfully wrote .slnx file: ${this.filePath}`);
        } catch (error) {
            log.error(`Error writing .slnx file: ${this.filePath}`, error);
            throw error;
        }
    }

    async parse(content: string): Promise<SolutionFile> {
        try {
            log.debug(`Parsing .slnx file content from: ${this.filePath}`);
            const solutionFile = await SolutionXFileParser.parse(content);
            await SolutionFileParser.addTargetFrameworks(solutionFile, path.dirname(this.filePath));
            return solutionFile;
        } catch (error) {
            log.error(`Error parsing .slnx file: ${this.filePath}`, error);
            throw error;
        }
    }
}
