import React, { useState } from 'react';
import { Button, Checkbox, TextField } from 'vscrui';
import { Select } from '../../shared/Select';
import { ManagedSource } from '../../../services/nuget/types';

interface SourcesViewProps {
    sources: readonly ManagedSource[] | undefined;
    error?: string;
    onAdd(name: string, url: string, location: 'user' | 'solution'): void;
    onRemove(name: string): void;
    onSetEnabled(name: string, enabled: boolean): void;
}

const fileName = (file: string) => file.split(/[\\/]/).slice(-2).join('/');

/** The Sources tab (setting `shinobi.nuget.packageSources`): the feeds of the NuGet.Config files, add, remove, enable, disable */
export const SourcesView: React.FC<SourcesViewProps> = ({ sources, error, onAdd, onRemove, onSetEnabled }) => {
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [location, setLocation] = useState<'user' | 'solution'>('user');

    const add = () => {
        onAdd(name, url, location);
        setName('');
        setUrl('');
    };

    return (
        <div style={{ padding: '12px 4px', maxWidth: 900 }}>
            {error && <div role="alert" style={{ marginBottom: 8, color: 'var(--vscode-errorForeground)' }}>{error}</div>}
            {sources === undefined ? <div>Loading package sources...</div> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                        <tr style={{ textAlign: 'left', color: 'var(--vscode-descriptionForeground)' }}>
                            <th style={{ width: 28 }} />
                            <th>Name</th>
                            <th>Source</th>
                            <th>Defined in</th>
                            <th style={{ width: 80 }} />
                        </tr>
                    </thead>
                    <tbody>
                        {sources.map(source => (
                            <tr key={source.name} style={{ borderTop: '1px solid var(--vscode-panel-border)', opacity: source.enabled ? 1 : 0.6 }}>
                                <td><Checkbox checked={source.enabled} onChange={enabled => onSetEnabled(source.name, enabled)} /></td>
                                <td style={{ padding: '4px 8px 4px 0' }}>{source.name}</td>
                                <td style={{ padding: '4px 8px 4px 0', wordBreak: 'break-all' }}>{source.url}</td>
                                <td style={{ padding: '4px 8px 4px 0', color: 'var(--vscode-descriptionForeground)' }} title={source.file}>
                                    {source.file ? fileName(source.file) : 'machine-wide or unknown'}
                                </td>
                                <td><Button appearance="secondary" onClick={() => onRemove(source.name)}>Remove</Button></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            <div style={{ marginTop: 16, fontWeight: 'bold' }}>Add a package source</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <TextField value={name} onChange={setName} placeholder="Name" style={{ width: 160 }} />
                <TextField value={url} onChange={setUrl} placeholder="https://.../index.json or a folder" style={{ flex: 1, minWidth: 240 }} />
                <Select aria-label="Where to save the source" value={location} onChange={value => setLocation(value === 'solution' ? 'solution' : 'user')}
                    options={[{ value: 'user', label: 'Your NuGet.Config' }, { value: 'solution', label: "The solution's nuget.config" }]} />
                <Button onClick={add} disabled={!name.trim() || !url.trim()}>Add</Button>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--vscode-descriptionForeground)' }}>
                Disabling a source writes to your NuGet.Config and applies to every solution. Credentials: use the token prompt when a feed asks for them.
            </div>
        </div>
    );
};
