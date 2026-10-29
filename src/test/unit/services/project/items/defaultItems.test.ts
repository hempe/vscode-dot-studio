import * as path from 'path';
import { itemsWithoutExcludes, newItemFor, parseNewItems } from '../../../../services/projectItems/defaultItems';

const dir = path.resolve('/work/Web');
const at = (...parts: string[]) => path.join(dir, ...parts);
const output = (items: Record<string, object[]>, properties: Record<string, string> = { TargetFramework: 'net10.0', TargetFrameworks: '' }) =>
    JSON.stringify({ Properties: properties, Items: items });

describe('parseNewItems', () => {
    test('a file listed as None and as another type gets the other type, with the output metadata of that item', () => {
        const items = parseNewItems(output({
            None: [{ FullPath: at('Pages', 'Old.cshtml') }, { FullPath: at('notes.txt') }],
            Content: [{ FullPath: at('Pages', 'Old.cshtml'), CopyToPublishDirectory: 'PreserveNewest', ExcludeFromSingleFile: 'true', DefiningProjectFullPath: '/sdk/x.props' }],
            EmbeddedResource: [{ FullPath: at('S.resx') }],
        }), dir)!;
        expect(newItemFor(at('Pages', 'Old.cshtml'), items)).toEqual({ itemType: 'Content', metadata: { CopyToPublishDirectory: 'PreserveNewest', ExcludeFromSingleFile: 'true' } });
        expect(newItemFor(at('notes.txt'), items)).toEqual({ itemType: 'None', metadata: {} });
        expect(newItemFor(at('S.resx'), items)).toEqual({ itemType: 'EmbeddedResource', metadata: {} });
    });

    test('linked items and types outside the item list are left out; a file MSBuild did not list goes by its extension', () => {
        const items = parseNewItems(output({
            Compile: [{ FullPath: at('Shared.cs'), Link: 'Links/Shared.cs' }],
            PackageReference: [{ Identity: 'Serilog', FullPath: at('Serilog') }],
        }), dir)!;
        expect(items.size).toBe(0);
        expect(newItemFor(at('Shared.cs'), items)).toEqual({ itemType: 'Compile', metadata: {} });
        expect(newItemFor(at('S.resx'), undefined)).toEqual({ itemType: 'EmbeddedResource', metadata: {} });
        expect(newItemFor(at('site.css'), undefined)).toEqual({ itemType: 'None', metadata: {} });
    });

    test('not the JSON result: undefined', () => {
        expect(parseNewItems('error MSB4025: The project file could not be loaded.', dir)).toBeUndefined();
    });
});

describe('itemsWithoutExcludes', () => {
    test('asks MSBuild with DefaultItemExcludes as a global property that keeps only bin, obj and node_modules out', async () => {
        const run = jest.fn().mockResolvedValue(output({ Content: [{ FullPath: at('a.css') }] }));
        const items = await itemsWithoutExcludes(at('Web.csproj'), run);
        expect(run).toHaveBeenCalledTimes(1);
        expect(run.mock.calls[0][1]).toContain('-property:DefaultItemExcludes="bin/**;obj/**;**/node_modules/**"');
        expect(newItemFor(at('a.css'), items).itemType).toBe('Content');
    });

    test('a multi-targeted project is asked again for its first framework', async () => {
        const run = jest.fn()
            .mockResolvedValueOnce(output({}, { TargetFramework: '', TargetFrameworks: 'net8.0;net10.0' }))
            .mockResolvedValueOnce(output({ Compile: [{ FullPath: at('A.cs') }] }));
        const items = await itemsWithoutExcludes(at('Web.csproj'), run);
        expect(run.mock.calls[1][1]).toContain('-property:TargetFramework=net8.0');
        expect(newItemFor(at('A.cs'), items).itemType).toBe('Compile');
    });

    test('MSBuild failing gives undefined', async () => {
        expect(await itemsWithoutExcludes(at('Web.csproj'), jest.fn().mockRejectedValue(new Error('no sdk')))).toBeUndefined();
    });
});
