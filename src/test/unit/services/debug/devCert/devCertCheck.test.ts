const env = {
    /** What `dotnet dev-certs` prints, or an error to fail with */
    output: '[]' as string | Error,
    /** Holds the check back until released */
    hold: undefined as Promise<void> | undefined,
    execCalls: [] as string[][],
    setting: true,
    dismissed: false,
    updates: [] as Array<[string, unknown]>,
    warnings: [] as string[],
    infos: [] as string[],
    answer: undefined as string | undefined,
    buttons: [] as string[],
    terminals: [] as Array<{ name: string; sent: string[] }>,
    closeListeners: [] as Array<(terminal: any) => void>,
};

jest.mock('child_process', () => ({
    execFile: (_file: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
        env.execCalls.push(args);
        const done = () => env.output instanceof Error ? callback(env.output, '') : callback(null, env.output);
        if (env.hold) {
            void env.hold.then(done);
        } else {
            done();
        }
    },
}));

jest.mock('vscode', () => ({
    workspace: { getConfiguration: () => ({ get: () => env.setting }) },
    window: {
        showWarningMessage: async (message: string, ...buttons: string[]) => { env.warnings.push(message); env.buttons = buttons; return env.answer; },
        showInformationMessage: async (message: string) => { env.infos.push(message); },
        createTerminal: (name: string) => {
            const terminal = { name, sent: [] as string[], show: () => undefined, sendText: (text: string) => terminal.sent.push(text) };
            env.terminals.push(terminal);
            return terminal;
        },
        onDidCloseTerminal: (listener: (terminal: any) => void) => { env.closeListeners.push(listener); return { dispose: () => undefined }; },
    },
}), { virtual: true });

const cert = (trust: string) => JSON.stringify([{
    IsHttpsDevelopmentCertificate: true, TrustLevel: trust,
    ValidityNotBefore: '2020-01-01T00:00:00Z', ValidityNotAfter: '2999-01-01T00:00:00Z',
}]);
const https = { applicationUrl: 'https://localhost:7275;http://localhost:5181' };
const http = { applicationUrl: 'http://localhost:5181' };
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** A fresh module state per test: the check is once per session, kept in the module */
function load() {
    jest.resetModules();
    return require('../../../../../services/debug/devCert/devCertCheck') as typeof import('../../../../../services/debug/devCert/devCertCheck');
}

describe('devCertCheck', () => {
    let mod: typeof import('../../../../../services/debug/devCert/devCertCheck');
    const context = () => ({
        globalState: { get: () => env.dismissed, update: async (key: string, value: unknown) => { env.updates.push([key, value]); } },
        subscriptions: [] as unknown[],
    }) as any;

    beforeEach(() => {
        Object.assign(env, { output: '[]', hold: undefined, execCalls: [], setting: true, dismissed: false, updates: [], warnings: [], infos: [],
            answer: undefined, buttons: [], terminals: [], closeListeners: [] });
        mod = load();
        mod.initDevCertCheck(context());
    });

    it('checks once for an https profile and asks when there is no certificate', async () => {
        mod.checkDevCertificateBeforeStart([https]);
        mod.checkDevCertificateBeforeStart([https]);
        await flush();

        expect(env.execCalls).toEqual([['dev-certs', 'https', '--check-trust-machine-readable']]);
        expect(env.warnings).toHaveLength(1);
        expect(env.warnings[0]).toContain('no HTTPS development certificate');
        expect(env.warnings[0]).toContain('creates it');
        expect(env.buttons).toEqual(['Trust Certificate', 'Not Now', "Don't Ask Again"]);
    });

    it('says the certificate is not trusted when there is one nothing trusts', async () => {
        env.output = cert('None');
        mod.checkDevCertificateBeforeStart([http, https]);
        await flush();

        expect(env.warnings).toEqual([expect.stringContaining('The HTTPS development certificate is not trusted: https://localhost will show a certificate warning in the browser.')]);
    });

    it('stays silent for a trusted or partially trusted certificate', async () => {
        env.output = cert('Full');
        mod.checkDevCertificateBeforeStart([https]);
        await flush();
        expect(env.warnings).toEqual([]);

        mod = load();
        mod.initDevCertCheck(context());
        env.output = cert('Partial');
        mod.checkDevCertificateBeforeStart([https]);
        await flush();
        expect(env.warnings).toEqual([]);
    });

    it('does not check http only profiles, no profile, the disabled setting or a dismissed prompt', async () => {
        mod.checkDevCertificateBeforeStart([http, undefined, {}]);
        env.setting = false;
        mod.checkDevCertificateBeforeStart([https]);
        env.setting = true;
        env.dismissed = true;
        mod.checkDevCertificateBeforeStart([https]);
        await flush();

        expect(env.execCalls).toEqual([]);
    });

    it('does nothing before the extension initialised it', async () => {
        load().checkDevCertificateBeforeStart([https]);
        await flush();
        expect(env.execCalls).toEqual([]);
    });

    it('does not wait for the check', async () => {
        let release!: () => void;
        env.hold = new Promise<void>(resolve => { release = resolve; });

        // Returns synchronously, with the check still running
        expect(mod.checkDevCertificateBeforeStart([https])).toBeUndefined();
        expect(env.execCalls).toHaveLength(1);
        expect(env.warnings).toEqual([]);

        release();
        await flush();
        expect(env.warnings).toHaveLength(1);
    });

    it.each([
        ['the command fails', new Error('spawn dotnet ENOENT')],
        ['the output is not JSON', 'Something went wrong'],
    ])('shows nothing when %s', async (_name, output) => {
        env.output = output;
        mod.checkDevCertificateBeforeStart([https]);
        await flush();

        expect(env.warnings).toEqual([]);
        expect(env.terminals).toEqual([]);
    });

    it('Trust Certificate runs dev-certs --trust in a terminal and checks again on the next start', async () => {
        env.output = cert('None');
        env.answer = 'Trust Certificate';
        mod.checkDevCertificateBeforeStart([https]);
        await flush();

        expect(env.terminals).toEqual([expect.objectContaining({ name: 'HTTPS certificate', sent: ['dotnet dev-certs https --trust'] })]);
        mod.checkDevCertificateBeforeStart([https]);
        await flush();
        expect(env.execCalls).toHaveLength(2);
    });

    it('checks again after the trust terminal closed', async () => {
        mod.checkDevCertificateBeforeStart([https]);
        await flush();
        env.closeListeners.forEach(listener => listener({ name: 'Other' }));
        mod.checkDevCertificateBeforeStart([https]);
        await flush();
        expect(env.execCalls).toHaveLength(1);

        env.closeListeners.forEach(listener => listener({ name: 'HTTPS certificate' }));
        mod.checkDevCertificateBeforeStart([https]);
        await flush();
        expect(env.execCalls).toHaveLength(2);
    });

    it("Don't Ask Again is stored, Not Now stores nothing", async () => {
        env.answer = "Don't Ask Again";
        mod.checkDevCertificateBeforeStart([https]);
        await flush();
        expect(env.updates).toEqual([['shinobi.devCert.dismissed', true]]);

        env.updates = [];
        mod = load();
        mod.initDevCertCheck(context());
        env.answer = 'Not Now';
        mod.checkDevCertificateBeforeStart([https]);
        await flush();
        expect(env.updates).toEqual([]);
        expect(env.terminals).toEqual([]);
    });

    it('appends the sentence about Linux only on Linux', async () => {
        const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
        try {
            for (const [name, expected] of [['linux', true], ['win32', false]] as const) {
                Object.defineProperty(process, 'platform', { value: name });
                env.warnings = [];
                mod = load();
                mod.initDevCertCheck(context());
                env.output = cert('None');
                mod.checkDevCertificateBeforeStart([https]);
                await flush();
                expect(env.warnings).toHaveLength(1);
                expect(env.warnings[0].includes('partial on Linux')).toBe(expected);
                expect(env.warnings[0].includes('https://learn.microsoft.com/dotnet/core/tools/dotnet-dev-certs')).toBe(expected);
            }
        } finally {
            Object.defineProperty(process, 'platform', platform);
        }
    });

    describe('Trust HTTPS Development Certificate', () => {
        it('says when the certificate is already trusted', async () => {
            env.output = cert('Full');
            await mod.trustDevCertificate();
            expect(env.infos).toEqual(['The HTTPS development certificate is trusted.']);
            expect(env.terminals).toEqual([]);
        });

        it('trusts through the terminal when it is not, also when the start check is switched off', async () => {
            env.output = cert('None');
            env.setting = false;
            env.dismissed = true;
            await mod.trustDevCertificate();
            expect(env.terminals[0].sent).toEqual(['dotnet dev-certs https --trust']);
        });

        it('trusts through the terminal when there is no certificate, or when the check fails', async () => {
            await mod.trustDevCertificate();
            env.output = new Error('no dotnet');
            await mod.trustDevCertificate();
            expect(env.terminals).toHaveLength(2);
        });
    });
});
