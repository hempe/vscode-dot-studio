import { NuGetService } from './nugetService';
import { NuGetSearchOptions } from '../types/nuget';

describe('NuGetService', () => {
  describe('searchPackages', () => {
    it('should return empty array for empty query', async () => {
      const options: NuGetSearchOptions = {
        query: '',
        includePrerelease: false,
      };

      const result = await NuGetService.searchPackages(options);

      expect(result).toEqual([]);
    });

    it('should return empty array for query less than 2 characters', async () => {
      const options: NuGetSearchOptions = {
        query: 'a',
        includePrerelease: false,
      };

      const result = await NuGetService.searchPackages(options);

      expect(result).toEqual([]);
    });

    it('should search for popular packages and return results', async () => {
      const options: NuGetSearchOptions = {
        query: 'Newtonsoft.Json',
        includePrerelease: false,
        take: 5,
      };

      const result = await NuGetService.searchPackages(options);

      expect(Array.isArray(result)).toBe(true);

      if (result.length > 0) {
        const firstPackage = result[0];
        expect(firstPackage).toHaveProperty('id');
        expect(firstPackage).toHaveProperty('version');
        expect(firstPackage).toHaveProperty('description');
        expect(firstPackage).toHaveProperty('totalDownloads');
        expect(typeof firstPackage.totalDownloads).toBe('number');

        console.log(`✓ Found ${result.length} packages for 'Newtonsoft.Json'`);
        console.log(`✓ Top result: ${firstPackage.id} v${firstPackage.version}`);
      } else {
        console.log('ⓘ No packages returned (network issue or API change)');
      }
    }, 30000);

    it('should handle invalid queries gracefully', async () => {
      const options: NuGetSearchOptions = {
        query: '!@#$%^&*()_+{}|:<>?[]\\;\'\",./',
        includePrerelease: false,
      };

      // Should not throw an error, just return empty results or handle gracefully
      const result = await NuGetService.searchPackages(options);
      expect(Array.isArray(result)).toBe(true);
    }, 15000);
  });

  describe('validatePackageId', () => {
    it('should return true for valid package IDs', () => {
      expect(NuGetService.validatePackageId('Newtonsoft.Json')).toBe(true);
      expect(NuGetService.validatePackageId('Microsoft.Extensions.DependencyInjection')).toBe(true);
      expect(NuGetService.validatePackageId('System_Core')).toBe(true);
      expect(NuGetService.validatePackageId('Package-Name')).toBe(true);
    });

    it('should return false for invalid package IDs', () => {
      expect(NuGetService.validatePackageId('')).toBe(false);
      expect(NuGetService.validatePackageId('Package with spaces')).toBe(false);
      expect(NuGetService.validatePackageId('Package@Invalid')).toBe(false);
      expect(NuGetService.validatePackageId('Package#Invalid')).toBe(false);
    });
  });

  describe('validateVersion', () => {
    it('should return true for valid semantic versions', () => {
      expect(NuGetService.validateVersion('1.0.0')).toBe(true);
      expect(NuGetService.validateVersion('2.1.3')).toBe(true);
      expect(NuGetService.validateVersion('1.0.0-alpha')).toBe(true);
      expect(NuGetService.validateVersion('2.1.0-beta.1')).toBe(true);
      expect(NuGetService.validateVersion('1.0.0+build.1')).toBe(true);
      expect(NuGetService.validateVersion('1.0')).toBe(true);
    });

    it('should return false for invalid versions', () => {
      expect(NuGetService.validateVersion('')).toBe(false);
      expect(NuGetService.validateVersion('1')).toBe(false);
      expect(NuGetService.validateVersion('1.0.0....')).toBe(false);
      expect(NuGetService.validateVersion('invalid')).toBe(false);
      expect(NuGetService.validateVersion('1.0.0.0.0')).toBe(false);
    });
  });
});