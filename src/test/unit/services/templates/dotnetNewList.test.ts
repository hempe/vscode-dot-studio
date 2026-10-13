import * as fs from 'fs';
import * as path from 'path';
import { parseTemplateList, supportsLanguage } from '../../../../services/templates/dotnetNewList';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '../../../../__fixtures__/dotnet-new', name), 'utf8');

describe('parseTemplateList', () => {
    const projects = parseTemplateList(fixture('list-project.txt'));
    const items = parseTemplateList(fixture('list-item.txt'));

    it('reads every row of the table', () => {
        const rows = (text: string) => text.split('\n').slice(4).filter(line => line.trim()).length;
        expect(projects).toHaveLength(rows(fixture('list-project.txt')));
        expect(items).toHaveLength(rows(fixture('list-item.txt')));
    });

    it('splits short names, languages and tags', () => {
        expect(projects.find(t => t.name === 'ASP.NET Core Web API')).toEqual({
            name: 'ASP.NET Core Web API',
            shortNames: ['webapi'],
            languages: ['C#', 'F#'],
            defaultLanguage: 'C#',
            tags: ['Web', 'Web API', 'API', 'Service'],
        });
        expect(projects.find(t => t.shortNames[0] === 'webapp')?.shortNames).toEqual(['webapp', 'razor']);
        expect(projects.find(t => t.shortNames[0] === 'classlib')?.languages).toEqual(['C#', 'F#', 'VB']);
    });

    it('config templates have no language', () => {
        const editorconfig = items.find(t => t.shortNames[0] === 'editorconfig')!;
        expect(editorconfig).toEqual({ name: 'EditorConfig file', shortNames: ['editorconfig', '.editorconfig'], languages: [], tags: ['Config'] });
        expect(supportsLanguage(editorconfig, 'F#')).toBe(true);
    });

    it('filters by language', () => {
        const razor = items.find(t => t.shortNames[0] === 'razorcomponent')!;
        expect(supportsLanguage(razor, 'C#')).toBe(true);
        expect(supportsLanguage(razor, 'VB')).toBe(false);
    });

    it('ignores output without a table', () => {
        expect(parseTemplateList('No templates found.')).toEqual([]);
    });
});
