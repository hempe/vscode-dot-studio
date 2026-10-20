import * as xml2js from 'xml2js';

const DEFAULT_CONFIGURATIONS = ['Debug', 'Release'];
const DEFAULT_PLATFORMS = ['Any CPU'];

function names(value: unknown): string[] {
    return typeof value === 'string' ? value.split(';').map(name => name.trim()).filter(Boolean) : [];
}

/**
 * The configurations and platforms a project file declares (`Configurations`, `Platforms`, separated by `;`);
 * Debug/Release and Any CPU when it declares none or cannot be read
 */
export async function parseProjectConfigurations(projectXml: string): Promise<{ configurations: string[]; platforms: string[] }> {
    const configurations: string[] = [];
    const platforms: string[] = [];
    try {
        const project = await new xml2js.Parser().parseStringPromise(projectXml);
        for (const group of project?.Project?.PropertyGroup ?? []) {
            configurations.push(...names(group?.Configurations?.[0]));
            platforms.push(...names(group?.Platforms?.[0]));
        }
    } catch {
        // Unreadable project file: the defaults
    }
    return {
        configurations: configurations.length > 0 ? [...new Set(configurations)] : DEFAULT_CONFIGURATIONS,
        platforms: platforms.length > 0 ? [...new Set(platforms)] : DEFAULT_PLATFORMS,
    };
}
