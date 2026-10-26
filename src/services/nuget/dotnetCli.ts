import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Runs `dotnet` with these arguments, without a shell: ids, versions and paths from the user or from a project file
 * are never interpreted (`Foo;touch x` is one argument). Rejects when the command exits with an error, like `exec`.
 */
export function execDotnet(args: readonly string[], options: { cwd?: string; timeout?: number } = {}): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync('dotnet', [...args], { ...options, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}
