import * as path from 'path';
import { layoutFolder, DiskEntry } from '../../../../../services/project/items/folderLayout';
import { parseMsbuildItems } from '../../../../../services/project/items/projectItems';

const dir = path.resolve('/work/App');
const at = (...parts: string[]) => path.join(dir, ...parts);
const file = (name: string): DiskEntry => ({ name, isDirectory: false });
const folder = (name: string): DiskEntry => ({ name, isDirectory: true });

const itemsJson = JSON.stringify({
    Items: {
        Compile: [
            { Identity: 'Program.cs', FullPath: at('Program.cs') },
            { Identity: 'Sub\\Util.cs', FullPath: at('Sub', 'Util.cs') },
            { Identity: '..\\Shared\\Shared.cs', FullPath: path.resolve('/work/Shared/Shared.cs'), Link: 'Linked\\Shared.cs' },
        ],
    },
});
const items = parseMsbuildItems(itemsJson, dir);

const summary = (entries: ReturnType<typeof layoutFolder>) => entries.map(entry => `${entry.name}:${entry.state ?? '-'}`);

describe('layoutFolder', () => {
    const disk = [file('Program.cs'), file('Old.cs'), folder('Sub'), folder('Legacy'), folder('Empty'), folder('bin')];
    const nonEmpty = new Set([at('Sub'), at('Legacy')]);

    test('without an item list the disk listing is shown as is', () => {
        expect(summary(layoutFolder(dir, disk, undefined, false, nonEmpty))).toEqual(
            ['Program.cs:-', 'Old.cs:-', 'Sub:-', 'Legacy:-', 'Empty:-']);
    });

    test('hides excluded files and folders without included files, keeps empty folders, adds linked ones', () => {
        expect(summary(layoutFolder(dir, disk, items, false, nonEmpty))).toEqual(
            ['Program.cs:included', 'Sub:included', 'Empty:included', 'Linked:linked']);
    });

    test('Show All Files lists excluded ones, and bin/obj', () => {
        expect(summary(layoutFolder(dir, disk, items, true, nonEmpty))).toEqual(
            ['Program.cs:included', 'Old.cs:excluded', 'Sub:included', 'Legacy:excluded', 'Empty:included', 'bin:excluded', 'Linked:linked']);
    });

    test('a linked file shows under its link name with the real path', () => {
        const [linked] = layoutFolder(at('Linked'), [], items, false, new Set());
        expect(linked).toEqual({ name: 'Shared.cs', path: path.resolve('/work/Shared/Shared.cs'), isDirectory: false, state: 'linked' });
    });

    test('a folder that exists on disk is not listed twice for its linked files', () => {
        const names = layoutFolder(dir, [folder('Linked')], items, false, new Set([at('Linked')])).map(entry => entry.name);
        expect(names).toEqual(['Linked']);
    });

    test('a linked file with the name of an excluded disk file in the same folder wins over it', () => {
        expect(summary(layoutFolder(at('Linked'), [file('Shared.cs')], items, true, new Set()))).toEqual(['Shared.cs:linked']);
    });

    test('a disk file that is not listed does not hide the linked file of the same name', () => {
        expect(summary(layoutFolder(at('Linked'), [file('Shared.cs')], items, false, new Set()))).toEqual(['Shared.cs:linked']);
    });

    test('bin and obj stay hidden without Show All Files even with an item list', () => {
        expect(summary(layoutFolder(dir, [folder('obj')], items, false, new Set([at('obj')])))).toEqual(['Linked:linked']);
    });

    // pathKey reads process.platform when it is called: every branch runs on every system
    describe('bin and obj in another casing', () => {
        const original = process.platform;
        const setPlatform = (value: string) => Object.defineProperty(process, 'platform', { value });
        afterEach(() => setPlatform(original));
        const mixed = [folder('Bin'), folder('OBJ')];
        const all = new Set<string>(); // empty folders count as included unless they are build output

        test.each(['win32', 'darwin'])('are build output on %s (paths ignore case): hidden without Show All Files, excluded with it', platform => {
            setPlatform(platform);
            // Parsed after the override: the item keys are made at parse time
            const caseless = parseMsbuildItems(itemsJson, dir);
            expect(summary(layoutFolder(dir, mixed, caseless, false, all))).toEqual(['Linked:linked']);
            expect(summary(layoutFolder(dir, mixed, caseless, true, all))).toEqual(['Bin:excluded', 'OBJ:excluded', 'Linked:linked']);
        });

        test('are ordinary folders on linux (paths respect case)', () => {
            setPlatform('linux');
            const cased = parseMsbuildItems(itemsJson, dir);
            expect(summary(layoutFolder(dir, mixed, cased, false, all))).toEqual(['Bin:included', 'OBJ:included', 'Linked:linked']);
            expect(summary(layoutFolder(dir, mixed, cased, true, all))).toEqual(['Bin:included', 'OBJ:included', 'Linked:linked']);
        });
    });

    describe('an excluded disk file with the name of a linked file', () => {
        const withLink = parseMsbuildItems(JSON.stringify({
            Items: { Compile: [{ Identity: '..\\Shared\\Foo.cs', FullPath: path.resolve('/work/Shared/Foo.cs'), Link: 'Foo.cs' }] },
        }), dir);

        test('is replaced by the linked file with Show All Files on', () => {
            const entries = layoutFolder(dir, [file('Foo.cs')], withLink, true, new Set());
            expect(summary(entries)).toEqual(['Foo.cs:linked']);
            expect(entries[0].path).toBe(path.resolve('/work/Shared/Foo.cs'));
        });

        test('is not shown with Show All Files off, the linked file is', () => {
            expect(summary(layoutFolder(dir, [file('Foo.cs')], withLink, false, new Set()))).toEqual(['Foo.cs:linked']);
        });

        test('an included disk file still wins over the linked file', () => {
            const both = parseMsbuildItems(JSON.stringify({
                Items: { Compile: [
                    { Identity: 'Foo.cs', FullPath: at('Foo.cs') },
                    { Identity: '..\\Shared\\Foo.cs', FullPath: path.resolve('/work/Shared/Foo.cs'), Link: 'Foo.cs' },
                ] },
            }), dir);
            const entries = layoutFolder(dir, [file('Foo.cs')], both, true, new Set());
            expect(summary(entries)).toEqual(['Foo.cs:included']);
            expect(entries[0].path).toBe(at('Foo.cs'));
        });
    });
});
