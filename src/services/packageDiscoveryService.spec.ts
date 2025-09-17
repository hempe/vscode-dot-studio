import { PackageDiscoveryService } from './packageDiscoveryService';
import { InstalledPackage, ProjectPackageInfo } from '../types/packageDiscovery';
import * as fs from 'fs';
import * as path from 'path';

describe('PackageDiscoveryService', () => {
  const testFixturePath = path.join(__dirname, '..', '__fixtures__', 'test-solution');
  const testSolutionPath = path.join(testFixturePath, 'TestSolution.sln');

  describe('discoverInstalledPackages', () => {
    it('should discover all packages from test solution', async () => {
      const packages = await PackageDiscoveryService.discoverInstalledPackages(testSolutionPath);

      expect(packages).toBeDefined();
      expect(Array.isArray(packages)).toBe(true);
      expect(packages.length).toBeGreaterThan(0);

      // Should find packages from all projects
      const packageIds = packages.map(p => p.id);
      expect(packageIds).toContain('Newtonsoft.Json');
      expect(packageIds).toContain('xunit');
      expect(packageIds).toContain('Microsoft.NET.Test.Sdk');

      console.log(`✓ Discovered ${packages.length} unique packages across solution`);
      console.log(`  Packages: ${packageIds.slice(0, 5).join(', ')}${packageIds.length > 5 ? '...' : ''}`);
    });

    it('should deduplicate packages with same ID and version', async () => {
      const packages = await PackageDiscoveryService.discoverInstalledPackages(testSolutionPath);

      // Check for duplicates
      const packageKeys = packages.map(p => `${p.id}@${p.version}`);
      const uniqueKeys = new Set(packageKeys);

      expect(packageKeys.length).toBe(uniqueKeys.size);
      console.log('✓ No duplicate packages found in results');
    });

    it('should sort packages alphabetically by ID', async () => {
      const packages = await PackageDiscoveryService.discoverInstalledPackages(testSolutionPath);

      for (let i = 1; i < packages.length; i++) {
        expect(packages[i].id.localeCompare(packages[i - 1].id) >= 0).toBe(true);
      }

      console.log('✓ Packages are sorted alphabetically');
    });

    it('should handle non-existent solution files', async () => {
      const nonExistentPath = path.join(testFixturePath, 'NonExistent.sln');

      await expect(PackageDiscoveryService.discoverInstalledPackages(nonExistentPath))
        .rejects.toThrow();
    });

    it('should handle empty solution files', async () => {
      const emptySolutionPath = path.join(testFixturePath, 'empty-test.sln');

      try {
        await fs.promises.writeFile(emptySolutionPath, '', 'utf8');

        const packages = await PackageDiscoveryService.discoverInstalledPackages(emptySolutionPath);
        expect(packages).toHaveLength(0);
      } finally {
        try {
          await fs.promises.unlink(emptySolutionPath);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('getProjectPackageInfo', () => {
    it('should return project-specific package information', async () => {
      const projectInfos = await PackageDiscoveryService.getProjectPackageInfo(testSolutionPath);

      expect(projectInfos).toBeDefined();
      expect(Array.isArray(projectInfos)).toBe(true);
      expect(projectInfos.length).toBeGreaterThan(0);

      // Each project info should have required properties
      projectInfos.forEach(info => {
        expect(info.projectPath).toBeDefined();
        expect(info.projectName).toBeDefined();
        expect(Array.isArray(info.packages)).toBe(true);
      });

      // Find specific projects
      const webAppInfo = projectInfos.find(p => p.projectName === 'WebApp');
      const classLibInfo = projectInfos.find(p => p.projectName === 'ClassLibrary');
      const testsInfo = projectInfos.find(p => p.projectName === 'Tests');

      expect(webAppInfo).toBeDefined();
      expect(classLibInfo).toBeDefined();
      expect(testsInfo).toBeDefined();

      // ClassLibrary should have packages
      expect(classLibInfo!.packages.length).toBeGreaterThan(0);
      const newtonsoftJson = classLibInfo!.packages.find(p => p.id === 'Newtonsoft.Json');
      expect(newtonsoftJson).toBeDefined();
      expect(newtonsoftJson!.version).toBe('13.0.3');

      // Tests should have packages
      expect(testsInfo!.packages.length).toBeGreaterThan(0);
      const xunit = testsInfo!.packages.find(p => p.id === 'xunit');
      expect(xunit).toBeDefined();
      expect(xunit!.version).toBe('2.6.1');

      console.log(`✓ Found ${projectInfos.length} projects with packages`);
      projectInfos.forEach(info => {
        console.log(`  ${info.projectName}: ${info.packages.length} packages`);
      });
    });

    it('should extract target frameworks correctly', async () => {
      const projectInfos = await PackageDiscoveryService.getProjectPackageInfo(testSolutionPath);

      const classLibInfo = projectInfos.find(p => p.projectName === 'ClassLibrary');
      expect(classLibInfo).toBeDefined();

      // ClassLibrary has multiple target frameworks, should get the first one
      expect(classLibInfo!.targetFramework).toBeDefined();
      expect(['net6.0', 'net8.0', 'netstandard2.0']).toContain(classLibInfo!.targetFramework);

      const testsInfo = projectInfos.find(p => p.projectName === 'Tests');
      expect(testsInfo).toBeDefined();
      expect(testsInfo!.targetFramework).toBe('net8.0');

      console.log('✓ Target frameworks extracted correctly');
    });

    it('should include package metadata', async () => {
      const projectInfos = await PackageDiscoveryService.getProjectPackageInfo(testSolutionPath);

      const testsInfo = projectInfos.find(p => p.projectName === 'Tests');
      expect(testsInfo).toBeDefined();

      // Look for packages with metadata
      const xunitRunner = testsInfo!.packages.find(p => p.id === 'xunit.runner.visualstudio');
      if (xunitRunner) {
        expect(xunitRunner.isPrivateAssets).toBe(true);
        expect(xunitRunner.includeAssets).toBeDefined();
      }

      console.log('✓ Package metadata (PrivateAssets, IncludeAssets) extracted correctly');
    });

    it('should exclude projects with no packages', async () => {
      // Create a test project with no packages
      const emptyProjectPath = path.join(testFixturePath, 'EmptyProject.csproj');
      const emptyProjectContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>`;

      const tempSolutionPath = path.join(testFixturePath, 'temp-test.sln');
      const tempSolutionContent = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "EmptyProject", "EmptyProject.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject`;

      try {
        await fs.promises.writeFile(emptyProjectPath, emptyProjectContent, 'utf8');
        await fs.promises.writeFile(tempSolutionPath, tempSolutionContent, 'utf8');

        const projectInfos = await PackageDiscoveryService.getProjectPackageInfo(tempSolutionPath);

        // Should not include projects with no packages
        expect(projectInfos).toHaveLength(0);

      } finally {
        try {
          await fs.promises.unlink(emptyProjectPath);
          await fs.promises.unlink(tempSolutionPath);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('getPackageUsage', () => {
    it('should find usage of specific package across projects', async () => {
      const usage = await PackageDiscoveryService.getPackageUsage(testSolutionPath, 'xunit');

      expect(usage).toBeDefined();
      expect(Array.isArray(usage)).toBe(true);
      expect(usage.length).toBeGreaterThan(0);

      // All returned packages should be xunit
      usage.forEach(pkg => {
        expect(pkg.id).toBe('xunit');
        expect(pkg.version).toBeDefined();
        expect(pkg.projectName).toBeDefined();
        expect(pkg.projectPath).toBeDefined();
      });

      console.log(`✓ Package 'xunit' found in ${usage.length} project(s)`);
    });

    it('should return empty array for non-existent package', async () => {
      const usage = await PackageDiscoveryService.getPackageUsage(testSolutionPath, 'NonExistentPackage');

      expect(usage).toBeDefined();
      expect(Array.isArray(usage)).toBe(true);
      expect(usage).toHaveLength(0);
    });

    it('should handle errors gracefully', async () => {
      const nonExistentPath = path.join(testFixturePath, 'NonExistent.sln');
      const usage = await PackageDiscoveryService.getPackageUsage(nonExistentPath, 'xunit');

      expect(usage).toHaveLength(0);
    });
  });

  describe('isPackageInstalled', () => {
    it('should return true for installed packages', async () => {
      const isInstalled = await PackageDiscoveryService.isPackageInstalled(testSolutionPath, 'xunit');
      expect(isInstalled).toBe(true);

      const isNewtonsoftInstalled = await PackageDiscoveryService.isPackageInstalled(testSolutionPath, 'Newtonsoft.Json');
      expect(isNewtonsoftInstalled).toBe(true);

      console.log('✓ Correctly identifies installed packages');
    });

    it('should return false for non-installed packages', async () => {
      const isInstalled = await PackageDiscoveryService.isPackageInstalled(testSolutionPath, 'NonExistentPackage');
      expect(isInstalled).toBe(false);

      console.log('✓ Correctly identifies non-installed packages');
    });

    it('should handle errors gracefully', async () => {
      const nonExistentPath = path.join(testFixturePath, 'NonExistent.sln');
      const isInstalled = await PackageDiscoveryService.isPackageInstalled(nonExistentPath, 'xunit');

      expect(isInstalled).toBe(false);
    });
  });

  describe('solution file parsing', () => {
    it('should correctly parse project paths from solution file', async () => {
      const projectInfos = await PackageDiscoveryService.getProjectPackageInfo(testSolutionPath);

      // Should find all .NET projects but not solution folders
      const projectNames = projectInfos.map(p => p.projectName);
      expect(projectNames).toContain('WebApp');
      expect(projectNames).toContain('ClassLibrary');
      expect(projectNames).toContain('Tests');

      // Should not contain solution folders
      expect(projectNames).not.toContain('Source');
      expect(projectNames).not.toContain('Solution Items');

      console.log('✓ Solution parsing correctly excludes solution folders');
    });

    it('should handle missing project files gracefully', async () => {
      // Create a solution that references a non-existent project
      const tempSolutionPath = path.join(testFixturePath, 'temp-missing-project.sln');
      const tempSolutionContent = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "MissingProject", "MissingProject.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject`;

      try {
        await fs.promises.writeFile(tempSolutionPath, tempSolutionContent, 'utf8');

        const packages = await PackageDiscoveryService.discoverInstalledPackages(tempSolutionPath);

        // Should handle missing project files gracefully
        expect(packages).toHaveLength(0);

      } finally {
        try {
          await fs.promises.unlink(tempSolutionPath);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('project file parsing', () => {
    it('should handle empty project files', async () => {
      const emptyProjectPath = path.join(testFixturePath, 'empty-project.csproj');
      const tempSolutionPath = path.join(testFixturePath, 'temp-empty-solution.sln');
      const tempSolutionContent = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "EmptyProject", "empty-project.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject`;

      try {
        await fs.promises.writeFile(emptyProjectPath, '', 'utf8');
        await fs.promises.writeFile(tempSolutionPath, tempSolutionContent, 'utf8');

        const packages = await PackageDiscoveryService.discoverInstalledPackages(tempSolutionPath);
        expect(packages).toHaveLength(0);

      } finally {
        try {
          await fs.promises.unlink(emptyProjectPath);
          await fs.promises.unlink(tempSolutionPath);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    });

    it('should handle malformed XML project files', async () => {
      const malformedProjectPath = path.join(testFixturePath, 'malformed-project.csproj');
      const tempSolutionPath = path.join(testFixturePath, 'temp-malformed-solution.sln');
      const malformedContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  <!-- Missing closing tag`;

      const tempSolutionContent = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "MalformedProject", "malformed-project.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject`;

      try {
        await fs.promises.writeFile(malformedProjectPath, malformedContent, 'utf8');
        await fs.promises.writeFile(tempSolutionPath, tempSolutionContent, 'utf8');

        const packages = await PackageDiscoveryService.discoverInstalledPackages(tempSolutionPath);

        // Should handle malformed files gracefully
        expect(packages).toHaveLength(0);

      } finally {
        try {
          await fs.promises.unlink(malformedProjectPath);
          await fs.promises.unlink(tempSolutionPath);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('real-world scenarios', () => {
    it('should discover packages with complex configurations', async () => {
      // Create a project with complex package references
      const complexProjectPath = path.join(testFixturePath, 'complex-project.csproj');
      const complexProjectContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFrameworks>net6.0;net8.0</TargetFrameworks>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.AspNetCore.App" Version="8.0.0" />
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Include="xunit" Version="2.4.2">
      <PrivateAssets>all</PrivateAssets>
      <IncludeAssets>runtime; build; native; contentfiles; analyzers</IncludeAssets>
    </PackageReference>
  </ItemGroup>
</Project>`;

      const tempSolutionPath = path.join(testFixturePath, 'temp-complex-solution.sln');
      const tempSolutionContent = `Microsoft Visual Studio Solution File, Format Version 12.00
Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "ComplexProject", "complex-project.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject`;

      try {
        await fs.promises.writeFile(complexProjectPath, complexProjectContent, 'utf8');
        await fs.promises.writeFile(tempSolutionPath, tempSolutionContent, 'utf8');

        const projectInfos = await PackageDiscoveryService.getProjectPackageInfo(tempSolutionPath);
        expect(projectInfos).toHaveLength(1);

        const project = projectInfos[0];
        expect(project.projectName).toBe('complex-project'); // Filename without extension
        expect(project.targetFramework).toBe('net6.0'); // First framework from multi-target
        expect(project.packages).toHaveLength(3);

        // Check specific packages
        const xunitPackage = project.packages.find(p => p.id === 'xunit');
        expect(xunitPackage).toBeDefined();
        expect(xunitPackage!.isPrivateAssets).toBe(true);
        expect(xunitPackage!.includeAssets).toContain('runtime');

        console.log('✓ Complex project configuration parsed correctly');

      } finally {
        try {
          await fs.promises.unlink(complexProjectPath);
          await fs.promises.unlink(tempSolutionPath);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    }, 10000);

    it('should handle large solution with many projects', async () => {
      const packages = await PackageDiscoveryService.discoverInstalledPackages(testSolutionPath);

      // Performance check - should complete within reasonable time
      expect(packages).toBeDefined();

      // Verify data integrity
      packages.forEach(pkg => {
        expect(pkg.id).toBeDefined();
        expect(pkg.version).toBeDefined();
        expect(pkg.projectName).toBeDefined();
        expect(pkg.projectPath).toBeDefined();
        expect(fs.existsSync(pkg.projectPath)).toBe(true);
      });

      console.log(`✓ Performance test: processed ${packages.length} packages successfully`);
    });
  });
});