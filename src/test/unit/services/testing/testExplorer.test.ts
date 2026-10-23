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
        expect(mock.runs[0].messages.get('Adds').message).toBe('Build failed, see the Problems panel');
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
