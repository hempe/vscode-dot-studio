import * as fs from 'fs';
import { SolutionDiscovery } from './solutionDiscovery';

const PROJECT_FILE = /\.(cs|vb|fs)proj$/i;

/**
 * Whether one of the folders holds a .NET solution (in it or a few folders down) or a project file directly in it. Decides
 * the context key that turns on the Solution Explorer, the Error List and the F5 / Ctrl+F5 bindings: in a Node or Python
 * folder these must stay VS Code's own, even when a command of this extension (Create New Project...) activated it.
 */
export async function workspaceHasDotnetFiles(folders: readonly string[]): Promise<boolean> {
    for (const folder of folders) {
        if ((await SolutionDiscovery.findSolutionFiles(folder)).length > 0) {
            return true;
        }
        try {
            if ((await fs.promises.readdir(folder)).some(name => PROJECT_FILE.test(name))) {
                return true;
            }
        } catch {
            // unreadable folder
        }
    }
    return false;
}
