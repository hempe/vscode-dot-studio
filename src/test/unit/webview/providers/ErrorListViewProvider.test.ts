const settings: Record<string, boolean> = {};
jest.mock('vscode', () => ({
    workspace: {
        getConfiguration: () => ({ get: (key: string, fallback: boolean) => settings[key] ?? fallback, inspect: () => undefined }),
        onDidChangeConfiguration: () => ({ dispose: () => undefined }),
    },
    commands: { executeCommand: async () => undefined },
    Uri: { joinPath: () => ({}) },
}), { virtual: true });
jest.mock('../../../../webview/providers/views/ErrorListWebview', () => ({ ErrorListWebview: { getHtmlForWebview: () => '' } }));
jest.mock('../../../../services/solution/solutionService', () => ({ SolutionService: { getActiveSolution: () => undefined } }));

import { ErrorListViewProvider } from '../../../../webview/providers/ErrorListViewProvider';

const errors = (file: string, count: number) => ({
    uri: { fsPath: file },
    diagnostics: Array.from({ length: count }, () => ({ severity: 'error', message: 'broken', range: { start: { line: 0, character: 0 } } })),
});

describe('Error List badge', () => {
    const files = new Map([['/repo/a/x.cs', errors('/repo/a/x.cs', 2)], ['/repo/b/y.cs', errors('/repo/b/y.cs', 3)]]);
    const view = { badge: undefined as { value: number } | undefined, webview: { options: {}, html: '', onDidReceiveMessage: () => ({ dispose: () => undefined }), postMessage: async () => true } };
    let provider: ErrorListViewProvider;

    beforeEach(() => {
        for (const key of Object.keys(settings)) { delete settings[key]; }
        provider = new ErrorListViewProvider({} as never, { files, onDidChange: () => ({ dispose: () => undefined }) } as never);
        provider.resolveWebviewView(view as never);
    });

    test('counts the errors of the whole solution without a scope', () => {
        expect(view.badge?.value).toBe(5);
    });

    test('counts only the errors of the scope the list is narrowed to', async () => {
        await provider.showScope('b', { prefixes: ['/repo/b/'], files: [] });
        expect(view.badge?.value).toBe(3);
        await provider.showScope('c', { prefixes: ['/repo/c/'], files: [] });
        expect(view.badge).toBeUndefined();
    });

    test('shows no count while the errors are toggled off (the list hides them)', () => {
        settings['shinobi.diagnostics.showErrors'] = false;
        provider.refresh();
        expect(view.badge).toBeUndefined();
    });
});
