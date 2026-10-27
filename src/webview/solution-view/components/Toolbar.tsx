import React from 'react';
import { ToolbarAction, ToolbarState } from '../../../types/toolbar';

interface ToolbarProps {
    state: ToolbarState | null;
    onAction: (action: ToolbarAction) => void;
}

const buttonStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '4px', height: '22px', minWidth: '22px', padding: '0 4px',
    border: '1px solid transparent', borderRadius: '3px', background: 'transparent', color: 'var(--vscode-foreground)',
    cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit', whiteSpace: 'nowrap',
};

const icons: Array<{ action: ToolbarAction; icon: string; title: string }> = [
    { action: 'debug', icon: 'debug-start', title: 'Start Debugging' },
    { action: 'startWithoutDebugging', icon: 'run', title: 'Start Without Debugging' },
    { action: 'sync', icon: 'arrow-swap', title: 'Sync with Active Document' },
    { action: 'showAllFiles', icon: 'files', title: 'Show All Files' },
    { action: 'collapseAll', icon: 'collapse-all', title: 'Collapse All' },
];

/**
 * The Solution Explorer's toolbar, a row above the tree like Visual Studio's: the title bar of a narrow view (the secondary
 * side bar) hides its icons, a row inside the view wraps instead. The buttons run the same commands as before.
 */
export const Toolbar: React.FC<ToolbarProps> = ({ state, onAction }) => (
    <div role="toolbar" aria-label="Solution Explorer" style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px', padding: '2px 4px', flexShrink: 0,
        borderBottom: '1px solid var(--vscode-panel-border)', background: 'var(--vscode-sideBar-background)',
    }}>
        <button type="button" title="Solution Configuration: Debug/Release, platform, startup profile" aria-label="Solution Configuration"
            style={buttonStyle} onClick={() => onAction('configuration')}>
            <span className="codicon codicon-settings-gear" aria-hidden="true" />
            <span>{state?.configuration ?? 'Debug'}</span>
        </button>
        <button type="button" title="Select Framework or Startup Profile" aria-label="Select Framework"
            style={buttonStyle} onClick={() => onAction('framework')}>
            <span className="codicon codicon-symbol-namespace" aria-hidden="true" />
            {state?.startup && <span>{state.startup}</span>}
        </button>
        <span style={{ flex: 1 }} />
        {icons.map(({ action, icon, title }) => {
            const pressed = action === 'showAllFiles' ? !!state?.showAllFiles : undefined;
            return (
                <button key={action} type="button" title={title} aria-label={title} aria-pressed={pressed}
                    style={{ ...buttonStyle, ...(pressed ? { background: 'var(--vscode-toolbar-activeBackground)' } : {}) }}
                    onClick={() => onAction(action)}>
                    <span className={`codicon codicon-${icon}`} aria-hidden="true" />
                </button>
            );
        })}
    </div>
);
