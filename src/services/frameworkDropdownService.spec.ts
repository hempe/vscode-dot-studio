import { FrameworkDropdownService } from './frameworkDropdownService';
import { FrameworkOption } from '../types/framework';
import { SolutionService } from './solutionService';

// Mock SolutionService
jest.mock('./solutionService');
const mockSolutionService = SolutionService as jest.Mocked<typeof SolutionService>;

describe('FrameworkDropdownService', () => {
  let service: FrameworkDropdownService;

  beforeEach(() => {
    service = new FrameworkDropdownService();
    jest.clearAllMocks();
  });

  describe('getFrameworkOptions', () => {
    it('should return framework options including Auto option', async () => {
      const mockFrameworks = ['net8.0', 'net6.0', 'netcoreapp3.1'];
      mockSolutionService.findSolutionFile.mockResolvedValue('/test/solution.sln');
      mockSolutionService.getAllFrameworks.mockResolvedValue(mockFrameworks);
      mockSolutionService.isFrameworkSupported.mockImplementation((fw) => fw === 'net8.0');
      mockSolutionService.getFrameworkDisplayName.mockImplementation((fw) => `Display: ${fw}`);

      const options = await service.getFrameworkOptions('/test/workspace');

      expect(options).toHaveLength(4); // Auto + 3 frameworks
      expect(options[0].label).toBe('Auto');
      expect(options[0].value).toBeUndefined();

      // Check that supported frameworks come first
      const frameworkOptions = options.slice(1);
      expect(frameworkOptions[0].isSupported).toBe(true);
      expect(frameworkOptions[0].value).toBe('net8.0');
    });

    it('should return empty array when no solution found', async () => {
      mockSolutionService.findSolutionFile.mockResolvedValue(null);

      const options = await service.getFrameworkOptions('/test/workspace');

      expect(options).toEqual([]);
    });

    it('should handle errors gracefully', async () => {
      mockSolutionService.findSolutionFile.mockRejectedValue(new Error('File system error'));

      const options = await service.getFrameworkOptions('/test/workspace');

      expect(options).toEqual([]);
    });
  });

  describe('framework selection', () => {
    it('should set and get active framework', async () => {
      const mockCallback = jest.fn();
      service.setFrameworkChangeCallback(mockCallback);

      await service.setActiveFramework('net8.0');

      expect(service.getActiveFramework()).toBe('net8.0');
      expect(mockCallback).toHaveBeenCalledWith('net8.0');
    });

    it('should handle undefined framework', async () => {
      await service.setActiveFramework(undefined);

      expect(service.getActiveFramework()).toBeUndefined();
    });
  });

  describe('getFrameworkValidation', () => {
    it('should return validation info for supported framework', () => {
      mockSolutionService.isFrameworkSupported.mockReturnValue(true);

      const validation = service.getFrameworkValidation('net8.0');

      expect(validation.isSupported).toBe(true);
      expect(validation.upgradeRecommendation).toBeUndefined();
    });

    it('should return validation info for unsupported framework', () => {
      mockSolutionService.isFrameworkSupported.mockReturnValue(false);
      mockSolutionService.getUpgradeRecommendation.mockReturnValue('Upgrade to .NET 8.0');

      const validation = service.getFrameworkValidation('net6.0');

      expect(validation.isSupported).toBe(false);
      expect(validation.upgradeRecommendation).toBe('Upgrade to .NET 8.0');
    });
  });

  describe('getAvailableFrameworks', () => {
    it('should return available frameworks from solution', async () => {
      const mockFrameworks = ['net8.0', 'net6.0'];
      service.setSolution('/test/solution.sln');
      mockSolutionService.getAllFrameworks.mockResolvedValue(mockFrameworks);

      const frameworks = await service.getAvailableFrameworks();

      expect(frameworks).toEqual(mockFrameworks);
      expect(mockSolutionService.getAllFrameworks).toHaveBeenCalledWith('/test/solution.sln');
    });

    it('should find solution when no solution path set', async () => {
      const mockFrameworks = ['net8.0'];
      mockSolutionService.findSolutionFile.mockResolvedValue('/found/solution.sln');
      mockSolutionService.getAllFrameworks.mockResolvedValue(mockFrameworks);

      const frameworks = await service.getAvailableFrameworks('/workspace');

      expect(frameworks).toEqual(mockFrameworks);
      expect(mockSolutionService.findSolutionFile).toHaveBeenCalledWith('/workspace');
    });

    it('should return empty array when no solution found', async () => {
      mockSolutionService.findSolutionFile.mockResolvedValue(null);

      const frameworks = await service.getAvailableFrameworks('/workspace');

      expect(frameworks).toEqual([]);
    });
  });

  describe('getFrameworkForDebugging', () => {
    it('should return active framework when set', async () => {
      await service.setActiveFramework('net8.0');

      const framework = await service.getFrameworkForDebugging();

      expect(framework).toBe('net8.0');
    });

    it('should return best available framework in Auto mode', async () => {
      service.setSolution('/test/solution.sln');
      const mockFrameworks = ['net6.0', 'net8.0', 'netcoreapp3.1'];
      mockSolutionService.getAllFrameworks.mockResolvedValue(mockFrameworks);
      mockSolutionService.isFrameworkSupported.mockImplementation((fw) => fw === 'net8.0');

      const framework = await service.getFrameworkForDebugging();

      expect(framework).toBe('net8.0'); // Should pick supported framework
    });

    it('should return undefined when no solution available', async () => {
      const framework = await service.getFrameworkForDebugging();

      expect(framework).toBeUndefined();
    });
  });
});