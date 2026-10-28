import React, { useEffect, useRef, useState } from 'react';
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

const icon = (name: string) => <span className={`codicon codicon-${name}`} aria-hidden="true" />;

interface MenuItem { action: ToolbarAction; label: string; separatorBefore?: boolean }

/** A button that opens a small menu below it; closes on a pick, Escape or a click elsewhere */
const MenuButton: React.FC<{
    label: string;
    items: readonly MenuItem[];
    onAction: (action: ToolbarAction) => void;
    children: React.ReactNode;
    /** The button next to it that does the main thing: this one is only its arrow */
    arrow?: boolean;
}> = ({ label, items, onAction, children, arrow }) => {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLSpanElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    // The first item has focus when the menu opens; the arrow keys move between items, as in VS Code's menus
    useEffect(() => { if (open) { menu.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus(); } }, [open]);
    const moveFocus = (event: React.KeyboardEvent) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
            return;
        }
        event.preventDefault();
        const entries = [...(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
        const at = entries.indexOf(document.activeElement as HTMLElement);
        entries[(at + (event.key === 'ArrowDown' ? 1 : entries.length - 1)) % entries.length]?.focus();
    };
    useEffect(() => {
        if (!open) {
            return;
        }
        const away = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); } };
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); } };
        document.addEventListener('mousedown', away);
        document.addEventListener('keydown', escape);
        return () => {
            document.removeEventListener('mousedown', away);
            document.removeEventListener('keydown', escape);
        };
    }, [open]);
    return (
        <span ref={root} style={{ position: 'relative', display: 'inline-flex' }}>
            <button type="button" className="toolbar-button" title={label} aria-label={label} aria-haspopup="menu" aria-expanded={open}
                style={{ ...buttonStyle, ...(arrow ? { minWidth: '16px', padding: '0 2px' } : {}) }} onClick={() => setOpen(!open)}>
                {children}
            </button>
            {open && (
                <div role="menu" aria-label={label} className="toolbar-menu" ref={menu} onKeyDown={moveFocus}
                    style={{ position: 'absolute', top: '100%', right: 0, zIndex: 20, marginTop: '2px' }}>
                    {items.map(item => (
                        <React.Fragment key={item.action}>
                            {item.separatorBefore && <div role="separator" className="toolbar-menu-separator" />}
                            <button type="button" role="menuitem" className="toolbar-menu-item" onClick={() => { setOpen(false); onAction(item.action); }}>
                                {item.label}
                            </button>
                        </React.Fragment>
                    ))}
                </div>
            )}
        </span>
    );
};

const startItems: readonly MenuItem[] = [
    { action: 'debug', label: 'Start Debugging' },
    { action: 'startWithoutDebugging', label: 'Start Without Debugging' },
    { action: 'startWithHotReload', label: 'Start with Hot Reload' },
    { action: 'attachToProcess', label: 'Attach to Process...', separatorBefore: true },
];

const moreItems: readonly MenuItem[] = [
    { action: 'openSolution', label: 'Open Solution...' },
    { action: 'newSolution', label: 'Create New Project...' },
];

/**
 * The Solution Explorer's toolbar, a row above the tree like Visual Studio's: the title bar of a narrow view (the secondary
 * side bar) hides its icons, a row inside the view wraps instead. Left: what is built and run (configuration, framework or
 * startup profile). Right: Start (one button, the arrow opens the other ways to start), the tree's own buttons, and a menu for the rest.
 */
export const Toolbar: React.FC<ToolbarProps> = ({ state, onAction }) => (
    <div role="toolbar" aria-label="Solution Explorer" style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px', padding: '6px 4px', marginBottom: '4px', flexShrink: 0,
        borderBottom: '1px solid var(--vscode-panel-border)', background: 'var(--vscode-sideBar-background)',
    }}>
        <button type="button" className="toolbar-button" title="Solution Configuration: Debug/Release, platform, startup profile" aria-label="Solution Configuration"
            style={buttonStyle} onClick={() => onAction('configuration')}>
            <span>{state?.configuration ?? 'Debug'}</span>
            {icon('chevron-down')}
        </button>
        <button type="button" className="toolbar-button" title="Select Framework or Startup Profile" aria-label="Select Framework"
            style={buttonStyle} onClick={() => onAction('framework')}>
            <span>{state?.startup ?? 'Auto'}</span>
            {icon('chevron-down')}
        </button>
        <span style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex' }}>
            <button type="button" className="toolbar-button" title="Start Debugging" aria-label="Start Debugging" style={{ ...buttonStyle, color: 'var(--vscode-debugIcon-startForeground, var(--vscode-foreground))' }}
                onClick={() => onAction('debug')}>
                {icon('debug-start')}
            </button>
            <MenuButton label="More ways to start" items={startItems} onAction={onAction} arrow>{icon('chevron-down')}</MenuButton>
        </span>
        <button type="button" className="toolbar-button" title="Sync with Active Document: show the file open in the editor in the tree" aria-label="Sync with Active Document"
            style={buttonStyle} onClick={() => onAction('sync')}>
            {icon('target')}
        </button>
        {(() => {
            const pressed = !!state?.showAllFiles;
            return (
                <button type="button" className="toolbar-button" title="Show All Files" aria-label="Show All Files" aria-pressed={pressed}
                    style={{ ...buttonStyle, ...(pressed ? { background: 'var(--vscode-toolbar-activeBackground)' } : {}) }}
                    onClick={() => onAction('showAllFiles')}>
                    {icon('files')}
                </button>
            );
        })()}
        <button type="button" className="toolbar-button" title="Collapse All" aria-label="Collapse All" style={buttonStyle} onClick={() => onAction('collapseAll')}>
            {icon('collapse-all')}
        </button>
        <MenuButton label="More" items={moreItems} onAction={onAction}>{icon('ellipsis')}</MenuButton>
    </div>
);
