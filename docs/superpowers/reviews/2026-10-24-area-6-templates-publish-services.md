# Code Review, Area 6: Templates, Publish, Service References, Code Cleanup, Namespaces, gRPC and the Remaining Services (2026-10-24)

Scope: `services/templates/`, `services/publish/` (with `webview/providers/PublishPanel.ts`), `services/serviceReferences/`, `services/grpc/`, `services/codeCleanup/`, `services/namespaceSync/`, `services/namespaceAfterMove.ts`, `services/pack.ts`, `services/userSecrets.ts`, and the remaining `services/*.ts` not covered by areas 1-5 (list at the end).

Method: the code read in full for the folders above and the files listed under "Checked and fine"; findings reproduced with real `dotnet` (SDK 8.0.130 and 10.0.111), `dotnet-svcutil` 8.0.0 (installed into a scratch tool manifest under `/tmp/rev6/svc`), `dotnet format`, and the Roslyn language server of `muhammad-sammy.csharp` 2.160.9 driven over stdio by a scratch LSP client; the extension's own functions were driven from scratch jest tests in a copy of the repository (`/tmp/rev6/repo`, `node_modules` symlinked). No source file was changed. Roadmap items and the gRPC review fixes (877cf2b) were not reported again; A5-8 (shell quoting of build/publish tasks) is not repeated.

## Summary

| Id | Severity | Proven? | One line |
|---|---|---|---|
| A6-1 | bug | proven | Create a New Project leaves the solution folder with its `.slnx` when the project step fails; the retry is refused ("exists and is not empty") |
| A6-2 | bug | proven | A WSDL file that imports `.xsd` files cannot be added: only the WSDL is copied to the temp folder (and later to the reference folder) |
| A6-3 | risk | by reading | Add/Update Service Reference writes the project file back from a snapshot taken before svcutil (up to 5 min): concurrent edits are lost |
| A6-4 | bug | proven | Publish profile Rename allows `;` and `,`: `-property:PublishProfile=a;b` fails with MSB1006 |
| A6-5 | bug | proven | Manage User Secrets adds a new UserSecretsId when MSBuild evaluation fails, shadowing the id set in `Directory.Build.props` |
| A6-6 | risk | proven | A UserSecretsId with `../` creates and opens `secrets.json` outside the user secrets folder (ASP.NET refuses such ids) |
| A6-7 | bug | proven in parts | Template list and options come from the SDK of the extension host's cwd; `dotnet new` runs with the SDK the solution's `global.json` picks |
| A6-8 | bug | proven | Code Cleanup's style step crashes `dotnet format` when IDE0130 is on (the `.editorconfig` lines Sync Namespaces recommends) and a namespace mismatches |
| A6-9 | bug | proven (server probe) | Update namespace after a move: Roslyn refuses the dotted rename, the fallback edits only the declaration; references are not updated |

## Findings

### A6-1 (bug, proven): "Create a New Project" leaves a half-made solution folder when the project step fails, and the retry is refused

`src/services/templates/templateService.ts:243-263` (`createSolutionWithProject`): the solution folder is created (`:243`) and `dotnet new sln` writes `<name>.slnx` into it (`:246`) before the project template runs (`:259`). When the project step fails (a template option value the template refuses, a template that fails, `dotnet new` killed by the 300 s timeout of `:35`), the function returns the error and leaves the folder with the `.slnx` in it. The wizard stays open with the error; the user fixes the option and presses Create again, and the check of `:240` now refuses: "`<location>/Shop` exists and is not empty". The user has to find and delete the folder by hand (or choose another name). The same happens when `dotnet sln add` fails (`:264-266`: solution and project are on disk, nothing is opened).

`createProject` (`:200-212`) has the same pattern on a smaller scale: a template that fails after writing files leaves `projectDir` non-empty, and the retry is refused by `:201`.

Scenario: Create a New Project > Console App, Framework set to a value the installed SDK lacks (an older `templatecache.json` entry, a template package for another SDK band), or any template whose post-processing fails.

Proof (scratch jest test in a copy of the repo, real `dotnet` 10.0.111, the real `createSolutionWithProject`; first call with `framework: 'net99.0'`, second with the defaults):

```
first: "Creating Shop.Cli failed:" left on disk: Shop.slnx
retry with valid values: {"error":"/tmp/rev6-newsln-k3zfvK/Shop exists and is not empty."}
```

Fix: remember whether `solutionDir` (and `projectDir`) existed before; on any failure after creating them, delete what this call created (only when it did not exist before), or let the retry accept a folder that holds only the solution file this wizard wrote.

### A6-2 (bug, proven): a WSDL file that imports its schemas (`.xsd`) cannot be added from a file

`src/services/serviceReferences/serviceReferenceGenerator.ts:120-131`: a local input is copied alone into `obj/shinobi-svcutil-<random>/` and svcutil runs on the copy. The WSDL's relative imports (`<xsd:import schemaLocation="Types.xsd">`, `<wsdl:import location="...">`), which svcutil resolves relative to the WSDL, now point into the temporary folder, where the files are missing. WSDLs exported by WCF services (`?wsdl` saved together with `?xsd=xsd0`, `singleWsdl` not used), by Java stacks (JAX-WS, CXF) and from vendor SDKs are usually split like that. svcutil on the original file works. Even if the generation worked, `:144-149` copies only the WSDL into the reference folder, so Update Service Reference (which reads the copy in the reference folder) would fail later for the same reason.

Proof (svcutil 8.0.0 installed in a scratch tool manifest, `/tmp/rev6/svc/wsdl/Calc.wsdl` importing `CalcTypes.xsd` next to it):

```
$ cd /tmp/rev6/svc/wsdl && DOTNET_ROLL_FORWARD=Major dotnet tool run dotnet-svcutil -- Calc.wsdl -d ../direct -n "*,Calc" -tf net10.0
Attempting to load metadata from '/tmp/rev6/svc/wsdl/Calc.wsdl'.
Generating files...
/tmp/rev6/svc/direct/Reference.cs
```

The same file through the real `generateServiceReference` (scratch jest test, `newServiceReference(..., '/tmp/rev6/svc/wsdl/Calc.wsdl', ...)`, the real `findSvcutil`/`runSvcutil`):

```
install: local
success: false
Warning: Cannot import wsdl:portType
Error: Schema with target namespace 'http://calc.example' could not be found.
folder: none
```

Fix: pass the original absolute path to svcutil instead of a copy (the params file accepts absolute inputs), or copy the WSDL's whole folder (or the files it imports, followed transitively) into the temporary folder and into the reference folder. A test with a split WSDL belongs to `serviceReferenceGenerator.svcutil.test.ts`.

### A6-3 (risk, proven by reading): edits to the project file during an Add/Update Service Reference are lost

`src/services/serviceReferences/serviceReferenceGenerator.ts:115`, `:135`, `:162`: the project file is read once before svcutil runs (up to 5 minutes, `svcutil.ts:19`, a slow or remote WSDL), then written back from that snapshot twice: unconditionally after svcutil (`:135`, to undo svcutil's own package edits) and with the `WCFMetadata` item (`:162`). Anything written to the project file meanwhile is overwritten without a word: an edit the user saves in the editor, a NuGet install from the NuGet manager, another extension's edit. VS Code then reloads the editor with the old content.

Fix: undo only what svcutil changed: compare the file after svcutil with the snapshot and restore it only if the difference is svcutil's (or re-read the current file, remove the `PackageReference`s svcutil added, and add `WCFMetadata` to the current content).

### A6-4 (bug, proven): a publish profile renamed to a name with `;` or `,` can no longer be published

`src/webview/providers/PublishPanel.ts:149-151` (Rename's `validateInput`) refuses only `\ / : * ? " < > |`. The name goes into `-property:PublishProfile=<name>` (`src/services/dotnetTaskProvider.ts:45`), where MSBuild splits on `;` and `,` (property separators). Publish then fails with MSB1006 in the terminal and the Publish page shows "failed". This is independent of the shell quoting of A5-8 (the arguments below are quoted).

Proof (scratch project `/tmp/rev6/pub`, profile files `Test;1.pubxml`, `A,B.pubxml`, `My Profile.pubxml`):

```
$ dotnet publish Pub.csproj '-property:PublishProfile=Test;1' -nologo
MSBUILD : error MSB1006: Property is not valid.
Switch: 1
$ dotnet publish Pub.csproj '-property:PublishProfile=A,B' -nologo
MSBUILD : error MSB1006: Property is not valid.
Switch: B
$ dotnet publish Pub.csproj '-property:PublishProfile=My Profile' -nologo
  Pub -> /tmp/rev6/pub/out/
```

Fix: refuse `;`, `,`, `%`, `$`, `@` and `'` in the rename (and when listing profiles, flag existing files with such names), or escape the value for MSBuild (`%3B`, `%2C`) in `dotnetTaskArgs`.

### A6-5 (bug, proven): Manage User Secrets writes a new UserSecretsId into the project when MSBuild cannot evaluate it, splitting the team's shared id

`src/services/userSecrets.ts:40-44`: when the project file has no `<UserSecretsId>` itself, the id is evaluated with `dotnet msbuild -getProperty` (`:22-31`); any failure there (SDK of `global.json` not installed, the project file or a props file mid-edit and invalid, the 60 s timeout on a cold first evaluation, `dotnet` not on the PATH of the extension host) is logged as a warning and treated as "no id": a fresh GUID is written into the project file and an empty `secrets.json` opened. The id the repository sets in `Directory.Build.props` (a common way to share one secrets store between the projects of a solution) is shadowed for this project from now on, silently, and the change ends up in a commit.

Proof (scratch jest test, the real `manageUserSecrets`; `/tmp/rev6/us/Directory.Build.props` sets `<UserSecretsId>shared-team-id</UserSecretsId>`, `global.json` pins SDK 9.0.999 which is not installed):

```
[WRN] UserSecrets: Could not evaluate the UserSecretsId of /tmp/rev6/us/Web/Web.csproj: ... A compatible .NET SDK was not found.
Web.csproj afterwards:
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <UserSecretsId>e0089a45-3a81-4020-bc63-cbd56d65765a</UserSecretsId>
  </PropertyGroup>
opened: /tmp/rev6/us/home/.microsoft/usersecrets/e0089a45-3a81-4020-bc63-cbd56d65765a/secrets.json
```

Fix: tell "evaluated, no id" (exit 0, empty output) from "evaluation failed" (error): only the first adds an id; on a failure show the error and change nothing.

### A6-6 (risk, proven): a UserSecretsId with path segments opens and creates `secrets.json` outside the user secrets folder

`src/services/userSecrets.ts:15-19` joins the id into the path without checking it. ASP.NET Core's own lookup (`PathHelper.GetSecretsPathFromSecretsId`) refuses an id with invalid file name characters (`/`, `\`), so such an id never works at run time; here, a project from a cloned repository with `<UserSecretsId>../../../../tmp/x</UserSecretsId>` makes Manage User Secrets create the folders and a `secrets.json` (`{}`) at that place and open it; the user then types secrets into a file in a place they did not choose. No existing file is overwritten (`:47`), so the harm is limited.

Proof (same scratch test): `userSecretsPath('../../../tmp/rev6/us/evil', 'linux', { HOME: '/home/u' })` returns `/home/tmp/rev6/us/evil/secrets.json`.

Fix: refuse ids containing path separators, `..` or other invalid file name characters, with ASP.NET's message.

### A6-7 (bug, proven in parts): the wizards show the templates and options of the newest SDK, while `dotnet new` runs with the SDK the solution's `global.json` selects

`src/services/templates/templateCache.ts:90-104`: `run(['--version'])` and `run(['new', 'list'])` have no `cwd`, so they run in the extension host's working directory, where no `global.json` applies: the newest SDK answers and its `templatecache.json` is read. `createProject` and `createSolutionWithProject` then run `dotnet new` in the solution directory (`templateService.ts:209`, `:259`), where `global.json` picks another SDK with other template versions and options. Options shown by the wizard that the pinned SDK's template lacks make `dotnet new` fail with "Invalid option(s)"; templates that the pinned SDK does not have fail with "No templates found". The cache is also read once per session for all solutions (`templates ??=`), so opening another solution with another `global.json` does not change it.

Scenario: a team pins SDK 8 (`global.json` with `8.0.x`), SDK 10 is also installed. Add New Project > MSTest Test Project shows SDK 10's options (Test runner, Coverage tool, Extensions profile, Fixture); choosing "Test runner: MSTest" fails.

Proof (this machine has SDK 8.0.130 and 10.0.111; `/tmp/rev6/g8/global.json` pins 8.0.130):

```
$ (cd / && dotnet --version)          # what readTemplates sees
10.0.111
$ cd /tmp/rev6/g8 && dotnet --version  # what dotnet new in the solution folder uses
8.0.130
$ dotnet new mstest -n T -o T --test-runner MSTest   # an option of SDK 10's mstest template (TestRunner in the 10.0.111 cache)
Error: Invalid option(s):
--test-runner
   '--test-runner' is not a valid option
exit 127
```

Not run end to end in VS Code (the extension host's cwd was not checked; it is not the solution folder in any case).

Fix: run both commands with `cwd` = the solution directory (for a new solution: the chosen location), and key the cached promise by the SDK version.

### A6-8 (bug, proven): Code Cleanup fails on every project with the `.editorconfig` lines that Sync Namespaces asks for, as soon as one namespace does not match its folder

`src/services/codeCleanup/cleanupSteps.ts:73` (step "Applying code style fixes": `dotnet format style <project> --severity warn`). With `dotnet_diagnostic.IDE0130.severity = warning` and `dotnet_style_namespace_match_folder = true`, which the Sync Namespaces summary tells users to add (`namespaceSync.ts:101-104`, `docs/sync-namespaces.md:24`), `dotnet format style` tries IDE0130's fix (it changes document properties) and crashes in MSBuildWorkspace. Code Cleanup then stops with "Code Cleanup failed at "Applying code style fixes": Unhandled exception: System.NotSupportedException: Changing document properties is not supported" after the first two steps already rewrote files, and keeps failing until every namespace matches. `--severity info` (setting `shinobi.codeCleanup.severity`) fails the same way (checked); Code Cleanup of one file or folder (`--include`, run in the project folder) fails when a mismatching file is in the included set (`--include Sub/S.cs`: exit 1) and works when not (`--include L.cs`: exit 0).

Proof (scratch solution `/tmp/rev6/refs`, SDK 10.0.111, `Lib/Sub/S.cs` with `namespace Wrong;`, `.editorconfig` with the two lines):

```
$ dotnet format style Lib/Lib.csproj --severity warn -v q
Unhandled exception: System.NotSupportedException: Changing document properties is not supported
   at Microsoft.CodeAnalysis.Workspace.CheckAllowedProjectChanges(ProjectChanges projectChanges) ...
   at Microsoft.CodeAnalysis.Tools.CodeFormatter.FormatWorkspaceAsync(...) in .../dotnet-format/CodeFormatter.cs:line 95
exit 1
$ dotnet format style Lib/Lib.csproj --severity warn --exclude-diagnostics IDE0130 -v q
exit with --exclude-diagnostics IDE0130: 0
```

Fix: add `--exclude-diagnostics IDE0130` to the style step (namespaces are Sync Namespaces' job, which goes through the language server and updates the references, which `dotnet format` would not), with a test; mention it in the Code Cleanup docs.

### A6-9 (bug, proven against the real Roslyn server): "Update namespace" after Cut/Paste or a folder rename changes only the declaration; the files that use the type are not updated and stop compiling

`src/services/namespaceService.ts:257-301` (`_tryOmnisharpRename`, used by `namespaceAfterMove.ts` for Update All / Review Each / the single-file question): it asks the rename provider at the namespace declaration (`parseNamespaceFromContent`, `:63`: the first character after `namespace `, i.e. inside the first segment) to rename to the whole new namespace, e.g. `Shop.Api.Services`. Roslyn does not rename a namespace to a dotted name: it answers `null`. So every update falls through to `_manualNamespaceUpdate` (`:306-349`), a text replacement in the moved file only. The files that use the moved type keep `using Shop.Services;` and no longer compile (CS0246) when the type was the only one there or as soon as they need it; nothing says so, the summary reports "updated". `docs/manual-testing.md:37` expects "the language server's rename, references in other files follow" (not ticked). Each file also gets opened as a non-preview editor tab (`:263`), so Update All on a folder of 40 files leaves 40 tabs open, and the edits of a successful rename would stay unsaved.

Proof (LSP probe `/tmp/rev6/lsp.js` over stdio against the server of `muhammad-sammy.csharp` 2.160.9, scratch project `/tmp/rev6/ns/Shop` with `Api/Services/Moved.cs` declaring `namespace Shop.Services;` and `User.cs` using `Moved` through `using Shop.Services;`; the class rename shows the server and project are loaded):

```
loaded after 1474
rename at 2:14 -> {"documentChanges":[{..."uri":"file:///tmp/rev6/ns/Shop/Api/Services/Moved.cs"},"edits":[...]},{..."uri":"file:///tmp/rev6/ns/Shop/User.cs"},...]}   (class Moved -> Moved2)
rename at 0:10 -> null      (namespace, position namespaceService uses, newName "Shop.Api.Services")
rename at 0:15 -> null      (namespace, last segment, same newName)
```

Had the server accepted a rename there, it would have been worse: a namespace rename renames the namespace symbol in every file that declares it (`Services/Stays.cs` too), which is not what a move means.

Fix: use the same code action as Sync Namespaces ("Change namespace to '...'", which edits the declaration and the references, see `runSyncNamespaces.ts`; it needs IDE0130 reporting, otherwise say so) and save the touched documents; keep the text replacement only as an explicit fallback that tells the user the references were not updated.

## Checked and fine

- Command construction in the area uses `execFile` with argument arrays everywhere (templates, svcutil, `dotnet format`, `dotnet msbuild -getProperty`, `dotnet sln migrate`): no shell, so project, file and template parameter values cannot inject commands. The only shell route is the publish/pack task (A5-8, plus A6-4 for MSBuild's own separators).
- `dotnet new` refuses an item name with path segments (`-n ../../Escaped` exits 127, nothing written), and refuses to overwrite existing files without `--force`; built-in items check the type name and an existing file (`templateService.ts:293-298`).
- `dotnet new` whose restore post-action fails (unreachable feed) exits 0 with the project written: Add New Project then adds it to the solution, which is the right outcome.
- Cancel of Code Cleanup: `child.kill()` on the `dotnet` muxer also ends its `dotnet exec dotnet-format.dll` child and the MSBuild BuildHost (checked with `ps` before and right after the kill on a 12,000-file project); no files were written after the cancel. Cleanup's report folder is an `mkdtemp` under the temp dir (random name, mode 0700), removed in `finally`.
- svcutil killed (as the 300 s timeout does) while waiting on a URL that never answers: no svcutil process is left. Its temp folder is under the project's `obj/` with a random name and removed in `finally`; failures leave the reference folder untouched (generated into the temp folder first).
- `dotnet format whitespace <project>` formats only the project given, not its referenced projects (checked with a console app referencing a library).
- gRPC `download.ts` (redirect limits, https to http refused, size limit, deadline, cancellation, redaction) and `protoFileName` (decoded `../` becomes `_`): read again, no regression of 877cf2b found; not re-run.
- `publishProfiles.ts`: property edits keep the rest of the file, CRLF and indentation; `.pubxml.user` (where Visual Studio keeps publish passwords) is only renamed and deleted with its profile, never read or logged.
- `slnxMigration.ts`, `typeRename.ts`, `pack.ts`, `existingItems.ts`, `workspaceFolders.ts`, `settings.ts`, `projectFramework.ts`, `showAllFiles.ts`: read, nothing to report.
- Code Cleanup of a file that a project links from outside its folder: `projectForPath` finds no project and says so; `dotnet format --include ../Shared/X.cs` would not format it either (checked), so nothing is lost there.

## Not reviewed / limits of this review

- `src/services/*.ts` of this area not read (or only skimmed): `analyzerNodes.ts`, `analyzers.ts`, `csharpExtensionCheck.ts`, `diagnosticsFilter.ts`, `diagnosticsRollup.ts`, `diagnosticsService.ts`, `errorList.ts`, `fileNesting.ts`, `iconThemeService.ts`, `singleFlight.ts`, `solutionDiscovery.ts`, `solutionDropNodes.ts`, `projectReferences.ts` (its known bug is on the roadmap); `namespaceService.ts` only the rename/update path and `getProjectRootNamespace` (which reads `RootNamespace` by regex, ignoring `Directory.Build.props`: not followed up). Covered by areas 1-5: `activeBuild`, `buildConfiguration`, `debounceManager`, `debugConfigService`, `dotnetTaskProvider`, `frameworkDropdownService`, `launchSettings`, `monoDebug`, `nodeIdService`, `ownWrites`, `runTask`, `solutionActionService`, `solutionExpansionService`, `solutionService`, `solutionTreeService`, `unloadedProjects`, `versionUtils`.
- Nothing was run inside VS Code (no Electron started): the wizard and Publish page flows, progress notifications, the extension host's real working directory (A6-7) and VS Code's handling of a `null` rename result (A6-9: either way the fallback runs) are inferred from the code.
- Service references from a URL (http vs https, credentials in the URL stored in `ConnectedService.json` and passed to svcutil) were not exercised; svcutil's own download has no size limit or cancel button here (the Add progress is not cancellable, so a slow WSDL URL blocks up to the 5 minute timeout): noted, not proven.
- Windows: not run; paths in this area use `path` consistently, `userSecretsPath` handles `%APPDATA%`, but `.cmd` shims and drive-letter case were not tested.
- Sync Namespaces (`runSyncNamespaces.ts`) was read but not run against the server; on a project it walks the whole project folder, so C# files of a project nested in that folder are offered too (not verified with the server).
- `templateCache.ts` with template packages installed by the user (`dotnet new install`) during the session: the cache is read once per session, by design.

## Verification (second pass, 2026-10-24)

Method: adversarial second pass at HEAD 0d067e4. Each finding's cited code reread; proofs re-run in a separate scratch copy (`/tmp/ver6/repo`, `node_modules` symlinked, own `TMPDIR`), real `dotnet` 8.0.130 / 10.0.111. No source file changed, VS Code/Electron not started.

| Id | Verdict | Severity after verification | Note |
|---|---|---|---|
| A6-1 | CONFIRMED | bug | Re-proved with a realistic trigger (SDK 10 option under a `global.json` pinning SDK 8, see A6-7); same on SDK 8 (`.sln`) |
| A6-2 | CONFIRMED | bug | Same-folder xsd, `../schemas` xsd and `wsdl:import` all fail through the generator, all work with svcutil directly and with an absolute input path; line numbers in the report are off (real `:40-51`, `:64-69`); URL references unaffected |
| A6-3 | CONFIRMED | risk | Now proven with an svcutil stub that edits the project meanwhile: the edit is lost; real lines `:35`, `:55`, `:82` |
| A6-4 | CONFIRMED | bug (minor) | Only Rename or a repository `.pubxml` with `;`/`,` triggers it; `%3B` escaping works |
| A6-5 | CONFIRMED | bug | Two real MSBuild failures (missing SDK, half-edited `Directory.Build.props`) each write a new id that permanently shadows the shared one |
| A6-6 | CONFIRMED | risk (low) | File created and opened outside `~/.microsoft/usersecrets`; needs a crafted project file |
| A6-7 | CONFIRMED | bug | `readTemplates` result depends only on the process cwd (87 vs 61 templates, different mstest options); the real extension host cwd not checked |
| A6-8 | CONFIRMED | bug | Exact trigger: IDE0130 severity >= Code Cleanup severity and one mismatching file in the set; SDK 8 and 10 alike; `--exclude-diagnostics IDE0130` fixes both; real line `cleanupSteps.ts:51` |
| A6-9 | CONFIRMED | bug | Real code path against the real server: rename returns null, fallback edits only the declaration, build fails CS0246; the "Change namespace" code action needs no IDE0130; manual-testing entry 37 expected to fail |

### A6-1: CONFIRMED (bug)

Code at HEAD as cited (`templateService.ts:239-266`): no cleanup on any of the three failure returns after `mkdirSync`. Re-proved with a different, realistic trigger that ties it to A6-7: a scratch folder with `global.json` pinning 8.0.130 (`rollForward: disable`), the real `createSolutionWithProject` with an `mstest` template carrying SDK 10's `test-runner` option:

```
first: "Creating Shop.Tests failed:\nError: Invalid option(s):\n--test-runner\n   '--test-runner' is not a valid option ..." left: ["Shop.sln"]
retry: {"error":"/tmp/ver6/tmp/a61-FygYnI/Shop exists and is not empty."}
retry same dir: {"solutionPath":".../Shop.Tests/Shop.Tests.sln"}
```

So the trap holds on SDK 8 as well (there `--format slnx` fails and the fallback writes `Shop.sln`). The only way out inside the wizard is a different name or ticking "Place solution and project in the same directory" (another folder); otherwise delete the folder by hand. Severity stays bug (annoying, no data loss: the folder only holds what the wizard wrote). Affected: anyone creating a new solution whose project step fails; with A6-7 this is any team pinning SDK 8 by `global.json` above the chosen location while SDK 10 is installed.

### A6-2: CONFIRMED (bug); line numbers in the report are wrong

The file has 112 lines; the cited `:120-131`, `:144-149` are really `serviceReferenceGenerator.ts:40-51` (copy of each local input alone into `obj/shinobi-svcutil-<hex>/`), `:64-69` (copy of the input alone into the reference folder) and `:75` (inputs rewritten to the bare file name). Behaviour as described.

Own fixtures in `/tmp/ver6/svc` (svcutil 8.0.0 from a scratch tool manifest): (a) `a/Calc.wsdl` with `<s:import schemaLocation="CalcTypes.xsd">` next to it, (b) `b/wsdl/Calc.wsdl` with `schemaLocation="../schemas/CalcTypes.xsd"`, (c) `c/Service.wsdl` that only has `<wsdl:import location="Calc.wsdl">` (WCF's split `?wsdl` shape). svcutil run directly on each: all three generate `Reference.cs`. The same files through the real `generateServiceReference` + `findSvcutil`/`runSvcutil`:

```
[same-folder xsd] success: false | Warning: Cannot import wsdl:portType / Error: Schema with target namespace 'http://calc.example' could not be found.
[../schemas xsd]  success: false | (same)
[wsdl:import]     success: false | Error: No code was generated.
folder: none (all three)
```

The proposed minimal fix was tried: a params file in a temp folder under `obj/` whose `inputs` holds the absolute original path (nothing copied), `--update <tempdir>`: all three cases exit 0 with `Reference.cs`. So the comment at `:40` ("svcutil resolves them relative to it") is true only for relative inputs; absolute inputs work.

What the tool itself (the engine behind Visual Studio's "WCF Web Service Reference" provider) records: `dotnet-svcutil ../b/wsdl/Calc.wsdl -d "Connected Services/Direct"` copies nothing into the reference folder and writes `"inputs": ["../../../b/wsdl/Calc.wsdl"]`, a path relative to the reference folder pointing at the original. Visual Studio's `ConnectedService.json` (`ExtendedData.inputs`) is the same shape; that VS also copies no metadata file was not checked on Windows here, but svcutil's own behaviour gives the model. Minimal fix therefore: keep the input where it is, pass `path.resolve(reference.folder, input)` (absolute) in the temp params file, store the input relative to the reference folder as svcutil does, and drop the copy into the reference folder (`:64-69`). Copying the WSDL's whole folder is not enough for case (b) and would drag unrelated files along.

Affected: only references added from a local file (or VS-made references whose `inputs` is a local split WSDL, which also fail on Update because `:46-48` copies only that file). URL references (the usual VS-made case) are not affected. Severity stays bug.

### A6-3: CONFIRMED (risk), now proven; line numbers wrong

Real lines: snapshot `serviceReferenceGenerator.ts:35`, unconditional write-back `:55`, `WCFMetadata` write from the snapshot `:82`. `serviceReferenceService.ts` adds no guard (no dirty-editor check; the progress is not cancellable). Proof (scratch jest test, the real `generateServiceReference` with an svcutil stub that, while "running", adds `<PackageReference Include="Serilog" ...>` to the project file as a NuGet install would, then writes `Reference.cs`): result `success true`, and the project file afterwards contains only `TargetFramework` and the `WCFMetadata` item: the PackageReference is gone, no message. The window is the svcutil run time (a few seconds for a local WSDL, up to the 5-minute timeout for a slow URL), so it stays a risk, not a bug users will hit often. Affects the SOAP service reference users of the team.

### A6-4: CONFIRMED (bug, minor)

`PublishPanel.ts:149-152` refuses only `\ / : * ? " < > |`; `dotnetTaskProvider.ts:45` passes `-property:PublishProfile=${profile}` unescaped. Re-run in `/tmp/ver6/pub` (SDK 10): `'-property:PublishProfile=Test;1'` gives `MSB1006: Property is not valid. Switch: 1`; the escaped `'-property:PublishProfile=Test%3B1'` publishes with that profile (into its `PublishDir`), so MSBuild escaping in `dotnetTaskArgs` is a working fix. Narrower than it reads: new profiles get a generated name (`newProfileName`, "FolderProfile..."), so only a Rename to such a name, or a `.pubxml` with `;`/`,` in its name coming from the repository, triggers it. Severity: bug, minor.

### A6-5: CONFIRMED (bug)

Code as cited (`userSecrets.ts:21-31`, `:40-44`): every error of `dotnet msbuild -getProperty` is turned into "no id". Re-proved with the real `manageUserSecrets` and real MSBuild, two failure kinds, `Directory.Build.props` setting `shared-team-id` in both:

```
[gj]    (global.json pins 9.0.999, not installed; exit 155)        -> csproj gets 80e6b2b0-..., opens .../usersecrets/80e6b2b0-.../secrets.json
[props] (Directory.Build.props mid-edit: unclosed <PropertyGroup>, MSB4024) -> csproj gets 17ce5360-..., opens .../usersecrets/17ce5360-.../secrets.json
```

After repairing `Directory.Build.props`, `dotnet msbuild -getProperty:UserSecretsId` on the project now returns `17ce5360-...`: the project's own property overrides the shared one permanently, and the app reads an empty secrets store at run time. No error is shown (only a log warning). The `global.json` case is less likely in practice (nothing else would work either); a props file open and half-edited, or the 60 s timeout on a cold machine, is the plausible trigger. Affects the team's ASP.NET Core web apps that share one id via `Directory.Build.props`; projects with the id in their own `.csproj` are not affected (`ProjectFileEditor.userSecretsId` finds it without MSBuild). Severity stays bug.

### A6-6: CONFIRMED (risk, low)

Same test: a project with `<UserSecretsId>../../../../tmp/ver6/us/evil</UserSecretsId>` and `HOME=/tmp/ver6/us/home`: `manageUserSecrets` created `/tmp/ver6/tmp/ver6/us/evil/secrets.json` (content `{}`) outside `~/.microsoft/usersecrets` and opened it. (The reviewer's `userSecretsPath` example is correct as a path computation.) ASP.NET Core rejects such an id (`PathHelper.GetSecretsPathFromSecretsId` checks `Path.GetInvalidFileNameChars()`, which contains `/` on Linux and `\`, `/` and more on Windows), so the project's secrets would never load anyway. Needs a crafted project file from a cloned repository; the realistic harm is that secrets typed by the user land in a file inside a working tree (e.g. an id pointing back into the repo) where they may get committed. Stays a low risk.

### A6-7: CONFIRMED (bug), end to end except the real extension host's cwd

Code as cited (`templateCache.ts:90-92`: `execFile` without `cwd`; `:100-113`: `templates ??=` once per session for all solutions). Proof by driving the real `readTemplates` from jest with `process.chdir` (the module re-loaded each time), `/tmp/ver6/g8/global.json` pinning 8.0.130:

```
cwd /tmp:             87 templates; mstest options: framework,no-restore,langVersion,sdk,test-runner,coverage-tool,extensions-profile,fixture
cwd /tmp/ver6/g8/sol: 61 templates; mstest options: framework,enable-pack,no-restore
```

So what the wizard lists depends only on the process cwd. In the pinned folder `dotnet new mstest -n T -o T --test-runner MSTest` exits 127 ("'--test-runner' is not a valid option"), and the A6-1 proof above shows the same through the real `createSolutionWithProject` (which then also leaves the half-made folder). The mismatch also goes the other way: SDK 8's `enable-pack` is not offered, and 26 templates listed from SDK 10 do not exist under SDK 8 ("No templates found"). Not checked: the cwd of VS Code's extension host (VS Code was not started). It is usually not the solution folder (desktop launch: the home folder; Windows: VS Code's install folder); only a first `code .` from a terminal inside the repository would hide the bug, and then only for that one solution. Affected: the team when a repository pins SDK 8 by `global.json` and SDK 10 is installed (the .NET 8/10 mix); with no `global.json`, or the newest SDK pinned, nothing happens. Severity stays bug.

### A6-8: CONFIRMED (bug), trigger narrowed

Cited line is really `cleanupSteps.ts:51` (`['format', 'style', projectTarget, '--severity', severity, ...include]`); the default of `shinobi.codeCleanup.severity` is `warn`. Matrix with the exact arguments `cleanupSteps` builds (scratch jest test, steps run in the returned `cwd` with `spawnSync`, the message through the real `failureReason`), fixture `/tmp/ver6/fmt`: `Lib/L.cs` (`namespace Lib;`), `Lib/Sub/S.cs` (`namespace Wrong;` plus an unused `using`), SDK chosen by `global.json`:

| `.editorconfig` | `--severity` | SDK 10.0.111 | SDK 8.0.130 |
|---|---|---|---|
| both lines from the docs (IDE0130 `warning`, `match_folder = true`) | warn (default) | exit 1, crash | exit 1, crash |
| same | info | exit 1, crash | exit 1, crash |
| same, plus `--exclude-diagnostics IDE0130` | warn | 0 | 0 |
| same, file `Sub/S.cs` (`--include Sub/S.cs`) | warn | exit 1, crash | exit 1, crash |
| same, file `L.cs` | warn | 0 | 0 |
| only `dotnet_diagnostic.IDE0130.severity = warning` | warn | exit 1, crash | exit 1, crash |
| IDE0130 `suggestion` + `match_folder` | warn | 0 | 0 |
| same | info | exit 1, crash | exit 1, crash |
| none | warn | 0 | 0 |

The crash text both SDKs give is `Unhandled exception: System.NotSupportedException: Changing document properties is not supported`. So the exact trigger is: IDE0130's effective severity at or above Code Cleanup's `--severity` (the `match_folder` line is not needed, it defaults to true) and at least one file in the formatted set whose namespace does not match its folder. Steps 1 and 2 ran first and changed files (whitespace fixed, the unused `using` removed from `S.cs`) before step 3 failed. What the user sees: the error notification `Code Cleanup failed at "Applying code style fixes": Unhandled exception: System.NotSupportedException: Changing document properties is not supported` with "Show Output" (`codeCleanup.ts:118`); the other style fixes of step 3 are not applied, every time, until all namespaces match. `--exclude-diagnostics IDE0130` fixes it on both SDKs. Affects every team member who added the lines Sync Namespaces recommends, on .NET 8 and 10 alike. Severity stays bug.

### A6-9: CONFIRMED (bug), and the proposed fix is simpler than stated

Re-proved through the real code path: the real `NamespaceService.updateNamespaceViaRename` in a jest test whose `vscode` mock forwards `vscode.executeDocumentRenameProvider` to the Roslyn server of `muhammad-sammy.csharp` 2.160.9 over stdio (own client, the reviewer's probe adapted; fixture copied to `/tmp/ver6/ns/Shop`: `Api/Services/Moved.cs` with `namespace Shop.Services;`, `User.cs` using `Moved` and `Stays` via `using Shop.Services;`, `Services/Stays.cs`), and `applyEdit` applying LSP edits to disk:

```
vscode.executeDocumentRenameProvider at 0:10 newName=Shop.Api.Services -> null
[WRN] NamespaceService: No workspace edit returned for namespace rename from Shop.Services to Shop.Api.Services
updateNamespaceViaRename returned true
tabs opened: 1   (showTextDocument with preview: false, once per file)
Moved.cs now: "namespace Shop.Api.Services;" | User.cs line 1: "using Shop.Services;"
dotnet build: exit 1, error CS0246: The type or namespace name 'Moved' could not be found
```

So the user gets "updated" and a project that no longer builds. Not broken when every file that uses the moved types moved along with them (they get the same new namespace); broken for users outside the moved folder, which is the normal case for a Cut/Paste of a `Services` folder in a web app.

Correction to the fix: in the same session, `textDocument/codeAction` at the namespace declaration with **empty** `context.diagnostics` and **no `.editorconfig` anywhere above the project** returned `"Change namespace to 'Shop.Api.Services'"` (plus "Move file to 'Services'"), and its resolved edit touches `Api/Services/Moved.cs` and `User.cs`. It is Roslyn's sync-namespace refactoring, offered whatever IDE0130's severity is; the fix does not need IDE0130 reporting. (This also suggests that `docs/sync-namespaces.md`'s "IDE0130 must be reporting" may be stricter than needed, depending on how `runSyncNamespaces.ts` asks for the action; not followed up here.)

`docs/manual-testing.md` entry "Namespaces after Cut/Paste" (line 37) is expected to **fail** on the current code at "the language server's rename, references in other files follow": the questions (Update All / Review Each / single file / none on Copy) should appear as described, but only the declarations change and references elsewhere stay on the old namespace. Affects the whole team (daily refactoring, C# web apps). Severity stays bug.

### Result of the second pass

No finding refuted; none downgraded except A6-4 (now "bug, minor": new profiles get generated names, so only Rename or a repository file triggers it). Corrections: the line numbers of A6-2, A6-3 (`serviceReferenceGenerator.ts` has 112 lines) and A6-8 (`cleanupSteps.ts:51`) are wrong in the report; A6-8 does not need the `match_folder` line and also fails at `--severity info` with IDE0130 at `suggestion`; the A6-9 fix can use the "Change namespace to '...'" refactoring without IDE0130 reporting. Scratch material of this pass: `/tmp/ver6` (repo copy with tests under `src/ver/`, fixtures `svc`, `us`, `g8`, `fmt`, `ns`, `pub`); the language server started by the A6-9 test was killed at its end (no process left).
