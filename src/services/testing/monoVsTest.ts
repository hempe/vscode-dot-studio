import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { TestProject } from './testProjects';
import { privateTempDir, writableByOthers } from '../../core/privateTemp';

// .NET Framework (net472 etc.) VSTest projects outside Windows. The .NET SDK's vstest.console.dll starts their
// test host with Mono, but the SDK for Linux and macOS ships no .NET Framework test host ("Cannot open assembly
// '.../sdk/<version>/Extensions/../TestHostNetFramework/testhost.net472.exe'"), and the one in the
// Microsoft.TestPlatform.Portable package's net8.0 folder crashes Mono (its dlls are .NET 8 builds). What works is
// that package's .NET Framework vstest.console.exe (tools/net462) run with Mono. It looks for the test host in
// Extensions/../TestHostNetFramework as well (from the command line it runs the tests in its own process, but
// design mode always starts a test host), so it runs from a copy of tools/net462 whose TestHostNetFramework
// links back to the folder itself. A copy, because Mono resolves symbolic links to the files.

export const MONO_VSTEST_PACKAGE = 'Microsoft.TestPlatform.Portable';
export const MONO_VSTEST_VERSION = '18.0.1';

/** Whether the project's tests run through Mono's vstest.console.exe instead of the SDK's vstest.console.dll */
export function needsMono(project: TestProject, platform: NodeJS.Platform): boolean {
    return !!project.netFramework && !project.testingPlatform && platform !== 'win32';
}

export const MONO_DEBUG_UNSUPPORTED = 'Debugging .NET Framework tests is not supported outside Windows: they run under Mono, '
    + 'and the C# debugger (coreclr) cannot attach to Mono processes. Run them instead, or debug them on a modern .NET target framework (Select Framework).';

/** What resolveMonoVsTestConsole needs from the machine; replaced in tests */
export interface MonoVsTestDeps {
    hasMono(): Promise<boolean>;
    /** NuGet's global packages folder (`~/.nuget/packages`) */
    globalPackagesFolder(): Promise<string | undefined>;
    exists(file: string): boolean;
    /** Restores the package into the global packages folder */
    download(): Promise<{ ok: boolean; output: string }>;
    /** The runnable copy of the package's tools/net462 folder; returns its vstest.console.exe */
    layout(tools: string): string;
}

const run = (command: string, args: string[], cwd?: string) => new Promise<{ ok: boolean; output: string }>(resolve => {
    execFile(command, args, { cwd, timeout: 300000 }, (error, stdout, stderr) => resolve({ ok: !error, output: `${stdout ?? ''}${stderr ?? ''}`.trim() || String(error ?? '') }));
});

let storageRoot: string | undefined;

/** The extension's own storage folder: the runner and the download live there, not in the shared temp folder */
export function initializeMonoVsTest(storagePath: string): void {
    storageRoot = storagePath;
}

/** Where the runner copy and the download go: the extension's storage; without it a private folder of this user in the temp folder */
function workRoot(): string {
    if (storageRoot) {
        fs.mkdirSync(storageRoot, { recursive: true });
        return storageRoot;
    }
    return privateTempDir();
}

/** Copies tools/net462 to the work folder once, with TestHostNetFramework pointing at the folder itself */
export function copyLayout(tools: string, root: string = workRoot()): string {
    const target = path.join(root, `vstest-mono-${MONO_VSTEST_VERSION}`);
    const consolePath = path.join(target, 'vstest.console.exe');
    if (fs.existsSync(target) && writableByOthers(target)) {
        throw new Error(`${target} can be changed by other users; remove it and try again`);
    }
    if (!fs.existsSync(path.join(target, 'TestHostNetFramework', 'vstest.console.exe'))) {
        // Copied next to it and renamed, so a half-done copy is never used
        const partial = `${target}-${process.pid}-${Date.now()}`;
        fs.cpSync(tools, partial, { recursive: true });
        fs.symlinkSync('.', path.join(partial, 'TestHostNetFramework'));
        fs.rmSync(target, { recursive: true, force: true });
        fs.renameSync(partial, target);
    }
    return consolePath;
}

const defaultDeps: MonoVsTestDeps = {
    hasMono: async () => (await run('mono', ['--version'])).ok,
    globalPackagesFolder: async () => {
        const { output } = await run('dotnet', ['nuget', 'locals', 'global-packages', '--list']);
        return /global-packages:\s*(.+)/.exec(output)?.[1].trim();
    },
    exists: file => fs.existsSync(file),
    download: async () => {
        // A project that only downloads the package; the SDK's own newest framework needs no targeting pack
        const dir = fs.mkdtempSync(path.join(workRoot(), 'download-'));
        try {
            fs.writeFileSync(path.join(dir, 'download.csproj'), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net$(NETCoreAppMaximumVersion)</TargetFramework></PropertyGroup>
  <ItemGroup><PackageDownload Include="${MONO_VSTEST_PACKAGE}" Version="[${MONO_VSTEST_VERSION}]" /></ItemGroup>
</Project>`);
            // No Directory.Build.props/targets or Directory.Packages.props from a folder above the download project
            return await run('dotnet', ['restore', '-nologo', '-p:ImportDirectoryBuildProps=false', '-p:ImportDirectoryBuildTargets=false', '-p:ImportDirectoryPackagesProps=false'], dir);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    },
    layout: copyLayout,
};

export const MONO_MISSING = '.NET Framework test projects need Mono outside Windows, and `mono` is not on the PATH '
    + "(VSTest: \"Could not find 'mono' host. Make sure that 'mono' is installed on the machine and is available in PATH environment variable.\"). "
    + 'Install Mono, or run the tests on a modern .NET target framework (Select Framework).';

/** vstest.console.exe for Mono, downloaded on first use; throws with the reason when .NET Framework tests cannot run */
export async function resolveMonoVsTestConsole(deps: MonoVsTestDeps = defaultDeps): Promise<string> {
    if (!await deps.hasMono()) {
        throw new Error(MONO_MISSING);
    }
    const tools = (packages: string) => path.join(packages, MONO_VSTEST_PACKAGE.toLowerCase(), MONO_VSTEST_VERSION, 'tools', 'net462');
    const found = (packages: string | undefined) => !!packages && deps.exists(path.join(tools(packages), 'vstest.console.exe'));
    let packages = await deps.globalPackagesFolder();
    if (!found(packages)) {
        const download = await deps.download();
        packages ??= await deps.globalPackagesFolder();
        if (!download.ok || !found(packages)) {
            throw new Error(`Could not download ${MONO_VSTEST_PACKAGE} ${MONO_VSTEST_VERSION} (vstest.console.exe for Mono): ${download.output}`);
        }
    }
    try {
        return deps.layout(tools(packages!));
    } catch (error) {
        throw new Error(`Could not prepare vstest.console.exe for Mono: ${error instanceof Error ? error.message : error}`);
    }
}

let resolving: Promise<string> | undefined;

/** resolveMonoVsTestConsole once for all test projects; asked again after a failure (Mono installed meanwhile) */
export function monoVsTestConsole(): Promise<string> {
    resolving ??= resolveMonoVsTestConsole().catch(error => {
        resolving = undefined;
        throw error;
    });
    return resolving;
}
