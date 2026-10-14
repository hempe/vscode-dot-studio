import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { encode, VsTestReader } from '../../../../services/testing/vstestClient';

/** A recorded vstest.console session from src/__fixtures__/vstest */
export const recording = (name: string): any[] => fs.readFileSync(path.join(__dirname, '../../../../__fixtures__/vstest', `${name}.jsonl`), 'utf8')
    .split('\n').filter(Boolean).map(line => JSON.parse(line));

/** A fake vstest.console: connects to the port and answers our requests from a recorded session */
export function replay(name: string, sent: any[] = []) {
    const messages = recording(name);
    const discovery = messages.filter(m => m.MessageType.startsWith('TestDiscovery.'));
    const execution = messages.filter(m => m.MessageType.startsWith('TestExecution.') && m.MessageType !== 'TestExecution.AttachDebugger');
    return async (port: number) => {
        const socket = net.connect(port, '127.0.0.1');
        const reader = new VsTestReader();
        socket.on('connect', () => socket.write(encode({ MessageType: 'TestSession.Connected', Payload: null })));
        socket.on('data', chunk => {
            for (const message of reader.push(chunk as Buffer) as any[]) {
                sent.push(message);
                if (message.MessageType === 'ProtocolVersion') socket.write(encode({ MessageType: 'ProtocolVersion', Payload: 7 }));
                if (message.MessageType === 'TestDiscovery.Start') discovery.forEach(m => socket.write(encode(m)));
                if (message.MessageType.startsWith('TestExecution.') && !message.MessageType.endsWith('Callback')) {
                    // Up to the attach request; the rest once the debugger is attached
                    const attachAt = execution.findIndex(m => m.MessageType.startsWith('TestExecution.EditorAttachDebugger'));
                    execution.slice(0, attachAt >= 0 ? attachAt + 1 : undefined).forEach(m => socket.write(encode(m)));
                }
                if (message.MessageType === 'TestExecution.EditorAttachDebuggerCallback') {
                    const attachAt = execution.findIndex(m => m.MessageType.startsWith('TestExecution.EditorAttachDebugger'));
                    execution.slice(attachAt + 1).forEach(m => socket.write(encode(m)));
                }
                if (message.MessageType === 'TestSession.Terminate') socket.end();
            }
        });
        return { kill: () => socket.destroy(), output: () => '' };
    };
}
