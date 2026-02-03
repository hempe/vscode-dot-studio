import { logger } from '../../core/logger';
import { PackageSource } from './types';
import * as vscode from 'vscode';

const log = logger('NuGetV3Service');

/**
 * Service for retrive credentials for NuGet repositories
 */
export class NuGetCredentialManager {
    private static readonly _storedCredential: { [sourceName: string]: Promise<string | undefined> } = {}

    /**
     * Get authentication token for a source
     */
    public static async getSourceToken(source: PackageSource): Promise<string | undefined> {
        try {

            // Try to get stored credentials from NuGet.Config
            const token = await this.getStoredCredentials(source.name);
            if (token) {
                log.info(`Found stored credentials for ${source.name}`);
                return token;
            }

            // For Azure DevOps feeds without stored creds, try credential provider
            if (source.url.includes('dev.azure.com') || source.url.includes('visualstudio.com')) {
                log.info(`No stored credentials for ${source.name}, Azure DevOps credential provider would be needed`);
            }

            return undefined;

        } catch (error) {
            log.warn(`Failed to get token for ${source.name}:`, error);
            return undefined;
        }
    }


    /**
     * Get stored credentials from NuGet.Config files
     * Looks in both global (~/.nuget/NuGet/NuGet.Config) and workspace configs
     */
    private static async getStoredCredentials(sourceName: string): Promise<string | undefined> {
        const cached = NuGetCredentialManager._storedCredential[sourceName];
        if (cached)
            return cached;

        const getCredentials = async () => {
            const fs = require('fs');
            const path = require('path');
            const os = require('os');

            // List of config file locations to check (in order of precedence)
            const configPaths = [
                // Workspace-local nuget.config
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
                    ? path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'nuget.config')
                    : null,
                // Global user config
                path.join(os.homedir(), '.nuget', 'NuGet', 'NuGet.Config'),
                // Alternate global config location (case-sensitive systems)
                path.join(os.homedir(), '.nuget', 'NuGet', 'nuget.config'),
            ].filter(p => p !== null);

            for (const configPath of configPaths) {
                try {
                    if (!fs.existsSync(configPath)) {
                        continue;
                    }

                    const configContent = fs.readFileSync(configPath, 'utf8');

                    // Look for packageSourceCredentials section with our source name
                    // Format: <packageSourceCredentials><SOURCENAME><add key="ClearTextPassword" value="TOKEN" /></SOURCENAME></packageSourceCredentials>
                    const credentialsRegex = new RegExp(`<${sourceName}[^>]*>([\\s\\S]*?)</${sourceName}>`, 'i');
                    const credentialsMatch = configContent.match(credentialsRegex);

                    if (credentialsMatch) {
                        // Extract ClearTextPassword value
                        const passwordMatch = credentialsMatch[1].match(/<add\s+key="ClearTextPassword"\s+value="([^"]+)"/i);
                        if (passwordMatch) {
                            log.info(`Found clear text password for ${sourceName} in ${configPath}`);
                            return passwordMatch[1];
                        }

                        // Also check for Password key (encrypted, but we can try)
                        const encryptedMatch = credentialsMatch[1].match(/<add\s+key="Password"\s+value="([^"]+)"/i);
                        if (encryptedMatch) {
                            log.warn(`Found encrypted password for ${sourceName}, but decryption not implemented`);
                            return undefined;
                        }
                    }
                } catch (error) {
                    log.warn(`Error reading config file ${configPath}:`, error);
                }
            }

            return undefined;
        };

        return NuGetCredentialManager._storedCredential[sourceName] = getCredentials();
    }
}