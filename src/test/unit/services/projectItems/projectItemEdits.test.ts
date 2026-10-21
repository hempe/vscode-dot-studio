import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { excludeEdit, includeEdit, includeItemCount, listFilesUnder, membershipApplied, membershipRefusal } from '../../../../services/projectItems/projectItemEdits';
import { parseMsbuildItems } from '../../../../services/projectItems/projectItems';

const dir = path.resolve('/work/App');
const at = (...parts: string[]) => path.join(dir, ...parts);
const project = '<Project Sdk="Microsoft.NET.Sdk">\n\n</Project>\n';

const items = parseMsbuildItems(JSON.stringify({
    Items: {
        Compile: [{ Identity: 'Sub\\A.cs', FullPath: at('Sub', 'A.cs') }, { Identity: 'Sub\\B.cs', FullPath: at('Sub', 'B.cs') }],
        None: [{ Identity: 'Sub\\n.txt', FullPath: at('Sub', 'n.txt') }],
    },
}), dir)!;

describe('excludeEdit', () => {
    test('a file gets a Remove item of its own item type, with MSBuild separators', () => {
        const edited = excludeEdit(project, dir, at('Sub', 'A.cs'), false, items);
        expect(edited).toContain('<Compile Remove="Sub\\A.cs" />');
    });

    test('a file the item list does not know is removed as None', () => {
        expect(excludeEdit(project, dir, at('x.txt'), false, items)).toContain('<None Remove="x.txt" />');
    });

    test('a folder removes everything under it, per item type', () => {
        const edited = excludeEdit(project, dir, at('Sub'), true, items);
        expect(edited).toContain('<Compile Remove="Sub\\**" />');
        expect(edited).toContain('<None Remove="Sub\\**" />');
    });
});

describe('includeEdit', () => {
    test('undoes an Exclude by deleting its Remove item', () => {
        const excluded = excludeEdit(project, dir, at('Sub', 'A.cs'), false, items);
        expect(includeEdit(excluded, dir, at('Sub', 'A.cs'), false, [at('Sub', 'A.cs')])).toBe(project);
    });

    test('undoes a folder Exclude', () => {
        const excluded = excludeEdit(project, dir, at('Sub'), true, items);
        expect(includeEdit(excluded, dir, at('Sub'), true, [at('Sub', 'A.cs')])).toBe(project);
    });

    test('without a Remove item a file is included by an Include item (C# as Compile, others as None)', () => {
        expect(includeEdit(project, dir, at('Gen', 'Made.cs'), false, [])).toContain('<Compile Include="Gen\\Made.cs" />');
        expect(includeEdit(project, dir, at('readme.md'), false, [])).toContain('<None Include="readme.md" />');
    });

    test('without a Remove item a folder includes each file under it', () => {
        const edited = includeEdit(project, dir, at('Gen'), true, [at('Gen', 'a.cs'), at('Gen', 'deep', 'b.txt')]);
        expect(edited).toContain('<Compile Include="Gen\\a.cs" />');
        expect(edited).toContain('<None Include="Gen\\deep\\b.txt" />');
    });
});

describe('paths outside the project folder', () => {
    test('are refused instead of writing a Remove item for the whole drive', () => {
        expect(() => excludeEdit(project, dir, dir, true, items)).toThrow(/not inside the project folder/);
        expect(() => excludeEdit(project, dir, path.resolve(dir, '..', 'Other', 'x.cs'), false, items)).toThrow(/not inside the project folder/);
        expect(() => includeEdit(project, dir, dir, true, [at('a.cs')])).toThrow(/not inside the project folder/);
        expect(() => includeEdit(project, dir, at('Gen'), true, [path.resolve(dir, '..', 'b.cs')])).toThrow(/not inside the project folder/);
    });

    test('a folder whose name starts with two dots is inside', () => {
        expect(excludeEdit(project, dir, at('..data'), true, items)).toContain('<None Remove="..data\\**" />');
    });
});

describe('membershipRefusal', () => {
    const solutionProjects = [path.join(dir, 'App.csproj'), at('Tools', 'Tools.csproj'), at('Deep', 'Inner', 'Inner.csproj')];

    test('refuses a folder that is a project of its own, or holds one', () => {
        expect(membershipRefusal(at('Tools'), true, solutionProjects)).toMatch(/project of its own/);
        expect(membershipRefusal(at('Deep'), true, solutionProjects)).toMatch(/project of its own/);
    });

    test('lets other folders and files through', () => {
        expect(membershipRefusal(at('Sub'), true, solutionProjects)).toBeUndefined();
        expect(membershipRefusal(at('Tools', 'T.cs'), false, solutionProjects)).toBeUndefined();
        expect(membershipRefusal(at('Tool'), true, solutionProjects)).toBeUndefined();
    });
});

describe('membershipApplied', () => {
    test('tells whether the evaluated items match what Exclude or Include wanted', () => {
        expect(membershipApplied(items, at('Sub', 'A.cs'), false, true)).toBe(false);
        expect(membershipApplied(items, at('Other.cs'), false, true)).toBe(true);
        expect(membershipApplied(items, at('Sub'), true, true)).toBe(false);
        expect(membershipApplied(items, at('Gen'), true, true)).toBe(true);
        expect(membershipApplied(items, at('Sub', 'A.cs'), false, false)).toBe(true);
        expect(membershipApplied(items, at('Other.cs'), false, false)).toBe(false);
        expect(membershipApplied(items, at('Sub'), true, false)).toBe(true);
        expect(membershipApplied(items, at('Gen'), true, false)).toBe(false);
    });
});

describe('listFilesUnder', () => {
    let root: string;
    beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'list-files-')); });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    test('skips build output, dot folders, node_modules and user files', async () => {
        for (const file of ['a.cs', 'deep/b.txt', 'bin/x.dll', 'obj/y.json', '.git/HEAD', '.vs/state', 'deep/.idea/z',
            'node_modules/p/index.js', 'App.csproj.user', 'App.suo', '.editorconfig']) {
            fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
            fs.writeFileSync(path.join(root, file), '');
        }
        expect((await listFilesUnder(root)).map(file => path.relative(root, file)).sort())
            .toEqual(['.editorconfig', 'a.cs', path.join('deep', 'b.txt')]);
    });
});

describe('includeItemCount', () => {
    test('counts the Include items a folder Include would add, none when it deletes a Remove', () => {
        const files = [at('Gen', 'a.cs'), at('Gen', 'b.cs')];
        expect(includeItemCount(project, dir, at('Gen'), true, files)).toBe(2);
        const excluded = excludeEdit(project, dir, at('Gen'), true, items);
        expect(includeItemCount(excluded, dir, at('Gen'), true, files)).toBe(0);
        expect(includeItemCount(project, dir, at('x.txt'), false, [])).toBe(1);
    });
});
