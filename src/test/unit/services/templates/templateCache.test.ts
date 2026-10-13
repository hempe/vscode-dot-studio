import * as fs from 'fs';
import * as path from 'path';
import { optionArgs, parseTemplateCache, TemplateInfo } from '../../../../services/templates/templateCache';

const templates = parseTemplateCache(fs.readFileSync(path.join(__dirname, '../../../../__fixtures__/dotnet-new/templatecache.json'), 'utf8'));
const find = (shortName: string, language = 'C#') => templates.find(t => t.shortName === shortName && (t.language ?? 'C#') === language)!;

describe('parseTemplateCache', () => {
    it('keeps the newest version of each template and language', () => {
        expect(templates.filter(t => t.shortName === 'webapi' && t.language === 'C#')).toHaveLength(1);
        expect(find('webapi').identity).toBe('Microsoft.Web.WebApi.CSharp.10.0');
        expect(templates.filter(t => t.shortName === 'classlib').map(t => t.language).sort()).toEqual(['C#', 'F#', 'VB']);
    });

    it('offers the frameworks of all versions, as dotnet new does', () => {
        const framework = find('webapi').options.find(o => o.name === 'framework')!;
        expect(framework.defaultValue).toBe('net10.0');
        expect(framework.choices!.map(c => c.value)[0]).toBe('net10.0');
        expect(framework.choices!.length).toBeGreaterThan(1);
        expect(new Set(framework.choices!.map(c => c.value)).size).toBe(framework.choices!.length);
    });

    it('reads name, description, type, tags and default name', () => {
        expect(find('webapi')).toMatchObject({
            name: 'ASP.NET Core Web API',
            type: 'project',
            tags: ['Web', 'Web API', 'API', 'Service'],
            defaultName: 'WebApplication',
        });
        expect(find('webapi').description).toMatch(/^A project template for creating a RESTful Web API/);
        expect(find('apicontroller')).toMatchObject({ type: 'item', defaultName: 'ValueController' });
        expect(templates.find(t => t.shortName === 'editorconfig')).toMatchObject({ type: 'item', language: undefined });
    });

    it('turns parameters into options with their CLI names, without hidden and built-in ones', () => {
        const options = find('webapi').options;
        expect(options.map(o => o.name)).not.toEqual(expect.arrayContaining(['name', 'language', 'type', 'use-minimal-apis']));
        expect(options.find(o => o.name === 'auth')).toMatchObject({
            type: 'choice', defaultValue: 'None', label: 'The type of authentication to use',
            choices: expect.arrayContaining([{ value: 'None', description: 'No authentication' }]),
        });
        expect(options.find(o => o.name === 'use-controllers')).toMatchObject({ type: 'bool', defaultValue: 'false' });
        expect(options.find(o => o.name === 'framework')).toMatchObject({ type: 'choice', defaultValue: 'net10.0' });
        expect(options.find(o => o.name === 'client-id')).toMatchObject({ type: 'text' });
        expect(find('apicontroller').options.map(o => [o.name, o.type])).toEqual([['namespace', 'text'], ['actions', 'bool']]);
    });
});

describe('optionArgs', () => {
    const webapi: TemplateInfo = find('webapi');

    it('passes only values that differ from the default', () => {
        expect(optionArgs(webapi.options, { auth: 'None', 'use-controllers': true, 'no-https': false, framework: 'net8.0', domain: 'qualified.domain.name' }))
            .toEqual(['--framework', 'net8.0', '--use-controllers', 'true']);
        expect(optionArgs(webapi.options, {})).toEqual([]);
    });

    it('can switch defaults off', () => {
        const options = [{ name: 'flag', symbol: 'Flag', type: 'bool' as const, label: '', defaultValue: 'true' }];
        expect(optionArgs(options, { flag: false })).toEqual(['--flag', 'false']);
    });
});
