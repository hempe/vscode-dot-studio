jest.mock('vscode', () => ({ workspace: { workspaceFolders: undefined }, window: {}, commands: {}, env: {} }), { virtual: true });

import { NuGetManagerService } from '../../../../services/nuget/nugetManagerService';
import { PackageBrowseService } from '../../../../services/nuget/packageBrowseService';
import { isNuGetOrgUrl } from '../../../../services/nuget/types';

const source = (name: string, url: string, enabled = true) => ({ name, url, enabled, isLocal: false });

describe('icons and READMEs come from nuget.org only when it is a source (review A4-17)', () => {
    afterEach(() => jest.restoreAllMocks());

    it('recognizes nuget.org URLs, not look-alikes', () => {
        expect(isNuGetOrgUrl('https://api.nuget.org/v3/index.json')).toBe(true);
        expect(isNuGetOrgUrl('https://www.nuget.org/api/v2')).toBe(true);
        expect(isNuGetOrgUrl('https://nuget.org.evil.example/v3/index.json')).toBe(false);
        expect(isNuGetOrgUrl('https://pkgs.dev.azure.com/org/_packaging/feed/nuget/v3/index.json')).toBe(false);
        expect(isNuGetOrgUrl('/srv/packages')).toBe(false);
    });

    it('is false for a private-only configuration, and for a disabled nuget.org', async () => {
        const sources = jest.spyOn(PackageBrowseService, 'getPackageSources');
        sources.mockResolvedValue([source('private', 'https://pkgs.dev.azure.com/o/_packaging/f/nuget/v3/index.json')]);
        expect(await NuGetManagerService.usesNuGetOrg()).toBe(false);
        sources.mockResolvedValue([source('nuget.org', 'https://api.nuget.org/v3/index.json', false)]);
        expect(await NuGetManagerService.usesNuGetOrg()).toBe(false);
        sources.mockResolvedValue([source('private', 'https://p/index.json'), source('nuget.org', 'https://api.nuget.org/v3/index.json')]);
        expect(await NuGetManagerService.usesNuGetOrg()).toBe(true);
    });
});
