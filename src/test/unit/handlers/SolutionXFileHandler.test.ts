import { SolutionXFileHandler } from '../../../handlers/SolutionXFileHandler';
import * as fs from 'fs';

// Mock fs
jest.mock('fs', () => ({
    promises: {
        readFile: jest.fn(),
        writeFile: jest.fn(),
    },
}));

describe('SolutionXFileHandler', () => {
    const mockFilePath = '/path/to/solution.slnx';
    let handler: SolutionXFileHandler;

    beforeEach(() => {
        handler = new SolutionXFileHandler(mockFilePath);
        jest.clearAllMocks();
    });

    describe('constructor', () => {
        test('should create handler for .slnx files', () => {
            expect(handler.fileType).toBe('.slnx');
            expect(handler.filePath).toBe(mockFilePath);
        });

        test('should throw error for non-.slnx files', () => {
            expect(() => new SolutionXFileHandler('/path/to/solution.sln')).toThrow(
                'Invalid file path for SolutionXFileHandler: /path/to/solution.sln. Expected .slnx file.'
            );
        });
    });

    describe('read', () => {
        test('should read file content', async () => {
            const mockContent = '<Solution></Solution>';
            (fs.promises.readFile as jest.Mock).mockResolvedValue(mockContent);

            const result = await handler.read();

            expect(fs.promises.readFile).toHaveBeenCalledWith(mockFilePath, 'utf8');
            expect(result).toBe(mockContent);
        });

        test('should throw error on read failure', async () => {
            const error = new Error('Read failed');
            (fs.promises.readFile as jest.Mock).mockRejectedValue(error);

            await expect(handler.read()).rejects.toThrow('Read failed');
        });
    });

    describe('write', () => {
        test('should write file content', async () => {
            const content = '<Solution></Solution>';
            (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);

            await handler.write(content);

            expect(fs.promises.writeFile).toHaveBeenCalledWith(mockFilePath, content, 'utf8');
        });

        test('should throw error on write failure', async () => {
            const error = new Error('Write failed');
            (fs.promises.writeFile as jest.Mock).mockRejectedValue(error);

            await expect(handler.write('<Solution></Solution>')).rejects.toThrow('Write failed');
        });
    });

    describe('parse', () => {
        test('should parse empty .slnx content', async () => {
            const mockContent = '<Solution></Solution>';

            const result = await handler.parse(mockContent);

            expect(result).toHaveProperty('formatVersion');
            expect(result).toHaveProperty('projects');
            expect(result).toHaveProperty('globalSections');
            expect(result).toHaveProperty('nestedProjects');
        });
    });
});
