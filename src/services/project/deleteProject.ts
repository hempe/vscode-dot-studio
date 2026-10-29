import * as fs from 'fs';
import * as path from 'path';

export type DeleteProjectPlan =
    | { kind: 'folder'; path: string }
    | { kind: 'file'; path: string; reason: string };

const inside = (folder: string, target: string) => {
    const relative = path.relative(folder, target);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

/**
 * What Delete Project moves to the trash: the project's folder when it is the project's own, otherwise only the project
 * file, because the folder also holds the solution, another project of the solution or a git repository
 */
export function deleteProjectPlan(projectPath: string, solutionPath: string, solutionProjects: readonly string[]): DeleteProjectPlan {
    const folder = path.dirname(projectPath);
    const shared = (reason: string): DeleteProjectPlan => ({ kind: 'file', path: projectPath, reason });
    if (inside(folder, solutionPath)) {
        return shared('its folder also holds the solution');
    }
    if (solutionProjects.some(other => other !== projectPath && inside(folder, path.dirname(other)))) {
        return shared('its folder also holds another project of the solution');
    }
    if (fs.existsSync(path.join(folder, '.git'))) {
        return shared('its folder is a git repository');
    }
    return { kind: 'folder', path: folder };
}
