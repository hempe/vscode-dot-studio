import { ConfigurationModel, DEFAULT_PLATFORM, ProjectMapping, emptyModel, resolveMapping, setMapping } from './model';

export interface SolutionProjectRef {
    /** As the solution file spells it (relative path, forward slashes) */
    path: string;
    guid: string;
}

const section = (name: string) => new RegExp(`([ \\t]*)GlobalSection\\(${name}\\) = (?:pre|post)Solution[\\r\\n]+([\\s\\S]*?)[ \\t]*EndGlobalSection`);

function sectionLines(content: string, name: string): string[] | undefined {
    const match = section(name).exec(content);
    return match ? match[2].split(/\r?\n/).map(line => line.trim()).filter(Boolean) : undefined;
}

function splitPair(pair: string): [string, string] {
    const index = pair.indexOf('|');
    return [pair.slice(0, index).trim(), pair.slice(index + 1).trim()];
}

const PROJECT_LINE = /^(\{[0-9A-Fa-f-]+\})\.(.+?)\.(ActiveCfg|Build\.0)\s*=\s*(.+)$/;

export function readSlnModel(content: string, projects: readonly SolutionProjectRef[]): ConfigurationModel {
    const configurations: string[] = [];
    const platforms: string[] = [];
    for (const line of sectionLines(content, 'SolutionConfigurationPlatforms') ?? []) {
        const [configuration, platform] = splitPair(line.split('=')[0]);
        if (configuration && !configurations.includes(configuration)) {
            configurations.push(configuration);
        }
        if (platform && !platforms.includes(platform)) {
            platforms.push(platform);
        }
    }
    if (configurations.length === 0) {
        return emptyModel();
    }

    const projectLines = sectionLines(content, 'ProjectConfigurationPlatforms');
    const byGuid = new Map(projects.map(project => [project.guid.toLowerCase(), project.path]));
    const active = new Map<string, string>();   // "guid.configuration|platform" -> the project's own pair
    const built = new Set<string>();
    for (const line of projectLines ?? []) {
        const match = PROJECT_LINE.exec(line);
        if (!match) {
            continue;
        }
        const key = `${match[1].toLowerCase()}.${match[2]}`;
        if (match[3] === 'ActiveCfg') {
            active.set(key, match[4].trim());
        } else {
            built.add(key);
        }
    }

    let result: ConfigurationModel = { configurations, platforms: platforms.length > 0 ? platforms : [DEFAULT_PLATFORM], mappings: {} };
    for (const [key, target] of active) {
        const dot = key.indexOf('.');
        const projectPath = byGuid.get(key.slice(0, dot));
        if (!projectPath) {
            continue;
        }
        const [configuration, platform] = splitPair(key.slice(dot + 1));
        const [targetConfiguration, targetPlatform] = splitPair(target);
        const mapping: ProjectMapping = { configuration: targetConfiguration, platform: targetPlatform, build: built.has(key) };
        result = setMapping(result, projectPath, configuration, platform, mapping);
    }
    // Without a ProjectConfigurationPlatforms section every project builds everywhere; with one, a pair it leaves out is not built
    if (projectLines) {
        for (const project of projects) {
            for (const configuration of result.configurations) {
                for (const platform of result.platforms) {
                    if (!active.has(`${project.guid.toLowerCase()}.${configuration}|${platform}`)) {
                        result = setMapping(result, project.path, configuration, platform, { configuration, platform, build: false });
                    }
                }
            }
        }
    }
    return result;
}

export function renderSlnModel(content: string, model: ConfigurationModel, projects: readonly SolutionProjectRef[]): string {
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const pairs = new Set<string>();
    const solutionLines: string[] = [];
    for (const configuration of model.configurations) {
        for (const platform of model.platforms) {
            pairs.add(`${configuration}|${platform}`);
            solutionLines.push(`\t\t${configuration}|${platform} = ${configuration}|${platform}`);
        }
    }

    const projectLines: string[] = [];
    for (const project of projects) {
        for (const configuration of model.configurations) {
            for (const platform of model.platforms) {
                const mapping = resolveMapping(model, project.path, configuration, platform);
                const pair = `${configuration}|${platform}`;
                const target = `${mapping.configuration}|${mapping.platform}`;
                projectLines.push(`\t\t${project.guid}.${pair}.ActiveCfg = ${target}`);
                if (mapping.build) {
                    projectLines.push(`\t\t${project.guid}.${pair}.Build.0 = ${target}`);
                }
            }
        }
    }
    // Lines of other GUIDs (solution folders, projects the caller does not manage) stay as long as their solution pair exists
    const known = new Set(projects.map(project => project.guid.toLowerCase()));
    for (const line of sectionLines(content, 'ProjectConfigurationPlatforms') ?? []) {
        const match = PROJECT_LINE.exec(line);
        if (match && !known.has(match[1].toLowerCase()) && pairs.has(match[2])) {
            projectLines.push(`\t\t${line}`);
        }
    }

    const withSolution = replaceSection(content, 'SolutionConfigurationPlatforms', 'preSolution', solutionLines, eol);
    return replaceSection(withSolution, 'ProjectConfigurationPlatforms', 'postSolution', projectLines, eol);
}

function replaceSection(content: string, name: string, kind: 'preSolution' | 'postSolution', lines: string[], eol: string): string {
    const block = [`\tGlobalSection(${name}) = ${kind}`, ...lines, '\tEndGlobalSection'].join(eol);
    const match = section(name).exec(content);
    if (match) {
        return content.slice(0, match.index) + block + content.slice(match.index + match[0].length);
    }
    const ends = [...content.matchAll(/^EndGlobal[ \t]*\r?$/gm)];
    if (ends.length === 0) {
        return content;
    }
    const end = ends[ends.length - 1].index!;
    return content.slice(0, end) + block + eol + content.slice(end);
}
