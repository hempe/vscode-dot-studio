// Browse searches the source the dropdown names (Visual Studio's "Package source")
jest.mock('vscode', () => ({ workspace: { workspaceFolders: undefined }, window: {}, commands: {}, env: {} }), { virtual: true });

jest.mock('../../../../services/settings', () => ({ Settings: { nugetPackageSources: () => false } }));

import { PackageBrowseService } from '../../../../services/nuget/packageBrowseService';

const source = (name: string, enabled = true) => ({ name, url: `https://${name}/index.json`, enabled, isLocal: false });

describe('PackageBrowseService.searchPackages with a source', () => {
    let searched: string[];
    beforeEach(() => {
        searched = [];
        jest.spyOn(PackageBrowseService, 'getPackageSources').mockResolvedValue([source('nuget.org'), source('birs'), source('off', false), source('four'), source('five')]);
        jest.spyOn(PackageBrowseService as any, 'searchSingleSource').mockImplementation(async (s: any) => {
            searched.push(s.name);
            return [{ id: `pkg-from-${s.name}`, currentVersion: '1.0.0', versions: ['1.0.0'] }];
        });
    });
    afterEach(() => jest.restoreAllMocks());

    it('searches only the chosen source', async () => {
        const results = await PackageBrowseService.searchPackages({ query: 'serilog', source: 'birs' });
        expect(searched).toEqual(['birs']);
        expect(results.map(result => result.id)).toEqual(['pkg-from-birs']);
    });

    it('reaches a source beyond the first three when it is chosen', async () => {
        await PackageBrowseService.searchPackages({ query: 'serilog', source: 'five' });
        expect(searched).toEqual(['five']);
    });

    it('without a source searches the first three that are enabled feeds (disabled and folder sources do not use up a place, review A4-18)', async () => {
        jest.spyOn(PackageBrowseService, 'getPackageSources').mockResolvedValue([
            source('off', false), { ...source('folder'), isLocal: true }, source('nuget.org'), source('birs'), source('four'), source('five')]);
        await PackageBrowseService.searchPackages({ query: 'serilog' });
        expect(searched.sort()).toEqual(['birs', 'four', 'nuget.org']);
    });

    it('does not search a folder source, even when chosen', async () => {
        jest.spyOn(PackageBrowseService, 'getPackageSources').mockResolvedValue([{ ...source('folder'), isLocal: true }]);
        await PackageBrowseService.searchPackages({ query: 'serilog', source: 'folder' });
        expect(searched).toEqual([]);
    });

    it('does not search a disabled source, even when chosen', async () => {
        await PackageBrowseService.searchPackages({ query: 'serilog', source: 'off' });
        expect(searched).toEqual([]);
    });
});
