import * as fs from 'fs';
import * as path from 'path';
import { VersionUtils } from '../shared/versionUtils';

/** The packages a project uses for one framework, as restore resolved them (`obj/project.assets.json`) */
export interface PackageGraph {
    readonly framework: string;
    /** Packages the project references itself */
    readonly direct: string[];
    /** By lower-case package id: its id, resolved version and the ids of the packages it depends on */
    readonly packages: Map<string, { readonly id: string; readonly version: string; readonly dependencies: string[] }>;
}

export interface ResolvedPackage {
    readonly id: string;
    readonly version: string;
}

/**
 * Reads the package graph of a framework from project.assets.json; the first framework when none is
 * given or the project doesn't target it. Runtime-specific graphs (`net10.0/linux-x64`) are left out.
 */
export function parsePackageGraph(assetsJson: string, framework?: string): PackageGraph | undefined {
    let assets: any;
    try {
        assets = JSON.parse(assetsJson);
    } catch {
        return undefined;
    }
    const frameworks = Object.keys(assets?.project?.frameworks ?? {});
    const targetKeys = Object.keys(assets?.targets ?? {}).filter(key => !key.includes('/'));
    if (targetKeys.length === 0) {
        return undefined;
    }
    const alias = framework && frameworks.includes(framework) ? framework : frameworks[0];
    // The targets are keyed by alias (net10.0) in current SDKs, by full name in older ones; same order
    const targetKey = targetKeys.includes(alias) ? alias : targetKeys[Math.max(0, frameworks.indexOf(alias))];

    const packages: PackageGraph['packages'] = new Map();
    for (const [key, entry] of Object.entries<any>(assets.targets[targetKey] ?? {})) {
        if (entry?.type !== 'package') {
            continue;
        }
        const slash = key.lastIndexOf('/');
        const id = key.slice(0, slash);
        packages.set(id.toLowerCase(), { id, version: key.slice(slash + 1), dependencies: Object.keys(entry.dependencies ?? {}) });
    }

    return {
        framework: alias ?? targetKey,
        direct: Object.keys(assets.project?.frameworks?.[alias]?.dependencies ?? {}),
        packages,
    };
}

/** The packages a package depends on, with the versions restore picked */
export function packageDependencies(graph: PackageGraph, id: string): ResolvedPackage[] {
    return (graph.packages.get(id.toLowerCase())?.dependencies ?? []).flatMap(dependency => {
        const resolved = graph.packages.get(dependency.toLowerCase());
        return resolved ? [{ id: resolved.id, version: resolved.version }] : [];
    });
}

/**
 * Visual Studio's "Transitively referenced by": for every package the project doesn't reference itself
 * (by lower-case id), the direct references that bring it in
 */
export function transitiveReferrers(graph: PackageGraph): Map<string, string[]> {
    const directIds = new Set(graph.direct.map(id => id.toLowerCase()));
    const referrers = new Map<string, string[]>();
    for (const direct of graph.direct) {
        const seen = new Set<string>();
        const visit = (id: string) => {
            for (const dependency of graph.packages.get(id.toLowerCase())?.dependencies ?? []) {
                const key = dependency.toLowerCase();
                if (seen.has(key) || !graph.packages.has(key)) {
                    continue;
                }
                seen.add(key);
                if (!directIds.has(key)) {
                    referrers.set(key, [...(referrers.get(key) ?? []), direct]);
                }
                visit(key);
            }
        };
        visit(direct);
    }
    return referrers;
}

const cache = new Map<string, { mtime: number; graph: PackageGraph | undefined }>();

/** The package graph of a project after its last restore; undefined before the first one */
export function readPackageGraph(projectPath: string, framework?: string): PackageGraph | undefined {
    const assetsPath = path.join(path.dirname(projectPath), 'obj', 'project.assets.json');
    let mtime: number;
    try {
        mtime = fs.statSync(assetsPath).mtimeMs;
    } catch {
        return undefined;
    }
    const key = `${projectPath}|${framework ?? ''}`;
    const cached = cache.get(key);
    if (cached?.mtime === mtime) {
        return cached.graph;
    }
    const graph = parsePackageGraph(fs.readFileSync(assetsPath, 'utf8'), framework);
    cache.set(key, { mtime, graph });
    return graph;
}

export interface TransitivePackage<P> {
    readonly id: string;
    /** The highest version restore resolved across the projects */
    readonly currentVersion: string;
    /** Projects that get the package through others */
    readonly projects: P[];
    /** The top-level packages that bring it in; with the project's name when there are several projects */
    readonly transitiveReferencedBy: string[];
}

/**
 * The NuGet manager's "Transitive packages", like Visual Studio's: packages the projects only get through
 * other packages, sorted by id. A package that any project references itself is a top-level package instead.
 */
export function collectTransitivePackages<P>(projects: readonly { project: P & { name: string }; graph: PackageGraph }[]): TransitivePackage<P>[] {
    const direct = new Set(projects.flatMap(({ graph }) => graph.direct.map(id => id.toLowerCase())));
    const byId = new Map<string, { id: string; currentVersion: string; projects: P[]; transitiveReferencedBy: string[] }>();
    for (const { project, graph } of projects) {
        for (const [key, referrers] of transitiveReferrers(graph)) {
            if (direct.has(key)) {
                continue;
            }
            const resolved = graph.packages.get(key)!;
            const entry = byId.get(key) ?? { id: resolved.id, currentVersion: resolved.version, projects: [], transitiveReferencedBy: [] };
            if (VersionUtils.compare(resolved.version, entry.currentVersion) < 0) {
                entry.currentVersion = resolved.version;
            }
            entry.projects.push(project);
            entry.transitiveReferencedBy.push(...referrers.map(referrer => projects.length > 1 ? `${referrer} (${project.name})` : referrer));
            byId.set(key, entry);
        }
    }
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
