import {
    addGlobalOptOut, addPackageReference, addPackageVersion, applyEdit, removeGlobalOptOut, removeGlobalPackageReference,
    removePackageVersion, removeVersionOverride, setGlobalPackageVersion, setPackageVersion, setVersionOverride,
} from '../../../../services/nuget/centralPackageEdits';

const props = `<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Newtonsoft.Json" Version="13.0.1" />
    <!-- <PackageVersion Include="Serilog" Version="2.0.0" /> -->
    <PackageVersion Include="Serilog" Version="3.1.1" />
  </ItemGroup>
  <ItemGroup>
    <GlobalPackageReference Include="Microsoft.SourceLink.GitHub" Version="8.0.0" />
  </ItemGroup>
</Project>
`;

const project = `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" />
    <PackageReference Include="Serilog">
      <PrivateAssets>all</PrivateAssets>
    </PackageReference>
  </ItemGroup>

</Project>
`;

const lf = (text: string) => text.replace(/\r\n/g, '').includes('\n');

describe('central package edits: the props file', () => {
    test('setPackageVersion changes only the version of that package (ids ignore case, comments are skipped)', () => {
        expect(setPackageVersion(props, 'serilog', '4.0.0')).toBe(props.replace('Version="3.1.1"', 'Version="4.0.0"'));
    });

    test('setPackageVersion also sets a Version child element', () => {
        const child = props.replace('<PackageVersion Include="Serilog" Version="3.1.1" />',
            '<PackageVersion Include="Serilog">\n      <Version>3.1.1</Version>\n    </PackageVersion>');
        expect(setPackageVersion(child, 'Serilog', '4.0.0')).toBe(child.replace('<Version>3.1.1</Version>', '<Version>4.0.0</Version>'));
    });

    test('setPackageVersion refuses a package the file has no PackageVersion for', () => {
        expect(() => setPackageVersion(props, 'Polly', '8.1.0')).toThrow('No <PackageVersion Include="Polly">');
    });

    test('addPackageVersion goes after the last PackageVersion, with its indentation', () => {
        expect(addPackageVersion(props, 'Polly', '8.1.0')).toBe(props.replace(
            '    <PackageVersion Include="Serilog" Version="3.1.1" />\n',
            '    <PackageVersion Include="Serilog" Version="3.1.1" />\n    <PackageVersion Include="Polly" Version="8.1.0" />\n'));
    });

    test('addPackageVersion is a no-op when the package has one, and opens an ItemGroup in a file without any', () => {
        expect(addPackageVersion(props, 'newtonsoft.json', '1.0.0')).toBe(props);
        const empty = '<Project>\n  <PropertyGroup>\n    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>\n  </PropertyGroup>\n</Project>\n';
        expect(addPackageVersion(empty, 'Polly', '8.1.0')).toContain('  <ItemGroup>\n    <PackageVersion Include="Polly" Version="8.1.0" />\n  </ItemGroup>\n</Project>');
    });

    test('removePackageVersion deletes the line and leaves the commented one', () => {
        const removed = removePackageVersion(props, 'Serilog');
        expect(removed).toBe(props.replace('    <PackageVersion Include="Serilog" Version="3.1.1" />\n', ''));
    });

    test('global references: set the version, remove it with the ItemGroup it leaves empty', () => {
        expect(setGlobalPackageVersion(props, 'Microsoft.SourceLink.GitHub', '8.0.1')).toBe(props.replace('Version="8.0.0"', 'Version="8.0.1"'));
        expect(removeGlobalPackageReference(props, 'Microsoft.SourceLink.GitHub')).toBe(props.replace(
            '  <ItemGroup>\n    <GlobalPackageReference Include="Microsoft.SourceLink.GitHub" Version="8.0.0" />\n  </ItemGroup>\n', ''));
    });

    test('keeps CRLF line endings', () => {
        const crlf = props.replace(/\n/g, '\r\n');
        const added = addPackageVersion(crlf, 'Polly', '8.1.0');
        expect(added).toContain('<PackageVersion Include="Polly" Version="8.1.0" />');
        expect(lf(added)).toBe(false);
        expect(removeGlobalPackageReference(crlf, 'Microsoft.SourceLink.GitHub')).toBe(props.replace(
            '  <ItemGroup>\n    <GlobalPackageReference Include="Microsoft.SourceLink.GitHub" Version="8.0.0" />\n  </ItemGroup>\n', '').replace(/\n/g, '\r\n'));
    });
});

describe('central package edits: the project file', () => {
    test('setVersionOverride adds the attribute after Include, then changes it; removeVersionOverride takes it out again', () => {
        const set = setVersionOverride(project, 'Newtonsoft.Json', '13.0.2');
        expect(set).toBe(project.replace('<PackageReference Include="Newtonsoft.Json" />', '<PackageReference Include="Newtonsoft.Json" VersionOverride="13.0.2" />'));
        expect(setVersionOverride(set, 'Newtonsoft.Json', '13.0.3')).toContain('VersionOverride="13.0.3"');
        expect(removeVersionOverride(set, 'Newtonsoft.Json')).toBe(project);
    });

    test('setVersionOverride works on a PackageReference with children', () => {
        expect(setVersionOverride(project, 'Serilog', '4.0.0')).toContain('<PackageReference Include="Serilog" VersionOverride="4.0.0">');
    });

    test('addPackageReference goes after the last PackageReference, without a Version', () => {
        expect(addPackageReference(project, 'Polly')).toBe(project.replace('    </PackageReference>\n',
            '    </PackageReference>\n    <PackageReference Include="Polly" />\n'));
        expect(addPackageReference(project, 'polly'.toUpperCase())).not.toContain('Version=');
        expect(addPackageReference(project, 'serilog')).toBe(project);
    });

    test('global opt-out: added after the package references, removed again', () => {
        const optedOut = addGlobalOptOut(project, 'Microsoft.SourceLink.GitHub');
        expect(optedOut).toContain('    </PackageReference>\n    <GlobalPackageReference Remove="Microsoft.SourceLink.GitHub" />\n  </ItemGroup>');
        expect(addGlobalOptOut(optedOut, 'microsoft.sourcelink.github')).toBe(optedOut);
        expect(removeGlobalOptOut(optedOut, 'Microsoft.SourceLink.GitHub')).toBe(project);
    });

    test('applyEdit dispatches by kind', () => {
        expect(applyEdit(props, { kind: 'setPackageVersion', file: 'p', id: 'Serilog', version: '4.0.0' })).toContain('Include="Serilog" Version="4.0.0"');
        expect(applyEdit(project, { kind: 'addPackageReference', file: 'p', id: 'Polly' })).toContain('<PackageReference Include="Polly" />');
    });
});
