import { SolutionFile, PROJECT_TYPE_GUIDS } from '../../types/solution';
import { ConfigurationModel } from './model';
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
