import { ProjectFileParser, ProjectFile, Dependency, ProjectFileStructure } from './projectFileParser';
import * as fs from 'fs';
import * as path from 'path';

describe('ProjectFileParser', () => {
  let parser: ProjectFileParser;
  const testFixturePath = path.join(__dirname, '..', '__fixtures__', 'test-solution');

  beforeEach(() => {
    // Use the test fixture directory as workspace root
    parser = new ProjectFileParser(testFixturePath);
  });

  afterEach(() => {
    parser.clearCache();
  });

  describe('parseProjectFiles', () => {
    it('should parse WebApp project file structure', async () => {
      const webAppPath = path.join(testFixturePath, 'src', 'WebApp', 'WebApp.csproj');
      const result = await parser.parseProjectFiles(webAppPath);

      expect(result).toBeDefined();
      expect(result.files).toBeDefined();
      expect(result.directories).toBeDefined();
      expect(result.dependencies).toBeDefined();

      // Should have some files in the project
      expect(result.files.length).toBeGreaterThan(0);

      console.log(`✓ WebApp project has ${result.files.length} files and ${result.dependencies.length} dependencies`);
    });

    it('should parse ClassLibrary project with multi-target framework', async () => {
      const classLibPath = path.join(testFixturePath, 'src', 'ClassLibrary', 'ClassLibrary.csproj');
      const result = await parser.parseProjectFiles(classLibPath);

      expect(result).toBeDefined();
      expect(result.dependencies).toBeDefined();
      expect(result.dependencies.length).toBeGreaterThan(0);

      // Check for expected package references
      const newtonsoftJson = result.dependencies.find(d => d.name === 'Newtonsoft.Json');
      expect(newtonsoftJson).toBeDefined();
      expect(newtonsoftJson!.type).toBe('PackageReference');
      expect(newtonsoftJson!.version).toBe('13.0.3');

      const dependencyInjection = result.dependencies.find(d => d.name === 'Microsoft.Extensions.DependencyInjection');
      expect(dependencyInjection).toBeDefined();
      expect(dependencyInjection!.version).toBe('8.0.0');

      console.log(`✓ ClassLibrary has dependencies: ${result.dependencies.map(d => `${d.name}@${d.version || 'N/A'}`).join(', ')}`);
    });

    it('should parse Tests project with project references', async () => {
      const testsPath = path.join(testFixturePath, 'src', 'Tests', 'Tests.csproj');
      const result = await parser.parseProjectFiles(testsPath);

      expect(result).toBeDefined();
      expect(result.dependencies).toBeDefined();

      // Should have both package and project references
      const packageRefs = result.dependencies.filter(d => d.type === 'PackageReference');
      const projectRefs = result.dependencies.filter(d => d.type === 'ProjectReference');

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

      console.log(`✓ Tests project has ${packageRefs.length} package refs and ${projectRefs.length} project refs`);
    });

    it('should handle non-existent project files gracefully', async () => {
      const nonExistentPath = path.join(testFixturePath, 'non-existent-project.csproj');
      const result = await parser.parseProjectFiles(nonExistentPath);

      expect(result).toBeDefined();
      expect(result.files).toHaveLength(0);
      expect(result.dependencies).toHaveLength(0);
      expect(result.directories.size).toBe(0);
    });

    it('should reject system paths for security', async () => {
      const systemPath = '/etc/passwd';
      const result = await parser.parseProjectFiles(systemPath);

      expect(result).toBeDefined();
      expect(result.files).toHaveLength(0);
      expect(result.dependencies).toHaveLength(0);
    });
  });

  describe('dependency parsing', () => {
    it('should parse different dependency types correctly', async () => {
      const classLibPath = path.join(testFixturePath, 'src', 'ClassLibrary', 'ClassLibrary.csproj');
      const result = await parser.parseProjectFiles(classLibPath);

      const packageRefs = result.dependencies.filter(d => d.type === 'PackageReference');

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
      const result = await parser.parseProjectFiles(testsPath);

      expect(result.dependencies.length).toBeGreaterThan(0);

      // Check sorting: PackageReference should come before ProjectReference
      let lastType = '';
      let lastPackageName = '';
      let lastProjectName = '';

      for (const dep of result.dependencies) {
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

  describe('file type identification', () => {
    it('should identify C# files as Compile items', async () => {
      const webAppPath = path.join(testFixturePath, 'src', 'WebApp', 'WebApp.csproj');
      const result = await parser.parseProjectFiles(webAppPath);

      const csFiles = result.files.filter(f => f.path.endsWith('.cs') && !f.isDirectory);
      expect(csFiles.length).toBeGreaterThan(0);

      csFiles.forEach(file => {
        expect(file.itemType).toBe('Compile');
      });
    });

    it('should identify JSON files as Content items', async () => {
      const webAppPath = path.join(testFixturePath, 'src', 'WebApp', 'WebApp.csproj');
      const result = await parser.parseProjectFiles(webAppPath);

      const jsonFiles = result.files.filter(f => f.path.endsWith('.json') && !f.isDirectory);

      jsonFiles.forEach(file => {
        expect(file.itemType).toBe('Content');
      });
    });

    it('should create directory entries for nested folders', async () => {
      const webAppPath = path.join(testFixturePath, 'src', 'WebApp', 'WebApp.csproj');
      const result = await parser.parseProjectFiles(webAppPath);

      const directories = result.files.filter(f => f.isDirectory);
      expect(directories.length).toBeGreaterThan(0);

      // Each directory should have a relative path
      directories.forEach(dir => {
        expect(dir.relativePath).toBeDefined();
        expect(dir.relativePath).not.toBe('');
        expect(dir.isDirectory).toBe(true);
        expect(dir.itemType).toBeUndefined();
      });
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

        const result = await parser.parseProjectFiles(tempProjectPath);

        expect(result.dependencies.length).toBeGreaterThan(0);

        // Check all dependency types are present
        const packageRefs = result.dependencies.filter(d => d.type === 'PackageReference');
        const projectRefs = result.dependencies.filter(d => d.type === 'ProjectReference');
        const frameworkRefs = result.dependencies.filter(d => d.type === 'FrameworkReference');
        const regularRefs = result.dependencies.filter(d => d.type === 'Reference');

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

        console.log(`✓ Complex project parsed with ${result.dependencies.length} total dependencies`);
        console.log(`  - ${packageRefs.length} package references`);
        console.log(`  - ${projectRefs.length} project references`);
        console.log(`  - ${frameworkRefs.length} framework references`);
        console.log(`  - ${regularRefs.length} regular references`);

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

        const result = await parser.parseProjectFiles(tempProjectPath);

        expect(result).toBeDefined();
        expect(result.dependencies).toHaveLength(0);

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

        const result = await parser.parseProjectFiles(tempProjectPath);

        // Should handle gracefully and return empty result
        expect(result).toBeDefined();
        expect(result.dependencies).toHaveLength(0);

      } finally {
        try {
          await fs.promises.unlink(tempProjectPath);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('cache management', () => {
    it('should clear cache when requested', () => {
      // This is mainly a smoke test since cache is private
      expect(() => parser.clearCache()).not.toThrow();
    });
  });

  describe('security and validation', () => {
    it('should validate workspace paths', async () => {
      // Test with path outside workspace (should be handled gracefully)
      const outsidePath = path.join('..', '..', 'outside-project.csproj');
      const result = await parser.parseProjectFiles(outsidePath);

      expect(result).toBeDefined();
      // Should either work or return empty result, but not throw
    });

    it('should handle very deep directory structures', async () => {
      const webAppPath = path.join(testFixturePath, 'src', 'WebApp', 'WebApp.csproj');
      const result = await parser.parseProjectFiles(webAppPath);

      // Should complete without stack overflow or infinite recursion
      expect(result).toBeDefined();
    });
  });
});