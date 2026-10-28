import React, { useEffect, useState } from 'react';
import { FolderSettings, PublishInit, PublishMessage, PublishProfileView, PublishRequest } from '../../types/publish';
import { Select } from '../shared/Select';

export interface PublishApi {
    postMessage(message: PublishRequest): void;
}

type Status = { readonly kind: 'publishing' } | { readonly kind: 'published'; readonly succeeded: boolean };

/** Keeps the settings consistent like Visual Studio's dialog: what needs a runtime or self-contained goes without them */
export function normalize(settings: FolderSettings, hostRuntime: string): FolderSettings {
    const runtimeIdentifier = settings.selfContained && !settings.runtimeIdentifier ? hostRuntime : settings.runtimeIdentifier;
    const hasRuntime = !!runtimeIdentifier;
    const selfContained = settings.selfContained && hasRuntime;
    return {
        ...settings,
        runtimeIdentifier,
        selfContained,
        singleFile: settings.singleFile && hasRuntime,
        readyToRun: settings.readyToRun && hasRuntime,
        trimmed: settings.trimmed && selfContained,
    };
}

const fileOptions = (settings: FolderSettings) => [
    settings.deleteExistingFiles && 'Delete existing files',
    settings.singleFile && 'Single file',
    settings.readyToRun && 'ReadyToRun',
    settings.trimmed && 'Trimmed',
].filter(Boolean).join(', ') || 'None';

const FolderField: React.FC<{ id: string; label: string; value: string; onChange(value: string): void; onBrowse(): void }> = ({ id, label, value, onChange, onBrowse }) => (
    <div className="field">
        <label htmlFor={id}>{label}</label>
        <div className="toolbar">
            <input id={id} type="text" value={value} onChange={e => onChange(e.target.value)} />
            <button className="action" onClick={onBrowse}>Browse...</button>
        </div>
    </div>
);

const SelectField: React.FC<{ id: string; label: string; value: string; options: [string, string][]; onChange(value: string): void }> = ({ id, label, value, options, onChange }) => (
    <div className="field">
        <label htmlFor={id}>{label}</label>
        <Select id={id} value={value} onChange={onChange} options={options.map(([optionValue, optionLabel]) => ({ value: optionValue, label: optionLabel }))} />
    </div>
);

const Check: React.FC<{ id: string; label: string; checked: boolean; disabled?: boolean; onChange(checked: boolean): void }> = ({ id, label, checked, disabled, onChange }) => (
    <div className="check">
        <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
        <label htmlFor={id}>{label}</label>
    </div>
);

/** Visual Studio's profile settings dialog for Folder profiles */
const SettingsForm: React.FC<{
    init: PublishInit;
    initial: FolderSettings;
    pickedFolder?: string;
    onBrowse(current: string): void;
    onSave(settings: FolderSettings): void;
    onCancel(): void;
}> = ({ init, initial, pickedFolder, onBrowse, onSave, onCancel }) => {
    const [settings, setSettings] = useState(initial);
    const update = (changes: Partial<FolderSettings>) => setSettings(current => normalize({ ...current, ...changes }, init.hostRuntime));
    useEffect(() => {
        if (pickedFolder !== undefined) {
            setSettings(current => normalize({ ...current, publishDir: pickedFolder }, init.hostRuntime));
        }
    }, [pickedFolder, init.hostRuntime]);
    const frameworks = settings.targetFramework && !init.frameworks.includes(settings.targetFramework)
        ? [settings.targetFramework, ...init.frameworks] : init.frameworks;
    const configurations = init.configurations.includes(settings.configuration) ? init.configurations : [settings.configuration, ...init.configurations];

    return (
        <section>
            <h2>Profile settings</h2>
            <SelectField id="configuration" label="Configuration" value={settings.configuration}
                options={configurations.map(c => [c, c])} onChange={configuration => update({ configuration })} />
            <SelectField id="framework" label="Target framework" value={settings.targetFramework ?? ''}
                options={frameworks.map(f => [f, f])} onChange={targetFramework => update({ targetFramework })} />
            <SelectField id="deployment" label="Deployment mode" value={settings.selfContained ? 'self-contained' : 'framework-dependent'}
                options={[['framework-dependent', 'Framework-dependent'], ['self-contained', 'Self-contained']]}
                onChange={mode => update({ selfContained: mode === 'self-contained' })} />
            <SelectField id="runtime" label="Target runtime" value={settings.runtimeIdentifier ?? ''}
                options={[['', 'Portable'], ...init.runtimes.map((r): [string, string] => [r, r])]}
                onChange={runtime => update({ runtimeIdentifier: runtime || undefined, ...(runtime ? {} : { selfContained: false }) })} />
            <FolderField id="location" label="Target location" value={settings.publishDir}
                onChange={publishDir => update({ publishDir })} onBrowse={() => onBrowse(settings.publishDir)} />
            <h2>File publish options</h2>
            <Check id="delete-existing" label="Delete all existing files prior to publish" checked={settings.deleteExistingFiles}
                onChange={deleteExistingFiles => update({ deleteExistingFiles })} />
            <Check id="single-file" label="Produce single file" checked={settings.singleFile} disabled={!settings.runtimeIdentifier}
                onChange={singleFile => update({ singleFile })} />
            <Check id="ready-to-run" label="Enable ReadyToRun compilation" checked={settings.readyToRun} disabled={!settings.runtimeIdentifier}
                onChange={readyToRun => update({ readyToRun })} />
            <Check id="trim" label="Trim unused code" checked={settings.trimmed} disabled={!settings.selfContained}
                onChange={trimmed => update({ trimmed })} />
            <div className="buttons">
                <button className="action" onClick={onCancel}>Cancel</button>
                <button className="action primary" disabled={!settings.publishDir.trim()} onClick={() => onSave(settings)}>Save</button>
            </div>
        </section>
    );
};

/** The first step of a new profile: Visual Studio's Folder target asks for the location */
const NewProfile: React.FC<{ init: PublishInit; pickedFolder?: string; onBrowse(current: string): void; onFinish(publishDir: string): void; onCancel?: () => void }> = (
    { init, pickedFolder, onBrowse, onFinish, onCancel }) => {
    const [location, setLocation] = useState(init.newProfile.publishDir);
    useEffect(() => {
        if (pickedFolder !== undefined) {
            setLocation(pickedFolder);
        }
    }, [pickedFolder]);
    return (
        <section>
            <h2>Publish to a folder</h2>
            <p className="note">Publishes the app to a local folder or file share, for copying to a server or a container. Other targets (Azure, container registries, FTP, IIS) come later.</p>
            <FolderField id="new-location" label="Folder location" value={location} onChange={setLocation} onBrowse={() => onBrowse(location)} />
            <div className="buttons">
                {onCancel && <button className="action" onClick={onCancel}>Cancel</button>}
                <button className="action primary" disabled={!location.trim()} onClick={() => onFinish(location.trim())}>Finish</button>
            </div>
        </section>
    );
};

const Summary: React.FC<{ profile: PublishProfileView; status?: Status; api: PublishApi }> = ({ profile, status, api }) => {
    if (profile.target !== 'Folder') {
        return (
            <p className="note">
                This profile publishes with {profile.target} (Azure, a container registry, FTP or IIS), which is not supported yet; it is planned.
                Visual Studio can publish it. <a className="link" onClick={() => api.postMessage({ type: 'openProfile', profile: profile.name })}>Open .pubxml</a>
            </p>
        );
    }
    const { settings } = profile;
    return (
        <>
            {status?.kind === 'publishing' && <div className="status">Publishing... the output is in the terminal.</div>}
            {status?.kind === 'published' && (status.succeeded
                ? <div className="status ok">Published. <a className="link" onClick={() => api.postMessage({ type: 'openFolder', profile: profile.name })}>Open folder</a></div>
                : <div className="status failed">Publish failed. See the terminal and the Error List.</div>)}
            {!status && <div className="status">{profile.lastPublished ? `Last published ${new Date(profile.lastPublished).toLocaleString()}.` : 'Ready to publish.'}</div>}
            <dl className="summary">
                <dt>Target</dt><dd>Folder</dd>
                <dt>Target location</dt><dd>{profile.publishFolder}</dd>
                <dt>Configuration</dt><dd>{settings.configuration}</dd>
                <dt>Target framework</dt><dd>{settings.targetFramework ?? 'Default'}</dd>
                <dt>Deployment mode</dt><dd>{settings.selfContained ? 'Self-contained' : 'Framework-dependent'}</dd>
                <dt>Target runtime</dt><dd>{settings.runtimeIdentifier ?? 'Portable'}</dd>
                <dt>File publish options</dt><dd>{fileOptions(settings)}</dd>
            </dl>
        </>
    );
};

export const App: React.FC<{ api: PublishApi }> = ({ api }) => {
    const [init, setInit] = useState<PublishInit>();
    const [selected, setSelected] = useState<string>();
    const [mode, setMode] = useState<'summary' | 'settings' | 'new'>('summary');
    const [status, setStatus] = useState<Record<string, Status>>({});
    const [pickedFolder, setPickedFolder] = useState<string>();
    const [error, setError] = useState<string>();

    useEffect(() => {
        const onMessage = (event: MessageEvent<PublishMessage>) => {
            const message = event.data;
            switch (message.type) {
                case 'init':
                    setInit(message.payload);
                    setSelected(current => message.payload.selected
                        ?? (message.payload.profiles.some(p => p.name === current) ? current : message.payload.profiles[0]?.name));
                    setMode('summary');
                    setPickedFolder(undefined);
                    setError(undefined);
                    break;
                case 'publishing':
                    setStatus(current => ({ ...current, [message.profile]: { kind: 'publishing' } }));
                    break;
                case 'published':
                    setStatus(current => ({ ...current, [message.profile]: { kind: 'published', succeeded: message.succeeded } }));
                    break;
                case 'folderPicked':
                    setPickedFolder(message.path);
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

    if (!init) {
        return <h1>Publish</h1>;
    }
    const profile = init.profiles.find(p => p.name === selected);
    const browse = (current: string) => {
        setPickedFolder(undefined);
        api.postMessage({ type: 'browseFolder', current });
    };
    const publishing = profile && status[profile.name]?.kind === 'publishing';

    return (
        <>
            <h1>Publish {init.projectName}</h1>
            {error && <div className="error">{error}</div>}
            {!profile || mode === 'new' ? (
                <NewProfile init={init} pickedFolder={pickedFolder} onBrowse={browse}
                    onFinish={publishDir => api.postMessage({ type: 'createProfile', publishDir })}
                    onCancel={profile ? () => setMode('summary') : undefined} />
            ) : mode === 'settings' ? (
                <SettingsForm key={profile.name} init={init} initial={profile.settings} pickedFolder={pickedFolder} onBrowse={browse}
                    onSave={settings => api.postMessage({ type: 'saveSettings', profile: profile.name, settings })}
                    onCancel={() => setMode('summary')} />
            ) : (
                <section>
                    <div className="toolbar">
                        <Select aria-label="Publish profile" value={profile.name} onChange={setSelected}
                            options={init.profiles.map(p => ({ value: p.name, label: p.name }))} />
                        <button className="action primary" disabled={publishing || profile.target !== 'Folder'}
                            onClick={() => api.postMessage({ type: 'publish', profile: profile.name })}>
                            {publishing ? 'Publishing...' : 'Publish'}
                        </button>
                        <button className="action" onClick={() => setMode('new')}>New profile</button>
                    </div>
                    <div className="toolbar">
                        <a className="link" onClick={() => api.postMessage({ type: 'renameProfile', profile: profile.name })}>Rename</a>
                        <a className="link" onClick={() => api.postMessage({ type: 'deleteProfile', profile: profile.name })}>Delete</a>
                        <a className="link" onClick={() => api.postMessage({ type: 'openProfile', profile: profile.name })}>Open .pubxml</a>
                    </div>
                    <Summary profile={profile} status={status[profile.name]} api={api} />
                    {profile.target === 'Folder' && (
                        <button className="action" onClick={() => { setPickedFolder(undefined); setMode('settings'); }}>Show all settings</button>
                    )}
                </section>
            )}
        </>
    );
};
