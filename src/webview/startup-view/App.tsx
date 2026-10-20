import React, { useEffect, useRef, useState } from 'react';
import {
    StartupProfileEntry, StartupProjectsMessage, StartupProjectsRequest, StartupProjectsState, StartupRow,
} from '../../types/startupProjects';
import { Select } from '../shared/Select';
import { ProfileTable } from './ProfileTable';

export interface StartupProjectsApi {
    postMessage(message: StartupProjectsRequest): void;
}

type Selection = { name: string; shared: boolean } | 'new';

/** What the form edits: the profile's name, whether it is shared and a row for every project of the solution */
interface Draft {
    name: string;
    shared: boolean;
    rows: StartupRow[];
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The solution's projects as rows: the profile's own in its order, the others after them with no action */
function draftOf(state: StartupProjectsState, profile: StartupProfileEntry | undefined, newName: string): Draft {
    const rows: StartupRow[] = [];
    for (const row of profile?.projects ?? []) {
        const project = state.projects.find(candidate => candidate.path.toLowerCase() === row.path.toLowerCase());
        if (project && !rows.some(listed => listed.path === project.path)) {
            rows.push({ ...row, path: project.path });
        }
    }
    for (const project of state.projects) {
        if (!rows.some(row => row.path === project.path)) {
            rows.push({ path: project.path, action: 'None' });
        }
    }
    return { name: profile?.name ?? newName, shared: profile?.shared ?? false, rows };
}

/** "Startup", then "Startup 2", ...: a name no profile has */
function freshName(profiles: readonly StartupProfileEntry[]): string {
    for (let n = 1; ; n++) {
        const name = n === 1 ? 'Startup' : `Startup ${n}`;
        if (!profiles.some(profile => sameName(profile.name, name))) {
            return name;
        }
    }
}

/** Visual Studio's Configure Startup Projects: the single startup project, or a multi-project launch profile */
export const App: React.FC<{ api: StartupProjectsApi }> = ({ api }) => {
    const [state, setState] = useState<StartupProjectsState>();
    const [error, setError] = useState<string>();
    const [mode, setMode] = useState<'single' | 'multiple'>();
    const [selected, setSelected] = useState<Selection>();
    const [draft, setDraft] = useState<Draft>();
    const [pending, setPending] = useState(false);
    const applying = useRef(false);
    const hasActive = !!state?.active;

    useEffect(() => {
        const onMessage = (event: MessageEvent<StartupProjectsMessage>) => {
            const message = event.data;
            switch (message.type) {
                case 'state':
                    setState(message.state);
                    setError(undefined);
                    if (applying.current) {
                        // The answer to Apply: the form shows what was written
                        applying.current = false;
                        setDraft(undefined);
                    }
                    setPending(false);
                    break;
                case 'error':
                    setError(message.message);
                    applying.current = false;
                    setPending(false);
                    break;
            }
        };
        window.addEventListener('message', onMessage);
        api.postMessage({ type: 'ready' });
        return () => window.removeEventListener('message', onMessage);
    }, [api]);

    // Another way of choosing (the picker, "Set as Startup Project") decides the radio again
    useEffect(() => setMode(undefined), [hasActive]);

    if (!state) {
        return <h1>Configure Startup Projects</h1>;
    }

    const shownMode = mode ?? (state.active ? 'multiple' : 'single');
    const find = (key: { name: string; shared: boolean }) => state.profiles.find(profile => profile.name === key.name && profile.shared === key.shared);
    const current: StartupProfileEntry | 'new' = selected === 'new' ? 'new'
        : (selected && find(selected)) || (selected ? undefined : (state.active && find(state.active)) || state.profiles[0]) || 'new';
    const original = current === 'new' ? undefined : current;
    const baseline = draftOf(state, original, freshName(state.profiles));
    const shown = draft ?? baseline;
    const dirty = current === 'new' || JSON.stringify(shown) !== JSON.stringify(baseline);
    const duplicate = state.profiles.some(profile => profile !== original && sameName(profile.name, shown.name));
    const nameProblem = !shown.name.trim() ? 'Give the profile a name.' : duplicate ? 'A profile with this name exists.' : undefined;
    const edit = (patch: Partial<Draft>) => setDraft({ ...shown, ...patch });
    const select = (selection: Selection) => { setSelected(selection); setDraft(undefined); };

    const startable = state.startable.map(path => ({ value: path, label: state.projects.find(project => project.path === path)?.name ?? path }));
    const single = state.singleProject && state.startable.includes(state.singleProject) ? state.singleProject : '';

    const apply = () => {
        applying.current = true;
        setPending(true);
        setSelected({ name: shown.name.trim(), shared: shown.shared });
        api.postMessage({
            type: 'applyProfile',
            original: original && { name: original.name, shared: original.shared },
            profile: { name: shown.name, shared: shown.shared, projects: shown.rows },
        });
    };

    return (
        <>
            <h1>Configure Startup Projects</h1>
            {error && (
                <div className="error" role="alert">
                    {error} <button className="action" onClick={() => setError(undefined)}>Dismiss</button>
                </div>
            )}
            {state.unreadable.map(message => <div key={message} className="error" role="alert">{message}</div>)}

            <div className="check">
                <label>
                    <input type="radio" name="mode" checked={shownMode === 'single'}
                        onChange={() => { setMode('single'); if (state.active) { api.postMessage({ type: 'useSingle' }); } }} />
                    {' '}Single startup project
                </label>
            </div>
            <div style={{ maxWidth: 360, margin: '4px 0 8px 24px' }}>
                <Select aria-label="Single startup project" value={single} disabled={startable.length === 0}
                    options={single || startable.length === 0 ? startable : [{ value: '', label: '(none)' }, ...startable]}
                    onChange={project => { if (project) { setMode('single'); api.postMessage({ type: 'setSingle', project }); } }} />
            </div>
            <div className="check">
                <label>
                    <input type="radio" name="mode" checked={shownMode === 'multiple'} onChange={() => setMode('multiple')} />
                    {' '}Multiple startup projects
                </label>
            </div>

            {shownMode === 'multiple' && (
                <>
                    <h2>Profiles</h2>
                    <ul className="names" aria-label="Profiles">
                        {state.profiles.map(profile => {
                            const isSelected = profile === original;
                            const isActive = state.active?.name === profile.name && state.active.shared === profile.shared;
                            return (
                                <li key={`${profile.shared}|${profile.name}`}>
                                    <button className="template" aria-selected={isSelected}
                                        onClick={() => select({ name: profile.name, shared: profile.shared })}>
                                        {profile.name}
                                        <span className="meta">{[profile.shared ? '' : 'user file', isActive ? 'active' : ''].filter(Boolean).join(', ')}</span>
                                    </button>
                                </li>
                            );
                        })}
                        {current === 'new' && <li><span className="name">(new profile)</span></li>}
                    </ul>
                    <div className="toolbar">
                        <button className="action" onClick={() => select('new')}>New profile</button>
                        <button className="action" disabled={!original}
                            onClick={() => original && api.postMessage({ type: 'deleteProfile', name: original.name, shared: original.shared })}>Delete</button>
                    </div>

                    <div className="field">
                        <label htmlFor="profile-name">Profile name</label>
                        <input id="profile-name" type="text" style={{ maxWidth: 360 }} value={shown.name} onChange={e => edit({ name: e.target.value })} />
                        {nameProblem && <span className="hint" role="status">{nameProblem}</span>}
                    </div>
                    <div className="check">
                        <label>
                            <input type="checkbox" checked={shown.shared} onChange={e => edit({ shared: e.target.checked })} />
                            {' '}Share profile (the .slnLaunch file next to the solution, for source control; otherwise a file only you have)
                        </label>
                    </div>
                    <ProfileTable projects={state.projects} rows={shown.rows} onChange={rows => edit({ rows })} />
                    <div className="buttons">
                        {dirty && <span className="status" role="status">Unsaved changes</span>}
                        <button className="action primary" disabled={!dirty || !!nameProblem || pending} onClick={apply}>Apply</button>
                    </div>
                </>
            )}
        </>
    );
};
