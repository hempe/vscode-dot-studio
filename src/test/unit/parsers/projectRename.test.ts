import * as path from 'path';
import { renameProjectInSln, renameProjectInSlnx, retargetProjectReferences } from '../../../parsers/projectRename';

describe('renaming a project', () => {
    it('updates its line in a .sln, keeping GUIDs, solution folders and backslashes', () => {
        const sln = [
            'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Api", "src\\Api\\Api.csproj", "{11111111-1111-1111-1111-111111111111}"',
            'EndProject',
            'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Api.Tests", "tests\\Api.Tests\\Api.Tests.csproj", "{22222222-2222-2222-2222-222222222222}"',
            'EndProject',
        ].join('\r\n');

        expect(renameProjectInSln(sln, 'src/Api/Api.csproj', 'src/Api/Shop.Api.csproj', 'Shop.Api')).toBe([
            'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Shop.Api", "src\\Api\\Shop.Api.csproj", "{11111111-1111-1111-1111-111111111111}"',
            'EndProject',
            'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Api.Tests", "tests\\Api.Tests\\Api.Tests.csproj", "{22222222-2222-2222-2222-222222222222}"',
            'EndProject',
        ].join('\r\n'));
    });

    it('updates its Path in a .slnx and leaves the rest alone', () => {
        const slnx = `<Solution>
  <Folder Name="/src/">
    <Project Path="src/Api/Api.csproj" />
    <Project Path="src/Api.Client/Api.Client.csproj" />
  </Folder>
</Solution>`;
        expect(renameProjectInSlnx(slnx, 'src/Api/Api.csproj', 'src/Api/Shop.Api.csproj')).toBe(`<Solution>
  <Folder Name="/src/">
    <Project Path="src/Api/Shop.Api.csproj" />
    <Project Path="src/Api.Client/Api.Client.csproj" />
  </Folder>
</Solution>`);
    });

    it('retargets the project references of other projects, in their style', () => {
        const project = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <ProjectReference Include="..\\..\\src\\Api\\Api.csproj" />
    <ProjectReference Include="../../src/Shared/Shared.csproj" />
  </ItemGroup>
</Project>`;
        const updated = retargetProjectReferences(project, path.resolve('/repo/tests/Api.Tests'), path.resolve('/repo/src/Api/Api.csproj'), path.resolve('/repo/src/Api/Shop.Api.csproj'));

        expect(updated).toContain('<ProjectReference Include="..\\..\\src\\Api\\Shop.Api.csproj" />');
        expect(updated).toContain('<ProjectReference Include="../../src/Shared/Shared.csproj" />');
        expect(retargetProjectReferences(project, path.resolve('/repo/tests/Api.Tests'), path.resolve('/repo/src/Other/Other.csproj'), path.resolve('/repo/src/Other/New.csproj'))).toBe(project);
    });
});
