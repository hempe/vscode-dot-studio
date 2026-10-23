const mockHttpsGet = jest.fn();
jest.mock('https', () => ({ ...jest.requireActual('https'), get: (...args: unknown[]) => mockHttpsGet(...args) }));

import { EventEmitter } from 'events';
import * as http from 'http';
import { PassThrough } from 'stream';
import { AddressInfo } from 'net';
import { download, DownloadCancelled, redactUrl } from '../../../../services/grpc/download';

describe('download', () => {
    let server: http.Server;
    let base: string;

    beforeAll(async () => {
        server = http.createServer((request, response) => {
            if (request.url === '/moved') {
                response.writeHead(302, { Location: '/protos/greet.proto' }).end();
            } else if (request.url === '/protos/greet.proto') {
                response.writeHead(200, { 'Content-Type': 'text/plain' }).end('syntax = "proto3";\n');
            } else if (request.url === '/loop') {
                response.writeHead(301, { Location: '/loop' }).end();
            } else if (request.url === '/slow') {
                // never answers
            } else if (request.url === '/trickle') {
                // one byte a little faster than the timeout, for longer than the timeout
                response.writeHead(200);
                const timer = setInterval(() => response.write('/'), 50);
                response.on('close', () => clearInterval(timer));
            } else if (request.url === '/huge') {
                response.writeHead(200);
                const chunk = Buffer.alloc(1 << 16, 0x41);
                const timer = setInterval(() => response.write(chunk), 1);
                response.on('close', () => clearInterval(timer));
            } else if (request.url === '/huge-declared') {
                response.writeHead(200, { 'Content-Length': String(10 * 1024 * 1024) }).write('x');
            } else if (request.url === '/html') {
                response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!DOCTYPE html><html><body>Sign in</body></html>');
            } else {
                response.writeHead(404, 'Not Found').end();
            }
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));

    test('gets the file, also after a redirect', async () => {
        expect((await download(`${base}/protos/greet.proto`)).toString()).toBe('syntax = "proto3";\n');
        expect((await download(`${base}/moved`)).toString()).toBe('syntax = "proto3";\n');
    });

    test('rejects other statuses, endless redirects and a server that does not answer', async () => {
        await expect(download(`${base}/missing.proto`)).rejects.toThrow(`${base}/missing.proto answered 404 Not Found`);
        await expect(download(`${base}/loop`)).rejects.toThrow('Too many redirects');
        await expect(download(`${base}/slow`, { timeoutMs: 200 })).rejects.toThrow('did not answer within 0.2 s');
    });

    test('the timeout is a deadline for the whole download: a server sending a byte now and then times out', async () => {
        const start = Date.now();
        await expect(download(`${base}/trickle`, { timeoutMs: 300 })).rejects.toThrow('did not answer within 0.3 s');
        expect(Date.now() - start).toBeLessThan(2000);
    });

    test('a file larger than the limit is refused and the request aborted', async () => {
        await expect(download(`${base}/huge`, { maxBytes: 1024 * 1024 })).rejects.toThrow('is larger than 1 MB');
        await expect(download(`${base}/huge-declared`)).rejects.toThrow('is larger than 5 MB');
    });

    test('a web page (text/html) is refused', async () => {
        await expect(download(`${base}/html`)).rejects.toThrow('answered with a web page (text/html), not a .proto file');
    });

    test('cancelled from the progress notification: rejects with DownloadCancelled', async () => {
        const listeners: (() => void)[] = [];
        const token = { isCancellationRequested: false, onCancellationRequested: (listener: () => void) => { listeners.push(listener); return { dispose: () => undefined }; } };
        const pending = download(`${base}/slow`, { token });
        setTimeout(() => { token.isCancellationRequested = true; listeners.forEach(listener => listener()); }, 50);
        await expect(pending).rejects.toBeInstanceOf(DownloadCancelled);
    });

    test('a redirect from https to http is refused', async () => {
        // https://example.com answers with a redirect to plain http
        mockHttpsGet.mockImplementation((_url: string, _options: unknown, callback: (response: http.IncomingMessage) => void) => {
            const response = Object.assign(new PassThrough(), { statusCode: 302, headers: { location: `${base}/protos/greet.proto` } });
            setTimeout(() => callback(response as unknown as http.IncomingMessage), 0);
            return Object.assign(new EventEmitter(), { destroy: () => undefined });
        });
        await expect(download('https://example.com/greet.proto')).rejects.toThrow('redirected from https to http');
    });

    test('errors do not show credentials', async () => {
        const url = `http://user:s3cret@127.0.0.1:${new URL(base).port}/missing.proto?token=TOPSECRET`;
        const error = await download(url).catch((caught: Error) => caught);
        expect(String(error)).not.toMatch(/s3cret|TOPSECRET/);
    });
});

describe('redactUrl', () => {
    test('hides the user info and the query', () => {
        expect(redactUrl('https://user:pw@example.com/a/b.proto?token=SECRET&x=1')).toBe('https://***@example.com/a/b.proto?***');
        expect(redactUrl('https://example.com/a/b.proto')).toBe('https://example.com/a/b.proto');
        expect(redactUrl('https://example.com/a%2Bb.proto')).toBe('https://example.com/a%2Bb.proto');
        expect(redactUrl('not a url ?secret')).toBe('not a url ?***');
    });
});
