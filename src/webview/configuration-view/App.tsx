import React, { useEffect, useState } from 'react';
import { ConfigurationManagerMessage, ConfigurationManagerRequest, ConfigurationManagerState } from '../../types/configurationManager';
import { Select } from '../shared/Select';
import { ConfigurationList } from './ConfigurationList';
import { ProjectGrid } from './ProjectGrid';

export interface ConfigurationManagerApi {
    postMessage(message: ConfigurationManagerRequest): void;
}

/** Visual Studio's Configuration Manager: active configuration and platform, their lists, and the per-project mapping */
export const App: React.FC<{ api: ConfigurationManagerApi }> = ({ api }) => {
    const [state, setState] = useState<ConfigurationManagerState>();
    const [error, setError] = useState<string>();
    const [editing, setEditing] = useState({ configurations: false, platforms: false });

    useEffect(() => {
        const onMessage = (event: MessageEvent<ConfigurationManagerMessage>) => {
            const message = event.data;
            switch (message.type) {
                case 'state':
                    setState(message.state);
                    setError(undefined);
                    break;
                case 'error':
                    setError(message.message);
                    break;
            }
        };
        window.addEventListener('message', onMessage);
        api.postMessage({ type: 'ready' });
        return () => window.removeEventListener('message', onMessage);
    }, [api]);

    if (!state) {
        return <h1>Configuration Manager</h1>;
    }
    const toggle = (key: 'configurations' | 'platforms') => setEditing(current => ({ ...current, [key]: !current[key] }));
    const setActive = (configuration: string, platform: string) => api.postMessage({ type: 'setActive', configuration, platform });

    return (
        <>
            <h1>Configuration Manager</h1>
            {error && (
                <div className="error" role="alert">
                    {error} <button className="action" onClick={() => setError(undefined)}>Dismiss</button>
                </div>
            )}
            <div className="field">
                <label htmlFor="active-configuration">Active solution configuration</label>
                <Select id="active-configuration" aria-label="Active solution configuration" value={state.activeConfiguration}
                    options={state.configurations.map(name => ({ value: name, label: name }))}
                    onChange={configuration => setActive(configuration, state.activePlatform)} />
            </div>
            {state.platforms.length > 1 && (
                <div className="field">
                    <label htmlFor="active-platform">Active solution platform</label>
                    <Select id="active-platform" aria-label="Active solution platform" value={state.activePlatform}
                        options={state.platforms.map(name => ({ value: name, label: name }))}
                        onChange={platform => setActive(state.activeConfiguration, platform)} />
                </div>
            )}
            <div className="toolbar">
                <button className="action" aria-expanded={editing.configurations} onClick={() => toggle('configurations')}>Edit Configurations...</button>
                <button className="action" aria-expanded={editing.platforms} onClick={() => toggle('platforms')}>Edit Platforms...</button>
            </div>
            {editing.configurations && <ConfigurationList kind="configuration" names={state.configurations} active={state.activeConfiguration} post={api.postMessage.bind(api)} />}
            {editing.platforms && <ConfigurationList kind="platform" names={state.platforms} active={state.activePlatform} post={api.postMessage.bind(api)} />}
            <h2>Project contexts</h2>
            <ProjectGrid state={state} post={api.postMessage.bind(api)} />
        </>
    );
};
