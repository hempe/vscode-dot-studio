import * as path from 'path';

/** What Visual Studio calls a project's "Action" in Configure Startup Projects */
export type StartupAction = 'Start' | 'StartWithoutDebugging' | 'None';

const ACTIONS: readonly string[] = ['Start', 'StartWithoutDebugging', 'None'];

export interface StartupProject {
    /** Relative to the solution, forward slashes: the spelling of `configurationProjectsOf` */
    path: string;
    action: StartupAction;
    /**
     * Keys this model does not know (for example the debug target) with the file's values. An action string Visual Studio
     * knows and we do not is kept here as `Action` and behaves as 'None'; it is written back while the action stays 'None'.
     */
    extra: Record<string, unknown>;
}

export interface StartupProfile {
    name: string;
    projects: StartupProject[];
    extra: Record<string, unknown>;
}

export interface SlnLaunch {
    profiles: StartupProfile[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

const stripBom = (text: string) => text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;

const normalizePath = (projectPath: string) => projectPath.replace(/\\/g, '/');

function parseJson(text: string): unknown {
    const body = stripBom(text);
    if (body.trim() === '') {
        return [];
    }
    try {
        return JSON.parse(body);
    } catch (error) {
        throw new Error(`The .slnLaunch file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function rawProfiles(text: string): Json[] {
    const parsed = parseJson(text);
    if (!Array.isArray(parsed)) {
        throw new Error('The .slnLaunch file must contain a JSON array of profiles');
    }
    return parsed.map((profile, index) => {
        if (!isObject(profile)) {
            throw new Error(`The .slnLaunch file: profile ${index + 1} is not an object`);
        }
        return profile;
    });
}

function rawProjects(profile: Json, label: string): Json[] {
    const projects = profile.Projects ?? [];
    if (!Array.isArray(projects)) {
        throw new Error(`The .slnLaunch file: "Projects" of ${label} must be an array`);
    }
    return projects.map((project, index) => {
        if (!isObject(project) || typeof project.Path !== 'string') {
            throw new Error(`The .slnLaunch file: project ${index + 1} of ${label} has no "Path" string`);
        }
        return project;
    });
}

function without(source: Json, ...keys: string[]): Json {
    return Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)));
}

/** Throws an Error with a readable message when the text is not a valid .slnLaunch file */
export function readSlnLaunch(text: string): SlnLaunch {
    const profiles = rawProfiles(text).map((profile, index): StartupProfile => {
        const name = typeof profile.Name === 'string' ? profile.Name : '';
        return {
            name,
            extra: without(profile, 'Name', 'Projects'),
            projects: rawProjects(profile, name ? `profile "${name}"` : `profile ${index + 1}`).map((project): StartupProject => {
                const known = typeof project.Action === 'string' && ACTIONS.includes(project.Action);
                return {
                    path: normalizePath(project.Path as string),
                    action: known ? project.Action as StartupAction : 'None',
                    extra: known || project.Action === undefined ? without(project, 'Path', 'Action') : without(project, 'Path')
                };
            })
        };
    });
    return { profiles };
}

/** The indentation of the first indented line, a tab or 1-8 spaces; 2 spaces when there is none */
function detectIndent(text: string): string {
    const match = /^([ \t]+)\S/m.exec(text);
    if (!match) {
        return '  ';
    }
    return match[1].startsWith('\t') ? '\t' : match[1].slice(0, 8);
}

/** Orders `value`'s keys like `original` (keys the original lacks follow in their own order) */
function inOrderOf(original: Json | undefined, value: Json): Json {
    if (!original) {
        return value;
    }
    const ordered: Json = {};
    for (const key of Object.keys(original)) {
        if (key in value) {
            ordered[key] = value[key];
        }
    }
    return { ...ordered, ...value };
}

/**
 * The text of a .slnLaunch file for `profiles`. `existingText` is the file as it is on disk (undefined when there is none):
 * it is parsed again here and malformed text throws, so a file that cannot be read is never overwritten.
 * An existing file keeps its indentation, newline convention, byte order mark, trailing newline, the order of its keys and
 * the spelling of its project paths. A new file gets 2 spaces and a final newline, with LF: Visual Studio reads both
 * and the repository's .gitattributes decide what a checkout looks like; new project paths use backslashes like Visual Studio.
 */
export function renderSlnLaunch(existingText: string | undefined, profiles: readonly StartupProfile[]): string {
    const existing = existingText === undefined ? [] : rawProfiles(existingText);
    const hasFormat = existingText !== undefined && stripBom(existingText).trim() !== '';
    const spelling = new Map<string, string>();
    for (const profile of existing) {
        for (const project of rawProjects(profile, 'a profile')) {
            spelling.set(normalizePath(project.Path as string).toLowerCase(), project.Path as string);
        }
    }

    const output = profiles.map(profile => {
        const originalProfile = existing.find(candidate => candidate.Name === profile.name);
        const originalProjects = originalProfile ? rawProjects(originalProfile, `profile "${profile.name}"`) : [];
        const projects = profile.projects.map(project => {
            const key = project.path.toLowerCase();
            const original = originalProjects.find(candidate => normalizePath(candidate.Path as string).toLowerCase() === key);
            const rawAction = project.action === 'None' && typeof project.extra.Action === 'string' ? project.extra.Action : project.action;
            return inOrderOf(original, {
                Path: spelling.get(key) ?? project.path.replace(/\//g, '\\'),
                Action: rawAction,
                ...without(project.extra, 'Path', 'Action')
            });
        });
        return inOrderOf(originalProfile, { Name: profile.name, Projects: projects, ...without(profile.extra, 'Name', 'Projects') });
    });

    const body = stripBom(existingText ?? '');
    const newline = hasFormat && body.includes('\r\n') ? '\r\n' : '\n';
    const json = JSON.stringify(output, null, hasFormat ? detectIndent(body) : '  ').replace(/\n/g, newline);
    const finalNewline = hasFormat ? /\n\s*$/.test(body) : true;
    return (existingText?.charCodeAt(0) === 0xFEFF ? '\uFEFF' : '') + json + (finalNewline ? newline : '');
}

/** VS writes the shared profiles next to the solution; unshared ones go to a `.user` file (that name is unverified) */
export function slnLaunchPaths(solutionPath: string): { shared: string; user: string } {
    const base = path.join(path.dirname(solutionPath), path.basename(solutionPath, path.extname(solutionPath)));
    return { shared: `${base}.slnLaunch`, user: `${base}.slnLaunch.user` };
}
