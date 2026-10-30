jest.mock('vscode', () => ({ workspace: { workspaceFolders: [] } }), { virtual: true });
jest.mock('../../../../services/solution/solutionService', () => ({ SolutionService: { getActiveSolution: () => undefined } }));
jest.mock('../../../../services/nuget/nugetCredentialManager', () => ({ NuGetCredentialManager: { getSourceToken: async () => undefined } }));

import { NuGetV3Service } from '../../../../services/nuget/nugetV3Service';

const entry = (version: string, authors: string) => ({
    catalogEntry: { '@type': 'PackageDetails', id: 'Pkg', version, authors, description: 'd' },
});

describe('NuGetV3Service.getPackageDetails', () => {
    it('reads the authors from registration pages that are not inlined', async () => {
        const pages: Record<string, unknown> = {
            'https://feed/index.json': { resources: [{ '@type': 'RegistrationsBaseUrl', '@id': 'https://feed/reg/' }] },
            'https://feed/reg/pkg/index.json': { items: [
                { '@id': 'https://feed/reg/pkg/page/0.json', lower: '0.1.0', upper: '0.9.0' },
                { '@id': 'https://feed/reg/pkg/page/1.json', lower: '1.0.0', upper: '2.0.0' },
                { '@id': 'https://feed/reg/pkg/page/2.json', lower: '0.0.1', upper: '0.0.9' },
                { '@id': 'https://feed/reg/pkg/page/3.json', lower: '0.0.1', upper: '0.0.5' },
            ] },
            'https://feed/reg/pkg/page/0.json': { items: [entry('0.5.0', '')] },
            'https://feed/reg/pkg/page/1.json': { items: [entry('1.0.0', 'Ann, Bob'), entry('2.0.0', 'Ann, Bob')] },
        };
        jest.spyOn(NuGetV3Service as any, 'makeRequest').mockImplementation(async (url: any) =>
            url in pages ? { body: JSON.stringify(pages[url]), statusCode: 200 } : { body: '', statusCode: 404 });

        const details = await NuGetV3Service.getPackageDetails('Pkg', [{ name: 'f', url: 'https://feed/index.json', enabled: true } as any]);

        expect(details?.currentVersion).toBe('2.0.0');
        expect(details?.authors).toEqual(['Ann', 'Bob']);
    });

    it('keeps the dependencies of each version, all target frameworks together', async () => {
        const withDependencies = (version: string, protobuf: string) => ({
            catalogEntry: {
                '@type': 'PackageDetails', id: 'Grpc.AspNetCore', version, dependencyGroups: [
                    { targetFramework: 'net8.0', dependencies: [{ id: 'Google.Protobuf', range: protobuf }, { id: 'Grpc.Tools', range: `[${version}, )` }] },
                    { targetFramework: 'net9.0', dependencies: [{ id: 'Google.Protobuf', range: protobuf }] },
                    { targetFramework: 'net10.0' },
                ],
            },
        });
        const pages: Record<string, unknown> = {
            'https://deps/index.json': { resources: [{ '@type': 'RegistrationsBaseUrl', '@id': 'https://deps/reg/' }] },
            'https://deps/reg/grpc.aspnetcore/index.json': { items: [
                { '@id': 'https://deps/reg/grpc.aspnetcore/page/0.json', lower: '2.71.0', upper: '2.84.0', items: [withDependencies('2.71.0', '[3.30.2, )'), withDependencies('2.84.0', '[3.35.1, )')] },
            ] },
        };
        jest.spyOn(NuGetV3Service as any, 'makeRequest').mockImplementation(async (url: any) =>
            url in pages ? { body: JSON.stringify(pages[url]), statusCode: 200 } : { body: '', statusCode: 404 });

        const details = await NuGetV3Service.getPackageDetails('Grpc.AspNetCore', [{ name: 'deps', url: 'https://deps/index.json', enabled: true } as any]);

        expect(details?.dependencies?.['2.84.0']).toEqual([
            { id: 'Google.Protobuf', range: '[3.35.1, )' }, { id: 'Grpc.Tools', range: '[2.84.0, )' }, { id: 'Google.Protobuf', range: '[3.35.1, )' },
        ]);
        expect(details?.dependencies?.['2.71.0']?.[0]).toEqual({ id: 'Google.Protobuf', range: '[3.30.2, )' });
    });

    it('does not wait on a folder source listed before the feed (review A4-14)', async () => {
        const asked: string[] = [];
        jest.spyOn(NuGetV3Service as any, 'makeRequest').mockImplementation(async (url: any) => {
            asked.push(url);
            if (url === 'https://slow/index.json') {
                return { body: JSON.stringify({ resources: [{ '@type': 'RegistrationsBaseUrl', '@id': 'https://slow/reg/' }] }), statusCode: 200 };
            }
            return url === 'https://slow/reg/pkg2/index.json'
                ? { body: JSON.stringify({ items: [{ '@id': 'x', lower: '1.0.0', upper: '1.0.0', items: [entry('1.0.0', 'Ann')] }] }), statusCode: 200 }
                : { body: '', statusCode: 404 };
        });
        const started = Date.now();

        const details = await NuGetV3Service.getPackageDetails('Pkg2', [
            { name: 'folder', url: '/srv/packages', enabled: true, isLocal: true } as any,
            { name: 'slow', url: 'https://slow/index.json', enabled: true, isLocal: false } as any,
        ]);

        expect(details?.currentVersion).toBe('1.0.0');
        expect(asked.some(url => url.includes('/srv/packages'))).toBe(false);
        expect(Date.now() - started).toBeLessThan(1500);
    });
});

describe('NuGetV3Service.getPackageDetails: what is logged', () => {
    const { setLogSink } = jest.requireActual('../../../../core/logger') as typeof import('../../../../core/logger');
    let lines: [string, string][];
    beforeEach(() => {
        lines = [];
        const record = (level: string) => (message: string) => { lines.push([level, message]); };
        setLogSink({ trace: record('trace'), debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') });
        (NuGetV3Service as any).packageCache.clear();
    });
    afterEach(() => { setLogSink(undefined); jest.restoreAllMocks(); });

    const index = (host: string) => ({ resources: [{ '@type': 'RegistrationsBaseUrl', '@id': `https://${host}/reg/` }] });
    const source = (name: string, host: string) => ({ name, url: `https://${host}/index.json`, enabled: true } as any);
    const serve = (answers: Record<string, { statusCode: number; body?: unknown }>) =>
        jest.spyOn(NuGetV3Service as any, 'makeRequest').mockImplementation(async (url: any) => {
            const answer = answers[url] ?? { statusCode: 404 };
            return { statusCode: answer.statusCode, body: JSON.stringify(answer.body ?? {}) };
        });

    it('a 404 from the first feed is expected when the next one has the package: nothing above debug', async () => {
        serve({
            'https://private/index.json': { statusCode: 200, body: index('private') },
            'https://public/index.json': { statusCode: 200, body: index('public') },
            'https://public/reg/serilog/index.json': { statusCode: 200, body: { items: [{ '@id': 'p0', lower: '1.0.0', upper: '2.0.0', items: [entry('2.0.0', 'x')] }] } },
        });

        const details = await NuGetV3Service.getPackageDetails('Serilog', [source('birs', 'private'), source('nuget.org', 'public')]);

        expect(details?.currentVersion).toBe('2.0.0');
        expect(details?.sourceName).toBe('nuget.org');
        expect(lines.filter(([level]) => level !== 'debug')).toEqual([]);
    });

    it('no source has the package: one warning that says what each answered', async () => {
        serve({
            'https://private/index.json': { statusCode: 200, body: index('private') },
            'https://public/index.json': { statusCode: 200, body: index('public') },
        });

        const details = await NuGetV3Service.getPackageDetails('Nope', [source('birs', 'private'), source('nuget.org', 'public')]);

        expect(details).toBeNull();
        expect(lines.filter(([level]) => level !== 'debug')).toEqual([['warn', '[NuGetV3Service] No package details for Nope (birs: not found; nuget.org: not found)']]);
    });
});
