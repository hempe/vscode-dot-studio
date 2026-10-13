/** SDKs whose projects build an executable without setting `OutputType` */
const EXECUTABLE_SDKS = /^(Microsoft\.NET\.Sdk\.(Web|Worker)|Aspire\.AppHost\.Sdk)(\/|$)/i;

/**
 * Whether a project file builds something you can start, i.e. it can be the startup project.
 * Reads the project file only; an `OutputType` set in Directory.Build.props is not seen.
 * Test projects don't count: they build an Exe for the test runner, but are run through tests.
 */
export function isExecutableProject(projectXml: string): boolean {
    const sdks = [
        ...[...projectXml.matchAll(/<Project\b[^>]*\bSdk\s*=\s*"([^"]+)"/gi)].flatMap(m => m[1].split(';')),
        ...[...projectXml.matchAll(/<Sdk\b[^>]*\bName\s*=\s*"([^"]+)"/gi)].map(m => m[1]),
    ].map(sdk => sdk.trim());

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
