import { parseLsof, parseNetstat, parseSs } from '../../../../../services/debug/attach/listeningPorts';

describe('parseSs', () => {
    it('maps pids to their listening ports (IPv4, IPv6, wildcard), ignoring sockets without a process', () => {
        const output = [
            'LISTEN 0      80           0.0.0.0:3306  0.0.0.0:*',
            'LISTEN 0      4096       127.0.0.1:631   0.0.0.0:*',
            'LISTEN 0      512        127.0.0.1:5199  0.0.0.0:* users:(("dotnet",pid=174863,fd=176))',
            'LISTEN 0      512            [::1]:5199     [::]:* users:(("dotnet",pid=174863,fd=177))',
            'LISTEN 0      512            [::1]:7237     [::]:* users:(("dotnet",pid=174863,fd=178))',
            'LISTEN 0      4096               *:8080        *:* users:(("nginx",pid=10,fd=6),("nginx",pid=11,fd=6))',
            'LISTEN 0      4096       0.0.0.0:51413 0.0.0.0:* users:(("transmission-qt",pid=143028,fd=23))',
        ].join('\n');

        const ports = parseSs(output);
        expect(ports.get(174863)).toEqual([5199, 7237]);
        expect(ports.get(10)).toEqual([8080]);
        expect(ports.get(11)).toEqual([8080]);
        expect(ports.get(143028)).toEqual([51413]);
        expect(ports.size).toBe(4);
    });
});

describe('parseLsof', () => {
    it('reads the field output: p starts a process, n is a socket', () => {
        const output = ['p1234', 'n*:5181', 'n[::1]:5181', 'n127.0.0.1:7237', 'p99', 'n[fe80::1]:631', ''].join('\n');
        const ports = parseLsof(output);
        expect(ports.get(1234)).toEqual([5181, 7237]);
        expect(ports.get(99)).toEqual([631]);
    });
});

describe('parseNetstat', () => {
    it('takes the listening rows (foreign port 0) and the pid in the last column', () => {
        const output = [
            '',
            'Active Connections',
            '',
            '  Proto  Local Address          Foreign Address        State           PID',
            '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1048',
            '  TCP    127.0.0.1:5181         0.0.0.0:0              LISTENING       4321',
            '  TCP    [::]:5181              [::]:0                 LISTENING       4321',
            '  TCP    192.168.1.5:50321      52.1.2.3:443           ESTABLISHED     8888',
            '  TCP    0.0.0.0:7237           0.0.0.0:0              ABHÖREN         4321',
        ].join('\r\n');

        const ports = parseNetstat(output);
        expect(ports.get(4321)).toEqual([5181, 7237]);
        expect(ports.get(1048)).toEqual([135]);
        expect(ports.has(8888)).toBe(false);
    });
});
