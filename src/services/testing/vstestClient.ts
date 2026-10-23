import * as net from 'net';
import { TestApp, TestNode } from './testingPlatformClient';
import { DEFAULT_RUN_SETTINGS } from './runSettings';

// Client for vstest.console in design mode, the protocol Visual Studio uses for classic VSTest projects
// (xUnit v2, NUnit and MSTest with their VSTest adapters): we listen on a port, start
// `vstest.console.dll --port:<port>`, and it connects back. Messages are JSON, each prefixed with its
// length as .NET's BinaryWriter writes strings (7-bit encoded).

const PROTOCOL_VERSION = 7;

/** A test case as VSTest reports it */
export interface VsTestCase {
    readonly Id: string;
    readonly FullyQualifiedName: string;
    readonly DisplayName: string;
    readonly Source: string;
    readonly CodeFilePath?: string | null;
    readonly LineNumber?: number;
    readonly Properties?: { readonly Key: { readonly Id: string }; readonly Value: unknown }[];
}

/** A test result as VSTest reports it; `Outcome` is 0 none, 1 passed, 2 failed, 3 skipped, 4 not found */
export interface VsTestResult {
    readonly TestCase: VsTestCase;
    readonly Outcome: number;
    readonly DisplayName?: string | null;
    readonly ErrorMessage?: string | null;
    readonly ErrorStackTrace?: string | null;
    /** `hh:mm:ss.fffffff` */
    readonly Duration?: string;
    readonly Messages?: { readonly Category: string; readonly Text: string }[] | null;
}

export function encode(message: object): Buffer {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    const length: number[] = [];
    let remaining = body.length;
    do {
        let byte = remaining & 0x7f;
        remaining >>>= 7;
        if (remaining) {
            byte |= 0x80;
        }
        length.push(byte);
    } while (remaining);
    return Buffer.concat([Buffer.from(length), body]);
}

/** Splits a byte stream into the length-prefixed JSON messages */
export class VsTestReader {
    private buffer = Buffer.alloc(0);

    push(chunk: Buffer): object[] {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        const messages: object[] = [];
        for (;;) {
            let length = 0;
            let shift = 0;
            let offset = 0;
            for (;;) {
                if (offset >= this.buffer.length) {
                    return messages;
                }
                const byte = this.buffer[offset++];
                length |= (byte & 0x7f) << shift;
                shift += 7;
                if (!(byte & 0x80)) {
                    break;
                }
            }
            if (this.buffer.length < offset + length) {
                return messages;
            }
            messages.push(JSON.parse(this.buffer.subarray(offset, offset + length).toString('utf8')));
            this.buffer = this.buffer.subarray(offset + length);
        }
    }
}

const property = (testCase: VsTestCase, id: string): unknown => testCase.Properties?.find(p => p.Key.Id === id)?.Value;

/**
 * A VSTest case as a Test Explorer node: type and method from the adapter (xUnit, MSTest) or from the
 * fully qualified name without arguments (NUnit, `Ns.Class.Method(1)`)
 */
export function vstestCaseNode(testCase: VsTestCase): TestNode {
    const name = testCase.FullyQualifiedName.replace(/\(.*$/, '');
    const lastDot = name.lastIndexOf('.');
    const type = property(testCase, 'TestCase.ManagedType');
    const method = property(testCase, 'TestCase.ManagedMethod');
    return {
        uid: testCase.Id,
        'display-name': testCase.DisplayName,
        'location.type': typeof type === 'string' ? type : name.slice(0, Math.max(0, lastDot)),
        'location.method': typeof method === 'string' ? method : name.slice(lastDot + 1),
        ...(testCase.CodeFilePath ? { 'location.file': testCase.CodeFilePath } : {}),
        ...(testCase.LineNumber && testCase.LineNumber > 0 ? { 'location.line-start': testCase.LineNumber } : {}),
    };
}

/** `00:00:01.2500000` → 1250 */
function milliseconds(duration: string | undefined): number | undefined {
    const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(duration ?? '');
    return match ? Math.round(((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000) : undefined;
}

const EXECUTION_STATES: Record<number, string> = { 1: 'passed', 2: 'failed', 3: 'skipped', 4: 'error' };

/** A VSTest result as a result update of its test node */
export function vstestResultNode(result: VsTestResult): TestNode {
    const output = (category: string) => result.Messages?.filter(m => m.Category === category).map(m => m.Text).join('') || undefined;
    return {
        ...vstestCaseNode(result.TestCase),
        'execution-state': EXECUTION_STATES[result.Outcome] ?? 'error',
        'time.duration-ms': milliseconds(result.Duration),
        ...(result.ErrorMessage ? { 'error.message': result.ErrorMessage } : {}),
        ...(result.ErrorStackTrace ? { 'error.stacktrace': result.ErrorStackTrace } : {}),
        ...(result.Outcome === 4 ? { 'error.message': 'Test not found' } : {}),
        ...(output('StdOutMsgs') ? { standardOutput: output('StdOutMsgs') } : {}),
        ...(output('StdErrMsgs') ? { standardError: output('StdErrMsgs') } : {}),
    };
}

/** A connected vstest.console */
export interface VsTestSession {
    /** The test cases in the test assemblies; `runSettings` from `vstestRunSettings`, else the default */
    discover(sources: string[], runSettings?: string): Promise<VsTestCase[]>;
    /**
     * Runs all tests of the sources, or the given test cases; results arrive in batches. With `attach`,
     * VSTest starts the test host paused and the tests run once `attach` (the debugger) resolves true.
     */
    run(
        request: { readonly sources?: string[]; readonly testCases?: VsTestCase[]; readonly runSettings?: string },
        onResults: (results: VsTestResult[]) => void,
        attach?: (processId: number) => Promise<boolean>
    ): Promise<void>;
    onLog(listener: (message: string) => void): void;
    /** Ends the session and vstest.console */
    close(): Promise<void>;
}

/**
 * Listens on a local port, starts vstest.console with it (`start(port)`), and resolves once it has
 * connected and agreed on the protocol version
 */
export function connectVsTest(start: (port: number) => Promise<TestApp>, timeoutMs = 30000): Promise<VsTestSession> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        let app: TestApp | undefined;
        const timer = setTimeout(() => {
            server.close();
            app?.kill();
            reject(new Error(`vstest.console did not connect within ${Math.round(timeoutMs / 1000)} s.\n${app?.output() ?? ''}`));
        }, timeoutMs);

        server.once('connection', socket => {
            clearTimeout(timer);
            server.close();
            const reader = new VsTestReader();
            const send = (messageType: string, payload?: unknown) =>
                socket.write(encode({ Version: PROTOCOL_VERSION, MessageType: messageType, Payload: payload ?? null }));
            const logListeners: ((message: string) => void)[] = [];
            /** Handles the messages of the current operation (discovery or a run) */
            let handler: ((message: any) => void) | undefined;
            let failCurrent: ((error: Error) => void) | undefined;
            let connected = false;

            socket.on('data', chunk => {
                for (const message of reader.push(chunk as Buffer) as any[]) {
                    switch (message.MessageType) {
                        case 'TestSession.Connected':
                            socket.write(encode({ MessageType: 'ProtocolVersion', Payload: PROTOCOL_VERSION }));
                            break;
                        case 'ProtocolVersion':
                            if (!connected) {
                                connected = true;
                                send('Extensions.Initialize', []);
                                resolve(session);
                            }
                            break;
                        case 'TestSession.Message':
                            logListeners.forEach(listener => listener(message.Payload?.Message ?? ''));
                            break;
                        default:
                            handler?.(message);
                    }
                }
            });
            const closed = new Promise<void>(resolveClosed => socket.once('close', () => resolveClosed()));
            socket.once('close', () => failCurrent?.(new Error(`vstest.console disconnected.\n${app?.output() ?? ''}`)));

            /** Runs one operation: `onMessage` resolves it by returning a value other than undefined */
            const operation = <T>(onMessage: (message: any) => T | undefined | Promise<T | undefined>) => new Promise<T>((resolveOperation, rejectOperation) => {
                failCurrent = rejectOperation;
                handler = message => {
                    Promise.resolve(onMessage(message)).then(result => {
                        if (result !== undefined) {
                            handler = undefined;
                            failCurrent = undefined;
                            resolveOperation(result);
                        }
                    }, rejectOperation);
                };
            });

            const session: VsTestSession = {
                discover: async (sources, runSettings) => {
                    const found: VsTestCase[] = [];
                    const done = operation<VsTestCase[]>(message => {
                        if (message.MessageType === 'TestDiscovery.TestFound') {
                            found.push(...(message.Payload ?? []));
                        } else if (message.MessageType === 'TestDiscovery.Completed') {
                            found.push(...(message.Payload?.LastDiscoveredTests ?? []));
                            return found;
                        }
                        return undefined;
                    });
                    send('TestDiscovery.Start', { Sources: sources, RunSettings: runSettings ?? DEFAULT_RUN_SETTINGS });
                    return done;
                },
                run: async ({ sources, testCases, runSettings }, onResults, attach) => {
                    const done = operation<true>(async message => {
                        switch (message.MessageType) {
                            case 'TestExecution.StatsChange':
                                onResults(message.Payload?.NewTestResults ?? []);
                                return undefined;
                            case 'TestExecution.EditorAttachDebugger':
                            case 'TestExecution.EditorAttachDebugger2': {
                                const processId = message.Payload?.ProcessID ?? message.Payload;
                                const attached = attach ? await attach(processId).catch(() => false) : false;
                                send('TestExecution.EditorAttachDebuggerCallback', { Attached: attached });
                                return undefined;
                            }
                            case 'TestExecution.Completed':
                                onResults(message.Payload?.LastRunTests?.NewTestResults ?? []);
                                return true;
                            default:
                                return undefined;
                        }
                    });
                    const payload = { ...(testCases ? { TestCases: testCases } : { Sources: sources }), RunSettings: runSettings ?? DEFAULT_RUN_SETTINGS };
                    if (attach) {
                        send(testCases ? 'TestExecution.GetTestRunnerProcessStartInfoForRunSelected' : 'TestExecution.GetTestRunnerProcessStartInfoForRunAll',
                            { ...payload, DebuggingEnabled: true });
                    } else {
                        send('TestExecution.RunAllWithDefaultHost', payload);
                    }
                    await done;
                },
                onLog: listener => { logListeners.push(listener); },
                close: async () => {
                    if (!socket.destroyed) {
                        send('TestSession.Terminate');
                    }
                    await Promise.race([closed, new Promise(resolveWait => setTimeout(resolveWait, 2000))]);
                    socket.destroy();
                    app?.kill();
                },
            };
        });

        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as net.AddressInfo).port;
            start(port).then(started => { app = started; }, error => {
                clearTimeout(timer);
                server.close();
                reject(error);
            });
        });
    });
}
