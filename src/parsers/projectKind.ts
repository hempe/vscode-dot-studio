/** SDKs whose projects build an executable without setting `OutputType` */
const EXECUTABLE_SDKS = /^(Microsoft\.NET\.Sdk\.(Web|Worker)|Aspire\.AppHost\.Sdk)(\/|$)/i;

/** The SDKs of a project file, from `<Project Sdk="...">` and `<Sdk Name="..." />` */
function projectSdks(projectXml: string): string[] {
    return [
        ...[...projectXml.matchAll(/<Project\b[^>]*\bSdk\s*=\s*"([^"]+)"/gi)].flatMap(m => m[1].split(';')),
        ...[...projectXml.matchAll(/<Sdk\b[^>]*\bName\s*=\s*"([^"]+)"/gi)].map(m => m[1]),
    ].map(sdk => sdk.trim());
}

/** Whether a project file uses the web SDK (ASP.NET Core) */
export function isWebProject(projectXml: string): boolean {
    return projectSdks(projectXml).some(sdk => /^Microsoft\.NET\.Sdk\.Web(\/|$)/i.test(sdk));
}

/**
 * Whether a project file builds something you can start, i.e. it can be the startup project.
 * Reads the project file only; an `OutputType` set in Directory.Build.props is not seen.
 * Test projects don't count: they build an Exe for the test runner, but are run through tests.
 */
export function isExecutableProject(projectXml: string): boolean {
    const sdks = projectSdks(projectXml);

    const isTestProject = /<IsTestProject>\s*true\s*<\/IsTestProject>/i.test(projectXml)
        || /<PackageReference\b[^>]*\bInclude\s*=\s*"Microsoft\.NET\.Test\.Sdk"/i.test(projectXml)
        || sdks.some(sdk => /^MSTest\.Sdk(\/|$)/i.test(sdk));
    if (isTestProject) {
        return false;
    }

    const outputType = /<OutputType>\s*([^<\s]+)\s*<\/OutputType>/i.exec(projectXml)?.[1];
    if (outputType) {
        return /^(Exe|WinExe)$/i.test(outputType);
    }
    return sdks.some(sdk => EXECUTABLE_SDKS.test(sdk));
}

/** Whether the project (with the props files it imports) references Entity Framework Core: it gets the Entity Framework menu */
export function usesEntityFramework(projectText: string): boolean {
    return /<PackageReference\b[^>]*\b(?:Include|Update)\s*=\s*["']Microsoft\.EntityFrameworkCore(?:\.[\w.]+)?["']/i.test(projectText);
}
