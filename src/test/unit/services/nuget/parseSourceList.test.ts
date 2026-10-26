jest.mock('vscode', () => ({ workspace: { workspaceFolders: undefined }, window: {}, commands: {}, env: {} }), { virtual: true });

// The sources the NuGet manager reads from `dotnet nuget list source` (review A4-8, A4-9)
import { parseSourceList } from '../../../../services/nuget/packageBrowseService';

describe('parseSourceList', () => {
    it('reads names, urls, local paths and the enabled state', () => {
        const output = [
            'Registered Sources:',
            '',
            '  1.  PrivateFeed [Enabled]',
            '      https://pkgs.dev.azure.com/contoso/_packaging/feed/nuget/v3/index.json',
            '  2.  nuget.org [Disabled]',
            '      https://api.nuget.org/v3/index.json',
            '  3.  Local [Enabled]',
            '      /home/me/packages',
        ].join('\n');
        expect(parseSourceList(output)).toEqual([
            { name: 'PrivateFeed', url: 'https://pkgs.dev.azure.com/contoso/_packaging/feed/nuget/v3/index.json', enabled: true, isLocal: false },
            { name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json', enabled: false, isLocal: false },
            { name: 'Local', url: '/home/me/packages', enabled: true, isLocal: true },
        ]);
    });

    it('finds nothing in output of another language, which is why the CLI is asked in English', () => {
        expect(parseSourceList('  1.  PrivateFeed [Aktiviert]\n      https://example.com/index.json')).toEqual([]);
    });
});
