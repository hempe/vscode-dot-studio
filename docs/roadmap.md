# Roadmap

Ordered by what is needed to drop Visual Studio for daily work. Phases 1–15 are done (see [History](history.md)): web apps, SOAP clients, templates, tests, private feeds, the Visual Studio basics, publishing, and readiness for others. Phase 16 is the second round of Visual Studio basics (solutions, projects, configurations), phase 17 code cleanup and refactoring, phases 18–21 the second round for run & debug, the Solution Explorer, NuGet and connected services, phase 30 what may come later, phase 31 the other publish targets.

What still needs a check in VS Code itself is listed in [manual-testing.md](manual-testing.md).

## Known bugs

Found along the way, to be fixed:
- [ ] NuGet manager: installed packages show "by Unknown" instead of their authors
- [ ] Solution Explorer: names wider than the view are cut off without an ellipsis or a tooltip (long package names under Dependencies)

## Known limitations

- [ ] Encrypted NuGet feed passwords (`Password`, Windows DPAPI) can't be used; store a `ClearTextPassword` (the NuGet manager's "Enter New Token..." does that) or use the Azure Artifacts Credential Provider, which covers restore and build
- [ ] Building a single project does not clear stale build errors that an earlier solution build reported for other projects
- [ ] Files a project links from outside its own directory are not rolled up into the project's marker
- [ ] Updating a reference Visual Studio created changes the generator version in every type of `Reference.cs` (svcutil 8.0.0 instead of Visual Studio's 2.0.2)
- [ ] svcutil cannot read .NET Framework assembly references (`<Reference Include="System.ServiceModel" />`); remove them when porting before updating a reference

## Phase 16: Visual Studio Basics, Part 2
**Goal**: The larger everyday features of Visual Studio that are still missing.

- [x] Open and switch solutions: "Open Solution..." (the workspace's solutions, or any via Browse), the choice is remembered, like Visual Studio's File > Open > Solution
- [x] Open Launch Settings on projects that can be started: opens `Properties/launchSettings.json`, created with the profiles `dotnet new` writes when missing (shorter than Visual Studio's Properties > Debug > Open debug launch profiles UI)
- [x] Convert .sln to .slnx: opening a .sln offers to convert it (`dotnet sln migrate`), then to delete the .sln, and opens the .slnx; "Don't Ask Again" per solution
- [ ] Unload / Reload Project: an unloaded project stays in the tree greyed out as "(unloaded)" and is skipped by solution builds (through a solution filter) until it is reloaded; remembered per workspace, like Visual Studio's per-user setting
- [ ] Pack on class libraries: builds the NuGet package (`dotnet pack`) for the active configuration with the project's package metadata (PackageId, Version, Authors, ...) and shows where the `.nupkg` went
- [ ] Configuration Manager: solution configurations and platforms (Debug/Release, Any CPU/x64) to add, rename and remove; which configuration and platform each project builds in and whether it builds at all; written to the .sln/.slnx; the platform picked next to Debug/Release

## Phase 17: Code Cleanup & Refactoring
**Goal**: Visual Studio's project-wide fixes and the refactorings you reach for daily. Fixes at a spot in the code (Ctrl+.) come from the C# extension's Roslyn server and aren't duplicated.

- [ ] Code Cleanup on the solution, a project, folder or file: fix all errors, warnings and/or infos, format, remove and sort usings (`dotnet format`)
- [ ] Fix all occurrences of a diagnostic (e.g. IDE0090) in the project or solution, from the Error List
- [ ] Sync Namespaces on a project or folder: every namespace matches its folder, as in Visual Studio
- [ ] Check which refactorings the C# extension covers in VS Code (Extract Interface, Move Type to File, Change Signature, Fix All in document/project/solution) and fill the gaps, e.g. Visual Studio's dialogs for Extract Interface and Change Signature

## Phase 18: Run & Debug, Part 2
- [ ] Multiple startup projects (e.g. API plus worker or frontend), each with its own launch profile, like Visual Studio's "Configure Startup Projects"
- [ ] Hot Reload (`dotnet watch`)
- [ ] HTTPS development certificate: detect an untrusted one and help trust it (`dotnet dev-certs https --trust`, fiddly on Linux)
- [ ] Attach to Process: pick a running .NET process (by name, project or port) and attach the C# debugger, like Visual Studio's Debug > Attach to Process

## Phase 19: Solution Explorer, Part 2
- [ ] Search in the Solution Explorer (Visual Studio's Ctrl+;)
- [ ] The tree follows the project's items like Visual Studio: `<Compile Remove>` / `DefaultItemExcludes` hide files, linked files (`Include="..\x.cs" Link="x.cs"`) appear; "Show All Files" shows the excluded ones greyed out
- [ ] Exclude From Project / Include In Project on files and folders (writes or removes the `Remove`/`Include` items)
- [ ] Drag & drop of files, folders and projects
- [ ] The diagnostic rules of each analyzer under Dependencies > Analyzers, like Visual Studio
- [ ] Project Properties: target framework, nullable, implicit usings, version and the like as a form instead of editing the project file
- [ ] Launch Profiles editor: Visual Studio's "Launch Profiles" dialog (Project Properties > Debug), a form for the profiles of `launchSettings.json` (command line arguments, environment variables, URLs, browser) instead of editing the JSON

## Phase 20: NuGet, Part 2
- [ ] Central Package Management (`Directory.Packages.props`): install, update and consolidate put versions where they belong

## Phase 21: Connected Services, Part 2
- [ ] OpenAPI (REST) clients: Visual Studio's "Add Connected Service > OpenAPI" (NSwag / `dotnet-openapi`)
- [ ] gRPC clients from `.proto` files (Visual Studio's "Add Connected Service > gRPC")

## Phase 30: Later
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

## Phase 31: Publish, Part 2
**Goal**: The other publish targets of Visual Studio, with the `.pubxml` format Visual Studio writes for each (to be gathered from Visual Studio-made profiles first).

- [ ] Azure App Service target (ZIP deploy through the Azure CLI, no stored password)
- [ ] Container registry target (the SDK's container publish, credentials from `docker login` / `az acr login`)
- [ ] FTP/FTPS target (upload after a folder publish, password in VS Code's secret storage)
- [ ] IIS Web Deploy, only on Windows where `msdeploy` exists

## Not Planned
- .NET Framework 4.x / Mono build and debug support
- `packages.config` and old-style project files
- Code navigation features that the C# extension already provides (Go to Definition, Find References, symbol search)
- Diagnostic Tools / profiler UI (the `dotnet-trace`, `dotnet-counters` and `dotnet-gcdump` CLI tools cover it)
- A `.resx` resource editor
- Task List (`// TODO` comments)
- Visual Studio's Git integration (also git status in the Solution Explorer): VS Code's Source Control view and Explorer cover it
