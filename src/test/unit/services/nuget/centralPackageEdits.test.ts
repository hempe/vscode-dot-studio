import {
    addGlobalOptOut, addPackageReference, addPackageVersion, applyEdit, packagesUsingProperty, propertyDefinitions, propertyReference,
    propertyUseCount, removeGlobalOptOut, removeGlobalPackageReference, removePackageVersion, removeVersionOverride, setGlobalPackageVersion,
    setPackageVersion, setVersionOverride, setVersionProperty, writtenVersion,
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

    test('setPackageVersion also sets the PackageVersion Update items of the package (MSBuild applies them over the Include)', () => {
        const updated = props.replace('  <ItemGroup>\n    <GlobalPackageReference',
            '  <ItemGroup>\n    <PackageVersion Update="Serilog" Version="3.0.1" />\n    <PackageVersion Update="Serilog" PrivateAssets="all" />\n    <GlobalPackageReference');
        const set = setPackageVersion(updated, 'Serilog', '4.0.0');
        expect(set).toContain('<PackageVersion Include="Serilog" Version="4.0.0" />');
        expect(set).toContain('<PackageVersion Update="Serilog" Version="4.0.0" />');
        expect(set).toContain('<PackageVersion Update="Serilog" PrivateAssets="all" />');
        expect(set).toContain('<PackageVersion Include="Newtonsoft.Json" Version="13.0.1" />');
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

    test('a conditional ItemGroup never gets the new element: the last plain one does, else a new ItemGroup', () => {
        const conditional = project.replace('  <ItemGroup>\n    <PackageReference Include="Newtonsoft.Json" />',
            '  <ItemGroup Condition="\'$(Configuration)\' == \'Debug\'">\n    <PackageReference Include="Newtonsoft.Json" />')
            .replace('  </ItemGroup>\n', '  </ItemGroup>\n\n  <ItemGroup>\n    <Compile Remove="Old.cs" />\n  </ItemGroup>\n');
        const added = addPackageReference(conditional, 'Polly');
        expect(added).toContain('    <Compile Remove="Old.cs" />\n    <PackageReference Include="Polly" />\n  </ItemGroup>');
        const optedOut = addGlobalOptOut(conditional, 'Microsoft.SourceLink.GitHub');
        expect(optedOut).toContain('    <Compile Remove="Old.cs" />\n    <GlobalPackageReference Remove="Microsoft.SourceLink.GitHub" />\n  </ItemGroup>');

        const onlyConditional = project.replace('  <ItemGroup>', '  <ItemGroup Condition="\'$(TargetFramework)\' == \'net8.0\'">');
        const appended = addPackageReference(onlyConditional, 'Polly');
        expect(appended).toContain('  <ItemGroup>\n    <PackageReference Include="Polly" />\n  </ItemGroup>\n');
        expect(appended.slice(appended.indexOf('Condition'), appended.indexOf('</ItemGroup>'))).not.toContain('Polly');

        const conditionalProps = props.replace('  <ItemGroup>\n    <PackageVersion', '  <ItemGroup Condition="\'$(TargetFramework)\' == \'net48\'">\n    <PackageVersion');
        const version = addPackageVersion(conditionalProps, 'Polly', '8.1.0');
        expect(version).toContain('    <GlobalPackageReference Include="Microsoft.SourceLink.GitHub" Version="8.0.0" />\n    <PackageVersion Include="Polly" Version="8.1.0" />\n  </ItemGroup>');
    });

    test('applyEdit dispatches by kind', () => {
        expect(applyEdit(props, { kind: 'setPackageVersion', file: 'p', id: 'Serilog', version: '4.0.0' })).toContain('Include="Serilog" Version="4.0.0"');
        expect(applyEdit(project, { kind: 'addPackageReference', file: 'p', id: 'Polly' })).toContain('<PackageReference Include="Polly" />');
    });
});

describe('versions written as MSBuild properties', () => {
    const shared = `<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
    <SerilogVersion>3.1.1</SerilogVersion>
    <!-- <SerilogVersion>2.0.0</SerilogVersion> -->
  </PropertyGroup>
  <PropertyGroup Condition="'$(Configuration)' == 'Release'">
    <PollyVersion>8.0.0</PollyVersion>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Serilog" Version="$(SerilogVersion)" />
    <PackageVersion Include="Serilog.Extensions.Logging">
      <Version>$(serilogversion)</Version>
    </PackageVersion>
    <PackageVersion Include="Polly" Version="$(PollyVersion)" />
    <PackageVersion Include="Humanizer" Version="$(SerilogVersion)-beta" />
    <PackageVersion Include="Newtonsoft.Json" Version="13.0.1">
      <SerilogVersion>not a property</SerilogVersion>
    </PackageVersion>
  </ItemGroup>
</Project>
`;

    test('the version as written, and the property it is when it is nothing else', () => {
        expect(writtenVersion(shared, 'PackageVersion', 'serilog')).toBe('$(SerilogVersion)');
        expect(writtenVersion(shared, 'PackageVersion', 'Serilog.Extensions.Logging')).toBe('$(serilogversion)');
        expect(writtenVersion(shared, 'PackageVersion', 'Missing')).toBeUndefined();
        expect(propertyReference('$(SerilogVersion)')).toBe('SerilogVersion');
        expect(propertyReference(' $( Serilog_Version.2 ) ')).toBe('Serilog_Version.2');
        expect(propertyReference('$(SerilogVersion)-beta')).toBeUndefined();
        expect(propertyReference('3.1.1')).toBeUndefined();
        expect(propertyReference(undefined)).toBeUndefined();
    });

    test('definitions: in PropertyGroups only, outside comments, conditional when the group has a Condition', () => {
        expect(propertyDefinitions(shared, 'serilogversion').map(definition => [definition.value, definition.conditional])).toEqual([['3.1.1', false]]);
        expect(propertyDefinitions(shared, 'PollyVersion').map(definition => [definition.value, definition.conditional])).toEqual([['8.0.0', true]]);
        const choose = '<Project>\n  <Choose>\n    <When Condition="true">\n      <PropertyGroup>\n        <V>1.0.0</V>\n      </PropertyGroup>\n    </When>\n  </Choose>\n</Project>\n';
        expect(propertyDefinitions(choose, 'V').map(definition => definition.conditional)).toEqual([true]);
    });

    test('setVersionProperty changes the last unconditional definition and nothing else', () => {
        const twice = shared.replace('</PropertyGroup>', '  <SerilogVersion>3.1.2</SerilogVersion>\n  </PropertyGroup>');
        const edited = setVersionProperty(twice, 'SerilogVersion', '4.0.0');
        expect(edited).toBe(twice.replace('<SerilogVersion>3.1.2</SerilogVersion>', '<SerilogVersion>4.0.0</SerilogVersion>'));
        expect(() => setVersionProperty(shared, 'PollyVersion', '8.1.0')).toThrow('No <PollyVersion> in the file');
        expect(applyEdit(shared, { kind: 'setVersionProperty', file: 'p', property: 'SerilogVersion', version: '4.0.0' }))
            .toContain('<SerilogVersion>4.0.0</SerilogVersion>');
    });

    test('the packages whose version is just the property, and every use of it', () => {
        expect(packagesUsingProperty(shared, 'SerilogVersion')).toEqual(['Serilog', 'Serilog.Extensions.Logging']);
        const project = '<Project>\n  <ItemGroup>\n    <PackageReference Include="Serilog.Sinks.File" VersionOverride="$(SerilogVersion)" />\n  </ItemGroup>\n</Project>\n';
        expect(packagesUsingProperty(project, 'SerilogVersion')).toEqual(['Serilog.Sinks.File']);
        // Serilog, Serilog.Extensions.Logging and Humanizer's "$(SerilogVersion)-beta"; not the comment
        expect(propertyUseCount(shared, 'SerilogVersion')).toBe(3);
    });
});
