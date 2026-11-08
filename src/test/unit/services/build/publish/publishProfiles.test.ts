import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    applySettings, defaultFolderSettings, folderProfileXml, listProfiles, newProfileName, parseProfile, profileNameProblem, publishDirOf, publishDirOverride, clearPublishFolder,
} from '../../../../../services/build/publish/publishProfiles';

// A Folder profile as Visual Studio 2022 writes it
const visualStudioProfile = `<?xml version="1.0" encoding="utf-8"?>
<!--
https://go.microsoft.com/fwlink/?LinkID=208121.
-->
<Project>
  <PropertyGroup>
    <Configuration>Release</Configuration>
    <Platform>Any CPU</Platform>
    <PublishDir>bin\\Release\\net8.0\\publish\\</PublishDir>
    <PublishProtocol>FileSystem</PublishProtocol>
    <_TargetId>Folder</_TargetId>
    <TargetFramework>net8.0</TargetFramework>
    <ProjectGuid>6d4b1c8e-0000-4000-8000-000000000001</ProjectGuid>
    <SelfContained>false</SelfContained>
  </PropertyGroup>
</Project>`;

describe('publishProfiles', () => {
    it('reads a Folder profile Visual Studio made', () => {
        expect(parseProfile(visualStudioProfile, '/repo/Web/Properties/PublishProfiles/FolderProfile.pubxml')).toEqual({
            name: 'FolderProfile',
            path: '/repo/Web/Properties/PublishProfiles/FolderProfile.pubxml',
            target: 'Folder',
            settings: {
                configuration: 'Release',
                targetFramework: 'net8.0',
                publishDir: 'bin\\Release\\net8.0\\publish\\',
                selfContained: false,
                runtimeIdentifier: undefined,
                singleFile: false,
                readyToRun: false,
                trimmed: false,
                deleteExistingFiles: false,
            },
        });
    });

    it('recognizes profiles of other targets (Visual Studio teammates), which this extension lists but does not publish', () => {
        expect(parseProfile('<Project><PropertyGroup><WebPublishMethod>ZipDeploy</WebPublishMethod></PropertyGroup></Project>', '/p/Azure.pubxml').target).toBe('ZipDeploy');
        expect(parseProfile('<Project><PropertyGroup><PublishProtocol>FileSystem</PublishProtocol></PropertyGroup></Project>', '/p/Old.pubxml').target).toBe('Folder');
        expect(parseProfile('<Project><PropertyGroup><WebPublishMethod>FileSystem</WebPublishMethod></PropertyGroup></Project>', '/p/Old.pubxml').target).toBe('Folder');
    });

    it("writes new Folder profiles in Visual Studio's format", () => {
        const settings = defaultFolderSettings('net10.0');
        expect(settings).toEqual(expect.objectContaining({ configuration: 'Release', targetFramework: 'net10.0', publishDir: 'bin/Release/net10.0/publish/', selfContained: false }));
        const xml = folderProfileXml(settings);
        expect(xml).toBe(`<?xml version="1.0" encoding="utf-8"?>
<!--
https://go.microsoft.com/fwlink/?LinkID=208121.
-->
<Project>
  <PropertyGroup>
    <Configuration>Release</Configuration>
    <Platform>Any CPU</Platform>
    <PublishDir>bin/Release/net10.0/publish/</PublishDir>
    <PublishProtocol>FileSystem</PublishProtocol>
    <_TargetId>Folder</_TargetId>
    <TargetFramework>net10.0</TargetFramework>
    <SelfContained>false</SelfContained>
  </PropertyGroup>
</Project>
`);
        expect(parseProfile(xml, '/p/FolderProfile.pubxml').settings).toEqual(settings);
    });

    it('changes only the settings that changed and keeps everything else in the file', () => {
        const changed = applySettings(visualStudioProfile, {
            ...parseProfile(visualStudioProfile, '/p/FolderProfile.pubxml').settings,
            runtimeIdentifier: 'linux-x64',
            selfContained: true,
            singleFile: true,
            targetFramework: 'net10.0',
        });

        expect(changed).toContain('<ProjectGuid>6d4b1c8e-0000-4000-8000-000000000001</ProjectGuid>');
        expect(changed).toContain('https://go.microsoft.com/fwlink/?LinkID=208121.');
        expect(changed).toContain('    <TargetFramework>net10.0</TargetFramework>\n');
        expect(changed).toContain('    <SelfContained>true</SelfContained>\n');
        expect(changed).toContain('    <RuntimeIdentifier>linux-x64</RuntimeIdentifier>\n');
        expect(changed).toContain('    <PublishSingleFile>true</PublishSingleFile>\n');
        expect(changed).not.toContain('PublishReadyToRun');

        // Back to portable: the runtime goes, and so do the options that need one
        const portable = applySettings(changed, { ...parseProfile(changed, '/p/x.pubxml').settings, runtimeIdentifier: undefined, singleFile: false });
        expect(portable).not.toContain('RuntimeIdentifier');
        expect(portable).not.toContain('PublishSingleFile');
    });

    it("resolves the publish folder against the project, also with Visual Studio's backslashes", () => {
        expect(publishDirOf('/repo/Web/Web.csproj', 'bin\\Release\\net8.0\\publish\\')).toBe(path.resolve('/repo/Web', 'bin', 'Release', 'net8.0', 'publish'));
        expect(publishDirOf('/repo/Web/Web.csproj', '/srv/www/web/')).toBe(path.resolve('/srv/www/web'));
    });

    it('names new profiles like Visual Studio: FolderProfile, FolderProfile1, ...', () => {
        expect(newProfileName([])).toBe('FolderProfile');
        expect(newProfileName(['FolderProfile'])).toBe('FolderProfile1');
        expect(newProfileName(['FolderProfile', 'FolderProfile1'])).toBe('FolderProfile2');
    });

    it('lists the profiles of a project', () => {
        const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'publish-')));
        try {
            const dir = path.join(root, 'Properties', 'PublishProfiles');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'FolderProfile.pubxml'), visualStudioProfile);
            fs.writeFileSync(path.join(dir, 'FolderProfile.pubxml.user'), '<Project />');
            fs.writeFileSync(path.join(dir, 'Azure.pubxml'), '<Project><PropertyGroup><WebPublishMethod>ZipDeploy</WebPublishMethod></PropertyGroup></Project>');

            expect(listProfiles(path.join(root, 'Web.csproj')).map(profile => `${profile.name}: ${profile.target}`)).toEqual(['Azure: ZipDeploy', 'FolderProfile: Folder']);
            expect(listProfiles(path.join(root, 'Missing', 'X.csproj'))).toEqual([]);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('publishDirOverride', () => {
    it('gives the folder of a profile that names it only as PublishUrl (an older Visual Studio), resolved against the project', () => {
        const xml = '<Project>\n  <PropertyGroup>\n    <PublishUrl>bin\\Release\\net10.0\\vs-publish\\</PublishUrl>\n    <WebPublishMethod>FileSystem</WebPublishMethod>\n  </PropertyGroup>\n</Project>';
        expect(publishDirOverride(xml, path.join(path.sep, 'repo', 'Web'))).toBe(path.join(path.sep, 'repo', 'Web', 'bin', 'Release', 'net10.0', 'vs-publish'));
    });

    it('nothing when the profile has a PublishDir (dotnet publish reads that) or no folder', () => {
        expect(publishDirOverride('<PublishDir>out\\</PublishDir><PublishUrl>other\\</PublishUrl>', '/repo/Web')).toBeUndefined();
        expect(publishDirOverride('<Project />', '/repo/Web')).toBeUndefined();
    });
});

describe('clearPublishFolder (Delete all existing files prior to publish)', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-clear-')); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('empties the publish folder and keeps it', async () => {
        const project = path.join(dir, 'Web', 'Web.csproj');
        const out = path.join(dir, 'Web', 'bin', 'publish');
        fs.mkdirSync(path.join(out, 'wwwroot'), { recursive: true });
        fs.writeFileSync(path.join(out, 'stale.dll'), '');
        fs.writeFileSync(path.join(out, 'wwwroot', 'old.js'), '');
        expect(await clearPublishFolder(out, project, path.join(dir, 'home'))).toBe(true);
        expect(fs.existsSync(out)).toBe(true);
        expect(fs.readdirSync(out)).toEqual([]);
    });

    it('refuses a folder that holds the project, and the home folder', async () => {
        const project = path.join(dir, 'Web', 'Web.csproj');
        fs.mkdirSync(path.join(dir, 'Web'), { recursive: true });
        fs.writeFileSync(project, '<Project />');
        expect(await clearPublishFolder(path.join(dir, 'Web'), project, path.join(dir, 'home'))).toBe(false);
        expect(await clearPublishFolder(dir, project, path.join(dir, 'home'))).toBe(false);
        expect(fs.existsSync(project)).toBe(true);
        expect(await clearPublishFolder(path.join(dir, 'home'), project, path.join(dir, 'home'))).toBe(false);
    });
});

describe('profileNameProblem (review A6-4)', () => {
    it('accepts a normal name and keeping the current one (any case)', () => {
        expect(profileNameProblem('Staging EU', 'FolderProfile', ['folderprofile'])).toBeUndefined();
        expect(profileNameProblem('FOLDERPROFILE', 'FolderProfile', ['folderprofile'])).toBeUndefined();
    });

    it('refuses what MSBuild splits on and what file names cannot hold', () => {
        for (const bad of ['Test;1', 'A,B', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a|b']) {
            expect(profileNameProblem(bad, 'Old', [])).toEqual(expect.any(String));
        }
        expect(profileNameProblem('   ', 'Old', [])).toBe('Enter a name');
    });

    it('refuses a name another profile has', () => {
        expect(profileNameProblem('Prod', 'Old', ['old', 'prod'])).toBe('A profile with that name exists');
    });
});
