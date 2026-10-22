import type { InstalledPackage, PackageVersionSource, ProjectInfo } from '../../services/nuget/types';
import type { LocalNuGetPackage } from './shared';

/**
 * How the NuGet manager shows versions under Central Package Management. Browser-safe: types only, no Node modules
 * (the extension host works out the sources, see services/nuget/centralPackages.ts).
 */

interface Versioned {
    readonly currentVersion: string;
    readonly versionSource?: PackageVersionSource;
}

/** `v3.1.1`, `v13.0.2 (override)`, `v8.0.0 (global)`; an unknown version (no evaluation) is said to be unknown */
export function versionLabel(pkg: Versioned): string {
    if (!pkg.currentVersion) {
        return 'version not known';
    }
    const source = pkg.versionSource === 'override' || pkg.versionSource === 'global' ? ` (${pkg.versionSource})` : '';
    return `v${pkg.currentVersion}${source}`;
}

/** The package's entry in each project that has it */
function entries(pkg: LocalNuGetPackage, projects: readonly ProjectInfo[] | null | undefined): { project: ProjectInfo; entry: InstalledPackage }[] {
    return (projects ?? []).flatMap(project => {
        const entry = project.packages?.find(candidate => candidate.id.toLowerCase() === pkg.id.toLowerCase());
        return entry ? [{ project, entry }] : [];
    });
}

/** A GlobalPackageReference: every project gets it (the list shows a "global" badge) */
export function isGlobal(pkg: LocalNuGetPackage, projects?: readonly ProjectInfo[] | null): boolean {
    return pkg.versionSource === 'global' || entries(pkg, projects).some(({ entry }) => entry.versionSource === 'global');
}

const fileName = (file: string | undefined) => file?.split(/[\\/]/).pop() ?? 'Directory.Packages.props';

/**
 * The details pane's note on where the version comes from, or undefined without CPM. The solution context names the
 * projects that share a central version; the project context only knows its own project.
 */
export function centralNote(pkg: LocalNuGetPackage, projects: readonly ProjectInfo[] | null | undefined): string | undefined {
    const found = entries(pkg, projects);
    const global = found.find(({ entry }) => entry.versionSource === 'global');
    if (global) {
        return `Global package (GlobalPackageReference in ${fileName(global.entry.versionFile)}): every project gets it. Uninstall removes it for all projects or for the selected ones only.`;
    }
    const central = found.filter(({ entry }) => entry.versionSource === 'central');
    const overrides = found.filter(({ entry }) => entry.versionSource === 'override');
    if (central.length === 0 && overrides.length === 0) {
        return undefined;
    }
    const parts: string[] = [];
    if (central.length > 0) {
        const shared = found.length > 1 || (projects?.length ?? 0) > 1;
        parts.push(`Version set centrally in ${fileName(central[0].entry.versionFile)}${shared ? `, used by ${central.map(({ project }) => project.name).join(', ')}` : ''}.`
            + ' A new version changes it for every project that uses it (you are asked first); Set for This Project Only writes a VersionOverride instead.');
    }
    if (overrides.length > 0) {
        parts.push(`${overrides.map(({ project }) => project.name).join(', ')} ${overrides.length === 1 ? 'sets its' : 'set their'} own version (VersionOverride).`);
    }
    return parts.join(' ');
}

/**
 * "Set for this project only" fits when every selected project takes the package's version from a central entry (or
 * overrides it) with the PackageReference in its own project file (one from Directory.Build.props has no element there
 * for a VersionOverride)
 */
export function canSetForProjectOnly(pkg: LocalNuGetPackage, projects: readonly ProjectInfo[] | null | undefined, selected: ReadonlySet<string>): boolean {
    const found = entries(pkg, projects).filter(({ project }) => selected.has(project.path));
    return selected.size > 0 && found.length === selected.size
        && found.every(({ entry }) => (entry.versionSource === 'central' || entry.versionSource === 'override') && !entry.inherited);
}
