# Roadmap

Ordered by what is needed to drop Visual Studio for daily work. Phases 1–18 are done (see [History](history.md)): web apps, SOAP clients, templates, tests, private feeds, the Visual Studio basics, publishing, readiness for others, solutions, projects and configurations, code cleanup and refactoring, and the second round for run & debug. Phases 19–21 are the second round for the Solution Explorer, NuGet and connected services, phase 30 what may come later, phase 31 the other publish targets.

What still needs a check in VS Code itself is listed in [manual-testing.md](manual-testing.md).

## Known bugs

Found along the way, to be fixed:
- [ ] A one-time MSBuild failure (timeout, a half-saved project file) is cached as "no item list" until the project changes again (project file, a props file, new files), so the project shows the plain disk listing meanwhile; retry with a backoff, or when the project is expanded next
- [ ] Exclude From Project / Include In Project on a file in the folder of a nested project, from the outer project's tree, edits the nested (deepest) project's file; only folders that hold a project are refused
- [ ] Item matching in the project file skips XML comments and items inside `<Target>`, but only knows self-closing items: a block-form item (`<Compile Remove="Old.cs"></Compile>`, or one with metadata children) is not found, so Include In Project leaves its `Remove` in place and adds an `Include` item after it instead (the file is included, the project file gets both), and Exclude does not see an existing block-form `Remove` and adds a self-closing one
- [ ] After a new item list, `Project.reloadLoadedFolders` reloads the expanded folders in the order they were expanded, not parents before children (by depth)
- [ ] Show All Files is read from a global that is set to the new solution only after it has loaded (`ShowAllFiles.setSolution` after `solution.ready`): folders read while the solution loads, e.g. after an evaluation answered from the cache right after switching solutions, use the previous solution's setting
- [ ] The tests of path casing for Windows and macOS (bin/obj in any casing, `folderLayout.test.ts`) only run their case-insensitive branch on those systems; on Linux they check the case-sensitive one
- [ ] The Visual Studio build-action item types added to the item list (CodeAnalysisDictionary, DesignData, EntityDeploy, Fakes, Shadow, XamlAppDef, TypeScriptCompile...) come from memory and are not checked against Visual Studio; the platform files of iOS/MAUI projects are not checked either (workloads not installed)
- [ ] The position of the link badge of linked files in the tree was never seen on screen

## Known limitations

- [ ] Encrypted NuGet feed passwords (`Password`, Windows DPAPI) can't be used; store a `ClearTextPassword` (the NuGet manager's "Enter New Token..." does that) or use the Azure Artifacts Credential Provider, which covers restore and build
- [ ] Building a single project does not clear stale build errors that an earlier solution build reported for other projects
- [ ] Files a project links from outside its own directory are not rolled up into the project's marker
- [ ] Updating a reference Visual Studio created changes the generator version in every type of `Reference.cs` (svcutil 8.0.0 instead of Visual Studio's 2.0.2)
- [ ] svcutil cannot read .NET Framework assembly references (`<Reference Include="System.ServiceModel" />`); remove them when porting before updating a reference
- [ ] Exclude From Project and Include In Project work on SDK-style projects only; a linked file has no Exclude, and Delete on it deletes the real file
- [ ] Include In Project adds C# files as Compile and everything else as None, so a Razor or web file left out by DefaultItemExcludes is not compiled or published until its item type is fixed by hand

## Phase 19: Solution Explorer, Part 2
- [ ] Search in the Solution Explorer (Visual Studio's Ctrl+;)
- [x] The tree follows the project's items like Visual Studio: `<Compile Remove>` / `DefaultItemExcludes` hide files, linked files (`Include="..\x.cs" Link="x.cs"`) appear; "Show All Files" shows the excluded ones greyed out
- [x] Exclude From Project / Include In Project on files and folders (writes or removes the `Remove`/`Include` items)
- [ ] Drag & drop of files, folders and projects
- [ ] The diagnostic rules of each analyzer under Dependencies > Analyzers, like Visual Studio
- [ ] Project Properties: target framework, nullable, implicit usings, version and the like as a form instead of editing the project file
- [ ] Launch Profiles editor: Visual Studio's "Launch Profiles" dialog (Project Properties > Debug), a form for the profiles of `launchSettings.json` (command line arguments, environment variables, URLs, browser) instead of editing the JSON

## Phase 20: NuGet, Part 2
- [ ] Central Package Management (`Directory.Packages.props`): install, update and consolidate put versions where they belong

## Phase 21: Connected Services, Part 2
- [ ] OpenAPI (REST) clients: Visual Studio's "Add Connected Service > OpenAPI" (NSwag / `dotnet-openapi`)
- [ ] gRPC clients from `.proto` files (Visual Studio's "Add Connected Service > gRPC")

## Phase 22: Quality and documentation
- [ ] Code review of the whole code base, once the nice-to-haves are in: plan in [the code review plan](superpowers/plans/2026-10-21-code-review.md)
- [ ] Automate manual checks: spike driving VS Code with Playwright (`_electron.launch` on `code-oss`, webviews as frames) in the throwaway profile of `scripts/screenshots/capture.sh`; then automate the entries of [manual-testing.md](manual-testing.md) that need no native menu, no debugger and no other OS; tick those entries only when the automated run has passed
- [ ] Compare with Visual Studio feature by feature and write the result into a new page (linked from the README): what we support, what works differently, what is not planned (and why) and what is still to come; replaces the loose notes in [Coming from Visual Studio](coming-from-visual-studio.md)

## Phase 30: Later
- [ ] Refactorings the C# extension's Roslyn server does not offer: Change Signature, Move to namespace, Pull members up, and Visual Studio's dialog for Extract Interface (name, file, members); only if they are missed
- [ ] Hot Reload with the debugger attached: not possible with netcoredbg (`dotnet watch` refuses assembly updates while a debugger is attached); revisit if a debugger that does Edit and Continue is available (Microsoft's, in Microsoft's C# extension)
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
- ASP.NET (IIS Express), tests and old-style project files on .NET Framework 4.x: SDK-style `net4x` projects load, build, use the NuGet manager and run and debug with Mono on Linux and macOS, see [Troubleshooting](troubleshooting.md#known-limitations)
- `packages.config` and old-style project files
- Code navigation features that the C# extension already provides (Go to Definition, Find References, symbol search)
- Diagnostic Tools / profiler UI (the `dotnet-trace`, `dotnet-counters` and `dotnet-gcdump` CLI tools cover it)
- A `.resx` resource editor
- Task List (`// TODO` comments)
- Visual Studio's Git integration (also git status in the Solution Explorer): VS Code's Source Control view and Explorer cover it
