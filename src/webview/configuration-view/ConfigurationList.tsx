import React, { useState } from 'react';
import { ConfigurationManagerRequest } from '../../types/configurationManager';
import { Select } from '../shared/Select';

interface Props {
    kind: 'configuration' | 'platform';
    names: string[];
    active: string;
    post(request: ConfigurationManagerRequest): void;
}

/** The Add/Rename/Remove editor of the solution configurations or platforms */
export const ConfigurationList: React.FC<Props> = ({ kind, names, active, post }) => {
    const [renaming, setRenaming] = useState<string>();
    const [draft, setDraft] = useState('');
    const [newName, setNewName] = useState('');
    const [chosenCopy, setChosenCopy] = useState<string>();
    const copyFrom = chosenCopy && names.includes(chosenCopy) ? chosenCopy : active;
    const noun = kind === 'configuration' ? 'configuration' : 'platform';

    const commitRename = (from: string) => {
        const to = draft.trim();
        setRenaming(undefined);
        if (to && to !== from) {
            post(kind === 'configuration' ? { type: 'renameConfiguration', from, to } : { type: 'renamePlatform', from, to });
        }
    };
    const add = () => {
        const name = newName.trim();
        if (!name) {
            return;
        }
        post(kind === 'configuration' ? { type: 'addConfiguration', name, copyFrom } : { type: 'addPlatform', name, copyFrom });
        setNewName('');
    };

    return (
        <section>
            <h2>{kind === 'configuration' ? 'Solution configurations' : 'Solution platforms'}</h2>
            <ul className="names">
                {names.map(name => (
                    <li key={name}>
                        {renaming === name ? (
                            <input type="text" aria-label={`New name for ${name}`} value={draft} autoFocus
                                onChange={e => setDraft(e.target.value)}
                                onBlur={() => setRenaming(undefined)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                        commitRename(name);
                                    } else if (e.key === 'Escape') {
                                        e.stopPropagation();
                                        setRenaming(undefined);
                                    }
                                }} />
                        ) : <span className="name">{name}</span>}
                        <button className="action" aria-label={`Rename ${name}`} onClick={() => { setDraft(name); setRenaming(name); }}>Rename</button>
                        <button className="action" aria-label={`Remove ${name}`} disabled={names.length <= 1}
                            onClick={() => post(kind === 'configuration' ? { type: 'removeConfiguration', name } : { type: 'removePlatform', name })}>Remove</button>
                    </li>
                ))}
            </ul>
            <div className="toolbar add-row">
                <input type="text" aria-label={`New ${noun} name`} placeholder={`New ${noun}`} value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { add(); } }} />
                <label>Copy settings from</label>
                <Select aria-label="Copy settings from" value={copyFrom} onChange={setChosenCopy}
                    options={names.map(name => ({ value: name, label: name }))} />
                <button className="action primary" disabled={!newName.trim()} onClick={add}>Add</button>
            </div>
        </section>
    );
};
