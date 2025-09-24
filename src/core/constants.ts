import { minimatch } from 'minimatch';

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
 * System directories that should NEVER be accessed
 */
export const SYSTEM_DIRECTORIES = [
    '/proc', '/sys', '/dev', '/run', '/var', '/usr', '/lib', '/lib64',
    '/boot', '/root', '/etc', '/tmp', '/opt'
];

export const excludePatterns = SKIP_DIRECTORIES.map(dir => `**/${dir}/**`);

export function isExcluded(filePath: string, workspaceRoot?: string): boolean {
    let relPath = filePath;

    // If we have a workspace root, make path relative to it
    if (workspaceRoot) {
        const path = require('path');
        relPath = path.relative(workspaceRoot, filePath);
    }

    return excludePatterns.some(pattern => minimatch(relPath, pattern, { dot: true }));
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

/**
 * Validate that a path is within expected boundaries (workspace)
 */
export function isValidWorkspacePath(fullPath: string, workspaceRoot?: string): boolean {
    if (!workspaceRoot) return false;

    const normalizedPath = fullPath.replace(/\\/g, '/');
    const normalizedWorkspace = workspaceRoot.replace(/\\/g, '/');

    // Path must start with workspace root
    return normalizedPath.startsWith(normalizedWorkspace);
}

/**
 * Normalize project paths from solution files to fix common cross-platform issues
 */
export function normalizeProjectPath(projectPath: string): string {
    let normalized = projectPath;

    // Remove erroneous leading slash that makes paths absolute on Unix systems
    if (normalized.startsWith('/') && !normalized.startsWith('//')) {
        console.log(`Removing erroneous leading slash from: ${normalized}`);
        normalized = normalized.substring(1);
    }

    // Normalize path separators to current platform
    const path = require('path');
    normalized = normalized.replace(/\\/g, path.sep).replace(/\//g, path.sep);

    return normalized;
}