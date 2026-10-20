import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    applySettings, defaultFolderSettings, folderProfileXml, listProfiles, newProfileName, parseProfile, publishDirOf,
} from '../../../../services/publish/publishProfiles';

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

    it('recognizes profiles of other targets (Visual Studio teammates), which publish later (Phase 31)', () => {
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
        expect(publishDirOf('/repo/Web/Web.csproj', 'bin\\Release\\net8.0\\publish\\')).toBe(path.join('/repo/Web', 'bin', 'Release', 'net8.0', 'publish'));
        expect(publishDirOf('/repo/Web/Web.csproj', '/srv/www/web/')).toBe(path.join('/srv/www/web'));
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
