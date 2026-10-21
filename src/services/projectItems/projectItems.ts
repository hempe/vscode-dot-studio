import * as path from 'path';

/**
 * Item types whose files belong to the project. A file in none of them counts as excluded, so the list
 * is wide: Razor, WPF, gRPC and the like would otherwise disappear from the tree.
 */
export const ITEM_TYPES = [
    'Compile', 'None', 'Content', 'EmbeddedResource', 'Page', 'Resource', 'ApplicationDefinition', 'SplashScreen',
    'AdditionalFiles', 'RazorComponent', 'RazorGenerate', 'Protobuf',
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

/** What MSBuild evaluates a project to contain */
export class ProjectItems {
    private readonly byFullPath = new Map<string, Entry>();
    private readonly entries: readonly Entry[];

    constructor(readonly projectDir: string, entries: readonly Entry[]) {
        this.entries = entries;
        for (const entry of entries) {
            this.byFullPath.set(path.normalize(entry.fullPath), entry);
        }
    }

    isIncluded(fullPath: string): boolean {
        return this.byFullPath.has(path.normalize(fullPath));
    }

    itemTypeOf(fullPath: string): string | undefined {
        return this.byFullPath.get(path.normalize(fullPath))?.itemType;
    }

    /** Whether a file lies under the folder as the tree shows it (linked files at their link path) */
    hasIncludedUnder(folder: string): boolean {
        const prefix = path.normalize(folder) + path.sep;
        return this.entries.some(entry => entry.virtualPath.startsWith(prefix));
    }

    /** The item types of the files under the folder, for excluding all of them */
    itemTypesUnder(folder: string): string[] {
        const prefix = path.normalize(folder) + path.sep;
        return [...new Set(this.entries.filter(entry => entry.fullPath.startsWith(prefix)).map(entry => entry.itemType))];
    }

    /** Linked files shown directly in the folder */
    linkedFilesIn(folder: string): LinkedItem[] {
        const normalized = path.normalize(folder);
        return this.entries
            .filter(entry => entry.linked && path.dirname(entry.virtualPath) === normalized)
            .map(({ fullPath, virtualPath, itemType }) => ({ fullPath, virtualPath, itemType }));
    }

    /** Names of the folders below `folder` that only exist because of links */
    linkedFoldersIn(folder: string): string[] {
        const prefix = path.normalize(folder) + path.sep;
        const names = new Set<string>();
        for (const entry of this.entries) {
            if (entry.linked && entry.virtualPath.startsWith(prefix)) {
                const rest = entry.virtualPath.slice(prefix.length);
                const separator = rest.indexOf(path.sep);
                if (separator > 0) {
                    names.add(rest.slice(0, separator));
                }
            }
        }
        return [...names];
    }
}

interface MsbuildItem { FullPath?: string; Identity?: string; Link?: string }

/** Reads the output of `dotnet msbuild -getItem:...`; undefined when it is not the JSON result */
export function parseMsbuildItems(output: string, projectDir: string): ProjectItems | undefined {
    const start = output.indexOf('{');
    if (start < 0) {
        return undefined;
    }
    let parsed: { Items?: Record<string, MsbuildItem[]> };
    try {
        parsed = JSON.parse(output.slice(start));
    } catch {
        return undefined;
    }
    const entries: Entry[] = [];
    for (const [itemType, items] of Object.entries(parsed.Items ?? {})) {
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
