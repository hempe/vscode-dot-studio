import * as path from 'path';

/**
 * Item types whose files belong to the project. A file in none of them counts as excluded, so the list
 * is wide: Razor, WPF, gRPC and the like would otherwise disappear from the tree. A type no project uses
 * costs nothing (MSBuild lists it empty).
 * - Visual Studio's build actions: changing one writes `<None Remove="x" /><Type Include="x" />`, so the file
 *   is then only in that type (CodeAnalysisDictionary ... TypeScriptCompile).
 * - Types packages move files to, out of `None`/`Content`: Microsoft.Maui.Controls (`*.xaml` to MauiXaml,
 *   `*.css` to MauiCss), Microsoft.WindowsAppSDK (`*.resw` to PRIResource); MAUI resources from the template.
 * Not listed on purpose: Watch (dotnet watch only), Folder (folders, shown from disk), EditorConfigFiles and
 * Analyzer (their files are also None, or lie outside the project).
 */
export const ITEM_TYPES = [
    'Compile', 'None', 'Content', 'EmbeddedResource', 'Page', 'Resource', 'ApplicationDefinition', 'SplashScreen',
    'AdditionalFiles', 'RazorComponent', 'RazorGenerate', 'Protobuf',
    'CodeAnalysisDictionary', 'DesignData', 'DesignDataWithDesignTimeCreatableTypes', 'EntityDeploy', 'Fakes', 'Shadow',
    'XamlAppDef', 'TypeScriptCompile',
    'MauiXaml', 'MauiCss', 'MauiImage', 'MauiIcon', 'MauiSplashScreen', 'MauiFont', 'MauiAsset', 'PRIResource',
] as const;

export interface LinkedItem {
    /** The file on disk, outside the project folder */
    readonly fullPath: string;
    /** Where the tree shows it, absolute (project folder + `Link`) */
    readonly virtualPath: string;
    readonly itemType: string;
}

interface Entry {
    readonly fullPath: string;
    readonly virtualPath: string;
    readonly itemType: string;
    readonly linked: boolean;
}

/** The key paths are compared by: lowercased where the file system ignores case (Windows, macOS) */
export function pathKey(p: string, platform: string = process.platform): string {
    return platform === 'win32' || platform === 'darwin' ? p.toLowerCase() : p;
}

const key = (p: string) => pathKey(path.normalize(p));

function typeRank(itemType: string): number {
    const index = (ITEM_TYPES as readonly string[]).indexOf(itemType);
    return index < 0 ? ITEM_TYPES.length : index;
}

/** What MSBuild evaluates a project to contain */
export class ProjectItems {
    /** Per file, its entries ordered by ITEM_TYPES */
    private readonly byFullPath = new Map<string, Entry[]>();
    private readonly entries: readonly Entry[];
    private readonly fullKeys: readonly string[];
    private readonly virtualKeys: readonly string[];

    constructor(readonly projectDir: string, entries: readonly Entry[]) {
        this.entries = entries;
        this.fullKeys = entries.map(entry => key(entry.fullPath));
        this.virtualKeys = entries.map(entry => key(entry.virtualPath));
        entries.forEach((entry, index) => {
            const list = this.byFullPath.get(this.fullKeys[index]);
            if (list) {
                list.push(entry);
            } else {
                this.byFullPath.set(this.fullKeys[index], [entry]);
            }
        });
        for (const list of this.byFullPath.values()) {
            list.sort((a, b) => typeRank(a.itemType) - typeRank(b.itemType));
        }
    }

    /** Whether both list the same entries in the same order */
    equals(other: ProjectItems): boolean {
        return this.projectDir === other.projectDir && this.entries.length === other.entries.length
            && this.entries.every((entry, index) => {
                const theirs = other.entries[index];
                return entry.fullPath === theirs.fullPath && entry.virtualPath === theirs.virtualPath
                    && entry.itemType === theirs.itemType && entry.linked === theirs.linked;
            });
    }

    isIncluded(fullPath: string): boolean {
        return this.byFullPath.has(key(fullPath));
    }

    /** The file's item type; the first in ITEM_TYPES order when it is listed under several */
    itemTypeOf(fullPath: string): string | undefined {
        return this.byFullPath.get(key(fullPath))?.[0].itemType;
    }

    /** All item types of the file, in ITEM_TYPES order */
    itemTypesOf(fullPath: string): string[] {
        return [...new Set((this.byFullPath.get(key(fullPath)) ?? []).map(entry => entry.itemType))];
    }

    /** Whether a file lies under the folder as the tree shows it (linked files at their link path) */
    hasIncludedUnder(folder: string): boolean {
        const prefix = key(folder) + path.sep;
        return this.virtualKeys.some(virtualKey => virtualKey.startsWith(prefix));
    }

    /** Whether a linked file is shown under the folder (at any depth) */
    hasLinkedUnder(folder: string): boolean {
        const prefix = key(folder) + path.sep;
        return this.entries.some((entry, index) => entry.linked && this.virtualKeys[index].startsWith(prefix));
    }

    /** The item types of the files under the folder, for excluding all of them */
    itemTypesUnder(folder: string): string[] {
        const prefix = key(folder) + path.sep;
        const types = new Set(this.entries.filter((_, index) => this.fullKeys[index].startsWith(prefix)).map(entry => entry.itemType));
        return [...types].sort((a, b) => typeRank(a) - typeRank(b));
    }

    /** Linked files shown directly in the folder */
    linkedFilesIn(folder: string): LinkedItem[] {
        const normalized = key(folder);
        const seen = new Set<string>();
        const result: LinkedItem[] = [];
        this.entries.forEach((entry, index) => {
            if (entry.linked && key(path.dirname(entry.virtualPath)) === normalized && !seen.has(this.virtualKeys[index])) {
                seen.add(this.virtualKeys[index]);
                result.push({ fullPath: entry.fullPath, virtualPath: entry.virtualPath, itemType: entry.itemType });
            }
        });
        return result;
    }

    /** Names of the folders below `folder` that only exist because of links */
    linkedFoldersIn(folder: string): string[] {
        const prefix = key(folder) + path.sep;
        const names = new Map<string, string>();
        this.entries.forEach((entry, index) => {
            if (entry.linked && this.virtualKeys[index].startsWith(prefix)) {
                const rest = path.normalize(entry.virtualPath).slice(prefix.length);
                const separator = rest.indexOf(path.sep);
                if (separator > 0) {
                    const name = rest.slice(0, separator);
                    if (!names.has(pathKey(name))) {
                        names.set(pathKey(name), name);
                    }
                }
            }
        });
        return [...names.values()];
    }
}

interface MsbuildItem { FullPath?: string; Identity?: string; Link?: string }

export interface MsbuildResult { Items?: Record<string, MsbuildItem[]>; Properties?: Record<string, string> }

/** The JSON MSBuild prints for `-getItem`/`-getProperty`, after any banner lines; undefined when there is none */
export function parseMsbuildJson(output: string): MsbuildResult | undefined {
    const match = /^[ \t]*\{/m.exec(output);
    if (!match) {
        return undefined;
    }
    try {
        return JSON.parse(output.slice(match.index + match[0].length - 1));
    } catch {
        return undefined;
    }
}

/**
 * A multi-targeted project (`TargetFrameworks`, no `TargetFramework`) evaluated as a whole has no default items:
 * the SDK only adds them per target framework. Given the output of `-getProperty:TargetFramework,TargetFrameworks`,
 * returns the framework to evaluate instead (the first, Visual Studio's active one), or undefined when not needed.
 */
export function crossTargetingFramework(output: string): string | undefined {
    const properties = parseMsbuildJson(output)?.Properties;
    if (!properties || properties.TargetFramework?.trim()) {
        return undefined;
    }
    return (properties.TargetFrameworks ?? '').split(';').map(framework => framework.trim()).find(framework => framework);
}

/** Reads the output of `dotnet msbuild -getItem:...`; undefined when it is not the JSON result */
export function parseMsbuildItems(output: string, projectDir: string): ProjectItems | undefined {
    const parsed = parseMsbuildJson(output);
    if (!parsed) {
        return undefined;
    }
    const entries: Entry[] = [];
    for (const [itemType, items] of Object.entries(parsed.Items ?? {})) {
        // The same evaluation lists packages (PackageReference has a FullPath too): only files count
        if (!(ITEM_TYPES as readonly string[]).includes(itemType)) {
            continue;
        }
        for (const item of items) {
            const fullPath = item.FullPath ?? (item.Identity ? path.resolve(projectDir, item.Identity) : undefined);
            if (!fullPath) {
                continue;
            }
            const link = item.Link?.replace(/[\\/]/g, path.sep);
            entries.push({
                fullPath,
                virtualPath: link ? path.resolve(projectDir, link) : fullPath,
                itemType,
                linked: !!link,
            });
        }
    }
    return new ProjectItems(projectDir, entries);
}
