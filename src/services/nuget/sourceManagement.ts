import * as fs from 'fs';
import * as path from 'path';
import { execDotnet } from './dotnetCli';
import { nugetConfigFiles } from './nugetCredentials';
import { configStartDir } from './feedAuth';
import { PackageBrowseService } from './packageBrowseService';
import { NuGetV3Service } from './nugetV3Service';
import { ManagedSource } from './types';

const unquote = (value: string) => value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/** The first of the config files (closest first, as NuGet reads them) that adds a source with this name to `packageSources` */
export function definingFile(files: readonly { path: string; content: string }[], name: string): string | undefined {
    for (const file of files) {
        const section = /<packageSources\b[^>]*>([\s\S]*?)<\/packageSources\s*>/i.exec(file.content.replace(/<!--[\s\S]*?-->/g, ''));
        const found = section && [...section[1].matchAll(/<add\b([^>]*?)\/?>/gi)].some(add => {
            const key = /\bkey\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(add[1]);
            return !!key && unquote(key[1] ?? key[2]).toLowerCase() === name.toLowerCase();
        });
        if (found) {
            return file.path;
        }
    }
    return undefined;
}

/** Why a new source cannot be added, or undefined */
export function sourceProblem(name: string, url: string, existing: readonly string[]): string | undefined {
    if (!name.trim()) {
        return 'Enter a name';
    }
    if (existing.some(known => known.toLowerCase() === name.trim().toLowerCase())) {
        return `A source named ${name.trim()} exists`;
    }
    if (!url.trim()) {
        return 'Enter the address of the feed (an https:// URL to its index.json, or a folder)';
    }
    return /^https?:\/\//i.test(url.trim()) || path.isAbsolute(url.trim()) ? undefined : 'Use an https:// URL or the full path of a folder';
}

export type SourceLocation = 'user' | 'solution';

/** `dotnet nuget add source`; `configFile` undefined: the user's NuGet.Config */
export function addSourceArgs(name: string, url: string, configFile?: string): string[] {
    return ['nuget', 'add', 'source', url.trim(), '--name', name.trim(), ...(configFile ? ['--configfile', configFile] : [])];
}

export function removeSourceArgs(name: string, configFile?: string): string[] {
    return ['nuget', 'remove', 'source', name, ...(configFile ? ['--configfile', configFile] : [])];
}

/** Enabling and disabling go to the user's config, which overrides the others (disabledPackageSources) */
export function enableSourceArgs(name: string, enabled: boolean): string[] {
    return ['nuget', enabled ? 'enable' : 'disable', 'source', name];
}

/** The sources as `dotnet nuget list source` reports them, with the config file that adds each */
export async function listManagedSources(startDir = configStartDir()): Promise<ManagedSource[]> {
    const files = nugetConfigFiles(startDir).map(file => {
        try {
            return { path: file, content: fs.readFileSync(file, 'utf8') };
        } catch {
            return { path: file, content: '' };
        }
    });
    return (await PackageBrowseService.getPackageSources()).map(source => ({
        name: source.name, url: source.url, enabled: source.enabled, file: definingFile(files, source.name),
    }));
}

async function run(args: string[], cwd: string): Promise<void> {
    try {
        await execDotnet(args, { cwd, timeout: 60000 });
    } catch (error) {
        const output = error as { stdout?: string; stderr?: string; message?: string };
        throw new Error((output.stderr || output.stdout || output.message || 'dotnet nuget failed').trim().split(/\r?\n/).slice(-3).join(' '));
    }
}

/** Adds a source to the user's NuGet.Config, or to `nuget.config` next to the solution (created when missing) */
export async function addSource(name: string, url: string, location: SourceLocation, startDir = configStartDir()): Promise<void> {
    let configFile: string | undefined;
    if (location === 'solution') {
        configFile = path.join(startDir, 'nuget.config');
        if (!fs.existsSync(configFile)) {
            fs.writeFileSync(configFile, '<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n</configuration>\n');
        }
    }
    await run(addSourceArgs(name, url, configFile), startDir);
    await NuGetV3Service.clearCaches();
}

/** Removes the source from the config file that adds it */
export async function removeSource(name: string, startDir = configStartDir()): Promise<void> {
    const sources = await listManagedSources(startDir);
    const file = sources.find(source => source.name === name)?.file;
    await run(removeSourceArgs(name, file), startDir);
    await NuGetV3Service.clearCaches();
}

export async function setSourceEnabled(name: string, enabled: boolean, startDir = configStartDir()): Promise<void> {
    await run(enableSourceArgs(name, enabled), startDir);
    await NuGetV3Service.clearCaches();
}
