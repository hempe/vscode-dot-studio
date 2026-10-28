import * as fs from 'fs';
import * as path from 'path';
import { PackageSource } from './types';
import { xmlAttribute } from './configXml';

/**
 * The solution-level `.nuget/NuGet.Config` of the Visual Studio era: Visual Studio reads it, `dotnet restore` and the other
 * NuGet command line tools do not (they read `nuget.config` in the solution folder and its parents, and the user config).
 */

const entryNamed = (dir: string, wanted: string, directory: boolean): string | undefined => {
    try {
        const entry = fs.readdirSync(dir, { withFileTypes: true }).find(item => item.name.toLowerCase() === wanted && (directory ? item.isDirectory() : item.isFile()));
        return entry ? path.join(dir, entry.name) : undefined;
    } catch {
        return undefined;
    }
};

/** `.nuget/NuGet.Config` in the solution folder, in any case, or undefined */
export function legacyConfigPath(solutionDir: string): string | undefined {
    const folder = entryNamed(solutionDir, '.nuget', true);
    return folder ? entryNamed(folder, 'nuget.config', false) : undefined;
}

/** Whether the solution has the legacy file and no `nuget.config` next to it, so `dotnet restore` does not see its feeds */
export function needsLegacyConfigMove(solutionDir: string): boolean {
    return !!legacyConfigPath(solutionDir) && !entryNamed(solutionDir, 'nuget.config', false);
}

/** The package sources a NuGet.Config lists (`packageSources`, minus `disabledPackageSources`), in file order */
export function legacyConfigSources(content: string): PackageSource[] {
    const withoutComments = content.replace(/<!--[\s\S]*?-->/g, '');
    const section = /<packageSources\b[^>]*>([\s\S]*?)<\/packageSources>/i.exec(withoutComments)?.[1] ?? '';
    const disabled = new Set(
        [...(/<disabledPackageSources\b[^>]*>([\s\S]*?)<\/disabledPackageSources>/i.exec(withoutComments)?.[1] ?? '').matchAll(/<add\b[^>]*>/gi)]
            .filter(add => /\bvalue\s*=\s*["']true["']/i.test(add[0]))
            .map(add => xmlAttribute(add[0], 'key')?.toLowerCase())
    );
    const sources: PackageSource[] = [];
    for (const add of section.matchAll(/<add\b[^>]*>/gi)) {
        const name = xmlAttribute(add[0], 'key');
        const url = xmlAttribute(add[0], 'value');
        if (name && url) {
            sources.push({ name, url, enabled: !disabled.has(name.toLowerCase()), isLocal: !/^https?:\/\//i.test(url) });
        }
    }
    return sources;
}

/** The sources the CLI lists plus those of the legacy file that it does not (matched by name or url), as Visual Studio would show them */
export function applyLegacyConfig(listed: PackageSource[], solutionDir: string): PackageSource[] {
    const file = needsLegacyConfigMove(solutionDir) ? legacyConfigPath(solutionDir) : undefined;
    if (!file) {
        return listed;
    }
    let extra: PackageSource[];
    try {
        extra = legacyConfigSources(fs.readFileSync(file, 'utf8'));
    } catch {
        return listed;
    }
    const known = (source: PackageSource) => listed.some(other => other.name.toLowerCase() === source.name.toLowerCase() || other.url === source.url);
    return [...listed, ...extra.filter(source => !known(source))];
}

/** Puts the legacy file where `dotnet` reads it: `nuget.config` in the solution folder (`move` removes the old file, `copy` keeps it) */
export function moveLegacyConfig(solutionDir: string, mode: 'move' | 'copy'): string {
    const from = legacyConfigPath(solutionDir);
    if (!from) {
        throw new Error('There is no .nuget/NuGet.Config next to the solution.');
    }
    if (entryNamed(solutionDir, 'nuget.config', false)) {
        throw new Error('A nuget.config already exists in the solution folder.');
    }
    const to = path.join(solutionDir, 'nuget.config');
    fs.copyFileSync(from, to);
    if (mode === 'move') {
        fs.rmSync(from);
    }
    return to;
}
