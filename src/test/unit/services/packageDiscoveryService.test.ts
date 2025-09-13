import * as sinon from 'sinon';
import * as fs from 'fs';
import { PackageDiscoveryService, InstalledPackage } from '../../../services/packageDiscoveryService';

describe('PackageDiscoveryService', () => {
    afterEach(() => {
        sinon.restore();
    });

    describe('discoverInstalledPackages', () => {
        it('should discover packages from solution with single project', async () => {
            // Mock solution file content
            const mockSolutionContent = `
Microsoft Visual Studio Solution File, Format Version 12.00
Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "TestProject", "TestProject\\TestProject.csproj", "{12345678-1234-1234-1234-123456789012}"
EndProject
Global
EndGlobal`;

            // Mock project file content
            const mockProjectContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net6.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Include="Serilog" Version="2.12.0" />
  </ItemGroup>
</Project>`;

            const readFileStub = sinon.stub(fs.promises, 'readFile');
            readFileStub.withArgs('/path/to/test.sln', 'utf8').resolves(mockSolutionContent);
            readFileStub.withArgs(sinon.match(/TestProject\.csproj$/), 'utf8').resolves(mockProjectContent);

            const existsSyncStub = sinon.stub(fs, 'existsSync').returns(true);

            const result = await PackageDiscoveryService.discoverInstalledPackages('/path/to/test.sln');

            sinon.assert.match(result.length, 2);
            sinon.assert.match(result[0].id, 'Newtonsoft.Json');
            sinon.assert.match(result[0].version, '13.0.3');
            sinon.assert.match(result[0].projectName, 'TestProject');
            sinon.assert.match(result[1].id, 'Serilog');
            sinon.assert.match(result[1].version, '2.12.0');
        });

        it('should handle projects without packages', async () => {
            const mockSolutionContent = `
Microsoft Visual Studio Solution File, Format Version 12.00
Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "EmptyProject", "EmptyProject\\EmptyProject.csproj", "{12345678-1234-1234-1234-123456789012}"
EndProject`;

            const mockProjectContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net6.0</TargetFramework>
  </PropertyGroup>
</Project>`;

            const readFileStub = sinon.stub(fs.promises, 'readFile');
            readFileStub.withArgs('/path/to/test.sln', 'utf8').resolves(mockSolutionContent);
            readFileStub.withArgs('/path/to/EmptyProject/EmptyProject.csproj', 'utf8').resolves(mockProjectContent);

            sinon.stub(fs, 'existsSync').returns(true);

            const result = await PackageDiscoveryService.discoverInstalledPackages('/path/to/test.sln');

            sinon.assert.match(result.length, 0);
        });

        it('should deduplicate packages with same ID and version', async () => {
            const mockSolutionContent = `
Microsoft Visual Studio Solution File, Format Version 12.00
Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "Project1", "Project1\\Project1.csproj", "{12345678-1234-1234-1234-123456789012}"
EndProject
Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "Project2", "Project2\\Project2.csproj", "{12345678-1234-1234-1234-123456789013}"
EndProject`;

            const mockProjectContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net6.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
  </ItemGroup>
</Project>`;

            const readFileStub = sinon.stub(fs.promises, 'readFile');
            readFileStub.withArgs('/path/to/test.sln', 'utf8').resolves(mockSolutionContent);
            readFileStub.withArgs('/path/to/Project1/Project1.csproj', 'utf8').resolves(mockProjectContent);
            readFileStub.withArgs('/path/to/Project2/Project2.csproj', 'utf8').resolves(mockProjectContent);

            sinon.stub(fs, 'existsSync').returns(true);

            const result = await PackageDiscoveryService.discoverInstalledPackages('/path/to/test.sln');

            // Should only have one entry despite two projects having the same package
            sinon.assert.match(result.length, 1);
            sinon.assert.match(result[0].id, 'Newtonsoft.Json');
            sinon.assert.match(result[0].version, '13.0.3');
        });
    });

    describe('getProjectPackageInfo', () => {
        it('should return detailed project package information', async () => {
            const mockSolutionContent = `
Microsoft Visual Studio Solution File, Format Version 12.00
Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "TestProject", "TestProject\\TestProject.csproj", "{12345678-1234-1234-1234-123456789012}"
EndProject`;

            const mockProjectContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net6.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
  </ItemGroup>
</Project>`;

            const readFileStub = sinon.stub(fs.promises, 'readFile');
            readFileStub.withArgs('/path/to/test.sln', 'utf8').resolves(mockSolutionContent);
            readFileStub.withArgs('/path/to/TestProject/TestProject.csproj', 'utf8').resolves(mockProjectContent);

            sinon.stub(fs, 'existsSync').returns(true);

            const result = await PackageDiscoveryService.getProjectPackageInfo('/path/to/test.sln');

            sinon.assert.match(result.length, 1);
            sinon.assert.match(result[0].projectName, 'TestProject');
            sinon.assert.match(result[0].targetFramework, 'net6.0');
            sinon.assert.match(result[0].packages.length, 1);
            sinon.assert.match(result[0].packages[0].id, 'Newtonsoft.Json');
        });
    });

    describe('getPackageUsage', () => {
        it('should return projects using specific package', async () => {
            const mockSolutionContent = `
Microsoft Visual Studio Solution File, Format Version 12.00
Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "Project1", "Project1\\Project1.csproj", "{12345678-1234-1234-1234-123456789012}"
EndProject
Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "Project2", "Project2\\Project2.csproj", "{12345678-1234-1234-1234-123456789013}"
EndProject`;

            const mockProject1Content = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
  </ItemGroup>
</Project>`;

            const mockProject2Content = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Serilog" Version="2.12.0" />
  </ItemGroup>
</Project>`;

            const readFileStub = sinon.stub(fs.promises, 'readFile');
            readFileStub.withArgs('/path/to/test.sln', 'utf8').resolves(mockSolutionContent);
            readFileStub.withArgs('/path/to/Project1/Project1.csproj', 'utf8').resolves(mockProject1Content);
            readFileStub.withArgs('/path/to/Project2/Project2.csproj', 'utf8').resolves(mockProject2Content);

            sinon.stub(fs, 'existsSync').returns(true);

            const result = await PackageDiscoveryService.getPackageUsage('/path/to/test.sln', 'Newtonsoft.Json');

            sinon.assert.match(result.length, 1);
            sinon.assert.match(result[0].id, 'Newtonsoft.Json');
            sinon.assert.match(result[0].projectName, 'Project1');
        });
    });
});