<img src="icon.png" width="96" align="right" alt="Shinobi">

# Shinobi .NET for VS Code

A Visual Studio–style Solution Explorer, NuGet package manager and project tooling for .NET in VS Code. The goal is to replace Visual Studio (and Windows) for day-to-day work on modern .NET: ASP.NET web apps, device-bridge services that talk to local hardware and the cloud, and SOAP service clients. It aims for parity with Visual Studio on the basics, not on everything.

**Out of scope:** .NET Framework 4.x and old-style (non-SDK) projects. Legacy code is only read for reference when porting, and any plain text editor is fine for that.

## Current Features

### Solution Explorer
- Hierarchical solution (.sln and .slnx) and project tree
- Solution folders and solution items (add, remove, rename)
- Visual Studio–style file nesting
- Dependencies node (PackageReference, ProjectReference, framework and assembly references)
- Startup project selection
- Live updates through file watchers
- Native VS Code context menus with keyboard shortcuts (F2 rename, Delete, Ctrl+C/X/V)
- Errors in the tree: files with errors or warnings get a red or yellow squiggly underline and a count; folders, projects, solution folders and the solution show a dot when anything below them has problems. Build markers are reliable after a (re)build, as in Visual Studio. Live language-server errors for open files come on top; for live errors in all files set `"dotnet.backgroundAnalysis.compilerDiagnosticsScope": "fullSolution"`. Infos and suggestions (the editor's `···` hints, Visual Studio's "Messages") are hidden unless `shinobi.solutionExplorer.diagnostics.showInfos` is on

### Solution & Project Operations
- Build, Rebuild, Clean and Restore for solutions and projects, run as `shinobi-dotnet` tasks with the `$msCompile` problem matcher: errors land in the Problems panel and link to file and line. Run Build Task (Ctrl+Shift+B) offers them; the solution build is marked as the default unless your `tasks.json` defines one
- Add existing projects; remove or delete projects
- Add and remove project and assembly references
- Target framework selection for the startup project; generates a `Startup` debug configuration in `launch.json`

### File Operations
- Add files and folders with inline naming
- Copy, cut, paste, rename and delete
- Namespace updates when files move or are renamed (uses `RootNamespace` and the folder structure)
- Renaming a C#/VB file offers to rename the type of the same name and all references to it (needs the C# language server running)
- Reveal in file explorer

### NuGet Package Manager
- Browse and search packages, install to multiple projects, update and consolidate
- Private feeds (e.g. Azure DevOps) via `ClearTextPassword` credentials in `NuGet.Config`
- Package details, versions, dependencies and README

## Known Issues
- [ ] "Add New Project" is a stub
- [ ] Encrypted NuGet feed passwords (`Password` instead of `ClearTextPassword`) are not supported
- [ ] Building a single project does not clear stale build errors that an earlier solution build reported for other projects
- [ ] Files a project links from outside its own directory are not rolled up into the project's marker

## Roadmap

Ordered by what is needed to drop Visual Studio for daily work. Phases 1–4 cover web apps and SOAP clients; phases 5–7 are conveniences for which the `dotnet` CLI already works in the meantime.

### Phase 1: Stabilize
- [x] Fix the failing tests and the file nesting duplication
- [x] Reject .slnx files that `dotnet` rejects (folder names without `/`, duplicates, missing paths) and show the reason instead of an empty tree
- [x] Parse `launch.json` / `tasks.json` as JSONC and edit them without dropping other configurations or comments
- [x] Warn when the solution is .slnx but `muhammad-sammy.csharp` runs OmniSharp (its default), which cannot load .slnx; offer to set `"dotnet.server.useOmnisharp": false` (Roslyn language server)
- [ ] Keep this README in line with the actual features

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
- [ ] Native "Error List" view in the panel: errors, warnings and messages (infos and suggestions), grouped by project and file
- [ ] Toggle errors, warnings and messages; click an entry to jump to its file and line
- [ ] Error count badge on the view

**Implementation Notes**:
- Source is `vscode.languages.getDiagnostics()` / `onDidChangeDiagnostics`, which merges `$msCompile` build output and the C# language server; this depends on the Phase 2 build tasks
- Aggregate per file path in the extension host and send counts per node to the webview; the webview only renders them

### Phase 3: Run & Debug Web Apps (F5)
**Goal**: F5 on an ASP.NET project behaves like Visual Studio.

- [ ] Use the selected `launchSettings.json` profile: `applicationUrl`, `environmentVariables`, `commandLineArgs`
- [ ] Open the browser when the app is ready (`serverReadyAction`, driven by `launchBrowser`)
- [ ] Choose the launch profile (like Visual Studio's run dropdown)
- [ ] Resolve the output path through MSBuild instead of hardcoding `bin/Debug/<tfm>/` (respects Release, `OutputPath`, artifacts layout)
- [ ] Manage user secrets (`dotnet user-secrets`) from the project context menu

### Phase 4: Connected Services (SOAP)
**Goal**: The "Add Service Reference / Connected Service" workflow for WCF/SOAP clients.

- [ ] "Add Service Reference…" on a project: WSDL URL or file, namespace, service name
- [ ] Generate the client into `Connected Services/<Name>/` and add the `System.ServiceModel.*` packages
- [ ] "Update Service Reference" and "Remove" on the generated node
- [ ] Detect a missing `dotnet-svcutil` and offer to install it

**Implementation Notes**:
- Visual Studio's WCF Web Service Reference provider is a UI over `dotnet-svcutil`, which runs on Linux
- `dotnet-svcutil` writes `dotnet-svcutil.params.json`; updating re-runs it with `--update`

### Phase 5: New Project & New Item Templates
- [ ] "Add New Project": pick a template from `dotnet new list`, name and location, then add it to the solution
- [ ] "Add New Item": class, interface, enum, record, controller, Razor page/component, test class, config files
- [ ] Generate namespaces from `RootNamespace` and the folder structure (reuse `namespaceService`)
- [ ] Rename nested dependent files together with their parent (Form1.cs → Form1.Designer.cs, Form1.resx)

### Phase 6: Test Integration
**Goal**: Test discovery and execution through the VS Code Test Explorer.

- [ ] `vscode.TestController` with solution → project → namespace → class → test hierarchy
- [ ] Discover MSTest, xUnit and NUnit tests; run and debug single tests or whole projects
- [ ] Show results and output

**Implementation Notes**:
- Discovery via `dotnet test --list-tests`, execution via `dotnet test --filter`, results from TRX

### Phase 7: Device & Deployment
- [ ] Remote debugging on devices over SSH (`pipeTransport` launch configurations)
- [ ] Publish (`dotnet publish`) with runtime identifier and self-contained options
- [ ] Encrypted NuGet credentials

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
