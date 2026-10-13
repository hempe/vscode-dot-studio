import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { TemplateInfo, TemplateOption } from '../../types/templateWizard';

export type { TemplateInfo, TemplateOption };

/** Parameters every template has, which the wizard sets itself */
const BUILT_IN_PARAMETERS = new Set(['name', 'language', 'type']);

function optionType(dataType: string | null | undefined): TemplateOption['type'] {
    switch ((dataType ?? '').toLowerCase()) {
        case 'bool':
        case 'boolean': return 'bool';
        case 'choice': return 'choice';
        case 'int':
        case 'integer':
        case 'float':
        case 'hex': return 'number';
        default: return 'text';
    }
}

/**
 * The templates in the template engine's cache (`templatecache.json`): for each template and language the version
 * `dotnet new` uses (highest precedence), with its parameters as options under their CLI names.
 */
export function parseTemplateCache(json: string): TemplateInfo[] {
    const cache = JSON.parse(json.replace(/^﻿/, ''));
    const groups = new Map<string, any[]>();
    for (const template of cache.TemplateInfo ?? []) {
        const key = `${template.GroupIdentity ?? template.Identity}|${template.TagsCollection?.language ?? ''}`;
        groups.set(key, [...(groups.get(key) ?? []), template]);
    }

    return [...groups.values()].map((versions): TemplateInfo => {
        const [template, ...older] = [...versions].sort((a, b) => b.Precedence - a.Precedence);
        // `dotnet new` treats the versions as one template: `--framework net8.0` picks the 8.0 one
        const olderChoices = (symbol: string) => older.flatMap(version =>
            Object.entries((version.Parameters ?? []).find((parameter: any) => parameter.Name === symbol)?.Choices ?? {}));
        let symbols: Record<string, { longName?: string; isHidden?: boolean | string }> = {};
        try {
            symbols = template.HostData ? JSON.parse(template.HostData).symbolInfo ?? {} : {};
        } catch {
            // Malformed host data: CLI names default to the parameter names
        }
        const options = (template.Parameters ?? [])
            .filter((parameter: any) => parameter.Type === 'parameter' && !parameter.IsName && !BUILT_IN_PARAMETERS.has(parameter.Name))
            .filter((parameter: any) => String(symbols[parameter.Name]?.isHidden).toLowerCase() !== 'true')
            .map((parameter: any): TemplateOption => ({
                name: symbols[parameter.Name]?.longName || parameter.Name,
                symbol: parameter.Name,
                type: optionType(parameter.DataType),
                label: parameter.Description || parameter.Documentation || parameter.DisplayName || parameter.Name,
                ...(parameter.DefaultValue !== null && parameter.DefaultValue !== undefined ? { defaultValue: String(parameter.DefaultValue) } : {}),
                ...(parameter.Choices ? {
                    choices: [...Object.entries(parameter.Choices), ...olderChoices(parameter.Name)]
                        .filter(([value], index, all) => all.findIndex(([other]) => other === value) === index)
                        .map(([value, choice]: [string, any]) => ({ value, description: choice?.DisplayName || choice?.Description || '' })),
                } : {}),
            }));

        return {
            identity: template.Identity,
            name: template.Name,
            shortName: template.ShortNameList?.[0] ?? template.Identity,
            description: template.Description ?? '',
            language: template.TagsCollection?.language || undefined,
            type: template.TagsCollection?.type ?? 'project',
            tags: template.Classifications ?? [],
            defaultName: template.DefaultName || undefined,
            options,
        };
    });
}

/** `--option value` for every option whose value differs from its default */
export function optionArgs(options: TemplateOption[], values: Record<string, string | boolean>): string[] {
    return options.flatMap(option => {
        if (!(option.name in values)) {
            return [];
        }
        const value = String(values[option.name]);
        const defaultValue = option.type === 'bool' ? (option.defaultValue ?? 'false').toLowerCase() : option.defaultValue ?? '';
        return value === defaultValue || (option.type !== 'bool' && value === '') ? [] : [`--${option.name}`, value];
    });
}

function run(args: string[]): Promise<string> {
    return new Promise(resolve => execFile('dotnet', args, { timeout: 60000 }, (_error, stdout) => resolve(stdout ?? '')));
}

let templates: Promise<TemplateInfo[]> | undefined;

/**
 * All installed templates. `dotnet new list` brings the cache of the current SDK up to date, then the cache
 * is read; once per session.
 */
export function readTemplates(): Promise<TemplateInfo[]> {
    templates ??= (async () => {
        const version = (await run(['--version'])).trim();
        await run(['new', 'list']);
        const cacheFile = path.join(os.homedir(), '.templateengine', 'dotnetcli', version, 'templatecache.json');
        try {
            return parseTemplateCache(await fs.promises.readFile(cacheFile, 'utf8'));
        } catch {
            templates = undefined;
            return [];
        }
    })();
    return templates;
}
