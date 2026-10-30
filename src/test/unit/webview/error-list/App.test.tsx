import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App, visibleRows } from '../../../../webview/error-list/App';
import { ErrorListMessage, ErrorListRequest, ErrorListRow } from '../../../../types/errorList';

const row = (severity: ErrorListRow['severity'], code: string, project: string, file: string, line: number, message = `${code} message`): ErrorListRow => ({
    id: `${file}:${line}:${code}`, severity, code, message, project, file, filePath: `/repo/${project}/${file}`, line, column: 1,
    ...(code.startsWith('CS') ? { codeUrl: `https://learn.microsoft.com/${code.toLowerCase()}` } : {}),
});

const rows = [
    row('error', 'CS0103', 'Api', 'Program.cs', 12, "The name 'foo' does not exist in the current context"),
    row('warning', 'CS0168', 'Shared', 'LaunchInfo.cs', 8),
    row('info', 'IDE0090', 'Api', 'Program.cs', 20, "'new' expression can be simplified"),
    row('warning', 'CA1822', 'Api', 'Values.cs', 3),
];
const allShown = { errors: true, warnings: true, infos: true };

function renderList(filter = allShown, list = rows) {
    const sent: ErrorListRequest[] = [];
    render(<App api={{ postMessage: message => sent.push(message) }} />);
    const receive = (message: ErrorListMessage) => act(() => { window.dispatchEvent(new MessageEvent('message', { data: message })); });
    receive({ type: 'rows', rows: list, filter, summary: { errors: 1, warnings: 2, infos: 1 }, hasSolution: true });
    return { sent, receive };
}

const codes = () => screen.getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[1].textContent);

describe('Error List', () => {
    it('asks for rows and lists them with their columns', () => {
        const { sent } = renderList();
        expect(sent[0]).toEqual({ type: 'ready' });
        expect(codes()).toEqual(['CS0103', 'CS0168', 'IDE0090', 'CA1822']);
        const first = within(screen.getAllByRole('row')[1]).getAllByRole('cell').map(c => c.textContent);
        expect(first.slice(1)).toEqual(['CS0103', "The name 'foo' does not exist in the current context", 'Api', 'Program.cs', '12']);
        expect(screen.getByText('1 Error')).toBeInTheDocument();
        expect(screen.getByText('2 Warnings')).toBeInTheDocument();
    });

    it('sorts by a column, and the other way round on a second click', () => {
        renderList();
        fireEvent.click(screen.getByLabelText('Sort by Code'));
        expect(codes()).toEqual(['CA1822', 'CS0103', 'CS0168', 'IDE0090']);
        fireEvent.click(screen.getByLabelText('Sort by Code'));
        expect(codes()).toEqual(['IDE0090', 'CS0168', 'CS0103', 'CA1822']);
        fireEvent.click(screen.getByLabelText('Sort by Line'));
        expect(codes()).toEqual(['CA1822', 'CS0168', 'CS0103', 'IDE0090']);
    });

    it('searches all columns', () => {
        renderList();
        fireEvent.change(screen.getByLabelText('Search Error List'), { target: { value: 'launchinfo' } });
        expect(codes()).toEqual(['CS0168']);
        fireEvent.change(screen.getByLabelText('Search Error List'), { target: { value: 'nothing like it' } });
        expect(screen.getByText('No entries match the search or the filters.')).toBeInTheDocument();
    });

    it('filters a column by its values', () => {
        renderList();
        fireEvent.click(screen.getByLabelText('Filter project'));
        const menu = screen.getByRole('menu');
        fireEvent.click(within(menu).getByLabelText('Api'));
        expect(codes()).toEqual(['CS0168']);
        fireEvent.click(within(menu).getByLabelText('(Select all)'));
        expect(codes()).toHaveLength(4);
    });

    it('hides severities whose toggle is off and sends toggles to the extension', () => {
        const { sent } = renderList({ errors: true, warnings: false, infos: true });
        expect(codes()).toEqual(['CS0103', 'IDE0090']);
        fireEvent.click(screen.getByText('2 Warnings'));
        expect(sent[sent.length - 1]).toEqual({ type: 'toggle', severity: 'warnings' });
    });

    it('opens the file on double-click or Enter, and the docs from the code', () => {
        const { sent } = renderList();
        fireEvent.doubleClick(screen.getAllByRole('row')[1]);
        expect(sent[sent.length - 1]).toEqual({ type: 'open', filePath: '/repo/Api/Program.cs', line: 12, column: 1 });
        fireEvent.keyDown(screen.getAllByRole('row')[2], { key: 'Enter' });
        expect(sent[sent.length - 1]).toMatchObject({ type: 'open', line: 8 });
        fireEvent.click(screen.getByText('CS0103'));
        expect(sent[sent.length - 1]).toEqual({ type: 'openUrl', url: 'https://learn.microsoft.com/cs0103' });
    });

    it('explains an empty list', () => {
        renderList(allShown, []);
        expect(screen.getByText('No errors, warnings or messages. Build the solution to check every file.')).toBeInTheDocument();
    });

    it('says when the toggles hide everything', () => {
        renderList({ errors: false, warnings: false, infos: false });
        expect(screen.getByText('4 entries hidden by the toggles.')).toBeInTheDocument();
    });
});

describe('visibleRows', () => {
    it('combines toggles, search and column filters', () => {
        expect(visibleRows(rows, { errors: true, warnings: true, infos: false }, 'program', { code: new Set(['CS0103']) }).map(r => r.code)).toEqual([]);
        expect(visibleRows(rows, allShown, '', { file: new Set(['Program.cs']) }).map(r => r.code)).toEqual(['CS0168', 'CA1822']);
    });

    it('shows the node the list is narrowed to and clears it on a click', () => {
        const { sent, receive } = renderList();
        receive({ type: 'rows', rows: [rows[0]], filter: allShown, summary: { errors: 1, warnings: 0, infos: 0 }, hasSolution: true, scope: 'Api' });
        fireEvent.click(screen.getByTitle('Show the whole solution again'));
        expect(sent).toContainEqual({ type: 'clearScope' });
        expect(screen.getByTitle('Show the whole solution again')).toHaveTextContent('Api');
    });

    it('says so when nothing is listed for the node', () => {
        const { receive } = renderList();
        receive({ type: 'rows', rows: [], filter: allShown, summary: { errors: 0, warnings: 0, infos: 0 }, hasSolution: true, scope: 'Api' });
        expect(screen.getByText('No errors, warnings or messages in Api.')).toBeInTheDocument();
    });

    it('resizes a column by dragging its border, and resets it on a double click', () => {
        renderList();
        const width = () => (document.querySelectorAll('col')[1] as HTMLElement).style.width;
        expect(width()).toBe('110px');
        const handle = screen.getByLabelText('Resize Code column');
        fireEvent.mouseDown(handle, { clientX: 100 });
        fireEvent.mouseMove(document, { clientX: 160 });
        fireEvent.mouseUp(document);
        expect(width()).toBe('60px');
        fireEvent.mouseMove(document, { clientX: 400 });
        expect(width()).toBe('60px');
        fireEvent.doubleClick(handle);
        expect(width()).toBe('110px');
    });
});
