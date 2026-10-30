import React from 'react';

export interface DiagnosticsHintProps {
    /** The node's name (the native tooltip it replaces showed it, for names the row cuts off) */
    name: string;
    /** What the node's problems count, e.g. "1 error, 3 infos" */
    text: string;
    /** The node's name on the row: the hint goes below it */
    anchor: DOMRect;
    /** The mouse is over the hint (keeps it open) or left it */
    onHover(over: boolean): void;
    /** The Error List, narrowed to the node */
    onShow(): void;
}

/**
 * The hover over the name of a node with problems: the name and what its problems count, as a link to the Error List narrowed to
 * the node. Unlike a native tooltip it stays while the mouse moves onto it. It cannot leave the view, so it sits under the name
 * (above it when there is more room there) and ends at the view's right edge.
 */
export const DiagnosticsHint: React.FC<DiagnosticsHintProps> = ({ name, text, anchor, onHover, onShow }) => {
    const above = anchor.top > window.innerHeight - anchor.bottom;
    const left = Math.max(8, anchor.left);
    const style: React.CSSProperties = {
        left,
        maxWidth: Math.max(80, window.innerWidth - left - 8),
        ...(above ? { bottom: window.innerHeight - anchor.top + 2 } : { top: anchor.bottom + 2 }),
    };
    return (
        <div className="diagnostics-hint" style={style} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
            <div className="diagnostics-hint-name">{name}</div>
            <button className="diagnostics-hint-link" title="Show them in the Error List" onClick={onShow}>{text}</button>
        </div>
    );
};
