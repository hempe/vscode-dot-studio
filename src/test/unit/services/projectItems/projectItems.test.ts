import * as path from 'path';
import { parseMsbuildItems, pathKey } from '../../../../services/projectItems/projectItems';

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

    test('a folder has linked files when one is shown under it; real files do not count', () => {
        expect(items.hasLinkedUnder(at('Linked'))).toBe(true);
        expect(items.hasLinkedUnder(at('Linked', 'Deep'))).toBe(true);
        expect(items.hasLinkedUnder(at('Sub'))).toBe(false);
        expect(items.hasLinkedUnder(dir)).toBe(true);
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

describe('pathKey', () => {
    test('lowercases on Windows and macOS only', () => {
        expect(pathKey('C:\\Work\\App', 'win32')).toBe('c:\\work\\app');
        expect(pathKey('/Work/App', 'darwin')).toBe('/work/app');
        expect(pathKey('/Work/App', 'linux')).toBe('/Work/App');
    });
});

describe('case-insensitive platforms', () => {
    const original = process.platform;
    const setPlatform = (value: string) => Object.defineProperty(process, 'platform', { value });
    afterEach(() => setPlatform(original));

    const mixed = JSON.stringify({
        Items: {
            Compile: [
                { FullPath: at('Program.cs') },
                { FullPath: at('Sub', 'Util.cs') },
                { FullPath: path.resolve('/work/Shared/Shared.cs'), Link: 'Linked\\Deep\\Shared.cs' },
            ],
        },
    });

    test('lookups ignore case on darwin and keep the original casing in results', () => {
        setPlatform('darwin');
        const items = parseMsbuildItems(mixed, dir)!;
        expect(items.isIncluded(at('PROGRAM.cs'))).toBe(true);
        expect(items.itemTypeOf(at('program.CS'))).toBe('Compile');
        expect(items.hasIncludedUnder(at('sub'))).toBe(true);
        expect(items.hasIncludedUnder(at('LINKED', 'deep'))).toBe(true);
        expect(items.itemTypesUnder(at('SUB'))).toEqual(['Compile']);
        expect(items.linkedFilesIn(at('linked', 'DEEP')).map(item => item.fullPath)).toEqual([path.resolve('/work/Shared/Shared.cs')]);
        expect(items.linkedFoldersIn(at('LINKED'))).toEqual(['Deep']);
        expect(items.linkedFoldersIn(dir.toUpperCase())).toEqual(['Linked']);
    });

    test('lookups respect case on linux', () => {
        setPlatform('linux');
        const items = parseMsbuildItems(mixed, dir)!;
        expect(items.isIncluded(at('PROGRAM.cs'))).toBe(false);
        expect(items.hasIncludedUnder(at('sub'))).toBe(false);
    });
});

describe('a file under several item types', () => {
    const file = at('Both.cs');
    const noneFirst = JSON.stringify({ Items: { None: [{ FullPath: file }], Compile: [{ FullPath: file }] } });
    const compileFirst = JSON.stringify({ Items: { Compile: [{ FullPath: file }], None: [{ FullPath: file }] } });

    test.each([['None first', noneFirst], ['Compile first', compileFirst]])('itemTypeOf is Compile (%s)', (_name, text) => {
        const items = parseMsbuildItems(text, dir)!;
        expect(items.itemTypeOf(file)).toBe('Compile');
        expect(items.itemTypesOf(file)).toEqual(['Compile', 'None']);
        expect(items.itemTypesUnder(dir)).toEqual(['Compile', 'None']);
        expect(items.itemTypesOf(at('Missing.cs'))).toEqual([]);
    });
});

describe('parseMsbuildItems robustness', () => {
    test('braces in a banner before the JSON are ignored', () => {
        const text = `warning MSB1234: {0} thing\n${json}`;
        expect(parseMsbuildItems(text, dir)?.isIncluded(at('Program.cs'))).toBe(true);
    });

    test('an indented JSON start line is found', () => {
        expect(parseMsbuildItems(`banner {x\n  ${json}`, dir)?.isIncluded(at('Program.cs'))).toBe(true);
    });

    test('text after the JSON gives undefined', () => {
        expect(parseMsbuildItems(`${json}\ntrailing text`, dir)).toBeUndefined();
    });
});

describe('linkedFilesIn', () => {
    test('does not list the same virtual path twice', () => {
        const text = JSON.stringify({
            Items: {
                Compile: [{ FullPath: path.resolve('/work/Shared/A.cs'), Link: 'L\\A.cs' }],
                None: [{ FullPath: path.resolve('/work/Shared/A.cs'), Link: 'L\\A.cs' }],
            },
        });
        const items = parseMsbuildItems(text, dir)!;
        expect(items.linkedFilesIn(at('L'))).toHaveLength(1);
    });
});
