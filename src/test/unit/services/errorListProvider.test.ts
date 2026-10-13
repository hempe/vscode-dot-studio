const env = {
    contexts: {} as Record<string, unknown>,
    solution: undefined as undefined | { projects: Map<string, unknown> },
};

jest.mock('vscode', () => {
    class EventEmitter {
        private listeners: (() => void)[] = [];
        event = (listener: () => void) => { this.listeners.push(listener); return { dispose() { } }; };
        fire() { this.listeners.forEach(l => l()); }
        dispose() { }
    }
    class TreeItem {
        description?: string;
        iconPath?: unknown;
        command?: unknown;
        tooltip?: string;
        id?: string;
        constructor(public label: unknown, public collapsibleState?: number) { }
    }
    class ThemeIcon {
        static File = { id: 'file' };
        constructor(public id: string, public color?: unknown) { }
    }
    class ThemeColor {
        constructor(public id: string) { }
    }
    return {
        EventEmitter, TreeItem, ThemeIcon, ThemeColor,
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
        commands: { executeCommand: async (_: string, key: string, value: unknown) => { env.contexts[key] = value; } },
    };
}, { virtual: true });

jest.mock('../../../services/solutionService', () => ({
    SolutionService: { getActiveSolution: () => env.solution },
}));

import { ErrorListProvider } from '../../../services/errorListProvider';
import { FileDiagnostics, ListedDiagnostic } from '../../../services/diagnosticsService';
import { normalizePath } from '../../../services/diagnosticsRollup';

const diag = (severity: ListedDiagnostic['severity'], line: number, message = `${severity} ${line}`): ListedDiagnostic =>
    ({ severity, message, code: 'CS1', range: { start: { line, character: 4 } } }) as ListedDiagnostic;

function setup(diagnostics: ListedDiagnostic[], stored?: object) {
    const file = '/repo/Api/Program.cs';
    const files = new Map<string, FileDiagnostics>([[normalizePath(file), { uri: { fsPath: file } as any, diagnostics }]]);
    const changeListeners: (() => void)[] = [];
    const service = { files, onDidChange: (l: () => void) => { changeListeners.push(l); return { dispose() { } }; } };
    const state = new Map<string, unknown>(stored ? [['shinobi.errorList.filter', stored]] : []);
    const memento = { get: (key: string) => state.get(key), update: async (key: string, value: unknown) => { state.set(key, value); } };
    const view = { description: undefined as string | undefined, badge: undefined as unknown, message: undefined as string | undefined };
    const provider = new ErrorListProvider(service as any, memento as any);
    provider.attach(view as any);
    return { provider, view, state, fireChange: () => changeListeners.forEach(l => l()) };
}

beforeEach(() => {
    env.contexts = {};
    env.solution = { projects: new Map([['/repo/Api/Api.csproj', {}]]) };
});

describe('ErrorListProvider', () => {
    test('lists project, file and diagnostics', async () => {
        const { provider } = setup([diag('error', 2), diag('info', 0)]);
        const [project] = await provider.getChildren();
        expect(provider.getTreeItem(project)).toMatchObject({ label: 'Api', description: '2', collapsibleState: 2 });

        const [file] = await provider.getChildren(project);
        expect(provider.getTreeItem(file)).toMatchObject({ label: { fsPath: '/repo/Api/Program.cs' }, description: '2' });

        const items = (await provider.getChildren(file)).map(node => provider.getTreeItem(node));
        expect(items.map(i => [i.label, i.description, (i.iconPath as any).id])).toEqual([
            ['info 0', 'CS1 (1, 5)', 'info'],
            ['error 2', 'CS1 (3, 5)', 'error'],
        ]);
        expect(items[1].command).toEqual({
            command: 'vscode.open',
            title: 'Go to Diagnostic',
            arguments: [{ fsPath: '/repo/Api/Program.cs' }, { selection: { start: { line: 2, character: 4 } } }],
        });
    });

    test('shows only the first line of multi-line messages in the label', async () => {
        const { provider } = setup([diag('error', 1, 'first line\nsecond line')]);
        const [project] = await provider.getChildren();
        const [file] = await provider.getChildren(project);
        const [item] = (await provider.getChildren(file)).map(node => provider.getTreeItem(node));
        expect(item.label).toBe('first line');
        expect(item.tooltip).toBe('first line\nsecond line');
    });

    test('summarises counts in the view description and badges errors', () => {
        const { view } = setup([diag('error', 1), diag('warning', 2), diag('info', 3), diag('info', 4)]);
        expect(view.description).toBe('1 error, 1 warning, 2 messages');
        expect(view.badge).toEqual({ value: 1, tooltip: '1 error' });
    });

    test('no badge without errors', () => {
        const { view } = setup([diag('warning', 1)]);
        expect(view.badge).toBeUndefined();
    });

    test('toggling a severity filters it, persists and updates the context key', async () => {
        const { provider, state } = setup([diag('error', 1), diag('info', 2)]);
        expect(env.contexts['shinobi.errorList.messagesShown']).toBe(true);

        await provider.toggle('messages');

        expect(env.contexts['shinobi.errorList.messagesShown']).toBe(false);
        expect(state.get('shinobi.errorList.filter')).toEqual({ errors: true, warnings: true, messages: false });
        const [project] = await provider.getChildren();
        const [file] = await provider.getChildren(project);
        expect((await provider.getChildren(file)).length).toBe(1);
    });

    test('restores the stored filter', () => {
        setup([], { warnings: false });
        expect(env.contexts['shinobi.errorList.warningsShown']).toBe(false);
        expect(env.contexts['shinobi.errorList.errorsShown']).toBe(true);
    });

    test('explains an empty list', async () => {
        const { provider, view } = setup([]);
        expect(await provider.getChildren()).toEqual([]);
        expect(view.message).toBe('No errors, warnings or messages. Build the solution to check every file.');
    });

    test('explains a list emptied by the filter', async () => {
        const { provider, view } = setup([diag('info', 1)]);
        await provider.toggle('messages');
        expect(view.message).toBe('1 message hidden by the filter.');
    });

    test('refreshes when diagnostics change', () => {
        const { provider, fireChange } = setup([]);
        const fired = jest.fn();
        provider.onDidChangeTreeData(fired);
        fireChange();
        expect(fired).toHaveBeenCalled();
    });
});
