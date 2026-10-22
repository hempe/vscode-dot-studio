import * as path from 'path';
import { PackageEdit } from './centralPackageEdits';
import { CentralEntry, ProjectPackages, centralFiles, packageVersionFileFor } from './centralPackages';
import { pathKey } from '../projectItems/projectItems';

/**
 * Plans what a package change writes under Central Package Management, without touching anything: which files get
 * which edits, which projects still go through the dotnet CLI (no CPM, or not evaluated), and which other projects a
 * shared change reaches (they are named in the confirmation). Pure: the host runs the plan (centralPackageOperations).
 */

/** A project of the solution as the plans see it */
export interface ProjectState {
    readonly name: string;
    readonly path: string;
    /** undefined: MSBuild could not evaluate it; handled like a project without CPM (the CLI) */
    readonly packages?: ProjectPackages;
}

/** Install or update one package to one version in the selected projects */
export interface VersionChangePlan {
    readonly id: string;
    readonly version: string;
    /** Projects without CPM: `dotnet add package --version`, as before */
    readonly cliProjects: readonly string[];
    readonly edits: readonly PackageEdit[];
    /** Names of projects that were not selected but whose version changes with a central or global edit */
    readonly alsoChanges: readonly string[];
    /** The props files of those shared edits */
    readonly sharedFiles: readonly string[];
    /** The shared change can be replaced by "Set for this project only" (central versions, overrides allowed) */
    readonly canOverride: boolean;
}

/** `shared`: change the central version (what CPM is for); `project`: a VersionOverride in each selected project */
export type VersionScope = 'shared' | 'project';

const lower = (id: string) => id.toLowerCase();
const fileKey = (file: string) => pathKey(path.normalize(file));
const same = (a: string | undefined, b: string | undefined) => !!a && !!b && fileKey(a) === fileKey(b);
const referenceOf = (packages: ProjectPackages | undefined, id: string) => packages?.references.find(reference => lower(reference.id) === lower(id));

/** Projects (not in `except`) whose version of `id` is written in `file` as a central or global entry */
function usersOf(states: readonly ProjectState[], id: string, file: string, except: ReadonlySet<string>): string[] {
    return states
        .filter(state => !except.has(state.path))
        .filter(state => {
            const reference = referenceOf(state.packages, id);
            return (reference?.source === 'central' || reference?.source === 'global') && same(reference.versionFile, file);
        })
        .map(state => state.name);
}

/**
 * @param declaredGlobals the GlobalPackageReference entries written in the props files of the project (from the text):
 * when every project opted out of a global package, no evaluation shows it
 */
export function planVersionChange(
    id: string, version: string, selected: readonly string[], states: readonly ProjectState[], scope: VersionScope = 'shared',
    declaredGlobals: (packages: ProjectPackages) => readonly CentralEntry[] = () => [],
): VersionChangePlan {
    const selectedSet = new Set(selected);
    const cliProjects: string[] = [];
    const edits: PackageEdit[] = [];
    const shared = new Map<string, PackageEdit>();
    let overridable = true;
    const share = (edit: PackageEdit) => {
        const key = `${edit.kind}|${fileKey(edit.file)}|${lower(edit.id)}`;
        if (!shared.has(key)) {
            shared.set(key, edit);
            edits.push(edit);
        }
    };

    for (const projectPath of selected) {
        const packages = states.find(state => state.path === projectPath)?.packages;
        const reference = referenceOf(packages, id);
        if (!packages?.centrallyManaged || reference?.source === 'project') {
            cliProjects.push(projectPath);
            continue;
        }
        if (reference?.source === 'global') {
            if (reference.version !== version) {
                share({ kind: 'setGlobalPackageVersion', file: reference.versionFile!, id, version });
            }
            overridable = false;
            continue;
        }
        const central = packages.centralVersions.get(lower(id));
        if (reference?.source === 'override') {
            edits.push(central?.version === version
                ? { kind: 'removeVersionOverride', file: projectPath, id }
                : { kind: 'setVersionOverride', file: projectPath, id, version });
            continue;
        }
        // A global package the project opted out of: installing it takes the opt-out back
        const global = states.map(state => state.packages?.globals.find(entry => lower(entry.id) === lower(id)))
            .find(entry => entry && centralFiles(packages).some(file => same(file, entry.file)))
            ?? declaredGlobals(packages).find(entry => lower(entry.id) === lower(id));
        if (global) {
            edits.push({ kind: 'removeGlobalOptOut', file: projectPath, id });
            if (global.version !== version) {
                share({ kind: 'setGlobalPackageVersion', file: global.file, id, version });
            }
            overridable = false;
            continue;
        }
        if (!reference) {
            edits.push({ kind: 'addPackageReference', file: projectPath, id });
        }
        if (!central) {
            share({ kind: 'addPackageVersion', file: packageVersionFileFor(packages)!, id, version });
        } else if (central.version !== version) {
            if (scope === 'project' && packages.overridesEnabled) {
                edits.push({ kind: 'setVersionOverride', file: projectPath, id, version });
            } else {
                // A VersionOverride needs the PackageReference in the project file itself
                overridable &&= packages.overridesEnabled && !reference?.inherited;
                share({ kind: 'setPackageVersion', file: central.file, id, version });
            }
        }
    }

    const sharedEdits = [...shared.values()].filter(edit => edit.kind === 'setPackageVersion' || edit.kind === 'setGlobalPackageVersion');
    const sharedFiles = [...new Set(sharedEdits.map(edit => edit.file))];
    const alsoChanges = [...new Set(sharedFiles.flatMap(file => usersOf(states, id, file, selectedSet)))].sort();
    return {
        id, version, cliProjects, edits, alsoChanges, sharedFiles,
        canOverride: overridable && sharedEdits.some(edit => edit.kind === 'setPackageVersion'),
    };
}

/** Uninstall one package from the selected projects */
export interface UninstallPlan {
    readonly id: string;
    /** `dotnet remove package` (a PackageReference in the project file, with or without CPM) */
    readonly cliProjects: readonly string[];
    /** The global package, when a selected project gets it through a GlobalPackageReference */
    readonly global?: {
        readonly file: string;
        /** The selected projects that get it */
        readonly selected: readonly string[];
        /** Names of all projects that get it */
        readonly appliesTo: readonly string[];
    };
    /** Central versions no project of the solution uses after the removal (the UI asks before removing them) */
    readonly orphanedVersions: readonly { readonly file: string; readonly id: string }[];
}

export function planUninstall(id: string, selected: readonly string[], states: readonly ProjectState[]): UninstallPlan {
    const cliProjects: string[] = [];
    const globalSelected: string[] = [];
    let globalFile: string | undefined;
    for (const projectPath of selected) {
        const reference = referenceOf(states.find(state => state.path === projectPath)?.packages, id);
        if (reference?.source === 'global') {
            globalSelected.push(projectPath);
            globalFile ??= reference.versionFile;
        } else {
            cliProjects.push(projectPath);
        }
    }

    const removed = new Set(cliProjects);
    const orphanedVersions: { file: string; id: string }[] = [];
    // A multi-targeted project was evaluated for its first framework only, and one that could not be evaluated not at
    // all: either may still use the version (removing it breaks the restore with NU1010), so no orphan is reported
    const unsure = states.some(state => !state.packages || state.packages.multiTargeted);
    for (const projectPath of unsure ? [] : cliProjects) {
        const packages = states.find(state => state.path === projectPath)?.packages;
        const central = packages?.centrallyManaged ? packages.centralVersions.get(lower(id)) : undefined;
        if (!central || orphanedVersions.some(orphan => same(orphan.file, central.file))) {
            continue;
        }
        const stillUsed = states.some(state => !removed.has(state.path) && state.packages?.centrallyManaged
            && !!referenceOf(state.packages, id) && same(state.packages.centralVersions.get(lower(id))?.file, central.file));
        if (!stillUsed) {
            orphanedVersions.push({ file: central.file, id: central.id });
        }
    }

    return {
        id,
        cliProjects,
        orphanedVersions,
        ...(globalFile ? { global: { file: globalFile, selected: globalSelected, appliesTo: usersOf(states, id, globalFile, new Set()).sort() } } : {}),
    };
}

/**
 * The edits of a global uninstall: `all` removes the GlobalPackageReference (and opt-outs left in the projects that
 * share the props file); `selected` adds an opt-out to each selected project
 */
export function globalUninstallEdits(plan: UninstallPlan, choice: 'all' | 'selected', states: readonly ProjectState[]): PackageEdit[] {
    const global = plan.global;
    if (!global) {
        return [];
    }
    if (choice === 'selected') {
        return global.selected.map(file => ({ kind: 'addGlobalOptOut' as const, file, id: plan.id }));
    }
    const sharing = states.filter(state => state.packages?.centrallyManaged && centralFiles(state.packages).some(file => same(file, global.file)));
    return [
        { kind: 'removeGlobalPackageReference', file: global.file, id: plan.id },
        ...sharing.map(state => ({ kind: 'removeGlobalOptOut' as const, file: state.path, id: plan.id })),
    ];
}

/** The confirmation of shared changes; undefined when no plan reaches projects beyond the selected ones */
export function confirmationText(plans: readonly VersionChangePlan[]): { message: string; detail: string } | undefined {
    const reaching = plans.filter(plan => plan.alsoChanges.length > 0);
    if (reaching.length === 0) {
        return undefined;
    }
    const line = (plan: VersionChangePlan) =>
        `${plan.id} ${plan.version} (${plan.sharedFiles.map(file => path.basename(file)).join(', ')}): also ${plan.alsoChanges.join(', ')}`;
    if (reaching.length === 1) {
        const [plan] = reaching;
        return {
            message: `Change ${plan.id} to ${plan.version} for every project that uses it?`,
            detail: `The version is set centrally in ${plan.sharedFiles.map(file => path.basename(file)).join(', ')}, so it also changes for ${plan.alsoChanges.join(', ')}.`,
        };
    }
    return {
        message: `Change the central versions of ${reaching.length} packages?`,
        detail: `They are set centrally, so other projects change too:\n${reaching.map(line).join('\n')}`,
    };
}

/** Consolidate one package to one version in every project of the solution that uses it */
export interface ConsolidatePlan {
    readonly id: string;
    readonly version: string;
    /** Projects without CPM whose version differs: `dotnet add package --version`, as before */
    readonly cliProjects: readonly string[];
    readonly edits: readonly PackageEdit[];
    /** What the edits do, one line each, for the confirmation */
    readonly changes: readonly string[];
}

/**
 * Under CPM the versions differ through VersionOverrides (or central versions of different props files): the central
 * and global versions are set to the chosen one and the overrides removed. Projects without CPM keep today's way.
 */
export function planConsolidate(id: string, version: string, states: readonly ProjectState[]): ConsolidatePlan {
    const cliProjects: string[] = [];
    const edits: PackageEdit[] = [];
    const changes: string[] = [];
    const seen = new Set<string>();
    for (const state of states) {
        const reference = referenceOf(state.packages, id);
        if (!reference) {
            continue;
        }
        if (!state.packages?.centrallyManaged || reference.source === 'project') {
            if (reference.version !== version) {
                cliProjects.push(state.path);
            }
        } else if (reference.source === 'override') {
            edits.push({ kind: 'removeVersionOverride', file: state.path, id });
            changes.push(`${state.name}: VersionOverride ${reference.version} removed`);
        }
        const central = reference.source === 'global' ? { version: reference.version, file: reference.versionFile }
            : state.packages?.centrallyManaged ? state.packages.centralVersions.get(lower(id)) : undefined;
        if (central?.file && central.version !== version && !seen.has(fileKey(central.file))) {
            seen.add(fileKey(central.file));
            edits.push(reference.source === 'global'
                ? { kind: 'setGlobalPackageVersion', file: central.file, id, version }
                : { kind: 'setPackageVersion', file: central.file, id, version });
            changes.push(`${path.basename(central.file)}: ${central.version} → ${version}`);
        }
    }
    return { id, version, cliProjects, edits, changes };
}

/** The confirmation of a consolidation under CPM; undefined when it edits no CPM file */
export function consolidationText(plans: readonly ConsolidatePlan[]): { message: string; detail: string } | undefined {
    const central = plans.filter(plan => plan.changes.length > 0);
    if (central.length === 0) {
        return undefined;
    }
    return {
        message: central.length === 1
            ? `Consolidate ${central[0].id} to ${central[0].version}?`
            : `Consolidate ${central.length} packages?`,
        detail: central.map(plan => [`${plan.id} ${plan.version}:`, ...plan.changes.map(change => `  ${change}`)].join('\n')).join('\n'),
    };
}
