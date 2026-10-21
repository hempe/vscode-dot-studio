import { ProjectFileEditor } from '../../../parsers/projectFileEditor';

describe('ProjectFileEditor items', () => {
    const sdkProject = `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>

</Project>
`;

    describe('excludeItem', () => {
        test('adds a new ItemGroup with the Remove item', () => {
            expect(ProjectFileEditor.excludeItem(sdkProject, 'Compile', 'Legacy\\Old.cs')).toBe(`<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <Compile Remove="Legacy\\Old.cs" />
  </ItemGroup>

</Project>
`);
        });

        test('adds after the last Remove item of the same type', () => {
            const once = ProjectFileEditor.excludeItem(sdkProject, 'Compile', 'A.cs');
            expect(ProjectFileEditor.excludeItem(once, 'Compile', 'B.cs')).toBe(`<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <Compile Remove="A.cs" />
    <Compile Remove="B.cs" />
  </ItemGroup>

</Project>
`);
        });

        test('is a no-op when the item is already there', () => {
            const once = ProjectFileEditor.excludeItem(sdkProject, 'None', 'x.txt');
            expect(ProjectFileEditor.excludeItem(once, 'None', 'x.txt')).toBe(once);
        });

        test('escapes the path for XML', () => {
            expect(ProjectFileEditor.excludeItem(sdkProject, 'None', 'a&b.txt')).toContain('Remove="a&amp;b.txt"');
        });
    });

    describe('includeItem', () => {
        test('adds a new ItemGroup with the Include item', () => {
            expect(ProjectFileEditor.includeItem(sdkProject, 'Compile', 'Gen\\Made.cs')).toContain(
                '  <ItemGroup>\n    <Compile Include="Gen\\Made.cs" />\n  </ItemGroup>');
        });

        test('keeps CRLF line endings', () => {
            const crlf = sdkProject.replace(/\n/g, '\r\n');
            const edited = ProjectFileEditor.includeItem(crlf, 'None', 'a.txt');
            expect(edited).toContain('<None Include="a.txt" />');
            expect(edited.replace(/\r\n/g, '')).not.toContain('\n');
        });
    });

    describe('removeRemoveItem', () => {
        test('deletes the item and the ItemGroup it leaves empty', () => {
            const excluded = ProjectFileEditor.excludeItem(sdkProject, 'Compile', 'Legacy\\Old.cs');
            expect(ProjectFileEditor.removeRemoveItem(excluded, 'Legacy\\Old.cs')).toEqual({ content: sdkProject, removed: true });
        });

        test('keeps the other items of the group', () => {
            const two = ProjectFileEditor.excludeItem(ProjectFileEditor.excludeItem(sdkProject, 'Compile', 'A.cs'), 'Compile', 'B.cs');
            const result = ProjectFileEditor.removeRemoveItem(two, 'A.cs');
            expect(result.removed).toBe(true);
            expect(result.content).toContain('<Compile Remove="B.cs" />');
            expect(result.content).not.toContain('A.cs');
        });

        test('takes one entry out of a Remove list', () => {
            const content = '<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup>\n    <Compile Remove="A.cs;B.cs" Condition="true" />\n  </ItemGroup>\n</Project>\n';
            const result = ProjectFileEditor.removeRemoveItem(content, 'A.cs');
            expect(result.content).toContain('<Compile Remove="B.cs" Condition="true" />');
        });

        test('reports nothing removed when there is no such item', () => {
            expect(ProjectFileEditor.removeRemoveItem(sdkProject, 'Nope.cs')).toEqual({ content: sdkProject, removed: false });
        });
    });
});
