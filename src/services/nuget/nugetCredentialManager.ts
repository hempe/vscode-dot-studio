import { logger } from '../../core/logger';
import { PackageSource } from './types';
import { readSourceCredential } from './nugetCredentials';
import { basicAuth, configStartDir } from './feedAuth';

const log = logger('NuGetCredentialManager');

/**
 * Credentials for NuGet sources, read from the NuGet.Config files like NuGet does. Not cached: a renewed token
 * counts right away.
 */
export class NuGetCredentialManager {
    /** The `Authorization: Basic` value for the source's stored Username and ClearTextPassword, if it has any */
    public static async getSourceToken(source: PackageSource): Promise<string | undefined> {
        try {
            const credential = readSourceCredential(source.name, configStartDir());
            if (credential.kind === 'encrypted') {
                log.warn(`The password for ${source.name} in ${credential.file} is encrypted (Windows DPAPI) and can't be used`);
            }
            return basicAuth(credential);
        } catch (error) {
            log.warn(`Failed to read credentials for ${source.name}:`, error);
            return undefined;
        }
    }
}
