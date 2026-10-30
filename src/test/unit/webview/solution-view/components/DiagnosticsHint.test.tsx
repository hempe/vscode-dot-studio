import { act, fireEvent, render, screen } from '@testing-library/react';
import { DiagnosticsHint } from '../../../../../webview/solution-view/components/DiagnosticsHint';
import { ErrorListRow } from '../../../../../types/errorList';
import { NodeIdString } from '../../../../../types/nodeId';

const posted: unknown[] = [];
jest.mock('../../../../../webview/nuget-view/shared', () => ({ sendToBackend: (message: unknown) => { posted.push(message); } }));

const nodeId = 'node-1' as NodeIdString;
const row = (code: string, line: number): ErrorListRow => ({
    id: `${code}${line}`, severity: 'warning', code, message: `${code} message`, project: 'Api', file: 'Controllers/Values.cs', filePath: '/repo/Api/Controllers/Values.cs', line, column: 4,
});
const anchor = { top: 100, bottom: 116 } as DOMRect;

const receive = (rows: ErrorListRow[], total = rows.length, id = nodeId) =>
    act(() => { window.dispatchEvent(new MessageEvent('message', { data: { type: 'nodeDiagnostics', payload: { nodeId: id, rows, total } } })); });

describe('DiagnosticsHint', () => {
    beforeEach(() => { posted.length = 0; });

    it('asks for the problems of its node and lists them', () => {
        render(<DiagnosticsHint nodeId={nodeId} anchor={anchor} onHover={jest.fn()} onShowAll={jest.fn()} />);
        expect(posted).toEqual([{ type: 'getNodeDiagnostics', payload: { nodeId } }]);
        expect(screen.getByText('Loading...')).toBeInTheDocument();
        receive([row('CS0168', 8), row('CA1822', 3)]);
        expect(screen.getByText('CS0168')).toBeInTheDocument();
        expect(screen.getByText('Values.cs:8')).toBeInTheDocument();
    });

    it('ignores the answer for another node', () => {
        render(<DiagnosticsHint nodeId={nodeId} anchor={anchor} onHover={jest.fn()} onShowAll={jest.fn()} />);
        receive([row('CS0168', 8)], 1, 'other' as NodeIdString);
        expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('opens the file of a problem at its line', () => {
        render(<DiagnosticsHint nodeId={nodeId} anchor={anchor} onHover={jest.fn()} onShowAll={jest.fn()} />);
        receive([row('CS0168', 8)]);
        fireEvent.click(screen.getByText('CS0168'));
        expect(posted).toContainEqual({ type: 'openDiagnostic', payload: { filePath: '/repo/Api/Controllers/Values.cs', line: 8, column: 4 } });
    });

    it('says how many more there are and shows them in the Error List', () => {
        const onShowAll = jest.fn();
        render(<DiagnosticsHint nodeId={nodeId} anchor={anchor} onHover={jest.fn()} onShowAll={onShowAll} />);
        receive([row('CS0168', 8)], 5);
        fireEvent.click(screen.getByText('4 more, show all in the Error List'));
        expect(onShowAll).toHaveBeenCalled();
    });

    it('tells the tree when the mouse is on it, so it stays open', () => {
        const onHover = jest.fn();
        render(<DiagnosticsHint nodeId={nodeId} anchor={anchor} onHover={onHover} onShowAll={jest.fn()} />);
        fireEvent.mouseEnter(screen.getByRole('dialog'));
        fireEvent.mouseLeave(screen.getByRole('dialog'));
        expect(onHover.mock.calls).toEqual([[true], [false]]);
    });
});
