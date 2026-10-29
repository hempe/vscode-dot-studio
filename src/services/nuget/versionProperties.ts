import * as path from 'path';
import { PackageEdit, packagesUsingProperty, propertyDefinitions, propertyReference, propertyUseCount, writtenVersion } from './centralPackageEdits';
import { ProjectState } from './centralPackagePlan';
import { pathKey } from '../project/items/projectItems';

/**
 * Central versions written as an MSBuild property (`<PackageVersion Include="Serilog" Version="$(SerilogVersion)" />`):
 * changing the version edits the property's definition, so the package keeps following it, instead of writing a
 * literal over the reference (what `dotnet add package` does, checked with SDK 10.0.111). The definition is looked
 * for where MSBuild reads it before the versions: `Directory.Build.props`, `Directory.Packages.props` and the files
 * they import, the last unconditional one winning, and it is only edited when its value is the version MSBuild
 * evaluated for every project that uses the entry. Pure: files come through `read` and `chain`.
 */

/** An edit of a central (`PackageVersion`) or global (`GlobalPackageReference`) version */
type VersionEdit = PackageEdit & { readonly kind: 'setPackageVersion' | 'setGlobalPackageVersion'; readonly id: string; readonly version: string };

/** Why the property cannot be edited for the change */
export type PropertyRefusal = 'notFound' | 'conditional' | 'differs' | 'conflict';

export interface VersionProperty {
    /** The edit that would write a literal over `$(property)` */
    readonly edit: VersionEdit;
    readonly property: string;
    /** The file whose definition is edited; undefined when it cannot be (see `refusal`) */
    readonly definition?: string;
    readonly refusal?: PropertyRefusal;
    /** Other packages whose version is the property, not changed to the same version by this change */
    readonly alsoPackages: readonly string[];
    /** The projects that use those packages */
    readonly alsoProjects: readonly string[];
    /** Uses of `$(property)` that are no package version */
    readonly otherUses: number;
}

const lower = (text: string) => text.toLowerCase();
const fileKey = (file: string) => pathKey(path.normalize(file));
const isVersionEdit = (edit: PackageEdit): edit is VersionEdit => edit.kind === 'setPackageVersion' || edit.kind === 'setGlobalPackageVersion';

/** The projects whose version of the package comes from the entry in `file` */
function usersOfEntry(states: readonly ProjectState[], edit: VersionEdit): ProjectState[] {
    return states.filter(state => {
        const packages = state.packages;
        const entry = edit.kind === 'setPackageVersion'
            ? packages?.centralVersions.get(lower(edit.id))
            : packages?.globals.find(global => lower(global.id) === lower(edit.id));
        return !!entry && fileKey(entry.file) === fileKey(edit.file);
    });
}

/** The version MSBuild evaluated for the entry in a project */
function evaluatedVersion(state: ProjectState, edit: VersionEdit): string | undefined {
    return edit.kind === 'setPackageVersion'
        ? state.packages?.centralVersions.get(lower(edit.id))?.version
        : state.packages?.globals.find(global => lower(global.id) === lower(edit.id))?.version;
}

/**
 * The version edits of a change whose entry is written as `$(property)`, with where the property can be changed and
 * what else follows it. Edits of literal versions are not listed.
 * @param read the text of a file, undefined when it cannot be read
 * @param chain a props file and the files it imports, in MSBuild's order (importChain)
 */
export function findVersionProperties(
    edits: readonly PackageEdit[], states: readonly ProjectState[], read: (file: string) => string | undefined, chain: (file: string) => string[],
): VersionProperty[] {
    const found: Omit<VersionProperty, 'alsoPackages' | 'alsoProjects'>[] = [];
    const scanned = new Map<string, string[]>();
    for (const edit of edits.filter(isVersionEdit)) {
        const content = read(edit.file);
        const property = content === undefined ? undefined
            : propertyReference(writtenVersion(content, edit.kind === 'setPackageVersion' ? 'PackageVersion' : 'GlobalPackageReference', edit.id));
        if (!property) {
            continue;
        }
        const users = usersOfEntry(states, edit);
        // Directory.Build.props is imported before Directory.Packages.props: a later definition wins
        const files: string[] = [];
        for (const state of users) {
            for (const file of [...(state.packages?.buildPropsPath ? chain(state.packages.buildPropsPath) : []), ...(state.packages?.propsPath ? chain(state.packages.propsPath) : [])]) {
                if (!files.some(known => fileKey(known) === fileKey(file))) {
                    files.push(file);
                }
            }
        }
        if (!files.some(known => fileKey(known) === fileKey(edit.file))) {
            files.push(edit.file);
        }
        scanned.set(`${fileKey(edit.file)}|${lower(property)}`, [...files, ...states.map(state => state.path)]);
        const definitions = files.flatMap(file => propertyDefinitions(read(file) ?? '', property).map(definition => ({ file, definition })));
        const last = definitions[definitions.length - 1];
        // A project file's own definition comes after the props files and would win for that project
        const inProject = users.some(state => propertyDefinitions(read(state.path) ?? '', property).length > 0);
        const refusal: PropertyRefusal | undefined = !last ? 'notFound'
            : definitions.some(candidate => candidate.definition.conditional) ? 'conditional'
            : inProject || users.some(state => evaluatedVersion(state, edit) !== last.definition.value) ? 'differs'
            : undefined;
        const otherUses = files.reduce((count, file) => {
            const text = read(file) ?? '';
            return count + propertyUseCount(text, property) - packagesUsingProperty(text, property).length;
        }, 0);
        found.push({ edit, property, ...(refusal ? { refusal } : { definition: last.file }), otherUses });
    }

    return found.map(entry => {
        // Other changes of this operation that follow the same definition, and whether they agree on the version
        const same = found.filter(other => other.definition && entry.definition && fileKey(other.definition) === fileKey(entry.definition)
            && lower(other.property) === lower(entry.property));
        const conflict = same.some(other => other.edit.version !== entry.edit.version);
        const changing = new Set(same.map(other => lower(other.edit.id)));
        const files = scanned.get(`${fileKey(entry.edit.file)}|${lower(entry.property)}`) ?? [];
        const alsoPackages = [...new Map(files.flatMap(file => packagesUsingProperty(read(file) ?? '', entry.property))
            .filter(id => lower(id) !== lower(entry.edit.id) && !changing.has(lower(id)))
            .map(id => [lower(id), id] as const)).values()].sort((a, b) => a.localeCompare(b));
        const alsoProjects = states
            .filter(state => state.packages?.references.some(reference => alsoPackages.some(id => lower(id) === lower(reference.id))))
            .map(state => state.name).sort();
        const refused = conflict ? { refusal: 'conflict' as const, definition: undefined } : {};
        return { ...entry, ...refused, alsoPackages, alsoProjects };
    }).map(({ definition, ...rest }) => definition ? { ...rest, definition } : rest);
}

/** The edit that changes the property instead of writing a literal */
export function propertyEdit(entry: VersionProperty): PackageEdit {
    return { kind: 'setVersionProperty', file: entry.definition!, property: entry.property, version: entry.edit.version };
}

/** Whether the property can simply be changed: nothing else follows it */
export function changesOnlyItself(entry: VersionProperty): boolean {
    return !!entry.definition && entry.alsoPackages.length === 0 && entry.otherUses === 0;
}

const REFUSALS: Record<PropertyRefusal, (entry: VersionProperty) => string> = {
    notFound: entry => `${entry.property} is not defined in Directory.Build.props, Directory.Packages.props or a file they import.`,
    conditional: entry => `${entry.property} is set under a condition.`,
    differs: entry => `${entry.property} gets another value later (in a project file or another props file).`,
    conflict: entry => `Other packages that follow ${entry.property} get other versions in this change.`,
};

/**
 * The question for a property other packages follow, or that cannot be changed: changing the property (named with
 * what else follows it) or setting the package alone, which writes a literal version
 */
export function propertyQuestion(entry: VersionProperty): { message: string; detail: string; change?: string; only: string } {
    const { id, version } = entry.edit;
    const only = `Set ${id} Only`;
    const alone = `${only} writes ${version} instead of $(${entry.property}): ${id} no longer follows it.`;
    if (!entry.definition) {
        return {
            message: `${id}'s version is $(${entry.property}), which cannot be changed here.`,
            detail: `${REFUSALS[entry.refusal ?? 'notFound'](entry)} ${alone}`,
            only,
        };
    }
    const others = [
        ...(entry.alsoPackages.length > 0 ? [`${entry.alsoPackages.join(', ')}${entry.alsoProjects.length > 0 ? ` (used by ${entry.alsoProjects.join(', ')})` : ''}`] : []),
        ...(entry.otherUses > 0 ? [`${entry.otherUses} other use${entry.otherUses === 1 ? '' : 's'} of $(${entry.property})`] : []),
    ];
    return {
        message: `${id}'s version is $(${entry.property}), which ${entry.alsoPackages.length > 0 ? 'other packages follow too' : 'is used elsewhere too'}.`,
        detail: `Change ${entry.property} to ${version} in ${path.basename(entry.definition)}: this also changes ${others.join(' and ')}. ${alone}`,
        change: `Change ${entry.property}`,
        only,
    };
}
