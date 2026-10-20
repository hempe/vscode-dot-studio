import React from 'react';
import { ConfigurationManagerProject, ConfigurationManagerRequest, ConfigurationManagerState } from '../../types/configurationManager';
import { Select } from '../shared/Select';

type Mapping = ConfigurationManagerState['mappings'][string];

interface Props {
    state: ConfigurationManagerState;
    post(request: ConfigurationManagerRequest): void;
}

/** The project's own names, plus the mapped one when the project file does not declare it (never rewritten silently) */
const optionsFor = (names: string[], mapped: string) =>
    (names.includes(mapped) ? names : [mapped, ...names]).map(name => ({ value: name, label: name }));

/** Which configuration, platform and Build setting each project uses for the active solution configuration and platform */
export const ProjectGrid: React.FC<Props> = ({ state, post }) => {
    const { activeConfiguration, activePlatform } = state;
    const resolve = (project: ConfigurationManagerProject): Mapping =>
        state.mappings[`${project.path}|${activeConfiguration}|${activePlatform}`]
        ?? { configuration: activeConfiguration, platform: activePlatform, build: true };
    const change = (project: ConfigurationManagerProject, mapping: Mapping) =>
        post({ type: 'setMapping', project: project.path, configuration: activeConfiguration, platform: activePlatform, mapping });

    return (
        <table className="grid">
            <thead>
                <tr><th>Project</th><th>Configuration</th><th>Platform</th><th>Build</th></tr>
            </thead>
            <tbody>
                {state.projects.map(project => {
                    const mapping = resolve(project);
                    return (
                        <tr key={project.path}>
                            <td title={project.path}>{project.name}</td>
                            <td><Select aria-label={`${project.name} configuration`} value={mapping.configuration}
                                options={optionsFor(project.configurations, mapping.configuration)}
                                onChange={configuration => change(project, { ...mapping, configuration })} /></td>
                            <td><Select aria-label={`${project.name} platform`} value={mapping.platform}
                                options={optionsFor(project.platforms, mapping.platform)}
                                onChange={platform => change(project, { ...mapping, platform })} /></td>
                            <td><input type="checkbox" aria-label={`${project.name} build`} checked={mapping.build}
                                onChange={e => change(project, { ...mapping, build: e.target.checked })} /></td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
};
