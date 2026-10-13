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
                events, messages: new Map<string, any>(),
                enqueued: (item: any) => events.push(`enqueued ${item.label}`),
                started: (item: any) => events.push(`started ${item.label}`),
                passed: (item: any) => events.push(`passed ${item.label}`),
                skipped: (item: any) => events.push(`skipped ${item.label}`),
                failed: (item: any, message: any) => { events.push(`failed ${item.label}`); run.messages.set(item.label, message); },
                errored: (item: any, message: any) => { events.push(`errored ${item.label}`); run.messages.set(item.label, message); },
                appendOutput: () => { },
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
        Uri: { file: (p: string) => ({ fsPath: p }) },
        Range: class { constructor(public startLine: number, public startCharacter: number, public endLine: number, public endCharacter: number) { } },
        Location: class { constructor(public uri: unknown, public range: unknown) { } },
        tasks: { onDidEndTaskProcess: () => disposable },
        debug: { onDidStartDebugSession: () => disposable },
        workspace: { workspaceFolders: undefined },
        commands: { executeCommand: async () => undefined },
    };
}, { virtual: true });

import * as vscode from 'vscode';
import { TestExplorer } from '../../../../services/testing/testExplorer';
import { frame, MessageReader } from '../../../../services/testing/testingPlatformClient';

const recording = fs.readFileSync(path.join(__dirname, '../../../../__fixtures__/testing-platform/X3.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map(line => JSON.parse(line));

/** Plays the recorded xUnit v3 app: discovery updates for discoverTests, result updates for runTests */
async function replayApp(args: string[]) {
    const socket = net.connect(Number(args[args.indexOf('--client-port') + 1]), '127.0.0.1');
    const reader = new MessageReader();
    const updates = recording.filter(m => m.method === 'testing/testUpdates/tests' && m.params.changes);
    const discovered = updates.filter(m => m.params.changes[0].node['execution-state'] === 'discovered');
    socket.on('data', chunk => {
        for (const message of reader.push(chunk as Buffer) as any[]) {
            const reply = (result: unknown) => socket.write(frame({ jsonrpc: '2.0', id: message.id, result }));
            if (message.method === 'initialize') reply(recording[0].result);
            if (message.method === 'testing/discoverTests') { discovered.forEach(m => socket.write(frame(m))); reply({}); }
            if (message.method === 'testing/runTests') { updates.filter(m => !discovered.includes(m)).forEach(m => socket.write(frame(m))); reply({ attachments: [] }); }
            if (message.method === 'exit') socket.end();
        }
    });
    return { kill: () => socket.destroy(), output: () => '' };
}

const mock = vscode as any;
const projectPath = '/repo/X3/X3.csproj';

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
});
