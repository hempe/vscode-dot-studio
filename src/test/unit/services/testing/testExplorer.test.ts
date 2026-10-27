import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';

jest.mock('vscode', () => {
    class Collection {
        private readonly map = new Map<string, any>();
        constructor(private readonly owner?: any) { }
        add(item: any) { item.parent = this.owner; this.map.set(item.id, item); }
        delete(id: string) { this.map.delete(id); }
        get(id: string) { return this.map.get(id); }
        replace(items: any[]) { this.map.clear(); items.forEach(item => this.add(item)); }
        forEach(callback: (item: any) => void) { [...this.map.values()].forEach(callback); }
        get size() { return this.map.size; }
    }
    class TestMessage {
        location: unknown;
        constructor(public message: string) { }
        static diff(message: string, expected: string, actual: string) { return Object.assign(new TestMessage(message), { expectedOutput: expected, actualOutput: actual }); }
    }
    const runs: any[] = [];
    const messages: string[] = [];
    const controller: any = {
        items: new Collection(),
        profiles: [] as any[],
        createTestItem: (id: string, label: string, uri?: unknown) => {
            const item: any = { id, label, uri };
            item.children = new Collection(item);
            return item;
        },
        createRunProfile: (label: string, kind: number, handler: Function) => controller.profiles.push({ label, kind, handler }),
        createTestRun: () => {
            const events: string[] = [];
            const run = {
                events, messages: new Map<string, any>(), output: [] as string[],
                enqueued: (item: any) => events.push(`enqueued ${item.label}`),
                started: (item: any) => events.push(`started ${item.label}`),
                passed: (item: any) => events.push(`passed ${item.label}`),
                skipped: (item: any) => events.push(`skipped ${item.label}`),
                failed: (item: any, message: any) => { events.push(`failed ${item.label}`); run.messages.set(item.label, message); },
                errored: (item: any, message: any) => { events.push(`errored ${item.label}`); run.messages.set(item.label, message); },
                appendOutput: (text: string) => { run.output.push(text); },
                end: () => events.push('end'),
            };
            runs.push(run);
            return run;
        },
        dispose: () => { },
    };
    const disposable = { dispose: () => { } };
    return {
        controller, runs, TestMessage,
        tests: { createTestController: () => controller },
        TestRunProfileKind: { Run: 1, Debug: 2 },
        Uri: { file: (p: string) => ({ fsPath: require('path').normalize(p) }) },
        Range: class { constructor(public startLine: number, public startCharacter: number, public endLine: number, public endCharacter: number) { } },
        Location: class { constructor(public uri: unknown, public range: unknown) { } },
        tasks: { onDidEndTaskProcess: () => disposable },
        debug: { onDidStartDebugSession: () => disposable },
        workspace: { workspaceFolders: undefined },
        commands: { executeCommand: async () => undefined },
        window: { showInformationMessage: async (message: string) => { messages.push(message); } },
        messages,
        TestRunRequest: class { constructor(public include?: any[], public exclude?: any[]) { } },
        CancellationTokenSource: class {
            token = { isCancellationRequested: false, onCancellationRequested: () => disposable };
            dispose() { }
        },
    };
}, { virtual: true });

import * as vscode from 'vscode';
import { NOT_BUILT, TestExplorer } from '../../../../services/testing/testExplorer';
import { frame, MessageReader } from '../../../../services/testing/testingPlatformClient';
import { replay as replayVsTest } from './vstestReplay';
import { DEFAULT_RUN_SETTINGS } from '../../../../services/testing/runSettings';
import { MONO_DEBUG_UNSUPPORTED } from '../../../../services/testing/monoVsTest';

const recording = fs.readFileSync(path.join(__dirname, '../../../../__fixtures__/testing-platform/X3.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map(line => JSON.parse(line));

/** Plays the recorded xUnit v3 app: discovery updates for discoverTests, result updates for runTests */
async function replayApp(args: string[], discovers = true) {
    const socket = net.connect(Number(args[args.indexOf('--client-port') + 1]), '127.0.0.1');
    const reader = new MessageReader();
    const updates = recording.filter(m => m.method === 'testing/testUpdates/tests' && m.params.changes);
    const discovered = updates.filter(m => m.params.changes[0].node['execution-state'] === 'discovered');
    socket.on('data', chunk => {
        for (const message of reader.push(chunk as Buffer) as any[]) {
            const reply = (result: unknown) => socket.write(frame({ jsonrpc: '2.0', id: message.id, result }));
            if (message.method === 'initialize') reply(recording[0].result);
            if (message.method === 'testing/discoverTests') { if (discovers) discovered.forEach(m => socket.write(frame(m))); reply({}); }
            if (message.method === 'testing/runTests') { updates.filter(m => !discovered.includes(m)).forEach(m => socket.write(frame(m))); reply({ attachments: [] }); }
            if (message.method === 'exit') socket.end();
        }
    });
    return { kill: () => socket.destroy(), output: () => '' };
}

const mock = vscode as any;
const projectPath = '/repo/X3/X3.csproj';
const native = (p: string) => path.normalize(p);

function explorer(overrides: Record<string, unknown> = {}) {
    return new TestExplorer({
        projects: () => [projectPath, '/repo/Lib/Lib.csproj'],
        readProject: p => p === projectPath ? '<Project><ItemGroup><PackageReference Include="xunit.v3" /></ItemGroup></Project>' : '<Project />',
        evaluate: async p => ({ projectPath: p, targetPath: '/repo/X3/bin/Debug/net10.0/X3.dll', testingPlatform: true }),
        build: async () => true,
        start: async (_project, args) => replayApp(args),
        modified: () => 1,
        ...overrides,
    });
}

const outline = (items: any, indent = ''): string[] => {
    const lines: string[] = [];
    items.forEach((item: any) => lines.push(`${indent}${item.label}${item.range ? ` :${item.range.startLine + 1}` : ''}`, ...outline(item.children, indent + '  ')));
    return lines;
};

describe('TestExplorer', () => {
    beforeEach(() => {
        mock.controller.items.replace([]);
        mock.controller.profiles.length = 0;
        mock.runs.length = 0;
        mock.messages.length = 0;
    });

    it('shows the discovered tests of test projects only', async () => {
        await explorer().refresh(false);
        expect(outline(mock.controller.items)).toEqual([
            'X3',
            '  X3.Math',
            '    MathTests :4',
            '      Adds :4',
            '      Fails :5',
            '      Positive :6',
            '        x: 1 :6',
            '        x: 2 :6',
        ]);
    });

    it('does not keep the test items of earlier discoveries (review A5-1)', async () => {
        let time = 1;
        const testExplorer = explorer({ modified: () => time++ });
        await testExplorer.refresh(false);
        const size = () => (testExplorer as any).nodes.size;
        const afterFirst = size();
        expect(afterFirst).toBeGreaterThan(0);

        for (let i = 0; i < 5; i++) {
            await testExplorer.refresh(false);
        }

        expect(size()).toBe(afterFirst);
    });

    it('runs tests and reports results with messages and locations', async () => {
        await explorer().refresh(false);
        const project = mock.controller.items.get(projectPath);
        const [run] = mock.controller.profiles;

        await run.handler({ include: [project], exclude: [] }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => { } }) });

        const [testRun] = mock.runs;
        expect(testRun.events).toEqual(expect.arrayContaining(['started Adds', 'passed Adds', 'failed Fails', 'passed x: 1', 'passed x: 2']));
        expect(testRun.events.at(-1)).toBe('end');
        const message = testRun.messages.get('Fails');
        expect(message.message).toMatch(/^Assert.Equal\(\) Failure: Values differ[\s\S]*at X3.Math.MathTests.Fails\(\)/);
        expect(message.location.range.startLine).toBe(4);
    });

    it('marks the tests errored when the build fails', async () => {
        const tests = explorer({ build: async () => false });
        await tests.refresh(false);
        const [run] = mock.controller.profiles;
        await run.handler({ include: undefined, exclude: [] }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => { } }) });
        expect(mock.runs[0].events).toContain('errored Adds');
        expect(mock.runs[0].messages.get('Adds').message).toBe('Build failed');
    });

    it('puts the errors of a failed build into the message, since no Problems panel has them (review A5-11)', async () => {
        const tests = explorer({ build: async (_p: string, _c: string, output: (text: string) => void) => { output('Restoring...\n/w/X.csproj : error NU1301: Unable to load the service index [/w/X.csproj]\n'); return false; } });
        await tests.refresh(false);
        const [run] = mock.controller.profiles;
        await run.handler({ include: undefined, exclude: [] }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => { } }) });
        expect(mock.runs[0].messages.get('Adds').message).toBe('Build failed:\n/w/X.csproj : error NU1301: Unable to load the service index [/w/X.csproj]');
    });

    it('hands the build a signal that Cancel triggers, and runs nothing after it (review A5-11)', async () => {
        let signal: AbortSignal | undefined;
        let cancel = () => { };
        const token = { isCancellationRequested: false, onCancellationRequested: (listener: () => void) => { cancel = listener; return { dispose: () => { } }; } };
        const tests = explorer({ build: async (_p: string, _c: string, _o: unknown, _f: unknown, s: AbortSignal) => { signal = s; token.isCancellationRequested = true; cancel(); return false; } });
        await tests.refresh(false);
        const [run] = mock.controller.profiles;
        await run.handler({ include: undefined, exclude: [] }, token);
        expect(signal?.aborted).toBe(true);
        expect(mock.runs[0].events.filter((event: string) => event.startsWith('errored'))).toEqual([]);
    });

    it('leaves VSTest projects out', async () => {
        await explorer({ evaluate: async (p: string) => ({ projectPath: p, targetPath: '/t.dll', testingPlatform: false }) }).refresh(false);
        expect(mock.controller.items.size).toBe(0);
    });

    describe('Run all before the tests are known', () => {
        const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => { } }) };
        const passedOrFailed = (run: any) => run.events.filter((event: string) => /^(passed|failed) /.test(event)).sort();

        it('says a project that was never built is not built yet, then builds, discovers and runs it', async () => {
            let modified: number | undefined;
            await explorer({ build: async () => { modified = 1; return true; }, modified: () => modified }).refresh(false);
            const project = mock.controller.items.get(projectPath);
            expect(project.children.size).toBe(0);
            expect(project.description).toBe(NOT_BUILT);

            const [run] = mock.controller.profiles;
            await run.handler({ include: undefined, exclude: [] }, token);

            expect(passedOrFailed(mock.runs[0])).toEqual(['failed Fails', 'passed Adds', 'passed x: 1', 'passed x: 2']);
            expect(mock.runs[0].events).toContain('enqueued Adds');
            expect(project.description).toBeUndefined();
            expect(outline(mock.controller.items)).toContain('      Adds :4');
        });

        it('waits for the refresh in progress, so every test project runs', async () => {
            const other = '/repo/Y3/Y3.csproj';
            const tests = explorer({
                projects: () => [projectPath, other],
                readProject: () => '<Project><ItemGroup><PackageReference Include="xunit.v3" /></ItemGroup></Project>',
                evaluate: async (p: string) => {
                    if (p === other) {
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }
                    return { projectPath: p, targetPath: p.replace('.csproj', '.dll'), testingPlatform: true };
                },
            });
            void tests.refresh(false);
            await new Promise(resolve => setTimeout(resolve, 10));

            const [run] = mock.controller.profiles;
            await run.handler({ include: undefined, exclude: [] }, token);

            expect(mock.runs[0].events.filter((event: string) => event === 'passed Adds')).toHaveLength(2);
        });

        it('discovers again when results arrive for tests the tree does not have', async () => {
            let discovers = false;
            const tests = explorer({ start: async (_project: unknown, args: string[]) => replayApp(args, discovers) });
            await tests.refresh(false);
            expect(mock.controller.items.get(projectPath).children.size).toBe(0);

            discovers = true;
            const [run] = mock.controller.profiles;
            await run.handler({ include: undefined, exclude: [] }, token);

            expect(passedOrFailed(mock.runs[0])).toEqual(['failed Fails', 'passed Adds', 'passed x: 1', 'passed x: 2']);
            expect(outline(mock.controller.items)).toContain('      Adds :4');
        });

        it('says in the run output how many results have no test rather than dropping them', async () => {
            const tests = explorer({ start: async (_project: unknown, args: string[]) => replayApp(args, false) });
            await tests.refresh(false);

            const [run] = mock.controller.profiles;
            await run.handler({ include: undefined, exclude: [] }, token);

            expect(passedOrFailed(mock.runs[0])).toEqual([]);
            expect(mock.runs[0].output.join('')).toMatch(/\d+ result\(s\) of X3\.csproj could not be matched to a test in the Testing view: .*Adds/);
        });
    });

    describe('run settings (RunSettingsFilePath)', () => {
        const team = '<RunSettings><RunConfiguration><MaxCpuCount>0</MaxCpuCount><EnvironmentVariables><TEAM_VAR>yes</TEAM_VAR></EnvironmentVariables></RunConfiguration>'
            + '<TestRunParameters><Parameter name="Env" value="team" /></TestRunParameters><DataCollectionRunSettings><DataCollectors /></DataCollectionRunSettings></RunSettings>';
        const withSettings = async (p: string) => ({ projectPath: p, targetPath: '/repo/X3/bin/Debug/net10.0/X3.dll', testingPlatform: true, runSettingsPath: '/repo/team.runsettings' });
        const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => { } }) };

        it('gives a Microsoft.Testing.Platform app with the VSTest bridge the settings (--settings) and their environment variables', async () => {
            const starts: { args: string[]; environment: Record<string, string> }[] = [];
            const written: string[] = [];
            const tests = explorer({
                evaluate: withSettings,
                hasVsTestBridge: () => true,
                readRunSettings: (file: string) => file === '/repo/team.runsettings' ? team : undefined,
                writeRunSettings: (content: string) => { written.push(content); return '/tmp/shinobi-1.runsettings'; },
                start: async (_project: unknown, args: string[], _debug: boolean, environment: Record<string, string>) => { starts.push({ args, environment }); return replayApp(args); },
            });
            await tests.refresh(false);
            const [run] = mock.controller.profiles;
            await run.handler({ include: undefined, exclude: [] }, token);

            expect(starts).toHaveLength(2);
            for (const start of starts) {
                expect(start.args.slice(-2)).toEqual(['--settings', '/tmp/shinobi-1.runsettings']);
                expect(start.environment).toEqual({ TEAM_VAR: 'yes' });
            }
            expect(written[0]).toContain('<Parameter name="Env" value="team" />');
            expect(written[0]).not.toContain('EnvironmentVariables');
            expect(written[0]).not.toContain('DataCollectionRunSettings');
            expect(mock.runs[0].events).toContain('passed Adds');
        });

        it('starts apps without the VSTest bridge (xUnit v3, TUnit: they refuse --settings) as before', async () => {
            const starts: { args: string[]; environment: Record<string, string> }[] = [];
            const tests = explorer({
                evaluate: withSettings,
                hasVsTestBridge: () => false,
                readRunSettings: () => team,
                start: async (_project: unknown, args: string[], _debug: boolean, environment: Record<string, string>) => { starts.push({ args, environment }); return replayApp(args); },
            });
            await tests.refresh(false);
            expect(starts).toHaveLength(1);
            expect(starts[0].args).not.toContain('--settings');
            expect(starts[0].environment).toEqual({});
        });
    });

    describe('running the tests of a Solution Explorer node', () => {
        const ran = () => mock.runs[0].events.filter((event: string) => event.startsWith('passed') || event.startsWith('failed')).sort();
        const all = ['failed Fails', 'passed Adds', 'passed x: 1', 'passed x: 2'];

        it('runs a whole test project', async () => {
            await explorer().runTestsAt(native(projectPath), false);
            expect(ran()).toEqual(all);
        });

        it('runs the tests in a file or folder', async () => {
            await explorer().runTestsAt(native('/repo/X3/MathTests.cs'), false);
            expect(ran()).toEqual(all);

            mock.runs.length = 0;
            await explorer().runTestsAt(native('/repo/X3'), false);
            expect(ran()).toEqual(all);
        });

        it('runs every test project for the solution', async () => {
            await explorer().runTestsAt(native('/repo/X.slnx'), false);
            expect(ran()).toEqual(all);
        });

        it('builds and discovers first when the tests are not known yet', async () => {
            const built: string[] = [];
            let modified: number | undefined;
            const tests = explorer({
                build: async (p: string) => { built.push(p); modified = 1; return true; },
                modified: () => modified,
            });

            await tests.runTestsAt(native('/repo/X3/MathTests.cs'), false);

            expect(built).toContain(projectPath);
            expect(ran()).toEqual(all);
        });

        it('says so when there are no tests', async () => {
            await explorer().runTestsAt(native('/repo/X3/Helpers'), false);
            expect(mock.runs).toEqual([]);
            expect(mock.messages).toEqual(['No tests found in Helpers.']);
        });
    });

    describe('classic VSTest projects (xUnit v2, NUnit and MSTest with their VSTest adapters)', () => {
        const xunit2 = '/repo/tests/Shop.Core.XUnit2Tests/Shop.Core.XUnit2Tests.csproj';
        const nunit = '/repo/tests/Shop.Core.NUnitTests/Shop.Core.NUnitTests.csproj';
        const vstestExplorer = (session: string, overrides: Record<string, unknown> = {}) => explorer({
            projects: () => [xunit2, nunit],
            readProject: () => '<Project><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" /></ItemGroup></Project>',
            evaluate: async (p: string) => ({
                projectPath: p,
                targetPath: p.replace(/[^/]+\.csproj$/, `bin/Debug/net10.0/${path.basename(p, '.csproj')}.dll`),
                testingPlatform: false,
                vstestConsolePath: '/sdk/vstest.console.dll',
            }),
            startVsTest: async (project: any, port: number) => replayVsTest(project.projectPath === nunit ? session.replace('XUnit2', 'NUnit') : session)(port),
            ...overrides,
        });
        const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => { } }) };

        it('shows their tests like the Microsoft.Testing.Platform ones', async () => {
            await vstestExplorer('XUnit2Tests-discover').refresh(false);

            expect(outline(mock.controller.items)).toEqual([
                'Shop.Core.XUnit2Tests',
                '  Shop.Core.XUnit2Tests.Pricing',
                '    BulkDiscountTests :10',
                '      NoDiscountBelowTen :10',
                '      FailsOnPurpose :16',
                '      TenPercentFromTen :24',
                '        quantity: 10, expected: 10 :24',
                '        quantity: 20, expected: 20 :24',
                'Shop.Core.NUnitTests',
                '  Shop.Core.NUnitTests.Orders',
                '    OrderTests :10',
                '      CountsQuantities :25',
                '        1 :25',
                '        3 :25',
                '      FailsOnPurpose :18',
                '      SumsTheLines :10',
            ]);
        });

        it('runs them and reports the results', async () => {
            const tests = vstestExplorer('XUnit2Tests-discover');
            await tests.refresh(false);
            (tests as any).deps.startVsTest = async (_project: any, port: number) => replayVsTest('XUnit2Tests-run')(port);
            const [run] = mock.controller.profiles;

            await run.handler({ include: [mock.controller.items.get(xunit2)], exclude: [] }, token);

            const [testRun] = mock.runs;
            expect(testRun.events).toEqual(expect.arrayContaining(['passed NoDiscountBelowTen', 'failed FailsOnPurpose', 'passed quantity: 10, expected: 10', 'passed quantity: 20, expected: 20']));
            expect(testRun.messages.get('FailsOnPurpose').message).toMatch(/^Assert.Equal\(\) Failure[\s\S]*BulkDiscountTests.cs:line 17/);
            expect(testRun.messages.get('FailsOnPurpose').location.range.startLine).toBe(15);
        });

        it('runs the selected tests only, passing VSTest their test cases', async () => {
            const tests = vstestExplorer('NUnitTests-discover');
            await tests.refresh(false);
            const sent: any[] = [];
            (tests as any).deps.startVsTest = async (_project: any, port: number) => replayVsTest('NUnitTests-run', sent)(port);
            const orderTests = mock.controller.items.get(nunit).children.get('namespace:Shop.Core.NUnitTests.Orders').children.get('class:Shop.Core.NUnitTests.Orders.OrderTests');
            const [run] = mock.controller.profiles;

            await run.handler({ include: [orderTests.children.get('6c9c8c82-38ae-7f87-8c24-0a264044ae98')], exclude: [] }, token);

            const request = sent.find(m => m.MessageType === 'TestExecution.RunAllWithDefaultHost');
            expect(request.Payload.TestCases.map((test: any) => test.DisplayName)).toEqual(['FailsOnPurpose']);
        });

        it('debugs them by attaching the debugger to the test host VSTest starts', async () => {
            const attached: [string, number][] = [];
            const tests = vstestExplorer('NUnitTests-discover', {
                attachDebugger: async (project: any, processId: number) => { attached.push([project.projectPath, processId]); return true; },
            });
            await tests.refresh(false);
            (tests as any).deps.startVsTest = async (_project: any, port: number) => replayVsTest('NUnitTests-debug')(port);
            const [, debug] = mock.controller.profiles;

            await debug.handler({ include: [mock.controller.items.get(nunit)], exclude: [] }, token);

            expect(attached).toEqual([[nunit, expect.any(Number)]]);
            expect(mock.runs[0].events).toEqual(expect.arrayContaining(['failed FailsOnPurpose', 'passed SumsTheLines']));
        });

        describe('run settings', () => {
            const team = '<RunSettings><RunConfiguration><MaxCpuCount>0</MaxCpuCount></RunConfiguration><DataCollectionRunSettings><DataCollectors /></DataCollectionRunSettings></RunSettings>';
            const evaluate = (settingsOf: (p: string) => string | undefined) => async (p: string) => ({
                projectPath: p,
                targetPath: p.replace(/[^/]+\.csproj$/, `bin/Debug/net10.0/${path.basename(p, '.csproj')}.dll`),
                testingPlatform: false,
                vstestConsolePath: '/sdk/vstest.console.dll',
                ...(settingsOf(p) ? { runSettingsPath: settingsOf(p) } : {}),
            });

            it('discovers with the project\'s run settings, and runs projects sharing them in one vstest.console session', async () => {
                const discoverySent: any[] = [];
                const tests = vstestExplorer('XUnit2Tests-discover', {
                    evaluate: evaluate(() => '/repo/team.runsettings'),
                    readRunSettings: () => team,
                    startVsTest: async (project: any, port: number) => replayVsTest(project.projectPath === nunit ? 'NUnitTests-discover' : 'XUnit2Tests-discover', discoverySent)(port),
                });
                await tests.refresh(false);
                const discovery = discoverySent.filter(m => m.MessageType === 'TestDiscovery.Start');
                expect(discovery).toHaveLength(2);
                expect(discovery[0].Payload.RunSettings).toBe('<RunSettings><RunConfiguration><DesignMode>true</DesignMode><MaxCpuCount>0</MaxCpuCount></RunConfiguration></RunSettings>');

                const sent: any[] = [];
                let sessions = 0;
                (tests as any).deps.startVsTest = async (_project: any, port: number) => { sessions++; return replayVsTest('XUnit2Tests-run', sent)(port); };
                const [run] = mock.controller.profiles;
                await run.handler({ include: undefined, exclude: [] }, token);

                expect(sessions).toBe(1);
                const request = sent.find(m => m.MessageType === 'TestExecution.RunAllWithDefaultHost');
                expect(request.Payload.Sources).toEqual([
                    '/repo/tests/Shop.Core.XUnit2Tests/bin/Debug/net10.0/Shop.Core.XUnit2Tests.dll',
                    '/repo/tests/Shop.Core.NUnitTests/bin/Debug/net10.0/Shop.Core.NUnitTests.dll',
                ]);
                expect(request.Payload.RunSettings).toContain('<MaxCpuCount>0</MaxCpuCount>');
                expect(request.Payload.RunSettings).not.toContain('DataCollectionRunSettings');
                expect(mock.runs[0].events).toEqual(expect.arrayContaining(['passed NoDiscountBelowTen', 'failed FailsOnPurpose']));
            });

            it('one project runs selected tests: the whole group goes as test cases', async () => {
                const tests = vstestExplorer('XUnit2Tests-discover', { evaluate: evaluate(() => '/repo/team.runsettings'), readRunSettings: () => team });
                await tests.refresh(false);
                const sent: any[] = [];
                (tests as any).deps.startVsTest = async (_project: any, port: number) => replayVsTest('NUnitTests-run', sent)(port);
                const orderTests = mock.controller.items.get(nunit).children.get('namespace:Shop.Core.NUnitTests.Orders').children.get('class:Shop.Core.NUnitTests.Orders.OrderTests');
                const [run] = mock.controller.profiles;

                await run.handler({ include: [mock.controller.items.get(xunit2), orderTests.children.get('6c9c8c82-38ae-7f87-8c24-0a264044ae98')], exclude: [] }, token);

                const request = sent.find(m => m.MessageType === 'TestExecution.RunAllWithDefaultHost');
                expect(request.Payload.Sources).toBeUndefined();
                // all four xUnit cases, and the one NUnit test
                expect(request.Payload.TestCases.map((test: any) => test.Source.replace(/^.*\//, ''))).toEqual([
                    'Shop.Core.XUnit2Tests.dll', 'Shop.Core.XUnit2Tests.dll', 'Shop.Core.XUnit2Tests.dll', 'Shop.Core.XUnit2Tests.dll', 'Shop.Core.NUnitTests.dll',
                ]);
                expect(request.Payload.TestCases[4].DisplayName).toBe('FailsOnPurpose');
            });

            it('projects with different run settings get their own sessions; an unreadable file runs with the default settings', async () => {
                const tests = vstestExplorer('XUnit2Tests-discover', {
                    evaluate: evaluate(p => p === nunit ? '/repo/missing.runsettings' : undefined),
                    readRunSettings: () => undefined,
                });
                await tests.refresh(false);
                const sent: any[] = [];
                let sessions = 0;
                (tests as any).deps.startVsTest = async (project: any, port: number) => { sessions++; return replayVsTest(project.projectPath === nunit ? 'NUnitTests-run' : 'XUnit2Tests-run', sent)(port); };
                const [run] = mock.controller.profiles;
                await run.handler({ include: undefined, exclude: [] }, token);

                expect(sessions).toBe(2);
                expect(sent.filter(m => m.MessageType === 'TestExecution.RunAllWithDefaultHost').map(m => m.Payload.RunSettings))
                    .toEqual([DEFAULT_RUN_SETTINGS, DEFAULT_RUN_SETTINGS]);
            });
            it('projects run through Mono (.NET Framework outside Windows) get their own session, apart from the others', async () => {
                const fx = '/repo/tests/Fx/Fx.csproj';
                const tests = vstestExplorer('XUnit2Tests-discover', {
                    projects: () => [xunit2, nunit, fx],
                    evaluate: async (p: string) => ({
                        ...(await evaluate(() => '/repo/team.runsettings')(p)),
                        ...(p === fx ? { targetPath: '/repo/tests/Fx/bin/Debug/net472/Fx.dll', netFramework: true } : {}),
                    }),
                    platform: () => 'linux',
                    readRunSettings: () => team,
                    startVsTest: async (project: any, port: number) => replayVsTest(project.projectPath === nunit ? 'NUnitTests-discover' : 'XUnit2Tests-discover')(port),
                });
                await tests.refresh(false);
                const sent: any[] = [];
                const started: string[] = [];
                (tests as any).deps.startVsTest = async (project: any, port: number) => { started.push(project.projectPath); return replayVsTest('XUnit2Tests-run', sent)(port); };
                const [run] = mock.controller.profiles;
                await run.handler({ include: undefined, exclude: [] }, token);

                expect(started).toEqual([xunit2, fx]);
                expect(sent.filter(m => m.MessageType === 'TestExecution.RunAllWithDefaultHost').map(m => m.Payload.Sources)).toEqual([
                    ['/repo/tests/Shop.Core.XUnit2Tests/bin/Debug/net10.0/Shop.Core.XUnit2Tests.dll', '/repo/tests/Shop.Core.NUnitTests/bin/Debug/net10.0/Shop.Core.NUnitTests.dll'],
                    ['/repo/tests/Fx/bin/Debug/net472/Fx.dll'],
                ]);
            });

            it('debugging leaves out only the Mono group, the others are debugged', async () => {
                const fx = '/repo/tests/Fx/Fx.csproj';
                const tests = vstestExplorer('NUnitTests-discover', {
                    projects: () => [nunit, fx],
                    evaluate: async (p: string) => ({
                        ...(await evaluate(() => undefined)(p)),
                        ...(p === fx ? { netFramework: true } : {}),
                    }),
                    platform: () => 'linux',
                    startVsTest: async (_project: any, port: number) => replayVsTest('NUnitTests-discover')(port),
                    attachDebugger: async () => true,
                });
                await tests.refresh(false);
                const started: string[] = [];
                (tests as any).deps.startVsTest = async (project: any, port: number) => { started.push(project.projectPath); return replayVsTest('NUnitTests-debug')(port); };
                const [, debug] = mock.controller.profiles;
                await debug.handler({ include: undefined, exclude: [] }, token);

                expect(started).toEqual([nunit]);
                expect(mock.runs[0].output.join('')).toContain(MONO_DEBUG_UNSUPPORTED);
            });
        });

        describe('on .NET Framework (net472)', () => {
            const netFramework = (overrides: Record<string, unknown> = {}) => vstestExplorer('NUnitTests-discover', {
                projects: () => [nunit],
                evaluate: async (p: string) => ({ projectPath: p, targetPath: '/repo/N/bin/Debug/net472/N.dll', testingPlatform: false, vstestConsolePath: '/sdk/vstest.console.dll', netFramework: true }),
                platform: () => 'linux',
                ...overrides,
            });
            const cannotRun = '.NET Framework test projects need Mono outside Windows, and `mono` is not on the PATH';

            it('says why the tests cannot be discovered when they cannot run here', async () => {
                await netFramework({ startVsTest: async () => { throw new Error(cannotRun); } }).refresh(false);
                expect(mock.controller.items.get(nunit).error).toBe(`Discovering tests failed: ${cannotRun}`);
            });

            it('says why in the run output and on the project when the tests cannot run here', async () => {
                const tests = netFramework({ startVsTest: async () => { throw new Error(cannotRun); } });
                await tests.refresh(false);
                const [run] = mock.controller.profiles;

                await run.handler({ include: [mock.controller.items.get(nunit)], exclude: [] }, token);

                expect(mock.runs[0].output.join('')).toContain(cannotRun);
                expect(mock.runs[0].events).toContain('errored Shop.Core.NUnitTests');
                expect(mock.runs[0].messages.get('Shop.Core.NUnitTests').message).toBe(cannotRun);
            });

            it('says debugging them is not supported outside Windows', async () => {
                const tests = netFramework();
                await tests.refresh(false);
                const started: unknown[] = [];
                (tests as any).deps.startVsTest = async (project: unknown) => { started.push(project); throw new Error('not started'); };
                const [, debug] = mock.controller.profiles;

                await debug.handler({ include: [mock.controller.items.get(nunit)], exclude: [] }, token);

                expect(started).toEqual([]);
                expect(mock.runs[0].output.join('')).toContain(MONO_DEBUG_UNSUPPORTED);
                expect(mock.runs[0].messages.get('SumsTheLines').message).toBe(MONO_DEBUG_UNSUPPORTED);
            });

            it('debugs them on Windows like other VSTest projects', async () => {
                const attached: number[] = [];
                const tests = netFramework({ platform: () => 'win32', attachDebugger: async (_project: unknown, processId: number) => { attached.push(processId); return true; } });
                await tests.refresh(false);
                (tests as any).deps.startVsTest = async (_project: any, port: number) => replayVsTest('NUnitTests-debug')(port);
                const [, debug] = mock.controller.profiles;

                await debug.handler({ include: [mock.controller.items.get(nunit)], exclude: [] }, token);

                expect(attached).toHaveLength(1);
            });
        });
    });

    it('tests multi-targeted projects on the framework selected for the solution', async () => {
        const asked: unknown[][] = [];
        await explorer({
            selectedFramework: () => 'net472',
            evaluate: async (...args: unknown[]) => { asked.push(args); return { projectPath: args[0], targetPath: '/repo/X3/bin/Debug/net10.0/X3.dll', testingPlatform: true }; },
        }).refresh(false);
        expect(asked).toEqual([[projectPath, 'Debug', 'net472']]);
    });

    it('runs on the newly selected framework after Select Framework changed', async () => {
        let selected = 'net8.0';
        const asked: unknown[] = [];
        await explorer({
            selectedFramework: () => selected,
            evaluate: async (p: string, _configuration: string, framework?: string) => {
                asked.push(framework);
                return { projectPath: p, targetPath: `/repo/X3/bin/Debug/${framework}/X3.dll`, testingPlatform: true, targetFramework: framework, frameworkReason: 'the selected framework' };
            },
        }).refresh(false);
        const before = mock.controller.items.get(projectPath);
        selected = 'net10.0';
        const [run] = mock.controller.profiles;

        await run.handler({ include: [before], exclude: [] }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => { } }) });

        expect(asked).toEqual(['net8.0', 'net10.0']);
        expect(mock.runs[0].events).toEqual(expect.arrayContaining(['passed Adds', 'failed Fails']));
    });
});
