<img src="icon.png" width="96" align="right" alt="Shinobi">

# Shinobi .NET for VS Code

A Visual Studio–style Solution Explorer, NuGet package manager and project tooling for .NET in VS Code. The goal is to replace Visual Studio (and Windows) for day-to-day work on modern .NET: ASP.NET web apps, services, and SOAP service clients. It aims for parity with Visual Studio on the basics, not on everything, and works in VS Code as well as in VSCodium and other Open VSX editors.

**Out of scope:** .NET Framework 4.x and old-style (non-SDK) projects. Legacy code is only read for reference when porting, and any plain text editor is fine for that.

## Features

Full documentation: **[docs](docs/README.md)**, starting with [Getting started](docs/README.md#getting-started), [Coming from Visual Studio](docs/coming-from-visual-studio.md) and [Keyboard shortcuts](docs/keyboard-shortcuts.md).

- **[Solution Explorer](docs/solution-explorer.md)** for `.sln` and `.slnx`: solution folders and items, Visual Studio's file nesting, your file icon theme, error markers, Dependencies with transitive packages and source-generated code, Sync with Active Document, Collapse All, and [context menus](docs/context-menus.md) with Visual Studio's commands and keys
- **[Run & Debug](docs/run-and-debug.md):** Set as Startup Project with launch profiles, Debug/Release, F5, Ctrl+F5, Debug > Start New Instance
- **[Error List](docs/error-list.md)** like Visual Studio's: a sortable, filterable table of errors, warnings and messages from builds and the language server
- **[Tests](docs/tests.md):** Test Explorer for Microsoft.Testing.Platform (xUnit v3, MSTest, TUnit, NUnit) and VSTest projects (xUnit v2, NUnit, MSTest), Run/Debug Tests from the Solution Explorer
- **[NuGet](docs/nuget.md) Package Manager:** Browse, Installed with transitive packages, Updates, Consolidate; private feeds and expired tokens
- **[Templates](docs/templates.md):** Add New Project and Add New Item wizards with every `dotnet new` template and its settings
- **[Publish](docs/publish.md):** Visual Studio's Publish tab for Folder profiles, sharing `.pubxml` files with Visual Studio
- **[Connected Services](docs/connected-services.md):** WCF/SOAP service references, compatible with Visual Studio's
- Build, Rebuild, Clean and Restore as tasks, Manage User Secrets, Add Existing Item, Open in Terminal and more; [settings](docs/settings.md)

## Known Issues
- [ ] Encrypted NuGet feed passwords (`Password`, Windows DPAPI) can't be used; store a `ClearTextPassword` (the NuGet manager's "Enter New Token..." does that) or use the Azure Artifacts Credential Provider, which covers restore and build
- [ ] Building a single project does not clear stale build errors that an earlier solution build reported for other projects
- [ ] Files a project links from outside its own directory are not rolled up into the project's marker
- [ ] Updating a reference Visual Studio created changes the generator version in every type of `Reference.cs` (svcutil 8.0.0 instead of Visual Studio's 2.0.2)
- [ ] svcutil cannot read .NET Framework assembly references (`<Reference Include="System.ServiceModel" />`); remove them when porting before updating a reference

## Roadmap

Ordered by what is needed to drop Visual Studio for daily work. Phases 1–7 cover web apps, SOAP clients, templates, tests and private feeds, phase 7.5 the Visual Studio basics still missing; phase 8 collects conveniences, phase 9 is publishing, phase 10 the second round of Visual Studio basics (solutions, projects, configurations), phase 11 code cleanup and refactoring, phases 12–15 the second round for run & debug, the Solution Explorer, NuGet and connected services, phase 20 what may come later, phase 21 the other publish targets. What still needs a check in VS Code itself is listed in [docs/manual-testing.md](docs/manual-testing.md).

### Phase 1: Stabilize
- [x] Fix the failing tests and the file nesting duplication
- [x] Reject .slnx files that `dotnet` rejects (folder names without `/`, duplicates, missing paths) and show the reason instead of an empty tree
- [x] Parse `launch.json` / `tasks.json` as JSONC and edit them without dropping other configurations or comments
- [x] Warn when the solution is .slnx but `muhammad-sammy.csharp` runs OmniSharp (its default), which cannot load .slnx; offer to set `"dotnet.server.useOmnisharp": false` (Roslyn language server)
- [ ] Keep this README in line with the actual features (ongoing, never ticked)
- [x] Add existing projects into solution folders ("Add Existing Project…" on a solution folder; a project file picked as solution item is added as a project); projects added at the solution root stay there instead of getting folders that mirror their directories

### Phase 1.5: Look like VS Code
- [x] Files and folders in the Solution Explorer use the user's file icon theme (`workbench.iconTheme`, e.g. Seti, Material Icon Theme, vscode-icons); `@iconify` stays as the fallback, for dependency nodes, and for solutions/projects the theme has no dedicated icon for

### Phase 2: Errors in the Problems Panel and the Solution Explorer
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

### Phase 2.5: Error List like Visual Studio
- [x] A table instead of a tree: severity, Code, Description, Project, File, Line
- [x] Sort by any column; search box; filter Code, Project and File by their values (like Visual Studio's column filters); codes link to their documentation
- [x] The Errors / Warnings / Messages toggles are shared settings (`shinobi.diagnostics.showErrors`, `showWarnings`, `showInfos`) that also decide which markers the Solution Explorer shows

### Phase 3: Run & Debug Web Apps (F5)
**Goal**: F5 on an ASP.NET project behaves like Visual Studio.

- [x] Use the selected `launchSettings.json` profile: `applicationUrl`, `environmentVariables`, `commandLineArgs` (via the C# debugger's `launchSettingsProfile`; only `commandName: "Project"` profiles)
- [x] Open the browser when the app is ready (`serverReadyAction`, driven by `launchBrowser`)
- [x] Offer "Set as Startup Project" only on projects that can be started (`OutputType` Exe/WinExe, or the Web, Worker or Aspire AppHost SDK; not class libraries or test projects)
- [x] Choose the launch profile: "Set as Startup Project" asks when there are several; on the startup project "Set Launch Profile..." changes it
- [x] Resolve the output path through MSBuild (`TargetPath`) instead of hardcoding `bin/Debug/<tfm>/` (respects `OutputPath`, `AssemblyName`, artifacts layout)
- [x] Debug/Release switch in the Solution Explorer title bar, for builds and F5 (configurations from the solution file; kept per user; the active one shows next to the view title)
- [x] Follow changes to `launchSettings.json`: a removed or renamed profile falls back to another, and "Set Launch Profile..." appears once there are several

### Phase 4: Connected Services (SOAP)
**Goal**: The "Add Service Reference / Connected Service" workflow for WCF/SOAP clients.

- [x] "Add Service Reference…" on a project or its Connected Services folder: WSDL URL or file, name, namespace
- [x] Generate the client into `Connected Services/<Name>/` (Visual Studio's `ConnectedService.json` and `WCFMetadata` item) and add the current `System.ServiceModel.Http`/`Primitives` packages
- [x] "Update Service Reference" and "Remove Service Reference" on the reference folder, also for references Visual Studio created; updating regenerates for the project's current target framework
- [x] Detect a missing `dotnet-svcutil` and offer to install it for the repository (tool manifest) or globally

**Implementation Notes**:
- Visual Studio's WCF Web Service Reference provider is a UI over `dotnet-svcutil`, which runs on Linux
- `dotnet-svcutil` 8.0.0 needs .NET 9; it runs with `DOTNET_ROLL_FORWARD=Major` on newer runtimes
- Generating runs `dotnet-svcutil --update` on a params file made from `ConnectedService.json` in a temporary folder under `obj/`; svcutil's own package edits (`System.ServiceModel.*` `4.10.*`) are undone

### Phase 5: New Project & New Item Templates
- [x] "Add New Project" wizard on the solution or a solution folder: pick a template (search, categories, recently used first), then name, location (next to the other projects) and the template's own settings (framework preselected from the solution, authentication, HTTPS, controllers, …), Create adds it to the solution (folder)
- [x] "Add New Item" wizard on projects and folders: Class, Interface, Record, Enum, Struct built in; controllers, Razor items, test classes, config files and your own `dotnet new` item templates, with their settings
- [x] Generate namespaces from `RootNamespace` and the folder structure (folder names made valid identifiers, `Connected Services` → `Connected_Services`)
- [x] Rename nested dependent files together with their parent (Form1.cs → Form1.Designer.cs, Form1.resx; Index.cshtml → Index.cshtml.cs)

### Phase 6: Test Integration
**Goal**: Test discovery and execution through the VS Code Test Explorer.

- [x] `vscode.TestController` with project → namespace → class → test (→ parameterized cases) hierarchy, linked to file and line
- [x] Discover Microsoft.Testing.Platform tests (xUnit v3, MSTest runner, TUnit, NUnit runner); run and debug single tests, classes or whole projects; re-discover after builds
- [x] Show results (failure message, stack trace, expected/actual where the framework reports them) and output

**Implementation Notes**:
- Microsoft.Testing.Platform's server mode: the test app (`dotnet <TargetPath> --server --client-port <port>`) connects to the extension and speaks JSON-RPC (`testing/discoverTests`, `testing/runTests`, `testing/testUpdates/tests`), which brings file and line of every test
- Debugging starts the test app in the C# debugger with the same arguments

### Phase 7: Private NuGet Feeds
- [x] Clear message when a private feed rejects its credentials (expired token): where the credentials are (file and line), what to do for popular feeds (Azure DevOps, GitHub, GitLab, JFrog, MyGet), and a way to enter a new token; credentials are found like NuGet finds them and a new token works without restarting

### Phase 7.5: Visual Studio Basics
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

### Phase 8: Nice to Have
- [x] Test Explorer for classic VSTest projects (xUnit v2, NUnit/MSTest with the VSTest adapters)
- [x] Manage user secrets (`dotnet user-secrets`) from the project context menu

### Phase 9: Publish
**Goal**: Visual Studio's Publish page for the Folder target: profiles in `Properties/PublishProfiles/*.pubxml`, compatible with Visual Studio.

- [x] "Publish..." on a project: a Publish tab with the existing profiles, Publish button and summary (location, configuration, framework, deployment mode, runtime), new profile, rename and delete; Folder target with configuration, framework, runtime identifier, self-contained, single file, ReadyToRun

### Phase 10: Visual Studio Basics, Part 2
**Goal**: The larger everyday features of Visual Studio that are still missing.

- [ ] Open and switch solutions: "Open Solution..." and recently opened solutions, like Visual Studio's File > Open > Solution and File > Recent; the Solution Explorer loads the chosen solution instead of the current one. Today the choice comes once, at startup, when the workspace has several solution files
- [x] Convert .sln to .slnx: opening a .sln offers to convert it (`dotnet sln migrate`), then to delete the .sln, and opens the .slnx; "Don't Ask Again" per solution
- [ ] Unload / Reload Project: an unloaded project stays in the tree greyed out as "(unloaded)" and is skipped by solution builds (through a solution filter) until it is reloaded; remembered per workspace, like Visual Studio's per-user setting
- [ ] Pack on class libraries: builds the NuGet package (`dotnet pack`) for the active configuration with the project's package metadata (PackageId, Version, Authors, ...) and shows where the `.nupkg` went
- [ ] Configuration Manager: solution configurations and platforms (Debug/Release, Any CPU/x64) to add, rename and remove; which configuration and platform each project builds in and whether it builds at all; written to the .sln/.slnx; the platform picked next to Debug/Release

### Phase 11: Code Cleanup & Refactoring
**Goal**: Visual Studio's project-wide fixes and the refactorings you reach for daily. Fixes at a spot in the code (Ctrl+.) come from the C# extension's Roslyn server and aren't duplicated.

- [ ] Code Cleanup on the solution, a project, folder or file: fix all errors, warnings and/or infos, format, remove and sort usings (`dotnet format`)
- [ ] Fix all occurrences of a diagnostic (e.g. IDE0090) in the project or solution, from the Error List
- [ ] Sync Namespaces on a project or folder: every namespace matches its folder, as in Visual Studio
- [ ] Check which refactorings the C# extension covers in VS Code (Extract Interface, Move Type to File, Change Signature, Fix All in document/project/solution) and fill the gaps, e.g. Visual Studio's dialogs for Extract Interface and Change Signature

### Phase 12: Run & Debug, Part 2
- [ ] Multiple startup projects (e.g. API plus worker or frontend), each with its own launch profile, like Visual Studio's "Configure Startup Projects"
- [ ] Hot Reload (`dotnet watch`)
- [ ] HTTPS development certificate: detect an untrusted one and help trust it (`dotnet dev-certs https --trust`, fiddly on Linux)
- [ ] Attach to Process: pick a running .NET process (by name, project or port) and attach the C# debugger, like Visual Studio's Debug > Attach to Process

### Phase 13: Solution Explorer, Part 2
- [ ] Search in the Solution Explorer (Visual Studio's Ctrl+;)
- [ ] The tree follows the project's items like Visual Studio: `<Compile Remove>` / `DefaultItemExcludes` hide files, linked files (`Include="..\x.cs" Link="x.cs"`) appear; "Show All Files" shows the excluded ones greyed out
- [ ] Exclude From Project / Include In Project on files and folders (writes or removes the `Remove`/`Include` items)
- [ ] Drag & drop of files, folders and projects
- [ ] The diagnostic rules of each analyzer under Dependencies > Analyzers, like Visual Studio
- [ ] Project Properties: target framework, nullable, implicit usings, version and the like as a form instead of editing the project file
- [ ] Launch Profiles editor: Visual Studio's "Launch Profiles" dialog (Project Properties > Debug), a form for the profiles of `launchSettings.json` (command line arguments, environment variables, URLs, browser) instead of editing the JSON

### Phase 14: NuGet, Part 2
- [ ] Central Package Management (`Directory.Packages.props`): install, update and consolidate put versions where they belong

### Phase 15: Connected Services, Part 2
- [ ] OpenAPI (REST) clients: Visual Studio's "Add Connected Service > OpenAPI" (NSwag / `dotnet-openapi`)
- [ ] gRPC clients from `.proto` files (Visual Studio's "Add Connected Service > gRPC")

### Phase 20: Later
- [ ] Solution filters (`.slnf`): load part of a big solution
- [ ] EF Core migrations from the context menu (Add Migration, Update Database), Visual Studio's Package Manager Console commands
- [ ] Scaffolding ("New Scaffolded Item": controllers with EF, Identity), a wizard like Add New Item
- [ ] Docker / docker-compose launch profiles
- [ ] Encrypted NuGet credentials (`Password` is Windows DPAPI; on Linux the Azure Artifacts Credential Provider covers restore and build, and the NuGet manager explains rejected tokens)
- [ ] Remote debugging on devices over SSH: build, deploy and F5 on the device (`pipeTransport` launch configurations); not a Visual Studio feature for .NET (Visual Studio only attaches to running processes over SSH)
- [ ] Code coverage in the Test Explorer (Microsoft.Testing.Platform's coverage extension, lines marked in the editor), only if it stays fast: Visual Studio's coverage slows the IDE down so much that teams run coverage from a script (`dotnet test --collect`, ReportGenerator) instead, which remains the better way otherwise
- [ ] NuGet manager marks vulnerable packages (severity, advisory link) and deprecated ones (with the suggested replacement), with filters for them, like Visual Studio; restore already warns about vulnerable packages (NuGet Audit) in the Error List
- [ ] NuGet package sources like Visual Studio: a package source picker for Browse, a page to add, remove and enable feeds, and Package Source Mapping (shown in the package details, offered when installing, respected by Browse; restore already follows a mapping in `NuGet.Config`)
- [ ] No C# extension needed: bundle our own debugger ([netcoredbg](https://github.com/Samsung/netcoredbg), MIT, prebuilt releases for Linux, Windows and macOS) and run the Roslyn and Razor language servers ourselves, with completion, diagnostics, navigation, code actions and formatting wired to the editor. The debugger alone is a contained job but gains little while the language server still comes from the C# extension

### Phase 21: Publish, Part 2
**Goal**: The other publish targets of Visual Studio, with the `.pubxml` format Visual Studio writes for each (to be gathered from Visual Studio-made profiles first).

- [ ] Azure App Service target (ZIP deploy through the Azure CLI, no stored password)
- [ ] Container registry target (the SDK's container publish, credentials from `docker login` / `az acr login`)
- [ ] FTP/FTPS target (upload after a folder publish, password in VS Code's secret storage)
- [ ] IIS Web Deploy, only on Windows where `msdeploy` exists

### Not Planned
- .NET Framework 4.x / Mono build and debug support
- `packages.config` and old-style project files
- Code navigation features that the C# extension already provides (Go to Definition, Find References, symbol search)
- Diagnostic Tools / profiler UI (the `dotnet-trace`, `dotnet-counters` and `dotnet-gcdump` CLI tools cover it)
- A `.resx` resource editor
- Task List (`// TODO` comments)
- Visual Studio's Git integration (also git status in the Solution Explorer): VS Code's Source Control view and Explorer cover it

## Installation

### Prerequisites
- VS Code 1.74.0 or higher (or VSCodium / another Open VSX editor)
- .NET SDK 8.0 or higher (.slnx solutions need 9.0.200 or higher)
- A C# extension, for debugging and namespace updates: [C#](https://marketplace.visualstudio.com/items?itemName=ms-dotnettools.csharp) (`ms-dotnettools.csharp`) in VS Code, or [the open source fork](https://open-vsx.org/extension/muhammad-sammy/csharp) (`muhammad-sammy.csharp`) in VSCodium and other Open VSX editors. C# Dev Kit is not required.
- With `muhammad-sammy.csharp`, this extension switches the default language server from OmniSharp, which is in maintenance mode and cannot load .slnx, to the Roslyn language server that ships with it (`"dotnet.server.useOmnisharp": false`). If you set `true` yourself, the extension offers to switch back for .slnx solutions.

### Build from Source
```bash
npm install
npm run build
```

## Project Structure
```
src/
├── extension.ts            # Entry point
├── core/                   # Solution & Project models, context menu definitions
├── handlers/               # .sln / .slnx file handlers
├── parsers/                # .sln, .slnx and project file parsers/editors
├── services/               # Solution tree, actions, build tasks, debug config, diagnostics
│   ├── nuget/              # NuGet feeds, credentials, package operations
│   ├── serviceReferences/  # Connected Services (dotnet-svcutil)
│   ├── templates/          # dotnet new templates, Add New Project / Item
│   └── testing/            # Test Explorer (Microsoft.Testing.Platform)
├── types/                  # Webview ⇄ extension message types
└── webview/                # React UIs (Solution Explorer, NuGet manager, Error List, template wizard) and their providers
```

## License

[MIT](LICENCE.md)
