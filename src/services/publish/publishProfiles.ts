import * as fs from 'fs';
import * as path from 'path';

/** The settings of a Folder publish profile, as Visual Studio's publish settings dialog shows them */
export interface FolderSettings {
    readonly configuration: string;
    readonly targetFramework?: string;
    /** As written in the profile, relative to the project or absolute */
    readonly publishDir: string;
    /** Deployment mode: self-contained, else framework-dependent */
    readonly selfContained: boolean;
    /** Target runtime; none is "Portable" */
    readonly runtimeIdentifier?: string;
    readonly singleFile: boolean;
    readonly readyToRun: boolean;
    readonly trimmed: boolean;
    readonly deleteExistingFiles: boolean;
}

export interface PublishProfile {
    readonly name: string;
    /** The .pubxml file */
    readonly path: string;
    /** `Folder`, or Visual Studio's publish method of other targets (ZipDeploy, MSDeploy, FTP, ...) */
    readonly target: string;
    readonly settings: FolderSettings;
}

const unescape = (value: string) => value.replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function property(xml: string, name: string): string | undefined {
    const value = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];
    return value === undefined ? undefined : unescape(value.trim());
}

const isTrue = (value: string | undefined) => value?.toLowerCase() === 'true';

export function parseProfile(xml: string, profilePath: string): PublishProfile {
    const method = property(xml, 'WebPublishMethod');
    const isFolder = !method || method === 'FileSystem';
    return {
        name: path.basename(profilePath, '.pubxml'),
        path: profilePath,
        target: isFolder ? 'Folder' : method,
        settings: {
            configuration: property(xml, 'Configuration') || 'Release',
            targetFramework: property(xml, 'TargetFramework') || undefined,
            // Older Visual Studio versions wrote the folder as PublishUrl
            publishDir: property(xml, 'PublishDir') ?? property(xml, 'PublishUrl') ?? '',
            selfContained: isTrue(property(xml, 'SelfContained')),
            runtimeIdentifier: property(xml, 'RuntimeIdentifier') || undefined,
            singleFile: isTrue(property(xml, 'PublishSingleFile')),
            readyToRun: isTrue(property(xml, 'PublishReadyToRun')),
            trimmed: isTrue(property(xml, 'PublishTrimmed')),
            deleteExistingFiles: isTrue(property(xml, 'DeleteExistingFiles')),
        },
    };
}

/** Sets a property in the profile (removes it for `undefined`), keeping everything else as it is */
function setProperty(xml: string, name: string, value: string | undefined): string {
    const existing = new RegExp(`([ \\t]*)<${name}>[^<]*</${name}>[ \\t]*(\\r?\\n)?`).exec(xml);
    if (existing) {
        const replacement = value === undefined ? '' : `${existing[1]}<${name}>${escape(value)}</${name}>${existing[2] ?? ''}`;
        return xml.slice(0, existing.index) + replacement + xml.slice(existing.index + existing[0].length);
    }
    if (value === undefined) {
        return xml;
    }
    const groupEnd = /([ \t]*)<\/PropertyGroup>/.exec(xml);
    if (!groupEnd) {
        throw new Error('The publish profile has no PropertyGroup');
    }
    const nl = xml.includes('\r\n') ? '\r\n' : '\n';
    const sibling = /\n([ \t]*)<\w/.exec(xml.slice(xml.indexOf('<PropertyGroup')))?.[1] ?? `${groupEnd[1]}  `;
    return xml.slice(0, groupEnd.index) + `${sibling}<${name}>${escape(value)}</${name}>${nl}` + xml.slice(groupEnd.index);
}

/** Writes the settings into a profile; options that are off are left out, as Visual Studio does */
export function applySettings(xml: string, settings: FolderSettings): string {
    const flag = (on: boolean) => on ? 'true' : undefined;
    const properties: [string, string | undefined][] = [
        ['Configuration', settings.configuration],
        ['PublishDir', settings.publishDir],
        ['TargetFramework', settings.targetFramework],
        ['SelfContained', settings.selfContained ? 'true' : 'false'],
        ['RuntimeIdentifier', settings.runtimeIdentifier],
        ['PublishSingleFile', flag(settings.singleFile)],
        ['PublishReadyToRun', flag(settings.readyToRun)],
        ['PublishTrimmed', flag(settings.trimmed)],
        ['DeleteExistingFiles', flag(settings.deleteExistingFiles)],
    ];
    return properties.reduce((result, [name, value]) => setProperty(result, name, value), xml);
}

/** A new Folder profile in the format Visual Studio 2022 writes */
export function folderProfileXml(settings: FolderSettings): string {
    const template = `<?xml version="1.0" encoding="utf-8"?>
<!--
https://go.microsoft.com/fwlink/?LinkID=208121.
-->
<Project>
  <PropertyGroup>
    <Configuration></Configuration>
    <Platform>Any CPU</Platform>
    <PublishDir></PublishDir>
    <PublishProtocol>FileSystem</PublishProtocol>
    <_TargetId>Folder</_TargetId>
    <TargetFramework></TargetFramework>
    <SelfContained></SelfContained>
  </PropertyGroup>
</Project>
`;
    return applySettings(template, settings);
}

/** Visual Studio's defaults for a new Folder profile */
export function defaultFolderSettings(targetFramework: string | undefined): FolderSettings {
    return {
        configuration: 'Release',
        targetFramework,
        publishDir: targetFramework ? `bin/Release/${targetFramework}/publish/` : 'bin/Release/publish/',
        selfContained: false,
        singleFile: false,
        readyToRun: false,
        trimmed: false,
        deleteExistingFiles: false,
    };
}

/** The publish folder on disk; profiles may use Visual Studio's backslashes */
export function publishDirOf(projectPath: string, publishDir: string): string {
    return path.resolve(path.dirname(projectPath), publishDir.replace(/\\/g, '/'));
}

/** FolderProfile, then FolderProfile1, FolderProfile2, ... like Visual Studio */
export function newProfileName(existing: readonly string[]): string {
    const taken = new Set(existing.map(name => name.toLowerCase()));
    let name = 'FolderProfile';
    for (let i = 1; taken.has(name.toLowerCase()); i++) {
        name = `FolderProfile${i}`;
    }
    return name;
}

export function profilesFolder(projectPath: string): string {
    return path.join(path.dirname(projectPath), 'Properties', 'PublishProfiles');
}

/** The publish profiles of a project (`Properties/PublishProfiles/*.pubxml`), sorted by name */
export function listProfiles(projectPath: string): PublishProfile[] {
    const folder = profilesFolder(projectPath);
    let files: string[];
    try {
        files = fs.readdirSync(folder).filter(file => file.toLowerCase().endsWith('.pubxml'));
    } catch {
        return [];
    }
    return files
        .map(file => parseProfile(fs.readFileSync(path.join(folder, file), 'utf8'), path.join(folder, file)))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Why `value` cannot be the new name of a publish profile, or undefined. `;` and `,` split `-property:PublishProfile=<name>`
 * (MSB1006), the others cannot be in a file name.
 */
export function profileNameProblem(value: string, currentName: string, takenNames: readonly string[]): string | undefined {
    const name = value.trim();
    if (!name) {
        return 'Enter a name';
    }
    if (/[\\/:*?"<>|;,]/.test(name)) {
        return 'The name can\'t contain \\ / : * ? " < > | ; ,';
    }
    if (name.toLowerCase() !== currentName.toLowerCase() && takenNames.map(taken => taken.toLowerCase()).includes(name.toLowerCase())) {
        return 'A profile with that name exists';
    }
    return undefined;
}
