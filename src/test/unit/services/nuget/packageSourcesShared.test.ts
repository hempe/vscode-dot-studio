// The list of package sources is read once for a burst of callers (enriching 150 packages asked for it 150 times, one dotnet process each)
jest.mock('vscode', () => ({ workspace: { workspaceFolders: undefined }, window: {}, commands: {}, env: {} }), { virtual: true });
jest.mock('../../../../services/shared/settings', () => ({ Settings: { nugetPackageSources: () => false } }));

import { PackageBrowseService } from '../../../../services/nuget/packageBrowseService';

describe('PackageBrowseService.getPackageSources', () => {
    let reads: number;
    beforeEach(() => {
        reads = 0;
        PackageBrowseService.invalidateSources();
        jest.spyOn(PackageBrowseService as any, 'getSourcesFromDotnetCli').mockImplementation(async () => {
            reads++;
            return [{ name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json', enabled: true, isLocal: false }];
        });
    });
    afterEach(() => jest.restoreAllMocks());

    it('reads the sources once for callers that come one after the other', async () => {
        await PackageBrowseService.getPackageSources();
        await PackageBrowseService.getPackageSources();
        await Promise.all([PackageBrowseService.getPackageSources(), PackageBrowseService.getPackageSources()]);
        expect(reads).toBe(1);
    });

    it('reads them again after they were changed', async () => {
        await PackageBrowseService.getPackageSources();
        PackageBrowseService.invalidateSources();
        await PackageBrowseService.getPackageSources();
        expect(reads).toBe(2);
    });

    it('reads them again after the time is up', async () => {
        const now = jest.spyOn(Date, 'now');
        now.mockReturnValue(1_000);
        await PackageBrowseService.getPackageSources();
        now.mockReturnValue(1_000 + 6_000);
        await PackageBrowseService.getPackageSources();
        expect(reads).toBe(2);
    });
});
