import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { encodeSourceName, findCredential, nugetConfigFiles, userConfigDir } from '../../../../services/nuget/nugetCredentials';
import { feedHelp } from '../../../../services/nuget/feedHelp';

const config = (credentials: string) => `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="My Feed" value="https://pkgs.dev.azure.com/contoso/_packaging/My Feed/nuget/v3/index.json" />
  </packageSources>
  <packageSourceCredentials>
${credentials}
  </packageSourceCredentials>
</configuration>
`;

describe('NuGet.Config files', () => {
    it('lists the configs from the folder up, then the user config, whatever their case', () => {
        const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nugetcfg-')));
        const repo = path.join(root, 'repo');
        const src = path.join(repo, 'src');
        const home = path.join(root, 'home');
        const appData = process.env.APPDATA;
        process.env.APPDATA = path.join(home, 'AppData', 'Roaming'); // where Windows looks for the user config
        const userDir = userConfigDir(home);
        fs.mkdirSync(src, { recursive: true });
        fs.mkdirSync(userDir, { recursive: true });
        fs.writeFileSync(path.join(src, 'nuget.config'), '<configuration />');
        fs.writeFileSync(path.join(repo, 'NuGet.Config'), '<configuration />');
        fs.writeFileSync(path.join(userDir, 'NuGet.Config'), '<configuration />');

        expect(nugetConfigFiles(src, home)).toEqual([
            path.join(src, 'nuget.config'),
            path.join(repo, 'NuGet.Config'),
            path.join(userDir, 'NuGet.Config'),
        ]);
        if (appData === undefined) {
            delete process.env.APPDATA;
        } else {
            process.env.APPDATA = appData;
        }
        fs.rmSync(root, { recursive: true });
    });
});

describe('findCredential', () => {
    it('encodes source names like NuGet (XmlConvert)', () => {
        expect(encodeSourceName('My Feed')).toBe('My_x0020_Feed');
        expect(encodeSourceName('contoso-feed.v2')).toBe('contoso-feed.v2');
        expect(encodeSourceName('1st')).toBe('_x0031_st');
    });

    it('finds clear text credentials with file and line', () => {
        const files = [
            { path: '/repo/nuget.config', content: '<configuration />' },
            { path: '/home/.nuget/NuGet/NuGet.Config', content: config(`    <My_x0020_Feed>
      <add key="Username" value="me@contoso.com" />
      <add key="ClearTextPassword" value="secret" />
    </My_x0020_Feed>`) },
        ];
        expect(findCredential(files, 'My Feed')).toEqual({
            kind: 'clearText', file: '/home/.nuget/NuGet/NuGet.Config', line: 9, username: 'me@contoso.com', password: 'secret',
        });
    });

    it('reports encrypted passwords it cannot use and missing credentials', () => {
        const encrypted = [{ path: '/c', content: config('    <Feed><add key="Username" value="u" /><add key="Password" value="AQAAANCMnd8B" /></Feed>') }];
        expect(findCredential(encrypted, 'Feed')).toMatchObject({ kind: 'encrypted', file: '/c', username: 'u' });
        expect(findCredential(encrypted, 'Other')).toEqual({ kind: 'none' });
    });

    it('takes the first file that has credentials, as NuGet does', () => {
        const files = [
            { path: '/repo/nuget.config', content: config('<Feed><add key="ClearTextPassword" value="near" /></Feed>') },
            { path: '/home/NuGet.Config', content: config('<Feed><add key="ClearTextPassword" value="far" /></Feed>') },
        ];
        expect(findCredential(files, 'Feed')).toMatchObject({ file: '/repo/nuget.config', password: 'near' });
    });
});

describe('feedHelp', () => {
    it('Azure DevOps: token page of the organization, Packaging (Read)', () => {
        const help = feedHelp('https://pkgs.dev.azure.com/contoso/_packaging/feed/nuget/v3/index.json');
        expect(help).toMatchObject({ provider: 'Azure DevOps', tokenUrl: 'https://dev.azure.com/contoso/_usersSettings/tokens' });
        expect(help.steps.join(' ')).toMatch(/Packaging \(Read\)/);
        expect(feedHelp('https://contoso.pkgs.visualstudio.com/_packaging/feed/nuget/v3/index.json').tokenUrl)
            .toBe('https://dev.azure.com/contoso/_usersSettings/tokens');
    });

    it('GitHub, GitLab, JFrog, MyGet and others', () => {
        expect(feedHelp('https://nuget.pkg.github.com/contoso/index.json')).toMatchObject({ provider: 'GitHub Packages', tokenUrl: 'https://github.com/settings/tokens' });
        expect(feedHelp('https://gitlab.example.com/api/v4/projects/42/packages/nuget/index.json')).toMatchObject({
            provider: 'GitLab', tokenUrl: 'https://gitlab.example.com/-/user_settings/personal_access_tokens',
        });
        expect(feedHelp('https://contoso.jfrog.io/artifactory/api/nuget/v3/nuget-local')).toMatchObject({ provider: 'JFrog Artifactory' });
        expect(feedHelp('https://www.myget.org/F/contoso/api/v3/index.json')).toMatchObject({ provider: 'MyGet' });
        const other = feedHelp('https://nexus.contoso.com/repository/nuget/index.json');
        expect(other.provider).toBeUndefined();
        expect(other.steps.length).toBeGreaterThan(0);
    });
});

import { matchSource, setClearTextPassword } from '../../../../services/nuget/nugetCredentials';

describe('setClearTextPassword', () => {
    it('replaces the token of existing credentials, keeping everything else', () => {
        const before = config(`    <My_x0020_Feed>
      <add key="Username" value="me@contoso.com" />
      <add key="ClearTextPassword" value="old" />
    </My_x0020_Feed>`);
        const after = setClearTextPassword(before, 'My Feed', 'me@contoso.com', 'new&<token>');
        expect(after).toBe(before.replace('value="old"', 'value="new&amp;&lt;token&gt;"'));
    });

    it('turns an encrypted password into a clear text one', () => {
        const before = config('    <Feed>\n      <add key="Username" value="u" />\n      <add key="Password" value="AQAAANCMnd8B" />\n    </Feed>');
        expect(setClearTextPassword(before, 'Feed', 'u', 't')).toContain('<add key="ClearTextPassword" value="t" />');
        expect(setClearTextPassword(before, 'Feed', 'u', 't')).not.toContain('AQAAANCMnd8B');
    });

    it('adds credentials for a source that has none, with the section when missing', () => {
        const withSection = setClearTextPassword(config(''), 'My Feed', 'me', 't');
        expect(findCredential([{ path: '/c', content: withSection }], 'My Feed')).toMatchObject({ kind: 'clearText', username: 'me', password: 't' });

        const bare = '<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n</configuration>\n';
        const added = setClearTextPassword(bare, 'Feed', 'me', 't');
        expect(added).toContain('<packageSourceCredentials>');
        expect(findCredential([{ path: '/c', content: added }], 'Feed')).toMatchObject({ kind: 'clearText', password: 't' });
    });
});

describe('matchSource', () => {
    const sources = [
        { name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json', enabled: true, isLocal: false },
        { name: 'Contoso', url: 'https://pkgs.dev.azure.com/contoso/_packaging/main/nuget/v3/index.json', enabled: true, isLocal: false },
        { name: 'Contoso Tools', url: 'https://pkgs.dev.azure.com/contoso/_packaging/tools/nuget/v3/index.json', enabled: true, isLocal: false },
    ];

    it('finds the source a request URL belongs to', () => {
        expect(matchSource('https://pkgs.dev.azure.com/contoso/_packaging/tools/nuget/v3/query2?q=x', sources)?.name).toBe('Contoso Tools');
        expect(matchSource('https://pkgs.dev.azure.com/contoso/_packaging/main/nuget/v3/index.json', sources)?.name).toBe('Contoso');
        expect(matchSource('https://example.com/feed', sources)).toBeUndefined();
    });
});

describe('findCredential: what NuGet reads (review A4-10)', () => {
    const config = (inner: string) => `<configuration>\n  <packageSourceCredentials>\n    <Feed>\n${inner}\n    </Feed>\n  </packageSourceCredentials>\n</configuration>\n`;
    const read = (content: string) => findCredential([{ path: 'NuGet.Config', content }], 'Feed');

    it('decodes XML entities: a token with & < > " is read back as typed', () => {
        const stored = setClearTextPassword('<configuration>\n</configuration>\n', 'Feed', 'me', 'pa&ss<w>o"rd');
        expect(read(stored)).toMatchObject({ kind: 'clearText', username: 'me', password: 'pa&ss<w>o"rd' });
    });

    it('reads a hand-written &amp; as &', () => {
        expect(read(config('      <add key="ClearTextPassword" value="a&amp;b" />'))).toMatchObject({ password: 'a&b' });
    });

    it('skips credentials in XML comments', () => {
        const content = config([
            '      <!-- <add key="ClearTextPassword" value="OLD-EXPIRED-TOKEN" /> -->',
            '      <add key="ClearTextPassword" value="NEW-TOKEN" />',
        ].join('\n'));
        expect(read(content)).toMatchObject({ password: 'NEW-TOKEN' });
        // a commented-out section is not a section
        expect(read(`<configuration>\n<!--\n${config('      <add key="ClearTextPassword" value="OLD" />')}-->\n</configuration>\n`)).toEqual({ kind: 'none' });
    });

    it('reads single-quoted attributes', () => {
        expect(read(config("      <add key='Username' value='me' />\n      <add key='ClearTextPassword' value='tok' />"))).toMatchObject({ username: 'me', password: 'tok' });
    });

    it('reports the line of the password after blanking comments', () => {
        const content = config('      <!-- one\n two -->\n      <add key="ClearTextPassword" value="x" />');
        expect(read(content)).toMatchObject({ line: 6 });
    });
});

describe('nugetConfigFiles and the solution-level .nuget/NuGet.Config', () => {
    it('lists it after the config in the solution folder, for the solution folder only', () => {
        const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-legacy-')));
        try {
            const solutionDir = path.join(root, 'src');
            fs.mkdirSync(path.join(solutionDir, '.nuget'), { recursive: true });
            fs.mkdirSync(path.join(root, '.nuget'), { recursive: true });
            fs.writeFileSync(path.join(solutionDir, '.nuget', 'NuGet.Config'), '<configuration />');
            fs.writeFileSync(path.join(root, '.nuget', 'NuGet.Config'), '<configuration />');
            fs.writeFileSync(path.join(solutionDir, 'NuGet.Config'), '<configuration />');

            const files = nugetConfigFiles(solutionDir, path.join(root, 'home'));

            expect(files.slice(0, 2)).toEqual([path.join(solutionDir, 'NuGet.Config'), path.join(solutionDir, '.nuget', 'NuGet.Config')]);
            // a .nuget folder above the solution is not a Visual Studio location
            expect(files).not.toContain(path.join(root, '.nuget', 'NuGet.Config'));
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('feeds whose names start alike', () => {
    const both = `<configuration>
  <packageSourceCredentials>
    <MyFeed-Preview>
      <add key="Username" value="a" />
      <add key="ClearTextPassword" value="PREVIEW_SECRET" />
    </MyFeed-Preview>
    <MyFeed>
      <add key="Username" value="b" />
      <add key="ClearTextPassword" value="MAIN_SECRET" />
    </MyFeed>
  </packageSourceCredentials>
</configuration>`;

    it('changes only the named feed', () => {
        const result = setClearTextPassword(both, 'MyFeed', 'b', 'NEW');
        expect(result).toContain('PREVIEW_SECRET');
        expect(result).toContain('NEW');
        expect(result).not.toContain('MAIN_SECRET');
        expect(findCredential([{ path: 'x', content: result }], 'MyFeed-Preview')).toMatchObject({ password: 'PREVIEW_SECRET' });
    });

    it('does not read the password of a feed with a longer name', () => {
        const onlyPreview = both.replace(/<MyFeed>[\s\S]*<\/MyFeed>/, '');
        expect(findCredential([{ path: 'x', content: onlyPreview }], 'MyFeed')).toEqual({ kind: 'none' });
    });
});

describe('setClearTextPassword input handling', () => {
    it('leaves commented-out credentials alone and adds real ones', () => {
        const content = `<configuration>
  <packageSourceCredentials>
    <!-- <MyFeed><add key="ClearTextPassword" value="old" /></MyFeed> -->
  </packageSourceCredentials>
</configuration>`;
        const result = setClearTextPassword(content, 'MyFeed', 'u', 'tok');
        expect(result).toContain('<!-- <MyFeed><add key="ClearTextPassword" value="old" /></MyFeed> -->');
        expect(findCredential([{ path: 'x', content: result }], 'MyFeed')).toMatchObject({ username: 'u', password: 'tok' });
    });

    it('writes a user name with $ patterns literally', () => {
        const content = `<configuration>
  <packageSourceCredentials>
    <MyFeed>
      <add key="ClearTextPassword" value="old" />
    </MyFeed>
  </packageSourceCredentials>
</configuration>`;
        const result = setClearTextPassword(content, 'MyFeed', 'u$&x', 'tok');
        expect(findCredential([{ path: 'x', content: result }], 'MyFeed')).toMatchObject({ username: 'u$&x', password: 'tok' });
    });
});
