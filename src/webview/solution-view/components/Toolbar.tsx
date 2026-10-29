import React from 'react';
import { ToolbarAction, ToolbarChoice, ToolbarState } from '../../../types/toolbar';
import { MenuButton, MenuItem } from '../../shared/MenuButton';

interface ToolbarProps {
    state: ToolbarState | null;
    onAction: (action: ToolbarAction) => void;
    /** A choice of the configuration menu */
    onChoose: (choice: ToolbarChoice, value: string) => void;
}

const buttonStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '4px', height: '22px', minWidth: '22px', padding: '0 4px',
    border: '1px solid transparent', borderRadius: '5px', background: 'transparent', color: 'var(--vscode-foreground)',
    cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit', whiteSpace: 'nowrap',
};

const icon = (name: string) => <span className={`codicon codicon-${name}`} aria-hidden="true" />;

const startItems: readonly MenuItem[] = [
    { id: 'debug', label: 'Start Debugging' },
    { id: 'startWithoutDebugging', label: 'Start Without Debugging' },
    { id: 'startWithHotReload', label: 'Start with Hot Reload' },
    { id: 'attachToProcess', label: 'Attach to Process...', separatorBefore: true },
];

const moreItems: readonly MenuItem[] = [
    { id: 'openSolution', label: 'Open Solution...' },
    { id: 'newSolution', label: 'Create New Project...' },
];

/** The configuration menu like Visual Studio's dropdown: the solution's configurations, the platforms when there are several, and the rest */
function configurationItems(state: ToolbarState | null): MenuItem[] {
    const configurations = state?.configurations ?? ['Debug', 'Release'];
    const platforms = state?.platforms ?? [];
    return [
        ...configurations.map(name => ({ id: `configuration:${name}`, label: name, checked: name === (state?.activeConfiguration ?? 'Debug') })),
        ...(platforms.length > 1 ? platforms.map((name, index) => ({ id: `platform:${name}`, label: name, checked: name === state?.activePlatform, separatorBefore: index === 0 })) : []),
        { id: 'startupProfile', label: 'Startup Profile...', separatorBefore: true },
        { id: 'configurationManager', label: 'Configuration Manager...' },
    ];
}

/**
 * The Solution Explorer's toolbar, a row above the tree like Visual Studio's: the title bar of a narrow view (the secondary
 * side bar) hides its icons, a row inside the view wraps instead. Left: what is built and run (configuration, framework or
 * startup profile). Right: Start (one button, the arrow opens the other ways to start), the tree's own buttons, and a menu for the rest.
 */
export const Toolbar: React.FC<ToolbarProps> = ({ state, onAction, onChoose }) => {
    const pick = (id: string) => {
        const [kind, ...rest] = id.split(':');
        if (kind === 'configuration') {
            onChoose('setConfiguration', rest.join(':'));
        } else if (kind === 'platform') {
            onChoose('setPlatform', rest.join(':'));
        } else {
            onAction(id as ToolbarAction);
        }
    };
    const act = (id: string) => onAction(id as ToolbarAction);
    const pressed = !!state?.showAllFiles;
    return (
        <div role="toolbar" aria-label="Solution Explorer" style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px', padding: '6px', margin: '6px 0px', flexShrink: 0,
            borderTop: '1px solid var(--vscode-panel-border)', borderBottom: '1px solid var(--vscode-panel-border)', background: 'var(--vscode-sideBar-background)',
        }}>
            <MenuButton label="Solution Configuration" items={configurationItems(state)} onSelect={pick} align="left" className="toolbar-button" style={buttonStyle}>
                <span>{state?.configuration ?? 'Debug'}</span>
                {icon('chevron-down')}
            </MenuButton>
            <button type="button" className="toolbar-button" title="Select Framework or Startup Profile" aria-label="Select Framework"
                style={buttonStyle} onClick={() => onAction('framework')}>
                <span>{state?.startup ?? 'Auto'}</span>
                {icon('chevron-down')}
            </button>
            <span style={{ flex: 1 }} />
            <span style={{ display: 'inline-flex' }}>
                <button type="button" className="toolbar-button" title="Start Debugging" aria-label="Start Debugging"
                    style={{ ...buttonStyle, color: 'var(--vscode-debugIcon-startForeground, var(--vscode-foreground))' }} onClick={() => onAction('debug')}>
                    {icon('debug-start')}
                </button>
                <MenuButton label="More ways to start" items={startItems} onSelect={act} className="toolbar-button" style={{ ...buttonStyle, minWidth: '16px', padding: '0 2px' }}>
                    {icon('chevron-down')}
                </MenuButton>
            </span>
            <button type="button" className="toolbar-button" title="Sync with Active Document: show the file open in the editor in the tree" aria-label="Sync with Active Document"
                style={buttonStyle} onClick={() => onAction('sync')}>
                {icon('target')}
            </button>
            <button type="button" className="toolbar-button" title="Show All Files" aria-label="Show All Files" aria-pressed={pressed}
                style={{ ...buttonStyle, ...(pressed ? { background: 'var(--vscode-toolbar-activeBackground)' } : {}) }} onClick={() => onAction('showAllFiles')}>
                {icon('files')}
            </button>
            <button type="button" className="toolbar-button" title="Collapse All" aria-label="Collapse All" style={buttonStyle} onClick={() => onAction('collapseAll')}>
                {icon('collapse-all')}
            </button>
            <MenuButton label="More" items={moreItems} onSelect={act} className="toolbar-button" style={buttonStyle}>
                {icon('ellipsis')}
            </MenuButton>
        </div>
    );
};
