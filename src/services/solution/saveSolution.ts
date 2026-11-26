import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { dotnetSlnAdd } from './dotnetSlnAdd';

function dotnet(args: string[], cwd: string): Promise<{ code: number; output: string }> {
    return new Promise(resolve => {
        execFile('dotnet', args, { cwd, timeout: 120000 }, (error, stdout, stderr) => resolve({ code: error ? 1 : 0, output: `${stdout}${stderr}` }));
    });
}

/**
 * Writes a solution file (.slnx or .sln, by the file's extension) with the projects at its root, as `dotnet new sln` and
 * `dotnet sln add` make it: Visual Studio's "save the temporary solution". An existing file is replaced (the save dialog asked).
 */
export async function createSolutionFileWithProjects(file: string, projects: readonly string[]): Promise<void> {
    const dir = path.dirname(file);
    const ext = path.extname(file).toLowerCase();
    const name = path.basename(file, path.extname(file));
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.rm(file, { force: true });
    let created = await dotnet(['new', 'sln', '-n', name, '-o', dir, '--format', ext === '.sln' ? 'sln' : 'slnx'], dir);
    // SDKs before 9.0.200 know no --format (and write .sln)
    if (created.code !== 0 && ext === '.sln') {
        created = await dotnet(['new', 'sln', '-n', name, '-o', dir], dir);
    }
    if (created.code !== 0 || !fs.existsSync(file)) {
        throw new Error(`dotnet new sln failed: ${created.output.trim().split(/\r?\n/).slice(0, 4).join(' ')}`);
    }
    if (projects.length > 0) {
        await dotnetSlnAdd(file, projects.map(project => path.relative(dir, project)), ['--in-root'], dir, dotnet);
    }
}
