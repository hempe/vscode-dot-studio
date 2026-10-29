// Browse follows Package Source Mapping when the setting is on: a package counts only from a source the mapping lets provide it
jest.mock('vscode', () => ({ workspace: { workspaceFolders: undefined }, window: {}, commands: {}, env: {} }), { virtual: true });
let enabled = true;
jest.mock('../../../../services/shared/settings', () => ({ Settings: { nugetPackageSources: () => enabled } }));
jest.mock('../../../../services/nuget/packageSourceMappingFiles', () => ({
    readSourceMapping: () => ({ 'nuget.org': ['*'], 'Company Feed': ['Company.*'] }),
}));

import { allowedBySourceMapping, PackageBrowseService } from '../../../../services/nuget/packageBrowseService';

const source = (name: string) => ({ name, url: `https://${name}/index.json`, enabled: true, isLocal: false });
const mapping = { 'nuget.org': ['*'], 'Company Feed': ['Company.*'] };

describe('allowedBySourceMapping', () => {
    it('accepts a package from a source the mapping names, in any case', () => {
        expect(allowedBySourceMapping(mapping, { id: 'Company.Core', source: 'company feed' })).toBe(true);
        expect(allowedBySourceMapping(mapping, { id: 'Newtonsoft.Json', source: 'nuget.org' })).toBe(true);
    });

    it('refuses a package from a source the mapping does not let provide it (a public package with a private id)', () => {
        expect(allowedBySourceMapping(mapping, { id: 'Company.Core', source: 'nuget.org' })).toBe(false);
        expect(allowedBySourceMapping(mapping, { id: 'Newtonsoft.Json', source: 'Company Feed' })).toBe(false);
    });

    it('accepts everything without a mapping, and a result of unknown source', () => {
        expect(allowedBySourceMapping({}, { id: 'X', source: 'any' })).toBe(true);
        expect(allowedBySourceMapping(mapping, { id: 'Company.Core' })).toBe(true);
    });
});

describe('PackageBrowseService.searchPackages with Package Source Mapping', () => {
    beforeEach(() => {
        jest.spyOn(PackageBrowseService, 'getPackageSources').mockResolvedValue([source('nuget.org'), source('Company Feed')]);
        jest.spyOn(PackageBrowseService as any, 'searchSingleSource').mockImplementation(async (s: any) => [
            { id: 'Company.Core', currentVersion: s.name === 'nuget.org' ? '9.9.9' : '1.0.0', versions: [], source: s.name },
            { id: 'Serilog', currentVersion: '4.0.0', versions: [], source: s.name },
        ]);
    });
    afterEach(() => { jest.restoreAllMocks(); enabled = true; });

    it('keeps the private package from the private feed, though nuget.org has a higher version of that id', async () => {
        const results = await PackageBrowseService.searchPackages({ query: 'serilog' });
        expect(results.map(result => `${result.id} ${result.currentVersion} ${result.source}`).sort()).toEqual([
            'Company.Core 1.0.0 Company Feed',
            'Serilog 4.0.0 nuget.org',
        ]);
    });

    it('keeps the highest version of a package several sources have (review: the lowest was kept)', async () => {
        enabled = false;
        const results = await PackageBrowseService.searchPackages({ query: 'serilog' });
        expect(results.find(result => result.id === 'Company.Core')?.currentVersion).toBe('9.9.9');
    });

    it('does not look at the mapping when the setting is off', async () => {
        enabled = false;
        const results = await PackageBrowseService.searchPackages({ query: 'serilog' });
        expect(results.find(result => result.id === 'Company.Core')?.currentVersion).toBe('9.9.9');
    });
});
