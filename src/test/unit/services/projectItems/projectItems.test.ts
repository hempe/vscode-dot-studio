import * as path from 'path';
import { parseMsbuildItems } from '../../../../services/projectItems/projectItems';

const dir = path.resolve('/work/App');
const at = (...parts: string[]) => path.join(dir, ...parts);

const json = JSON.stringify({
    Items: {
        Compile: [
            { Identity: 'Program.cs', FullPath: at('Program.cs') },
            { Identity: path.join('Sub', 'Util.cs'), FullPath: at('Sub', 'Util.cs') },
            { Identity: '..\\Shared\\Shared.cs', FullPath: path.resolve('/work/Shared/Shared.cs'), Link: 'Linked\\Deep\\Shared.cs' },
        ],
        None: [{ Identity: 'notes.txt', FullPath: at('notes.txt') }],
    },
});

describe('parseMsbuildItems', () => {
    const items = parseMsbuildItems(json, dir)!;

    test('knows what is included and with which item type', () => {
        expect(items.isIncluded(at('Program.cs'))).toBe(true);
        expect(items.itemTypeOf(at('notes.txt'))).toBe('None');
        expect(items.isIncluded(at('Legacy.cs'))).toBe(false);
    });

    test('a folder has included files when one lies under it, a linked file counts at its link path', () => {
        expect(items.hasIncludedUnder(at('Sub'))).toBe(true);
        expect(items.hasIncludedUnder(at('Linked'))).toBe(true);
        expect(items.hasIncludedUnder(at('Linked', 'Deep'))).toBe(true);
        expect(items.hasIncludedUnder(at('Other'))).toBe(false);
    });

    test('lists linked files and folders of a folder', () => {
        expect(items.linkedFilesIn(at('Linked', 'Deep')).map(item => item.fullPath)).toEqual([path.resolve('/work/Shared/Shared.cs')]);
        expect(items.linkedFilesIn(dir)).toEqual([]);
        expect(items.linkedFoldersIn(dir)).toEqual(['Linked']);
        expect(items.linkedFoldersIn(at('Linked'))).toEqual(['Deep']);
    });

    test('item types of everything under a folder', () => {
        expect(items.itemTypesUnder(at('Sub'))).toEqual(['Compile']);
    });

    test('returns undefined for output that is not JSON', () => {
        expect(parseMsbuildItems('MSBuild version 17', dir)).toBeUndefined();
    });

    test('skips text before the JSON (SDK banners)', () => {
        expect(parseMsbuildItems(`warning NU1701\n${json}`, dir)?.isIncluded(at('Program.cs'))).toBe(true);
    });
});
