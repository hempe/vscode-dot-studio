import * as net from 'net';
import * as crypto from 'crypto';

/** A test node as Microsoft.Testing.Platform reports it in `testing/testUpdates/tests` */
export interface TestNode {
    readonly uid: string;
    readonly 'display-name': string;
    readonly 'node-type'?: string;
    readonly 'execution-state'?: string;
    readonly 'location.file'?: string;
    readonly 'location.line-start'?: number;
    readonly 'location.type'?: string;
    readonly 'location.method'?: string;
    readonly 'time.duration-ms'?: number;
    readonly 'error.message'?: string;
    readonly 'error.stacktrace'?: string;
    readonly 'assert.expected'?: string;
    readonly 'assert.actual'?: string;
    readonly standardOutput?: string;
    readonly standardError?: string;
}

/** Splits a byte stream into JSON-RPC messages framed by `Content-Length` headers (as LSP does) */
export class MessageReader {
    private buffer = Buffer.alloc(0);

    push(chunk: Buffer): object[] {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        const messages: object[] = [];
        for (;;) {
            const headerEnd = this.buffer.indexOf('\r\n\r\n');
            if (headerEnd < 0) {
                break;
            }
            const length = Number(/Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0, headerEnd).toString('ascii'))?.[1]);
            const start = headerEnd + 4;
            if (!Number.isFinite(length) || this.buffer.length < start + length) {
                break;
            }
            messages.push(JSON.parse(this.buffer.subarray(start, start + length).toString('utf8')));
            this.buffer = this.buffer.subarray(start + length);
        }
        return messages;
    }
}

export function frame(message: object): Buffer {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

/** A started test app: kill it, or read what it wrote to stdout/stderr */
export interface TestApp {
    kill(): void;
    output(): string;
    /** Calls the listener when the process ends (a debugger session does not tell) */
    onExit?(listener: (code: number | null) => void): void;
}

/** How long a connection that is on its way may still arrive after the process ended */
export const EXIT_GRACE_MS = 500;

/** A connected test app in server mode */
export interface TestSession {
    discover(): Promise<void>;
    /** Runs the given tests, or all of them */
    run(tests?: { uid: string; 'display-name': string }[]): Promise<void>;
    onUpdate(listener: (nodes: TestNode[]) => void): void;
    onLog(listener: (level: string, message: string) => void): void;
    /** Ends the session: `exit`, then the process is killed if it doesn't end on its own */
    close(): Promise<void>;
}

/**
 * Listens on a local port, starts the test app with the server arguments (`--server --client-host ... --client-port ...`)
 * and resolves once it has connected and answered `initialize`.
 */
export function connectTestApp(start: (args: string[]) => Promise<TestApp>, timeoutMs = 30000): Promise<TestSession> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        let app: TestApp | undefined;
        let connected = false;
        const timer = setTimeout(() => {
            server.close();
            app?.kill();
            reject(new Error(`The test app did not connect within ${Math.round(timeoutMs / 1000)} s.\n${app?.output() ?? ''}`));
        }, timeoutMs);

        server.once('connection', socket => {
            connected = true;
            clearTimeout(timer);
            server.close();
            const reader = new MessageReader();
            const pending = new Map<number, { resolve(result: unknown): void; reject(error: Error): void }>();
            const updateListeners: ((nodes: TestNode[]) => void)[] = [];
            const logListeners: ((level: string, message: string) => void)[] = [];
            let nextId = 0;

            const send = (message: object) => socket.write(frame({ jsonrpc: '2.0', ...message }));
            const request = (method: string, params: object) => new Promise<unknown>((resolveRequest, rejectRequest) => {
                const id = ++nextId;
                pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
                send({ id, method, params });
            });

            socket.on('data', chunk => {
                for (const message of reader.push(chunk as Buffer) as any[]) {
                    if (message.method === undefined && pending.has(message.id)) {
                        const { resolve: resolveRequest, reject: rejectRequest } = pending.get(message.id)!;
                        pending.delete(message.id);
                        message.error ? rejectRequest(new Error(message.error.message ?? 'Request failed')) : resolveRequest(message.result);
                    } else if (message.method === 'testing/testUpdates/tests') {
                        const nodes = (message.params?.changes ?? []).map((change: any) => change.node).filter(Boolean);
                        updateListeners.forEach(listener => listener(nodes));
                    } else if (message.method === 'client/log') {
                        logListeners.forEach(listener => listener(message.params?.level ?? 'Information', message.params?.message ?? ''));
                    }
                    // Requests from the app (id and method) need an answer; none needs more than an acknowledgement
                    if (message.method !== undefined && message.id !== undefined) {
                        send({ id: message.id, result: null });
                    }
                }
            });
            const closed = new Promise<void>(resolveClosed => socket.once('close', () => resolveClosed()));
            socket.once('close', () => pending.forEach(({ reject: rejectRequest }) => rejectRequest(new Error(`The test app disconnected.\n${app?.output() ?? ''}`))));

            const session: TestSession = {
                discover: async () => { await request('testing/discoverTests', { runId: crypto.randomUUID() }); },
                run: async tests => { await request('testing/runTests', { runId: crypto.randomUUID(), ...(tests ? { tests } : {}) }); },
                onUpdate: listener => { updateListeners.push(listener); },
                onLog: listener => { logListeners.push(listener); },
                close: async () => {
                    if (!socket.destroyed) {
                        send({ method: 'exit', params: {} });
                    }
                    await Promise.race([closed, new Promise(resolveWait => setTimeout(resolveWait, 2000))]);
                    socket.destroy();
                    app?.kill();
                },
            };

            request('initialize', {
                processId: process.pid,
                clientInfo: { name: 'shinobi-dotnet', version: '1' },
                capabilities: { testing: { debuggerProvider: false } },
            }).then(() => resolve(session), error => {
                socket.destroy();
                app?.kill();
                reject(error);
            });
        });

        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as net.AddressInfo).port;
            start(['--server', '--client-host', '127.0.0.1', '--client-port', String(port)])
                .then(started => {
                    app = started;
                    // An app that ends before it connected (a crash on start, a wrong argument) is not waited for until the timeout
                    started.onExit?.(code => setTimeout(() => {
                        if (!connected) {
                            clearTimeout(timer);
                            server.close();
                            reject(new Error(`The test app ended (exit code ${code}) before it connected.\n${started.output()}`));
                        }
                    }, EXIT_GRACE_MS));
                }, error => {
                    clearTimeout(timer);
                    server.close();
                    reject(error);
                });
        });
    });
}
