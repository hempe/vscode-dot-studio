# Code Review, Area 5: Run, Debug and Tests (2026-10-24)

Scope: `services/debugConfigService.ts`, `services/startupProfiles/`, `services/attach/`, `services/hotReload/`, `services/devCert/`, `services/monoDebug.ts`, `services/testing/` (testExplorer, testProjects, vstestClient, testingPlatformClient, monoVsTest, runSettings, testTree), `services/dotnetTaskProvider.ts`, `services/runTask.ts`, `services/buildConfiguration.ts`, `services/launchSettings.ts`, `services/activeBuild.ts`, `core/jsonc.ts`.

Method: everything in scope read in full; proofs run as jest scratch tests in a copy of the repo (`/tmp/rev5/repo`, `node_modules` symlinked, files `src/review/area5*.test.ts`) driving the real functions, with real `dotnet` (SDK 10.0.111) and mono 6.12 on scratch projects under `/tmp/rev5` (one a copy of `/home/hempe/manual-test/1-test-explorer`). No VS Code or Electron was started. Known bugs and Not Planned items of `docs/roadmap.md` were left out.

## Summary

| Id | Severity | Proven? | One line |
|---|---|---|---|
| A5-1 | bug | proven | Test Explorer never forgets test items: every discovery adds the whole tree to `nodes` (and `vstestCases`), old trees stay in memory |
| A5-2 | bug | proven | Test Explorer build via `execFile` without `maxBuffer`: >1 MB of build output (a few thousand warnings) kills the build and reports "Build failed" |
| A5-3 | risk | proven | Mono's vstest.console runs from the predictable shared `$TMPDIR/shinobi-dotnet-vstest-mono-18.0.1`, reused without owner check: another user can plant it (same pattern: `.runsettings`, `.slnf`) |
| A5-4 | risk | proven | The Mono runner download restores in `$TMPDIR`, importing any `Directory.Build.props`/`NuGet.Config` above it: code runs as the user |
| A5-5 | bug | proven | A user's own compound named "Startup" is deleted together with every configuration it lists |
| A5-6 | bug | proven | launch.json with a syntax error: tasks.json switches the startup project, launch.json does not; F5 builds one project and runs another |
| A5-7 | risk | proven (emulated timing) | Startup configuration writes are not serialised: the slower earlier request overwrites the later one |
| A5-8 | bug | proven (VS Code's quoting code + bash) | All build tasks use `ShellExecution` with plain strings: paths with `&`, `;`, `(`, `$`, `\|` or an apostrophe break the command |
| A5-9 | risk | proven | A test app/vstest.console that exits at once is only noticed after the 30 s connect timeout, per project |
| A5-10 | bug | proven | Test projects whose test packages come from `Directory.Build.props` are not detected (text test of the project file) |
| A5-11 | bug | proven (code) | Failed Test Explorer builds say "see the Problems panel", which never gets their errors; Cancel does not stop the build; one build per project |
| A5-12 | risk | suspected (Windows) | Attach to Process reads PowerShell output as UTF-8: apphosts under non-ASCII paths are not listed |

## Findings

### A5-1 (bug, proven): the Test Explorer keeps every test item it ever created

`src/services/testing/testExplorer.ts:180` (`nodes = new Map<vscode.TestItem, TestNode>()`), filled in `toItem` (`:367-369`). Every discovery builds new `TestItem`s for the whole project (`discover`, `:358`, `children.replace(...)`) and adds them to `nodes`; nothing ever deletes from it (not on re-discovery, not when a project leaves the solution, `:281-284`). Each old item keeps its parent and children, so every old tree stays reachable. `vstestCases` (`:182`) also only grows (tests that were removed or renamed stay).

Scenario: a solution with 3,000 tests and `shinobi.tests.discoverAfterBuild` (default on: rediscovery after each successful build, `:203-210`): after 100 builds in a day the extension host holds 300,000 dead test items and their `TestNode`s (with messages/stack traces of the discovery), until VS Code is restarted. The same happens on every Refresh and every run that finds unmatched results (`:536-547`).

Proof (scratch jest test `src/review/area5.test.ts` in a copy of the repo, test A, the recorded xUnit v3 app of `testExplorer.test.ts`, `modified()` returning a new time per refresh):

```
A: nodes after 1 discovery=4, after 51 discoveries=204, live test items=8
```

Fix: clear the project's entries (walk the old `state.item.children` and delete them from `nodes`, and their uids from `vstestCases`) before `children.replace`, and when a project is removed; or key `nodes` by item id in a per-project map that is replaced as a whole.

### A5-2 (bug, proven): a test project whose build prints more than 1 MB "fails to build" in the Test Explorer

`src/services/testing/testExplorer.ts:122-128` (`defaultDeps.build`): `execFile('dotnet', ['build', ...], { cwd, timeout: 600000 }, ...)` without `maxBuffer`. Node's default is 1 MiB of stdout; past it Node kills `dotnet build` and calls back with `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`, which `resolve(!error)` turns into "Build failed, see the Problems panel" for every test of the project (`:435-437`), while the Problems panel shows nothing (the build ran outside a task) and a `dotnet build` in a terminal succeeds. The killed build can also leave half-written output behind.

Scenario: a legacy test project (or one that references a big legacy project, whose warnings are printed by the same build) with a few thousand warnings (nullable, obsolete APIs), after any edit. Each warning line is ~250 characters with the full paths `GenerateFullPaths` gives, so ~4,000 warnings are enough.

Proof (scratch project `/tmp/rev5/mb/Warn.csproj` with 6,000 `#warning` lines; `run.js` makes the same `execFile` call as `defaultDeps.build`):

```
$ dotnet build -nologo -v q Warn.csproj > first.txt; echo $?; wc -c first.txt
0
1615658 first.txt
$ touch Big.cs && node run.js
resolve(false) after 1212 ms, stdout 1048576 chars, error: stdout maxBuffer length exceeded code=ERR_CHILD_PROCESS_STDIO_MAXBUFFER
```

(The run right after the first build passed: an up-to-date build prints nothing, so the bug shows after edits, which is when tests are run.) Fix: `spawn` and stream into `output` (the run output wants it anyway), or a large `maxBuffer` and judge the build by its exit code, not by `error`.

### A5-3 (risk, proven): Mono's vstest.console is run from a predictable shared temp folder that anyone can plant first

`src/services/testing/monoVsTest.ts:44-56` (`copyLayout`): the runner for .NET Framework tests outside Windows lives in `os.tmpdir()/shinobi-dotnet-vstest-mono-18.0.1`. When `TestHostNetFramework/vstest.console.exe` exists below it, the folder is used as it is: no check of its owner, its mode or its content, and it is never re-copied. `mono <that folder>/vstest.console.exe` then runs with the user's rights, and design mode starts the test host from the same folder.

Scenario: on a shared Linux machine (build server, university or company jump host, a dev container shared by several accounts; `/tmp` is common to all users, unlike macOS's per-user `$TMPDIR` and Windows' `%TEMP%`) another account creates `/tmp/shinobi-dotnet-vstest-mono-18.0.1/` with its own `vstest.console.exe` and `TestHostNetFramework/vstest.console.exe`. The next time the victim runs a `net48` test project, the planted program runs as the victim. A mere leftover from another user (or a copy interrupted between `rmSync` and `renameSync` by another window: `:52-53` delete a folder another window may be running from) breaks the runner instead.

Proof (scratch jest test `src/review/area5mono.test.ts`, test B1, the real `resolveMonoVsTestConsole()` with its default dependencies, real mono 6.12 and the package already in `~/.nuget/packages`; `TMPDIR=/tmp/rev5/tmpB` stands in for `/tmp` and the planted folder was created before the call):

```
B1: mono will run /tmp/rev5/tmpB/shinobi-dotnet-vstest-mono-18.0.1/vstest.console.exe: "PLANTED BY ANOTHER USER"
```

Fix: put the copy in a folder only the user owns, e.g. the extension's `globalStorageUri` (or `~/.nuget/packages/.../tools/net462-shinobi`), and verify the folder's owner (`fs.statSync(...).uid === process.getuid()`) and mode when reusing it. The same predictable-shared-path pattern exists in `testExplorer.ts:149` (`$TMPDIR/shinobi-<hash>.runsettings`, written with `writeFileSync`, which follows a planted symlink; on this machine `fs.protected_symlinks=1` and `fs.protected_regular=1` block that, older or hardened-off systems do not) and in `unloadedProjects.ts:72` (`$TMPDIR/shinobi-dotnet/<sha1 of the solution path>/<name>.slnf`, the target of every build task while a project is unloaded, `dotnetTaskProvider.ts:61`; the sub-folders are not under the sticky-bit protection, so a planted world-writable `shinobi-dotnet/<id>/` lets another user swap the filter between our write and MSBuild's read: suspected, not run).

### A5-4 (risk, proven): the download of the Mono test runner runs `dotnet restore` in the temp folder, which imports any `Directory.Build.props` and `NuGet.Config` above it

`src/services/testing/monoVsTest.ts:65-77` (`defaultDeps.download`): a project `download.csproj` in `mkdtemp($TMPDIR/shinobi-vstest-)` is restored. MSBuild imports `Directory.Build.props`/`Directory.Build.targets` from every parent folder and NuGet reads `NuGet.Config` from every parent folder, so with `$TMPDIR=/tmp` a `/tmp/Directory.Build.props` (or `/tmp/NuGet.Config` with another feed serving its own `Microsoft.TestPlatform.Portable 18.0.1`, which A5-3 then runs) from any account runs code as the user. The random folder name does not help, the parent is fixed.

Scenario: as in A5-3, a shared Linux machine; the first run of a .NET Framework test project downloads the package (`docs/tests.md` says so).

Proof (test B2: `TMPDIR=/tmp/rev5/tmpC` with a `Directory.Build.props` that writes a file and then fails, `NUGET_PACKAGES` pointing at an empty folder so the download runs):

```
B2: error=Error: Could not download Microsoft.TestPlatform.Portable 18.0.1 (vstest.console.exe for Mono): Determining projects to restore...
/tmp/rev5/tmpC/Directory.Build.props(4,5): error : stopped by the planted file [/tmp/rev5/tmpC/shinobi-vstest-GcP8OD/download.csproj]
B2: marker=code ran in /tmp/rev5/tmpC/shinobi-vstest-GcP8OD
```

Fix: restore in a folder the user owns whose parents hold no build files (the extension's global storage), with `-p:ImportDirectoryBuildProps=false -p:ImportDirectoryBuildTargets=false` and `--configfile` pointing at the user's own NuGet config (the private feed must keep working: the user-level config, not none). Area 6 should check its own temp builds for the same pattern (`codeCleanup.ts:93` makes a report folder under `$TMPDIR`; not reviewed here).

### A5-5 (bug, proven): the user's own compound named "Startup" is deleted with every configuration it lists

`src/services/debugConfigService.ts:144` calls `removeStartupProfileConfiguration` (`:247-258`) on every Set as Startup Project, framework change, configuration change and launch-settings refresh. It treats *any* compound named `Startup` as ours: it removes the compound and every configuration whose name the compound lists, without checking that these are configurations we wrote (ours are `presentation.hidden`, named `<profile>: <project>`, with `type` `coreclr`/`clr`/`mono`). `updateStartupProfileConfiguration` (`:222-224`) likewise deletes configurations the previous `Startup` compound listed. A user's own `"name": "Startup"` configuration (any type) is likewise overwritten in place by `upsertJsoncArrayItem` (`:147-154`).

Scenario: someone coming from Visual Studio wrote a compound "Startup" for "Frontend" (node) and "Backend" (coreclr) before installing the extension. The first Set as Startup Project (or Configure Startup Projects) silently deletes all three; they are gone from launch.json (only git or VS Code's local history bring them back).

Proof (scratch jest test `src/review/area5dbg.test.ts`, test E1, the mocks of `debugConfigService.test.ts`, the real `updateStartupConfiguration`):

```
launch.json before: configurations Frontend (node), Backend (coreclr); compounds [{ "name": "Startup", "configurations": ["Frontend", "Backend"] }]
E1: configurations now ["Startup"], compounds []
```

Fix: recognise our compound by a marker (e.g. `presentation.order: 1` plus `preLaunchTask: "StartupPreBuild"`, or a dedicated property such as `"shinobi": true`, which VS Code ignores), only delete listed configurations that are ours (`presentation.hidden` and our naming), and refuse with a message (instead of overwriting) when a `Startup` entry exists that is not ours.

### A5-6 (bug, proven): with a syntax error in launch.json, Set as Startup Project switches the build but not the program: F5 builds one project and runs another

`src/services/debugConfigService.ts:141` writes `tasks.json` (the `StartupPreBuild` task, which `getStartupProject()` reads) before `upsertJsoncArrayItem` (`:147`) finds that `launch.json` has syntax errors and leaves it unchanged (`:633-639`); `updateStartupConfiguration` then returns `true` (`:160`), so `Solution.setStartupProject` also clears an active startup profile (`Solution.ts:1463-1466`). The tree now shows the new project as startup project (bold), F5 runs the old `Startup` configuration (VS Code reads launch.json tolerantly), whose `preLaunchTask` builds the new project, and starts the old project's program, unbuilt. The same order in `updateStartupProfileConfiguration` (`:208-220`): tasks.json is switched to the solution build before the launch.json check.

Scenario: the user is in the middle of editing another configuration in launch.json (a missing comma, saved) and right-clicks another project > Set as Startup Project. A warning says launch.json was not updated, but the tree and tasks.json say otherwise, and F5 now runs a stale program.

Proof (test E3: Startup set to A, then a configuration without a comma is added to launch.json, then Set as Startup Project on B):

```
E3: returned true; getStartupProject()=B.csproj; StartupPreBuild builds B/B.csproj; Startup runs /ws/A/bin/Debug/net10.0/A.dll; warnings [".vscode/launch.json has syntax errors and was not updated. Fix them and select the startup project again."]
```

Fix: check both files before writing either, and return false when launch.json was not written.

### A5-7 (risk, proven with emulated timing): concurrent startup-configuration writes are not serialised; the last to finish wins, not the last asked for

`updateStartupConfiguration` (`src/services/debugConfigService.ts:104-165`) awaits `dotnet msbuild -getProperty:TargetPath` (`:464-469`, about 1 s warm, several seconds cold) between reading and writing launch.json/tasks.json. Only `refreshStartup` (`startProfile.ts:195-198`) queues its runs; `Solution.setStartupProject` (`Solution.ts:1463`), the framework drop-down (`frameworkDropdownService.ts:96`), Set Launch Profile (`debugConfigService.ts:740`) and the project rename (`solutionActionService.ts:358`) call it directly, beside the queue and beside each other.

Scenario: Set as Startup Project on A (its first evaluation is cold: 3 s) and right after on B (warm: 0.5 s); or a configuration change (Debug to Release fires `refreshStartup`, which rewrites the startup project read before the change) while the user picks another startup project. The tree shows B in bold for a moment, then A again: F5 runs A.

Proof (test E2, `execFile` mocked to answer A's evaluation after 1.5 s and B's after 0.1 s; calls A, then B 50 ms later):

```
E2: asked A then B; startup project now A.csproj, program /ws/A/bin/Debug/net10.0/A.dll
```

Fix: run every launch.json/tasks.json writer through the one queue of `refreshStartup` (and let a newer request for the same file supersede an older one still waiting).

### A5-8 (bug, proven with VS Code's quoting code): build, rebuild, clean, restore, pack and publish break on paths with `&`, `;`, `(`, `$`, `|` or an apostrophe

`src/services/dotnetTaskProvider.ts:67`: `new vscode.ShellExecution('dotnet', dotnetTaskArgs(...))` with plain string arguments. VS Code quotes a plain string argument only when it contains a space outside quotes (`_buildShellCommandLine`, function `u`, in `/usr/lib/code/out/vs/workbench/workbench.desktop.main.js` of the installed Code - OSS); everything else reaches bash, zsh, PowerShell or cmd unquoted. A space plus an apostrophe is not quoted either (the apostrophe opens a "quote" in that scan). All the solution's and every project's tasks are affected, also Ctrl+Shift+B, F5's build of Start New Instance (`debugConfigService.ts:357`), pack and publish.

Scenario: a repository under `C:\Users\me\source\repos\R&D\` or `~/src/R&D/`, a project folder `Shop(2)`, or `~/John's Projects/`: every build from the Solution Explorer fails with a shell error, or runs `dotnet build` on a truncated path in the background (`&`). Not a security boundary (the extension does not run in Restricted Mode, and a trusted workspace can run tasks anyway), but a plain failure.

Proof (`/tmp/rev5/quote.js` applies VS Code's quoting, copied from the bundle, with bash's quoting options to `dotnetTaskArgs('build', ...)`; a real `dotnet new console` project under `/tmp/rev5/R&D/App`):

```
command line: dotnet build /tmp/rev5/R&D/App/App.csproj --configuration Debug -nologo -consoleLoggerParameters:NoSummary -property:GenerateFullPaths=true
bash: line 1: D/App/App.csproj: No such file or directory
MSBUILD : error MSB1009: Project file does not exist.
Switch: /tmp/rev5/R
exit=127

command line: dotnet build /tmp/rev5/John's Projects/App/App.csproj --configuration Debug ...
bash: -c: line 1: unexpected EOF while looking for matching `''
```

Fix: `vscode.ProcessExecution('dotnet', args, { cwd })` (no shell at all; `$msCompile` and the task terminal work the same), or pass `{ value, quoting: vscode.ShellQuoting.Strong }` for each argument. The `StartupPreBuild` task in tasks.json already uses `"type": "process"`. Related, area 2/6: `solutionActionService.ts:965` builds `dotnet add "<project>" reference "<ref>"` for `terminal.sendText`, where `$`, `` ` `` and `"` in paths still expand in bash.

### A5-9 (risk, proven): a test app or vstest.console that dies at start costs 30 s per project, with a misleading message

`src/services/testing/testingPlatformClient.ts:73-81` and `vstestClient.ts:147-155`: `connectTestApp`/`connectVsTest` only end on a connection or after `timeoutMs` (30 s). The started process's exit is never observed (`TestApp` has no exit event; `startProcess`/`startVsTestConsole` in `testExplorer.ts:53-105` only collect output, also of the `error` event when `dotnet` is not on the PATH).

Scenario: a test project for `net8.0` on a machine with only the .NET 10 runtime ("You must install or update .NET to run this application"), a test app that crashes in a module initializer, or `dotnet` missing from the extension host's PATH (a GUI launch on macOS): discovery and every run wait 30 s per project, then say "The test app did not connect within 30 s" with the real reason below it. Runs go project by project (`testExplorer.ts:430-453`), so 10 such projects block a run for 5 minutes; discovery holds 4 queue slots (`dotnetQueue`) for 30 s each.

Proof (scratch jest test `src/review/area5exit.test.ts`: the real `connectTestApp` starting `dotnet <missing dll> --server ...` like `startProcess`):

```
D: app exited with 1 after 121 ms
D: connectTestApp rejected after 30001 ms: Error: The test app did not connect within 30 s.
```

Fix: give `TestApp` an `exited` promise (from the child's `exit`/`error` events) and reject the connect at once with the exit code and output.

### A5-10 (bug, proven): test projects that get their test packages from a `Directory.Build.props` never show in the Testing view

`src/services/testing/testProjects.ts:7-12` (`isTestProjectCandidate`) looks only at the project file's own text: a test package `PackageReference`, an MSTest/TUnit SDK, or `IsTestProject`/`EnableMSTestRunner`/`IsTestingPlatformApplication` written in it. `testExplorer.ts:273-279` drops every project that fails this text test before MSBuild is asked, so nothing else can bring it back (and no log line says why).

Scenario: the common layout `tests/Directory.Build.props` with `Microsoft.NET.Test.Sdk`, `xunit` and `xunit.runner.visualstudio` for every project below it, test projects that hold only `TargetFramework` (also: the references in a shared `.props` imported by hand, or single-quoted attributes). `dotnet test` runs them, the Testing view shows nothing, Run Tests on the project says "No tests found".

Proof (`/tmp/rev5/dbp`, packages in `tests/Directory.Build.props`, the project file has only `TargetFramework`):

```
$ dotnet test tests/Shop.Tests
Passed!  - Failed:     0, Passed:     1, Skipped:     0, Total:     1, Duration: 5 ms - Shop.Tests.dll (net10.0)
$ dotnet msbuild tests/Shop.Tests/Shop.Tests.csproj -getProperty:IsTestProject -getProperty:VSTestConsolePath
  "IsTestProject": "true", "VSTestConsolePath": "/usr/share/dotnet/sdk/10.0.111/vstest.console.dll"
F: isTestProjectCandidate=false        (scratch test src/review/area5cand.test.ts)
```

The solution model uses the same text test (`core/Project.ts:317`), so such a project also counts as a library (Pack is offered) and, as an xUnit v3 `Exe`, can become the default startup project (`startProfile.ts:105-118`).

Fix: ask MSBuild (`IsTestProject`, `IsTestingPlatformApplication`; the project evaluation the model already runs could return them) instead of, or in addition to, the text test.

### A5-11 (bug, proven by code): a failed Test Explorer build points to the Problems panel, which never gets its errors; Cancel does not stop the build

`src/services/testing/testExplorer.ts:122-128` builds with a plain `execFile` (no task, no problem matcher, no diagnostics collection), yet `:307` and `:436` say "Build failed, see the Problems panel". The Problems panel only has what the C# extension's live analysis finds in source files; MSBuild and NuGet errors (`NU1301` 401 from the Azure DevOps feed, `NU1101`, a missing SDK or workload, `MSB` errors) never appear there. On Refresh (`:306`) the build output goes to `log.debug` only, hidden at the default log level, so the user has no way to see why. In a run the output is at least in the Test Results output (`:435`).

The cancellation token is only checked between projects (`:431`, `:455`): Cancel during a build lets `dotnet build` run on (up to its 10-minute timeout), and when it ends the same iteration still discovers and starts the test app (which the already-cancelled token then closes). Each project of a run is also built on its own and in sequence (`:430-438`), so a solution with 15 test projects runs 15 `dotnet build`s (each re-checks the shared projects; several seconds even when up to date) before the last tests start, where Visual Studio builds once.

Scenario: expired feed token, Run All Tests: every test shows "Build failed, see the Problems panel", Problems is empty, the log at Info level says nothing.

Fix: build through `runTask(createDotnetTask(...))` (the `$msCompile` matcher fills Problems and the Error List, the user sees the terminal, and the task can be terminated on cancel), one build of the solution or of the selected projects; or at least put the output into the message and the log at Info, and kill the child on `token.onCancellationRequested`.

### A5-12 (risk, suspected, Windows): Attach to Process misses `dotnet run` apphosts under paths with non-ASCII characters

`src/services/attach/attachToProcess.ts:29-35`: `powershell.exe -Command "Get-CimInstance ... | ConvertTo-Json -Compress"` is read as UTF-8 (`execFile` default), but Windows PowerShell 5.1 writes redirected output in the console's OEM code page (437/850). `C:\Users\Jürg\source\Shop\bin\Debug\net10.0\Shop.Web.exe` then arrives as `C:\Users\J\uFFFDrg\...`: `projectOwning` and the `isFile(<stem>.dll)` checks in `dotnetProcesses.ts:195-198` fail and the apphost (what `dotnet run` starts on Windows, the main reason to attach) is not listed; `dotnet App.dll` processes still show, by name. Users with umlauts in their account name are common for the target team. Not run (no Windows here; the encoding behaviour is from memory of PowerShell 5.1). Fix: start the script with `[Console]::OutputEncoding = [Text.Encoding]::UTF8;`, and add a Windows CI test with a non-ASCII path.

## Checked and fine

- **Process lifetime on Linux (run):** cancelling a VSTest run (`session.close()` while an xUnit v2 test sleeps) ended `vstest.console` and its `testhost` within 3 s; a Microsoft.Testing.Platform (xUnit v3) app was killed 2 s after `exit` (it does not end on `exit` during a run). Scratch test `src/review/area5proc.test.ts`, real SDK 10.0.111, copy of `1-test-explorer` with an added 120 s test:
  ```
  C1 before close: vstest.console.dll --port:46467 ..., testhost.dll ... --parentprocessid 1209229
  C1 close took 2 ms; 3 s later: (none)        run promise: rejected: Error: vstest.console disconnected.
  C2 before close: Shop.Core.Tests.dll --server --client-host 127.0.0.1 --client-port 39059
  C2 close took 2003 ms; 3 s later: (none)     run promise: rejected: Error: The test app disconnected.
  ```
- **Extension host dying during an MTP run** (`/tmp/rev5/hostdeath.js`): the orphaned test app (reparented to pid 1) exited on its own within ~11 s. `vstest.console` gets `--parentprocessid` and its test host watches it.
- **Hot Reload terminal close** (`/tmp/rev5/hr/closeterm.py`: `dotnet watch run` with the arguments of `hotReloadArgs` in a pty, then SIGHUP and master closed, as node-pty does): `dotnet-watch`, its `dotnet run` and the app were all gone 5 s later. Arguments go as `shellArgs` (no shell), so launch profile names cannot inject.
- **Dev certificate:** `dotnet dev-certs https --check-trust-machine-readable` (exit 0, JSON array, also with a banner line before it in a fresh `HOME`) parses as expected; the first `dotnet` run in a fresh home creates a certificate, so the `none` state is rare. Trust runs a fixed command.
- **jsonc edits:** comments, other configurations and formatting are kept (existing tests plus E1-E3 above); a file with syntax errors is not rewritten (but see A5-6 for the order).
- **Attach parsing:** `ps -ww -eo pid=,ppid=,args=`, `ss -ltnpH` with fallback to `lsof`, `netstat` by foreign port 0 (locale independent); tooling and SDK commands are excluded; the extension host itself is skipped.
- **Startup profiles (`.slnLaunch`):** unreadable files are never written, formatting/BOM/newlines/key order kept, profile names checked case-insensitively, refreshes are queued (`refreshStartup`).
- **Command construction without a shell:** `execFile`/`spawn` everywhere in the area except the task provider (A5-8) and the dev-cert terminal (fixed text); `commandLineArgs` and environment from launchSettings.json reach the C# debugger through `launchSettingsProfile`, not a shell; for Mono they are split into an `args` array.
- **Existing tests of the area:** 27 suites, 254 tests pass (`src/test/unit/services/{testing,attach,devCert,hotReload,startupProfiles}`, `debugConfigService*`, `dotnetTaskProvider`, `monoDebug`, `core/jsonc`).
- The Mono runner download goes to the user's NuGet packages folder through `dotnet restore` (feeds over HTTPS, NuGet's signature checks); the problem is where the restore runs (A5-4) and where the copy lives (A5-3), not the download itself.

## Not reviewed / limits of this review

- **Nothing was run in VS Code** (by the rules): the debug paths (`startDebugging` with coreclr/mono, compounds with `stopAll`, attaching to a paused test host, `stopDebugging(session)` in `startInDebugger` when the session was not captured, which would stop *all* sessions), terminal behaviour, the task system and workspace trust are reviewed from code and, for A5-8, VS Code's own bundled quoting code.
- **Windows and macOS were not run:** process-tree killing on Windows (`child.kill()` is `TerminateProcess` of one process; the test hosts rely on their parent-process watch), ConPTY close for `dotnet watch`, PowerShell encoding (A5-12), `.cmd` shims (none used: everything starts `dotnet`, `mono`, `ps`, `powershell.exe` directly), drive-letter case in `itemsAt` (`testExplorer.ts:260`, `fsPath` from `Uri.file` has a lower-case drive letter) and `cwd` for a project on another drive than the workspace (`debugConfigService.ts:334` writes `${workspaceFolder}/D:\...`): suspected only, not listed as findings.
- `unloadedProjects.ts` temp filter (mentioned in A5-3) belongs to area 1 and was only read; `solutionActionService.ts:965` (`sendText` with paths) belongs to area 2/6.
- Mono debugging (`ensureMonoDebugging`, launch with the `mono` type) and .NET Framework test runs were not executed end to end; `runSettings.ts` regex handling was read, not fuzzed.
- `docs/troubleshooting.md` says "Test projects that target .NET Framework aren't run by the Test Explorer", while `docs/tests.md` describes running them under Mono: doc drift for area 9.
- Scratch files: `/tmp/rev5/repo/src/review/area5*.test.ts`, `/tmp/rev5/{mb,te,dbp,hr,R&D,tmpB,tmpC}`, `/tmp/rev5/quote.js`, `/tmp/rev5/hostdeath.js` (nothing was written into the repository except this report).

## Verification (second pass, 2026-10-24)

Adversarial re-check of every finding at HEAD `8a7b92b`, in an own copy of the repository (`/tmp/ver5/repo`, `node_modules` symlinked, scratch `TMPDIR=/tmp/ver5/tmp`), real `dotnet` 10.0.111 and mono 6.12. No VS Code or Electron was started; no source file was changed. Result: 10 of 12 confirmed, A5-8 only partially (its character list is too broad), A5-12 not verifiable here; no finding refuted. Downgrades: A5-5 to "low likelihood"; A5-7 keeps "risk" with a shorter window than claimed. New: the `.slnf` variant of A5-3 is reachable by modern .NET users and is the variant that matters most; A5-4 succeeds silently; a second variant of A5-5 (own entries added to our compound).

| Id | Verdict | Severity after verification | Note |
|---|---|---|---|
| A5-1 | CONFIRMED | bug | Real leak of live objects (whole old trees plus their `TestNode`s), about 1.3 KB per test per discovery in the mock, more with VS Code's heavier `TestItem`; discovery only happens when the test assembly changed |
| A5-2 | CONFIRMED | bug | Re-run: 6,000 warnings, `execFile` call of `defaultDeps.build` killed at 1 MiB, `resolve(false)`; the same build in a terminal exits 0 |
| A5-3 | CONFIRMED | risk (Linux multi-user machines only; .NET Framework tests under Mono only) | Planted runner run by real mono through the real `resolveMonoVsTestConsole()`; needs another local account; impossible on Windows (Mono path never used) and macOS (per-user `$TMPDIR`). The `.slnf` variant is stronger than "suspected" (reasoned, see below) |
| A5-4 | CONFIRMED | risk (same reach as A5-3) | A planted `Directory.Build.props` with an `Exec` ran as the user and the download still succeeded, so nothing is visible |
| A5-5 | CONFIRMED | bug, low likelihood | Reproduced with the real function; needs the user's own entry named exactly `Startup`, a name our docs reserve; the data loss (the configurations the compound lists) is what makes it a bug |
| A5-6 | CONFIRMED | bug | Reproduced with real `dotnet`: returns `true`, `tasks.json` builds B, launch.json still runs A; no guard in any caller |
| A5-7 | CONFIRMED | risk | Reproduced with real `dotnet` plus an injected delay; the window is short in practice (`TargetPath` evaluation took 0.3 to 0.5 s here), so it needs two requests within about a second |
| A5-8 | PARTIALLY CONFIRMED | bug | Holds only for paths that contain no space (or an apostrophe before the first space): VS Code strong-quotes any plain argument with a space, so `My R&D`, `Shop - Copy (2)` and `x $(...)` build fine in bash and pwsh; `R&D`, `a;b`, `Shop(2)`, `a$HOME` and any apostrophe break; in cmd only `&`/`%`-like characters without a space break |
| A5-9 | CONFIRMED | risk | Re-run: the app exits after 112 ms, `connectTestApp` rejects after 30,002 ms; `TestApp` has no exit signal, no guard |
| A5-10 | CONFIRMED | bug | Real projects (xUnit v2 VSTest and xUnit v3 MTP) with packages from `tests/Directory.Build.props`: MSBuild says `IsTestProject=true` / `IsTestingPlatformApplication=true`, the real `TestExplorer` shows nothing; with the same projects plus a faked `PackageReference` in the text both appear with their test |
| A5-11 | CONFIRMED (wording) | bug | By code: no diagnostics collection, no task, the token never reaches the build; but C# *compile* errors usually are in Problems through the C# extension's live analysis, so the message misleads mainly for MSBuild, NuGet and SDK errors |
| A5-12 | UNVERIFIED | risk (suspected) | No Windows here; no encoding guard in the code (`execFile` UTF-8 default, no `[Console]::OutputEncoding` in the script); the 5.1 OEM-code-page behaviour could not be checked against Microsoft's docs (Microsoft Learn connector unavailable) |

### V-A5-1: memory growth, measured

Scratch test `/tmp/ver5/repo/src/review/v5leak.test.ts`: the mock `vscode` of `testExplorer.test.ts`, a fake Microsoft.Testing.Platform app that discovers 3,000 synthetic tests (30 namespaces, 100 classes), `modified()` returning a new time on every call, run with `--expose-gc` and two `gc()` before each heap reading:

```
N=3000 nodes after 1 discovery=3000, after 51=153000, live items=3331, heap +182.1 MiB over 50 discoveries = 3729 KiB per discovery (1272 B per test)
```

It is a leak of live objects, not a map of small entries: `nodes` is keyed by the `TestItem` object itself, so every old leaf item stays alive with its `TestNode` (uid, display name, file, line, type, method), and through `item.parent` (the real extension host's `TestItemCollection.removeItem` clears only the item's `listener` and its tag counts, `/usr/lib/code/out/vs/workbench/api/node/extensionHostProcess.js`, Code - OSS 1.136.1; `parent` and `children` stay) every old namespace and class item stays alive too. The mock's items are plain objects; VS Code's `TestItemImpl` with its API object and children collection is larger, so 1.3 KB per test is a lower bound.

Realistic growth: discovery happens only when the test assembly's write time changed (`discoverIfChanged`), on Refresh (which always builds first, `refresh(true)`), and after runs with unmatched results. A day with 50 to 100 builds that change a test project of a 3,000-test solution: 180 to 370 MiB in the extension host until the window is reloaded; a 300-test solution: 18 to 37 MiB. `vstestCases` grows only by tests whose id changed (renamed/removed tests), a minor part. The reviewer's "100 builds" scenario holds for builds that change the assembly; up-to-date builds (assembly not rewritten) add nothing.

### V-A5-2: build output over 1 MiB

`/tmp/ver5/mb/Warn.csproj` (a library with 6,000 `#warning` lines), `run.js` making the `execFile` call of `defaultDeps.build` (same arguments, `cwd`, `timeout`, no `maxBuffer`):

```
$ dotnet build -nologo Warn.csproj -consoleLoggerParameters:NoSummary > first.txt; echo exit=$?; wc -c first.txt
exit=0
2071787 first.txt
$ touch Big.cs; node run.js
resolve(false) after 763 ms, stdout 1048576, error ERR_CHILD_PROCESS_STDIO_MAXBUFFER
$ dotnet build -nologo Warn.csproj > /dev/null; echo "terminal rebuild exit=$?"
terminal rebuild exit=0
```

No guard elsewhere: `maxBuffer` is not set anywhere in `testExplorer.ts`, and the result is only `!error`. Scenario and severity as written (a project with thousands of warnings is legacy territory, but the target team migrates such code).

### V-A5-3: the shared Mono runner folder

Reproduced with the real `resolveMonoVsTestConsole()` and its default dependencies (scratch `src/review/v5mono.test.ts`): `TMPDIR=/tmp/ver5/tmpB` (mode `1777` like `/tmp`), a folder `shinobi-dotnet-vstest-mono-18.0.1/` planted before the call with a `vstest.console.exe` compiled with `mcs` and a copy in `TestHostNetFramework/`; the returned path then started with real mono and the arguments `startVsTestConsole` passes:

```
resolved: /tmp/ver5/tmpB/shinobi-dotnet-vstest-mono-18.0.1/vstest.console.exe
PLANTED vstest.console.exe running as uid hempe args=--port:1234 --parentprocessid:1265958
```

What an attacker needs, precisely:

- **A second local account on the same Linux machine** (shell, cron job, CI job of another user, a compromised service account). `os.tmpdir()` is `$TMPDIR` or `/tmp`; on Linux `$TMPDIR` is normally unset (also here), so it is `/tmp`, shared by everyone (`drwxrwxrwt root /tmp` here). Not on Windows: `needsMono` is false on `win32`, the code never runs there (and `%TEMP%` is per-user anyway). Not on macOS: `$TMPDIR` is a per-user `0700` folder under `/var/folders`. Not in a single-user dev container or WSL distribution (no other account). Not remote.
- **No race.** The attacker creates the DIRECTORY `/tmp/shinobi-dotnet-vstest-mono-18.0.1` (owned by the attacker, e.g. mode `755`) at any time before the victim's first .NET Framework test run. The sticky bit on `/tmp` only stops users from deleting or renaming entries of others; creating a new name is open to everyone, and the victim cannot remove the attacker's directory afterwards. `copyLayout` checks only `existsSync(<target>/TestHostNetFramework/vstest.console.exe)`: no `lstat`, no owner, no mode, no content check, so an existing directory is reused as it is. `fs.protected_symlinks` does not help (it is a real directory, not a symlink), and the victim reaches the folder through a plain path.
- **What runs, as whom:** `mono <planted>/vstest.console.exe --port:N --parentprocessid:P` with the victim's uid, environment and home (`startVsTestConsole`), on every .NET Framework test discovery and run. If the planted folder lacks `TestHostNetFramework/vstest.console.exe`, the victim's `rmSync(target)` fails with `EACCES`/`EPERM` on the other user's files (sticky bit plus the attacker's `755`) and every .NET Framework run fails with "Could not prepare vstest.console.exe for Mono" (denial of service).

Reach: Linux, Mono installed, a .NET Framework VSTest project, and another account on the machine. The target team uses modern .NET only, so this is low in practice; "risk" stands.

The `.runsettings` variant (`testExplorer.ts:149`): the file name is a hash of the content, so it is predictable for known content (the transformed settings of a checked-in file). With `fs.protected_regular=1` (systemd's default, also here) a planted file owned by another user makes `writeFileSync` fail with `EACCES`, which ends as "Discovering tests failed" (denial of service); with `protected_regular=0` and a planted `0666` file the attacker can rewrite the settings after our write (run settings can name test adapter paths, i.e. code). Reasoned, not run.

The `.slnf` variant (`unloadedProjects.ts:70-98`) is stronger than the reviewer's "suspected": `/tmp/shinobi-dotnet/` is created with `mkdirSync({ recursive: true })`, which silently accepts an existing directory. If another user created it first (mode `777`), every `<sha1-12 of the solution path>/` below it is the attacker's to control: the attacker can delete our `.slnf` (owned by us, but in their directory) and put their own in place between our write and MSBuild's read (the build is started later, through a task terminal: hundreds of milliseconds, easy with inotify), or simply replace it after we wrote it once, since we rewrite only when the content differs and otherwise reuse the file. A solution filter names the solution file it filters (`"solution": { "path": ... }`), so the attacker's filter can point at the attacker's own `.sln` and project, whose targets then run as the user on every build while a project is unloaded. The id is a hash of the solution path, guessable (`/home/<user>/src/<Repo>/<Repo>.sln`), and not even needed when the attacker watches `/tmp/shinobi-dotnet/` for new folders. This reaches modern .NET users (Unload Project), so it is the variant that matters most for the target team; same reach otherwise (another local account on Linux). Reasoned from code and POSIX semantics, not run with a second account (no second account here and none may be created).

Minimal fix (not implemented): a per-user folder, e.g. ``path.join(os.tmpdir(), `shinobi-dotnet-${os.userInfo().uid}`)`` created with `mkdirSync(dir, { mode: 0o700 })`, then `lstatSync` it and refuse unless it is a directory (not a symlink), `uid === process.getuid()` and `(mode & 0o077) === 0`; everything (Mono copy, `.runsettings`, `.slnf`, the restore folder) goes below it. Simpler and without the checks: the extension's `context.globalStorageUri.fsPath` (under the user's own home, all parents owned by the user or root). On Windows and macOS `os.tmpdir()` is already per-user, so the check only needs to run where `process.getuid` exists.

### V-A5-4: the restore folder's parents

Reproduced with the real `resolveMonoVsTestConsole()` (scratch `src/review/v5dl.test.ts`): `TMPDIR=/tmp/ver5/tmpC` (mode `1777`) holding a `Directory.Build.props` with a target `BeforeTargets="Restore;_GenerateRestoreGraph;CollectPackageReferences"` that `Exec`s `id -un; pwd` into a marker file, and `NUGET_PACKAGES` pointing at an empty folder so the download runs:

```
resolved /tmp/ver5/tmpC/shinobi-dotnet-vstest-mono-18.0.1/vstest.console.exe
$ cat marker-download.txt
hempe
/tmp/ver5/tmpC/shinobi-vstest-1J1JJR
```

So the planted command ran as the user and the download still succeeded: unlike the reviewer's proof (a planted error), a real attack leaves no trace in the UI. `mkdtemp` gives a `0700` folder with a random name, but MSBuild imports the first `Directory.Build.props` found walking up from the project folder, which is `/tmp/Directory.Build.props` (and NuGet reads every `NuGet.Config` from the working folder up to the root, so `/tmp/NuGet.Config` can add a feed or a `globalPackagesFolder`). Needs: a second local account able to create a file in `/tmp`, nothing else (no race, no knowledge of the victim). Runs: whatever MSBuild/NuGet do for that project (arbitrary `Exec`, inline tasks), as the victim, once per first-time download (and again whenever the package is missing from the global packages folder). Same platform reach as A5-3 (Linux only in practice). Fix as proposed by the reviewer; the per-user folder of V-A5-3 alone is not enough for this one, because MSBuild keeps walking up past it into `/tmp`: either restore under `globalStorageUri` or pass `-p:ImportDirectoryBuildProps=false -p:ImportDirectoryBuildTargets=false` (and `--configfile` with the user-level `NuGet.Config`).

### V-A5-5: a user's own `Startup` compound

Scratch test `src/review/v5dbg.test.ts` (the mocks of `debugConfigService.test.ts`, real `dotnet` for `TargetPath`), the real `updateStartupConfiguration` on project A:

```
E1 before: configurations ["Frontend (node)","Backend (coreclr)","Attach (coreclr)"], compounds [{"name":"Startup","configurations":["Frontend","Backend"]}]
E1 returned true
E1 after:  configurations ["Startup (coreclr)","Attach (coreclr)"], compounds []
```

No guard: `readStartupCompound` only checks that launch.json parses and has a compound named `Startup`; `removeStartupProfileConfiguration` then removes it and every configuration it lists, of any type, with no check for `presentation.hidden`, `preLaunchTask: "StartupPreBuild"` or our `<profile>: <project>` naming. Unrelated entries (`Attach`) are kept.

How realistic: it needs a user entry named exactly `Startup` (case-sensitive). The docs reserve that name ("Set as Startup Project writes a `Startup` configuration to `.vscode/launch.json`", `docs/coming-from-visual-studio.md`, `docs/context-menus.md`, `docs/run-and-debug.md`), so a user's own *configuration* named `Startup` being overwritten is what the docs announce and not a bug. The bug is the compound case: a hand-written compound named `Startup` (a natural name for someone used to Visual Studio's "Startup Projects") costs the configurations it lists, not just the compound, silently. Uncommon, hence "low likelihood"; the consequence (lost hand-written configurations, recoverable only via git or Local History) keeps it a bug.

A second, more likely variant (same root cause, not in the review): a user who adds an own configuration to *our* compound (e.g. a `node` Frontend next to the profile's projects) loses that configuration on the next profile refresh (any configuration change, launch profile change), because `updateStartupProfileConfiguration` deletes every name the previous compound listed that the profile does not:

```
E1b before: configurations ["Web: A (coreclr)","Web: B (coreclr)","Frontend (node)"], compounds [{"name":"Startup","configurations":["Web: A","Web: B","Frontend"],...}]
E1b after profile refresh: configurations ["Web: A (coreclr)","Web: B (coreclr)"], compounds [{"name":"Startup","configurations":["Web: A","Web: B"],...}]
```

Editing a generated entry is at the user's own risk, but deleting a non-hidden configuration outright is harsher than needed. The reviewer's fix (only delete what is ours: `presentation.hidden` and our naming) covers both.

### V-A5-6: launch.json with a syntax error

Same scratch test, Startup set to A, then an entry without a trailing comma inserted into launch.json, then Set as Startup Project's call on B:

```
E3 returned true; StartupPreBuild args ["build","B/B.csproj"]; launch.json parse errors 1; Startup program ${workspaceFolder}/A/bin/Debug/net10.0/A.dll; warnings [".vscode/launch.json has syntax errors and was not updated. Fix them and select the startup project again."]
E3 getStartupProject: "/tmp/ver5/tmp/v5dbg-Hq6RNG/B/B.csproj"
```

`upsertJsoncArrayItem` returns `void`, so `updateStartupConfiguration` cannot know and returns `true`; `Solution.setStartupProject` (`Solution.ts:1463`) then calls `StartupChoice.useSingle` (the active profile is dropped). `removeStartupProfileConfiguration` is guarded (it does nothing when launch.json has errors), so nothing worse happens. Whether F5 then really runs the old `Startup` depends on VS Code reading a launch.json with a missing comma tolerantly (its JSONC parser recovers from it), not checked in VS Code; the inconsistent state of the files is proven.

### V-A5-7: concurrent startup writes

Scratch test `src/review/v5race.test.ts`: `child_process.execFile` wrapped so that the `-getProperty:TargetPath` evaluation of A waits 1.5 s and of B 0.1 s before the real `dotnet msbuild` runs; `updateStartupConfiguration(A)`, then 50 ms later `updateStartupConfiguration(B)`:

```
E2 asked A then B: StartupPreBuild A/A.csproj, Startup program ${workspaceFolder}/A/bin/Debug/net10.0/A.dll
```

No lock or queue around the callers listed by the reviewer (checked: `Solution.ts:1463`, `frameworkDropdownService.ts:96`, `solutionActionService.ts:358`, `debugConfigService.ts:59` and `:740`; only `startProfile.ts:167/173` run inside `refreshStartup`'s queue). How wide the window is: here a fresh project's evaluation took 541 ms, 455 ms, 324 ms (`dotnet msbuild -getProperty:TargetPath`, three runs after `dotnet build-server shutdown`); larger projects with `Directory.Build.props` and package imports take longer, but the reviewer's "3 s cold" was not reproduced. The race needs the first request to be the slower one and the second to come within that time (a quick correction of a misclick, or a configuration change whose `refreshStartup` overlaps a Set as Startup Project). Rare, but the outcome (bold project and F5 disagree) is confusing: "risk" is right.

### V-A5-8: VS Code's shell quoting, re-run in bash and PowerShell

`/tmp/ver5/quote.js` is the plain-string branch of `_buildShellCommandLine` (functions `u`, `p`, `m`) and the `_shellQuotes` table, copied from `/usr/lib/code/out/vs/workbench/workbench.desktop.main.js` of the installed Code - OSS 1.136.1: a plain string is wrapped in the shell's strong quote (`'` for bash/zsh/PowerShell, `"` for cmd) only if it contains a space outside a `'`/`"` pair; everything is joined with spaces; on Windows `& ` is prefixed for PowerShell only when the *command* was quoted (never for `dotnet`). `/tmp/ver5/q/run.js` builds real console projects under `/tmp/ver5/q/w/<name>/App/`, applies that quoting to the arguments of `dotnetTaskArgs('build', ...)`, and runs the line the way VS Code starts a task shell on Linux (`bash -c <line>`, `pwsh -Command <line>`; PowerShell 7.6.9 installed as a .NET tool into `/tmp/ver5/pwsh`, nothing installed system-wide):

| Folder name | bash | pwsh 7.6 |
|---|---|---|
| `R&D` | broken: `D/App/App.csproj: No such file or directory`, `MSB1009 ... /tmp/ver5/q/w/R`, exit 127 | broken: `'D/App/App.csproj' is not recognized`, exit 1 |
| `My R&D` | quoted `'.../My R&D/...'`, builds | quoted, builds |
| `a;b` | broken (`MSB1009 .../a`, then runs `b/App/App.csproj`) | broken, same |
| `Shop(2)` | broken: `syntax error near unexpected token '('` | broken: `MSB1008: Only one project can be specified. Switch: 2` |
| `Shop - Copy (2)` (Windows Explorer's copy name) | quoted, builds | quoted, builds |
| `x$(touch PWNED-space)` | quoted, builds, nothing run | quoted, builds |
| `x$(touch${IFS}PWNED-nospace)` | `touch` RUNS (file `PWNED-nospace` created), then MSB1009 | broken, nothing run |
| `John's Projects` | broken: `unexpected EOF while looking for matching` quote | broken: string missing terminator, exit 1 |
| `O'Brien` | broken, same | broken, same |
| `a$HOME` | broken: `MSB1009 .../a/home/hempe/App/App.csproj` | broken, same |

cmd (reasoned from the same code, no Windows here): its only quote character is `"`, so an apostrophe does not hide the space, and `C:\Users\John's Projects\Shop\Shop.csproj` is quoted as `"C:\Users\John's Projects\Shop\Shop.csproj"` and works; `C:\Users\me\source\repos\R&D\Shop\Shop.csproj` stays unquoted and `&` splits the command; `(`, `)`, `;`, `$`, `'` without a space are not special to cmd outside blocks, so they work; `%NAME%` in a path expands. Windows PowerShell 5.1 (the default Windows profile on many machines) also rejects a bare `&` inside a token ("The ampersand (&) character is not allowed"; from knowledge of 5.1, not run).

So the reviewer's sentence "paths with `&`, `;`, `(`, `$`, `|` or an apostrophe break the command" is too broad: the *absolute* path is one argument, and as soon as it has a space anywhere (`C:\Users\John Smith\...`, `~/My Projects/...`), it is strong-quoted and all of these characters are safe, except an apostrophe before the first space. What breaks: paths without any space that contain `&`, `;`, `(`/`)`, `$`, `|`, `<`, `>` or a backtick (bash, zsh, PowerShell; in cmd `&`, `|`, `<`, `>`, `^`, `%`), and any path with an apostrophe (bash, zsh, PowerShell). The reviewer's examples `~/src/R&D/`, `Shop(2)` and `~/John's Projects/` are exactly such paths and break as described; `C:\Users\me\source\repos\R&D\` breaks in PowerShell and cmd, `C:\Users\John Smith\source\R&D\` does not. "Not a security boundary" is right: a folder name with `$(...)` and no space runs a command in bash, but only in a trusted workspace, where building runs the repository's MSBuild code anyway. Still a bug (`R&D` and apostrophes in folder names are realistic); the reviewer's fix (`ProcessExecution`, or `ShellQuoting.Strong` per argument) holds, and `ProcessExecution` also avoids the PowerShell/cmd differences.

### V-A5-9: an app that dies at start

Scratch test `src/review/v5exit.test.ts`: the real `connectTestApp` with a `start` that spawns `dotnet /tmp/ver5/nothere/Missing.Tests.dll <server args>` as `startProcess` does, plus an `exit` listener for the measurement only:

```
app exited with 1 after 112 ms
connectTestApp rejected after 30002 ms: Error: The test app did not connect within 30 s.
```

`connectVsTest` has the same shape (`vstestClient.ts:147-155`). Runs go project by project (`testExplorer.ts:430-453`), and the 30 s is per project and per connect; scenario as written.

### V-A5-10: test packages from Directory.Build.props

`/tmp/ver5/dbp`: `Shop.slnx` with `tests/Shop.Tests` (xUnit v2: `Microsoft.NET.Test.Sdk`, `xunit`, `xunit.runner.visualstudio`) and `tests/Shop.V3Tests` (`xunit.v3`, `OutputType` Exe), both project files only `<Project Sdk="Microsoft.NET.Sdk">` (V3 plus `OutputType`), the packages and `TargetFramework` in `tests/Directory.Build.props`.

```
$ dotnet test Shop.slnx
Passed!  - Failed:     0, Passed:     1, Skipped:     0, Total:     1, Duration: 4 ms - Shop.Tests.dll (net10.0)
$ dotnet msbuild <project> -getProperty:IsTestProject -getProperty:IsTestingPlatformApplication -getProperty:VSTestConsolePath -getProperty:OutputType
Shop.Tests:   "IsTestProject": "true", "IsTestingPlatformApplication": "",     "VSTestConsolePath": ".../sdk/10.0.111/vstest.console.dll", "OutputType": "Exe"
Shop.V3Tests: "IsTestProject": "",     "IsTestingPlatformApplication": "true", "VSTestConsolePath": ".../sdk/10.0.111/vstest.console.dll", "OutputType": "Exe"
```

Scratch test `src/review/v5cand.test.ts`, the real `TestExplorer` with its default dependencies (real `evaluateTestProject`, real `dotnet build`, real test apps / vstest.console), only `projects()` given, then the same with `readProject` adding a `PackageReference Include="xunit"` to the text:

```
F: Shop.Tests.csproj: isTestProjectCandidate=false; evaluateTestProject: testingPlatform=false vstestConsolePath=/usr/share/dotnet/sdk/10.0.111/vstest.console.dll
F: Shop.V3Tests.csproj: isTestProjectCandidate=false; evaluateTestProject: testingPlatform=true vstestConsolePath=/usr/share/dotnet/sdk/10.0.111/vstest.console.dll
F: Testing view with the real deps: []
F: same, project text faking a PackageReference: ["Shop.V3Tests","  T","    Ok","Shop.Tests","  T","    Ok"]
```

So the Testing view finds nothing, while MSBuild (which `evaluateTestProject` already asks) knows both are test projects and everything after the text filter works. Note: `IsTestProject` is set by `Microsoft.NET.Test.Sdk` only; an xUnit v3 project without it has `IsTestProject` empty but `IsTestingPlatformApplication=true`, so the fix must ask for both, as the reviewer says.

### V-A5-11: build failures and Cancel in the Test Explorer

Confirmed by code: no `createDiagnosticCollection` anywhere in `src/services/testing/`, the build is a bare `execFile` (`:122-128`), the refresh build output goes to `log.debug` (`:306`, hidden at the default Info level of the log channel), and the cancellation token is never passed to `deps.build` nor tied to the child (`:431`, `:435`, `:455`). One correction of wording: "the Problems panel, which never gets their errors" is true for the build's own output, but C# compile errors (the most common build failure) usually are in Problems anyway through the C# extension's live analysis of open/loaded files. The message misleads for MSBuild, NuGet (`NU1301` from an expired Azure DevOps token), SDK and workload errors, and for errors in projects the language server did not load. Severity unchanged.

### V-A5-12: PowerShell output encoding (Windows)

Not verifiable here (no Windows; PowerShell 7 on Linux writes UTF-8 and says nothing about Windows PowerShell 5.1). What holds: `attachToProcess.ts:29-32` reads `powershell.exe` output with `execFile`'s default UTF-8 decoding and the script does not set `[Console]::OutputEncoding`, and `ConvertTo-Json` in 5.1 does not escape non-ASCII characters, so if 5.1 writes the redirected output in the OEM code page (the reviewer's premise, consistent with how .NET Framework's `Console.Out` picks the console's output code page), an `ü` arrives as U+FFFD and the path checks fail. Keep as "suspected"; the reviewer's one-line fix is harmless either way. To be checked on Windows (a manual-testing entry).

### Scratch files and side effects of this pass

`/tmp/ver5/repo/src/review/v5{leak,mono,dl,dbg,race,exit,cand}.test.ts`, `/tmp/ver5/quote.js`, `/tmp/ver5/q/run.js`, projects under `/tmp/ver5/{mb,dbp,q/w,tm,tmpB,tmpC}`, PowerShell 7.6.9 as a .NET tool in `/tmp/ver5/pwsh`. Nothing was written into the repository except this section; the timing in V-A5-7 ran `dotnet build-server shutdown` once, which stops the user's idle MSBuild/Razor/VBCSCompiler servers (they restart on the next build).
