import * as path from 'path';
import { ITEM_TYPES, crossTargetingFramework, parseMsbuildItems, pathKey } from '../../../../services/projectItems/projectItems';

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

    test('packages of the same evaluation are not files (PackageReference has a FullPath too)', () => {
        const withPackages = JSON.stringify({ Items: { ...JSON.parse(json).Items, PackageReference: [{ Identity: 'Serilog', FullPath: at('Serilog') }] } });
        expect(parseMsbuildItems(withPackages, dir)!.isIncluded(at('Serilog'))).toBe(false);
    });

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

describe('ITEM_TYPES', () => {
    // A file only in a type missing here is hidden in the tree; each line names where such files come from
    const expected: [string, string][] = [
        ['Compile', 'C# sources'], ['None', 'everything else'], ['Content', 'Razor, wwwroot, appsettings'],
        ['EmbeddedResource', '*.resx'], ['Page', 'WPF *.xaml'], ['Resource', 'WPF images'], ['ApplicationDefinition', 'WPF App.xaml'],
        ['SplashScreen', 'WPF'], ['AdditionalFiles', 'analyzer inputs'], ['RazorComponent', 'Razor'], ['RazorGenerate', 'Razor'],
        ['Protobuf', 'Grpc.Tools *.proto'],
        ['CodeAnalysisDictionary', 'VS build action'], ['DesignData', 'VS build action'],
        ['DesignDataWithDesignTimeCreatableTypes', 'VS build action'], ['EntityDeploy', 'VS build action (*.edmx)'],
        ['Fakes', 'VS build action'], ['Shadow', 'VS build action'], ['XamlAppDef', 'VS build action'],
        ['TypeScriptCompile', 'Microsoft.TypeScript.MSBuild'],
        ['MauiXaml', 'Microsoft.Maui.Controls moves *.xaml out of None'], ['MauiCss', 'Microsoft.Maui.Controls moves *.css out of None'],
        ['MauiImage', 'MAUI template'], ['MauiIcon', 'MAUI template'], ['MauiSplashScreen', 'MAUI template'],
        ['MauiFont', 'MAUI template'], ['MauiAsset', 'MAUI template'],
        ['PRIResource', 'Microsoft.WindowsAppSDK moves *.resw out of None'],
    ];

    test('lists every item type whose files belong to the project', () => {
        expect([...ITEM_TYPES]).toEqual(expected.map(([itemType]) => itemType));
    });

    test.each(expected.map(([itemType]) => itemType))('a file only listed as %s is included', itemType => {
        const items = parseMsbuildItems(JSON.stringify({ Items: { [itemType]: [{ FullPath: at('file.dat') }] } }), dir)!;
        expect(items.isIncluded(at('file.dat'))).toBe(true);
        expect(items.itemTypeOf(at('file.dat'))).toBe(itemType);
    });
});

describe('crossTargetingFramework', () => {
    const output = (properties: Record<string, string>) => JSON.stringify({ Properties: properties, Items: { Compile: [] } });

    test('a multi-targeted project is evaluated for its first target framework', () => {
        expect(crossTargetingFramework(output({ TargetFramework: '', TargetFrameworks: ' net48 ; net10.0' }))).toBe('net48');
        expect(crossTargetingFramework(`banner\n${output({ TargetFramework: '', TargetFrameworks: ';net10.0;' })}`)).toBe('net10.0');
    });

    test('nothing to do for a single target framework, no frameworks or output that is not JSON', () => {
        expect(crossTargetingFramework(output({ TargetFramework: 'net10.0', TargetFrameworks: '' }))).toBeUndefined();
        expect(crossTargetingFramework(output({ TargetFramework: '', TargetFrameworks: '' }))).toBeUndefined();
        expect(crossTargetingFramework(JSON.stringify({ Items: {} }))).toBeUndefined();
        expect(crossTargetingFramework('MSBuild version 17')).toBeUndefined();
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
