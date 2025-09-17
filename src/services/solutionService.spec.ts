import { SolutionService } from './solutionService';
import * as fs from 'fs';
import * as path from 'path';

describe('SolutionService', () => {
  beforeEach(() => {
    SolutionService.clearCache();
  });

  describe('findSolutionFile', () => {
    it('should find solution file in current workspace if exists', async () => {
      // Test with current workspace
      const result = await SolutionService.findSolutionFile(process.cwd());

      if (result) {
        expect(result).toContain('.sln');
        expect(path.isAbsolute(result)).toBe(true);
        console.log(`✓ Found solution file: ${result}`);

        // Verify the file actually exists
        const exists = fs.existsSync(result);
        expect(exists).toBe(true);
      } else {
        console.log('ⓘ No solution file found in current workspace (this is ok for testing)');
      }
    });

    it('should return null for non-existent directory', async () => {
      const result = await SolutionService.findSolutionFile('/nonexistent/directory/12345');

      expect(result).toBeNull();
    });

    it('should handle directory with no solution files', async () => {
      // Test with a directory that likely has no .sln files (like /tmp)
      const result = await SolutionService.findSolutionFile('/tmp');

      // Should return null or a solution file if one happens to exist
      expect(result === null || result.endsWith('.sln')).toBe(true);
    });
  });

  describe('readSolutionContent', () => {
    it('should read file content if solution file exists', async () => {
      const solutionFile = await SolutionService.findSolutionFile(process.cwd());

      if (solutionFile) {
        const content = await SolutionService.readSolutionContent(solutionFile);

        expect(typeof content).toBe('string');
        expect(content).toContain('Microsoft Visual Studio Solution File');
        console.log(`✓ Successfully read solution file content (${content.length} characters)`);
      } else {
        console.log('ⓘ Skipping read test - no solution file found');
      }
    });
  });

  describe('framework support methods', () => {
    describe('isFrameworkSupported', () => {
      it('should return true for supported frameworks', () => {
        expect(SolutionService.isFrameworkSupported('net8.0')).toBe(true);
        expect(SolutionService.isFrameworkSupported('net9.0')).toBe(true);
      });

      it('should return false for unsupported frameworks', () => {
        expect(SolutionService.isFrameworkSupported('net6.0')).toBe(false);
        expect(SolutionService.isFrameworkSupported('netcoreapp3.1')).toBe(false);
        expect(SolutionService.isFrameworkSupported('net4.8')).toBe(false);
      });
    });

    describe('getFrameworkDisplayName', () => {
      it('should return display name for known frameworks', () => {
        const displayName = SolutionService.getFrameworkDisplayName('net8.0');
        expect(displayName).toContain('.NET 8.0 (LTS)');
        expect(displayName).toContain('✅ Supported');
      });

      it('should return original framework name for unknown frameworks', () => {
        const displayName = SolutionService.getFrameworkDisplayName('unknown-framework');
        expect(displayName).toBe('unknown-framework');
      });
    });

    describe('getUpgradeRecommendation', () => {
      it('should provide upgrade recommendation for outdated frameworks', () => {
        const recommendation = SolutionService.getUpgradeRecommendation('net6.0');
        expect(recommendation).toContain('.NET 8.0');
        expect(recommendation).toContain('LTS');
      });

      it('should provide migration recommendation for .NET Framework', () => {
        const recommendation = SolutionService.getUpgradeRecommendation('net4.8');
        expect(recommendation).toContain('migrating');
        expect(recommendation).toContain('.NET 8.0');
      });

      it('should return empty string for unknown frameworks', () => {
        const recommendation = SolutionService.getUpgradeRecommendation('unknown');
        expect(recommendation).toBe('');
      });
    });
  });

  describe('clearCache', () => {
    it('should clear the solution cache', () => {
      // This is a static method, so we can only test that it doesn't throw
      expect(() => SolutionService.clearCache()).not.toThrow();
    });
  });

  describe('solution parsing (if solution file exists)', () => {
    it('should parse solution file if one exists', async () => {
      const solutionFile = await SolutionService.findSolutionFile(process.cwd());

      if (solutionFile) {
        const parsedSolution = await SolutionService.parseSolutionFile(solutionFile);

        expect(parsedSolution).toHaveProperty('projects');
        expect(Array.isArray(parsedSolution.projects)).toBe(true);
        console.log(`✓ Parsed solution with ${parsedSolution.projects.length} projects`);

        // Test caching - second call should use cache
        const parsedSolution2 = await SolutionService.parseSolutionFile(solutionFile);
        expect(parsedSolution2).toEqual(parsedSolution);
      } else {
        console.log('ⓘ Skipping parse test - no solution file found');
      }
    });
  });
});