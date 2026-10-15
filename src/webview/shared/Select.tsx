import React, { useEffect, useRef, useState } from 'react';

export interface SelectOption {
    readonly value: string;
    readonly label: string;
}

interface SelectProps {
    readonly id?: string;
    readonly 'aria-label'?: string;
    readonly value: string;
    readonly options: readonly SelectOption[];
    readonly disabled?: boolean;
    onChange(value: string): void;
}

const styles = {
    root: { position: 'relative', minWidth: 100 },
    trigger: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, width: '100%', boxSizing: 'border-box',
        background: 'var(--vscode-dropdown-background)', color: 'var(--vscode-dropdown-foreground)',
        border: '1px solid var(--vscode-dropdown-border, transparent)', borderRadius: 2, padding: '4px 6px', font: 'inherit',
        textAlign: 'left', cursor: 'pointer',
    },
    label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    list: {
        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, margin: 0, padding: 1, listStyle: 'none', maxHeight: 260,
        overflowY: 'auto', boxSizing: 'border-box', background: 'var(--vscode-dropdown-background)',
        color: 'var(--vscode-dropdown-foreground)', border: '1px solid var(--vscode-focusBorder)', borderRadius: '0 0 2px 2px',
    },
    option: { padding: '3px 6px', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
    active: { background: 'var(--vscode-list-activeSelectionBackground)', color: 'var(--vscode-list-activeSelectionForeground)' },
} satisfies Record<string, React.CSSProperties>;

/**
 * A dropdown drawn by the webview. Native <select> popups in VS Code webviews don't always close after a pick on
 * Linux. Keys work like a native select: arrows change the value, Enter/Space/Alt+Down open the list, Escape closes it.
 */
export const Select: React.FC<SelectProps> = ({ id, value, options, disabled, onChange, ...rest }) => {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const root = useRef<HTMLDivElement>(null);
    const list = useRef<HTMLUListElement>(null);
    const index = options.findIndex(o => o.value === value);

    useEffect(() => {
        if (!open) {
            return;
        }
        const outside = (e: MouseEvent) => {
            if (!root.current?.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', outside);
        return () => document.removeEventListener('mousedown', outside);
    }, [open]);

    useEffect(() => {
        if (open && active >= 0) {
            (list.current?.children[active] as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' });
        }
    }, [open, active]);

    const show = () => { setActive(index); setOpen(true); };
    const pick = (i: number) => {
        setOpen(false);
        const option = options[i];
        if (option && option.value !== value) {
            onChange(option.value);
        }
    };
    const onKeyDown = (e: React.KeyboardEvent) => {
        const step = (delta: number, from: number) => Math.min(options.length - 1, Math.max(0, from + delta));
        switch (e.key) {
            case 'ArrowDown':
            case 'ArrowUp': {
                e.preventDefault();
                if (!open && e.altKey) {
                    show();
                } else if (open) {
                    setActive(step(e.key === 'ArrowDown' ? 1 : -1, active));
                } else {
                    pick(step(e.key === 'ArrowDown' ? 1 : -1, index));
                }
                break;
            }
            case 'Home':
            case 'End':
                e.preventDefault();
                if (open) {
                    setActive(e.key === 'Home' ? 0 : options.length - 1);
                } else {
                    pick(e.key === 'Home' ? 0 : options.length - 1);
                }
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                if (open) {
                    pick(active);
                } else {
                    show();
                }
                break;
            case 'Escape':
            case 'Tab':
                if (open) {
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                    setOpen(false);
                }
                break;
        }
    };

    return (
        <div ref={root} style={styles.root} onKeyDown={onKeyDown}>
            <button
                id={id}
                type="button"
                value={value}
                aria-label={rest['aria-label']}
                aria-haspopup="listbox"
                aria-expanded={open}
                disabled={disabled}
                style={{ ...styles.trigger, ...(open ? { borderColor: 'var(--vscode-focusBorder)' } : {}), ...(disabled ? { opacity: 0.5, cursor: 'default' } : {}) }}
                onClick={() => (open ? setOpen(false) : show())}
            >
                <span style={styles.label}>{options[index]?.label ?? value}</span>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" clipRule="evenodd" d="M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z" />
                </svg>
            </button>
            {open && (
                <ul ref={list} role="listbox" aria-label={rest['aria-label']} style={styles.list}>
                    {options.map((option, i) => (
                        <li
                            key={option.value}
                            role="option"
                            data-value={option.value}
                            aria-selected={option.value === value}
                            style={{ ...styles.option, ...(i === active ? styles.active : {}) }}
                            onMouseEnter={() => setActive(i)}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => pick(i)}
                        >
                            {option.label}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};
