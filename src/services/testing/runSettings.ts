/**
 * The RunSettings the Test Explorer sends to VSTest: a team's `.runsettings` file (`RunSettingsFilePath`) without
 * the parts that only matter for coverage and reports, plus what the design-mode protocol needs.
 */

/** What VSTest gets when a project has no run settings file */
export const DEFAULT_RUN_SETTINGS = '<RunSettings><RunConfiguration><DesignMode>true</DesignMode></RunConfiguration></RunSettings>';

/**
 * Left out of a team's file: data collectors (coverage stays a script, a missing collector would only print
 * warnings) and loggers (the results go to the Test Explorer, not to TRX or console loggers)
 */
const LEFT_OUT = ['DataCollectionRunSettings', 'InProcDataCollectionRunSettings', 'LoggerRunSettings'];

/**
 * The settings for VSTest from the content of a `.runsettings` file: everything except data collectors and loggers,
 * with `DesignMode` set to true (the protocol needs it: source locations, debugging by attaching). Undefined when the
 * content is not a RunSettings document.
 */
export function vstestRunSettings(content: string): string | undefined {
    const text = content.replace(/^\uFEFF/, '').replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').trim();
    if (!/^<RunSettings\b[^>]*>[\s\S]*<\/RunSettings\s*>$/.test(text)) {
        return undefined;
    }
    let settings = text;
    for (const element of LEFT_OUT) {
        settings = settings.replace(new RegExp(`<${element}\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/${element}\\s*>)`, 'g'), '');
    }
    settings = settings.replace(/<DesignMode\b[^>]*?(?:\/>|>[\s\S]*?<\/DesignMode\s*>)/g, '');
    if (/<RunConfiguration\b[^>]*\/>/.test(settings)) {
        return settings.replace(/<RunConfiguration\b([^>]*?)\s*\/>/, '<RunConfiguration$1><DesignMode>true</DesignMode></RunConfiguration>');
    }
    if (/<RunConfiguration\b[^>]*>/.test(settings)) {
        return settings.replace(/<RunConfiguration\b[^>]*>/, open => `${open}<DesignMode>true</DesignMode>`);
    }
    return settings.replace(/<RunSettings\b[^>]*>/, open => `${open}<RunConfiguration><DesignMode>true</DesignMode></RunConfiguration>`);
}

/** What a Microsoft.Testing.Platform app gets from a run settings file */
export interface TestingPlatformRunSettings {
    /** The file's content for `--settings`, without data collectors, loggers and environment variables */
    readonly settings: string;
    /** `RunConfiguration/EnvironmentVariables`: set on the process we start (in the file they make the app restart itself as a separate test host, which then cannot connect to us) */
    readonly environment: Readonly<Record<string, string>>;
}

const unescapeXml = (value: string) => value
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/**
 * The settings for a Microsoft.Testing.Platform app with the VSTest bridge (MSTest and NUnit runners): MSTest/NUnit
 * sections, `TestRunParameters` and the rest of `RunConfiguration` stay in the file, the environment variables are
 * taken out. Undefined when the content is not a RunSettings document.
 */
export function testingPlatformRunSettings(content: string): TestingPlatformRunSettings | undefined {
    const settings = vstestRunSettings(content);
    if (settings === undefined) {
        return undefined;
    }
    const environment: Record<string, string> = {};
    const block = /<EnvironmentVariables\b[^>]*?(?:\/>|>([\s\S]*?)<\/EnvironmentVariables\s*>)/.exec(settings);
    for (const variable of (block?.[1] ?? '').matchAll(/<([A-Za-z_][\w.-]*)\b[^>]*?(?:\/>|>([\s\S]*?)<\/\1\s*>)/g)) {
        environment[variable[1]] = unescapeXml(variable[2] ?? '');
    }
    return {
        settings: settings
            .replace(/<EnvironmentVariables\b[^>]*?(?:\/>|>[\s\S]*?<\/EnvironmentVariables\s*>)/g, '')
            .replace('<DesignMode>true</DesignMode>', ''),
        environment,
    };
}
