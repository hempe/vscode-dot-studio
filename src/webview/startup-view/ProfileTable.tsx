import React from 'react';
import { StartupProjectAction, StartupProjectInfo, StartupRow } from '../../types/startupProjects';
import { Select } from '../shared/Select';

interface Props {
    projects: readonly StartupProjectInfo[];
    rows: readonly StartupRow[];
    onChange(rows: StartupRow[]): void;
}

const ACTIONS: ReadonlyArray<{ value: StartupProjectAction; label: string }> = [
    { value: 'None', label: 'None' },
    { value: 'Start', label: 'Start' },
    { value: 'StartWithoutDebugging', label: 'Start without debugging' },
];

/** Every project of the solution with its action, launch profile and place in the launch order (the order of the rows) */
export const ProfileTable: React.FC<Props> = ({ projects, rows, onChange }) => {
    const info = (row: StartupRow) => projects.find(project => project.path === row.path);
    const update = (index: number, patch: Partial<StartupRow>) =>
        onChange(rows.map((row, i) => i === index ? { ...row, ...patch } : row));
    const move = (index: number, delta: number) => {
        const next = [...rows];
        [next[index], next[index + delta]] = [next[index + delta], next[index]];
        onChange(next);
    };

    return (
        <table className="grid">
            <thead>
                <tr><th>Project</th><th>Action</th><th>Launch profile</th><th>Order</th></tr>
            </thead>
            <tbody>
                {rows.map((row, index) => {
                    const project = info(row);
                    const name = project?.name ?? row.path;
                    const launchProfiles = project?.launchProfiles ?? [];
                    // A profile the project does not have any more stays visible, it is not rewritten silently
                    const profileOptions = [
                        { value: '', label: '(default)' },
                        ...(row.launchProfile && !launchProfiles.includes(row.launchProfile) ? [row.launchProfile] : []).concat(launchProfiles)
                            .map(profile => ({ value: profile, label: profile })),
                    ];
                    return (
                        <tr key={row.path}>
                            <td title={row.path}>{name}{project?.unloaded ? ' (unloaded)' : ''}</td>
                            <td><Select aria-label={`${name} action`} value={row.action} options={ACTIONS}
                                onChange={action => update(index, { action: action as StartupProjectAction })} /></td>
                            <td><Select aria-label={`${name} launch profile`} value={row.launchProfile ?? ''} options={profileOptions}
                                disabled={row.action === 'None' || launchProfiles.length === 0}
                                onChange={profile => update(index, { launchProfile: profile || undefined })} /></td>
                            <td>
                                <button className="action" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => move(index, -1)}>&#9650;</button>
                                {' '}
                                <button className="action" aria-label={`Move ${name} down`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}>&#9660;</button>
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
};
