import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const showInfo = jest.fn();
const showError = jest.fn();
let enabled = true;
jest.mock('vscode', () => ({ window: { showInformationMessage: (...args: unknown[]) => showInfo(...args), showErrorMessage: (...args: unknown[]) => showError(...args) }, workspace: { workspaceFolders: [] } }), { virtual: true });
jest.mock('../../../../services/shared/settings', () => ({ Settings: { offerNuGetV3Migration: () => enabled } }));
jest.mock('../../../../services/nuget/feedAuth', () => ({ isInWorkspace: () => true }));

import { isLegacyNuGetOrgUrl, legacyNuGetOrgSources, NuGetV3Offer, offerNuGetV3Migration, upgradeNuGetOrgSources } from '../../../../services/nuget/nugetV3Offer';

const config = (nugetOrg: string) => `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <!-- remove any machine-wide sources with <clear/> -->
    <clear />
    <add key="birs" value="https://birs.pkgs.visualstudio.com/_packaging/ACME/nuget/v3/index.json" />
    <!-- <add key="old" value="https://www.nuget.org/api/v2/" /> -->
    <add key="nuget.org" value="${nugetOrg}" />
  </packageSources>
  <activePackageSource>
    <add key="All" value="(Aggregate source)" />
  </activePackageSource>
</configuration>
`;

describe('nuget.org addresses', () => {
    it('knows the old ones', () => {
        for (const url of ['https://www.nuget.org/api/v2/', 'https://www.nuget.org/api/v2', 'http://www.nuget.org/api/v2/', 'https://nuget.org/api/v2/',
            'https://www.nuget.org/api/v3/', 'https://api.nuget.org/v3/', 'https://www.nuget.org/v2/', 'https://www.nuget.org/']) {
            expect(isLegacyNuGetOrgUrl(url)).toBe(true);
        }
    });

    it('leaves the service index, other feeds and what is not an address alone', () => {
        for (const url of ['https://api.nuget.org/v3/index.json', 'https://birs.pkgs.visualstudio.com/_packaging/ACME/nuget/v3/index.json',
            'https://www.myget.org/F/x/api/v2', '/home/me/packages', '', 'https://www.nuget.org/packages']) {
            expect(isLegacyNuGetOrgUrl(url)).toBe(false);
        }
    });
});

describe('NuGet.Config text', () => {
    it('finds the sources with an old address, not a commented one or one outside packageSources', () => {
        expect(legacyNuGetOrgSources(config('https://www.nuget.org/api/v2/'))).toEqual([{ name: 'nuget.org', url: 'https://www.nuget.org/api/v2/' }]);
        expect(legacyNuGetOrgSources(config('https://api.nuget.org/v3/index.json'))).toEqual([]);
        expect(legacyNuGetOrgSources('<configuration><config><add key="x" value="https://www.nuget.org/api/v2/" /></config></configuration>')).toEqual([]);
    });

    it('changes only the address: comments, the other feed and the layout stay', () => {
        const before = config('https://www.nuget.org/api/v3/');
        const after = upgradeNuGetOrgSources(before);
        expect(after).toBe(config('https://api.nuget.org/v3/index.json'));
        expect(after).toContain('<!-- <add key="old" value="https://www.nuget.org/api/v2/" /> -->');
        expect(upgradeNuGetOrgSources(after)).toBe(after);
    });

    it('changes every source with an old address', () => {
        const two = config('https://www.nuget.org/api/v2/').replace('</packageSources>', '    <add key="mirror" value="http://nuget.org/api/v2" />\n  </packageSources>');
        expect(upgradeNuGetOrgSources(two).match(/api\.nuget\.org\/v3\/index\.json/g)).toHaveLength(2);
    });
});

describe('offerNuGetV3Migration', () => {
    let dir: string;
    let file: string;
    const state = new Map<string, unknown>();
    const memento = { get: (key: string, fallback: unknown) => state.get(key) ?? fallback, update: async (key: string, value: unknown) => { state.set(key, value); } };

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v3offer-'));
        file = path.join(dir, 'nuget.config');
        fs.writeFileSync(file, config('https://www.nuget.org/api/v2/'));
        state.clear();
        NuGetV3Offer.initialize(memento as never);
        showInfo.mockReset();
        showError.mockReset();
        enabled = true;
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    const deps = (answer: string | undefined, editable = true) => ({ ask: jest.fn().mockResolvedValue(answer), configFiles: () => [{ file, editable }] });

    it('asks, and Update writes the V3 address', async () => {
        const d = deps('Update');
        await offerNuGetV3Migration(path.join(dir, 'App.sln'), d);
        expect(d.ask).toHaveBeenCalledTimes(1);
        expect(d.ask.mock.calls[0][0]).toContain('nuget.config lists nuget.org by an old address');
        expect(fs.readFileSync(file, 'utf8')).toBe(config('https://api.nuget.org/v3/index.json'));
        expect(showInfo).toHaveBeenCalled();
    });

    it('Not Now changes nothing and asks again next time; Don\'t Ask Again does not', async () => {
        await offerNuGetV3Migration(path.join(dir, 'App.sln'), deps('Not Now'));
        expect(fs.readFileSync(file, 'utf8')).toBe(config('https://www.nuget.org/api/v2/'));
        const again = deps("Don't Ask Again");
        await offerNuGetV3Migration(path.join(dir, 'App.sln'), again);
        expect(again.ask).toHaveBeenCalledTimes(1);
        const third = deps('Update');
        await offerNuGetV3Migration(path.join(dir, 'App.sln'), third);
        expect(third.ask).not.toHaveBeenCalled();
        expect(fs.readFileSync(file, 'utf8')).toBe(config('https://www.nuget.org/api/v2/'));
    });

    it('does not ask when the setting is off, the file is outside the workspace (the user config) or nothing is old', async () => {
        enabled = false;
        const off = deps('Update');
        await offerNuGetV3Migration(path.join(dir, 'App.sln'), off);
        expect(off.ask).not.toHaveBeenCalled();

        enabled = true;
        const user = deps('Update', false);
        await offerNuGetV3Migration(path.join(dir, 'App.sln'), user);
        expect(user.ask).not.toHaveBeenCalled();

        fs.writeFileSync(file, config('https://api.nuget.org/v3/index.json'));
        const current = deps('Update');
        await offerNuGetV3Migration(path.join(dir, 'App.sln'), current);
        expect(current.ask).not.toHaveBeenCalled();
    });
});
