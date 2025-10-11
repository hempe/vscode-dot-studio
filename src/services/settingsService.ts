import * as vscode from 'vscode';
import { logger } from '../core/logger';

const log = logger('SettingsService');

/**
 * Service for managing extension settings through VS Code configuration
 */
export class SettingsService {
    private static readonly SECTION = 'dotnet.solution';

    /**
     * Gets the active framework setting
     */
    static getActiveFramework(): string | undefined {
        try {
            const config = vscode.workspace.getConfiguration(this.SECTION);
            return config.get<string>('activeFramework') || undefined;
        } catch (error) {
            log.error('Error getting active framework setting:', error);
            return undefined;
        }
    }

    /**
     * Sets the active framework setting
     */
    static async setActiveFramework(framework: string | undefined): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration(this.SECTION);
            await config.update('activeFramework', framework || null, vscode.ConfigurationTarget.Workspace);
        } catch (error) {
            log.error('Error setting active framework:', error);
            throw error;
        }
    }

    /**
     * Gets the startup project setting
     */
    static getStartupProject(): string | undefined {
        try {
            const config = vscode.workspace.getConfiguration(this.SECTION);
            return config.get<string>('startupProject') || undefined;
        } catch (error) {
            log.error('Error getting startup project setting:', error);
            return undefined;
        }
    }

    /**
     * Sets the startup project setting
     */
    static async setStartupProject(projectPath: string | undefined): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration(this.SECTION);
            await config.update('startupProject', projectPath || null, vscode.ConfigurationTarget.Workspace);
        } catch (error) {
            log.error('Error setting startup project:', error);
            throw error;
        }
    }

    /**
     * Clears all solution settings
     */
    static async clearSettings(): Promise<void> {
        try {
            await this.setActiveFramework(undefined);
            await this.setStartupProject(undefined);
        } catch (error) {
            log.error('Error clearing settings:', error);
            throw error;
        }
    }
}