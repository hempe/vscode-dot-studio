import { SolutionService } from './solutionService';
import { BuildConfiguration } from './buildConfiguration';
import { mappedBuild } from './configurationManager/configurationManager';

/**
 * The configuration and platform a project builds in for the active solution configuration and platform, after
 * the solution's mapping (Configuration Manager). Unchanged when there is no solution or it has no mapping.
 */
export function activeProjectBuild(projectPath: string): { configuration: string; platform: string } {
    const configuration = BuildConfiguration.active;
    const platform = BuildConfiguration.activePlatform;
    const solution = SolutionService.getActiveSolution();
    const model = solution?.configurationModel;
    if (!solution || !model) {
        return { configuration, platform };
    }
    const mapped = mappedBuild(model, solution.solutionPath, projectPath, configuration, platform);
    return { configuration: mapped.configuration, platform: mapped.platform };
}
