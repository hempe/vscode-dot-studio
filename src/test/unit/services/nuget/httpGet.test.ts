import * as http from 'http';
import { AddressInfo } from 'net';
import { httpGet } from '../../../../services/nuget/httpGet';

describe('httpGet (review A4-13)', () => {
    const servers: http.Server[] = [];
    const seen: { url?: string; authorization?: string }[] = [];

    const serve = async (handler: http.RequestListener): Promise<string> => {
        const server = http.createServer(handler);
        servers.push(server);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    };
    afterEach(async () => {
        seen.length = 0;
        await Promise.all(servers.splice(0).map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
    });

    it('reads an http:// source', async () => {
        const base = await serve((_req, res) => { res.end('{"ok":true}'); });
        expect(await httpGet(`${base}/index.json`, { headers: {} })).toMatchObject({ statusCode: 200, body: '{"ok":true}' });
    });

    it('follows redirects, relative ones too, and keeps the credentials on the same host only', async () => {
        const other = await serve((req, res) => { seen.push({ url: 'other', authorization: req.headers.authorization }); res.end('elsewhere'); });
        const base = await serve((req, res) => {
            seen.push({ url: req.url, authorization: req.headers.authorization });
            if (req.url === '/a') { res.writeHead(301, { location: '/b' }); res.end(); }
            else if (req.url === '/b') { res.writeHead(302, { location: `${other}/c` }); res.end(); }
            else { res.end('b'); }
        });

        const result = await httpGet(`${base}/a`, { headers: { Authorization: 'Basic secret' } });

        expect(result.body).toBe('elsewhere');
        expect(seen).toEqual([
            { url: '/a', authorization: 'Basic secret' },
            { url: '/b', authorization: 'Basic secret' },
            { url: 'other', authorization: undefined },
        ]);
    });

    it('gives up on a redirect loop', async () => {
        const base = await serve((_req, res) => { res.writeHead(302, { location: '/again' }); res.end(); });
        await expect(httpGet(`${base}/`, { headers: {}, maxRedirects: 3 })).rejects.toThrow('Too many redirects');
    });

    it('refuses an answer bigger than the limit', async () => {
        const base = await serve((_req, res) => { res.end(Buffer.alloc(2 * 1024 * 1024, 97)); });
        await expect(httpGet(`${base}/`, { headers: {}, maxBytes: 1024 * 1024 })).rejects.toThrow('larger than');
    });

    it('stops a slow answer after the total time, however steady the trickle', async () => {
        const base = await serve((_req, res) => {
            res.write('x');
            const timer = setInterval(() => res.write('x'), 50);
            res.on('close', () => clearInterval(timer));
        });
        await expect(httpGet(`${base}/`, { headers: {}, idleTimeoutMs: 1000, totalTimeoutMs: 300 })).rejects.toThrow('timeout');
    });

    it('refuses a protocol that is not http or https', async () => {
        await expect(httpGet('ftp://example.org/x', { headers: {} })).rejects.toThrow('Unsupported protocol');
    });
});
