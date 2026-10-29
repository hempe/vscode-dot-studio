import { syncNamespaces, syncSummary, SyncDeps, SyncAction } from '../../../../../services/code/namespaceSync/namespaceSync';

const change = (ns = 'Demo.Sub'): SyncAction => ({ title: `Change namespace to '${ns}'`, edit: {} });

/** Fakes: `offered` is what the server offers per file, in order of the calls (the last entry repeats) */
function makeDeps(overrides: Partial<SyncDeps> & { offered?: Record<string, SyncAction[][]>; namespaces?: Record<string, string | null>; expected?: Record<string, string | null> } = {}) {
    const calls: string[] = [];
    const asked: Record<string, number> = {};
    const deps: SyncDeps = {
        parseNamespace: async file => {
            const ns = overrides.namespaces && file in overrides.namespaces ? overrides.namespaces[file] : 'Demo';
            return ns ? { namespace: ns, line: 0, character: 11 } : null;
        },
        expectedNamespace: async file => (overrides.expected && file in overrides.expected ? overrides.expected[file] : 'Demo'),
        codeActions: async file => {
            calls.push(`actions ${file}`);
            const sequence = overrides.offered?.[file] ?? [[]];
            const n = asked[file] = (asked[file] ?? 0) + 1;
            return sequence[Math.min(n, sequence.length) - 1];
        },
        applyAndSave: async () => { calls.push('apply'); return true; },
        ...overrides,
    };
    return { deps, calls };
}

describe('syncNamespaces', () => {
    it('applies the action of a mismatching file and checks it is gone', async () => {
        const { deps, calls } = makeDeps({ offered: { '/a.cs': [[change()], []] } });
        const result = await syncNamespaces(['/a.cs'], deps);
        expect(result).toEqual({ changed: ['/a.cs'], unchanged: 0, failed: [], cancelled: false, mismatches: 0 });
        expect(calls).toEqual(['actions /a.cs', 'apply', 'actions /a.cs']);
    });

    it('counts a file without an offered action as unchanged', async () => {
        const { deps } = makeDeps();
        expect(await syncNamespaces(['/a.cs'], deps)).toMatchObject({ changed: [], unchanged: 1, mismatches: 0 });
    });

    it('counts a mismatching file without an action in mismatches', async () => {
        const { deps } = makeDeps({ namespaces: { '/a.cs': 'Wrong' }, expected: { '/a.cs': 'Demo' } });
        expect(await syncNamespaces(['/a.cs'], deps)).toMatchObject({ changed: [], unchanged: 1, mismatches: 1 });
    });

    it('does not count a file whose expected namespace is unknown as a mismatch', async () => {
        const { deps } = makeDeps({ namespaces: { '/a.cs': 'Wrong' }, expected: { '/a.cs': null } });
        expect(await syncNamespaces(['/a.cs'], deps)).toMatchObject({ mismatches: 0 });
    });

    it('counts a file without a namespace as unchanged and asks nothing', async () => {
        const { deps, calls } = makeDeps({ namespaces: { '/a.cs': null } });
        expect(await syncNamespaces(['/a.cs'], deps)).toMatchObject({ unchanged: 1, changed: [] });
        expect(calls).toEqual([]);
    });

    it('reports a failed apply and goes on', async () => {
        const { deps } = makeDeps({ offered: { '/a.cs': [[change()]], '/b.cs': [[change()], []] }, applyAndSave: jest.fn().mockResolvedValueOnce(false).mockResolvedValue(true) });
        const result = await syncNamespaces(['/a.cs', '/b.cs'], deps);
        expect(result.changed).toEqual(['/b.cs']);
        expect(result.failed).toEqual([{ file: '/a.cs', reason: 'the edit could not be applied' }]);
    });

    it('reports an exception of a dependency as failure', async () => {
        const { deps } = makeDeps({ codeActions: async () => { throw new Error('server gone'); } });
        const result = await syncNamespaces(['/a.cs'], deps);
        expect(result.failed).toEqual([{ file: '/a.cs', reason: 'server gone' }]);
    });

    it('fails a file whose action is still offered after applying it, without looping', async () => {
        const { deps, calls } = makeDeps({ offered: { '/a.cs': [[change()]] } });
        const result = await syncNamespaces(['/a.cs'], deps);
        expect(result.failed).toEqual([{ file: '/a.cs', reason: 'namespace still does not match' }]);
        expect(result.changed).toEqual([]);
        expect(calls.filter(c => c === 'apply')).toHaveLength(1);
    });

    it('fails an action that came without an edit', async () => {
        const { deps, calls } = makeDeps({ offered: { '/a.cs': [[{ title: "Change namespace to 'X'" }]] } });
        const result = await syncNamespaces(['/a.cs'], deps);
        expect(result.failed).toEqual([{ file: '/a.cs', reason: 'the language server returned no edit' }]);
        expect(calls).not.toContain('apply');
    });

    it('stops after the current file when cancelled', async () => {
        const token = { isCancellationRequested: false };
        const { deps } = makeDeps({
            offered: { '/a.cs': [[change()], []], '/b.cs': [[change()], []] },
            applyAndSave: async () => { token.isCancellationRequested = true; return true; },
        });
        const result = await syncNamespaces(['/a.cs', '/b.cs'], deps, token);
        expect(result.changed).toEqual(['/a.cs']);
        expect(result.cancelled).toBe(true);
    });

    it('processes the files strictly one at a time in the given order', async () => {
        const order: string[] = [];
        const { deps } = makeDeps({
            codeActions: async file => {
                order.push(`start ${file}`);
                await new Promise(r => setTimeout(r, file === '/a.cs' ? 20 : 0));
                order.push(`end ${file}`);
                return [];
            },
        });
        await syncNamespaces(['/a.cs', '/b.cs', '/c.cs'], deps);
        expect(order).toEqual(['start /a.cs', 'end /a.cs', 'start /b.cs', 'end /b.cs', 'start /c.cs', 'end /c.cs']);
    });

    it('never picks a Fix All entry', async () => {
        const fixAll: SyncAction = { title: "Fix All: Change namespace to 'X'", command: 'roslyn.client.fixAllCodeAction' };
        const other: SyncAction = { title: 'Convert to block scoped namespace', edit: {} };
        const picked: SyncAction[] = [];
        const { deps } = makeDeps({
            offered: { '/a.cs': [[other, fixAll, change('Demo.Real')], []] },
            applyAndSave: async action => { picked.push(action); return true; },
        });
        await syncNamespaces(['/a.cs'], deps);
        expect(picked.map(a => a.title)).toEqual(["Change namespace to 'Demo.Real'"]);

        const { deps: onlyFixAll } = makeDeps({ offered: { '/a.cs': [[fixAll]] }, applyAndSave: async () => { throw new Error('must not apply'); } });
        expect(await syncNamespaces(['/a.cs'], onlyFixAll)).toMatchObject({ changed: [], unchanged: 1 });
    });

    it('reports progress per file', async () => {
        const { deps } = makeDeps();
        const seen: Array<[number, number, string]> = [];
        await syncNamespaces(['/a.cs', '/b.cs'], deps, undefined, (i, n, f) => seen.push([i, n, f]));
        expect(seen).toEqual([[1, 2, '/a.cs'], [2, 2, '/b.cs']]);
    });
});

describe('syncSummary', () => {
    const base = { changed: [] as string[], unchanged: 0, failed: [] as Array<{ file: string; reason: string }>, cancelled: false, mismatches: 0 };

    it('says all match when nothing changed and nothing mismatches', () => {
        expect(syncSummary({ ...base, unchanged: 3 }, 3)).toEqual({ text: 'All namespaces already match', level: 'info', details: false });
    });

    it('names the changed count', () => {
        expect(syncSummary({ ...base, changed: ['a', 'b'], unchanged: 1 }, 3).text).toBe('Synced namespaces in 2 of 3 files');
    });

    it('adds the failures and offers the details', () => {
        const s = syncSummary({ ...base, changed: ['a'], failed: [{ file: 'b', reason: 'x' }] }, 2);
        expect(s).toEqual({ text: 'Synced namespaces in 1 of 2 files, 1 failed', level: 'warning', details: true });
    });

    it('points at IDE0130 when nothing changed but folders mismatch', () => {
        const s = syncSummary({ ...base, unchanged: 2, mismatches: 2 }, 2);
        expect(s.level).toBe('warning');
        expect(s.text).toContain('2 files whose namespaces differ');
        expect(s.text).toContain('dotnet_diagnostic.IDE0130.severity = warning');
        expect(s.text).toContain('dotnet_style_namespace_match_folder = true');
    });

    it('mentions a cancel', () => {
        expect(syncSummary({ ...base, changed: ['a'], cancelled: true }, 5).text).toContain('cancelled after 1 of 5 files');
    });
});
