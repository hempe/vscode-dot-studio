import * as fs from 'fs';
import * as path from 'path';
import { ProjectFileEditor } from '../../../parsers/projectFileEditor';

const fixture = path.join(__dirname, '../../../__fixtures__/service-references/PayLoop/PayLoop.csproj');

const sdkProject = `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
  </PropertyGroup>

</Project>
`;

describe('ProjectFileEditor WCFMetadata', () => {
    it('adds the item in its own ItemGroup, SDK template style', () => {
        expect(ProjectFileEditor.ensureWcfMetadata(sdkProject)).toBe(`<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <WCFMetadata Include="Connected Services" />
  </ItemGroup>

</Project>
`);
    });

    it('leaves a project that has it unchanged', () => {
        const content = fs.readFileSync(fixture, 'utf8');
        expect(ProjectFileEditor.ensureWcfMetadata(content)).toBe(content);
    });

    it('removes the item and its then empty ItemGroup', () => {
        const content = fs.readFileSync(fixture, 'utf8');
        const removed = ProjectFileEditor.removeWcfMetadata(content);
        expect(removed).not.toContain('WCFMetadata');
        expect(removed).not.toMatch(/<ItemGroup>\s*<\/ItemGroup>/);
        expect(removed).toContain('<Reference Include="System.ServiceModel" />');
        expect(removed).toMatch(/<\/ItemGroup>\n<\/Project>\n$/);
        expect(ProjectFileEditor.removeWcfMetadata(ProjectFileEditor.ensureWcfMetadata(sdkProject))).toBe(sdkProject);
    });
});
