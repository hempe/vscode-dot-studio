import * as path from 'path';
import { parseMsbuildJson, pathKey } from '../project/items/projectItems';
import { PackageVersionSource } from './types';

/** Asked of MSBuild together with the project items: one evaluation per project answers both */
export const PACKAGE_PROPERTIES = ['ManagePackageVersionsCentrally', 'DirectoryPackagesPropsPath', 'CentralPackageVersionOverrideEnabled', 'DirectoryBuildPropsPath'] as const;
export const PACKAGE_ITEM_TYPES = ['PackageReference', 'PackageVersion', 'GlobalPackageReference'] as const;

/** A package the project references, with the version MSBuild gives it and where that version is written */
export interface PackageReferenceInfo {
    readonly id: string;
    /** The effective version; '' when there is none (CPM without a PackageVersion for it) */
    readonly version: string;
    readonly source: PackageVersionSource;
    /** The file the version is written in: the project file (project, override) or a props file (central, global) */
    readonly versionFile?: string;
    /**
     * The PackageReference is written in a props file (Directory.Build.props), not in the project file: "Set for this
     * project only" has no element of the project to put a VersionOverride on
     */
    readonly inherited?: true;
}

/** A `PackageVersion` or `GlobalPackageReference` entry and the props file it is in */
export interface CentralEntry {
    readonly id: string;
    readonly version: string;
    readonly file: string;
}

/** What MSBuild says about a project's packages */
export interface ProjectPackages {
    readonly projectPath: string;
    /** `ManagePackageVersionsCentrally` is true for the project */
    readonly centrallyManaged: boolean;
    /** The `Directory.Packages.props` MSBuild picked (also set when the project turned CPM off) */
    readonly propsPath?: string;
    /** The `Directory.Build.props` MSBuild imported, if any: properties used as versions may be defined there */
    readonly buildPropsPath?: string;
    /** `CentralPackageVersionOverrideEnabled` is not false: "Set for this project only" may write a VersionOverride */
    readonly overridesEnabled: boolean;
    /**
     * `TargetFrameworks` names more than one framework: only the first was evaluated, so the packages of the others
     * (conditional references and versions) are not seen
     */
    readonly multiTargeted: boolean;
    /** Sorted by id; SDK references (`IsImplicitlyDefined`) left out */
    readonly references: readonly PackageReferenceInfo[];
    /** The `PackageVersion` entries the project sees, by lower-case id (CPM only; global ones not included) */
    readonly centralVersions: ReadonlyMap<string, CentralEntry>;
    /** The `GlobalPackageReference` entries the project gets (CPM only; opted-out ones are missing) */
    readonly globals: readonly CentralEntry[];
}

interface MsbuildPackageItem {
    readonly Identity?: string;
    readonly Version?: string;
    readonly VersionOverride?: string;
    readonly DefiningProjectFullPath?: string;
    readonly IsImplicitlyDefined?: string;
}

const isTrue = (value: string | undefined) => (value ?? '').trim().toLowerCase() === 'true';
const isFalse = (value: string | undefined) => (value ?? '').trim().toLowerCase() === 'false';
const definedIn = (item: MsbuildPackageItem) => item.DefiningProjectFullPath ? path.normalize(item.DefiningProjectFullPath) : '';

/**
 * Reads the packages from the output of the evaluation (`-getProperty` with PACKAGE_PROPERTIES, `-getItem` with
 * PACKAGE_ITEM_TYPES); undefined when the output has no properties (not asked, or not the JSON result).
 */
export function parseMsbuildPackages(output: string, projectPath: string): ProjectPackages | undefined {
    const parsed = parseMsbuildJson(output);
    const properties = parsed?.Properties;
    if (!properties || !('ManagePackageVersionsCentrally' in properties)) {
        return undefined;
    }
    const items = (parsed.Items ?? {}) as unknown as Record<string, MsbuildPackageItem[] | undefined>;
    const centrallyManaged = isTrue(properties.ManagePackageVersionsCentrally);
    const entry = (item: MsbuildPackageItem): CentralEntry => ({ id: item.Identity!, version: item.Version ?? '', file: definedIn(item) });

    const globals = centrallyManaged ? (items.GlobalPackageReference ?? []).filter(item => item.Identity).map(entry) : [];
    const globalById = new Map(globals.map(global => [global.id.toLowerCase(), global]));
    const centralVersions = new Map<string, CentralEntry>();
    if (centrallyManaged) {
        for (const item of items.PackageVersion ?? []) {
            // A global reference also makes a PackageVersion, defined in the SDK's NuGet.targets: not an entry of ours
            if (item.Identity && !globalById.has(item.Identity.toLowerCase())) {
                centralVersions.set(item.Identity.toLowerCase(), entry(item));
            }
        }
    }

    const references: PackageReferenceInfo[] = [];
    for (const item of items.PackageReference ?? []) {
        if (!item.Identity || isTrue(item.IsImplicitlyDefined)) {
            continue;
        }
        const key = item.Identity.toLowerCase();
        const global = globalById.get(key);
        const central = centralVersions.get(key);
        const inherited = definedIn(item) && pathKey(definedIn(item)) !== pathKey(path.normalize(projectPath)) ? { inherited: true as const } : {};
        if (global) {
            references.push({ id: global.id, version: global.version, source: 'global', versionFile: global.file });
        } else if (centrallyManaged && item.VersionOverride) {
            references.push({ id: item.Identity, version: item.VersionOverride, source: 'override', versionFile: definedIn(item), ...inherited });
        } else if (centrallyManaged && !item.Version) {
            references.push({ id: item.Identity, version: central?.version ?? '', source: 'central', versionFile: central?.file, ...inherited });
        } else {
            references.push({ id: item.Identity, version: item.Version ?? '', source: 'project', versionFile: definedIn(item), ...inherited });
        }
    }
    references.sort((a, b) => a.id.localeCompare(b.id, undefined, { sensitivity: 'base' }));

    return {
        projectPath,
        centrallyManaged,
        propsPath: properties.DirectoryPackagesPropsPath ? path.normalize(properties.DirectoryPackagesPropsPath) : undefined,
        ...(properties.DirectoryBuildPropsPath?.trim() ? { buildPropsPath: path.normalize(properties.DirectoryBuildPropsPath.trim()) } : {}),
        overridesEnabled: !isFalse(properties.CentralPackageVersionOverrideEnabled),
        multiTargeted: (properties.TargetFrameworks ?? '').split(';').filter(framework => framework.trim()).length > 1,
        references,
        centralVersions,
        globals,
    };
}

const comparable = (packages: ProjectPackages) => JSON.stringify({
    ...packages,
    centralVersions: [...packages.centralVersions.entries()].sort(([a], [b]) => a.localeCompare(b)),
});

/** Whether two evaluations say the same about the packages (a new one that does not changes nothing on screen) */
export function packagesEqual(a: ProjectPackages, b: ProjectPackages): boolean {
    return comparable(a) === comparable(b);
}

/** The props files the project's central versions come from: `Directory.Packages.props` and every file defining an entry */
export function centralFiles(packages: ProjectPackages): string[] {
    if (!packages.centrallyManaged) {
        return [];
    }
    const files = [packages.propsPath, ...[...packages.centralVersions.values()].map(entry => entry.file), ...packages.globals.map(entry => entry.file)];
    return [...new Set(files.filter((file): file is string => !!file))];
}

/**
 * Where a new `PackageVersion` goes: the `Directory.Packages.props` MSBuild picked when it holds entries (or no file
 * does), else the props file that holds the most of them (an imported one that keeps the versions).
 */
export function packageVersionFileFor(packages: ProjectPackages): string | undefined {
    const counts = new Map<string, number>();
    for (const entry of packages.centralVersions.values()) {
        counts.set(entry.file, (counts.get(entry.file) ?? 0) + 1);
    }
    if (packages.propsPath && (counts.size === 0 || counts.has(packages.propsPath))) {
        return packages.propsPath;
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? packages.propsPath;
}
