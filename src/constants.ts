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
 * Check if a directory should be skipped during scanning
 */
export function shouldSkipDirectory(dirName: string): boolean {
    return SKIP_DIRECTORIES.includes(dirName);
}