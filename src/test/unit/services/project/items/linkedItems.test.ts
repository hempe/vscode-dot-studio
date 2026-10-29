import * as path from 'path';
import { linkedDeleteDetail, multiDeleteQuestion, removeLinkedItem } from '../../../../services/projectItems/linkedItems';
import { parseMsbuildItems } from '../../../../services/projectItems/projectItems';

const root = path.resolve('/repo');
const projectDir = path.join(root, 'App');
const shared = path.join(root, 'Shared', 'Shared.cs');

const project = (items: string) => `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <Compile Include="Local.cs" />
${items}
  </ItemGroup>

</Project>
`;

describe('removeLinkedItem', () => {
    test('deletes the self-closing item with a Link attribute', () => {
        const content = project('    <Compile Include="..\\Shared\\Shared.cs" Link="Linked\\Shared.cs" />');
        expect(removeLinkedItem(content, projectDir, shared, ['Compile'])).toEqual({ content: project('').replace('\n\n  </ItemGroup>', '\n  </ItemGroup>'), removed: true });
    });

    test('deletes the block form with a <Link> child element (old-style projects, Visual Studio\'s Add As Link)', () => {
        const block = '    <Compile Include="..\\Shared\\Shared.cs">\n      <Link>Shared.cs</Link>\n    </Compile>';
        const { content, removed } = removeLinkedItem(project(block), projectDir, shared, ['Compile']);
        expect(removed).toBe(true);
        expect(content).not.toContain('Shared');
        expect(content).toContain('<Compile Include="Local.cs" />');
    });

    test('takes the ItemGroup it leaves empty with it', () => {
        const content = project('').replace('    <Compile Include="Local.cs" />\n\n', '')
            .replace('  <ItemGroup>\n', '  <ItemGroup>\n    <None Include="../Shared/Shared.cs" Link="Shared.cs" />\n');
        const { content: edited } = removeLinkedItem(content, projectDir, shared, ['None']);
        expect(edited).not.toContain('<ItemGroup>');
        expect(edited).toContain('</PropertyGroup>');
    });

    test('removes it under every item type MSBuild lists the file under, and nothing else', () => {
        const content = project('    <Compile Include="..\\Shared\\Shared.cs" Link="Shared.cs" />\n    <None Include="..\\Shared\\Shared.cs" Link="Shared.cs" />\n    <Content Include="..\\Shared\\Other.cs" Link="Other.cs" />');
        const { content: edited } = removeLinkedItem(content, projectDir, shared, ['Compile', 'None']);
        expect(edited).not.toContain('Shared.cs');
        expect(edited).toContain('<Content Include="..\\Shared\\Other.cs" Link="Other.cs" />');
    });

    test('leaves items in comments and targets, wildcards, lists and properties: removed is false', () => {
        for (const item of [
            '    <!-- <Compile Include="..\\Shared\\Shared.cs" Link="Shared.cs" /> -->',
            '    <Compile Include="..\\Shared\\*.cs" LinkBase="Shared" />',
            '    <Compile Include="..\\Shared\\Shared.cs;..\\Shared\\Other.cs" LinkBase="Shared" />',
            '    <Compile Include="$(SharedDir)Shared.cs" Link="Shared.cs" />',
        ]) {
            const content = project(item);
            expect(removeLinkedItem(content, projectDir, shared, ['Compile'])).toEqual({ content, removed: false });
        }
        const inTarget = project('').replace('</Project>', '  <Target Name="T">\n    <ItemGroup>\n      <Compile Include="..\\Shared\\Shared.cs" Link="Shared.cs" />\n    </ItemGroup>\n  </Target>\n</Project>');
        expect(removeLinkedItem(inTarget, projectDir, shared, ['Compile']).removed).toBe(false);
    });

    test('an item type it was not asked for, or none at all, is left alone', () => {
        const content = project('    <None Include="..\\Shared\\Shared.cs" Link="Shared.cs" />');
        expect(removeLinkedItem(content, projectDir, shared, ['Compile']).removed).toBe(false);
        expect(removeLinkedItem(content, projectDir, shared, []).removed).toBe(false);
    });

    test('keeps CRLF line endings', () => {
        const content = project('    <Compile Include="..\\Shared\\Shared.cs" Link="Shared.cs" />').replace(/\n/g, '\r\n');
        const { content: edited } = removeLinkedItem(content, projectDir, shared, ['Compile']);
        expect(edited).not.toContain('Shared.cs');
        expect(edited.replace(/\r\n/g, '')).not.toContain('\n');
    });
});

describe('ProjectItems.isLinked', () => {
    test('is true for a file listed at a Link path, false for the project\'s own files and unknown ones', () => {
        const items = parseMsbuildItems(JSON.stringify({
            Items: { Compile: [
                { Identity: 'Local.cs', FullPath: path.join(projectDir, 'Local.cs') },
                { Identity: '..\\Shared\\Shared.cs', FullPath: shared, Link: 'Linked\\Shared.cs' },
            ] },
        }), projectDir)!;
        expect(items.isLinked(shared)).toBe(true);
        expect(items.isLinked(path.join(projectDir, 'Local.cs'))).toBe(false);
        expect(items.isLinked(path.join(root, 'Other.cs'))).toBe(false);
    });
});

describe('the confirmations', () => {
    test('Delete on a linked file names the real file, the projects that link it, and Remove Link', () => {
        const detail = linkedDeleteDetail(shared, ['App']);
        expect(detail).toContain(shared);
        expect(detail).toContain('outside the project');
        expect(detail).toContain('App then lists a missing file');
        expect(detail).toContain('Remove Link');
        expect(linkedDeleteDetail(shared, ['App', 'Web'])).toContain('App, Web then list a missing file');
    });

    test('Delete on several nodes says which of them are linked files', () => {
        expect(multiDeleteQuestion(3, [])).toBe('Delete 3 items? They are moved to the trash.');
        expect(multiDeleteQuestion(3, [shared])).toBe(`Delete 3 items? They are moved to the trash. One of them is a linked file: the real file outside the project is deleted (${shared}). To remove only a link, use Remove Link on it.`);
        expect(multiDeleteQuestion(3, [shared, shared])).toContain('2 of them are linked files: the real files outside the project are deleted');
    });
});
