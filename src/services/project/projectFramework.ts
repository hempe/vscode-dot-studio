import { SolutionService } from '../solution/solutionService';

/**
 * The framework whose dependencies the Solution Explorer shows for a project: the active framework if the
 * project targets it, else its first; undefined for projects with a single framework
 */
export function activeFrameworkOf(projectPath: string): string | undefined {
    const solution = SolutionService.getActiveSolution();
    const frameworks = solution?.getProject(projectPath)?.frameworks ?? [];
    if (frameworks.length <= 1) {
        return undefined;
    }
    const active = solution?.getActiveFramework();
    return active && frameworks.includes(active) ? active : frameworks[0];
}
