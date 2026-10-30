import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ErrorListFilter, ErrorListMessage, ErrorListRequest, ErrorListRow, ErrorListSummary } from '../../types/errorList';

export interface ErrorListApi {
    postMessage(message: ErrorListRequest): void;
}

type Column = 'severity' | 'code' | 'message' | 'project' | 'file' | 'line';
/** Columns with a value filter, like Visual Studio's column header filters */
type FilterColumn = 'code' | 'project' | 'file';

const SEVERITY_RANK: Record<ErrorListRow['severity'], number> = { error: 0, warning: 1, info: 2 };
const SHOWN: Record<ErrorListRow['severity'], keyof ErrorListFilter> = { error: 'errors', warning: 'warnings', info: 'infos' };

const cell = (row: ErrorListRow, column: Column): string | number =>
    column === 'severity' ? SEVERITY_RANK[row.severity] : column === 'line' ? row.line : (row[column] ?? '');

function compare(a: ErrorListRow, b: ErrorListRow, column: Column): number {
    const x = cell(a, column);
    const y = cell(b, column);
    const primary = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    return primary || a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column;
}

/** The rows the toggles, the search and the column filters let through, sorted */
export function visibleRows(
    rows: ErrorListRow[], filter: ErrorListFilter, search: string, excluded: Partial<Record<FilterColumn, Set<string>>>,
    sort?: { column: Column; descending: boolean }
): ErrorListRow[] {
    const term = search.trim().toLowerCase();
    const result = rows.filter(row =>
        filter[SHOWN[row.severity]]
        && (!term || [row.code ?? '', row.message, row.project, row.file, String(row.line)].some(text => text.toLowerCase().includes(term)))
        && (Object.keys(excluded) as FilterColumn[]).every(column => !excluded[column]?.has(row[column] ?? '')));
    if (sort) {
        result.sort((a, b) => sort.descending ? compare(b, a, sort.column) : compare(a, b, sort.column));
    }
    return result;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

const ColumnFilter: React.FC<{
    column: FilterColumn; values: string[]; excluded: Set<string> | undefined; onChange(excluded: Set<string>): void;
}> = ({ column, values, excluded, onChange }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLSpanElement>(null);
    useEffect(() => {
        if (!open) {
            return;
        }
        const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) { setOpen(false); } };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);
    const active = !!excluded?.size;
    return (
        <span ref={ref}>
            <button className={`filter codicon codicon-filter${active ? '-filled active' : ''}`} aria-label={`Filter ${column}`} onClick={() => setOpen(!open)} />
            {open && (
                <div className="menu" role="menu">
                    <label>
                        <input type="checkbox" checked={!active} onChange={() => onChange(new Set(active ? [] : values))} />
                        (Select all)
                    </label>
                    <hr />
                    {values.map(value => (
                        <label key={value}>
                            <input
                                type="checkbox"
                                checked={!excluded?.has(value)}
                                onChange={() => {
                                    const next = new Set(excluded);
                                    if (next.has(value)) {
                                        next.delete(value);
                                    } else {
                                        next.add(value);
                                    }
                                    onChange(next);
                                }}
                            />
                            {value || '(none)'}
                        </label>
                    ))}
                </div>
            )}
        </span>
    );
};

const COLUMNS: { column: Column; label: string; width: string; filter?: FilterColumn }[] = [
    { column: 'severity', label: '', width: '28px' },
    { column: 'code', label: 'Code', width: '110px', filter: 'code' },
    { column: 'message', label: 'Description', width: 'auto' },
    { column: 'project', label: 'Project', width: '150px', filter: 'project' },
    { column: 'file', label: 'File', width: '200px', filter: 'file' },
    { column: 'line', label: 'Line', width: '60px' },
];

const MIN_COLUMN_WIDTH = 30;

const ICONS: Record<ErrorListRow['severity'], string> = { error: 'error', warning: 'warning', info: 'info' };

export const App: React.FC<{ api: ErrorListApi }> = ({ api }) => {
    const [data, setData] = useState<{ rows: ErrorListRow[]; filter: ErrorListFilter; summary: ErrorListSummary; hasSolution: boolean; scope?: string }>();
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<{ column: Column; descending: boolean }>();
    /** Widths the user dragged the column borders to, in px; the others keep their default */
    const [widths, setWidths] = useState<Partial<Record<Column, number>>>({});
    const [excluded, setExcluded] = useState<Partial<Record<FilterColumn, Set<string>>>>({});

    useEffect(() => {
        const listener = (event: MessageEvent<ErrorListMessage>) => {
            if (event.data.type === 'rows') {
                const { rows, filter, summary, hasSolution, scope } = event.data;
                setData({ rows, filter, summary, hasSolution, ...(scope !== undefined ? { scope } : {}) });
            }
        };
        window.addEventListener('message', listener);
        api.postMessage({ type: 'ready' });
        return () => window.removeEventListener('message', listener);
    }, [api]);

    const rows = useMemo(() => data ? visibleRows(data.rows, data.filter, search, excluded, sort) : [], [data, search, excluded, sort]);
    const valuesOf = (column: FilterColumn) => [...new Set((data?.rows ?? []).map(row => row[column] ?? ''))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (!data) {
        return null;
    }
    const { filter, summary } = data;
    const toggle = (severity: keyof ErrorListFilter, icon: string, count: number, word: string) => (
        <button className="toggle" aria-pressed={filter[severity]} onClick={() => api.postMessage({ type: 'toggle', severity })}
            title={`${filter[severity] ? 'Hide' : 'Show'} ${word}s, also in the Solution Explorer`}>
            <span className={`codicon codicon-${icon} ${icon}`} />{plural(count, word)}
        </button>
    );
    const open = (row: ErrorListRow) => api.postMessage({ type: 'open', filePath: row.filePath, line: row.line, column: row.column });
    const startResize = (column: Column, event: React.MouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 0;
        const move = (moved: MouseEvent) => setWidths(current => ({ ...current, [column]: Math.max(MIN_COLUMN_WIDTH, startWidth + moved.clientX - startX) }));
        const stop = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', stop);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', stop);
    };
    const resetWidth = (column: Column) => setWidths(current => {
        const { [column]: _removed, ...rest } = current;
        return rest;
    });
    const sortBy = (column: Column) => setSort(current => current?.column === column ? { column, descending: !current.descending } : { column, descending: false });

    const hiddenBySeverity = data.rows.filter(row => !filter[SHOWN[row.severity]]).length;
    const empty = data.rows.length === 0
        ? data.scope !== undefined ? `No errors, warnings or messages in ${data.scope}.` : 'No errors, warnings or messages. Build the solution to check every file.'
        : rows.length === 0
            ? hiddenBySeverity === data.rows.length ? `${hiddenBySeverity} ${hiddenBySeverity === 1 ? 'entry' : 'entries'} hidden by the toggles.` : 'No entries match the search or the filters.'
            : undefined;

    return (
        <>
            <div className="toolbar">
                {toggle('errors', 'error', summary.errors, 'Error')}
                {toggle('warnings', 'warning', summary.warnings, 'Warning')}
                {toggle('infos', 'info', summary.infos, 'Message')}
                {data.scope !== undefined && (
                    <button className="toggle scope" onClick={() => api.postMessage({ type: 'clearScope' })} title="Show the whole solution again">
                        {data.scope}<span className="codicon codicon-close" />
                    </button>
                )}
                <span className="search">
                    <input type="text" placeholder="Search Error List" aria-label="Search Error List" value={search} onChange={e => setSearch(e.target.value)} />
                </span>
            </div>
            <table>
                <colgroup>{COLUMNS.map(c => <col key={c.column} style={{ width: widths[c.column] !== undefined ? `${widths[c.column]}px` : c.width }} />)}</colgroup>
                <thead>
                    <tr>
                        {COLUMNS.map(c => (
                            <th key={c.column} aria-sort={sort?.column === c.column ? (sort.descending ? 'descending' : 'ascending') : undefined}>
                                <span className="sort" onClick={() => sortBy(c.column)} role="button" aria-label={`Sort by ${c.label || 'severity'}`}>
                                    {c.label}
                                    {sort?.column === c.column && <span className={`codicon codicon-chevron-${sort.descending ? 'down' : 'up'}`} />}
                                </span>
                                <span className="resizer" role="separator" aria-orientation="vertical" aria-label={`Resize ${c.label || 'severity'} column`}
                                    title="Drag to resize, double-click to reset" onMouseDown={e => startResize(c.column, e)} onDoubleClick={() => resetWidth(c.column)} />
                                {c.filter && (
                                    <ColumnFilter column={c.filter} values={valuesOf(c.filter)} excluded={excluded[c.filter]}
                                        onChange={next => setExcluded(current => ({ ...current, [c.filter!]: next }))} />
                                )}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map(row => (
                        <tr key={row.id} className="row" tabIndex={0} onDoubleClick={() => open(row)} onKeyDown={e => { if (e.key === 'Enter') { open(row); } }}>
                            <td><span className={`codicon codicon-${ICONS[row.severity]} ${row.severity}`} aria-label={row.severity} /></td>
                            <td>
                                {row.code && row.codeUrl
                                    ? <a onClick={e => { e.stopPropagation(); api.postMessage({ type: 'openUrl', url: row.codeUrl! }); }} title={row.codeUrl}>{row.code}</a>
                                    : row.code}
                            </td>
                            <td title={row.message}>{row.message.split('\n')[0]}</td>
                            <td title={row.project}>{row.project}</td>
                            <td title={row.filePath}>{row.file}</td>
                            <td>{row.line}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {empty && <div className="empty">{empty}</div>}
        </>
    );
};
