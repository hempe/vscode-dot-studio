jest.mock('vscode', () => ({}), { virtual: true });

import * as path from 'path';
import { ProjectFileEditor } from '../../../../parsers/projectFileEditor';
import { userSecretsIdProblem, userSecretsPath } from '../../../../services/project/userSecrets';

describe('user secrets', () => {
    describe('ProjectFileEditor.userSecretsId / addUserSecretsId', () => {
        const project = `<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Foo" Version="1.0.0" />
  </ItemGroup>

</Project>
`;

        it('adds the id at the end of the first PropertyGroup, like `dotnet user-secrets init`', () => {
            expect(ProjectFileEditor.addUserSecretsId(project, '0c1a2b3c-aaaa-bbbb-cccc-1234567890ab')).toBe(`<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <UserSecretsId>0c1a2b3c-aaaa-bbbb-cccc-1234567890ab</UserSecretsId>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Foo" Version="1.0.0" />
  </ItemGroup>

</Project>
`);
        });

        it('adds a PropertyGroup to projects without one', () => {
            expect(ProjectFileEditor.addUserSecretsId('<Project Sdk="Microsoft.NET.Sdk">\r\n</Project>\r\n', 'id-1'))
                .toBe('<Project Sdk="Microsoft.NET.Sdk">\r\n  <PropertyGroup>\r\n    <UserSecretsId>id-1</UserSecretsId>\r\n  </PropertyGroup>\r\n</Project>\r\n');
        });

        it('reads the id', () => {
            expect(ProjectFileEditor.userSecretsId(project)).toBeUndefined();
            expect(ProjectFileEditor.userSecretsId(ProjectFileEditor.addUserSecretsId(project, 'abc'))).toBe('abc');
            expect(ProjectFileEditor.userSecretsId('<Project><PropertyGroup><UserSecretsId> spaced </UserSecretsId></PropertyGroup></Project>')).toBe('spaced');
        });
    });

    describe('userSecretsPath', () => {
        it('is where ASP.NET Core reads the secrets on each platform', () => {
            expect(userSecretsPath('abc', 'linux', { HOME: '/home/me' })).toBe(path.join('/home/me', '.microsoft', 'usersecrets', 'abc', 'secrets.json'));
            expect(userSecretsPath('abc', 'darwin', { HOME: '/Users/me' })).toBe(path.join('/Users/me', '.microsoft', 'usersecrets', 'abc', 'secrets.json'));
            expect(userSecretsPath('abc', 'win32', { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }))
                .toBe(path.join('C:\\Users\\me\\AppData\\Roaming', 'Microsoft', 'UserSecrets', 'abc', 'secrets.json'));
        });
    });
});

describe('userSecretsIdProblem (review A6-6)', () => {
    it('accepts ids that are valid folder names', () => {
        for (const id of ['aspnet-App-1a2b3c', '1b3c1b3c-1b3c-1b3c-1b3c-1b3c1b3c1b3c', 'shared-team-id', 'My.Id']) {
            expect(userSecretsIdProblem(id)).toBeUndefined();
        }
    });

    it('refuses ids that leave the secrets folder or are not folder names', () => {
        for (const id of ['../x', '..', 'a/b', 'a\\b', 'a:b', 'a*b', '.']) {
            expect(userSecretsIdProblem(id)).toEqual(expect.any(String));
        }
    });
});
