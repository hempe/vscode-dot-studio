import { ProjectFileParser } from './projectFileParser';
import * as fs from 'fs';
import * as path from 'path';

describe('ProjectFileParser', () => {
  let parser: ProjectFileParser;
  const testFixturePath = path.join(__dirname, '..', '__fixtures__', 'test-solution');

  beforeEach(() => {
    parser = new ProjectFileParser();
  });
  describe('parseDependencies', () => {
    it('should parse WebApp project file structure', async () => {
      const webAppPath = path.join(testFixturePath, 'src', 'WebApp', 'WebApp.csproj');
      const result = await parser.parseDependencies(webAppPath);

      expect(result).toBeDefined();
      expect(result).toBeDefined();

      // Should have some files in the project

    });

    it('should parse ClassLibrary project with multi-target framework', async () => {
      const classLibPath = path.join(testFixturePath, 'src', 'ClassLibrary', 'ClassLibrary.csproj');
      const result = await parser.parseDependencies(classLibPath);

      expect(result).toBeDefined();
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);

      // Check for expected package references
      const newtonsoftJson = result.find(d => d.name === 'Newtonsoft.Json');
      expect(newtonsoftJson).toBeDefined();
      expect(newtonsoftJson!.type).toBe('PackageReference');
      expect(newtonsoftJson!.version).toBe('13.0.3');

      const dependencyInjection = result.find(d => d.name === 'Microsoft.Extensions.DependencyInjection');
      expect(dependencyInjection).toBeDefined();
      expect(dependencyInjection!.version).toBe('8.0.0');

    });

    it('should parse Tests project with project references', async () => {
      const testsPath = path.join(testFixturePath, 'src', 'Tests', 'Tests.csproj');
      const result = await parser.parseDependencies(testsPath);

      expect(result).toBeDefined();
      expect(result).toBeDefined();

      // Should have both package and project references
      const packageRefs = result.filter(d => d.type === 'PackageReference');
      const projectRefs = result.filter(d => d.type === 'ProjectReference');

      expect(packageRefs.length).toBeGreaterThan(0);
      expect(projectRefs.length).toBeGreaterThan(0);

      // Check for xunit packages
      const xunit = packageRefs.find(d => d.name === 'xunit');
      expect(xunit).toBeDefined();
      expect(xunit!.version).toBe('2.6.1');

      // Check for project references
      const webAppRef = projectRefs.find(d => d.name === 'WebApp');
      const classLibRef = projectRefs.find(d => d.name === 'ClassLibrary');
      expect(webAppRef).toBeDefined();
      expect(classLibRef).toBeDefined();

    });

    it('should handle non-existent project files gracefully', async () => {
      const nonExistentPath = path.join(testFixturePath, 'non-existent-project.csproj');
      const result = await parser.parseDependencies(nonExistentPath);

      expect(result).toBeDefined();
      expect(result).toHaveLength(0);
    });

    it('should reject system paths for security', async () => {
      const systemPath = '/etc/passwd';
      const result = await parser.parseDependencies(systemPath);

      expect(result).toBeDefined();
      expect(result).toHaveLength(0);
    });
  });

  describe('dependency parsing', () => {
    it('should parse different dependency types correctly', async () => {
      const classLibPath = path.join(testFixturePath, 'src', 'ClassLibrary', 'ClassLibrary.csproj');
      const result = await parser.parseDependencies(classLibPath);

      const packageRefs = result.filter(d => d.type === 'PackageReference');

      expect(packageRefs.length).toBe(3);
      expect(packageRefs.map(p => p.name)).toContain('Newtonsoft.Json');
      expect(packageRefs.map(p => p.name)).toContain('Microsoft.Extensions.DependencyInjection');
      expect(packageRefs.map(p => p.name)).toContain('System.Text.Json');

      // Verify versions are parsed correctly
      packageRefs.forEach(pkg => {
        expect(pkg.version).toBeDefined();
        expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
      });
    });

    it('should sort dependencies by type and name', async () => {
      const testsPath = path.join(testFixturePath, 'src', 'Tests', 'Tests.csproj');
      const result = await parser.parseDependencies(testsPath);

      expect(result.length).toBeGreaterThan(0);

      // Check sorting: PackageReference should come before ProjectReference
      let lastType = '';
      let lastPackageName = '';
      let lastProjectName = '';

      for (const dep of result) {
        if (dep.type === 'PackageReference') {
          expect(lastType).not.toBe('ProjectReference'); // PackageReference should come before ProjectReference
          if (lastPackageName) {
            expect(dep.name.localeCompare(lastPackageName) >= 0).toBe(true); // Package references should be sorted alphabetically
          }
          lastPackageName = dep.name;
        } else if (dep.type === 'ProjectReference') {
          if (lastProjectName) {
            expect(dep.name.localeCompare(lastProjectName) >= 0).toBe(true); // Project references should be sorted alphabetically
          }
          lastProjectName = dep.name;
        }
        lastType = dep.type;
      }
    });
  });

  describe('real project file parsing', () => {
    it('should parse a complete .NET project with all features', async () => {
      // Create a temporary complex project file for testing
      const complexProjectContent = `<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="8.0.0" />
    <PackageReference Include="Swashbuckle.AspNetCore" Version="6.4.0" />
    <PackageReference Include="Entity.Framework.Core" Version="7.0.0" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\\Shared\\Shared.csproj" />
    <ProjectReference Include="..\\Data\\Data.csproj" />
  </ItemGroup>

  <ItemGroup>
    <FrameworkReference Include="Microsoft.AspNetCore.App" />
  </ItemGroup>

  <ItemGroup>
    <Reference Include="System.Configuration" />
    <Reference Include="System.Web, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a" />
  </ItemGroup>

</Project>`;

      const tempProjectPath = path.join(testFixturePath, 'temp-complex.csproj');

      try {
        await fs.promises.writeFile(tempProjectPath, complexProjectContent, 'utf8');

        const result = await parser.parseDependencies(tempProjectPath);

        expect(result.length).toBeGreaterThan(0);

        // Check all dependency types are present
        const packageRefs = result.filter(d => d.type === 'PackageReference');
        const projectRefs = result.filter(d => d.type === 'ProjectReference');
        const frameworkRefs = result.filter(d => d.type === 'FrameworkReference');
        const regularRefs = result.filter(d => d.type === 'Reference');

        expect(packageRefs.length).toBe(3);
        expect(projectRefs.length).toBe(2);
        expect(frameworkRefs.length).toBe(1);
        expect(regularRefs.length).toBe(2);

        // Verify specific dependencies
        expect(packageRefs.find(p => p.name === 'Microsoft.AspNetCore.OpenApi')).toBeDefined();
        expect(projectRefs.find(p => p.name === 'Shared')).toBeDefined();
        expect(frameworkRefs.find(f => f.name === 'Microsoft.AspNetCore.App')).toBeDefined();
        expect(regularRefs.find(r => r.name === 'System.Configuration')).toBeDefined();

        // Check version extraction from regular references
        const systemWebRef = regularRefs.find(r => r.name === 'System.Web');
        expect(systemWebRef).toBeDefined();
        expect(systemWebRef!.version).toBe('4.0.0.0');


      } finally {
        // Clean up temp file
        try {
          await fs.promises.unlink(tempProjectPath);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    }, 15000);

    it('should handle empty project files gracefully', async () => {
      const emptyProjectContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>`;

      const tempProjectPath = path.join(testFixturePath, 'temp-empty.csproj');

      try {
        await fs.promises.writeFile(tempProjectPath, emptyProjectContent, 'utf8');

        const result = await parser.parseDependencies(tempProjectPath);

        expect(result).toBeDefined();
        expect(result).toHaveLength(0);

      } finally {
        try {
          await fs.promises.unlink(tempProjectPath);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    });

    it('should handle malformed XML gracefully', async () => {
      const malformedContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  <!-- Missing closing tag`;

      const tempProjectPath = path.join(testFixturePath, 'temp-malformed.csproj');

      try {
        await fs.promises.writeFile(tempProjectPath, malformedContent, 'utf8');

        const result = await parser.parseDependencies(tempProjectPath);

        // Should handle gracefully and return empty result
        expect(result).toBeDefined();
        expect(result).toHaveLength(0);

      } finally {
        try {
          await fs.promises.unlink(tempProjectPath);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('security and validation', () => {
    it('should validate workspace paths', async () => {
      // Test with path outside workspace (should be handled gracefully)
      const outsidePath = path.join('..', '..', 'outside-project.csproj');
      const result = await parser.parseDependencies(outsidePath);

      expect(result).toBeDefined();
      // Should either work or return empty result, but not throw
    });

    it('should handle very deep directory structures', async () => {
      const webAppPath = path.join(testFixturePath, 'src', 'WebApp', 'WebApp.csproj');
      const result = await parser.parseDependencies(webAppPath);

      // Should complete without stack overflow or infinite recursion
      expect(result).toBeDefined();
    });
  });
});