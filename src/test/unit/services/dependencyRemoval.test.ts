// Dependencies > Remove edits the project file as text: comments, blank lines and line endings stay (review A2-3)
import { removeDependencyEdit } from '../../../services/dependencyRemoval';

const project = (items: string[], eol = '\n') => [
    '<Project Sdk="Microsoft.NET.Sdk">',
    '',
    '  <!-- keep me -->',
    '  <PropertyGroup>',
    '    <TargetFramework>net8.0</TargetFramework>',
    '  </PropertyGroup>',
    '',
    '  <ItemGroup>',
    ...items.map(item => `    ${item}`),
    '  </ItemGroup>',
    '',
    '</Project>',
    '',
].join(eol);

describe('removeDependencyEdit', () => {
    it('removes only the project reference with exactly that name (Core is not MyCore)', () => {
        const content = project([
            '<ProjectReference Include="..\\Core\\Core.csproj" />',
            '<ProjectReference Include="..\\MyCore\\MyCore.csproj" />',
            '<ProjectReference Include="../FooCore/FooCore.csproj" />',
        ]);
        const result = removeDependencyEdit(content, 'projects', 'Core');
        expect(result).toBe(project([
            '<ProjectReference Include="..\\MyCore\\MyCore.csproj" />',
            '<ProjectReference Include="../FooCore/FooCore.csproj" />',
        ]));
    });

    it('keeps comments, blank lines and CRLF', () => {
        const content = project(['<ProjectReference Include="..\\Core\\Core.csproj" />', '<PackageReference Include="Serilog" Version="4.0.0" />'], '\r\n');
        const result = removeDependencyEdit(content, 'projects', 'Core');
        expect(result).toBe(project(['<PackageReference Include="Serilog" Version="4.0.0" />'], '\r\n'));
    });

    it('removes a strong-named assembly reference by its simple name', () => {
        const content = project([
            '<Reference Include="Legacy, Version=1.2.0.0, Culture=neutral, PublicKeyToken=abc">',
            '  <HintPath>..\\lib\\Legacy.dll</HintPath>',
            '</Reference>',
            '<Reference Include="Legacy.Extra" />',
        ]);
        const result = removeDependencyEdit(content, 'assemblies', 'Legacy');
        expect(result).toBe(project(['<Reference Include="Legacy.Extra" />']));
    });

    it('removes a framework reference', () => {
        const content = project(['<FrameworkReference Include="Microsoft.AspNetCore.App" />', '<FrameworkReference Include="Other" />']);
        expect(removeDependencyEdit(content, 'frameworks', 'Microsoft.AspNetCore.App')).toBe(project(['<FrameworkReference Include="Other" />']));
    });

    it('removes a package reference by its exact id, case-insensitively', () => {
        const content = project(['<PackageReference Include="Serilog" Version="4.0.0" />', '<PackageReference Include="Serilog.Sinks.File" Version="6.0.0" />']);
        expect(removeDependencyEdit(content, 'packages', 'serilog')).toBe(project(['<PackageReference Include="Serilog.Sinks.File" Version="6.0.0" />']));
    });

    it('does not touch references inside comments or targets', () => {
        const content = project(['<!-- <ProjectReference Include="..\\Core\\Core.csproj" /> -->', '<ProjectReference Include="..\\Core\\Core.csproj" />']);
        const result = removeDependencyEdit(content, 'projects', 'Core');
        expect(result).toBe(project(['<!-- <ProjectReference Include="..\\Core\\Core.csproj" /> -->']));
    });

    it('returns undefined when there is nothing to remove', () => {
        expect(removeDependencyEdit(project(['<ProjectReference Include="..\\Core\\Core.csproj" />']), 'projects', 'Missing')).toBeUndefined();
    });
});
