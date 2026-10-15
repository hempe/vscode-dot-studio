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
});
