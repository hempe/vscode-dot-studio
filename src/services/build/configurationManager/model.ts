/** A project's setting for one solution configuration|platform pair */
export interface ProjectMapping {
    configuration: string;
    platform: string;
    build: boolean;
}

/**
 * The solution's configurations and platforms and the projects' deviations from the default mapping.
 * `mappings` is keyed by the project's path as the solution file spells it, then by "configuration|platform".
 */
export interface ConfigurationModel {
    configurations: string[];
    platforms: string[];
    mappings: Record<string, Record<string, ProjectMapping>>;
}

export const DEFAULT_PLATFORM = 'Any CPU';

export function emptyModel(): ConfigurationModel {
    return { configurations: ['Debug', 'Release'], platforms: [DEFAULT_PLATFORM], mappings: {} };
}

/** The solution spells it "Any CPU", MSBuild's Platform property "AnyCPU" */
export function msbuildPlatform(platform: string): string {
    return platform.replace(/\s+/g, '');
}

const pairKey = (configuration: string, platform: string) => `${configuration}|${platform}`;

export function resolveMapping(model: ConfigurationModel, project: string, configuration: string, platform: string): ProjectMapping {
    return model.mappings[project]?.[pairKey(configuration, platform)] ?? { configuration, platform, build: true };
}

export function setMapping(model: ConfigurationModel, project: string, configuration: string, platform: string, mapping: ProjectMapping): ConfigurationModel {
    const isDefault = mapping.configuration === configuration && mapping.platform === platform && mapping.build;
    const forProject = { ...model.mappings[project] };
    if (isDefault) {
        delete forProject[pairKey(configuration, platform)];
    } else {
        forProject[pairKey(configuration, platform)] = mapping;
    }
    const mappings = { ...model.mappings };
    if (Object.keys(forProject).length > 0) {
        mappings[project] = forProject;
    } else {
        delete mappings[project];
    }
    return { ...model, mappings };
}

function validName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed || /[|"<>&]/.test(trimmed)) {
        throw new Error(`"${name}" is an invalid name: it must not be empty or contain | " < > &`);
    }
    return trimmed;
}

function ensureNew(list: string[], name: string, kind: string): void {
    if (list.some(existing => existing.toLowerCase() === name.toLowerCase())) {
        throw new Error(`The ${kind} "${name}" already exists`);
    }
}

/** Drops the mappings whose key uses a solution-side name `drop` says goes away; values are left alone */
function dropPairs(model: ConfigurationModel, part: 'configuration' | 'platform', drop: (name: string) => boolean): ConfigurationModel {
    const mappings: ConfigurationModel['mappings'] = {};
    for (const [project, pairs] of Object.entries(model.mappings)) {
        const next: Record<string, ProjectMapping> = {};
        for (const [key, mapping] of Object.entries(pairs)) {
            const [configuration, platform] = key.split('|');
            if (!drop(part === 'configuration' ? configuration : platform)) {
                next[key] = mapping;
            }
        }
        if (Object.keys(next).length > 0) {
            mappings[project] = next;
        }
    }
    return { ...model, mappings };
}

/**
 * Renames the solution-side half of the mapping keys. The projects keep their own names: explicit mapping values stay,
 * and a project without an explicit mapping gets one that points at the old name.
 */
function renamePairs(model: ConfigurationModel, part: 'configuration' | 'platform', from: string, to: string, projects: readonly string[]): ConfigurationModel {
    const others = part === 'configuration' ? model.platforms : model.configurations;
    const keyFor = (name: string, other: string) => part === 'configuration' ? pairKey(name, other) : pairKey(other, name);
    const mappings: ConfigurationModel['mappings'] = {};
    for (const [project, pairs] of Object.entries(model.mappings)) {
        const next: Record<string, ProjectMapping> = {};
        for (const [key, mapping] of Object.entries(pairs)) {
            const [configuration, platform] = key.split('|');
            const isRenamed = (part === 'configuration' ? configuration : platform) === from;
            next[isRenamed ? keyFor(to, part === 'configuration' ? platform : configuration) : key] = { ...mapping };
        }
        mappings[project] = next;
    }
    for (const project of projects) {
        const next = { ...mappings[project] };
        for (const other of others) {
            if (!model.mappings[project]?.[keyFor(from, other)]) {
                next[keyFor(to, other)] = part === 'configuration'
                    ? { configuration: from, platform: other, build: true }
                    : { configuration: other, platform: from, build: true };
            }
        }
        if (Object.keys(next).length > 0) {
            mappings[project] = next;
        }
    }
    return { ...model, mappings };
}

/** `copyFrom`: the existing configuration whose project mappings the new one starts with, like Visual Studio's "Copy settings from" */
export function addConfiguration(model: ConfigurationModel, name: string, copyFrom?: string): ConfigurationModel {
    name = validName(name);
    ensureNew(model.configurations, name, 'configuration');
    const mappings = { ...model.mappings };
    if (copyFrom) {
        for (const [project, pairs] of Object.entries(model.mappings)) {
            const added: Record<string, ProjectMapping> = {};
            for (const [key, mapping] of Object.entries(pairs)) {
                const [configuration, platform] = key.split('|');
                if (configuration === copyFrom) {
                    added[pairKey(name, platform)] = { ...mapping };
                }
            }
            mappings[project] = { ...pairs, ...added };
        }
    }
    return { ...model, configurations: [...model.configurations, name], mappings };
}

export function addPlatform(model: ConfigurationModel, name: string, copyFrom?: string): ConfigurationModel {
    name = validName(name);
    ensureNew(model.platforms, name, 'platform');
    const mappings = { ...model.mappings };
    if (copyFrom) {
        for (const [project, pairs] of Object.entries(model.mappings)) {
            const added: Record<string, ProjectMapping> = {};
            for (const [key, mapping] of Object.entries(pairs)) {
                const [configuration, platform] = key.split('|');
                if (platform === copyFrom) {
                    added[pairKey(configuration, name)] = { ...mapping };
                }
            }
            mappings[project] = { ...pairs, ...added };
        }
    }
    return { ...model, platforms: [...model.platforms, name], mappings };
}

export function renameConfiguration(model: ConfigurationModel, from: string, to: string, projects: readonly string[]): ConfigurationModel {
    to = validName(to);
    if (from.toLowerCase() !== to.toLowerCase()) {
        ensureNew(model.configurations, to, 'configuration');
    }
    const renamed = renamePairs(model, 'configuration', from, to, projects);
    return { ...renamed, configurations: model.configurations.map(name => name === from ? to : name) };
}

export function renamePlatform(model: ConfigurationModel, from: string, to: string, projects: readonly string[]): ConfigurationModel {
    to = validName(to);
    if (from.toLowerCase() !== to.toLowerCase()) {
        ensureNew(model.platforms, to, 'platform');
    }
    const renamed = renamePairs(model, 'platform', from, to, projects);
    return { ...renamed, platforms: model.platforms.map(name => name === from ? to : name) };
}

export function removeConfiguration(model: ConfigurationModel, name: string): ConfigurationModel {
    if (model.configurations.length <= 1) {
        throw new Error('The last configuration cannot be removed');
    }
    const kept = dropPairs(model, 'configuration', existing => existing === name);
    return { ...kept, configurations: model.configurations.filter(existing => existing !== name) };
}

export function removePlatform(model: ConfigurationModel, name: string): ConfigurationModel {
    if (model.platforms.length <= 1) {
        throw new Error('The last platform cannot be removed');
    }
    const kept = dropPairs(model, 'platform', existing => existing === name);
    return { ...kept, platforms: model.platforms.filter(existing => existing !== name) };
}
