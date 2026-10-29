import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../../core/logger';
import { parseJsonc } from '../../core/jsonc';

const log = logger('launchProfiles');

export interface LaunchProfile {
    readonly name: string;
    readonly commandLineArgs?: string;
    readonly environmentVariables?: Record<string, string>;
    readonly applicationUrl?: string;
    readonly launchBrowser: boolean;
    readonly launchUrl?: string;
}

/**
 * Profiles of Properties/launchSettings.json that `dotnet run` can launch (`commandName: "Project"`);
 * IIS Express, Docker and similar profiles don't apply
 */
export function readLaunchProfiles(projectDir: string): LaunchProfile[] {
    const launchSettingsPath = path.join(projectDir, 'Properties', 'launchSettings.json');
    if (!fs.existsSync(launchSettingsPath)) {
        return [];
    }

    const { value, errors } = parseJsonc(fs.readFileSync(launchSettingsPath, 'utf8'));
    if (errors.length > 0 || !value?.profiles || typeof value.profiles !== 'object') {
        log.warn(`Ignoring ${launchSettingsPath}: ${errors.join(', ') || 'no profiles'}`);
        return [];
    }

    return Object.entries(value.profiles as Record<string, any>)
        .filter(([, profile]) => profile?.commandName === 'Project')
        .map(([name, profile]) => ({
            name,
            commandLineArgs: typeof profile.commandLineArgs === 'string' ? profile.commandLineArgs : undefined,
            environmentVariables: profile.environmentVariables && typeof profile.environmentVariables === 'object'
                ? Object.fromEntries(Object.entries(profile.environmentVariables as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
                : undefined,
            applicationUrl: typeof profile.applicationUrl === 'string' ? profile.applicationUrl : undefined,
            launchBrowser: profile.launchBrowser === true,
            launchUrl: typeof profile.launchUrl === 'string' ? profile.launchUrl : undefined,
        }));
}

/**
 * Opens the browser once the app logs its first URL, like Visual Studio's launchBrowser:
 * at `launchUrl` relative to that URL, or at `launchUrl` itself when it is absolute
 */
export function browserAction(launchUrl: string | undefined) {
    return {
        action: 'openExternally',
        pattern: '\\bNow listening on:\\s+(https?://\\S+)',
        uriFormat: !launchUrl ? '%s' : /^https?:\/\//i.test(launchUrl) ? launchUrl : `%s/${launchUrl.replace(/^\//, '')}`,
    };
}
