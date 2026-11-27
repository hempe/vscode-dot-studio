import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({
    EventEmitter: class { private listeners: Array<(e: unknown) => void> = []; event = (l: (e: unknown) => void) => { this.listeners.push(l); return { dispose: () => { } }; }; fire(e: unknown) { this.listeners.forEach(l => l(e)); } dispose() { } },
    extensions: { getExtension: () => undefined },
    window: { showErrorMessage: async () => undefined },
}), { virtual: true });

import { runCommandFor } from '../../../../../services/debug/run/runWithoutDebugger';

describe('the command that starts a project without a debugger', () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-nodebug-'));
        fs.mkdirSync(path.join(dir, 'Properties'));
        fs.writeFileSync(path.join(dir, 'Properties', 'launchSettings.json'), JSON.stringify({ profiles: {
            https: { commandName: 'Project', commandLineArgs: '--seed "two words"', applicationUrl: 'https://localhost:7001;http://localhost:5001', environmentVariables: { ASPNETCORE_ENVIRONMENT: 'Development' } },
        } }));
    });

    it('runs the dll with dotnet, with the launch profile\'s arguments, URLs and environment, as the C# debugger applies them', () => {
        const run = runCommandFor({ program: path.join(dir, 'bin', 'App.dll'), cwd: dir, launchSettingsProfile: 'https', env: { EXTRA: '1' } });
        expect(run.command).toBe('dotnet');
        expect(run.args).toEqual([path.join(dir, 'bin', 'App.dll'), '--seed', 'two words']);
        expect(run.cwd).toBe(dir);
        expect(run.env).toMatchObject({ ASPNETCORE_ENVIRONMENT: 'Development', ASPNETCORE_URLS: 'https://localhost:7001;http://localhost:5001', EXTRA: '1' });
    });

    it('without a profile: the configuration\'s own arguments (an array or a string)', () => {
        expect(runCommandFor({ program: '/r/App.dll', cwd: dir, args: ['a', 'b c'] }).args).toEqual(['/r/App.dll', 'a', 'b c']);
        expect(runCommandFor({ program: '/r/App.dll', cwd: dir, args: 'a "b c"' }).args).toEqual(['/r/App.dll', 'a', 'b c']);
    });

    it('an executable (an apphost, a .NET Framework exe on Windows) is started itself', () => {
        const run = runCommandFor({ program: '/r/App.exe', cwd: dir });
        expect(run.command).toBe('/r/App.exe');
        expect(run.args).toEqual([]);
    });
});

import { EventEmitter } from 'events';
import { RunAdapter } from '../../../../../services/debug/run/runWithoutDebugger';

describe('the adapter of a run without a debugger', () => {
    const fakeProcess = () => {
        const child = Object.assign(new EventEmitter(), { pid: 4242, exitCode: null as number | null, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: jest.fn() });
        return child;
    };
    const setup = (platform: NodeJS.Platform = 'linux') => {
        const child = fakeProcess();
        const starts: Array<{ command: string; args: string[]; options: any }> = [];
        const start = ((command: string, args: string[], options: any) => { starts.push({ command, args, options }); return child; }) as any;
        const adapter = new RunAdapter({ command: 'dotnet', args: ['/r/App.dll'], cwd: '/r', env: { A: '1' } }, start, platform);
        const sent: any[] = [];
        adapter.onDidSendMessage(message => sent.push(message));
        let seq = 1;
        const request = (command: string) => adapter.handleMessage({ type: 'request', seq: seq++, command } as any);
        return { adapter, child, starts, sent, request };
    };
    const events = (sent: any[]) => sent.filter(m => m.type === 'event').map(m => m.event);

    it('starts the program on launch, with its environment, in a process group of its own', () => {
        const { starts, sent, request } = setup();
        request('initialize');
        request('launch');
        request('configurationDone');
        expect(starts[0]).toMatchObject({ command: 'dotnet', args: ['/r/App.dll'], options: { cwd: '/r', detached: true } });
        expect(starts[0].options.env.A).toBe('1');
        expect(sent.filter(m => m.type === 'response').every(m => m.success)).toBe(true);
        expect(events(sent)).toEqual(['initialized']);
    });

    it('shows the output in the Debug Console and ends the session when the program exits', () => {
        const { child, sent, request } = setup();
        request('initialize');
        request('launch');
        child.stdout.emit('data', 'Now listening on: http://localhost:5001\n');
        child.stderr.emit('data', 'warn\n');
        child.emit('exit', 3);
        expect(sent.filter(m => m.event === 'output').map(m => [m.body.category, m.body.output])).toEqual([['stdout', 'Now listening on: http://localhost:5001\n'], ['stderr', 'warn\n']]);
        expect(sent.find(m => m.event === 'exited').body).toEqual({ exitCode: 3 });
        expect(events(sent).filter(e => e === 'terminated')).toHaveLength(1);
    });

    it('Stop ends the process group (Linux, macOS) or the process tree (Windows)', () => {
        const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
        const linux = setup('linux');
        linux.request('launch');
        linux.request('disconnect');
        expect(kill).toHaveBeenCalledWith(-4242, 'SIGTERM');
        expect(events(linux.sent)).toContain('terminated');
        kill.mockRestore();

        const windows = setup('win32');
        windows.request('launch');
        windows.request('terminate');
        expect(windows.starts[1]).toMatchObject({ command: 'taskkill', args: ['/pid', '4242', '/T', '/F'] });
    });
});
