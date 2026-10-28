import React, { useEffect, useRef, useState } from 'react';

export interface MenuItem {
    /** What `onSelect` gets */
    readonly id: string;
    readonly label: string;
    /** Marks the current choice (a check in front of the label) */
    readonly checked?: boolean;
    readonly separatorBefore?: boolean;
}

interface MenuButtonProps {
    /** The accessible name and the tooltip of the button */
    label: string;
    items: readonly MenuItem[];
    onSelect: (id: string) => void;
    /** What the button shows (text, an icon, an arrow) */
    children: React.ReactNode;
    /** The button's own look (the menu is the same everywhere) */
    className?: string;
    style?: React.CSSProperties;
    /** Which edge of the button the menu lines up with */
    align?: 'left' | 'right';
}

// One copy of the menu's look for every webview that uses it, drawn like VS Code's own menus: the theme's menu colours,
// rounded corners, a shadow; only the item under the mouse (or reached with the arrow keys) is highlighted
const STYLES = `
.shinobi-menu {
    background-color: var(--vscode-menu-background);
    border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, transparent));
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    padding: 4px 0;
    min-width: 220px;
    font-family: var(--vscode-font-family);
    font-size: 13px;
    line-height: 1.4;
    outline: none;
}
.shinobi-menu-item {
    display: flex;
    align-items: center;
    width: calc(100% - 8px);
    margin: 0 4px;
    /* The row keeps its size for the mouse; the highlight is the padding box, 1px smaller on every side */
    padding: 3px 27px;
    min-height: 18px;
    border: 1px solid transparent;
    background-clip: padding-box;
    border-radius: 5px;
    background-color: transparent;
    color: var(--vscode-menu-foreground);
    font: inherit;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
    position: relative;
}
.shinobi-menu-item:hover,
.shinobi-menu-item:focus {
    background-color: var(--vscode-list-hoverBackground);
    color: var(--vscode-list-hoverForeground, var(--vscode-menu-foreground));
    outline: none;
}
.shinobi-menu-check { position: absolute; left: 8px; }
.shinobi-menu-separator {
    height: 1px;
    background-color: var(--vscode-menu-separatorBackground);
    margin: 4px 0;
}
`;

/** A button that opens a menu below it; the menu closes on a pick, Escape or a click elsewhere, and works with the arrow keys */
export const MenuButton: React.FC<MenuButtonProps> = ({ label, items, onSelect, children, className, style, align = 'right' }) => {
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLSpanElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    // The menu itself has focus when it opens, so the keys work and nothing is highlighted; the arrow keys then move between
    // the items, as in VS Code's menus
    useEffect(() => { if (open) { menu.current?.focus(); } }, [open]);
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

    const moveFocus = (event: React.KeyboardEvent) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
            return;
        }
        event.preventDefault();
        const entries = [...(menu.current?.querySelectorAll<HTMLElement>('[role^=menuitem]') ?? [])];
        const at = entries.indexOf(document.activeElement as HTMLElement);
        // From the menu itself (no item yet): Down goes to the first item, Up to the last
        const next = at < 0 ? (event.key === 'ArrowDown' ? 0 : entries.length - 1) : (at + (event.key === 'ArrowDown' ? 1 : entries.length - 1)) % entries.length;
        entries[next]?.focus();
    };

    return (
        <span ref={root} style={{ position: 'relative', display: 'inline-flex' }}>
            <style>{STYLES}</style>
            <button type="button" className={className} title={label} aria-label={label} aria-haspopup="menu" aria-expanded={open}
                style={style} onClick={() => setOpen(!open)}>
                {children}
            </button>
            {open && (
                <div role="menu" aria-label={label} className="shinobi-menu" ref={menu} tabIndex={-1} onKeyDown={moveFocus}
                    style={{ position: 'absolute', top: '100%', [align]: 0, zIndex: 20, marginTop: '2px' }}>
                    {items.map(item => (
                        <React.Fragment key={item.id}>
                            {item.separatorBefore && <div role="separator" className="shinobi-menu-separator" />}
                            <button type="button" role={item.checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={item.checked} className="shinobi-menu-item"
                                onClick={() => { setOpen(false); onSelect(item.id); }}>
                                {item.checked && <span className="codicon codicon-check shinobi-menu-check" aria-hidden="true" />}
                                {item.label}
                            </button>
                        </React.Fragment>
                    ))}
                </div>
            )}
        </span>
    );
};
