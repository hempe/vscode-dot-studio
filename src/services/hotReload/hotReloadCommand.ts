import * as path from 'path';

// The command line of "Start with Hot Reload": `dotnet watch run` (no vscode imports, tested on its own).
// Flags checked against dotnet watch of SDK 10.0.111: --project, --launch-profile, --no-launch-profile, -c and -f are
// taken by watch and passed on to its `dotnet run`; -property:Platform=... reaches the build.

export interface HotReloadStart {
    readonly projectPath: string;
    /** The launch profile to run; undefined runs with `--no-launch-profile` (the project has none `dotnet run` can use) */
    readonly launchProfile?: string;
    readonly configuration: string;
    /** The target framework, when known */
    readonly framework?: string | null;
    /** MSBuild properties for the build, e.g. `-property:Platform=x64` */
    readonly properties?: readonly string[];
}

/** Arguments of `dotnet` for `dotnet watch run`; `--non-interactive` restarts the app on rude edits without asking */
export function hotReloadArgs(start: HotReloadStart): string[] {
    return [
        'watch', 'run',
        '--project', start.projectPath,
        ...(start.launchProfile ? ['--launch-profile', start.launchProfile] : ['--no-launch-profile']),
        '--non-interactive',
        '--configuration', start.configuration,
        ...(start.framework ? ['--framework', start.framework] : []),
        ...(start.properties ?? []),
    ];
}

/** The terminal a project runs in with Hot Reload: "<project> (watch)" */
export function hotReloadTerminalName(projectPath: string): string {
    return `${path.basename(projectPath, path.extname(projectPath))} (watch)`;
}

