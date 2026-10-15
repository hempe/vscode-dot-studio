import React, { useEffect, useMemo, useState } from 'react';
import { TemplateOption, WizardInit, WizardMessage, WizardRequest, WizardTemplate } from '../../types/templateWizard';
import { Select } from '../shared/Select';

export interface WizardApi {
    postMessage(message: WizardRequest): void;
}

type Values = Record<string, string | boolean>;

/** Option values to start with: the template defaults, or the wizard's preference where the option allows it */
export function initialValues(template: WizardTemplate, preferred: Record<string, string>): Values {
    const values: Values = {};
    for (const option of template.options) {
        const preference = preferred[option.name];
        const usable = preference !== undefined && (option.type !== 'choice' || option.choices?.some(choice => choice.value === preference));
        const value = usable ? preference : option.defaultValue ?? '';
        values[option.name] = option.type === 'bool' ? value.toLowerCase() === 'true' : value;
    }
    return values;
}

function matches(template: WizardTemplate, search: string, category: string): boolean {
    if (category && template.tags[0] !== category) {
        return false;
    }
    const term = search.trim().toLowerCase();
    return !term || [template.name, template.shortName ?? '', template.description, ...template.tags].some(text => text.toLowerCase().includes(term));
}

const TemplateList: React.FC<{
    templates: WizardTemplate[];
    selectedId?: string;
    onSelect(template: WizardTemplate): void;
    onConfirm(template: WizardTemplate): void;
    showRecent: boolean;
}> = ({ templates, selectedId, onSelect, onConfirm, showRecent }) => {
    if (templates.length === 0) {
        return <div className="empty">No templates match.</div>;
    }
    const recent = showRecent ? templates.filter(t => t.recent) : [];
    const rest = showRecent ? templates.filter(t => !t.recent) : templates;
    const row = (template: WizardTemplate) => (
        <button
            key={template.id}
            className="template"
            role="option"
            aria-selected={template.id === selectedId}
            onClick={() => onSelect(template)}
            onDoubleClick={() => onConfirm(template)}
        >
            {template.name}
            <span className="meta">{[template.language, template.tags.join(', ')].filter(Boolean).join(' · ')}</span>
        </button>
    );
    return (
        <div role="listbox" aria-label="Templates">
            {recent.length > 0 && <div className="group">Recently used</div>}
            {recent.map(row)}
            {recent.length > 0 && <div className="group">All templates</div>}
            {rest.map(row)}
        </div>
    );
};

const OptionField: React.FC<{ option: TemplateOption; value: string | boolean; onChange(value: string | boolean): void }> = ({ option, value, onChange }) => {
    const id = `option-${option.name}`;
    if (option.type === 'bool') {
        return (
            <div className="check">
                <input id={id} type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} />
                <label htmlFor={id}>{option.label} <span className="meta">(--{option.name})</span></label>
            </div>
        );
    }
    return (
        <div className="field">
            <label htmlFor={id}>{option.name}</label>
            {option.type === 'choice'
                ? (
                    <Select id={id} value={String(value)} onChange={onChange}
                        options={(option.choices ?? []).map(choice => ({ value: choice.value, label: choice.description ? `${choice.value} - ${choice.description}` : choice.value }))} />
                )
                : <input id={id} type="text" value={String(value)} onChange={e => onChange(e.target.value)} />}
            <div className="hint">{option.label}</div>
        </div>
    );
};

/** Choices and switches first; text options (connection details and the like) under "More options" */
const OptionsForm: React.FC<{ template: WizardTemplate; values: Values; onChange(name: string, value: string | boolean): void }> = ({ template, values, onChange }) => {
    const main = template.options.filter(o => o.type === 'choice' || o.type === 'bool');
    const more = template.options.filter(o => o.type === 'text' || o.type === 'number');
    const field = (option: TemplateOption) => (
        <OptionField key={option.name} option={option} value={values[option.name] ?? ''} onChange={value => onChange(option.name, value)} />
    );
    return (
        <>
            {main.map(field)}
            {more.length > 0 && (
                <details>
                    <summary>More options ({more.length})</summary>
                    {more.map(field)}
                </details>
            )}
        </>
    );
};

export const App: React.FC<{ api: WizardApi }> = ({ api }) => {
    const [init, setInit] = useState<WizardInit>();
    const [page, setPage] = useState<'choose' | 'configure'>('choose');
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('');
    const [selected, setSelected] = useState<WizardTemplate>();
    const [name, setName] = useState('');
    const [location, setLocation] = useState('');
    const [locationEdited, setLocationEdited] = useState(false);
    const [values, setValues] = useState<Values>({});
    // New solution only: its name follows the project name until edited, like Visual Studio's
    const [solutionName, setSolutionName] = useState('');
    const [solutionNameEdited, setSolutionNameEdited] = useState(false);
    const [sameDirectory, setSameDirectory] = useState(false);
    const [error, setError] = useState<string>();
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const listener = (event: MessageEvent<WizardMessage>) => {
            const message = event.data;
            switch (message.type) {
                case 'init':
                    setInit(message.payload);
                    break;
                case 'busy':
                    setBusy(message.busy);
                    break;
                case 'error':
                    setError(message.message);
                    break;
                case 'folderPicked':
                    setLocation(message.path);
                    setLocationEdited(true);
                    break;
            }
        };
        window.addEventListener('message', listener);
        api.postMessage({ type: 'ready' });
        return () => window.removeEventListener('message', listener);
    }, [api]);

    const projectLocation = (projectName: string) => init?.newSolution ? init.location
        : init?.location ? `${init.location}/${projectName}` : projectName;

    const select = (template: WizardTemplate) => {
        if (!init) {
            return;
        }
        setSelected(template);
        setName(template.defaultName);
        setValues(initialValues(template, init.preferredValues));
        setError(undefined);
        if (!solutionNameEdited) {
            setSolutionName(template.defaultName);
        }
        if (!locationEdited) {
            setLocation(projectLocation(template.defaultName));
        }
    };

    const categories = useMemo(() => [...new Set((init?.templates ?? []).map(t => t.tags[0]).filter(Boolean))].sort(), [init]);
    const visible = useMemo(() => (init?.templates ?? []).filter(t => matches(t, search, category)), [init, search, category]);

    if (!init) {
        return <>{error ? <div className="error">{error}</div> : <p>Loading templates...</p>}</>;
    }

    const isProject = init.kind === 'project';
    const nameMissing = selected?.needsName !== false && !name.trim();
    const create = () => {
        if (!selected || nameMissing || busy) {
            return;
        }
        setError(undefined);
        api.postMessage({
            type: 'create', templateId: selected.id, name: name.trim(), values,
            ...(isProject ? { location: location.trim() || projectLocation(name.trim()) } : {}),
            ...(init.newSolution ? { solutionName: solutionName.trim() || name.trim(), sameDirectory } : {}),
        });
    };

    const chooser = (
        <>
            <div className="toolbar">
                <input type="text" placeholder="Search templates" aria-label="Search templates" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
                <Select aria-label="Category" value={category} onChange={setCategory}
                    options={[{ value: '', label: 'All categories' }, ...categories.map(c => ({ value: c, label: c }))]} />
            </div>
            <div className="layout">
                <div className="templates">
                    <TemplateList
                        templates={visible}
                        selectedId={selected?.id}
                        onSelect={select}
                        onConfirm={template => { select(template); if (isProject) { setPage('configure'); } }}
                        showRecent={isProject && !search && !category}
                    />
                </div>
                <div className="details">
                    {selected ? (
                        <>
                            <h2>{selected.name}</h2>
                            <div className="description">{selected.description}</div>
                        </>
                    ) : (
                        <div className="description">Select a template to see what it creates.</div>
                    )}
                </div>
            </div>
        </>
    );

    const nameField = selected?.needsName !== false && (
        <div className="field">
            <label htmlFor="name">{isProject ? 'Project name' : 'Name'}</label>
            <input
                id="name"
                type="text"
                value={name}
                onChange={e => {
                    setName(e.target.value);
                    if (isProject && !locationEdited) {
                        setLocation(projectLocation(e.target.value.trim()));
                    }
                    if (init.newSolution && !solutionNameEdited) {
                        setSolutionName(e.target.value);
                    }
                }}
                onKeyDown={e => { if (e.key === 'Enter' && (!isProject || page === 'configure')) { create(); } }}
            />
        </div>
    );

    const errorBox = error && <div className="error" role="alert">{error}</div>;
    const cancel = <button className="action" onClick={() => api.postMessage({ type: 'cancel' })}>Cancel</button>;

    if (!isProject) {
        return (
            <>
                <h1>{init.title}</h1>
                {chooser}
                {selected && (
                    <>
                        {nameField}
                        <OptionsForm template={selected} values={values} onChange={(option, value) => setValues(v => ({ ...v, [option]: value }))} />
                    </>
                )}
                {errorBox}
                <div className="buttons">
                    {cancel}
                    <button className="action primary" disabled={!selected || nameMissing || busy} onClick={create}>{busy ? 'Adding...' : 'Add'}</button>
                </div>
            </>
        );
    }

    if (page === 'choose' || !selected) {
        return (
            <>
                <h1>{init.title}</h1>
                {chooser}
                {errorBox}
                <div className="buttons">
                    {cancel}
                    <button className="action primary" disabled={!selected} onClick={() => setPage('configure')}>Next</button>
                </div>
            </>
        );
    }

    return (
        <>
            <h1>Configure your new project</h1>
            <h2>{selected.name}</h2>
            {nameField}
            <div className="field">
                <label htmlFor="location">Location</label>
                {init.newSolution ? (
                    <div className="toolbar">
                        <input id="location" type="text" value={location} onChange={e => { setLocation(e.target.value); setLocationEdited(true); }} />
                        <button className="action" onClick={() => api.postMessage({ type: 'browseFolder', current: location })}>Browse...</button>
                    </div>
                ) : (
                    <input id="location" type="text" value={location} onChange={e => { setLocation(e.target.value); setLocationEdited(true); }} />
                )}
                <div className="hint">{init.newSolution ? 'The folder the solution goes in' : 'Relative to the solution folder'}</div>
            </div>
            {init.newSolution && (
                <>
                    <div className="field">
                        <label htmlFor="solution-name">Solution name</label>
                        <input id="solution-name" type="text" value={sameDirectory ? name : solutionName} disabled={sameDirectory}
                            onChange={e => { setSolutionName(e.target.value); setSolutionNameEdited(true); }} />
                    </div>
                    <div className="check">
                        <input id="same-directory" type="checkbox" checked={sameDirectory} onChange={e => setSameDirectory(e.target.checked)} />
                        <label htmlFor="same-directory">Place solution and project in the same directory</label>
                    </div>
                </>
            )}
            <OptionsForm template={selected} values={values} onChange={(option, value) => setValues(v => ({ ...v, [option]: value }))} />
            {errorBox}
            <div className="buttons">
                <button className="action" disabled={busy} onClick={() => setPage('choose')}>Back</button>
                {cancel}
                <button className="action primary" disabled={nameMissing || busy} onClick={create}>{busy ? 'Creating...' : 'Create'}</button>
            </div>
        </>
    );
};
