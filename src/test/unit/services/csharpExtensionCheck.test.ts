const env = {
    installed: [] as string[],
    uriScheme: 'vscode',
    choice: undefined as string | undefined,
    warnings: [] as string[],
    commands: [] as unknown[][],
};

jest.mock('vscode', () => ({
    extensions: { getExtension: (id: string) => env.installed.includes(id) ? { id } : undefined },
    env: { get uriScheme() { return env.uriScheme; } },
    window: {
        showWarningMessage: async (message: string, ...items: string[]) => {
            env.warnings.push(message);
            return items.find(i => i.startsWith(env.choice ?? '\0'));
        },
    },
    commands: { executeCommand: async (...args: unknown[]) => { env.commands.push(args); } },
}), { virtual: true });

import { checkCSharpExtension } from '../../../services/csharpExtensionCheck';

describe('checkCSharpExtension', () => {
    let state: Map<string, unknown>;
    const context = () => ({
        globalState: { get: (k: string) => state.get(k), update: async (k: string, v: unknown) => { state.set(k, v); } },
    }) as any;

    beforeEach(() => {
        state = new Map();
        Object.assign(env, { installed: [], uriScheme: 'vscode', choice: undefined, warnings: [], commands: [] });
    });

    test.each(['ms-dotnettools.csharp', 'muhammad-sammy.csharp'])('is satisfied by %s', async id => {
        env.installed = [id];
        await checkCSharpExtension(context());
        expect(env.warnings).toEqual([]);
    });

    test.each([
        ['vscode', 'ms-dotnettools.csharp'],
        ['vscode-insiders', 'ms-dotnettools.csharp'],
        ['vscodium', 'muhammad-sammy.csharp'],
        ['cursor', 'muhammad-sammy.csharp'],
    ])('in %s installs %s', async (uriScheme, id) => {
        env.uriScheme = uriScheme;
        env.choice = 'Install';
        await checkCSharpExtension(context());
        expect(env.commands).toEqual([['workbench.extensions.installExtension', id]]);
    });

    test("stops warning after Don't Show Again", async () => {
        env.choice = "Don't";
        await checkCSharpExtension(context());
        await checkCSharpExtension(context());
        expect(env.warnings).toHaveLength(1);
        expect(env.commands).toEqual([]);
    });
});
