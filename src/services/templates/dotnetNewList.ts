import { execFile } from 'child_process';

/** A row of `dotnet new list` */
export interface DotnetTemplate {
    readonly name: string;
    readonly shortNames: string[];
    /** Empty for templates that aren't code, e.g. config files */
    readonly languages: string[];
    /** The bracketed language, used when none is passed */
    readonly defaultLanguage?: string;
    readonly tags: string[];
}

const split = (value: string, separator: string) => value.split(separator).map(part => part.trim()).filter(Boolean);

/** Parses the table `dotnet new list` prints; the dashed line under the header gives the column widths */
export function parseTemplateList(output: string): DotnetTemplate[] {
    const lines = output.split(/\r?\n/);
    const dashes = lines.findIndex(line => /^-+(\s+-+)+\s*$/.test(line));
    if (dashes < 0) {
        return [];
    }
    const columns = [...lines[dashes].matchAll(/-+/g)].map(match => match.index!);
    const cell = (line: string, column: number) =>
        line.slice(columns[column], column + 1 < columns.length ? columns[column + 1] : undefined).trim();

    return lines.slice(dashes + 1).filter(line => line.trim()).map(line => {
        const languages = split(cell(line, 2), ',');
        const defaultLanguage = languages.find(language => language.startsWith('['))?.slice(1, -1);
        return {
            name: cell(line, 0),
            shortNames: split(cell(line, 1), ','),
            languages: languages.map(language => language.replace(/^\[|\]$/g, '')),
            ...(defaultLanguage ? { defaultLanguage } : {}),
            tags: split(cell(line, 3), '/'),
        };
    });
}

/** Templates without a language (config files) fit every project */
export function supportsLanguage(template: DotnetTemplate, language: string): boolean {
    return template.languages.length === 0 || template.languages.includes(language);
}

const cache = new Map<string, Promise<DotnetTemplate[]>>();

/** `dotnet new list --type <type>`, read once per session */
export function listTemplates(type: 'project' | 'item'): Promise<DotnetTemplate[]> {
    let templates = cache.get(type);
    if (!templates) {
        templates = new Promise(resolve => {
            execFile('dotnet', ['new', 'list', '--type', type], { timeout: 60000 }, (error, stdout) => {
                if (error) {
                    cache.delete(type);
                }
                resolve(parseTemplateList(stdout ?? ''));
            });
        });
        cache.set(type, templates);
    }
    return templates;
}
