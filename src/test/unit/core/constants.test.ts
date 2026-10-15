import { isSystemPath } from '../../../core/constants';

describe('isSystemPath', () => {
    it('keeps the extension out of virtual and operating system folders', () => {
        for (const path of ['/proc/1/status', '/sys/kernel', '/dev/null', '/usr/lib/x.csproj', '/etc/passwd', '/boot/a']) {
            expect(isSystemPath(path)).toBe(true);
        }
    });

    it('allows the places people keep code: /tmp, /var/www, /opt, /root (dev containers), /home, /workspaces', () => {
        for (const path of ['/tmp/repo/App.sln', '/var/www/site/Web.csproj', '/opt/app/App.slnx', '/root/src/App.sln', '/home/me/App.sln', '/workspaces/app/App.sln']) {
            expect(isSystemPath(path)).toBe(false);
        }
    });

    it('keeps out of Windows and macOS system folders, on any drive and in any case', () => {
        for (const path of ['C:\\Windows\\System32\\x.dll', 'c:/windows/x', 'D:\\Program Files\\dotnet\\sdk', 'C:\\Program Files (x86)\\x',
            'C:\\ProgramData\\Microsoft', 'E:\\$Recycle.Bin\\x', 'C:\\System Volume Information', '/System/Library/x', '/Library/Frameworks/x']) {
            expect(isSystemPath(path)).toBe(true);
        }
    });

    it('allows the places people keep code on Windows', () => {
        for (const path of ['C:\\Users\\me\\source\\repos\\App\\App.sln', 'D:\\Projects\\App.slnx', 'C:\\dev\\Windows.Forms.Demo\\App.sln', 'C:\\src\\Program Files Tool\\App.sln']) {
            expect(isSystemPath(path)).toBe(false);
        }
    });
});

