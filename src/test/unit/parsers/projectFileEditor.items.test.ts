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

    describe('placement (MSBuild applies items in document order)', () => {
        const withGroups = (...groups: string[]) =>
            `<Project Sdk="Microsoft.NET.Sdk">\n\n${groups.map(group => `  <ItemGroup${group}`).join('\n\n')}\n\n</Project>\n`;

        test('an Include goes after a later Remove, not next to the earlier Include of its type', () => {
            const content = withGroups(
                '>\n    <Compile Include="..\\Shared\\S.cs" Link="Linked\\S.cs" />\n  </ItemGroup>',
                '>\n    <Compile Remove="Old\\**" />\n  </ItemGroup>');
            expect(ProjectFileEditor.includeItem(content, 'Compile', 'Old\\O.cs')).toBe(withGroups(
                '>\n    <Compile Include="..\\Shared\\S.cs" Link="Linked\\S.cs" />\n  </ItemGroup>',
                '>\n    <Compile Remove="Old\\**" />\n    <Compile Include="Old\\O.cs" />\n  </ItemGroup>'));
        });

        test('a Remove goes after a later explicit Include', () => {
            const content = withGroups(
                '>\n    <Compile Remove="Old\\**" />\n  </ItemGroup>',
                '>\n    <Compile Include="K.cs" />\n  </ItemGroup>');
            expect(ProjectFileEditor.excludeItem(content, 'Compile', 'K.cs')).toBe(withGroups(
                '>\n    <Compile Remove="Old\\**" />\n  </ItemGroup>',
                '>\n    <Compile Include="K.cs" />\n    <Compile Remove="K.cs" />\n  </ItemGroup>'));
        });

        test('a last ItemGroup with a Condition gets a new group after it', () => {
            const content = withGroups(' Condition="\'$(X)\' == \'1\'">\n    <Compile Include="X.cs" />\n  </ItemGroup>');
            expect(ProjectFileEditor.excludeItem(content, 'Compile', 'K.cs')).toBe(withGroups(
                ' Condition="\'$(X)\' == \'1\'">\n    <Compile Include="X.cs" />\n  </ItemGroup>',
                '>\n    <Compile Remove="K.cs" />\n  </ItemGroup>'));
        });

        test('ItemGroups inside targets do not count', () => {
            const content = '<Project Sdk="Microsoft.NET.Sdk">\n\n  <ItemGroup>\n    <None Include="a.txt" />\n  </ItemGroup>\n\n'
                + '  <Target Name="T">\n    <ItemGroup>\n      <Compile Include="Gen.cs" />\n    </ItemGroup>\n  </Target>\n\n</Project>\n';
            const edited = ProjectFileEditor.excludeItem(content, 'Compile', 'K.cs');
            expect(edited).toBe(content.replace('<None Include="a.txt" />', '<None Include="a.txt" />\n    <Compile Remove="K.cs" />'));
        });

        test('an element already there but followed by an item of its type is added again at the end', () => {
            const content = withGroups('>\n    <Compile Remove="K.cs" />\n    <Compile Include="K.cs" />\n  </ItemGroup>');
            expect(ProjectFileEditor.excludeItem(content, 'Compile', 'K.cs')).toBe(withGroups(
                '>\n    <Compile Remove="K.cs" />\n    <Compile Include="K.cs" />\n    <Compile Remove="K.cs" />\n  </ItemGroup>'));
        });

        test('a group on one line gets the item on a line of its own', () => {
            const content = '<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup><None Include="a.txt" /></ItemGroup>\n</Project>\n';
            expect(ProjectFileEditor.excludeItem(content, 'None', 'b.txt')).toBe(
                '<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup><None Include="a.txt" />\n    <None Remove="b.txt" />\n  </ItemGroup>\n</Project>\n');
        });

        test('a commented-out ItemGroup is not where the item goes', () => {
            const content = '<Project Sdk="Microsoft.NET.Sdk">\n\n  <ItemGroup>\n    <None Include="a.txt" />\n  </ItemGroup>\n\n'
                + '  <!-- <ItemGroup Condition="false"><None Remove="b.txt" /></ItemGroup> -->\n\n</Project>\n';
            expect(ProjectFileEditor.excludeItem(content, 'None', 'b.txt')).toBe(
                content.replace('<None Include="a.txt" />', '<None Include="a.txt" />\n    <None Remove="b.txt" />'));
        });

        test('the Removes of several item types share one ItemGroup', () => {
            const edited = ProjectFileEditor.excludeItem(ProjectFileEditor.excludeItem(sdkProject, 'Compile', 'Sub\\**'), 'None', 'Sub\\**');
            expect(edited).toContain('  <ItemGroup>\n    <Compile Remove="Sub\\**" />\n    <None Remove="Sub\\**" />\n  </ItemGroup>\n');
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

    describe('block-form items', () => {
        const withItems = (items: string) => sdkProject.replace('</Project>', `  <ItemGroup>\n${items}  </ItemGroup>\n\n</Project>`);

        test('removeRemoveItem deletes an empty block-form Remove, and the ItemGroup it leaves empty', () => {
            expect(ProjectFileEditor.removeRemoveItem(withItems('    <Compile Remove="Old.cs"></Compile>\n'), 'Old.cs'))
                .toEqual({ content: sdkProject, removed: true });
        });

        test('removeRemoveItem deletes a Remove whose closing tag is on its own line', () => {
            expect(ProjectFileEditor.removeRemoveItem(withItems('    <None Remove="notes.txt">\n    </None>\n'), 'notes.txt'))
                .toEqual({ content: sdkProject, removed: true });
        });

        test('removeRemoveItem keeps the other entries of a block-form Remove', () => {
            expect(ProjectFileEditor.removeRemoveItem(withItems('    <Compile Remove="A.cs;Old.cs"></Compile>\n'), 'Old.cs').content)
                .toBe(withItems('    <Compile Remove="A.cs"></Compile>\n'));
        });

        test('an item with metadata children does not hide the items after it', () => {
            const content = withItems('    <None Include="readme.txt">\n      <Pack>true</Pack>\n    </None>\n    <Compile Remove="Old.cs" />\n');
            expect(ProjectFileEditor.removeRemoveItem(content, 'Old.cs').content)
                .toBe(withItems('    <None Include="readme.txt">\n      <Pack>true</Pack>\n    </None>\n'));
        });

        test('excludeItem sees an existing block-form Remove', () => {
            const content = withItems('    <Compile Remove="Old.cs"></Compile>\n');
            expect(ProjectFileEditor.excludeItem(content, 'Compile', 'Old.cs')).toBe(content);
        });

        test('includeItem sees an existing Include with metadata children', () => {
            const content = withItems('    <None Include="Gen\\Made.txt">\n      <CopyToOutputDirectory>Always</CopyToOutputDirectory>\n    </None>\n');
            expect(ProjectFileEditor.includeItem(content, 'None', 'Gen\\Made.txt')).toBe(content);
        });

        test('block-form items in comments and targets are still skipped', () => {
            const content = withItems('    <!-- <Compile Remove="Old.cs"></Compile> -->\n')
                .replace('</Project>', '<Target Name="T">\n    <ItemGroup>\n      <Compile Remove="Old.cs"></Compile>\n    </ItemGroup>\n  </Target>\n</Project>');
            expect(ProjectFileEditor.removeRemoveItem(content, 'Old.cs')).toEqual({ content, removed: false });
        });
    });

    describe('conditional groups and CDATA', () => {
        it('removes an ItemGroup with a Condition or a Label when its last item goes', () => {
            for (const open of ['<ItemGroup Condition="\'$(A)\' == \'>\'">', '<ItemGroup Label="x">']) {
                const content = `<Project Sdk="Microsoft.NET.Sdk">\n  ${open}\n    <Compile Include="A.cs" />\n  </ItemGroup>\n</Project>\n`;
                const start = content.indexOf('<Compile');
                expect(ProjectFileEditor.deleteElement(content, start, content.indexOf('/>', start) + 2)).toBe('<Project Sdk="Microsoft.NET.Sdk">\n</Project>\n');
            }
        });

        it('does not count an item inside CDATA', () => {
            const content = '<Project>\n  <PropertyGroup><X><![CDATA[<Compile Remove="A.cs" />]]></X></PropertyGroup>\n</Project>\n';
            const ranges = ProjectFileEditor.ignoredRanges(content);
            expect(ProjectFileEditor.inRanges(ranges, content.indexOf('<Compile'))).toBe(true);
        });
    });
});
