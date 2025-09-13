import { PackageConsolidationService } from '../../../services/packageConsolidationService';

describe('PackageConsolidationService (Simple Tests)', () => {
    describe('parseSimpleVersion', () => {
        it('should parse version strings correctly', () => {
            const parseVersion = (PackageConsolidationService as any).parseSimpleVersion;
            
            const result1 = parseVersion('1.2.3');
            const result2 = parseVersion('2.0.1-beta');
            const result3 = parseVersion('1.0');
            
            // Test major.minor.patch
            if (result1[0] !== 1 || result1[1] !== 2 || result1[2] !== 3) {
                throw new Error('Failed to parse 1.2.3 correctly');
            }
            
            // Test prerelease (should parse numeric parts)
            if (result2[0] !== 2 || result2[1] !== 0 || result2[2] !== 1) {
                throw new Error('Failed to parse 2.0.1-beta correctly');
            }
            
            // Test shorter version
            if (result3[0] !== 1 || result3[1] !== 0) {
                throw new Error('Failed to parse 1.0 correctly');
            }
        });
    });

    describe('determineRecommendedVersion', () => {
        it('should recommend the latest stable version', () => {
            const determineRecommendedVersion = (PackageConsolidationService as any).determineRecommendedVersion;
            
            const versions1 = ['1.0.0', '1.1.0', '1.0.1'];
            const result1 = determineRecommendedVersion(versions1);
            
            if (result1 !== '1.1.0') {
                throw new Error(`Expected 1.1.0, got ${result1}`);
            }
            
            // Test preference for stable over prerelease
            const versions2 = ['1.0.0', '1.1.0-beta', '1.0.5'];
            const result2 = determineRecommendedVersion(versions2);
            
            if (result2 !== '1.0.5') {
                throw new Error(`Expected stable version 1.0.5, got ${result2}`);
            }
        });

        it('should handle prerelease versions when no stable available', () => {
            const determineRecommendedVersion = (PackageConsolidationService as any).determineRecommendedVersion;
            
            const versions = ['1.0.0-alpha', '1.0.0-beta', '1.0.0-rc'];
            const result = determineRecommendedVersion(versions);
            
            // Should return one of the prerelease versions (latest)
            if (!versions.includes(result)) {
                throw new Error(`Expected one of prerelease versions, got ${result}`);
            }
        });
    });

    describe('assessConflictSeverity', () => {
        it('should return high severity for different major versions', () => {
            const assessConflictSeverity = (PackageConsolidationService as any).assessConflictSeverity;
            
            const versions = ['1.0.0', '2.0.0'];
            const result = assessConflictSeverity(versions, 'TestPackage');
            
            if (result !== 'high') {
                throw new Error(`Expected high severity, got ${result}`);
            }
        });

        it('should return medium severity for prerelease/stable mix', () => {
            const assessConflictSeverity = (PackageConsolidationService as any).assessConflictSeverity;
            
            const versions = ['1.0.0', '1.0.0-beta'];
            const result = assessConflictSeverity(versions, 'TestPackage');
            
            if (result !== 'medium') {
                throw new Error(`Expected medium severity, got ${result}`);
            }
        });

        it('should return low severity for minor differences', () => {
            const assessConflictSeverity = (PackageConsolidationService as any).assessConflictSeverity;
            
            const versions = ['1.0.0', '1.0.1'];
            const result = assessConflictSeverity(versions, 'TestPackage');
            
            if (result !== 'low') {
                throw new Error(`Expected low severity, got ${result}`);
            }
        });

        it('should return medium severity for core packages with multiple versions', () => {
            const assessConflictSeverity = (PackageConsolidationService as any).assessConflictSeverity;
            
            const versions = ['1.0.0', '1.0.1', '1.0.2'];
            const result = assessConflictSeverity(versions, 'Microsoft.Extensions.Logging');
            
            if (result !== 'medium') {
                throw new Error(`Expected medium severity for core package, got ${result}`);
            }
        });
    });

    describe('generateImpactDescription', () => {
        it('should generate correct description for two versions', () => {
            const generateImpactDescription = (PackageConsolidationService as any).generateImpactDescription;
            
            const versionInfo = [
                {
                    version: '1.0.0',
                    projects: [{ projectName: 'Project1' }, { projectName: 'Project2' }],
                    usageCount: 2
                },
                {
                    version: '1.1.0',
                    projects: [{ projectName: 'Project3' }],
                    usageCount: 1
                }
            ];
            
            const result = generateImpactDescription(versionInfo, 'TestPackage');
            
            if (!result.includes('2 different versions') || !result.includes('3 projects')) {
                throw new Error(`Incorrect impact description: ${result}`);
            }
        });

        it('should generate correct description for multiple versions', () => {
            const generateImpactDescription = (PackageConsolidationService as any).generateImpactDescription;
            
            const versionInfo = [
                { version: '1.0.0', projects: [{ projectName: 'P1' }, { projectName: 'P2' }], usageCount: 2 },
                { version: '1.1.0', projects: [{ projectName: 'P3' }], usageCount: 1 },
                { version: '1.2.0', projects: [{ projectName: 'P4' }], usageCount: 1 }
            ];
            
            const result = generateImpactDescription(versionInfo, 'TestPackage');
            
            if (!result.includes('3 different versions') || !result.includes('4 projects')) {
                throw new Error(`Incorrect impact description: ${result}`);
            }
        });
    });

    describe('generateConsolidationPlan', () => {
        it('should generate correct consolidation plan', () => {
            const mockConflict = {
                packageId: 'TestPackage',
                recommendedVersion: '1.1.0',
                conflictSeverity: 'medium' as const,
                impactDescription: 'Test impact',
                versions: [
                    {
                        version: '1.1.0',
                        projects: [{ projectName: 'Project1', projectPath: '/path/project1.csproj' }],
                        usageCount: 1
                    },
                    {
                        version: '1.0.0',
                        projects: [
                            { projectName: 'Project2', projectPath: '/path/project2.csproj' },
                            { projectName: 'Project3', projectPath: '/path/project3.csproj' }
                        ],
                        usageCount: 2
                    }
                ]
            };
            
            const plan = PackageConsolidationService.generateConsolidationPlan(mockConflict);
            
            if (plan.targetVersion !== '1.1.0') {
                throw new Error(`Expected target version 1.1.0, got ${plan.targetVersion}`);
            }
            
            if (plan.projectsToUpdate.length !== 2) {
                throw new Error(`Expected 2 projects to update, got ${plan.projectsToUpdate.length}`);
            }
            
            // Should update projects that don't have the target version
            const projectNames = plan.projectsToUpdate.map(p => p.projectName);
            if (!projectNames.includes('Project2') || !projectNames.includes('Project3')) {
                throw new Error('Incorrect projects selected for update');
            }
        });
    });
});