import * as path from 'path';
import { excludeEdit, includeEdit, membershipRefusal } from '../../../../services/projectItems/projectItemEdits';
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
