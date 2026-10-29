import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ITEM_TYPES, crossTargetingFramework, parseMsbuildJson, pathKey } from './projectItems';

const execFileAsync = promisify(execFile);

/**
 * Metadata the SDK's own default items carry that decide what goes to the output and publish folders (the Web SDK
 * sets them on its `Content` globs, e.g. `CopyToPublishDirectory` on `*.cshtml` and `wwwroot/**`,
 * `CopyToOutputDirectory` too on `*.json`). An explicit `Include` gets none of it, so Include In Project writes it.
 */
export const KEPT_METADATA = ['CopyToOutputDirectory', 'CopyToPublishDirectory', 'ExcludeFromSingleFile'] as const;

/** What an `Include` for a file gets: the item type and the metadata of the SDK's default item */
export interface NewItem {
    readonly itemType: string;
    readonly metadata: Readonly<Record<string, string>>;
}

/** Runs `dotnet msbuild <project> -nologo <args>` and gives its output; replaced in tests */
export type RunMsbuildWith = (projectPath: string, args: readonly string[]) => Promise<string>;

const runDotnetMsbuild: RunMsbuildWith = async (projectPath, args) => (await execFileAsync('dotnet',
    ['msbuild', projectPath, '-nologo', ...args],
    { cwd: path.dirname(projectPath), timeout: 120000, maxBuffer: 64 * 1024 * 1024 })).stdout;

/**
 * Folders still left out while asking for the default items: Include In Project never adds files from them (see
 * `listFilesUnder`), and listing `node_modules` or the build output would only make the evaluation slow. A global
 * property is taken literally (no `$(BaseOutputPath)`), so the usual folder names are written out. Quoted: MSBuild
 * splits an unquoted `-property:` value at `;` into several properties (MSB1006).
 */
const STILL_EXCLUDED = '"bin/**;obj/**;**/node_modules/**"';

/** The type of a file several item types list: what it is built as, not the `None` other globs may give it too */
function primaryType(types: readonly string[]): string | undefined {
    const ordered = (ITEM_TYPES as readonly string[]).filter(type => types.includes(type));
    return ordered.find(type => type !== 'None') ?? ordered[0];
}

/** Reads the output of the evaluation of itemsWithoutExcludes; undefined when it is not the JSON result */
export function parseNewItems(output: string, projectDir: string): Map<string, NewItem> | undefined {
    const parsed = parseMsbuildJson(output);
    if (!parsed) {
        return undefined;
    }
    const byFile = new Map<string, Map<string, Readonly<Record<string, string | undefined>>>>();
    for (const [itemType, items] of Object.entries(parsed.Items ?? {})) {
        if (!(ITEM_TYPES as readonly string[]).includes(itemType)) {
            continue;
        }
        for (const item of items as unknown as Readonly<Record<string, string | undefined>>[]) {
            const fullPath = item.FullPath ?? (item.Identity ? path.resolve(projectDir, item.Identity) : undefined);
            // A linked item is a file outside the folder: not what Include In Project adds
            if (!fullPath || item.Link?.trim()) {
                continue;
            }
            const key = pathKey(path.normalize(fullPath));
            const types = byFile.get(key) ?? new Map<string, Readonly<Record<string, string | undefined>>>();
            if (!types.has(itemType)) {
                types.set(itemType, item);
            }
            byFile.set(key, types);
        }
    }
    const result = new Map<string, NewItem>();
    for (const [key, types] of byFile) {
        const itemType = primaryType([...types.keys()])!;
        const item = types.get(itemType)!;
        const metadata: Record<string, string> = {};
        for (const name of KEPT_METADATA) {
            const value = item[name]?.trim();
            if (value) {
                metadata[name] = value;
            }
        }
        result.set(key, { itemType, metadata });
    }
    return result;
}

/**
 * The items MSBuild would give the project's files if `DefaultItemExcludes` left nothing out: the SDK's own globs
 * decide the type (`Content` for Razor and web files in a Web SDK project, `EmbeddedResource` for `.resx`, `Compile`
 * for `.cs`) and the output metadata. One evaluation with `DefaultItemExcludes` as a global property, which overrides
 * what the project and its props files set; a multi-targeted project is evaluated for its first framework, as the
 * tree is. Keyed by `pathKey(path.normalize(file))`; undefined when MSBuild fails.
 */
export async function itemsWithoutExcludes(projectPath: string, run: RunMsbuildWith = runDotnetMsbuild): Promise<Map<string, NewItem> | undefined> {
    const args = [`-getItem:${ITEM_TYPES.join(',')}`, '-getProperty:TargetFramework,TargetFrameworks', `-property:DefaultItemExcludes=${STILL_EXCLUDED}`];
    try {
        const output = await run(projectPath, args);
        const framework = crossTargetingFramework(output);
        return parseNewItems(framework ? await run(projectPath, [...args, `-property:TargetFramework=${framework}`]) : output, path.dirname(projectPath));
    } catch {
        return undefined;
    }
}

/** The item for a file, from MSBuild's answer; without one (MSBuild failed, or no glob of the SDK takes the file) by its extension */
export function newItemFor(file: string, items: ReadonlyMap<string, NewItem> | undefined): NewItem {
    return items?.get(pathKey(path.normalize(file))) ?? { itemType: fallbackItemType(file), metadata: {} };
}

/** C# files are compiled, resources embedded, everything else `None`: the SDK's choice outside the Web SDK */
function fallbackItemType(file: string): string {
    switch (path.extname(file).toLowerCase()) {
        case '.cs': return 'Compile';
        case '.resx': return 'EmbeddedResource';
        default: return 'None';
    }
}
