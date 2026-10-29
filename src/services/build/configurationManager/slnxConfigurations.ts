import * as xml2js from 'xml2js';
import { ConfigurationModel, DEFAULT_PLATFORM, ProjectMapping, emptyModel, resolveMapping, setMapping } from './model';
import { SolutionProjectRef } from './slnConfigurations';

const ATTRS = `((?:\\s+[\\w:.-]+\\s*=\\s*(?:"[^"]*"|'[^']*'))*)`;
const PROJECT_RE = () => new RegExp(`([ \\t]*)<Project\\b${ATTRS}\\s*(?:\\/>|>([\\s\\S]*?)(<\\/Project\\s*>))`, 'g');
const MAPPING_RE = () => new RegExp(`<(BuildType|Platform|Build)\\b${ATTRS}\\s*\\/?>`, 'g');
const CONFIGURATIONS_RE = /([ \t]*)<Configurations\b[^>]*?(?:\/>|>[\s\S]*?<\/Configurations\s*>)/;

const attr = (attrs: string, name: string) => {
    const match = new RegExp(`(?<![\\w:.-])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
    return match ? match[1] ?? match[2] : undefined;
};

/** Same length as the input, comments blanked out (line breaks kept), so regexes skip them and offsets still fit the original */
const maskComments = (text: string) => text.replace(/<!--[\s\S]*?-->/g, comment => comment.replace(/[^\r\n]/g, ' '));

/** Project paths are compared with forward slashes, whichever way the file spells them */
const normalisePath = (value: string) => value.replace(/\\/g, '/');

function findProject(projects: readonly SolutionProjectRef[], attrs: string): SolutionProjectRef | undefined {
    const value = attr(attrs, 'Path');
    return value === undefined ? undefined : projects.find(project => normalisePath(project.path) === normalisePath(value));
}

/** "Debug|x64" -> ['Debug','x64'], "Debug|*" -> ['Debug','*'], "Debug" -> ['Debug','*'] */
function splitSolutionPair(value: string): [string, string] {
    const [configuration, platform] = value.split('|');
    return [configuration || '*', platform || '*'];
}

/** How specific a `Solution="…"` is: an exact pair beats a half wildcard beats `*|*` */
const specificity = ([configuration, platform]: [string, string]) => (configuration === '*' ? 0 : 1) + (platform === '*' ? 0 : 1);

function matches([configuration, platform]: [string, string], c: string, p: string): boolean {
    return (configuration === '*' || configuration === c) && (platform === '*' || platform === p);
}

/** xml2js parses synchronously with `async: false`, but swallows a throw from its callback, so the error is carried out of it */
function parseConfigurations(content: string): { configurations: string[]; platforms: string[] } {
    let failure: Error | undefined;
    let root: any;
    xml2js.parseString(content, { async: false }, (error: Error | null, result: any) => {
        failure = failure ?? error ?? undefined;
        root = result;
    });
    if (failure) {
        throw failure;
    }
    const section = root?.Solution?.Configurations?.[0];
    const names = (kind: string): string[] => (section?.[kind] ?? []).map((element: any) => element.$?.Name).filter(Boolean);
    return { configurations: names('BuildType'), platforms: names('Platform') };
}

export function readSlnxModel(content: string, projects: readonly SolutionProjectRef[]): ConfigurationModel {
    const parsed = parseConfigurations(content);
    const configurations = parsed.configurations.length > 0 ? parsed.configurations : emptyModel().configurations;
    const platforms = parsed.platforms.length > 0 ? parsed.platforms : [DEFAULT_PLATFORM];

    let model: ConfigurationModel = { configurations, platforms, mappings: {} };
    for (const match of maskComments(content).matchAll(PROJECT_RE())) {
        const project = findProject(projects, match[2]);
        const body = match[3];
        if (!project || !body) { continue; }
        const rules: Array<{ kind: string; solution: [string, string]; project: string }> = [];
        for (const element of body.matchAll(MAPPING_RE())) {
            const solution = attr(element[2], 'Solution');
            const target = attr(element[2], 'Project');
            if (solution !== undefined && target !== undefined) {
                rules.push({ kind: element[1], solution: splitSolutionPair(solution), project: target });
            }
        }
        for (const configuration of configurations) {
            for (const platform of platforms) {
                const pick = (kind: string) => rules
                    .filter(rule => rule.kind === kind && matches(rule.solution, configuration, platform))
                    .sort((a, b) => specificity(b.solution) - specificity(a.solution))[0]?.project;
                const mapping: ProjectMapping = {
                    configuration: pick('BuildType') ?? configuration,
                    platform: pick('Platform') ?? platform,
                    build: pick('Build') !== 'false',
                };
                model = setMapping(model, project.path, configuration, platform, mapping);
            }
        }
    }
    return model;
}

export function renderSlnxModel(content: string, model: ConfigurationModel, projects: readonly SolutionProjectRef[]): string {
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const withLists = renderConfigurations(content, model, eol);
    const masked = maskComments(withLists);
    let result = '';
    let last = 0;
    for (const match of masked.matchAll(PROJECT_RE())) {
        const project = findProject(projects, match[2]);
        if (!project) { continue; }
        const whole = withLists.slice(match.index, match.index + match[0].length);
        result += withLists.slice(last, match.index) + renderProject(whole, match, project.path, model, eol);
        last = match.index + match[0].length;
    }
    return result + withLists.slice(last);
}

/** Rewrites one Project element: its mapping children are replaced, everything else in it stays */
function renderProject(whole: string, match: RegExpMatchArray, projectPath: string, model: ConfigurationModel, eol: string): string {
    const indent = match[1];
    const unit = indent.includes('\t') ? '\t' : '  ';
    const open = `${indent}<Project${match[2]}`;
    const close = match[4] ?? '';
    const originalBody = match[3] === undefined ? '' : whole.slice(whole.length - close.length - match[3].length, whole.length - close.length);

    // drop the old mapping elements together with the line break and indent before them
    const maskedBody = maskComments(originalBody);
    let body = '';
    let last = 0;
    let removed = false;
    for (const element of maskedBody.matchAll(new RegExp(`(?:\\r?\\n)?[ \\t]*${MAPPING_RE().source}`, 'g'))) {
        body += originalBody.slice(last, element.index);
        last = element.index + element[0].length;
        removed = true;
    }
    body += originalBody.slice(last);

    const children: string[] = [];
    for (const configuration of model.configurations) {
        for (const platform of model.platforms) {
            const mapping = resolveMapping(model, projectPath, configuration, platform);
            const solution = `${configuration}|${platform}`;
            if (mapping.configuration !== configuration) { children.push(`<BuildType Solution="${solution}" Project="${mapping.configuration}" />`); }
            if (mapping.platform !== platform) { children.push(`<Platform Solution="${solution}" Project="${mapping.platform}" />`); }
            if (!mapping.build) { children.push(`<Build Solution="${solution}" Project="false" />`); }
        }
    }

    const lines = children.map(child => `${eol}${indent}${unit}${child}`).join('');
    if (body.trim() !== '') {
        return `${open.trimEnd()}>${lines}${body}${close}`;
    }
    if (children.length > 0) {
        return `${open.trimEnd()}>${lines}${eol}${indent}</Project>`;
    }
    return removed ? `${open.trimEnd()} />` : whole;
}

function renderConfigurations(content: string, model: ConfigurationModel, eol: string): string {
    const masked = maskComments(content);
    const match = CONFIGURATIONS_RE.exec(masked);
    const indent = match?.[1] ?? '  ';
    const lines = [
        `${indent}<Configurations>`,
        ...model.configurations.map(name => `${indent}  <BuildType Name="${name}" />`),
        ...model.platforms.map(name => `${indent}  <Platform Name="${name}" />`),
        `${indent}</Configurations>`,
    ].join(eol);
    if (match) {
        return content.slice(0, match.index) + lines + content.slice(match.index + match[0].length);
    }
    const open = /<Solution\b[^>]*>/.exec(masked);
    return open ? content.slice(0, open.index + open[0].length) + eol + lines + content.slice(open.index + open[0].length) : content;
}
