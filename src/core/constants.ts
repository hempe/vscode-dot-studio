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

/** Skipped folders that never show, whatever the project includes: tooling output and metadata (build, packages... can hold real project files) */
export const HARD_SKIP_DIRECTORIES = ['bin', 'obj', 'node_modules', '.git', '.vs', '.vscode'];

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
/**
 * Folders the extension never reads: virtual file systems and the operating system's own. Not /tmp, /var,
 * /opt or /root: people keep code there (/var/www, dev containers running as root).
 */
export const SYSTEM_DIRECTORIES = [
    '/proc', '/sys', '/dev', '/run', '/usr', '/lib', '/lib64', '/boot', '/etc'
];

/** The same on Windows (on any drive, any case) and macOS */
const WINDOWS_SYSTEM_DIRECTORIES = ['windows', 'program files', 'program files (x86)', 'programdata', '$recycle.bin', 'system volume information'];
const MACOS_SYSTEM_DIRECTORIES = ['/System', '/Library'];

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
    const under = (dir: string) => normalizedPath.startsWith(dir + '/') || normalizedPath === dir;

    const drive = /^[a-z]:\/([^/]+)/i.exec(normalizedPath);
    if (drive) {
        return WINDOWS_SYSTEM_DIRECTORIES.includes(drive[1].toLowerCase());
    }
    return [...SYSTEM_DIRECTORIES, ...MACOS_SYSTEM_DIRECTORIES].some(under);
}
