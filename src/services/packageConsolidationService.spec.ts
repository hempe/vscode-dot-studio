import { PackageConsolidationService } from './packageConsolidationService';
import { PackageConflict, ConsolidationSummary } from '../types/packageConsolidation';
import { PackageDiscoveryService } from './packageDiscoveryService';
import { ProjectPackageInfo } from '../types/packageDiscovery';
import * as path from 'path';

jest.mock('./packageDiscoveryService');
const mockPackageDiscoveryService = PackageDiscoveryService as jest.Mocked<typeof PackageDiscoveryService>;

describe('PackageConsolidationService', () => {
  const testFixturePath = path.join(__dirname, '..', '__fixtures__', 'test-solution');
  const testSolutionPath = path.join(testFixturePath, 'TestSolution.sln');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('analyzePackageConflicts', () => {
    it('should identify version conflicts across projects', async () => {
      const mockProjectInfo: ProjectPackageInfo[] = [
        {
          projectPath: '/test/ProjectA.csproj',
          projectName: 'ProjectA',
          packages: [
            {
              id: 'ConflictedPackage',
              version: '1.0.0',
              projectPath: '/test/ProjectA.csproj',
              projectName: 'ProjectA',
              targetFramework: 'net8.0'
            },
            {
              id: 'SharedPackage',
              version: '2.0.0',
              projectPath: '/test/ProjectA.csproj',
              projectName: 'ProjectA',
              targetFramework: 'net8.0'
            }
          ]
        },
        {
          projectPath: '/test/ProjectB.csproj',
          projectName: 'ProjectB',
          packages: [
            {
              id: 'ConflictedPackage',
              version: '1.2.0',
              projectPath: '/test/ProjectB.csproj',
              projectName: 'ProjectB',
              targetFramework: 'net8.0'
            },
            {
              id: 'SharedPackage',
              version: '2.0.0',
              projectPath: '/test/ProjectB.csproj',
              projectName: 'ProjectB',
              targetFramework: 'net8.0'
            }
          ]
        }
      ];

      mockPackageDiscoveryService.getProjectPackageInfo.mockResolvedValue(mockProjectInfo);

      const conflicts = await PackageConsolidationService.analyzePackageConflicts(testSolutionPath);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].packageId).toBe('ConflictedPackage');
      expect(conflicts[0].versions).toHaveLength(2);
      expect(conflicts[0].recommendedVersion).toBe('1.2.0'); // Latest version
      expect(conflicts[0].conflictSeverity).toBe('low');
    });

    it('should return empty array when no conflicts exist', async () => {
      const mockProjectInfo: ProjectPackageInfo[] = [
        {
          projectPath: '/test/ProjectA.csproj',
          projectName: 'ProjectA',
          packages: [
            {
              id: 'SharedPackage',
              version: '1.0.0',
              projectPath: '/test/ProjectA.csproj',
              projectName: 'ProjectA',
              targetFramework: 'net8.0'
            }
          ]
        },
        {
          projectPath: '/test/ProjectB.csproj',
          projectName: 'ProjectB',
          packages: [
            {
              id: 'SharedPackage',
              version: '1.0.0',
              projectPath: '/test/ProjectB.csproj',
              projectName: 'ProjectB',
              targetFramework: 'net8.0'
            }
          ]
        }
      ];

      mockPackageDiscoveryService.getProjectPackageInfo.mockResolvedValue(mockProjectInfo);

      const conflicts = await PackageConsolidationService.analyzePackageConflicts(testSolutionPath);

      expect(conflicts).toHaveLength(0);
    });

    it('should sort conflicts by severity and name', async () => {
      const mockProjectInfo: ProjectPackageInfo[] = [
        {
          projectPath: '/test/ProjectA.csproj',
          projectName: 'ProjectA',
          packages: [
            {
              id: 'ZPackage',
              version: '1.0.0',
              projectPath: '/test/ProjectA.csproj',
              projectName: 'ProjectA',
              targetFramework: 'net8.0'
            },
            {
              id: 'Microsoft.Extensions.Logging',
              version: '1.0.0',
              projectPath: '/test/ProjectA.csproj',
              projectName: 'ProjectA',
              targetFramework: 'net8.0'
            }
          ]
        },
        {
          projectPath: '/test/ProjectB.csproj',
          projectName: 'ProjectB',
          packages: [
            {
              id: 'ZPackage',
              version: '2.0.0', // Minor version difference
              projectPath: '/test/ProjectB.csproj',
              projectName: 'ProjectB',
              targetFramework: 'net8.0'
            },
            {
              id: 'Microsoft.Extensions.Logging',
              version: '2.0.0', // Core package - higher severity
              projectPath: '/test/ProjectB.csproj',
              projectName: 'ProjectB',
              targetFramework: 'net8.0'
            }
          ]
        }
      ];

      mockPackageDiscoveryService.getProjectPackageInfo.mockResolvedValue(mockProjectInfo);

      const conflicts = await PackageConsolidationService.analyzePackageConflicts(testSolutionPath);

      expect(conflicts).toHaveLength(2);
      // Microsoft.Extensions.Logging should come first (core package = medium severity)
      // ZPackage should come second (low severity)
      expect(conflicts[0].packageId).toBe('Microsoft.Extensions.Logging');
      expect(conflicts[0].conflictSeverity).toBe('high'); // Major version difference
      expect(conflicts[1].packageId).toBe('ZPackage');
      expect(conflicts[1].conflictSeverity).toBe('low');
    });

    it('should handle empty project list', async () => {
      mockPackageDiscoveryService.getProjectPackageInfo.mockResolvedValue([]);

      const conflicts = await PackageConsolidationService.analyzePackageConflicts(testSolutionPath);

      expect(conflicts).toHaveLength(0);
    });

    it('should handle errors gracefully', async () => {
      mockPackageDiscoveryService.getProjectPackageInfo.mockRejectedValue(new Error('Discovery failed'));

      await expect(PackageConsolidationService.analyzePackageConflicts(testSolutionPath))
        .rejects.toThrow('Failed to analyze package conflicts: Discovery failed');
    });
  });

  describe('conflict severity assessment', () => {
    it('should assign high severity to major version differences', async () => {
      const mockProjectInfo: ProjectPackageInfo[] = [
        {
          projectPath: '/test/ProjectA.csproj',
          projectName: 'ProjectA',
          packages: [{
            id: 'TestPackage',
            version: '1.0.0',
            projectPath: '/test/ProjectA.csproj',
            projectName: 'ProjectA',
            targetFramework: 'net8.0'
          }]
        },
        {
          projectPath: '/test/ProjectB.csproj',
          projectName: 'ProjectB',
          packages: [{
            id: 'TestPackage',
            version: '2.0.0', // Major version difference
            projectPath: '/test/ProjectB.csproj',
            projectName: 'ProjectB',
            targetFramework: 'net8.0'
          }]
        }
      ];

      mockPackageDiscoveryService.getProjectPackageInfo.mockResolvedValue(mockProjectInfo);

      const conflicts = await PackageConsolidationService.analyzePackageConflicts(testSolutionPath);

      expect(conflicts[0].conflictSeverity).toBe('high');
    });

    it('should assign medium severity to prerelease/stable mix', async () => {
      const mockProjectInfo: ProjectPackageInfo[] = [
        {
          projectPath: '/test/ProjectA.csproj',
          projectName: 'ProjectA',
          packages: [{
            id: 'TestPackage',
            version: '1.0.0',
            projectPath: '/test/ProjectA.csproj',
            projectName: 'ProjectA',
            targetFramework: 'net8.0'
          }]
        },
        {
          projectPath: '/test/ProjectB.csproj',
          projectName: 'ProjectB',
          packages: [{
            id: 'TestPackage',
            version: '1.0.1-beta',
            projectPath: '/test/ProjectB.csproj',
            projectName: 'ProjectB',
            targetFramework: 'net8.0'
          }]
        }
      ];

      mockPackageDiscoveryService.getProjectPackageInfo.mockResolvedValue(mockProjectInfo);

      const conflicts = await PackageConsolidationService.analyzePackageConflicts(testSolutionPath);

      expect(conflicts[0].conflictSeverity).toBe('high'); // Major version difference
    });

    it('should assign medium severity to core packages with multiple versions', async () => {
      const mockProjectInfo: ProjectPackageInfo[] = [
        {
          projectPath: '/test/ProjectA.csproj',
          projectName: 'ProjectA',
          packages: [{
            id: 'Microsoft.Extensions.Logging',
            version: '6.0.0',
            projectPath: '/test/ProjectA.csproj',
            projectName: 'ProjectA',
            targetFramework: 'net8.0'
          }]
        },
        {
          projectPath: '/test/ProjectB.csproj',
          projectName: 'ProjectB',
          packages: [{
            id: 'Microsoft.Extensions.Logging',
            version: '7.0.0',
            projectPath: '/test/ProjectB.csproj',
            projectName: 'ProjectB',
            targetFramework: 'net8.0'
          }]
        },
        {
          projectPath: '/test/ProjectC.csproj',
          projectName: 'ProjectC',
          packages: [{
            id: 'Microsoft.Extensions.Logging',
            version: '8.0.0',
            projectPath: '/test/ProjectC.csproj',
            projectName: 'ProjectC',
            targetFramework: 'net8.0'
          }]
        }
      ];

      mockPackageDiscoveryService.getProjectPackageInfo.mockResolvedValue(mockProjectInfo);

      const conflicts = await PackageConsolidationService.analyzePackageConflicts(testSolutionPath);

      expect(conflicts[0].conflictSeverity).toBe('high'); // Major version difference
    });
  });

  describe('version recommendation', () => {
    it('should recommend latest stable version', async () => {
      const mockProjectInfo: ProjectPackageInfo[] = [
        {
          projectPath: '/test/ProjectA.csproj',
          projectName: 'ProjectA',
          packages: [{
            id: 'TestPackage',
            version: '1.0.0',
            projectPath: '/test/ProjectA.csproj',
            projectName: 'ProjectA',
            targetFramework: 'net8.0'
          }]
        },
        {
          projectPath: '/test/ProjectB.csproj',
          projectName: 'ProjectB',
          packages: [{
            id: 'TestPackage',
            version: '1.2.0',
            projectPath: '/test/ProjectB.csproj',
            projectName: 'ProjectB',
            targetFramework: 'net8.0'
          }]
        },
        {
          projectPath: '/test/ProjectC.csproj',
          projectName: 'ProjectC',
          packages: [{
            id: 'TestPackage',
            version: '1.1.0-beta',
            projectPath: '/test/ProjectC.csproj',
            projectName: 'ProjectC',
            targetFramework: 'net8.0'
          }]
        }
      ];

      mockPackageDiscoveryService.getProjectPackageInfo.mockResolvedValue(mockProjectInfo);

      const conflicts = await PackageConsolidationService.analyzePackageConflicts(testSolutionPath);

      expect(conflicts[0].recommendedVersion).toBe('1.2.0'); // Latest stable
    });

    it('should handle complex version formats', async () => {
      const mockProjectInfo: ProjectPackageInfo[] = [
        {
          projectPath: '/test/ProjectA.csproj',
          projectName: 'ProjectA',
          packages: [{
            id: 'TestPackage',
            version: '1.0.0.1',
            projectPath: '/test/ProjectA.csproj',
            projectName: 'ProjectA',
            targetFramework: 'net8.0'
          }]
        },
        {
          projectPath: '/test/ProjectB.csproj',
          projectName: 'ProjectB',
          packages: [{
            id: 'TestPackage',
            version: '1.0.0.10',
            projectPath: '/test/ProjectB.csproj',
            projectName: 'ProjectB',
            targetFramework: 'net8.0'
          }]
        }
      ];

      mockPackageDiscoveryService.getProjectPackageInfo.mockResolvedValue(mockProjectInfo);

      const conflicts = await PackageConsolidationService.analyzePackageConflicts(testSolutionPath);

      expect(conflicts[0].recommendedVersion).toBe('1.0.0.10'); // Latest build number
    });
  });

  describe('getConsolidationSummary', () => {
    it('should provide accurate summary statistics', async () => {
      const mockProjectInfo: ProjectPackageInfo[] = [
        {
          projectPath: '/test/ProjectA.csproj',
          projectName: 'ProjectA',
          packages: [
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
              projectPath: '/test/ProjectA.csproj',
              projectName: 'ProjectA',
              targetFramework: 'net8.0'
            }
          ]
        },
        {
          projectPath: '/test/ProjectB.csproj',
          projectName: 'ProjectB',
          packages: [
            {
              id: 'PackageA',
              version: '1.1.0', // Conflict - low severity
              projectPath: '/test/ProjectB.csproj',
              projectName: 'ProjectB',
              targetFramework: 'net8.0'
            },
            {
              id: 'PackageC',
              version: '1.0.0',
              projectPath: '/test/ProjectB.csproj',
              projectName: 'ProjectB',
              targetFramework: 'net8.0'
            }
          ]
        }
      ];

      mockPackageDiscoveryService.getProjectPackageInfo.mockResolvedValue(mockProjectInfo);

      const summary = await PackageConsolidationService.getConsolidationSummary(testSolutionPath);

      expect(summary).toEqual({
        totalPackages: 3, // PackageA, PackageB, PackageC
        conflictedPackages: 1, // Only PackageA has conflicts
        totalProjects: 2,
        conflictSeverity: {
          high: 0,
          medium: 0,
          low: 1
        }
      });
    });

    it('should handle errors gracefully', async () => {
      mockPackageDiscoveryService.getProjectPackageInfo.mockRejectedValue(new Error('Discovery failed'));

      const summary = await PackageConsolidationService.getConsolidationSummary(testSolutionPath);

      expect(summary).toEqual({
        totalPackages: 0,
        conflictedPackages: 0,
        totalProjects: 0,
        conflictSeverity: { high: 0, medium: 0, low: 0 }
      });
    });
  });

  describe('generateConsolidationPlan', () => {
    it('should create actionable consolidation plan', () => {
      const conflict: PackageConflict = {
        packageId: 'TestPackage',
        versions: [
          {
            version: '1.2.0',
            projects: [
              { projectName: 'ProjectA', projectPath: '/test/ProjectA.csproj' },
              { projectName: 'ProjectB', projectPath: '/test/ProjectB.csproj' }
            ],
            usageCount: 2
          },
          {
            version: '1.0.0',
            projects: [
              { projectName: 'ProjectC', projectPath: '/test/ProjectC.csproj' }
            ],
            usageCount: 1
          }
        ],
        recommendedVersion: '1.2.0',
        conflictSeverity: 'low',
        impactDescription: 'Low impact expected'
      };

      const plan = PackageConsolidationService.generateConsolidationPlan(conflict);

      expect(plan.targetVersion).toBe('1.2.0');
      expect(plan.projectsToUpdate).toHaveLength(1);
      expect(plan.projectsToUpdate[0]).toEqual({
        projectName: 'ProjectC',
        projectPath: '/test/ProjectC.csproj',
        currentVersion: '1.0.0',
        targetVersion: '1.2.0'
      });
      expect(plan.estimatedImpact).toContain('1 projects will be updated');
      expect(plan.estimatedImpact).toContain('Low risk');
    });

    it('should provide appropriate impact messaging for different severities', () => {
      const highSeverityConflict: PackageConflict = {
        packageId: 'TestPackage',
        versions: [
          {
            version: '2.0.0',
            projects: [{ projectName: 'ProjectA', projectPath: '/test/ProjectA.csproj' }],
            usageCount: 1
          },
          {
            version: '1.0.0',
            projects: [{ projectName: 'ProjectB', projectPath: '/test/ProjectB.csproj' }],
            usageCount: 1
          }
        ],
        recommendedVersion: '2.0.0',
        conflictSeverity: 'high',
        impactDescription: 'High impact expected'
      };

      const plan = PackageConsolidationService.generateConsolidationPlan(highSeverityConflict);

      expect(plan.estimatedImpact).toContain('Major version changes may require code updates');
    });
  });

  describe('hasConflicts', () => {
    it('should correctly identify when specific package has conflicts', async () => {
      const mockProjectInfo: ProjectPackageInfo[] = [
        {
          projectPath: '/test/ProjectA.csproj',
          projectName: 'ProjectA',
          packages: [{
            id: 'ConflictedPackage',
            version: '1.0.0',
            projectPath: '/test/ProjectA.csproj',
            projectName: 'ProjectA',
            targetFramework: 'net8.0'
          }]
        },
        {
          projectPath: '/test/ProjectB.csproj',
          projectName: 'ProjectB',
          packages: [{
            id: 'ConflictedPackage',
            version: '1.1.0',
            projectPath: '/test/ProjectB.csproj',
            projectName: 'ProjectB',
            targetFramework: 'net8.0'
          }]
        }
      ];

      mockPackageDiscoveryService.getProjectPackageInfo.mockResolvedValue(mockProjectInfo);

      const hasConflicts = await PackageConsolidationService.hasConflicts(testSolutionPath, 'ConflictedPackage');
      const noConflicts = await PackageConsolidationService.hasConflicts(testSolutionPath, 'NonExistentPackage');

      expect(hasConflicts).toBe(true);
      expect(noConflicts).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      mockPackageDiscoveryService.getProjectPackageInfo.mockRejectedValue(new Error('Discovery failed'));

      const result = await PackageConsolidationService.hasConflicts(testSolutionPath, 'TestPackage');

      expect(result).toBe(false);
    });
  });

  describe('real-world scenarios', () => {
    it('should handle complex multi-project solution with many conflicts', async () => {
      const complexProjectInfo: ProjectPackageInfo[] = Array.from({ length: 5 }, (_, i) => ({
        projectPath: `/test/Project${i}.csproj`,
        projectName: `Project${i}`,
        packages: [
          {
            id: 'Microsoft.Extensions.Logging',
            version: `${6 + (i % 3)}.0.0`, // Versions 6.0.0, 7.0.0, 8.0.0
            projectPath: `/test/Project${i}.csproj`,
            projectName: `Project${i}`,
            targetFramework: 'net8.0'
          },
          {
            id: 'Newtonsoft.Json',
            version: i < 3 ? '12.0.0' : '13.0.0', // Two version groups
            projectPath: `/test/Project${i}.csproj`,
            projectName: `Project${i}`,
            targetFramework: 'net8.0'
          }
        ]
      }));

      mockPackageDiscoveryService.getProjectPackageInfo.mockResolvedValue(complexProjectInfo);

      const conflicts = await PackageConsolidationService.analyzePackageConflicts(testSolutionPath);
      const summary = await PackageConsolidationService.getConsolidationSummary(testSolutionPath);

      expect(conflicts.length).toBeGreaterThan(0);
      expect(summary.totalProjects).toBe(5);
      expect(summary.totalPackages).toBe(2);
      expect(summary.conflictedPackages).toBe(2);

      // Microsoft.Extensions.Logging should be medium severity (core package)
      const loggingConflict = conflicts.find(c => c.packageId === 'Microsoft.Extensions.Logging');
      expect(loggingConflict?.conflictSeverity).toBe('medium');
    });

    it('should handle edge case version formats', async () => {
      const mockProjectInfo: ProjectPackageInfo[] = [
        {
          projectPath: '/test/ProjectA.csproj',
          projectName: 'ProjectA',
          packages: [{
            id: 'EdgeCasePackage',
            version: '1.0',
            projectPath: '/test/ProjectA.csproj',
            projectName: 'ProjectA',
            targetFramework: 'net8.0'
          }]
        },
        {
          projectPath: '/test/ProjectB.csproj',
          projectName: 'ProjectB',
          packages: [{
            id: 'EdgeCasePackage',
            version: '1.0.0.0',
            projectPath: '/test/ProjectB.csproj',
            projectName: 'ProjectB',
            targetFramework: 'net8.0'
          }]
        }
      ];

      mockPackageDiscoveryService.getProjectPackageInfo.mockResolvedValue(mockProjectInfo);

      const conflicts = await PackageConsolidationService.analyzePackageConflicts(testSolutionPath);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].packageId).toBe('EdgeCasePackage');
      expect(conflicts[0].recommendedVersion).toBe('1.0'); // Stable version is preferred over more specific
    });

    it('should provide meaningful impact descriptions', async () => {
      const mockProjectInfo: ProjectPackageInfo[] = [
        {
          projectPath: '/test/ProjectA.csproj',
          projectName: 'ProjectA',
          packages: [{
            id: 'TestPackage',
            version: '1.0.0',
            projectPath: '/test/ProjectA.csproj',
            projectName: 'ProjectA',
            targetFramework: 'net8.0'
          }]
        },
        {
          projectPath: '/test/ProjectB.csproj',
          projectName: 'ProjectB',
          packages: [{
            id: 'TestPackage',
            version: '1.1.0',
            projectPath: '/test/ProjectB.csproj',
            projectName: 'ProjectB',
            targetFramework: 'net8.0'
          }]
        }
      ];

      mockPackageDiscoveryService.getProjectPackageInfo.mockResolvedValue(mockProjectInfo);

      const conflicts = await PackageConsolidationService.analyzePackageConflicts(testSolutionPath);

      expect(conflicts[0].impactDescription).toContain('TestPackage has 2 different versions');
      expect(conflicts[0].impactDescription).toContain('across 2 projects');
      expect(conflicts[0].impactDescription).toMatch(/Most projects \(\d+\) use/);
    });
  });
});