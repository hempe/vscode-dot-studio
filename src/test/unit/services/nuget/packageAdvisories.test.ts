jest.mock('vscode', () => ({ workspace: { workspaceFolders: [] } }), { virtual: true });
jest.mock('../../../../services/nuget/dotnetCli', () => ({ execDotnet: jest.fn() }));

import { execDotnet } from '../../../../services/nuget/dotnetCli';
import { mergeAdvisories, parseAdvisories, readProjectAdvisories } from '../../../../services/nuget/packageAdvisories';
import { advisoryKey } from '../../../../services/nuget/types';

// As `dotnet list package --vulnerable|--deprecated --include-transitive --format json` writes them (SDK 10)
const vulnerable = JSON.stringify({ version: 1, projects: [{ path: '/w/A.csproj', frameworks: [{ framework: 'net8.0',
    topLevelPackages: [{ id: 'Newtonsoft.Json', requestedVersion: '12.0.1', resolvedVersion: '12.0.1', vulnerabilities: [{ severity: 'High', advisoryurl: 'https://github.com/advisories/GHSA-5crp-9r3c-p9vr' }] }],
    transitivePackages: [{ id: 'System.Net.Http', resolvedVersion: '4.3.0', vulnerabilities: [{ severity: 'High', advisoryurl: 'https://github.com/advisories/GHSA-7jgj-8wvc-jh57' }] }] }] }] });
const deprecated = JSON.stringify({ version: 1, projects: [{ path: '/w/A.csproj', frameworks: [{ framework: 'net8.0',
    topLevelPackages: [{ id: 'WindowsAzure.Storage', requestedVersion: '9.3.3', resolvedVersion: '9.3.3', deprecationReasons: ['Legacy'], alternativePackage: { id: 'Azure.Storage.Common', versionRange: '>= 0.0.0' } }] }] }] });

describe('package advisories', () => {
    it('reads vulnerabilities (top-level and transitive) and deprecations with their replacement', () => {
        const advisories = parseAdvisories(vulnerable, deprecated);
        expect(advisories[advisoryKey('newtonsoft.json', '12.0.1')]).toEqual({ vulnerabilities: [{ severity: 'High', url: 'https://github.com/advisories/GHSA-5crp-9r3c-p9vr' }] });
        expect(advisories[advisoryKey('System.Net.Http', '4.3.0')]?.vulnerabilities?.[0].severity).toBe('High');
        expect(advisories[advisoryKey('WindowsAzure.Storage', '9.3.3')]).toEqual({ deprecation: { reasons: ['Legacy'], alternative: { id: 'Azure.Storage.Common', range: '>= 0.0.0' } } });
    });

    it('is empty for empty or unreadable output', () => {
        expect(parseAdvisories('', 'not json')).toEqual({});
        expect(parseAdvisories('{"projects":[{"frameworks":[{"framework":"net8.0"}]}]}', '{}')).toEqual({});
    });

    it('keeps a package that is vulnerable and deprecated as one entry, and joins projects without repeating an advisory', () => {
        const both = parseAdvisories(vulnerable.replace('Newtonsoft.Json', 'WindowsAzure.Storage').replace('12.0.1', '9.3.3').replace('12.0.1', '9.3.3'), deprecated);
        expect(Object.keys(both[advisoryKey('WindowsAzure.Storage', '9.3.3')])).toEqual(['vulnerabilities', 'deprecation']);

        const one = parseAdvisories(vulnerable, '');
        const merged = mergeAdvisories([one, one, parseAdvisories('', deprecated)]);
        expect(merged[advisoryKey('Newtonsoft.Json', '12.0.1')]?.vulnerabilities).toHaveLength(1);
        expect(merged[advisoryKey('WindowsAzure.Storage', '9.3.3')]?.deprecation?.reasons).toEqual(['Legacy']);
    });

    it('runs both lists for a project, and a list that fails does not take the other', async () => {
        const run = execDotnet as jest.Mock;
        run.mockReset().mockImplementation(async (args: string[]) => {
            if (args.includes('--vulnerable')) { throw new Error('no network'); }
            return { stdout: deprecated, stderr: '' };
        });
        const advisories = await readProjectAdvisories('/w/A.csproj');
        expect(run.mock.calls.map(call => call[0].slice(0, 4))).toEqual([['list', '/w/A.csproj', 'package', '--vulnerable'], ['list', '/w/A.csproj', 'package', '--deprecated']]);
        expect(Object.keys(advisories)).toEqual([advisoryKey('WindowsAzure.Storage', '9.3.3')]);
    });
});
