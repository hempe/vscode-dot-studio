import { minimatch } from 'minimatch';

/**
 * Common constants used throughout the .NET extension
 */

/**
 * Directories that should be excluded from scanning and display
 */
export const SKIP_DIRECTORIES = [
    'bin', 'obj', 'node_modules', '.git', '.vs', '.vscode',
    'packages', '.nuget', 'TestResults', 'coverage', 'build'
];

/**
 * File extensions that should be ignored for file change events
 */
export const SKIP_FILE_EXTENSIONS = [
    '.dll', '.exe', '.pdb', '.cache', '.tmp', '.temp', '.log',
    '.user', '.suo', '.bak', '.swp', '~'
];

/**
 * System directories that should NEVER be accessed
 */
export const SYSTEM_DIRECTORIES = [
    '/proc', '/sys', '/dev', '/run', '/var', '/usr', '/lib', '/lib64',
    '/boot', '/root', '/etc', '/tmp', '/opt'
];

export const excludePatterns = SKIP_DIRECTORIES.map(dir => `**/${dir}/**`);

export function isExcluded(filePath: string, workspaceRoot?: string): boolean {
    const path = require('path');
    let relPath = filePath;

    // If we have a workspace root, make path relative to it
    if (workspaceRoot) {
        relPath = path.relative(workspaceRoot, filePath);
    }

    // Check if path matches excluded directory patterns
    const matchesDirectoryPattern = excludePatterns.some(pattern =>
        minimatch(relPath, pattern, { dot: true })
    );

    // Check if file extension should be excluded
    const fileExtension = path.extname(filePath).toLowerCase();
    const matchesFileExtension = SKIP_FILE_EXTENSIONS.includes(fileExtension);

    return matchesDirectoryPattern || matchesFileExtension;
}
/**
 * Check if a directory should be skipped during scanning
 */
export function shouldSkipDirectory(dirName: string): boolean {
    return SKIP_DIRECTORIES.includes(dirName);
}

/**
 * Check if a path is a system directory that should never be accessed
 */
export function isSystemPath(fullPath: string): boolean {
    const normalizedPath = fullPath.replace(/\\/g, '/');

    // Check if path starts with any system directory
    return SYSTEM_DIRECTORIES.some(sysDir =>
        normalizedPath.startsWith(sysDir + '/') || normalizedPath === sysDir
    );
}
