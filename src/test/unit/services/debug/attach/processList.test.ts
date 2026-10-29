import { parsePsOutput, parseWindowsProcesses } from '../../../../../services/debug/attach/processList';

describe('parsePsOutput', () => {
    it('parses pid, parent and the whole command line, spaces in the arguments included', () => {
        const output = [
            '    1       0 /sbin/init splash',
            ' 1234    1000 dotnet /srv/My App/Shop.Web.dll --urls http://localhost:5181',
            '12345    1234 /usr/lib/electron42/electron --user-data-dir=/home/me/.config/Code - OSS --type=renderer',
            '',
            '  77      2 [kworker/0:1-events]',
            'garbage line',
            '  88      1 ',
        ].join('\n');

        expect(parsePsOutput(output)).toEqual([
            { pid: 1, ppid: 0, command: '/sbin/init', args: '/sbin/init splash' },
            { pid: 1234, ppid: 1000, command: 'dotnet', args: 'dotnet /srv/My App/Shop.Web.dll --urls http://localhost:5181' },
            { pid: 12345, ppid: 1234, command: '/usr/lib/electron42/electron', args: '/usr/lib/electron42/electron --user-data-dir=/home/me/.config/Code - OSS --type=renderer' },
            { pid: 77, ppid: 2, command: '[kworker/0:1-events]', args: '[kworker/0:1-events]' },
        ]);
    });

    it('handles Windows line endings and macOS padding', () => {
        const output = '  501     1 /Applications/Foo.app/Contents/MacOS/Foo -psn_0_1\r\n  502   501 /usr/local/share/dotnet/dotnet exec App.dll\r\n';
        expect(parsePsOutput(output).map(entry => entry.pid)).toEqual([501, 502]);
    });
});

describe('parseWindowsProcesses', () => {
    it('parses an array, with a null command line for system processes', () => {
        const json = JSON.stringify([
            { ProcessId: 0, ParentProcessId: 0, Name: 'System Idle Process', ExecutablePath: null, CommandLine: null },
            { ProcessId: 4321, ParentProcessId: 100, Name: 'dotnet.exe', ExecutablePath: 'C:\\Program Files\\dotnet\\dotnet.exe', CommandLine: '"C:\\Program Files\\dotnet\\dotnet.exe" exec C:\\src\\Shop.Web.dll' },
            { ProcessId: 99, ParentProcessId: 4, Name: 'Registry', ExecutablePath: null, CommandLine: null },
        ]);

        expect(parseWindowsProcesses(json)).toEqual([
            { pid: 0, ppid: 0, command: 'System Idle Process', args: 'System Idle Process' },
            { pid: 4321, ppid: 100, command: 'C:\\Program Files\\dotnet\\dotnet.exe', args: '"C:\\Program Files\\dotnet\\dotnet.exe" exec C:\\src\\Shop.Web.dll' },
            { pid: 99, ppid: 4, command: 'Registry', args: 'Registry' },
        ]);
    });

    it('parses a single object (ConvertTo-Json does not wrap one item) and a byte order mark', () => {
        const json = '\uFEFF{"ProcessId":7,"ParentProcessId":1,"Name":"App.exe","ExecutablePath":"C:\\\\App.exe","CommandLine":"C:\\\\App.exe --x"}';
        expect(parseWindowsProcesses(json)).toEqual([{ pid: 7, ppid: 1, command: 'C:\\App.exe', args: 'C:\\App.exe --x' }]);
    });

    it('returns nothing for empty or broken output', () => {
        expect(parseWindowsProcesses('')).toEqual([]);
        expect(parseWindowsProcesses('not json')).toEqual([]);
        expect(parseWindowsProcesses('null')).toEqual([]);
    });
});
