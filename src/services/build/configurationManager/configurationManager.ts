import { SolutionFile, PROJECT_TYPE_GUIDS } from '../../../types/solution';
import * as path from 'path';
import { ConfigurationModel, msbuildPlatform, resolveMapping } from './model';
import { readSlnModel, renderSlnModel, SolutionProjectRef } from './slnConfigurations';
import { readSlnxModel, renderSlnxModel } from './slnxConfigurations';

export type SolutionFileType = 'sln' | 'slnx';

export function readConfigurationModel(type: SolutionFileType, content: string, projects: readonly SolutionProjectRef[]): ConfigurationModel {
    return type === 'slnx' ? readSlnxModel(content, projects) : readSlnModel(content, projects);
}

export function renderConfigurationModel(type: SolutionFileType, content: string, model: ConfigurationModel, projects: readonly SolutionProjectRef[]): string {
    return type === 'slnx' ? renderSlnxModel(content, model, projects) : renderSlnModel(content, model, projects);
}

/** The solution file's projects (not solution folders), as the configuration code identifies them */
export function configurationProjectsOf(solutionFile: SolutionFile | undefined): SolutionProjectRef[] {
    return (solutionFile?.projects ?? [])
        .filter(project => project.typeGuid.toUpperCase() !== PROJECT_TYPE_GUIDS.SOLUTION_FOLDER)
        .map(project => ({ path: project.path.replace(/\\/g, '/'), guid: project.guid }));
}

/**
 * The configuration and platform a single project builds in for the active solution pair. `dotnet build project.csproj`
 * ignores the solution, so the mapping is applied by hand; `build` is false when the solution leaves the project out.
 */
export function mappedBuild(model: ConfigurationModel, solutionPath: string, projectPath: string, configuration: string, platform: string): { configuration: string; platform: string; build: boolean } {
    const key = path.relative(path.dirname(solutionPath), projectPath).replace(/\\/g, '/');
    return resolveMapping(model, key, configuration, platform);
}

/** The MSBuild argument for a platform; none for Any CPU, MSBuild's default (passing it fails for some project types) */
export function platformProperty(platform: string | undefined): string[] {
    const name = platform ? msbuildPlatform(platform) : '';
    return name && name !== 'AnyCPU' ? [`-property:Platform=${name}`] : [];
}
