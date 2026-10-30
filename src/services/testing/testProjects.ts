import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { RequestQueue } from '../../core/requestQueue';
import { isNetFrameworkTarget } from '../../parsers/targetFrameworks';

const TEST_PACKAGES = ['xunit.v3', 'xunit', 'MSTest', 'MSTest.TestFramework', 'TUnit', 'NUnit', 'Microsoft.Testing.Platform', 'Microsoft.NET.Test.Sdk'];

/** Projects that look like test projects; MSBuild then tells whether they run on Microsoft.Testing.Platform */
export function isTestProjectCandidate(projectXml: string): boolean {
    const references = [...projectXml.matchAll(/<PackageReference\b[^>]*\bInclude\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)].map(match => (match[1] ?? match[2]).toLowerCase());
    return TEST_PACKAGES.some(id => references.includes(id.toLowerCase()))
        || /<Project\b[^>]*\bSdk\s*=\s*"(MSTest\.Sdk|TUnit\.Sdk)\b/i.test(projectXml)
        || /<(IsTestProject|EnableMSTestRunner|IsTestingPlatformApplication)>\s*true\s*</i.test(projectXml);
}

/**
 * The project file and the Directory.Build.props / Directory.Build.targets files above it, as one text: test packages are often
 * referenced for a whole folder of test projects there (`tests/Directory.Build.props`), and the project file holds only its framework
 */
export function projectTextWithBuildProps(projectPath: string, readFile: (file: string) => string = file => fs.readFileSync(file, 'utf8')): string {
    const texts = [readFile(projectPath)];
    for (let dir = path.dirname(path.resolve(projectPath)); ; dir = path.dirname(dir)) {
        for (const name of ['Directory.Build.props', 'Directory.Build.targets']) {
            try {
                texts.push(readFile(path.join(dir, name)));
            } catch {
                // not there
            }
        }
        if (path.dirname(dir) === dir) {
            break;
        }
    }
    return texts.join('\n');
}

const msbuildQueue = new RequestQueue(4);

/**
 * Whether MSBuild itself calls the project a test project (`IsTestProject`, or a Microsoft.Testing.Platform app): the text check
 * also takes every project below a props file that names test packages under a condition. True when MSBuild doesn't answer.
 */
export function confirmTestProject(projectPath: string): Promise<boolean> {
    return msbuildQueue.next(() => new Promise<boolean>(resolve => {
        execFile('dotnet', ['msbuild', projectPath, '-nologo', '-getProperty:IsTestProject', '-getProperty:IsTestingPlatformApplication'],
            { cwd: path.dirname(projectPath), timeout: 60000 }, (_error, stdout) => resolve(!parseTestProperties(stdout ?? '').notTestProject));
    }));
}

export interface TestProject {
    readonly projectPath: string;
    /** The test app's dll, started as `dotnet <targetPath> --server ...` */
    readonly targetPath: string;
    /** Microsoft.Testing.Platform app, else a classic VSTest project */
    readonly testingPlatform: boolean;
    /** The SDK's vstest.console.dll, which runs VSTest projects */
    readonly vstestConsolePath?: string;
    /** The team's `.runsettings` file (`RunSettingsFilePath`), absolute */
    readonly runSettingsPath?: string;
    /** The framework a multi-targeted project is built and run for (see chooseTestFramework); unset for single-target projects */
    readonly targetFramework?: string;
    /** Why a multi-targeted project runs on targetFramework, for the log */
    readonly frameworkReason?: string;
    /** The tests run on .NET Framework (net472 etc.): under Mono outside Windows */
    readonly netFramework?: boolean;
}

/** The command and arguments that start the test app: a .NET Framework exe is its own program (Windows) or runs under Mono; else `dotnet app.dll` */
export function testAppCommand(project: TestProject, args: string[], platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
    // `dotnet` would look for a runtimeconfig.json and hostpolicy.dll that a .NET Framework app doesn't have
    if (!/\.exe$/i.test(project.targetPath)) {
        return { command: 'dotnet', args: [project.targetPath, ...args] };
    }
    return platform === 'win32' ? { command: project.targetPath, args } : { command: 'mono', args: [project.targetPath, ...args] };
}

export function parseTestProperties(msbuildJson: string): { testingPlatform: boolean; notTestProject?: true; targetPath?: string; vstestConsolePath?: string; runSettingsPath?: string } {
    try {
        const properties = JSON.parse(msbuildJson).Properties ?? {};
        const testingPlatform = String(properties.IsTestingPlatformApplication).toLowerCase() === 'true';
        return {
            testingPlatform,
            // MSBuild answered IsTestProject and it is not true: a library below a props file that mentions test packages (VSTestConsolePath is set for every project)
            ...('IsTestProject' in properties && !testingPlatform && String(properties.IsTestProject).toLowerCase() !== 'true' ? { notTestProject: true } : {}),
            ...(properties.TargetPath ? { targetPath: properties.TargetPath } : {}),
            ...(properties.VSTestConsolePath ? { vstestConsolePath: properties.VSTestConsolePath } : {}),
            ...(properties.RunSettingsFilePath ? { runSettingsPath: properties.RunSettingsFilePath } : {}),
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

/**
 * The framework to test a multi-targeted project on and why: the solution's selected framework (Select Framework)
 * when the project targets it, .NET Framework ones included; else pickTestFramework's automatic pick.
 */
export function chooseTestFramework(frameworks: readonly string[], runtimeMajors: readonly number[], selected?: string): { framework: string; reason: string } | undefined {
    const selectedFramework = selected ? frameworks.find(framework => framework.toLowerCase() === selected.toLowerCase()) : undefined;
    if (selectedFramework) {
        return { framework: selectedFramework, reason: 'the selected framework' };
    }
    const framework = pickTestFramework(frameworks, runtimeMajors);
    if (!framework) {
        return undefined;
    }
    const version = modernVersion(framework);
    const how = !version ? 'no modern .NET, the first framework'
        : runtimeMajors.includes(version[0]) ? 'the highest .NET with an installed runtime'
            : 'no installed runtime fits, the highest .NET';
    return { framework, reason: selected ? `automatic: the selected framework ${selected} is not one of ${frameworks.join(', ')}; ${how}` : `automatic: ${how}` };
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

/** The TargetFramework property from MSBuild's JSON output */
function targetFrameworkProperty(msbuildJson: string): string | undefined {
    try {
        return String(JSON.parse(msbuildJson).Properties?.TargetFramework ?? '').trim() || undefined;
    } catch {
        return undefined;
    }
}

function getTestProperties(projectPath: string, configuration: string, extra: string[]): Promise<string> {
    return new Promise(resolve => {
        execFile('dotnet', [
            'msbuild', projectPath, '-nologo',
            '-getProperty:IsTestProject', '-getProperty:IsTestingPlatformApplication', '-getProperty:TargetPath', '-getProperty:VSTestConsolePath', '-getProperty:RunSettingsFilePath',
            `-property:Configuration=${configuration}`, ...extra,
        ], { cwd: path.dirname(projectPath), timeout: 60000 }, (_error, stdout) => resolve(stdout ?? ''));
    });
}

/**
 * The project from what MSBuild said (for `framework`, chosen by `choice` when multi-targeted);
 * a relative `RunSettingsFilePath` is relative to the project folder
 */
export function testProjectFrom(projectPath: string, msbuildJson: string, framework?: string, choice?: { framework: string; reason: string }): TestProject | undefined {
    const { testingPlatform, notTestProject, targetPath, vstestConsolePath, runSettingsPath } = parseTestProperties(msbuildJson);
    return targetPath && !notTestProject
        ? {
            projectPath, targetPath, testingPlatform,
            ...(vstestConsolePath ? { vstestConsolePath } : {}),
            ...(runSettingsPath ? { runSettingsPath: path.resolve(path.dirname(projectPath), runSettingsPath) } : {}),
            ...(choice ? { targetFramework: choice.framework, frameworkReason: choice.reason } : {}),
            ...(isNetFrameworkTarget(framework) ? { netFramework: true } : {}),
        }
        : undefined;
}

/**
 * Asks MSBuild whether the project is a Microsoft.Testing.Platform app, where it builds to, where vstest.console is
 * and which run settings file it uses.
 * A multi-targeted project has no TargetPath as a whole: it is evaluated again for the framework chooseTestFramework
 * chooses, the solution's selected framework (`selectedFramework`) when the project targets it.
 */
/** The target frameworks of a multi-targeted project; none for a project with one */
export async function testFrameworks(projectPath: string): Promise<string[]> {
    return multiTargetFrameworks(await getTestProperties(projectPath, 'Debug', ['-getProperty:TargetFramework', '-getProperty:TargetFrameworks']));
}

export async function evaluateTestProject(projectPath: string, configuration: string, selectedFramework?: string): Promise<TestProject | undefined> {
    let output = await getTestProperties(projectPath, configuration, ['-getProperty:TargetFramework', '-getProperty:TargetFrameworks']);
    let framework = targetFrameworkProperty(output);
    let choice: { framework: string; reason: string } | undefined;
    const frameworks = multiTargetFrameworks(output);
    if (frameworks.length > 0) {
        choice = chooseTestFramework(frameworks, await installedRuntimeMajors(), selectedFramework);
        framework = choice?.framework;
        output = await getTestProperties(projectPath, configuration, [`-property:TargetFramework=${framework}`]);
    }
    return testProjectFrom(projectPath, output, framework, choice);
}
