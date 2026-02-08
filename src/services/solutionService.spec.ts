import { SolutionService } from './solutionService';

describe('SolutionService', () => {

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
});