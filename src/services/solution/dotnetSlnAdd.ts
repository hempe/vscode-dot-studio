import { execFile } from 'child_process';

/** One run of dotnet: the exit code and what it printed */
export type DotnetRunner = (args: string[], cwd: string) => Promise<{ code: number; output: string }>;

const runDotnet: DotnetRunner = (args, cwd) => new Promise(resolve => {
    execFile('dotnet', args, { cwd, timeout: 120000 }, (error, stdout, stderr) => resolve({ code: error ? 1 : 0, output: `${stdout}${stderr}` }));
});

/**
 * `dotnet sln <solution> add <projects> <placement>` without the projects they reference, as Visual Studio's Add Existing Project:
 * .NET 10's `dotnet sln add` adds the referenced projects too (`--include-references`, on by default) and some SDKs then refuse a
 * reference the solution already has ("Solution folder 'src' already contains a project with the filename 'Core.csproj'"), adding
 * nothing. SDKs before .NET 10 do not know the option: then without it. Throws with dotnet's output when the add fails.
 */
export async function dotnetSlnAdd(solutionPath: string, projects: readonly string[], placement: readonly string[], cwd: string, run: DotnetRunner = runDotnet): Promise<void> {
    const args = ['sln', solutionPath, 'add', ...projects, ...placement];
    let result = await run([...args, '--include-references', 'false'], cwd);
    if (result.code !== 0 && /include-references/i.test(result.output)) {
        result = await run(args, cwd);
    }
    if (result.code !== 0) {
        throw new Error(`dotnet sln add failed: ${result.output.trim().split(/\r?\n/).slice(0, 4).join(' ')}`);
    }
}
