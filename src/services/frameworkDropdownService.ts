import { SolutionService } from './solutionService';
import { SolutionUserFile } from '../parsers/solutionUserFile';
import { FrameworkOption } from '../types/framework';

/**
 * Pure framework selection service that handles .NET framework selection logic
 * without VS Code UI dependencies. Provides core functionality for:
 * - Getting available framework options
 * - Setting/getting active framework
 * - Saving/loading framework preferences
 * - Framework validation and selection logic
 */
export class FrameworkDropdownService {
    private activeFramework?: string;
    private solutionPath?: string;
    private onFrameworkChangeCallback?: (framework?: string) => void;

    constructor() {
        // Pure service constructor - no VS Code dependencies
    }

    public setSolution(solutionPath: string): void {
        this.solutionPath = solutionPath;
        this.loadSavedActiveFramework();
    }

    public setFrameworkChangeCallback(callback: (framework?: string) => void): void {
        this.onFrameworkChangeCallback = callback;
    }

    public getActiveFramework(): string | undefined {
        return this.activeFramework;
    }

    private async loadSavedActiveFramework(): Promise<void> {
        if (!this.solutionPath) return;

        try {
            const solutionUserFile = new SolutionUserFile(this.solutionPath);
            const savedFramework = await solutionUserFile.getActiveFramework();
            if (savedFramework) {
                this.setActiveFramework(savedFramework);
            }
        } catch (error) {
            // Ignore errors loading saved framework
        }
    }

    public async getFrameworkOptions(workspaceRoot?: string): Promise<FrameworkOption[]> {
        try {
            if (!this.solutionPath) {
                if (workspaceRoot) {
                    // Find active solution using SolutionService
                    const solutionFile = await SolutionService.findSolutionFile(workspaceRoot);
                    if (solutionFile) {
                        this.solutionPath = solutionFile;
                    }
                }
            }

            if (!this.solutionPath) {
                return [];
            }

            // Get all available frameworks from the solution
            const frameworks = await SolutionService.getAllFrameworks(this.solutionPath);

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
            console.error('Failed to get framework options:', error);
            return [];
        }
    }

    public async setActiveFramework(framework?: string): Promise<void> {
        this.activeFramework = framework;

        if (this.onFrameworkChangeCallback) {
            this.onFrameworkChangeCallback(framework);
        }

        // Save the active framework
        await this.saveActiveFramework(framework || null);
    }

    private async saveActiveFramework(framework: string | null): Promise<void> {
        if (!this.solutionPath) return;

        try {
            const solutionUserFile = new SolutionUserFile(this.solutionPath);
            await solutionUserFile.setActiveFramework(framework);
        } catch (error) {
            // Ignore errors saving framework
        }
    }


    public async getAvailableFrameworks(workspaceRoot?: string): Promise<string[]> {
        if (!this.solutionPath) {
            if (workspaceRoot) {
                // Try to find solution using SolutionService
                const solutionFile = await SolutionService.findSolutionFile(workspaceRoot);
                if (solutionFile) {
                    this.solutionPath = solutionFile;
                }
            }
        }

        if (!this.solutionPath) {
            return [];
        }

        try {
            return await SolutionService.getAllFrameworks(this.solutionPath);
        } catch (error) {
            console.error('Error getting available frameworks:', error);
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

    /**
     * Gets the best framework to use for debugging.
     * If a specific framework is selected, returns that.
     * If "Auto" is selected, returns the most suitable framework.
     */
    public async getFrameworkForDebugging(): Promise<string | undefined> {
        if (this.activeFramework) {
            return this.activeFramework;
        }

        // Auto mode - select the best framework
        if (!this.solutionPath) return undefined;

        try {
            const frameworks = await SolutionService.getAllFrameworks(this.solutionPath);
            if (frameworks.length === 0) return undefined;

            // Prefer supported frameworks first, then latest version
            const sortedFrameworks = frameworks.sort((a, b) => {
                const aSupported = SolutionService.isFrameworkSupported(a);
                const bSupported = SolutionService.isFrameworkSupported(b);

                if (aSupported && !bSupported) return -1;
                if (!aSupported && bSupported) return 1;

                return b.localeCompare(a, undefined, { numeric: true });
            });

            return sortedFrameworks[0];
        } catch (error) {
            console.error('Error getting framework for debugging:', error);
            return undefined;
        }
    }
}