jest.mock('vscode', () => ({ workspace: { workspaceFolders: [] }, window: {}, commands: {}, env: {} }), { virtual: true });
jest.mock('../../../../services/nuget/feedAuth', () => ({ reportRejectedCredentials: jest.fn(), reportRejectedInOutput: jest.fn() }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NuGetV3Service } from '../../../../services/nuget/nugetV3Service';

const service = NuGetV3Service as any;

describe('the request cache of the NuGet V3 client', () => {
    let dir: string;
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuget-cache-'));
        service.persistentCache = null;
        service.requestCache.clear();
        service.initializeCache(dir);
    });
    afterEach(() => {
        jest.restoreAllMocks();
        service.persistentCache = null;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('a background refresh replaces the entry of a private feed, which is keyed with its token', async () => {
        const http = jest.spyOn(service, '_makeHttpRequestWithETag').mockResolvedValueOnce({ body: 'old', statusCode: 200 });
        expect((await service.makeRequest('https://feed/x', 'token')).body).toBe('old');

        jest.spyOn(service, '_makeHttpRequest').mockResolvedValue({ body: 'new', statusCode: 200 });
        service.requestCache.clear();
        await (service.refreshQueue as any).refreshFunction('https://feed/x', 'token');
        service.requestCache.clear();

        expect((await service.makeRequest('https://feed/x', 'token')).body).toBe('new');
        expect(http).toHaveBeenCalledTimes(1);
    });

    it('a background refresh that gets an error answer keeps the good entry', async () => {
        jest.spyOn(service, '_makeHttpRequestWithETag').mockResolvedValueOnce({ body: 'good', statusCode: 200 });
        await service.makeRequest('https://feed/x', 'token');

        jest.spyOn(service, '_makeHttpRequest').mockResolvedValue({ body: 'unauthorized', statusCode: 401 });
        service.requestCache.clear();
        await (service.refreshQueue as any).refreshFunction('https://feed/x', 'token');
        service.requestCache.clear();

        expect((await service.makeRequest('https://feed/x', 'token')).body).toBe('good');
    });

    it('an answer on its way when the caches are cleared (Refresh) is not kept', async () => {
        let answer: (value: unknown) => void = () => { };
        const http = jest.spyOn(service, '_makeHttpRequestWithETag')
            .mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }))
            .mockResolvedValue({ body: 'fresh', statusCode: 200 });
        const inFlight = service.makeRequest('https://feed/y');
        await new Promise(resolve => setTimeout(resolve, 20));

        await NuGetV3Service.clearCaches();
        answer({ body: 'from before the refresh', statusCode: 200 });
        expect((await inFlight).body).toBe('from before the refresh');

        expect((await service.makeRequest('https://feed/y')).body).toBe('fresh');
        expect(http).toHaveBeenCalledTimes(2);
    });

    it('callers that ask for the same URL within moments share one request, also while the disk cache is still being read', async () => {
        const http = jest.spyOn(service, '_makeHttpRequestWithETag').mockResolvedValue({ body: 'one', statusCode: 200 });

        const answers = await Promise.all([service.makeRequest('https://feed/z', 't'), service.makeRequest('https://feed/z', 't'), service.makeRequest('https://feed/z', 't')]);

        expect(answers.map(answer => answer.body)).toEqual(['one', 'one', 'one']);
        expect(http).toHaveBeenCalledTimes(1);
    });

    it('a failed shared request is not remembered', async () => {
        const http = jest.spyOn(service, '_makeHttpRequestWithETag').mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ body: 'back', statusCode: 200 });
        await expect(service.makeRequest('https://feed/w')).rejects.toThrow('offline');
        expect((await service.makeRequest('https://feed/w')).body).toBe('back');
        expect(http).toHaveBeenCalledTimes(2);
    });
});
