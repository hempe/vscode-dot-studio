const env = {
    installed: [] as string[],
    uriScheme: 'vscode',
    choice: undefined as string | undefined,
    warnings: [] as string[],
    commands: [] as unknown[][],
    settings: {} as Record<string, unknown>,
    updates: [] as unknown[][],
    infoChoice: undefined as string | undefined,
    infos: [] as string[],
};

jest.mock('vscode', () => ({
    extensions: { getExtension: (id: string) => env.installed.includes(id) ? { id } : undefined },
    env: { get uriScheme() { return env.uriScheme; } },
    window: {
        showWarningMessage: async (message: string, ...items: string[]) => {
            env.warnings.push(message);
            return items.find(i => i.startsWith(env.choice ?? '\0'));
        },
        showInformationMessage: async (message: string, ...items: string[]) => {
            env.infos.push(message);
            return items.find(i => i.startsWith(env.infoChoice ?? '\0'));
        },
    },
    workspace: {
        getConfiguration: (section: string) => ({
            get: (key: string) => env.settings[`${section}.${key}`],
            update: async (key: string, value: unknown, target: unknown) => { env.updates.push([`${section}.${key}`, value, target]); },
        }),
    },
    ConfigurationTarget: { Workspace: 2 },
    commands: { executeCommand: async (...args: unknown[]) => { env.commands.push(args); } },
}), { virtual: true });

import { checkCSharpExtension, checkOmniSharpForSlnx } from '../../../services/csharpExtensionCheck';

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

describe('checkOmniSharpForSlnx', () => {
    let n = 0;
    // Each test uses its own solution path; the warning is shown once per solution and window
    const solution = (ext: string) => `/repo/Test${++n}.${ext}`;

    beforeEach(() => {
        Object.assign(env, { choice: undefined, infoChoice: undefined, warnings: [], infos: [], commands: [], updates: [], settings: {} });
    });

    test('does nothing for .sln, without OmniSharp, or without a C# extension', async () => {
        env.settings['dotnet.server.useOmnisharp'] = true;
        await checkOmniSharpForSlnx(solution('sln'));
        env.settings['dotnet.server.useOmnisharp'] = false;
        await checkOmniSharpForSlnx(solution('slnx'));
        env.settings = {};
        await checkOmniSharpForSlnx(solution('slnx'));

        expect(env.warnings).toEqual([]);
    });

    test('switches the workspace to the Roslyn language server and offers a reload', async () => {
        env.settings['dotnet.server.useOmnisharp'] = true;
        env.choice = 'Use Roslyn';
        env.infoChoice = 'Reload Window';

        await checkOmniSharpForSlnx(solution('slnx'));

        expect(env.warnings).toEqual([expect.stringContaining('OmniSharp cannot load .slnx')]);
        expect(env.updates).toEqual([['dotnet.server.useOmnisharp', false, 2]]);
        expect(env.commands).toEqual([['workbench.action.reloadWindow']]);
    });

    test('warns only once per solution', async () => {
        env.settings['dotnet.server.useOmnisharp'] = true;
        const path = solution('slnx');

        await checkOmniSharpForSlnx(path);
        await checkOmniSharpForSlnx(path);

        expect(env.warnings).toHaveLength(1);
        expect(env.updates).toEqual([]);
    });
});

describe('language server default', () => {
    it('makes the Roslyn language server the default, so muhammad-sammy.csharp loads .slnx without OmniSharp', () => {
        const packageJson = require('../../../../package.json');
        expect(packageJson.contributes.configurationDefaults).toEqual(expect.objectContaining({ 'dotnet.server.useOmnisharp': false }));
    });
});
