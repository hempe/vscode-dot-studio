// The NuGet manager opens for projects whose path has &, +, # or % (review A2-5)
import { nugetEditorQuery, parseNuGetEditorQuery } from '../../../../webview/providers/nugetEditorUri';

describe('NuGet editor query', () => {
    it.each([
        '/src/R&D/App/App.csproj',
        '/src/C++Interop/Interop.csproj',
        '/src/100%/App/App.csproj',
        '/src/C#/App/App.csproj',
        'C:\\Users\\me\\source\\My Project\\App.csproj',
        '/src/a=b&c=d/App.csproj',
        '',
    ])('roundtrips %j', target => {
        expect(parseNuGetEditorQuery(nugetEditorQuery({ type: 'project', target }))).toEqual({ type: 'project', target });
    });

    it('keeps the context type, and defaults to a project', () => {
        expect(parseNuGetEditorQuery(nugetEditorQuery({ type: 'solution', target: '/x/App.sln' })).type).toBe('solution');
        expect(parseNuGetEditorQuery('').type).toBe('project');
    });

    it('survives one percent-decoding by VS Code (Uri.parse) of a query', () => {
        // Uri.from keeps the query as given; a parse of its string form decodes the %XX once, which would break a double-encoded value
        const query = nugetEditorQuery({ type: 'project', target: '/src/R&D/App.csproj' });
        expect(query).not.toContain('R&D');
        expect(parseNuGetEditorQuery(query).target).toBe('/src/R&D/App.csproj');
    });
});
