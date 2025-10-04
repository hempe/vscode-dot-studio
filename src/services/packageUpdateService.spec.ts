import { PackageUpdateService } from './packageUpdateService';
import { PackageUpdate, UpdateCheckOptions } from '../types/packageUpdate';
import { PackageDiscoveryService } from './packageDiscoveryService';
import { NuGetV3Service } from './nuget/nugetV3Service';
import * as path from 'path';

// Mock the dependencies
jest.mock('./packageDiscoveryService');
jest.mock('./nuget/nugetV3Service');

const mockPackageDiscoveryService = PackageDiscoveryService as jest.Mocked<typeof PackageDiscoveryService>;
const mockNuGetV3Service = NuGetV3Service as jest.Mocked<typeof NuGetV3Service>;

describe('PackageUpdateService', () => {
  const testFixturePath = path.join(__dirname, '..', '__fixtures__', 'test-solution');
  const testSolutionPath = path.join(testFixturePath, 'TestSolution.sln');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('version comparison', () => {
    describe('isNewerVersion', () => {
      it('should correctly identify newer major versions', () => {
        expect(PackageUpdateService.isNewerVersion('2.0.0', '1.0.0')).toBe(true);
        expect(PackageUpdateService.isNewerVersion('1.0.0', '2.0.0')).toBe(false);
      });

      it('should correctly identify newer minor versions', () => {
        expect(PackageUpdateService.isNewerVersion('1.2.0', '1.1.0')).toBe(true);
        expect(PackageUpdateService.isNewerVersion('1.1.0', '1.2.0')).toBe(false);
      });

      it('should correctly identify newer patch versions', () => {
        expect(PackageUpdateService.isNewerVersion('1.0.2', '1.0.1')).toBe(true);
        expect(PackageUpdateService.isNewerVersion('1.0.1', '1.0.2')).toBe(false);
      });

      it('should handle prerelease versions correctly', () => {
        // Stable version is newer than prerelease
        expect(PackageUpdateService.isNewerVersion('1.0.0', '1.0.0-beta')).toBe(true);
        expect(PackageUpdateService.isNewerVersion('1.0.0-beta', '1.0.0')).toBe(false);

        // Compare prerelease versions
        expect(PackageUpdateService.isNewerVersion('1.0.0-beta.2', '1.0.0-beta.1')).toBe(true);
        expect(PackageUpdateService.isNewerVersion('1.0.0-rc', '1.0.0-beta')).toBe(true);
      });

      it('should handle equal versions', () => {
        expect(PackageUpdateService.isNewerVersion('1.0.0', '1.0.0')).toBe(false);
        expect(PackageUpdateService.isNewerVersion('1.0.0-beta', '1.0.0-beta')).toBe(false);
      });

      it('should handle invalid version formats gracefully', () => {
        expect(PackageUpdateService.isNewerVersion('invalid', '1.0.0')).toBe(false);
        expect(PackageUpdateService.isNewerVersion('1.0.0', 'invalid')).toBe(false);
        expect(PackageUpdateService.isNewerVersion('invalid', 'invalid')).toBe(false);
      });

      it('should handle complex version formats', () => {
        expect(PackageUpdateService.isNewerVersion('1.0.0+build.1', '1.0.0')).toBe(false);
        expect(PackageUpdateService.isNewerVersion('1.0.1-alpha+build.1', '1.0.0')).toBe(true);
        expect(PackageUpdateService.isNewerVersion('2.0.0-beta.1+exp.sha.5114f85', '1.2.3')).toBe(true);
      });
    });

    describe('isPrerelease', () => {
      it('should identify prerelease versions correctly', () => {
        expect(PackageUpdateService.isPrerelease('1.0.0-alpha')).toBe(true);
        expect(PackageUpdateService.isPrerelease('1.0.0-beta.1')).toBe(true);
        expect(PackageUpdateService.isPrerelease('1.0.0-rc.1')).toBe(true);
        expect(PackageUpdateService.isPrerelease('2.0.0-preview.1')).toBe(true);
      });

      it('should identify stable versions correctly', () => {
        expect(PackageUpdateService.isPrerelease('1.0.0')).toBe(false);
        expect(PackageUpdateService.isPrerelease('2.1.3')).toBe(false);
        expect(PackageUpdateService.isPrerelease('10.0.0')).toBe(false);
      });

      it('should handle invalid versions', () => {
        expect(PackageUpdateService.isPrerelease('invalid')).toBe(false);
        expect(PackageUpdateService.isPrerelease('')).toBe(false);
      });
    });
  });

  describe('checkPackageForUpdate', () => {
    beforeEach(() => {
      mockNuGetV3Service.searchPackages.mockResolvedValue([
        {
          id: 'TestPackage',
          version: '2.0.0',
          description: 'Test package',
          totalDownloads: 1000
        }
      ]);
    });

    it('should return newer version when available', async () => {
      const result = await PackageUpdateService.checkPackageForUpdate('TestPackage', '1.0.0', false);
      expect(result).toBe('2.0.0');
      expect(mockNuGetV3Service.searchPackages).toHaveBeenCalledWith(
        'https://api.nuget.org/v3/index.json',
        {
          query: 'TestPackage',
          includePrerelease: false,
          take: 1
        }
      );
    });

    it('should return null when no newer version available', async () => {
      const result = await PackageUpdateService.checkPackageForUpdate('TestPackage', '2.0.0', false);
      expect(result).toBeNull();
    });

    it('should return null when current version is newer', async () => {
      const result = await PackageUpdateService.checkPackageForUpdate('TestPackage', '3.0.0', false);
      expect(result).toBeNull();
    });

    it('should include prerelease when requested', async () => {
      mockNuGetV3Service.searchPackages.mockResolvedValue([
        {
          id: 'TestPackage',
          version: '2.0.0-beta.1',
          description: 'Test package',
          totalDownloads: 1000
        }
      ]);

      const result = await PackageUpdateService.checkPackageForUpdate('TestPackage', '1.0.0', true);
      expect(result).toBe('2.0.0-beta.1');
      expect(mockNuGetV3Service.searchPackages).toHaveBeenCalledWith(
        'https://api.nuget.org/v3/index.json',
        {
          query: 'TestPackage',
          includePrerelease: true,
          take: 1
        }
      );
    });

    it('should return null when package not found', async () => {
      mockNuGetV3Service.searchPackages.mockResolvedValue([]);
      const result = await PackageUpdateService.checkPackageForUpdate('NonExistentPackage', '1.0.0', false);
      expect(result).toBeNull();
    });

    it('should handle API errors gracefully', async () => {
      mockNuGetV3Service.searchPackages.mockRejectedValue(new Error('API Error'));
      const result = await PackageUpdateService.checkPackageForUpdate('TestPackage', '1.0.0', false);
      expect(result).toBeNull();
    });

    it('should handle case-insensitive package matching', async () => {
      mockNuGetV3Service.searchPackages.mockResolvedValue([
        {
          id: 'testpackage',
          version: '2.0.0',
          description: 'Test package',
          totalDownloads: 1000
        }
      ]);

      const result = await PackageUpdateService.checkPackageForUpdate('TestPackage', '1.0.0', false);
      expect(result).toBe('2.0.0');
    });
  });

  describe('checkForUpdates', () => {
    const mockOptions: UpdateCheckOptions = {
      includePrerelease: false,
      batchSize: 2
    };

    beforeEach(() => {
      mockPackageDiscoveryService.discoverInstalledPackages.mockResolvedValue([
        {
          id: 'PackageA',
          version: '1.0.0',
          projectPath: '/test/ProjectA.csproj',
          projectName: 'ProjectA',
          targetFramework: 'net8.0'
        },
        {
          id: 'PackageB',
          version: '2.0.0',
          projectPath: '/test/ProjectB.csproj',
          projectName: 'ProjectB',
          targetFramework: 'net8.0'
        },
        {
          id: 'PackageA',
          version: '1.0.0',
          projectPath: '/test/ProjectB.csproj',
          projectName: 'ProjectB',
          targetFramework: 'net8.0'
        }
      ]);

      mockNuGetV3Service.searchPackages.mockImplementation(async (sourceUrl, options) => {
        if (options.query === 'PackageA') {
          return [{
            id: 'PackageA',
            version: '1.5.0',
            description: 'Package A',
            totalDownloads: 1000
          }];
        } else if (options.query === 'PackageB') {
          return [{
            id: 'PackageB',
            version: '2.0.0',
            description: 'Package B',
            totalDownloads: 2000
          }];
        }
        return [];
      });
    });

    it('should find updates for outdated packages', async () => {
      const updates = await PackageUpdateService.checkForUpdates(testSolutionPath, mockOptions);

      expect(updates).toHaveLength(1);
      expect(updates[0]).toEqual({
        id: 'PackageA',
        currentVersion: '1.0.0',
        latestVersion: '1.5.0',
        projects: ['ProjectA', 'ProjectB'],
        isPrerelease: false
      });
    });

    it('should return empty array when no packages installed', async () => {
      mockPackageDiscoveryService.discoverInstalledPackages.mockResolvedValue([]);
      const updates = await PackageUpdateService.checkForUpdates(testSolutionPath, mockOptions);
      expect(updates).toHaveLength(0);
    });

    it('should return empty array when no updates available', async () => {
      mockNuGetV3Service.searchPackages.mockImplementation(async (sourceUrl, options) => {
        return [{
          id: options.query as string,
          version: '1.0.0', // Same as installed
          description: 'Test package',
          totalDownloads: 1000
        }];
      });

      const updates = await PackageUpdateService.checkForUpdates(testSolutionPath, mockOptions);
      expect(updates).toHaveLength(0);
    });

    it('should handle mixed versions across projects', async () => {
      mockPackageDiscoveryService.discoverInstalledPackages.mockResolvedValue([
        {
          id: 'PackageA',
          version: '1.0.0',
          projectPath: '/test/ProjectA.csproj',
          projectName: 'ProjectA',
          targetFramework: 'net8.0'
        },
        {
          id: 'PackageA',
          version: '1.2.0',
          projectPath: '/test/ProjectB.csproj',
          projectName: 'ProjectB',
          targetFramework: 'net8.0'
        }
      ]);

      const updates = await PackageUpdateService.checkForUpdates(testSolutionPath, mockOptions);

      expect(updates).toHaveLength(1);
      expect(updates[0].currentVersion).toBe('1.0.0'); // Most common version (appears twice vs once)
    });

    it('should sort updates alphabetically', async () => {
      mockPackageDiscoveryService.discoverInstalledPackages.mockResolvedValue([
        {
          id: 'ZPackage',
          version: '1.0.0',
          projectPath: '/test/Project.csproj',
          projectName: 'Project',
          targetFramework: 'net8.0'
        },
        {
          id: 'APackage',
          version: '1.0.0',
          projectPath: '/test/Project.csproj',
          projectName: 'Project',
          targetFramework: 'net8.0'
        }
      ]);

      mockNuGetV3Service.searchPackages.mockImplementation(async (sourceUrl, options) => {
        return [{
          id: options.query as string,
          version: '2.0.0',
          description: 'Test package',
          totalDownloads: 1000
        }];
      });

      const updates = await PackageUpdateService.checkForUpdates(testSolutionPath, mockOptions);

      expect(updates).toHaveLength(2);
      expect(updates[0].id).toBe('APackage');
      expect(updates[1].id).toBe('ZPackage');
    });

    it('should handle batch processing', async () => {
      const batchOptions: UpdateCheckOptions = {
        includePrerelease: false,
        batchSize: 1
      };

      const updates = await PackageUpdateService.checkForUpdates(testSolutionPath, batchOptions);

      // Should still work correctly with smaller batch size
      expect(mockNuGetV3Service.searchPackages).toHaveBeenCalledTimes(2); // Once for each unique package
    });

    it('should handle errors gracefully', async () => {
      mockPackageDiscoveryService.discoverInstalledPackages.mockRejectedValue(new Error('Discovery failed'));

      await expect(PackageUpdateService.checkForUpdates(testSolutionPath, mockOptions))
        .rejects.toThrow('Failed to check for updates: Discovery failed');
    });

    it('should continue on individual package errors', async () => {
      mockNuGetV3Service.searchPackages.mockImplementation(async (sourceUrl, options) => {
        if (options.query === 'PackageA') {
          throw new Error('API Error for PackageA');
        }
        return [{
          id: 'PackageB',
          version: '2.1.0',
          description: 'Package B',
          totalDownloads: 1000
        }];
      });

      const updates = await PackageUpdateService.checkForUpdates(testSolutionPath, mockOptions);

      // Should have update for PackageB, but PackageA should be skipped due to error
      expect(updates).toHaveLength(1);
      expect(updates[0].id).toBe('PackageB');
    });
  });

  describe('getUpdateSummary', () => {
    it('should correctly categorize different types of updates', () => {
      const updates: PackageUpdate[] = [
        {
          id: 'PackageA',
          currentVersion: '1.0.0',
          latestVersion: '2.0.0',
          projects: ['ProjectA'],
          isPrerelease: false
        },
        {
          id: 'PackageB',
          currentVersion: '1.0.0',
          latestVersion: '1.1.0',
          projects: ['ProjectB'],
          isPrerelease: false
        },
        {
          id: 'PackageC',
          currentVersion: '1.0.0',
          latestVersion: '1.0.1',
          projects: ['ProjectC'],
          isPrerelease: false
        },
        {
          id: 'PackageD',
          currentVersion: '1.0.0',
          latestVersion: '2.0.0-beta',
          projects: ['ProjectD'],
          isPrerelease: true
        }
      ];

      const summary = PackageUpdateService.getUpdateSummary(updates);

      expect(summary).toEqual({
        totalUpdates: 4,
        majorUpdates: 1,
        minorUpdates: 1,
        patchUpdates: 1,
        prereleaseUpdates: 1
      });
    });

    it('should handle empty updates array', () => {
      const summary = PackageUpdateService.getUpdateSummary([]);

      expect(summary).toEqual({
        totalUpdates: 0,
        majorUpdates: 0,
        minorUpdates: 0,
        patchUpdates: 0,
        prereleaseUpdates: 0
      });
    });

    it('should handle complex version scenarios', () => {
      const updates: PackageUpdate[] = [
        {
          id: 'PackageA',
          currentVersion: '0.9.0',
          latestVersion: '1.0.0',
          projects: ['ProjectA'],
          isPrerelease: false
        },
        {
          id: 'PackageB',
          currentVersion: '1.2.3',
          latestVersion: '1.5.0',
          projects: ['ProjectB'],
          isPrerelease: false
        }
      ];

      const summary = PackageUpdateService.getUpdateSummary(updates);

      expect(summary).toEqual({
        totalUpdates: 2,
        majorUpdates: 1, // 0.9.0 -> 1.0.0
        minorUpdates: 1, // 1.2.3 -> 1.5.0
        patchUpdates: 0,
        prereleaseUpdates: 0
      });
    });
  });

  describe('real-world integration scenarios', () => {
    beforeEach(() => {
      // Reset mocks for integration tests
      jest.clearAllMocks();
      jest.unmock('./packageDiscoveryService');
      jest.unmock('./nugetService');
    });

    afterEach(() => {
      // Re-mock for other tests
      jest.mock('./packageDiscoveryService');
      jest.mock('./nugetService');
    });

    it('should handle version parsing edge cases', () => {
      // Test various version formats that might be encountered
      const testCases = [
        { v1: '1.0.0', v2: '1.0.0-beta', expected: true },
        { v1: '2.0.0-rc.1', v2: '2.0.0-beta.1', expected: true },
        { v1: '1.0.0+build.1', v2: '1.0.0', expected: false },
        { v1: '1.0.0-alpha.1+build.1', v2: '1.0.0-alpha.1', expected: false }
      ];

      testCases.forEach(({ v1, v2, expected }) => {
        expect(PackageUpdateService.isNewerVersion(v1, v2)).toBe(expected);
      });
    });

    it('should handle large numbers of packages efficiently', () => {
      // Test performance with many packages
      const manyUpdates: PackageUpdate[] = Array.from({ length: 100 }, (_, i) => ({
        id: `Package${i}`,
        currentVersion: '1.0.0',
        latestVersion: `1.${i}.0`,
        projects: [`Project${i}`],
        isPrerelease: i % 10 === 0
      }));

      const summary = PackageUpdateService.getUpdateSummary(manyUpdates);

      expect(summary.totalUpdates).toBe(100);
      expect(summary.prereleaseUpdates).toBe(10);
      expect(summary.minorUpdates).toBe(90);
    });

    it('should preserve project information correctly', async () => {
      const mockPackages = [
        {
          id: 'SharedPackage',
          version: '1.0.0',
          projectPath: '/test/ProjectA.csproj',
          projectName: 'ProjectA',
          targetFramework: 'net8.0'
        },
        {
          id: 'SharedPackage',
          version: '1.0.0',
          projectPath: '/test/ProjectB.csproj',
          projectName: 'ProjectB',
          targetFramework: 'net6.0'
        },
        {
          id: 'SharedPackage',
          version: '1.0.0',
          projectPath: '/test/ProjectC.csproj',
          projectName: 'ProjectC',
          targetFramework: 'net8.0'
        }
      ];

      mockPackageDiscoveryService.discoverInstalledPackages.mockResolvedValue(mockPackages);
      mockNuGetV3Service.searchPackages.mockResolvedValue([{
        id: 'SharedPackage',
        version: '2.0.0',
        description: 'Shared package',
        totalDownloads: 1000
      }]);

      const updates = await PackageUpdateService.checkForUpdates(testSolutionPath, { includePrerelease: false });

      expect(updates).toHaveLength(1);
      expect(updates[0].projects).toEqual(['ProjectA', 'ProjectB', 'ProjectC']);
      expect(updates[0].projects).toHaveLength(3);
    });
  });
});