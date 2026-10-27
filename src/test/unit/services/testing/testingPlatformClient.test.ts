import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { connectTestApp, frame, MessageReader, TestNode } from '../../../../services/testing/testingPlatformClient';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '../../../../__fixtures__/testing-platform', name), 'utf8')
    .split('\n').filter(Boolean).map(line => JSON.parse(line));

describe('MessageReader', () => {
    it('reads messages split over chunks and joined in one chunk', () => {
        const reader = new MessageReader();
        const a = frame({ jsonrpc: '2.0', id: 1, result: { ok: 'ä' } });
        const b = frame({ jsonrpc: '2.0', method: 'client/log', params: { message: 'hi' } });
        expect(reader.push(a.subarray(0, 5))).toEqual([]);
        expect(reader.push(a.subarray(5, 30))).toEqual([]);
        expect(reader.push(Buffer.concat([a.subarray(30), b]))).toEqual([
            { jsonrpc: '2.0', id: 1, result: { ok: 'ä' } },
            { jsonrpc: '2.0', method: 'client/log', params: { message: 'hi' } },
        ]);
    });
});

/** A fake test app: connects to the port it is given and answers like the recorded xUnit v3 app */
function fakeApp(messages: any[]) {
    const received: any[] = [];
    let socket: net.Socket | undefined;
    const start = async (args: string[]) => {
        const port = Number(args[args.indexOf('--client-port') + 1]);
        expect(args).toEqual(['--server', '--client-host', '127.0.0.1', '--client-port', String(port)]);
        socket = net.connect(port, '127.0.0.1');
        const reader = new MessageReader();
        const notifications = messages.filter(m => m.method);
        const discovered = notifications.filter(m => m.params?.changes?.[0]?.node['execution-state'] === 'discovered');
        const results = notifications.filter(m => m.method === 'testing/testUpdates/tests' && !discovered.includes(m));
        socket.on('data', chunk => {
            for (const message of reader.push(chunk as Buffer) as any[]) {
                received.push(message);
                const reply = (result: unknown) => socket!.write(frame({ jsonrpc: '2.0', id: message.id, result }));
                if (message.method === 'initialize') {
                    reply(messages[0].result);
                    // A request from the app: the client must answer it
                    socket!.write(frame({ jsonrpc: '2.0', id: 99, method: 'client/someRequest', params: {} }));
                } else if (message.method === 'testing/discoverTests') {
                    discovered.forEach(m => socket!.write(frame(m)));
                    reply({});
                } else if (message.method === 'testing/runTests') {
                    results.forEach(m => socket!.write(frame(m)));
                    reply({ attachments: [] });
                } else if (message.method === 'exit') {
                    socket!.end();
                }
            }
        });
        return { kill: () => socket?.destroy(), output: () => '' };
    };
    return { start, received };
}

describe('connectTestApp', () => {
    it('discovers and runs tests through the protocol', async () => {
        const app = fakeApp(fixture('X3.jsonl'));
        const session = await connectTestApp(app.start);
        const updates: TestNode[] = [];
        const logs: string[] = [];
        session.onUpdate(nodes => updates.push(...nodes));
        session.onLog((_level, message) => logs.push(message));

        await session.discover();
        expect(updates.filter(n => n['execution-state'] === 'discovered').map(n => n['display-name'])).toEqual([
            'X3.Math.MathTests.Adds', 'X3.Math.MathTests.Fails', 'X3.Math.MathTests.Positive(x: 1)', 'X3.Math.MathTests.Positive(x: 2)',
        ]);

        await session.run([{ uid: updates[0].uid, 'display-name': updates[0]['display-name'] }]);
        expect(updates.find(n => n['execution-state'] === 'failed')?.['error.message']).toMatch(/^Assert.Equal\(\) Failure/);
        await session.close();

        expect(app.received.map(m => m.method)).toEqual(['initialize', undefined, 'testing/discoverTests', 'testing/runTests', 'exit']);
        expect(app.received[1]).toEqual({ jsonrpc: '2.0', id: 99, result: null });
        expect(app.received[3].params.tests).toEqual([{ uid: updates[0].uid, 'display-name': 'X3.Math.MathTests.Adds' }]);
    });

    it('gives up when the app does not connect', async () => {
        await expect(connectTestApp(async () => ({ kill: () => { }, output: () => 'Unhandled exception: boom' }), 200))
            .rejects.toThrow(/did not connect[\s\S]*boom/);
    });

    it('gives up as soon as the app ends before it connected, not after the timeout (review A5-9)', async () => {
        const started = Date.now();
        await expect(connectTestApp(async () => ({
            kill: () => { },
            output: () => 'Unhandled exception: boom',
            onExit: listener => { setTimeout(() => listener(134), 10); },
        }), 20000)).rejects.toThrow(/ended \(exit code 134\) before it connected[\s\S]*boom/);
        expect(Date.now() - started).toBeLessThan(3000);
    });

    it('does not wait for the timeout when the app ends before it connected (review A5-9)', async () => {
        const started = Date.now();
        await expect(connectTestApp(async () => ({
            kill: () => { }, output: () => 'Unhandled exception: boom',
            onExit: listener => { setTimeout(() => listener(134), 10); },
        }), 30000)).rejects.toThrow(/ended \(exit code 134\) before it connected[\s\S]*boom/);
        expect(Date.now() - started).toBeLessThan(3000);
    });
});
