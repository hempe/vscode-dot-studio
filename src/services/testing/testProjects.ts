import * as path from 'path';
import { execFile } from 'child_process';

const TEST_PACKAGES = ['xunit.v3', 'xunit', 'MSTest', 'MSTest.TestFramework', 'TUnit', 'NUnit', 'Microsoft.Testing.Platform', 'Microsoft.NET.Test.Sdk'];

/** Projects that look like test projects; MSBuild then tells whether they run on Microsoft.Testing.Platform */
export function isTestProjectCandidate(projectXml: string): boolean {
    const references = [...projectXml.matchAll(/<PackageReference\b[^>]*\bInclude\s*=\s*"([^"]+)"/gi)].map(match => match[1].toLowerCase());
    return TEST_PACKAGES.some(id => references.includes(id.toLowerCase()))
        || /<Project\b[^>]*\bSdk\s*=\s*"(MSTest\.Sdk|TUnit\.Sdk)\b/i.test(projectXml)
        || /<(IsTestProject|EnableMSTestRunner|IsTestingPlatformApplication)>\s*true\s*</i.test(projectXml);
}

export interface TestProject {
    readonly projectPath: string;
    /** The test app's dll, started as `dotnet <targetPath> --server ...` */
    readonly targetPath: string;
    /** Microsoft.Testing.Platform app, else a classic VSTest project */
    readonly testingPlatform: boolean;
    /** The SDK's vstest.console.dll, which runs VSTest projects */
    readonly vstestConsolePath?: string;
}

export function parseTestProperties(msbuildJson: string): { testingPlatform: boolean; targetPath?: string; vstestConsolePath?: string } {
    try {
        const properties = JSON.parse(msbuildJson).Properties ?? {};
        return {
            testingPlatform: String(properties.IsTestingPlatformApplication).toLowerCase() === 'true',
            ...(properties.TargetPath ? { targetPath: properties.TargetPath } : {}),
            ...(properties.VSTestConsolePath ? { vstestConsolePath: properties.VSTestConsolePath } : {}),
        };
    } catch {
        return { testingPlatform: false };
    }
}

/** Asks MSBuild whether the project is a Microsoft.Testing.Platform app, where it builds to and where vstest.console is */
export function evaluateTestProject(projectPath: string, configuration: string): Promise<TestProject | undefined> {
    return new Promise(resolve => {
        execFile('dotnet', [
            'msbuild', projectPath, '-nologo',
            '-getProperty:IsTestingPlatformApplication', '-getProperty:TargetPath', '-getProperty:VSTestConsolePath',
            `-property:Configuration=${configuration}`,
        ], { cwd: path.dirname(projectPath), timeout: 60000 }, (_error, stdout) => {
            const { testingPlatform, targetPath, vstestConsolePath } = parseTestProperties(stdout ?? '');
            resolve(targetPath ? { projectPath, targetPath, testingPlatform, ...(vstestConsolePath ? { vstestConsolePath } : {}) } : undefined);
        });
    });
}
