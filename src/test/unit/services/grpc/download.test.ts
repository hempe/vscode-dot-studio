import * as http from 'http';
import { AddressInfo } from 'net';
import { download } from '../../../../services/grpc/download';

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
        await expect(download(`${base}/slow`, 200)).rejects.toThrow('did not answer within 0.2 s');
    });
});
