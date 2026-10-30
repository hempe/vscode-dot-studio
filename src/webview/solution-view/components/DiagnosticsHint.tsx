import React from 'react';

export interface DiagnosticsHintProps {
    /** What the marker counts, e.g. "1 error, 3 infos" */
    text: string;
    /** The marker the hint belongs to */
    anchor: DOMRect;
    /** The mouse is over the hint (keeps it open) or left it */
    onHover(over: boolean): void;
    /** The Error List, narrowed to the node */
    onShow(): void;
}

/**
 * The hover over a marker: what it counts, as a link to the Error List narrowed to the node. Unlike a native tooltip it stays
 * while the mouse moves onto it. It cannot leave the view, so it sits under the marker (above it when there is more room
 * there), as far right as the view allows.
 */
export const DiagnosticsHint: React.FC<DiagnosticsHintProps> = ({ text, anchor, onHover, onShow }) => {
    const above = anchor.top > window.innerHeight - anchor.bottom;
    const style: React.CSSProperties = {
        right: 8,
        ...(above ? { bottom: window.innerHeight - anchor.top + 2 } : { top: anchor.bottom + 2 }),
    };
    return (
        <div className="diagnostics-hint" style={style} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
            <button className="diagnostics-hint-link" title="Show them in the Error List" onClick={onShow}>{text}</button>
        </div>
    );
};
