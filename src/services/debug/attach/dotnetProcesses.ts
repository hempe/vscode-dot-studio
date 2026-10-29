import * as fs from 'fs';
import * as path from 'path';
import { ProcessEntry } from './processList';

/** A project of the active solution, as far as matching processes needs it */
export interface SolutionProjectRef {
    name: string;
    /** The project's folder: its apphost lives in `<folder>/bin/...` */
    directory: string;
}

export interface DotnetProcess {
    pid: number;
    /** The assembly: the dll of `dotnet App.dll`, or the apphost's file name */
    name: string;
    /** The solution project it belongs to */
    project?: string;
    commandLine: string;
}

export interface DetectionEnvironment {
    projects: SolutionProjectRef[];
    /** The extension host itself, never listed */
    selfPid: number;
    /** Existing files only (apphosts next to their dll, executables with spaces in their path) */
    isFile?: (filePath: string) => boolean;
    /** The real path of a process started with a relative path (`bin/Debug/net10.0/App`); Linux: /proc/<pid>/exe */
    resolveExecutable?: (pid: number) => string | undefined;
}

const defaultIsFile = (filePath: string): boolean => {
    try {
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
};

const defaultResolveExecutable = (pid: number): string | undefined => {
    if (process.platform !== 'linux') {
        return undefined;
    }
    try {
        return fs.readlinkSync(`/proc/${pid}/exe`);
    } catch {
        return undefined;
    }
};

/** `dotnet <command>`: the SDK's command line tool, not an application */
const SDK_COMMANDS = new Set([
    'add', 'build', 'build-server', 'clean', 'dev-certs', 'format', 'fsi', 'msbuild', 'new', 'nuget', 'pack', 'publish',
    'remove', 'restore', 'run', 'sdk', 'sln', 'store', 'test', 'tool', 'user-jwts', 'user-secrets', 'watch', 'workload',
    'help', '--info', '--version', '--list-sdks', '--list-runtimes',
]);

/** Options of `dotnet exec` that take a value */
const HOST_OPTIONS_WITH_VALUE = new Set([
    '--runtimeconfig', '--depsfile', '--additionalprobingpath', '--additional-deps', '--fx-version',
    '--roll-forward', '--roll-forward-on-no-candidate-fx',
]);

/** Build servers, formatters and language servers: managed processes that are tooling, not the user's program */
const TOOLING = new Set([
    'msbuild', 'msbuildtaskhost', 'vbcscompiler', 'csc', 'fsc', 'dotnet', 'dotnet-format', 'dotnet-watch', 'dotnet-dev-certs',
    'dotnet-user-secrets', 'dotnet-user-jwts', 'nuget.commandline.xplat', 'rzls', 'omnisharp', 'dotnet-trace', 'dotnet-counters',
]);

function isTooling(file: string): boolean {
    const name = baseName(file).toLowerCase();
    if (TOOLING.has(name) || name.startsWith('microsoft.codeanalysis.')) {
        return true;
    }
    // The SDK's own tools (<dotnet>/sdk/<version>/...) and the C# extension's servers (.roslyn, .razor)
    return /[\\/]sdk[\\/]\d+\.\d+/.test(file) || /[\\/]\.(roslyn|roslynDevKit|razor)[\\/]/.test(file);
}

/** The file name of a path in either separator style, without .dll/.exe */
function baseName(file: string): string {
    return (file.split(/[\\/]/).pop() ?? file).replace(/\.(dll|exe)$/i, '');
}

function tokenize(text: string): string[] {
    const tokens: string[] = [];
    for (const match of text.matchAll(/"([^"]*)"|(\S+)/g)) {
        tokens.push(match[1] ?? match[2]);
    }
    return tokens;
}

/** The executable of a command line, and what follows it (paths with spaces: quoted, the image path, or an existing file) */
function splitExecutable(entry: ProcessEntry, isFile: (p: string) => boolean): { executable: string; rest: string } {
    const args = entry.args.trim();
    if (args.startsWith('"')) {
        const end = args.indexOf('"', 1);
        if (end > 0) {
            return { executable: args.slice(1, end), rest: args.slice(end + 1).trim() };
        }
    }
    if (entry.command && args.startsWith(entry.command) && /^(\s|$)/.test(args.slice(entry.command.length))
        && args.split(/\s/)[0] !== entry.command) {
        return { executable: entry.command, rest: args.slice(entry.command.length).trim() };
    }
    const words = args.split(/\s+/);
    for (let count = 1; count <= Math.min(words.length, 8); count++) {
        const candidate = words.slice(0, count).join(' ');
        if (path.isAbsolute(candidate) && isFile(candidate)) {
            return { executable: candidate, rest: words.slice(count).join(' ') };
        }
    }
    return { executable: words[0] ?? '', rest: words.slice(1).join(' ') };
}

/** The dll that `dotnet [exec] [options] App.dll` runs, or undefined for the SDK's commands and anything else */
function hostedDll(rest: string): string | undefined {
    const tokens = tokenize(rest);
    let index = 0;
    for (; index < tokens.length; index++) {
        const token = tokens[index];
        if (token === 'exec') {
            continue;
        }
        if (HOST_OPTIONS_WITH_VALUE.has(token)) {
            index++;
            continue;
        }
        if (token.startsWith('--') && !SDK_COMMANDS.has(token)) {
            continue;
        }
        break;
    }
    const first = tokens[index];
    if (first === undefined || SDK_COMMANDS.has(first)) {
        return undefined;
    }
    // An unquoted path with spaces arrives as several words
    for (let count = 1; count <= Math.min(6, tokens.length - index); count++) {
        const candidate = tokens.slice(index, index + count).join(' ');
        if (/\.dll$/i.test(candidate)) {
            return candidate;
        }
    }
    return undefined;
}

function isInside(folder: string, file: string): boolean {
    const relative = path.relative(folder, file);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** The project whose bin folder holds the file */
function projectOwning(file: string, projects: SolutionProjectRef[]): SolutionProjectRef | undefined {
    return projects.find(project => isInside(path.join(project.directory, 'bin'), file));
}

function projectNamed(name: string, projects: SolutionProjectRef[]): SolutionProjectRef | undefined {
    return projects.find(project => project.name.toLowerCase() === name.toLowerCase());
}

/**
 * The .NET programs among the processes: `dotnet App.dll` (also `dotnet exec`, and the test hosts `dotnet test` starts), and
 * apphosts, found by their place in a project's bin folder or by the .dll and .runtimeconfig.json beside them.
 * The dotnet CLI itself, build servers and language servers are not programs to debug.
 */
export function findDotnetProcesses(entries: ProcessEntry[], env: DetectionEnvironment): DotnetProcess[] {
    const isFile = env.isFile ?? defaultIsFile;
    const resolveExecutable = env.resolveExecutable ?? defaultResolveExecutable;
    const found: DotnetProcess[] = [];

    for (const entry of entries) {
        if (entry.pid === env.selfPid || !entry.args) {
            continue;
        }
        const split = splitExecutable(entry, isFile);
        const rest = split.rest;
        let executable = split.executable;

        let assembly: string | undefined;
        let location: string | undefined;
        if (baseName(executable).toLowerCase() === 'dotnet') {
            const dll = hostedDll(rest);
            if (!dll || isTooling(dll)) {
                continue;
            }
            assembly = baseName(dll);
            location = dll;
        } else {
            if (!path.isAbsolute(executable)) {
                executable = resolveExecutable(entry.pid) ?? executable;
            }
            if (isTooling(executable) || !path.isAbsolute(executable)) {
                continue;
            }
            const stem = executable.replace(/\.exe$/i, '');
            const inProjectBin = projectOwning(executable, env.projects) !== undefined;
            if (!inProjectBin && !(isFile(`${stem}.dll`) && isFile(`${stem}.runtimeconfig.json`))) {
                continue;
            }
            assembly = baseName(executable);
            location = executable;
        }

        const project = projectOwning(location, env.projects) ?? projectNamed(assembly, env.projects);
        found.push({ pid: entry.pid, name: assembly, project: project?.name, commandLine: entry.args });
    }
    return found;
}

/** Processes of the solution's projects first, then the others, each by name */
export function sortProcesses(processes: DotnetProcess[]): DotnetProcess[] {
    return [...processes].sort((a, b) =>
        Number(b.project !== undefined) - Number(a.project !== undefined)
        || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        || a.pid - b.pid);
}
