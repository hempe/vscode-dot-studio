import React from 'react';

interface TwoPanelProps<T> {
    /** The package list (with its keyboard handling) */
    left: React.ReactNode;
    onKeyDown?: (event: React.KeyboardEvent) => void;
    /** The selected package: its details (what `children` makes of it) show, else a hint */
    selection: T | null;
    children: (selection: T) => React.ReactNode;
}

/** The list on the left and the details of the selected package on the right, as in every tab of the manager */
export function TwoPanel<T>({ left, onKeyDown, selection, children }: TwoPanelProps<T>) {
    return (
        <div style={{
            display: 'flex',
            minHeight: 0,
            flex: 1,
            border: '1px solid var(--vscode-panel-border)',
            borderTop: 'none'
        }}>
            <div
                style={{
                    width: '40%',
                    borderRight: '1px solid var(--vscode-panel-border)',
                    overflow: 'auto',
                    overscrollBehavior: 'contain',
                    maxHeight: '100%'
                }}
                tabIndex={0}
                onKeyDown={onKeyDown}
            >
                {left}
            </div>
            <div style={{ flex: 1, padding: '16px', overflow: 'auto' }}>
                {selection ? <div>{children(selection)}</div> : (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100%',
                        color: 'var(--vscode-descriptionForeground)',
                        fontStyle: 'italic'
                    }}>
                        Select a package to view details
                    </div>
                )}
            </div>
        </div>
    );
}
