import { SolutionService } from './solutionService';
import { FrameworkOption } from '../types/framework';
import { DebugConfigService } from './debugConfigService';
import { logger } from '../core/logger';
import { Solution } from '../core/Solution';

const log = logger('FrameworkDropdownService');

/**
 * Pure framework selection service that handles .NET framework selection logic
 * without VS Code UI dependencies. Provides core functionality for:
 * - Getting available framework options
 * - Setting/getting active framework
 * - Saving/loading framework preferences
 * - Framework validation and selection logic
 */
export class FrameworkDropdownService {
    private solution?: Solution;

    public setSolution(solution: Solution): void {
        this.solution = solution;
    }

    public getActiveFramework(): string | undefined {
        return this.solution?.getActiveFramework() ?? undefined;
    }

    public getFrameworkOptions(): FrameworkOption[] {
        try {
            // First, try to get frameworks from the current startup project
            let startupProjectPath = this.solution?.getStartupProject();
            const project = this.solution?.projects.get(startupProjectPath || '');
            let frameworks: string[] = project?.frameworks || [];
            // Fallback: if no startup project or no frameworks found, get from solution
            if (frameworks.length === 0) {
                log.info('No frameworks found in startup project, falling back to solution frameworks');
                if (this.solution?.solutionFile) {
                    frameworks = SolutionService.getAllFrameworks(this.solution.solutionFile);
                }
            }

            if (frameworks.length === 0) {
                return [];
            }

            // Sort frameworks by support status
            const sortedFrameworks = frameworks.sort((a, b) => {
                const aSupported = SolutionService.isFrameworkSupported(a);
                const bSupported = SolutionService.isFrameworkSupported(b);

                if (aSupported && !bSupported) return -1;
                if (!aSupported && bSupported) return 1;

                return b.localeCompare(a, undefined, { numeric: true });
            });

            // Create framework options
            const options: FrameworkOption[] = [
                {
                    label: 'Auto',
                    description: 'Automatically select the best framework for debugging',
                    detail: 'Auto-selection mode',
                    isSupported: true,
                    value: undefined
                },
                ...sortedFrameworks.map(framework => {
                    const displayName = SolutionService.getFrameworkDisplayName(framework);
                    const isSupported = SolutionService.isFrameworkSupported(framework);

                    return {
                        label: framework,
                        description: displayName,
                        detail: isSupported ? 'Supported framework' : 'Legacy framework',
                        isSupported: isSupported,
                        value: framework
                    };
                })
            ];

            return options;

        } catch (error) {
            log.error('Failed to get framework options:', error);
            return [];
        }
    }

    public async setActiveFramework(framework?: string): Promise<void> {
        // Update the debug configuration with the new framework
        let currentStartupProject = this.solution?.getStartupProject();

        log.info(`Framework changed to: ${framework}, current startup project: ${currentStartupProject}`);
        if (currentStartupProject) {
            log.info(`Updating startup configuration with new framework: ${framework}`);
            try {
                await DebugConfigService.updateStartupConfiguration(currentStartupProject, framework);
                log.info(`Startup configuration updated successfully`);
            } catch (error) {
                log.error('Error updating startup configuration after framework change:', error);
            }
        } else {
            log.warn('No current startup project found, cannot update debug configuration');
        }
    }

    public getAvailableFrameworks(): string[] {
        if (!this.solution?.solutionFile) {
            return [];
        }

        try {
            return SolutionService.getAllFrameworks(this.solution.solutionFile);
        } catch (error) {
            log.error('Error getting available frameworks:', error);
            return [];
        }
    }

    /**
     * Validates if a framework is supported and returns upgrade recommendation if needed.
     */
    public getFrameworkValidation(framework: string): { isSupported: boolean; upgradeRecommendation?: string } {
        const isSupported = SolutionService.isFrameworkSupported(framework);
        const upgradeRecommendation = isSupported ? undefined : SolutionService.getUpgradeRecommendation(framework);

        return {
            isSupported,
            upgradeRecommendation
        };
    }

    /**
     * Gets the display name for a framework.
     */
    public getFrameworkDisplayName(framework: string): string {
        return SolutionService.getFrameworkDisplayName(framework);
    }
}