jest.mock('vscode', () => ({ workspace: { workspaceFolders: [] } }), { virtual: true });
jest.mock('../../../../services/nuget/dotnetCli', () => ({ ...jest.requireActual('../../../../services/nuget/dotnetCli'), execDotnet: jest.fn() }));

import { execDotnet } from '../../../../services/nuget/dotnetCli';
import { advisorySourceArgs, mergeAdvisories, parseAdvisories, readProjectAdvisories, readTargetAdvisories } from '../../../../services/nuget/packageAdvisories';
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

    it('reads from the last restore and says when a list failed, so that its emptiness is not "no vulnerabilities"', async () => {
        const run = execDotnet as jest.Mock;
        run.mockReset().mockImplementation(async (args: string[]) => {
            if (args.includes('--vulnerable')) { throw new Error('no network'); }
            return { stdout: deprecated, stderr: '' };
        });
        const failed = await readTargetAdvisories('/w/App.sln');
        expect(failed.complete).toBe(false);
        expect(run.mock.calls.every(call => (call[0] as string[]).includes('--no-restore'))).toBe(true);

        run.mockReset().mockResolvedValue({ stdout: '', stderr: '' });
        expect((await readTargetAdvisories('/w/App.sln')).complete).toBe(true);
    });

    describe('where the vulnerability data comes from', () => {
        const source = (url: string, enabled = true, isLocal = false) => ({ name: url, url, enabled, isLocal });

        it('a V2 URL of nuget.org has no vulnerability data (the CLI then finds none): ask nuget.org V3', () => {
            expect(advisorySourceArgs([source('https://birs.pkgs.visualstudio.com/_packaging/ACME/nuget/v3/index.json'), source('https://www.nuget.org/api/v2/')]))
                .toEqual(['--source', 'https://api.nuget.org/v3/index.json']);
            expect(advisorySourceArgs([source('https://www.nuget.org/api/v2')])).toEqual(['--source', 'https://api.nuget.org/v3/index.json']);
        });

        it('leaves the sources alone when nuget.org is V3 already, absent, disabled or a local folder', () => {
            expect(advisorySourceArgs([source('https://api.nuget.org/v3/index.json')])).toEqual([]);
            expect(advisorySourceArgs([source('https://api.nuget.org/v3/index.json'), source('https://www.nuget.org/api/v2/')])).toEqual([]);
            expect(advisorySourceArgs([source('https://contoso/v3/index.json')])).toEqual([]);
            expect(advisorySourceArgs([source('https://www.nuget.org/api/v2/', false)])).toEqual([]);
            expect(advisorySourceArgs([source('/home/me/packages', true, true)])).toEqual([]);
        });

        it('passes the source to the vulnerable list only', async () => {
            const run = execDotnet as jest.Mock;
            run.mockReset().mockResolvedValue({ stdout: '', stderr: '' });
            await readProjectAdvisories('/w/A.csproj', ['--source', 'https://api.nuget.org/v3/index.json']);
            const [vulnerableCall, deprecatedCall] = run.mock.calls.map(call => call[0] as string[]);
            expect(vulnerableCall).toEqual(['list', '/w/A.csproj', 'package', '--vulnerable', '--include-transitive', '--no-restore', '--format', 'json', '--source', 'https://api.nuget.org/v3/index.json']);
            expect(deprecatedCall).not.toContain('--source');
        });
    });
});
