# History

What has been built so far, phase by phase, with notes on how. What comes next is in the [roadmap](roadmap.md); what changed per release in the [changelog](../CHANGELOG.md).

## Phase 1: Stabilize
- [x] Fix the failing tests and the file nesting duplication
- [x] Reject .slnx files that `dotnet` rejects (folder names without `/`, duplicates, missing paths) and show the reason instead of an empty tree
- [x] Parse `launch.json` / `tasks.json` as JSONC and edit them without dropping other configurations or comments
- [x] Warn when the solution is .slnx but `muhammad-sammy.csharp` runs OmniSharp (its default), which cannot load .slnx; offer to set `"dotnet.server.useOmnisharp": false` (Roslyn language server)
- [x] Add existing projects into solution folders ("Add Existing Project…" on a solution folder; a project file picked as solution item is added as a project); projects added at the solution root stay there instead of getting folders that mirror their directories

## Phase 1.5: Look like VS Code
- [x] Files and folders in the Solution Explorer use the user's file icon theme (`workbench.iconTheme`, e.g. Seti, Material Icon Theme, vscode-icons); `@iconify` stays as the fallback, for dependency nodes, and for solutions/projects the theme has no dedicated icon for

## Phase 2: Errors in the Problems Panel and the Solution Explorer
**Goal**: An equivalent of Visual Studio's Error List, and of the [Solution Error Visualizer](https://marketplace.visualstudio.com/items?itemName=VisualStudioPlatformTeam.SolutionErrorVisualizer) extension showing in the tree where errors, warnings and infos are. The tree markers are a must-have.

**Solution Explorer markers**:
- [x] Mark files with errors, warnings and infos (icon/colour and count, like VS Code's explorer decorations)
- [x] Roll the most severe state up to nested parent files, folders, projects, solution folders and the solution
- [x] Update live as diagnostics change
- [x] Build output (`$msCompile`) is the primary source, as in Visual Studio where the markers are only reliable after a (re)build; live language-server errors for open files come on top. Optionally mention `dotnet.backgroundAnalysis.compilerDiagnosticsScope: fullSolution` for live errors in all files

**Build**:
- [x] Run Build/Rebuild/Clean/Restore as VS Code tasks with the `$msCompile` problem matcher instead of `terminal.sendText`
- [x] Errors and warnings link to file and line
- [x] Build solution from the command palette / a key binding (Ctrl+Shift+B)

**Error List** (like Visual Studio's; the Problems panel never shows hints, which is how Roslyn reports suggestions):
- [x] Native "Error List" view in the panel: errors, warnings and messages (infos and suggestions), grouped by project and file
- [x] Toggle errors, warnings and messages; click an entry to jump to its file and line (now a table, see Phase 2.5)
- [x] Error count badge on the view

**Implementation Notes**:
- Source is `vscode.languages.getDiagnostics()` / `onDidChangeDiagnostics`, which merges `$msCompile` build output and the C# language server; this depends on the Phase 2 build tasks
- Aggregate per file path in the extension host and send counts per node to the webview; the webview only renders them

## Phase 2.5: Error List like Visual Studio
- [x] A table instead of a tree: severity, Code, Description, Project, File, Line
- [x] Sort by any column; search box; filter Code, Project and File by their values (like Visual Studio's column filters); codes link to their documentation
- [x] The Errors / Warnings / Messages toggles are shared settings (`shinobi.diagnostics.showErrors`, `showWarnings`, `showInfos`) that also decide which markers the Solution Explorer shows

## Phase 3: Run & Debug Web Apps (F5)
**Goal**: F5 on an ASP.NET project behaves like Visual Studio.

- [x] Use the selected `launchSettings.json` profile: `applicationUrl`, `environmentVariables`, `commandLineArgs` (via the C# debugger's `launchSettingsProfile`; only `commandName: "Project"` profiles)
- [x] Open the browser when the app is ready (`serverReadyAction`, driven by `launchBrowser`)
- [x] Offer "Set as Startup Project" only on projects that can be started (`OutputType` Exe/WinExe, or the Web, Worker or Aspire AppHost SDK; not class libraries or test projects)
- [x] Choose the launch profile: "Set as Startup Project" asks when there are several; on the startup project "Set Launch Profile..." changes it
- [x] Resolve the output path through MSBuild (`TargetPath`) instead of hardcoding `bin/Debug/<tfm>/` (respects `OutputPath`, `AssemblyName`, artifacts layout)
- [x] Debug/Release switch in the Solution Explorer title bar, for builds and F5 (configurations from the solution file; kept per user; the active one shows next to the view title)
- [x] Follow changes to `launchSettings.json`: a removed or renamed profile falls back to another, and "Set Launch Profile..." appears once there are several

## Phase 4: Connected Services (SOAP)
**Goal**: The "Add Service Reference / Connected Service" workflow for WCF/SOAP clients.

- [x] "Add Service Reference…" on a project or its Connected Services folder: WSDL URL or file, name, namespace
- [x] Generate the client into `Connected Services/<Name>/` (Visual Studio's `ConnectedService.json` and `WCFMetadata` item) and add the current `System.ServiceModel.Http`/`Primitives` packages
- [x] "Update Service Reference" and "Remove Service Reference" on the reference folder, also for references Visual Studio created; updating regenerates for the project's current target framework
- [x] Detect a missing `dotnet-svcutil` and offer to install it for the repository (tool manifest) or globally

**Implementation Notes**:
- Visual Studio's WCF Web Service Reference provider is a UI over `dotnet-svcutil`, which runs on Linux
- `dotnet-svcutil` 8.0.0 needs .NET 9; it runs with `DOTNET_ROLL_FORWARD=Major` on newer runtimes
- Generating runs `dotnet-svcutil --update` on a params file made from `ConnectedService.json` in a temporary folder under `obj/`; svcutil's own package edits (`System.ServiceModel.*` `4.10.*`) are undone

## Phase 5: New Project & New Item Templates
- [x] "Add New Project" wizard on the solution or a solution folder: pick a template (search, categories, recently used first), then name, location (next to the other projects) and the template's own settings (framework preselected from the solution, authentication, HTTPS, controllers, …), Create adds it to the solution (folder)
- [x] "Add New Item" wizard on projects and folders: Class, Interface, Record, Enum, Struct built in; controllers, Razor items, test classes, config files and your own `dotnet new` item templates, with their settings
- [x] Generate namespaces from `RootNamespace` and the folder structure (folder names made valid identifiers, `Connected Services` → `Connected_Services`)
- [x] Rename nested dependent files together with their parent (Form1.cs → Form1.Designer.cs, Form1.resx; Index.cshtml → Index.cshtml.cs)

## Phase 6: Test Integration
**Goal**: Test discovery and execution through the VS Code Test Explorer.

- [x] `vscode.TestController` with project → namespace → class → test (→ parameterized cases) hierarchy, linked to file and line
- [x] Discover Microsoft.Testing.Platform tests (xUnit v3, MSTest runner, TUnit, NUnit runner); run and debug single tests, classes or whole projects; re-discover after builds
- [x] Show results (failure message, stack trace, expected/actual where the framework reports them) and output

**Implementation Notes**:
- Microsoft.Testing.Platform's server mode: the test app (`dotnet <TargetPath> --server --client-port <port>`) connects to the extension and speaks JSON-RPC (`testing/discoverTests`, `testing/runTests`, `testing/testUpdates/tests`), which brings file and line of every test
- Debugging starts the test app in the C# debugger with the same arguments

## Phase 7: Private NuGet Feeds
- [x] Clear message when a private feed rejects its credentials (expired token): where the credentials are (file and line), what to do for popular feeds (Azure DevOps, GitHub, GitLab, JFrog, MyGet), and a way to enter a new token; credentials are found like NuGet finds them and a new token works without restarting

## Phase 7.5: Visual Studio Basics
**Goal**: The everyday Solution Explorer and Debug commands of Visual Studio that were still missing.

- [x] Collapse All in the Solution Explorer title bar
- [x] Sync with Active Document: select the open file in the tree (title bar button, like Visual Studio's)
- [x] "Add Existing Item..." on projects and folders: copy files into the project
- [x] "Debug > Start New Instance" and "Debug > Start Without Debugging" on projects that can be started, without making them the startup project
- [x] Start without debugging (Ctrl+F5) for the startup project
- [x] "Run Tests" and "Debug Tests" on test projects, folders and files
- [x] "Open in Terminal" and "Copy Full Path" on the solution, projects, folders and files; "Edit Project File" on projects
- [x] Analyzers under Dependencies: the analyzer and source generator assemblies of a project; generators list the files they generated (from the last build), which open read-only
- [x] Packages under Dependencies expand to the packages they depend on (transitive packages), as many levels deep as they go
- [x] NuGet manager: the Installed tab lists the transitive packages in their own section, with the packages that bring them in; Install makes one a direct reference

## Phase 8: Nice to Have
- [x] Test Explorer for classic VSTest projects (xUnit v2, NUnit/MSTest with the VSTest adapters)
- [x] Manage user secrets (`dotnet user-secrets`) from the project context menu

## Phase 9: Publish
**Goal**: Visual Studio's Publish page for the Folder target: profiles in `Properties/PublishProfiles/*.pubxml`, compatible with Visual Studio.

- [x] "Publish..." on a project: a Publish tab with the existing profiles, Publish button and summary (location, configuration, framework, deployment mode, runtime), new profile, rename and delete; Folder target with configuration, framework, runtime identifier, self-contained, single file, ReadyToRun

## Phase 10: Polish
**Goal**: Behave like a finished extension in the small things.

- [x] No notifications for what the tree already shows (file created, project added, framework changed, ...), like Visual Studio
- [x] Delete moves files and folders to the trash, like VS Code's explorer, instead of deleting them permanently
- [x] Publishing metadata: `CHANGELOG.md`, description, categories, keywords and a `.vscodeignore` that packages only the bundles
- [x] Document Attach to Process (the C# extension's attach configuration) and database tools (the SQL Server (mssql) extension) for people coming from Visual Studio

## Phase 11: Diagnosability
- [x] A "Shinobi .NET Studio" Output channel with all logs and VS Code's log levels (Developer: Set Log Level), so problems can be reported
- [x] Troubleshooting page: empty tree, OmniSharp, tests not appearing, rejected feed credentials, where the logs are

## Phase 12: Finding Solutions
- [x] Solutions in subfolders (`src/App.sln`): the extension starts for them and finds them, like Visual Studio opens any solution

## Phase 13: Tree Keyboard & Screenshots
- [x] Type-to-find in the Solution Explorer (typing jumps to the next matching node), Home and End
- [x] Screenshots of the Solution Explorer, Error List, NuGet manager, Test Explorer and Publish tab in the README and docs, captured by a script (`scripts/screenshots/capture.sh`)

## Phase 14: Starting Fresh & Multi-Select
- [x] Create a new solution with its first project in an empty folder, like Visual Studio's "Create a new project"
- [x] Select several nodes in the Solution Explorer (Ctrl/Shift+click) to delete, cut, copy or build them together

## Phase 15: Scale
- [x] Multi-root workspaces: a solution in any workspace folder, not only the first
- [x] Measure and improve loading and refreshing on large solutions: with 300 projects, loading takes about 0.4 s and a refresh with 50 expanded projects 35 ms (was 2 s); test projects are evaluated and built a few at a time

## Phase 16: Visual Studio Basics, Part 2
**Goal**: The larger everyday features of Visual Studio that are still missing.

- [x] Open and switch solutions: "Open Solution..." (the workspace's solutions, or any via Browse), the choice is remembered, like Visual Studio's File > Open > Solution
- [x] Open Launch Settings on projects that can be started: opens `Properties/launchSettings.json`, created with the profiles `dotnet new` writes when missing (shorter than Visual Studio's Properties > Debug > Open debug launch profiles UI)
- [x] Convert .sln to .slnx: opening a .sln offers to convert it (`dotnet sln migrate`), then to delete the .sln, and opens the .slnx; "Don't Ask Again" per solution
- [x] Unload / Reload Project: an unloaded project stays in the tree greyed out as "(unloaded)" and is skipped by solution builds (through a solution filter) until it is reloaded; remembered per workspace, like Visual Studio's per-user setting
- [x] Pack on class libraries: builds the NuGet package (`dotnet pack`) for the active configuration with the project's package metadata (PackageId, Version, Authors, ...) and shows where the `.nupkg` went
- [x] Configuration Manager like Visual Studio's (solution context menu, title-bar menu or command palette): an editor tab with the active configuration and platform, Edit Configurations... and Edit Platforms... (add with "Copy settings from", rename, remove; renaming keeps each project's own names), and a grid with each project's configuration, platform and Build; written to the .sln sections or the .slnx elements (only deviations from the default) at once; Select Solution Platform... in the title bar, the view title shows `Debug | x64`; solution builds pass `--configuration` and `-property:Platform` (MSBuild skips projects with Build off), single-project builds, F5, Pack and the analyzers use the project's mapped values. Limits: the project dropdowns list what the project file declares, single-project builds run even with Build off

## Phase 17: Code Cleanup & Refactoring
**Goal**: Visual Studio's project-wide fixes and the refactorings you reach for daily. Fixes at a spot in the code (Ctrl+.) come from the C# extension's Roslyn server and aren't duplicated.

- [x] Code Cleanup, like Visual Studio's Analyze > Code Cleanup (Ctrl+K, Ctrl+E), on the solution, a project, a folder or a file in the tree and on the open file: three `dotnet format` steps (whitespace; unused usings, IDE0005, with `--severity hidden` on SDK 10 and newer, on older SDKs only when `.editorconfig` raises IDE0005; the code style fixes at the severity of the `shinobi.codeCleanup.severity` setting, default `warn`) with progress, Cancel and a summary. `dotnet format` does not sort usings: the language server's "Sort Usings" quick action (Ctrl+.) does
- [x] Fix all occurrences of a diagnostic (e.g. IDE0090) in the document, project or solution: covered by the C# extension ("Fix All: ..." next to each fix), not duplicated
- [x] Sync Namespaces on a project or folder, like Visual Studio's: for each C# file the language server's "Change namespace to '...'" action is applied (it also fixes references in other files), one file at a time with progress; needs the C# extension and IDE0130 reporting (`dotnet_diagnostic.IDE0130.severity` and `dotnet_style_namespace_match_folder` in `.editorconfig`)
- [x] Refactorings: the C# extension's Roslyn server (`muhammad-sammy.csharp` 2.160.9, asked over LSP on 2026-10-20) already offers and applies what the team uses daily: file-scoped namespaces, primary constructor (and remove fields), Extract interface (no dialog: a new interface in the same file with the public members), Move type to its own file, Extract method, plus Introduce local/parameter, Inline temporary variable, Use implicit type. Not offered by the server: Change Signature, Move to namespace, Pull members up (see Phase 30)
- Menu group names are two digits now (`01_group`): VS Code sorts group names as text, so the tenth group of the project menu used to sort after the first

## Phase 18: Run & Debug, Part 2
**Goal**: The run and debug features that Visual Studio has beyond F5 on one project.

- [x] Several startup projects like Visual Studio's "Configure Startup Projects": an editor tab with the single/multiple choice, a table of the projects with Action (None, Start, Start without debugging), launch profile and order, and "Share profile"; the profiles are Visual Studio's `.slnLaunch` files (shared, or the user file), so colleagues in Visual Studio get the same; "Select Startup Profile..." in the title bar. While a profile is active `.vscode/launch.json` holds a compound `Startup` (`stopAll`, one solution build as `preLaunchTask`), so F5 starts all, Ctrl+F5 runs all without the debugger and Stop ends all; unloaded projects are left out. The `.slnLaunch.user` file name and the launch profile key (`DebugTarget`) are not verified against Visual Studio
- [x] Attach to Process: "Attach to Process..." lists the running .NET processes with project name, pid and listening ports (Linux `ps`/`ss`, macOS `ps`/`lsof`, Windows PowerShell/`netstat`), solution projects first, and attaches the C# debugger
- [x] HTTPS development certificate: before a project with an `https://` launch profile starts, an untrusted or missing certificate is reported once per session (Trust Certificate, Not Now, Don't Ask Again; `shinobi.debug.checkDevCertificate`), "Trust HTTPS Development Certificate" in the palette; trusting on Linux is partial and the message says so
- [x] Hot Reload: "Start with Hot Reload" (project Debug submenu, palette) runs `dotnet watch run` in a "<project> (watch)" terminal with the project's launch profile. Without a debugger: with netcoredbg attached `dotnet watch` reports "Assembly updates cannot be applied while a debugger is attached" and stops applying changes (tried on SDK 10), so debugging and hot reload cannot be combined with this C# extension

## Phase 19: Solution Explorer, Part 2
**Goal**: The second round for the Solution Explorer: the tree shows what the projects contain, and nodes move by dragging.

- [x] The tree follows the project's items like Visual Studio: `dotnet msbuild -getItem` per project (one process per project at a time, further requests during a run give one more run; cached, evaluated again when the project file or a `Directory.Build.*` file changes) is laid over the disk listing; `<Compile Remove>` / `DefaultItemExcludes` hide files, linked files appear under their link path with a link badge, a multi-targeted project shows what its first framework contains; Show All Files (title bar, remembered per solution) shows the excluded files and `bin`/`obj` greyed out. Without the .NET SDK the tree shows the disk
- [x] Exclude From Project / Include In Project on files and folders of SDK-style projects: writes or deletes `Remove` items (`Dir\**` for folders, per item type, MSBuild-escaped) and `Include` items for files left out by the defaults; warns when other items still decide it, refuses folders that hold a project, asks before including more than 200 files
- [x] Drag & drop like Visual Studio: files and folders into folders and projects (the copy key copies: Ctrl, on macOS Ctrl, Cmd or Option), projects and solution folders into solution folders or to the root, solution items between solution folders, several selected nodes at once; the webview and the extension check the same rules (`core/dropRules.ts` works on node types and parent chains of opaque ids; the extension builds them again from the solution and refuses anything it does not know). `.sln` moves change `NestedProjects` and `SolutionItems` lines, `.slnx` moves rename folder `Name`s and move `<Project>`/`<File>` elements, keeping the formatting. Moved C# files get one namespace question per drop (Update All / Review Each / Skip); Cut/Paste and folder renames ask the same way now
- Decided against: search in the Solution Explorer, the analyzers' rule lists, a Project Properties form and a Launch Profiles editor (see Not Planned in the roadmap)

## Phase 20: NuGet, Part 2
**Goal**: The NuGet manager, the Dependencies tree and the Updates/Consolidate tabs work with Central Package Management.

- [x] Central Package Management (`Directory.Packages.props`): the project evaluation that already runs per project (`ProjectItemsService`) also reads `PackageReference`, `PackageVersion`, `GlobalPackageReference` and the CPM properties, so the tree and the NuGet manager show the version MSBuild uses and where it comes from (`override`, `global`); unknown versions are never offered as updates. Install, update, bulk update and uninstall edit `Directory.Packages.props` (or the props file it imports that defines the entry) and the project files as text edits that keep the formatting; new items never go into an `ItemGroup` with a `Condition`, and the files of one change are written all-or-nothing (the others get their old content back when one fails). A change that reaches projects that were not selected is confirmed first, with Set for This Project Only (`VersionOverride`) as the alternative; global packages are updated, removed for all projects or opted out per project (`GlobalPackageReference Remove`); a `PackageVersion` left unused is removed only when the user says so; Consolidate sets the central version and removes the overrides. `Directory.Packages.props` and its imports are watched (props files outside the workspace are checked when the NuGet manager gets focus); projects without CPM keep using the `dotnet` CLI. A multi-targeted project is evaluated for its first target framework only (see the known bugs in the roadmap)

## Phase 21: Connected Services, Part 2
**Goal**: gRPC references next to the WCF ones, like Visual Studio's "Add Connected Service > gRPC".

- [x] gRPC references from `.proto` files without `dotnet-grpc`: Add Service Reference asks WCF Web Service or gRPC first (the WCF flow is unchanged), gRPC takes a `.proto` file or a URL (downloaded into `Protos/`) and Client, Server or Both (Both first in web projects), writes the `<Protobuf>` item `dotnet-grpc` writes (`Link` for files outside the project, `<SourceUrl>` for URLs, formatting kept, placed unconditionally after the last unconditional `Protobuf` item) and adds the packages through the Central Package Management aware installs of Phase 20 (Grpc.Tools as a private development dependency; packages already there, or brought by `Grpc.AspNetCore`, left alone). Downloads are checked: a web page (HTML) or an empty answer is refused, 5 MB limit, one timeout for the whole download, cancel from the notification, https to http redirects refused, credentials redacted in messages and the output. A half-done Add (item written, packages failed) is finished by adding the same reference again. The project evaluation keeps `GrpcServices`, `Link` and `SourceUrl`, so Connected Services lists every `Protobuf` item, also without a `Connected Services` folder on disk; Update downloads URL references again and replaces the file only when it changed, Remove takes the item out and keeps the file
- Dropped: OpenAPI clients (`<OpenApiReference>` and `dotnet openapi` are deprecated in .NET 10; see Not Planned in the roadmap)

## Phase 21, Part 3: Known bugs
**Goal**: The bugs found along the way, fixed before the code review of Phase 22.

- [x] A failed MSBuild evaluation (a timeout, a half-saved project file) was cached as "no item list" until the project changed again: it is now retried after 5 s, 30 s and 2 min, and after that whenever a folder of the project is expanded; a success clears it
- [x] Exclude From Project / Include In Project on a file or folder in the folder of a nested project, from the outer project's tree, edited the nested project's file: file and folder ids in a nested project's folder carry the project whose tree shows them (other ids unchanged), and Exclude/Include and the folder expansion use it
- [x] Item matching in the project file found only self-closing items: block-form items (`<Compile Remove="Old.cs"></Compile>`, items with metadata children) are found now, so Include In Project deletes such a `Remove` and Exclude From Project sees it (a `Remove` with child elements is an MSBuild error, MSB4162)
- [x] After a new item list the expanded folders are read again parents first (by depth), not in the order they were first expanded
- [x] The bin/obj casing tests (`folderLayout.test.ts`) run the Windows, macOS and Linux branches on every system (`process.platform` overridden)
- [x] After a drop the target (a collapsed solution folder, folder or project) opens and the moved nodes are selected, also when their ids change (`.slnx` folders without `Id`) and when a moved file only shows after its project's next evaluation; the drag & drop GIF was captured again
- [x] No grey hover highlight stays behind after a drag & drop: the cause was Chromium moving `:hover` to the drag's start position right after the drop (a `mouseover` without movement), so the highlight is a class the tree sets from mouse events
- [x] Central packages: an edit in the NuGet manager evaluated each affected project twice (measured: 9 MSBuild runs for 5 projects, the watchers reacting to the extension's own write while the restore ran); files the extension writes are recorded with their stamp and the watchers skip them, so the re-evaluation after the restore is the only one
- [x] Delete on a linked file warns that it deletes the real file outside the project (with its path and the projects that then miss it) and offers Remove Link; the new Remove Link command removes only the item from the project file (links from wildcards or props files are left alone with a message)
- [x] The Test Explorer finds the tests of multi-targeted test projects (`<TargetFrameworks>`) and builds and runs them for one framework: the one picked with Select Framework when the project targets it, `net472` included, otherwise the highest .NET version an installed runtime supports; the output says which framework and why. Outside Windows .NET Framework VSTest projects run under Mono through the .NET Framework `vstest.console.exe` of the `Microsoft.TestPlatform.Portable` package (downloaded on the first run; without Mono the Testing view says so), since the SDK has no .NET Framework test host there; Debug Tests on them is refused with a message (the C# debugger cannot attach to Mono); Microsoft.Testing.Platform apps targeting `net472` still start with `dotnet` (not checked in VS Code)
- [x] Run All Tests on a solution that was never built builds the test projects, discovers their tests and reports the results: such projects show *not built yet* in the Testing view, a result for a test the tree doesn't have discovers the project again, and results that still have no test are listed in the Test Results output instead of being dropped (not checked in VS Code)
- [x] F5 on a startup profile started only the first project entry of `launch.json` (VS Code selects the first entry for a new folder), without the compound's build, so the project's dll could be missing: the project entries are hidden (`presentation.hidden`) and the `Startup` compound is listed first (`order` 1), so VS Code selects it and F5 builds once and starts the projects; writing the profile again upgrades a `launch.json` written by 0.1.1 and a selected project entry gives way to `Startup` (not checked in VS Code)
- Checked, not reproducible: "Show All Files is read from a global that is set to the new solution only after it has loaded". Opening a second solution reads no folder before `ShowAllFiles.setSolution`, which runs right after the solution is ready (measured with the real `SolutionService`: 0 folder reads while it loaded); comes back with a repro

## Phase 21, Part 4: Limitations we could fix
**Goal**: Small limitations, no design needed.

- [x] The Test Explorer uses a project's `.runsettings` file (`RunSettingsFilePath`, read in the test project evaluation): VSTest gets everything but data collectors and loggers (`DesignMode` stays ours), and VSTest projects sharing the file run in one session so `MaxCpuCount` runs their assemblies in parallel (3.7 s instead of 7.1 s for two assemblies of 3 s each; .NET Framework projects run under Mono get a session of their own); MSTest and NUnit runner apps (VSTest bridge) get `--settings` with a cleaned copy and the file's environment variables on the process; xUnit v3/TUnit don't read run settings; a missing or invalid file is skipped with a line in the test output; coverage stays a script (not checked in VS Code)
- [x] gRPC references: when the project has an older `Google.Protobuf` than the new packages need (NU1605 at restore), it asks and raises it to the lowest version they need, through the Central Package Management aware installs; kept, the reference is added without its packages and the message says what to raise
- [x] gRPC references: a case-only duplicate (`a.proto` / `A.PROTO`) was already refused on Windows and macOS (`pathKey`); a test now proves it

## Phase 21, Part 5: Limitations we want to fix
**Goal**: Valuable for the team's daily work; fixed before the code review of Phase 22.

- [x] Central packages: a version written as `$(Property)` changes the property's definition (`Directory.Build.props`, `Directory.Packages.props` or a file they import, checked against MSBuild's evaluated version) instead of a literal on the edited package; when other packages follow the property, or it cannot be changed, the NuGet manager asks (Change Property / Set Package Only) and names the packages and projects reached; Consolidate too (not checked in VS Code)
- [x] Include In Project writes the item type MSBuild would give the file without the exclude (`Content` for Razor and web files in web projects, `EmbeddedResource` for `.resx`, `Compile` for `.cs`) with the SDK's `CopyToOutputDirectory`/`CopyToPublishDirectory`, so the files are compiled and published (checked with a real publish; not checked in VS Code)
- [x] Dropping a project onto another project's Dependencies (or Projects under it) adds a project reference; itself, an existing reference and a circular one are refused (`dotnet add reference` would write the circle), incompatible frameworks show the SDK's message (not checked in VS Code)
- Checked, not reproducible: "Building a single project does not clear stale build errors that an earlier solution build reported for other projects". In VS Code 1.136.1 every `$msCompile` task run clears the build problems of earlier runs, the other projects' included (measured with the extension's own build tasks); comes back with a repro

## Known bugs fixed after Phase 21, Part 4
- [x] Deleting the `.slnLaunch` file (or choosing Single) when no single startup project was set before the profile left `launch.json` without a `Startup` entry: the first project of the solution that can be started becomes the startup project, with a message (not checked in VS Code)
- [x] A project without packages, project references and assemblies had no Dependencies node: every project shows it (old-style projects too), and its menu has Add Service Reference... (not checked in VS Code)
- [x] A solution-level `.nuget/NuGet.Config` is read by Visual Studio but not by `dotnet restore` (NU1101 for private feeds, no credential prompt): the extension offers to move or copy it to `nuget.config` when the solution opens and after a failed restore or build, and the NuGet manager reads its feeds and credentials like Visual Studio (found with `Cirrus.Packager`)
- [x] The Solution Explorer has a toolbar row above the tree (configuration, framework or startup profile, Start Debugging, Start Without Debugging, Sync, Show All Files, Collapse All) instead of seven icons in the view title, which VS Code hides in a narrow view such as the secondary side bar; the title bar keeps Start Debugging and the `...` menu; the search box is put off (Not Planned)
- [x] Dependencies > Frameworks (`Microsoft.NETCore.App`, `Microsoft.AspNetCore.App`, as in Visual Studio) from the `FrameworkReference` items of the evaluation, implicit ones included; an explicit `<FrameworkReference>` shows too
- [x] Files a project links from outside its own directory count in the error and warning markers of the project and of the folder that shows them
- [x] `.sln` and `.slnx` edits from the code review: Add and Rename Solution Folder refuse a name a sibling has (any case); Remove of a solution folder takes projects of every type (a SQL project too) and their configuration lines, whatever the case of the GUIDs in the file (all GUIDs are read in upper case); the `.slnx` editor ignores XML comments (a project moved to the root no longer lands in a trailing comment); a `.sln` project with an absolute path outside the solution folder loads, and one project that cannot be read no longer fails the whole solution
- [x] From the code review: a new file or folder no longer leaves its temporary node in the stored expansion state; `GetPathOfFileAbove` without quotes (the form Microsoft's Central Package Management page shows) is followed to find version properties; a failed Test Explorer build puts its first errors into the test message and the log instead of pointing at the Problems panel, and Cancel stops the running build; the New Project and Add New Item wizards read templates and options from the SDK that `dotnet new` runs in the solution's folder (`global.json`), not the newest one
- [x] A file moved (renamed) on disk into a folder that is not shown keeps its old timestamps: a folder that changed since the evaluation and has entries the item list lacks now evaluates again too, so the file shows
- [x] Moving an open solution folder of a `.slnx` file without an `Id` by drag & drop keeps it and the open folders in it open (their ids come from their path, so they are opened again by name)
- [x] A Solution Explorer view that VS Code resolves again (view moved, location setting switched) no longer leaves the old active-editor listener behind, and the provider forgets the disposed view
- [x] NuGet from the code review: feeds over `http://` work, redirects are followed (the credentials stay with the host they were meant for), an answer has a size limit (64 MB) and a total time (2 minutes); a folder of packages as a source no longer holds package lookups for six seconds (the manager browses feeds, not folders) and disabled or folder sources no longer use up one of the three searched places; icons and READMEs are read from nuget.org only when it is one of the sources, so the ids of private packages are not sent there
- [x] Opening the NuGet manager runs `dotnet list package` once per project instead of four times (an answer is shared for 3 seconds while the project and its restore result are unchanged); writes of the startup configuration (launch.json, tasks.json) run one after the other in the order they were asked for, so a slow earlier choice no longer overwrites a later one
- [x] A test app or vstest.console that ends before it connected (a crash on start) is reported at once, with its output, instead of after the 30 second connect timeout (not for runs in the debugger, which report no exit)
- [x] Add and Update Service Reference undo only what svcutil added to the project file (its WCF packages and tool reference): an edit saved meanwhile, a package installed from the NuGet manager, stays
- [x] The Configuration Manager and Configure Startup Projects tabs follow the solution when another one is opened; the Solution Explorer and NuGet manager webviews no longer allow `unsafe-eval` (their bundles never needed it)
