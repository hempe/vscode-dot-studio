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
- [x] A "Shinobi .NET" Output channel with all logs and VS Code's log levels (Developer: Set Log Level), so problems can be reported
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
