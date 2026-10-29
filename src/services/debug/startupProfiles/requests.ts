import { StartupProfile, StartupProject } from './slnLaunch';
import type { ProfileSource } from './startupChoice';
import { StartupProfileEntry, StartupProjectsRequest } from '../../../types/startupProjects';

/** The profiles of the shared and the user file as read; `error` when a file exists but could not be read */
export type ProfileFiles = Record<ProfileSource, { profiles: readonly StartupProfile[]; error?: string }>;

/** What a request changes: files to write in this order, and the profile to make active (none after a delete) */
export interface ProfilePlan {
    writes: Array<{ source: ProfileSource; profiles: StartupProfile[] }>;
    active?: { name: string; source: ProfileSource };
}

const sourceOf = (shared: boolean): ProfileSource => shared ? 'shared' : 'user';
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const sameKey = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase();

/** A profile of a file as the tab shows it */
export function toEntry(profile: StartupProfile, source: ProfileSource): StartupProfileEntry {
    return {
        name: profile.name,
        shared: source === 'shared',
        projects: profile.projects.map(project => ({
            path: project.path,
            action: project.action,
            ...(typeof project.extra.DebugTarget === 'string' ? { launchProfile: project.extra.DebugTarget } : {}),
        })),
    };
}

function readable(files: ProfileFiles, source: ProfileSource): readonly StartupProfile[] {
    const file = files[source];
    if (file.error) {
        // Nothing is written: a hand-edited file that cannot be parsed is never overwritten
        throw new Error(`The ${source === 'shared' ? 'shared (.slnLaunch)' : 'user (.slnLaunch.user)'} profile file cannot be read, nothing was changed: ${file.error}`);
    }
    return file.profiles;
}

/**
 * The profile as the file gets it: the rows in the tab's order, keys of the original (the file's own spelling of
 * unknown keys) kept, `DebugTarget` set from the chosen launch profile. A project row with no action is only
 * written when the file already listed it, and projects of the file that the tab did not list (not in the solution
 * any more) stay at the end.
 */
function build(entry: StartupProfileEntry, original: StartupProfile | undefined): StartupProfile {
    const originals = original?.projects ?? [];
    const projects: StartupProject[] = [];
    for (const row of entry.projects) {
        const before = originals.find(candidate => sameKey(candidate.path, row.path));
        if (row.action === 'None' && !before) {
            continue;
        }
        const { DebugTarget: _previous, ...rest } = before?.extra ?? {};
        projects.push({ path: row.path, action: row.action, extra: row.launchProfile ? { ...rest, DebugTarget: row.launchProfile } : rest });
    }
    for (const before of originals) {
        if (!entry.projects.some(row => sameKey(row.path, before.path))) {
            projects.push(before);
        }
    }
    return { name: entry.name.trim(), projects, extra: original?.extra ?? {} };
}

/** Throws a user-readable Error for invalid input or a file that cannot be read */
export function planRequest(files: ProfileFiles, request: Extract<StartupProjectsRequest, { type: 'applyProfile' | 'deleteProfile' }>): ProfilePlan {
    if (request.type === 'deleteProfile') {
        const source = sourceOf(request.shared);
        const profiles = readable(files, source);
        if (!profiles.some(profile => profile.name === request.name)) {
            throw new Error(`There is no profile named "${request.name}" any more.`);
        }
        return { writes: [{ source, profiles: profiles.filter(profile => profile.name !== request.name) }] };
    }

    const name = request.profile.name.trim();
    if (!name) {
        throw new Error('Give the profile a name.');
    }
    const target = sourceOf(request.profile.shared);
    const targetProfiles = readable(files, target);
    const from = request.original ? sourceOf(request.original.shared) : undefined;
    const fromProfiles = from ? readable(files, from) : [];
    const original = request.original ? fromProfiles.find(profile => profile.name === request.original?.name) : undefined;

    for (const source of ['shared', 'user'] as const) {
        const clash = files[source].profiles.find(profile => sameName(profile.name, name) && profile !== original);
        if (clash) {
            throw new Error(`There is already a profile named "${clash.name}"${source === 'user' ? ' (user file)' : ''}.`);
        }
    }

    const built = build({ ...request.profile, name }, original);
    const writes: ProfilePlan['writes'] = [];
    if (original && from === target) {
        writes.push({ source: target, profiles: targetProfiles.map(profile => profile === original ? built : profile) });
    } else {
        // Moved between the files, or new: the target is written first, so a failure never loses the profile
        writes.push({ source: target, profiles: [...targetProfiles, built] });
        if (original && from) {
            writes.push({ source: from, profiles: fromProfiles.filter(profile => profile !== original) });
        }
    }
    return { writes, active: { name, source: target } };
}
