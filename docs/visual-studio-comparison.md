# Visual Studio comparison

What this extension does compared with Visual Studio 2022, feature by feature: what is supported, what works differently, what is not planned (and why), and what is still to come. The goal is the daily work of a team that builds modern .NET (SDK-style projects, web apps, libraries, tests, NuGet feeds) without Windows or Visual Studio; Visual Studio features that VS Code or the C# extension already cover are not rebuilt here.

**Status:** ✅ supported · ≈ works differently (see the note) · ➖ the editor or the C# extension does it · ❌ not planned (a GitHub issue changes that where it says so) · 🔜 planned

## Solution and projects

| Visual Studio | Here | |
|---|---|---|
| Solution Explorer with `.sln` and `.slnx` | The same tree for both formats; edits keep the file's formatting. Offers to convert `.sln` to `.slnx` | ✅ |
| Solution folders and solution items | Add, rename, remove, move by drag and drop | ✅ |
| Add New Project / New Item | Wizards over `dotnet new`: templates, options, your own item templates; the SDK `global.json` picks is used | ✅ |
| Add Existing Project / Item, Add Project Reference, Add Assembly Reference | All three, with a circle check for project references; drop a project onto Dependencies to reference it | ✅ |
| Dependencies node (Packages, Projects, Assemblies, Analyzers, Frameworks) | The same, with transitive packages expanding level by level and the source generators' output | ✅ |
| Files follow the project's items, Show All Files, Exclude From Project | From MSBuild's evaluation; linked files with a badge. SDK-style projects only | ✅ |
| Nested files (`Index.cshtml` › `.cs`), file icon themes | Visual Studio's nesting rules (Off / Default / Web); your VS Code file icon theme | ✅ |
| Unload / Reload Project | Remembered per workspace; the solution builds without it | ✅ |
| Multiple startup projects, launch profiles | Set as Startup Project, profile choice, `.slnLaunch` profiles shared with Visual Studio. The choice lives in `.vscode/` | ≈ |
| Configuration Manager | Configurations, platforms and each project's mapping, written to `.sln` and `.slnx` | ✅ |
| Sync with Active Document, Collapse All | Both, in the toolbar and on keys | ✅ |
| Search in Solution Explorer (Ctrl+;) | Ctrl+P and Sync with Active Document cover it | ➖ |
| Project Properties pages | Edit Project File; the project file's own schema help | ❌ |
| Launch Profiles editor | Open Launch Settings creates `launchSettings.json` (JSON schema for the profiles) | ❌ |
| Properties window with Build Action and Copy to Output Directory per file | Not offered: Edit Project File, or Exclude / Include From Project for the common case | ❌ |
| Solution filters (`.slnf`) | Not opened; Unload Project covers the use (the extension writes a filter itself to build without unloaded projects) | ❌ |
| Old-style (non-SDK) projects, `packages.config`, ASP.NET on IIS Express | SDK-style `net4x` projects load, build and run with Mono; the old format is not supported | ❌ |
| Manage User Secrets | Opens `secrets.json` in your profile, adds a `UserSecretsId` first | ✅ |
| Pack, Publish | Pack on libraries; Publish with Folder profiles (see below) | ✅ |

## Build, run and debug

| Visual Studio | Here | |
|---|---|---|
| Build, Rebuild, Clean, Ctrl+Shift+B | The same, from the tree, the toolbar and the keys; unloaded projects left out | ✅ |
| Error List | A sortable, filterable table; the Solution Explorer marks files, folders and projects. Errors come from the last build, plus live errors for open files from the language server | ≈ |
| F5 / Ctrl+F5, Start New Instance | The same, through VS Code's Run and Debug with a `Startup` configuration | ✅ |
| Debugger (breakpoints, Watch, Call Stack, exception settings) | VS Code's Run and Debug view with the C# extension's debugger; the Immediate window is the Debug Console | ➖ |
| Hot Reload | Start with Hot Reload runs `dotnet watch` without the debugger; with the debugger attached it is not possible with netcoredbg | ≈ |
| Edit and Continue | Not available with netcoredbg | ❌ |
| Diagnostic Tools, profiler | The `dotnet-trace`, `dotnet-counters` and `dotnet-gcdump` tools | ❌ |
| Attach to Process | A picker of the running .NET programs | ✅ |
| .NET Framework projects | SDK-style `net48` projects build, run and debug with Mono on Linux and macOS; WinForms and WPF designers need Windows | ≈ |
| HTTPS development certificate prompt | Offers to trust it when an `https://` profile starts | ✅ |
| Publish: Folder, Azure App Service, container registry, FTP, IIS Web Deploy | Folder profiles shared with Visual Studio; the other profiles are listed and publish from Visual Studio | ≈ |
| Remote debugging over SSH | Not a Visual Studio feature for .NET either (it attaches over SSH) | ❌ |
| Docker launch profiles | Written by hand | ❌ |

## NuGet

| Visual Studio | Here | |
|---|---|---|
| Browse, Installed, Updates, Consolidate | All four, for a project or for the solution; Install, Update and Uninstall for several projects at once | ✅ |
| Transitive packages | A collapsible section with what brings each in; Install on one pins it | ✅ |
| Central Package Management | `Directory.Packages.props` edited in place: `PackageVersion`, `VersionOverride`, `GlobalPackageReference` (with opt-outs), versions written as properties, imported props files; Set for This Project Only; a confirmation before a change reaches other projects. Pinned transitive packages (`CentralPackageTransitivePinningEnabled`) get no update offer | ✅ |
| Vulnerable and deprecated packages | Labels with severity and advisory links, the replacement for a deprecated one, filters in Installed | ✅ |
| Package source dropdown | All or one source, plus Refresh | ✅ |
| Package Sources options page, Package Source Mapping | Opt-in (`shinobi.nuget.packageSources`): a Sources tab; mapping shown in the details and respected by Browse | ✅ |
| Private feeds | The `NuGet.Config` files NuGet reads, tokens as `ClearTextPassword` (a token prompt when a feed rejects), the Azure Artifacts Credential Provider; DPAPI-encrypted passwords cannot be read outside Windows | ≈ |
| Local folders as sources | Used by restore; not browsed in the manager | ≈ |
| Package Manager Console | The `dotnet` CLI in the terminal | ❌ |
| Projects that target several frameworks, with different packages each | Only the first framework is evaluated | 🔜 |
| `packages.config` | Not supported | ❌ |

## Tests

| Visual Studio | Here | |
|---|---|---|
| Test Explorer | VS Code's Testing view for xUnit, NUnit, MSTest and TUnit on Microsoft.Testing.Platform and VSTest; run and debug from the gutter and from the tree | ≈ |
| Run settings (`.runsettings`) | Used when MSBuild names the file (`RunSettingsFilePath`), with its environment variables and, for VSTest, parallelism; see [Tests](tests.md#run-settings) | ✅ |
| Code coverage | Teams run it from a script (`dotnet test --collect`, ReportGenerator): an IDE's coverage is slow | ❌ |
| One build for the whole selection | One build per test project | ≈ |

## Editing and refactoring

| Visual Studio | Here | |
|---|---|---|
| IntelliSense, live errors, Go to Definition, Find References, refactorings | The C# extension's Roslyn server | ➖ |
| Code Cleanup | `dotnet format` with `.editorconfig`; no Visual Studio cleanup profiles, no sorting of usings | ≈ |
| Sync Namespaces | Changes namespaces to match the folders and updates references | ✅ |
| Change Signature, Move to namespace, Pull members up, Extract Interface dialog | Not offered by the Roslyn server | ❌ |
| Task List (`// TODO`) | VS Code's extensions for TODO comments | ❌ |
| `.resx` editor | Not offered | ❌ |
| Git | VS Code's Source Control view | ➖ |
| `.http` files | An extension such as REST Client | ➖ |

## Connected services and data

| Visual Studio | Here | |
|---|---|---|
| Connected Services: WCF Web Service | Add, Update and Remove a service reference with `dotnet-svcutil`, files in `Connected Services/` | ✅ |
| Connected Services: gRPC | `.proto` file or URL as a `<Protobuf>` item with the gRPC packages; Update and Remove | ✅ |
| Configure Service Reference dialog | Update regenerates from the stored address; edit `ConnectedService.json` | ❌ |
| OpenAPI client | Microsoft deprecated `dotnet openapi` in .NET 10: use NSwag or Kiota | ❌ |
| Entity Framework migrations (Package Manager Console) | Add Migration, Update Database, Remove Last Migration in the project's menu, over `dotnet ef` | ✅ |
| Scaffolding ("New Scaffolded Item") | Not offered | ❌ |
| SQL Server Object Explorer | Microsoft's SQL Server extension in VS Code | ➖ |

## Planned, and what changes it

- **Planned:** per-framework packages for multi-targeted projects ([the roadmap](roadmap.md#phase-35-per-framework-packages)), only if the team's real project files need it.
- **To be built when someone opens an issue:** Solution Explorer search, solution filters, the Configure Service Reference dialog, scaffolding, Docker profiles, Windows-encrypted NuGet credentials, refactorings the Roslyn server lacks, accessibility of the views.
- **Not possible today:** Edit and Continue and Hot Reload with the debugger attached (netcoredbg); running Windows-only workloads (WinForms and WPF designers, IIS Web Deploy) off Windows.

## How the pieces fit together

What works differently from Visual Studio, and why:

- **Two extensions, not one IDE.** This extension is the Visual Studio layer: Solution Explorer, NuGet, Error List, Test Explorer, wizards, publish. Editing C# (IntelliSense, live errors, navigation, refactorings, Razor) and the debugger come from a C# extension: Microsoft's `ms-dotnettools.csharp`, or `muhammad-sammy.csharp` in VSCodium and other Open VSX editors. Some of its own features overlap with this extension; where it allows, this extension switches them off (see [Settings](settings.md)).
- **The startup project lives in `.vscode/`.** Visual Studio keeps the startup project and launch profile in `.vs/` per user. Here "Set as Startup Project" writes a `Startup` configuration to `.vscode/launch.json` and a `StartupPreBuild` task to `.vscode/tasks.json`. Commit them to give the team a default, or add them to `.gitignore` to keep the choice personal. F5 runs whatever configuration is selected in VS Code's Run and Debug view, `Startup` by default.
- **Run and Debug is VS Code's.** Variables, Watch, Call Stack and Breakpoints (including exception breakpoints) are VS Code's Run and Debug view; Visual Studio's Immediate window is the Debug Console. Diagnostic Tools and Edit and Continue aren't there. Hot Reload is **Start with Hot Reload** (`dotnet watch`, without the debugger); see [Run & Debug](run-and-debug.md).
- **Errors are reliable after a build.** As in Visual Studio, the Error List and the markers in the Solution Explorer come from the last build; the C# language server adds live errors for open files only, unless you set `"dotnet.backgroundAnalysis.compilerDiagnosticsScope": "fullSolution"`.
- **Generated code is from the last build.** Dependencies > Analyzers shows what the source generators wrote in the last build started by this extension, not live like Visual Studio. A project that was up to date before needs one Rebuild.
- **Tests run in VS Code's Testing view.** Microsoft.Testing.Platform and VSTest projects show there, with icons in the editor gutter. Use them (or Run Tests / Debug Tests in the Solution Explorer, see [Tests](tests.md)); the C# extension's "Run/Debug Tests in Context" menu items go through VSTest and fail for Microsoft.Testing.Platform projects without `Microsoft.NET.Test.Sdk`.
- **No Windows-only credentials.** Visual Studio encrypts NuGet passwords and publish passwords with Windows DPAPI, which nothing outside Windows can read. Store NuGet tokens as `ClearTextPassword` (the NuGet manager's "Enter New Token..." does that) or use the Azure Artifacts Credential Provider.
- **Publish is Folder only for now.** Profiles in `Properties/PublishProfiles/` are shared with Visual Studio; Azure, container registry, FTP and IIS profiles are listed but publish from Visual Studio.
- **The tree follows the project's items.** Files a `<Compile Remove>` or `DefaultItemExcludes` leaves out are hidden, and linked files from other folders appear with a link badge. Show All Files greys the excluded ones out, and Exclude From Project writes the `Remove` items and Include In Project deletes them (or adds `Include` items with the item type for files the defaults leave out), like Visual Studio; see [Show All Files and linked files](solution-explorer.md#show-all-files-and-linked-files). Old-style projects (non-SDK) have no Exclude / Include entries.
- **Keyboard shortcuts are VS Code's**, except for the ones this extension adds like Visual Studio's: F2 rename, Delete, Ctrl+C/X/V in the tree, Ctrl+Shift+B build, Ctrl+F5 run without debugging, Ctrl+[, S sync with the active document, Ctrl+K, Ctrl+E and Ctrl+Alt+L. Debugging and navigation keys are mostly the same; [Keyboard shortcuts](keyboard-shortcuts.md) lists where Visual Studio's keys differ.
- **Sync Namespaces** on a project or folder changes the namespaces to match the folders and updates the references, through the C# language server; it needs IDE0130 reporting in `.editorconfig`; see [Sync Namespaces](sync-namespaces.md).
- **Code Cleanup** formats, removes unused usings and applies `.editorconfig` fixes like Visual Studio's, from the tree and with Ctrl+K, Ctrl+E, but reads no Visual Studio cleanup profiles and does not sort usings; see [Code Cleanup](code-cleanup.md).
- **`.http` files and `.editorconfig`.** Visual Studio sends the requests in `.http` files (the Web API template makes one); in VS Code that needs an extension such as REST Client (`humao.rest-client`). The C# extension applies `.editorconfig` to C# code; for other files VS Code needs the EditorConfig extension.
- **Databases.** Visual Studio's SQL Server Object Explorer isn't part of this extension. In VS Code, Microsoft's SQL Server (mssql) extension (`ms-mssql.mssql`) connects to SQL Server and Azure SQL and runs queries; in VSCodium, look for a database client on Open VSX. Entity Framework migrations run with `dotnet ef` in the terminal.
- **Attach to Process** is a picker (**.NET: Attach to Process...**, palette and the title bar's `...` menu) that lists the running .NET programs; the launch configuration is the fallback. See [Run & Debug](run-and-debug.md#attach-to-process).
- **Not on Linux and macOS at all:** running .NET Framework projects natively (SDK-style ones that target `net48` load and build, and run and debug with Mono, see [Run & Debug](run-and-debug.md#net-framework-projects-on-linux-and-macos)), WinForms and WPF designers, IIS Web Deploy, and anything else that needs Windows.
