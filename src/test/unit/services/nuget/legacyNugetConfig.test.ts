// A solution-level .nuget/NuGet.Config: read by Visual Studio, ignored by dotnet restore (known bug of 2026-10-26)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyLegacyConfig, legacyConfigPath, legacyConfigSources, needsLegacyConfigMove } from '../../../../services/nuget/legacyNugetConfig';

const CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="Cirrus" value="https://pkgs.dev.azure.com/contoso/_packaging/Cirrus/nuget/v3/index.json" />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />
    <add key="Local" value="../packages" />
    <add key="Off" value="https://example.com/off/index.json" />
  </packageSources>
  <disabledPackageSources>
    <add key="Off" value="true" />
  </disabledPackageSources>
</configuration>
`;

describe('legacy solution-level NuGet.Config', () => {
    let dir: string;
    beforeEach(() => { dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-nuget-'))); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    const legacy = (content = CONFIG, folder = '.nuget', file = 'NuGet.Config') => {
        fs.mkdirSync(path.join(dir, folder), { recursive: true });
        fs.writeFileSync(path.join(dir, folder, file), content);
        return path.join(dir, folder, file);
    };

    it('finds the file whatever the case of folder and name', () => {
        const file = legacy(CONFIG, '.NuGet', 'nuget.config');
        expect(legacyConfigPath(dir)).toBe(file);
        expect(legacyConfigPath(path.join(dir, 'nowhere'))).toBeUndefined();
    });

    it('needs the move only without a nuget.config in the solution folder', () => {
        legacy();
        expect(needsLegacyConfigMove(dir)).toBe(true);
        fs.writeFileSync(path.join(dir, 'NuGet.config'), '<configuration />');
        expect(needsLegacyConfigMove(dir)).toBe(false);
    });

    it('reads its sources with the disabled ones marked', () => {
        expect(legacyConfigSources(CONFIG)).toEqual([
            { name: 'Cirrus', url: 'https://pkgs.dev.azure.com/contoso/_packaging/Cirrus/nuget/v3/index.json', enabled: true, isLocal: false },
            { name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json', enabled: true, isLocal: false },
            { name: 'Local', url: '../packages', enabled: true, isLocal: true },
            { name: 'Off', url: 'https://example.com/off/index.json', enabled: false, isLocal: false },
        ]);
    });

    it('adds the sources of the file that the CLI did not list, keeping the CLI order and not duplicating', () => {
        legacy();
        const cli = [{ name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json', enabled: true, isLocal: false }];
        const merged = applyLegacyConfig(cli, dir);
        expect(merged.map(source => source.name)).toEqual(['nuget.org', 'Cirrus', 'Local', 'Off']);
        // already moved: the CLI lists them itself
        fs.writeFileSync(path.join(dir, 'nuget.config'), CONFIG);
        expect(applyLegacyConfig(cli, dir)).toEqual(cli);
    });

    it('moves it to nuget.config in the solution folder, or copies it', async () => {
        const file = legacy();
        const { moveLegacyConfig } = await import('../../../../services/nuget/legacyNugetConfig');
        moveLegacyConfig(dir, 'copy');
        expect(fs.readFileSync(path.join(dir, 'nuget.config'), 'utf8')).toBe(CONFIG);
        expect(fs.existsSync(file)).toBe(true);

        fs.rmSync(path.join(dir, 'nuget.config'));
        moveLegacyConfig(dir, 'move');
        expect(fs.readFileSync(path.join(dir, 'nuget.config'), 'utf8')).toBe(CONFIG);
        expect(fs.existsSync(file)).toBe(false);
    });

    it('refuses to overwrite an existing nuget.config', async () => {
        legacy();
        fs.writeFileSync(path.join(dir, 'nuget.config'), '<configuration />');
        const { moveLegacyConfig } = await import('../../../../services/nuget/legacyNugetConfig');
        expect(() => moveLegacyConfig(dir, 'move')).toThrow(/already/);
    });
});
