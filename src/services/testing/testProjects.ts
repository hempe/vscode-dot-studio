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
    /** The framework a multi-targeted project is built and run for (see pickTestFramework); unset for single-target projects */
    readonly targetFramework?: string;
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

/** The frameworks of a multi-targeted project (`TargetFrameworks` without `TargetFramework`) from MSBuild's JSON output */
export function multiTargetFrameworks(msbuildJson: string): string[] {
    try {
        const properties = JSON.parse(msbuildJson).Properties ?? {};
        if (String(properties.TargetFramework ?? '').trim()) {
            return [];
        }
        return String(properties.TargetFrameworks ?? '').split(';').map(framework => framework.trim()).filter(framework => framework);
    } catch {
        return [];
    }
}

/** .NET (Core) 3+ frameworks as [major, minor]; undefined for .NET Framework, .NET Standard and older .NET Core */
function modernVersion(framework: string): [number, number] | undefined {
    const match = /^net(?:coreapp)?(\d+)\.(\d+)(?:-.*)?$/i.exec(framework);
    if (!match) {
        return undefined;
    }
    const version: [number, number] = [Number(match[1]), Number(match[2])];
    return version[0] >= 3 && (version[0] >= 5 || /^netcoreapp/i.test(framework)) ? version : undefined;
}

/**
 * The framework to test a multi-targeted project on: the highest modern .NET whose runtime is installed,
 * else the highest modern .NET, else the first framework (e.g. only .NET Framework ones).
 */
export function pickTestFramework(frameworks: readonly string[], runtimeMajors: readonly number[]): string | undefined {
    const modern = frameworks
        .map(framework => ({ framework, version: modernVersion(framework) }))
        .filter((entry): entry is { framework: string; version: [number, number] } => entry.version !== undefined)
        .sort((a, b) => b.version[0] - a.version[0] || b.version[1] - a.version[1]);
    return modern.find(entry => runtimeMajors.includes(entry.version[0]))?.framework ?? modern[0]?.framework ?? frameworks[0];
}

/** Major versions of the installed Microsoft.NETCore.App runtimes from `dotnet --list-runtimes` */
export function parseRuntimeMajors(listRuntimes: string): number[] {
    const majors = [...listRuntimes.matchAll(/^Microsoft\.NETCore\.App\s+(\d+)\./gm)].map(match => Number(match[1]));
    return [...new Set(majors)].sort((a, b) => a - b);
}

let runtimeMajors: Promise<number[]> | undefined;

/** The installed .NET runtimes' major versions, asked once */
export function installedRuntimeMajors(): Promise<number[]> {
    runtimeMajors ??= new Promise(resolve => {
        execFile('dotnet', ['--list-runtimes'], { timeout: 30000 }, (_error, stdout) => resolve(parseRuntimeMajors(stdout ?? '')));
    });
    return runtimeMajors;
}

function getTestProperties(projectPath: string, configuration: string, extra: string[]): Promise<string> {
    return new Promise(resolve => {
        execFile('dotnet', [
            'msbuild', projectPath, '-nologo',
            '-getProperty:IsTestingPlatformApplication', '-getProperty:TargetPath', '-getProperty:VSTestConsolePath',
            `-property:Configuration=${configuration}`, ...extra,
        ], { cwd: path.dirname(projectPath), timeout: 60000 }, (_error, stdout) => resolve(stdout ?? ''));
    });
}

/**
 * Asks MSBuild whether the project is a Microsoft.Testing.Platform app, where it builds to and where vstest.console is.
 * A multi-targeted project has no TargetPath as a whole: it is evaluated again for the framework pickTestFramework chooses.
 */
export async function evaluateTestProject(projectPath: string, configuration: string): Promise<TestProject | undefined> {
    let output = await getTestProperties(projectPath, configuration, ['-getProperty:TargetFramework', '-getProperty:TargetFrameworks']);
    let targetFramework: string | undefined;
    const frameworks = multiTargetFrameworks(output);
    if (frameworks.length > 0) {
        targetFramework = pickTestFramework(frameworks, await installedRuntimeMajors());
        output = await getTestProperties(projectPath, configuration, [`-property:TargetFramework=${targetFramework}`]);
    }
    const { testingPlatform, targetPath, vstestConsolePath } = parseTestProperties(output);
    return targetPath
        ? { projectPath, targetPath, testingPlatform, ...(vstestConsolePath ? { vstestConsolePath } : {}), ...(targetFramework ? { targetFramework } : {}) }
        : undefined;
}
