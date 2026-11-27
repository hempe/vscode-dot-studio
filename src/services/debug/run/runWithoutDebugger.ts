import * as vscode from 'vscode';
import { ChildProcess, spawn } from 'child_process';
import { splitArguments } from '../monoDebug';
import { readLaunchProfiles } from '../launch/launchProfiles';
import { CSHARP_EXTENSIONS } from '../../shared/csharpExtensionCheck';

/**
 * "Start without debugging" for the Open VSX C# extension: its debugger (netcoredbg) ignores `noDebug` and starts the program under
 * the debugger anyway (probed 2026-11-27 with muhammad-sammy.csharp 2.160.9: `Debugger.IsAttached` true; Microsoft's honours it).
 * Such launches become the debug type `dotnet-run`: a small adapter in the extension starts the program without a debugger,
 * shows its output in the Debug Console and ends it (with its child processes) on Stop, so it still sits in the startup compound.
 */
export const RUN_DEBUG_TYPE = 'dotnet-run';

/** The parts of a `coreclr` launch configuration the run needs */
export interface RunConfiguration {
    readonly program?: string;
    readonly args?: string[] | string;
    readonly cwd?: string;
    readonly env?: Record<string, string>;
    readonly launchSettingsProfile?: string;
}

export interface RunCommand {
    readonly command: string;
    readonly args: string[];
    readonly cwd: string | undefined;
    readonly env: Record<string, string>;
}

/**
 * What the C# debugger would start: `dotnet <dll>` (an executable itself) with the launch profile's `commandLineArgs`,
 * `environmentVariables` and `applicationUrl` (as ASPNETCORE_URLS) from the project folder's launchSettings.json, then the
 * configuration's own `args` and `env`
 */
export function runCommandFor(config: RunConfiguration): RunCommand {
    const program = config.program ?? '';
    const profile = config.launchSettingsProfile && config.cwd
        ? readLaunchProfiles(config.cwd).find(candidate => candidate.name === config.launchSettingsProfile)
        : undefined;
    const ownArgs = Array.isArray(config.args) ? config.args : splitArguments(config.args);
    const args = ownArgs.length > 0 ? ownArgs : splitArguments(profile?.commandLineArgs);
    const env: Record<string, string> = {
        ...(profile?.applicationUrl ? { ASPNETCORE_URLS: profile.applicationUrl } : {}),
        ...profile?.environmentVariables,
        ...config.env,
    };
    return /\.dll$/i.test(program)
        ? { command: 'dotnet', args: [program, ...args], cwd: config.cwd, env }
        : { command: program, args, cwd: config.cwd, env };
}

/** Whether the debugger of `coreclr` is netcoredbg: the Open VSX C# extension without Microsoft's */
export function debuggerIgnoresNoDebug(): boolean {
    return !vscode.extensions.getExtension(CSHARP_EXTENSIONS.microsoft) && !!vscode.extensions.getExtension(CSHARP_EXTENSIONS.openSource);
}

/** Turns a `noDebug` launch into a run without a debugger where the debugger would attach anyway */
export class RunWithoutDebuggerProvider implements vscode.DebugConfigurationProvider {
    resolveDebugConfigurationWithSubstitutedVariables(_folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): vscode.DebugConfiguration {
        return config.noDebug && config.request === 'launch' && debuggerIgnoresNoDebug() ? { ...config, type: RUN_DEBUG_TYPE } : config;
    }
}

export class RunAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
    createDebugAdapterDescriptor(session: vscode.DebugSession): vscode.DebugAdapterDescriptor {
        return new vscode.DebugAdapterInlineImplementation(new RunAdapter(runCommandFor(session.configuration as RunConfiguration)));
    }
}

type Message = { type: string; seq?: number; command?: string; arguments?: unknown };

/** The Debug Adapter Protocol, as much as a program without a debugger needs: start, output, exit, stop */
export class RunAdapter implements vscode.DebugAdapter {
    private readonly sent = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
    readonly onDidSendMessage = this.sent.event;
    private seq = 1;
    private child: ChildProcess | undefined;
    private ended = false;

    constructor(private readonly run: RunCommand, private readonly start: typeof spawn = spawn, private readonly platform: NodeJS.Platform = process.platform) { }

    handleMessage(message: vscode.DebugProtocolMessage): void {
        const request = message as Message;
        if (request.type !== 'request') {
            return;
        }
        switch (request.command) {
            case 'initialize':
                this.respond(request, { supportsTerminateRequest: true, supportsConfigurationDoneRequest: true });
                this.event('initialized');
                return;
            case 'launch':
                this.launch(request);
                return;
            case 'threads':
                this.respond(request, { threads: [] });
                return;
            case 'disconnect':
            case 'terminate':
                this.stop();
                this.respond(request);
                this.end();
                return;
            default:
                this.respond(request); // breakpoints, configurationDone: nothing to do without a debugger
        }
    }

    private launch(request: Message): void {
        try {
            this.child = this.start(this.run.command, this.run.args, {
                cwd: this.run.cwd,
                env: { ...process.env, ...this.run.env },
                // its own process group, so Stop ends what it started (dotnet run, an apphost) too
                detached: this.platform !== 'win32',
            });
        } catch (error) {
            this.respond(request, undefined, `Could not start ${this.run.command}: ${error instanceof Error ? error.message : error}`);
            return;
        }
        this.child.stdout?.on('data', data => this.output('stdout', String(data)));
        this.child.stderr?.on('data', data => this.output('stderr', String(data)));
        this.child.on('error', error => { this.output('stderr', `${error.message}\n`); this.end(); });
        this.child.on('exit', code => { this.event('exited', { exitCode: code ?? 0 }); this.end(); });
        this.respond(request);
    }

    private stop(): void {
        const child = this.child;
        if (!child?.pid || child.exitCode !== null) {
            return;
        }
        if (this.platform === 'win32') {
            this.start('taskkill', ['/pid', String(child.pid), '/T', '/F']);
        } else {
            try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
        }
    }

    private end(): void {
        if (!this.ended) {
            this.ended = true;
            this.event('terminated');
        }
    }

    private output(category: 'stdout' | 'stderr', output: string): void {
        this.event('output', { category, output });
    }

    private event(event: string, body?: unknown): void {
        this.sent.fire({ type: 'event', seq: this.seq++, event, ...(body !== undefined && { body }) } as vscode.DebugProtocolMessage);
    }

    private respond(request: Message, body?: unknown, error?: string): void {
        this.sent.fire({
            type: 'response', seq: this.seq++, request_seq: request.seq, command: request.command, success: !error,
            ...(error ? { message: error } : {}), ...(body !== undefined && { body }),
        } as vscode.DebugProtocolMessage);
    }

    dispose(): void {
        this.stop();
        this.sent.dispose();
    }
}
