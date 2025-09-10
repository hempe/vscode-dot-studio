/**
 * Common constants used throughout the .NET extension
 */

/**
 * Directories that should be excluded from scanning and display
 */
export const SKIP_DIRECTORIES = [
    'bin', 'obj', 'node_modules', '.git', '.vs', '.vscode', 
    'packages', '.nuget', 'TestResults'
];

/**
 * File extensions that are relevant for .NET development
 */
export const RELEVANT_FILE_EXTENSIONS = [
    '.cs', '.vb', '.fs',                    // Source files
    '.cshtml', '.vbhtml',                   // Razor views
    '.xaml',                                // XAML files
    '.resx',                                // Resources
    '.json', '.xml', '.config'              // Config files
];

/**
 * Check if a directory should be skipped during scanning
 */
export function shouldSkipDirectory(dirName: string): boolean {
    return SKIP_DIRECTORIES.includes(dirName);
}

/**
 * Check if a file extension is relevant for .NET development
 */
export function isRelevantFileExtension(extension: string): boolean {
    return RELEVANT_FILE_EXTENSIONS.includes(extension.toLowerCase());
}