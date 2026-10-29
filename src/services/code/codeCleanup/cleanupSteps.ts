import * as path from 'path';

export type CleanupSeverity = 'info' | 'warn' | 'error';

export interface CleanupTarget {
    kind: 'solution' | 'project' | 'folder' | 'file';
    /** The solution file, project file, folder or file */
    path: string;
    /** The project file owning a folder or file (required for those kinds) */
    projectPath?: string;
}

export interface CleanupStep {
    label: string;
    args: string[];
}

/** Windows-style paths are told apart so the result is the same on every host */
const pathModuleFor = (p: string) => /^[a-zA-Z]:[\\/]/.test(p) ? path.win32 : path.posix;

/**
 * The `dotnet format` runs of Code Cleanup: formatting, unused usings, then the style fixes the `.editorconfig`
 * sets at the given severity or higher. A solution or project is formatted as a whole; a folder or file through
 * its owning project with `--include` (relative to the project directory, which is the working directory).
 *
 * IDE0005 is a hidden diagnostic by default: SDK 10's `dotnet format` only fixes it with `--severity hidden` (the
 * default here). Older SDKs have no `hidden` and fix it only when the `.editorconfig` raises IDE0005, whatever
 * the option says: pass `'info'` for them (see `unusedUsingsSeverityFor`)
 */
export function cleanupSteps(target: CleanupTarget, severity: CleanupSeverity, unusedUsingsSeverity: 'hidden' | 'info' = 'hidden'): { cwd: string; steps: CleanupStep[] } {
    let projectTarget = target.path;
    let include: string[] = [];
    if (target.kind === 'folder' || target.kind === 'file') {
        if (!target.projectPath) {
            throw new Error(`Code Cleanup of a ${target.kind} needs the project that owns it`);
        }
        projectTarget = target.projectPath;
        const p = pathModuleFor(target.projectPath);
        let relative = p.relative(p.dirname(target.projectPath), target.path).replace(/\\/g, '/');
        if (target.kind === 'folder' && !relative.endsWith('/')) {
            relative += '/';
        }
        include = ['--include', relative];
    }
    const cwd = pathModuleFor(projectTarget).dirname(projectTarget);
    return {
        cwd,
        steps: [
            { label: 'Formatting', args: ['format', 'whitespace', projectTarget, ...include] },
            { label: 'Removing unused usings', args: ['format', 'style', projectTarget, '--diagnostics', 'IDE0005', '--severity', unusedUsingsSeverity, ...include] },
            // IDE0130 (namespace does not match the folder) is Sync Namespaces' job: its fix crashes `dotnet format style` ("Changing document properties is not supported")
            { label: 'Applying code style fixes', args: ['format', 'style', projectTarget, '--severity', severity, '--exclude-diagnostics', 'IDE0130', ...include] },
        ],
    };
}

/** `hidden` is accepted from SDK 10 on (verified on 8 and 10); `dotnet --version` is the SDK the project builds with */
export function unusedUsingsSeverityFor(dotnetVersion: string): 'hidden' | 'info' {
    const major = parseInt(dotnetVersion, 10);
    return major >= 10 ? 'hidden' : 'info';
}
