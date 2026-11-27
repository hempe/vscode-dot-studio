import * as fs from 'fs';
import * as path from 'path';
import { sln } from '../../core/utils';

/**
 * The solution a project file opened on its own belongs to, as Visual Studio finds it: a `.sln` or `.slnx` in the project's folder or
 * the folder above that lists the project (the project's own folder first). Undefined: none, the project opens as a temporary solution.
 */
export async function solutionForProject(projectPath: string): Promise<string | undefined> {
    const projectDir = path.dirname(projectPath);
    for (const dir of [projectDir, path.dirname(projectDir)]) {
        let names: string[];
        try {
            names = (await fs.promises.readdir(dir)).filter(name => sln(name)).sort((a, b) => a.localeCompare(b));
        } catch {
            continue;
        }
        for (const name of names) {
            const solutionPath = path.join(dir, name);
            const text = await fs.promises.readFile(solutionPath, 'utf8').catch(() => '');
            if (listsProject(text, path.relative(dir, projectPath))) {
                return solutionPath;
            }
        }
    }
    return undefined;
}

/** Whether the solution text names the project by its path relative to the solution (either slash, any case: Windows writes either) */
function listsProject(solutionText: string, relativePath: string): boolean {
    const wanted = relativePath.replace(/\\/g, '/').toLowerCase();
    const paths = [...solutionText.matchAll(/(?:Path\s*=\s*"|",\s*")([^"]+\.\w+proj)"/gi)].map(match => match[1].replace(/\\/g, '/').toLowerCase());
    return paths.includes(wanted);
}
