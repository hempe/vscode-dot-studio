import * as path from 'path';
import { parseMsbuildPackages, ProjectPackages } from '../../../../services/nuget/centralPackages';
import { ProjectState } from '../../../../services/nuget/centralPackagePlan';
import { PackageEdit } from '../../../../services/nuget/centralPackageEdits';
import { changesOnlyItself, findVersionProperties, propertyEdit, propertyQuestion } from '../../../../services/nuget/versionProperties';

const root = path.resolve('/repo');
const at = (...parts: string[]) => path.join(root, ...parts);
const packagesProps = at('Directory.Packages.props');
const buildProps = at('Directory.Build.props');

/** Files by path; `chain` gives a file alone (no imports) */
let files: Record<string, string>;
const read = (file: string) => files[file];
const chain = (file: string) => [file];

const props = (definitions: string, versions: string) => `<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>${definitions}
  </PropertyGroup>
  <ItemGroup>
${versions}
  </ItemGroup>
</Project>
`;
const project = (body = '') => `<Project Sdk="Microsoft.NET.Sdk">${body}</Project>`;

/** A project as MSBuild evaluates it: the central versions (evaluated) and the packages it references */
const state = (name: string, references: string[], versions: Record<string, string>, withBuildProps = false): ProjectState => ({
    name,
    path: at(name, `${name}.csproj`),
    packages: parseMsbuildPackages(JSON.stringify({
        Properties: { ManagePackageVersionsCentrally: 'true', DirectoryPackagesPropsPath: packagesProps, DirectoryBuildPropsPath: withBuildProps ? buildProps : '' },
        Items: {
            PackageReference: references.map(id => ({ Identity: id, DefiningProjectFullPath: at(name, `${name}.csproj`) })),
            PackageVersion: Object.entries(versions).map(([id, version]) => ({ Identity: id, Version: version, DefiningProjectFullPath: packagesProps })),
        },
    }), at(name, `${name}.csproj`)) as ProjectPackages,
});

const versions = { Serilog: '3.1.1', 'Serilog.Extensions.Logging': '3.1.1', Polly: '8.1.0' };
const edit = (id: string, version = '4.0.0'): PackageEdit => ({ kind: 'setPackageVersion', file: packagesProps, id, version });

describe('findVersionProperties', () => {
    beforeEach(() => {
        files = {
            [packagesProps]: props('\n    <SerilogVersion>3.1.1</SerilogVersion>',
                '    <PackageVersion Include="Serilog" Version="$(SerilogVersion)" />\n'
                + '    <PackageVersion Include="Serilog.Extensions.Logging" Version="$(SerilogVersion)" />\n'
                + '    <PackageVersion Include="Polly" Version="8.1.0" />'),
            [at('A', 'A.csproj')]: project(),
            [at('B', 'B.csproj')]: project(),
        };
    });
    const states = () => [state('A', ['Serilog'], versions), state('B', ['Serilog.Extensions.Logging'], versions)];

    test('a literal version is not listed', () => {
        expect(findVersionProperties([edit('Polly', '8.2.0')], states(), read, chain)).toEqual([]);
    });

    test('a property shared with another package: its definition, the other package and the project using it', () => {
        const [entry] = findVersionProperties([edit('Serilog')], states(), read, chain);
        expect(entry).toEqual(expect.objectContaining({
            property: 'SerilogVersion', definition: packagesProps, alsoPackages: ['Serilog.Extensions.Logging'], alsoProjects: ['B'], otherUses: 0,
        }));
        expect(changesOnlyItself(entry)).toBe(false);
        expect(propertyEdit(entry)).toEqual({ kind: 'setVersionProperty', file: packagesProps, property: 'SerilogVersion', version: '4.0.0' });
        expect(propertyQuestion(entry)).toEqual({
            message: "Serilog's version is $(SerilogVersion), which other packages follow too.",
            detail: 'Change SerilogVersion to 4.0.0 in Directory.Packages.props: this also changes Serilog.Extensions.Logging (used by B). '
                + 'Set Serilog Only writes 4.0.0 instead of $(SerilogVersion): Serilog no longer follows it.',
            change: 'Change SerilogVersion',
            only: 'Set Serilog Only',
        });
    });

    test('both packages of the property changed to the same version: nothing else follows it, no question', () => {
        const found = findVersionProperties([edit('Serilog'), edit('Serilog.Extensions.Logging')], states(), read, chain);
        expect(found.map(entry => [entry.edit.id, entry.alsoPackages, changesOnlyItself(entry)])).toEqual([
            ['Serilog', [], true], ['Serilog.Extensions.Logging', [], true],
        ]);
    });

    test('to different versions: the property cannot follow both', () => {
        const found = findVersionProperties([edit('Serilog'), edit('Serilog.Extensions.Logging', '9.0.0')], states(), read, chain);
        expect(found.map(entry => entry.refusal)).toEqual(['conflict', 'conflict']);
        expect(found[0].definition).toBeUndefined();
        expect(propertyQuestion(found[0]).change).toBeUndefined();
        expect(propertyQuestion(found[0]).detail).toBe('Other packages that follow SerilogVersion get other versions in this change. '
            + 'Set Serilog Only writes 4.0.0 instead of $(SerilogVersion): Serilog no longer follows it.');
    });

    test('defined in Directory.Build.props; a later definition in Directory.Packages.props wins', () => {
        files[buildProps] = '<Project>\n  <PropertyGroup>\n    <SerilogVersion>3.1.1</SerilogVersion>\n  </PropertyGroup>\n</Project>\n';
        files[packagesProps] = files[packagesProps].replace('\n    <SerilogVersion>3.1.1</SerilogVersion>', '');
        const withBuildProps = [state('A', ['Serilog'], versions, true), state('B', ['Serilog.Extensions.Logging'], versions, true)];
        expect(findVersionProperties([edit('Serilog')], withBuildProps, read, chain)[0].definition).toBe(buildProps);
        files[packagesProps] = files[packagesProps].replace('<ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>',
            '<ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>\n    <SerilogVersion>3.1.1</SerilogVersion>');
        expect(findVersionProperties([edit('Serilog')], withBuildProps, read, chain)[0].definition).toBe(packagesProps);
    });

    test('not editable: not found, under a condition, or another value than MSBuild evaluated', () => {
        const refusal = () => findVersionProperties([edit('Serilog')], states(), read, chain)[0].refusal;
        const original = files[packagesProps];
        files[packagesProps] = original.replace('<SerilogVersion>3.1.1</SerilogVersion>', '');
        expect(refusal()).toBe('notFound');
        files[packagesProps] = original.replace('<SerilogVersion>3.1.1</SerilogVersion>', '<SerilogVersion Condition="true">3.1.1</SerilogVersion>');
        expect(refusal()).toBe('conditional');
        files[packagesProps] = original;
        files[at('A', 'A.csproj')] = project('<PropertyGroup><SerilogVersion>3.1.1</SerilogVersion></PropertyGroup>');
        expect(refusal()).toBe('differs');
        files[at('A', 'A.csproj')] = project();
        const evaluatedOtherwise = [state('A', ['Serilog'], { ...versions, Serilog: '3.0.0' }), state('B', ['Serilog.Extensions.Logging'], versions)];
        expect(findVersionProperties([edit('Serilog')], evaluatedOtherwise, read, chain)[0].refusal).toBe('differs');
        expect(propertyQuestion({ ...findVersionProperties([edit('Serilog')], evaluatedOtherwise, read, chain)[0] }).message)
            .toBe("Serilog's version is $(SerilogVersion), which cannot be changed here.");
    });

    test('used only by the edited package: changed without a question', () => {
        files[packagesProps] = files[packagesProps].replace('Include="Serilog.Extensions.Logging" Version="$(SerilogVersion)"', 'Include="Serilog.Extensions.Logging" Version="3.1.1"');
        expect(changesOnlyItself(findVersionProperties([edit('Serilog')], states(), read, chain)[0])).toBe(true);
    });
});
