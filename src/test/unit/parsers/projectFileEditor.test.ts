import { ProjectFileEditor } from '../../../parsers/projectFileEditor';

describe('ProjectFileEditor', () => {
    const sdkProject = `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>

</Project>
`;

    describe('addAssemblyReference', () => {
        test('adds a new ItemGroup at the end of an SDK project', () => {
            expect(ProjectFileEditor.addAssemblyReference(sdkProject, 'Foo', '../libs/Foo.dll')).toBe(`<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <Reference Include="Foo">
      <HintPath>../libs/Foo.dll</HintPath>
    </Reference>
  </ItemGroup>

</Project>
`);
        });

        test('separates the new ItemGroup from a preceding element with an empty line', () => {
            const content = '<Project>\n  <PropertyGroup />\n</Project>\n';

            expect(ProjectFileEditor.addAssemblyReference(content, 'Foo', 'Foo.dll')).toBe(
                '<Project>\n  <PropertyGroup />\n\n  <ItemGroup>\n    <Reference Include="Foo">\n      <HintPath>Foo.dll</HintPath>\n    </Reference>\n  </ItemGroup>\n</Project>\n');
        });

        test('appends after the last existing assembly reference', () => {
            const content = `<Project>
  <ItemGroup>
    <Reference Include="System.Web" />
    <Reference Include="Bar, Version=1.0.0.0, Culture=neutral">
      <HintPath>..\\libs\\Bar.dll</HintPath>
    </Reference>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
  </ItemGroup>
</Project>
`;

            expect(ProjectFileEditor.addAssemblyReference(content, 'Foo', 'libs/Foo.dll')).toBe(`<Project>
  <ItemGroup>
    <Reference Include="System.Web" />
    <Reference Include="Bar, Version=1.0.0.0, Culture=neutral">
      <HintPath>..\\libs\\Bar.dll</HintPath>
    </Reference>
    <Reference Include="Foo">
      <HintPath>libs/Foo.dll</HintPath>
    </Reference>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
  </ItemGroup>
</Project>
`);
        });

        test('preserves CRLF line endings and tab indentation', () => {
            const content = '<Project>\r\n\t<PropertyGroup />\r\n</Project>\r\n';

            expect(ProjectFileEditor.addAssemblyReference(content, 'Foo', 'Foo.dll')).toBe(
                '<Project>\r\n\t<PropertyGroup />\r\n\r\n\t<ItemGroup>\r\n\t\t<Reference Include="Foo">\r\n\t\t\t<HintPath>Foo.dll</HintPath>\r\n\t\t</Reference>\r\n\t</ItemGroup>\r\n</Project>\r\n');
        });

        test('handles </Project> on the same line as other content', () => {
            expect(ProjectFileEditor.addAssemblyReference('<Project></Project>', 'Foo', 'Foo.dll'))
                .toBe('<Project>\n  <ItemGroup>\n    <Reference Include="Foo">\n      <HintPath>Foo.dll</HintPath>\n    </Reference>\n  </ItemGroup>\n</Project>');
        });

        test('escapes special characters', () => {
            const result = ProjectFileEditor.addAssemblyReference(sdkProject, 'A&B', 'libs/A&B.dll');

            expect(result).toContain('<Reference Include="A&amp;B">');
            expect(result).toContain('<HintPath>libs/A&amp;B.dll</HintPath>');
        });

        test('rejects an assembly that is already referenced, ignoring version and case', () => {
            const content = '<Project>\n  <ItemGroup>\n    <Reference Include="Foo, Version=1.0.0.0" />\n  </ItemGroup>\n</Project>\n';

            expect(() => ProjectFileEditor.addAssemblyReference(content, 'foo', 'Foo.dll')).toThrow('already referenced');
        });

        test('does not treat ProjectReference or PackageReference as assembly references', () => {
            const content = '<Project>\n  <ItemGroup>\n    <ProjectReference Include="Foo" />\n    <PackageReference Include="Foo" />\n  </ItemGroup>\n</Project>\n';

            expect(ProjectFileEditor.findAssemblyReferences(content)).toEqual([]);
            expect(ProjectFileEditor.addAssemblyReference(content, 'Foo', 'Foo.dll')).toContain('<Reference Include="Foo">');
        });

        test('throws for content without </Project>', () => {
            expect(() => ProjectFileEditor.addAssemblyReference('<Nope />', 'Foo', 'Foo.dll')).toThrow('missing </Project>');
        });
    });
});
