import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../core/logger';

/**
 * Handles reading and writing .sln.user files for Visual Studio compatibility
 */
export class SolutionUserFile {
    private readonly logger = logger('SolutionUserFile');

    private userFilePath: string;

    constructor(solutionPath: string) {
        this.userFilePath = solutionPath + '.user';
    }

    /**
     * Gets the current startup project GUID from .sln.user file
     */
    async getStartupProject(): Promise<string | null> {
        try {
            if (!fs.existsSync(this.userFilePath)) {
                return null;
            }

            const content = await fs.promises.readFile(this.userFilePath, 'utf8');
            const match = content.match(/StartupProject\s*=\s*\{([^}]+)\}/);
            return match ? `{${match[1]}}` : null;
        } catch (error) {
            this.logger.error('Error reading .sln.user file:', error);
            return null;
        }
    }

    /**
     * Gets the selected framework filter from .sln.user file
     */
    async getFrameworkFilter(): Promise<string | null> {
        try {
            if (!fs.existsSync(this.userFilePath)) {
                return null;
            }

            const content = await fs.promises.readFile(this.userFilePath, 'utf8');
            const match = content.match(/FrameworkFilter\s*=\s*([^\r\n]+)/);
            return match ? match[1].trim() : null;
        } catch (error) {
            this.logger.error('Error reading framework filter from .sln.user file:', error);
            return null;
        }
    }

    /**
     * Gets the active framework for debugging from .sln.user file
     */
    async getActiveFramework(): Promise<string | null> {
        try {
            if (!fs.existsSync(this.userFilePath)) {
                return null;
            }

            const content = await fs.promises.readFile(this.userFilePath, 'utf8');
            const match = content.match(/ActiveFramework\s*=\s*([^\r\n]+)/);
            return match ? match[1].trim() : null;
        } catch (error) {
            this.logger.error('Error reading active framework from .sln.user file:', error);
            return null;
        }
    }

    /**
     * Sets the active framework for debugging in .sln.user file
     */
    async setActiveFramework(framework: string | null): Promise<void> {
        try {
            let content: string;

            if (fs.existsSync(this.userFilePath)) {
                // Update existing file
                content = await fs.promises.readFile(this.userFilePath, 'utf8');

                if (content.includes('ActiveFramework')) {
                    // Replace existing ActiveFramework
                    if (framework) {
                        content = content.replace(
                            /ActiveFramework\s*=\s*[^\r\n]+/,
                            `ActiveFramework = ${framework}`
                        );
                    } else {
                        // Remove ActiveFramework line if setting to null
                        content = content.replace(
                            /\s*ActiveFramework\s*=\s*[^\r\n]+[\r\n]*/,
                            ''
                        );
                    }
                } else if (framework) {
                    // Add new ActiveFramework to existing file
                    const insertPoint = content.lastIndexOf('EndGlobal');
                    if (insertPoint !== -1) {
                        content = content.slice(0, insertPoint) +
                            `\tActiveFramework = ${framework}\n` +
                            content.slice(insertPoint);
                    } else {
                        // Add to end if no EndGlobal found
                        content += `\nActiveFramework = ${framework}\n`;
                    }
                }
            } else if (framework) {
                // Create new file with ActiveFramework
                content = `Microsoft Visual Studio Solution File, Format Version 12.00
Global
\tActiveFramework = ${framework}
EndGlobal
`;
            } else {
                // Don't create file if setting to null
                return;
            }

            await fs.promises.writeFile(this.userFilePath, content, 'utf8');
        } catch (error) {
            this.logger.error('Error writing active framework to .sln.user file:', error);
            throw error;
        }
    }

    /**
     * Sets the startup project GUID in .sln.user file
     */
    async setStartupProject(projectGuid: string): Promise<void> {
        try {
            // Ensure GUID is in proper format
            const guid = projectGuid.startsWith('{') ? projectGuid : `{${projectGuid}}`;

            let content: string;

            if (fs.existsSync(this.userFilePath)) {
                // Update existing file
                content = await fs.promises.readFile(this.userFilePath, 'utf8');

                if (content.includes('StartupProject')) {
                    // Replace existing StartupProject
                    content = content.replace(
                        /StartupProject\s*=\s*\{[^}]+\}/,
                        `StartupProject = ${guid}`
                    );
                } else {
                    // Add StartupProject to existing file
                    content = this.addStartupProjectToExisting(content, guid);
                }
            } else {
                // Create new .sln.user file
                content = this.createNewUserFile(guid);
            }

            await fs.promises.writeFile(this.userFilePath, content, 'utf8');
        } catch (error) {
            this.logger.error('Error writing .sln.user file:', error);
            throw new Error(`Failed to set startup project: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Creates a new .sln.user file content
     */
    private createNewUserFile(projectGuid: string): string {
        return `Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
GlobalSection(SolutionConfigurationPlatforms) = preSolution
EndGlobalSection
GlobalSection(ProjectConfigurationPlatforms) = postSolution
EndGlobalSection
GlobalSection(SolutionProperties) = preSolution
\tHideSolutionNode = FALSE
EndGlobalSection
GlobalSection(ExtensibilityGlobals) = postSolution
\tSolutionGuid = {${randomUUID()}}
EndGlobalSection
GlobalSection(StartupProject) = preSolution
\tStartupProject = ${projectGuid}
EndGlobalSection
`;
    }

    /**
     * Adds StartupProject section to existing .sln.user file
     */
    private addStartupProjectToExisting(content: string, projectGuid: string): string {
        // If there's already a StartupProject section, this shouldn't be called
        // but handle it just in case
        if (content.includes('GlobalSection(StartupProject)')) {
            return content;
        }

        // Find the last GlobalSection and add our section before the end
        const lastGlobalSectionEnd = content.lastIndexOf('EndGlobalSection');
        if (lastGlobalSectionEnd === -1) {
            // No GlobalSection found, append to end
            return content + `GlobalSection(StartupProject) = preSolution
\tStartupProject = ${projectGuid}
EndGlobalSection
`;
        }

        const insertPosition = lastGlobalSectionEnd + 'EndGlobalSection'.length;
        const before = content.substring(0, insertPosition);
        const after = content.substring(insertPosition);

        return before + `
GlobalSection(StartupProject) = preSolution
\tStartupProject = ${projectGuid}
EndGlobalSection` + after;
    }

    /**
     * Removes startup project setting from .sln.user file
     */
    async clearStartupProject(): Promise<void> {
        try {
            if (!fs.existsSync(this.userFilePath)) {
                return;
            }

            let content = await fs.promises.readFile(this.userFilePath, 'utf8');

            // Remove the entire StartupProject section
            content = content.replace(
                /GlobalSection\(StartupProject\)\s*=\s*preSolution[\s\S]*?EndGlobalSection\s*/,
                ''
            );

            // Clean up any extra newlines
            content = content.replace(/\n\n\n+/g, '\n\n');

            await fs.promises.writeFile(this.userFilePath, content, 'utf8');
        } catch (error) {
            this.logger.error('Error clearing startup project:', error);
            throw new Error(`Failed to clear startup project: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Checks if .sln.user file exists
     */
    exists(): boolean {
        return fs.existsSync(this.userFilePath);
    }

    /**
     * Gets the path to the .sln.user file
     */
    getUserFilePath(): string {
        return this.userFilePath;
    }
}