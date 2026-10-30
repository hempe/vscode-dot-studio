import React, { useEffect, useState } from 'react';
import { ErrorListRow } from '../../../types/errorList';
import { NodeIdString } from '../../../types/nodeId';
import { UICmd } from '../../../types/commands/ui';
import { sendToBackend } from '../../nuget-view/shared';

export interface DiagnosticsHintProps {
    nodeId: NodeIdString;
    /** The marker the hint belongs to */
    anchor: DOMRect;
    /** The mouse is over the hint (keeps it open) or left it */
    onHover(over: boolean): void;
    /** The Error List, narrowed to the node */
    onShowAll(): void;
}

const ICONS: Record<ErrorListRow['severity'], string> = { error: 'error', warning: 'warning', info: 'info' };

/**
 * The problems below a node, in a box next to its marker: unlike a native tooltip it stays while the mouse moves onto it,
 * and a problem opens its file at the line. It cannot leave the view, so it takes the view's width and goes above the marker
 * when there is more room there.
 */
export const DiagnosticsHint: React.FC<DiagnosticsHintProps> = ({ nodeId, anchor, onHover, onShowAll }) => {
    const [result, setResult] = useState<{ rows: ErrorListRow[]; total: number }>();

    useEffect(() => {
        const listener = (event: MessageEvent<UICmd>) => {
            if (event.data.type === 'nodeDiagnostics' && event.data.payload.nodeId === nodeId) {
                setResult({ rows: event.data.payload.rows, total: event.data.payload.total });
            }
        };
        window.addEventListener('message', listener);
        sendToBackend({ type: 'getNodeDiagnostics', payload: { nodeId } });
        return () => window.removeEventListener('message', listener);
    }, [nodeId]);

    const above = anchor.top > window.innerHeight - anchor.bottom;
    const style: React.CSSProperties = above
        ? { bottom: window.innerHeight - anchor.top + 2, maxHeight: Math.max(80, anchor.top - 8) }
        : { top: anchor.bottom + 2, maxHeight: Math.max(80, window.innerHeight - anchor.bottom - 8) };

    return (
        <div className="diagnostics-hint" style={style} role="dialog" aria-label="Problems" onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
            {!result && <div className="diagnostics-hint-empty">Loading...</div>}
            {result?.rows.map(row => (
                <div key={row.id} className="diagnostics-hint-row" role="button" tabIndex={0} title={`${row.message}\n${row.filePath}:${row.line}`}
                    onClick={() => sendToBackend({ type: 'openDiagnostic', payload: { filePath: row.filePath, line: row.line, column: row.column } })}
                    onKeyDown={e => { if (e.key === 'Enter') { sendToBackend({ type: 'openDiagnostic', payload: { filePath: row.filePath, line: row.line, column: row.column } }); } }}>
                    <span className={`codicon codicon-${ICONS[row.severity]} ${row.severity}`} aria-label={row.severity} />
                    <span className="diagnostics-hint-text">
                        {row.code && <span className="diagnostics-hint-code">{row.code}</span>}
                        {row.message}
                    </span>
                    <span className="diagnostics-hint-where">{row.file.split(/[\\/]/).pop()}:{row.line}</span>
                </div>
            ))}
            {result && result.rows.length === 0 && <div className="diagnostics-hint-empty">No problems.</div>}
            <button className="diagnostics-hint-all" onClick={onShowAll}>
                {result && result.total > result.rows.length ? `${result.total - result.rows.length} more, show all in the Error List` : 'Show in the Error List'}
            </button>
        </div>
    );
};
