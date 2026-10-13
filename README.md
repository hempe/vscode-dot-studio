<img src="icon.png" width="96" align="right" alt="Shinobi">

# Shinobi .NET for VS Code

A Visual Studio–style Solution Explorer, NuGet package manager and project tooling for .NET in VS Code. The goal is to replace Visual Studio (and Windows) for day-to-day work on modern .NET: ASP.NET web apps, device-bridge services that talk to local hardware and the cloud, and SOAP service clients. It aims for parity with Visual Studio on the basics, not on everything.

**Out of scope:** .NET Framework 4.x and old-style (non-SDK) projects. Legacy code is only read for reference when porting, and any plain text editor is fine for that.

## Current Features

### Solution Explorer
- Hierarchical solution (.sln and .slnx) and project tree
- Solution folders and solution items (add, remove, rename)
- Visual Studio–style file nesting
- File and folder icons from your file icon theme (`workbench.iconTheme`: Seti, Material Icon Theme, vscode-icons, …), with built-in icons for dependency nodes, and for solution and project nodes unless the theme has icons for `.sln`/`.slnx`/`.csproj`…
- Dependencies node (PackageReference, ProjectReference, framework and assembly references)
- Startup project selection, offered only on projects that can be started (console, desktop, web, worker and Aspire host projects; not libraries or test projects)
- Live updates through file watchers
- Native VS Code context menus with keyboard shortcuts (F2 rename, Delete, Ctrl+C/X/V)
- Errors in the tree: files with errors or warnings get a red or yellow squiggly underline and a count; folders, projects, solution folders and the solution show a dot when anything below them has problems. Build markers are reliable after a (re)build, as in Visual Studio. Live language-server errors for open files come on top; for live errors in all files set `"dotnet.backgroundAnalysis.compilerDiagnosticsScope": "fullSolution"`. Infos and suggestions (the editor's `···` hints, Visual Studio's "Messages") are hidden unless `shinobi.solutionExplorer.diagnostics.showInfos` is on

### Error List
- Visual Studio–style Error List in the panel: errors, warnings and messages (infos and suggestions, which the Problems panel never shows), grouped by project and file, deduplicated across build output and the language server
- Toggle each severity from the view's title bar; click an entry to jump to its file and line; the tab badge shows the error count

### Solution & Project Operations
- Build, Rebuild, Clean and Restore for solutions and projects, run as `shinobi-dotnet` tasks with the `$msCompile` problem matcher: errors land in the Problems panel and link to file and line. Run Build Task (Ctrl+Shift+B) offers them; the solution build is marked as the default unless your `tasks.json` defines one
- Add New Project wizard with the template's settings (any `dotnet new` template), add existing projects (also into solution folders); remove or delete projects
- Add and remove project and assembly references

### Run & Debug (F5)
- "Set as Startup Project" generates a `Startup` debug configuration in `launch.json` and a `StartupPreBuild` task in `tasks.json`, keeping your other configurations and comments
- Launch profiles from `Properties/launchSettings.json`: picked when you set the startup project, changed later with "Set Launch Profile..." on it; the profile's URLs, environment variables and arguments apply, and the browser opens at `launchUrl` once the app listens
- Debug/Release switch in the Solution Explorer title bar for builds and F5, with the solution's own configurations; the active configuration and framework show next to the view title
- Target framework selection for multi-targeted startup projects
- The program path comes from MSBuild, so `OutputPath`, `AssemblyName` and the artifacts layout work
- Edits to `launchSettings.json` are picked up; a removed or renamed profile falls back to another

### File Operations
- Add files and folders with inline naming
- Add New Item wizard: built-in C# types with the folder's namespace, or any `dotnet new` item template with its settings
- Copy, cut, paste, rename and delete
- Namespace updates when files move or are renamed (uses `RootNamespace` and the folder structure)
- Renaming a C#/VB file offers to rename the type of the same name and all references to it (needs the C# language server running); files nested under it (Designer, code-behind, resources) are renamed with it
- Reveal in file explorer

### Connected Services (SOAP)
- "Add Service Reference…" on a project: from a WSDL URL or file, generated with `dotnet-svcutil` into `Connected Services/<Name>/`, with the WCF client packages
- "Update Service Reference" and "Remove Service Reference" on the reference folder; references created in Visual Studio (`ConnectedService.json`) work both ways, and options such as `messageContract` are edited there as in Visual Studio
- Offers to install `dotnet-svcutil` for the repository (tool manifest, same version for the team) or globally

### Tests
- Test Explorer for Microsoft.Testing.Platform test projects (xUnit v3, MSTest runner, TUnit, NUnit runner): tests grouped by project, namespace and class, with gutter icons in the editor
- Run and debug single tests, classes or projects; results with failure messages and stack traces
- Tests are discovered after builds (Ctrl+Shift+B, the context menu, F5) and with the refresh button, which builds first
- The C# extension's own "Run Test | Debug Test" code lenses stay; turn them off with `"dotnet.codeLens.enableTestsCodeLens": false` if the gutter icons are enough

### NuGet Package Manager
- Browse and search packages, install to multiple projects, update and consolidate
- Private feeds (e.g. Azure DevOps) via `ClearTextPassword` credentials in `NuGet.Config`
- Package details, versions, dependencies and README

## Known Issues
- [ ] Encrypted NuGet feed passwords (`Password` instead of `ClearTextPassword`) are not supported
- [ ] Building a single project does not clear stale build errors that an earlier solution build reported for other projects
- [ ] Files a project links from outside its own directory are not rolled up into the project's marker
- [ ] Updating a reference Visual Studio created changes the generator version in every type of `Reference.cs` (svcutil 8.0.0 instead of Visual Studio's 2.0.2)
- [ ] svcutil cannot read .NET Framework assembly references (`<Reference Include="System.ServiceModel" />`); remove them when porting before updating a reference

## Roadmap

Ordered by what is needed to drop Visual Studio for daily work. Phases 1–4 cover web apps and SOAP clients; phases 5–8 are conveniences for which the `dotnet` CLI already works in the meantime.

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
- [x] Toggle errors, warnings and messages; click an entry to jump to its file and line
- [x] Error count badge on the view

**Implementation Notes**:
- Source is `vscode.languages.getDiagnostics()` / `onDidChangeDiagnostics`, which merges `$msCompile` build output and the C# language server; this depends on the Phase 2 build tasks
- Aggregate per file path in the extension host and send counts per node to the webview; the webview only renders them

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
- [ ] Test Phase 4 (service references) in VS Code with the `SoapClient` project in ApiDotNetTestProject: add from `wsdl/CardOperations.wsdl`, update, remove, and update a reference Visual Studio created
- [ ] Test Phase 5 (template wizards) in VS Code with ApiDotNetTestProject: Add New Project on the solution and on a solution folder (settings, framework, location), Add New Item on a folder (built-in class, API Controller with read/write actions, a config file), rename a file with nested files

**Implementation Notes**:
- Microsoft.Testing.Platform's server mode: the test app (`dotnet <TargetPath> --server --client-port <port>`) connects to the extension and speaks JSON-RPC (`testing/discoverTests`, `testing/runTests`, `testing/testUpdates/tests`), which brings file and line of every test
- Debugging starts the test app in the C# debugger with the same arguments

### Phase 7: Device & Deployment
- [ ] Remote debugging on devices over SSH (`pipeTransport` launch configurations)
- [ ] Publish (`dotnet publish`) with runtime identifier and self-contained options
- [ ] Encrypted NuGet credentials

### Phase 8: Nice to Have
- [ ] Test Explorer for classic VSTest projects (xUnit v2, NUnit/MSTest with the VSTest adapters)
- [ ] Manage user secrets (`dotnet user-secrets`) from the project context menu

### Not Planned
- .NET Framework 4.x / Mono build and debug support
- `packages.config` and old-style project files
- Code navigation features that the C# extension already provides (Go to Definition, Find References, symbol search)

## Installation

### Prerequisites
- VS Code 1.74.0 or higher
- .NET SDK 6.0 or higher
- A C# extension, for debugging and namespace updates: [C#](https://marketplace.visualstudio.com/items?itemName=ms-dotnettools.csharp) (`ms-dotnettools.csharp`) in VS Code, or [the open source fork](https://open-vsx.org/extension/muhammad-sammy/csharp) (`muhammad-sammy.csharp`) in VSCodium and other Open VSX editors. C# Dev Kit is not required.
- With `muhammad-sammy.csharp` and .slnx solutions, use the Roslyn language server (`"dotnet.server.useOmnisharp": false`); its default, OmniSharp, cannot load .slnx. The extension offers to switch.

### Build from Source
```bash
npm install
npm run build
```

## Project Structure
```
src/
├── extension.ts      # Entry point
├── core/             # Solution & Project models, context menu definitions
├── handlers/         # .sln / .slnx file handlers
├── parsers/          # .sln, .slnx and project file parsers/editors
├── services/         # Solution tree, actions, debug config, NuGet
├── types/            # Webview ⇄ extension message types
└── webview/          # React UI (Solution Explorer, NuGet manager) and providers
```

## License

[MIT](LICENCE.md)
