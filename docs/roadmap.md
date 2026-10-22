# Roadmap

Ordered by what is needed to drop Visual Studio for daily work. Phases 1–20 are done (see [History](history.md)): web apps, SOAP clients, templates, tests, private feeds, the Visual Studio basics, publishing, readiness for others, solutions, projects and configurations, code cleanup and refactoring, and the second rounds for run & debug, for the Solution Explorer and for NuGet. Phase 21 is the second round for connected services, phase 22 quality and documentation, phase 30 what may come later, phase 31 the other publish targets.

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
- [ ] A file moved (renamed) on disk from elsewhere into a folder that is not shown keeps its old timestamps, so reading the folder does not take it for new and it stays hidden until the project is evaluated again; files created, copied or extracted there show (a folder read from disk evaluates again when an entry the item list lacks is newer than the evaluation)
- [ ] After a project, folder or solution folder is dropped onto a collapsed solution folder, the target stays collapsed and the moved node is out of sight; expand the target and select the moved node (Visual Studio does, as far as known)
- [ ] After a drag & drop a grey hover highlight sometimes stays on a row the drag started on or passed over (Chromium sends no mouse-leave during a drag); cosmetic, clear it on drag end
- [ ] Central packages: a package with several conditional `PackageVersion` entries (e.g. one per target framework) gets only the first matching one edited
- [ ] Central packages: a `Version="$(Prop)"` shared by several packages is replaced by a literal version on the edited package only, so it no longer follows the property
- [ ] Central packages: multi-targeted projects are evaluated for their first target framework only, so packages (and versions) of the other target frameworks are not seen: not shown, not updated, and not counted when uninstalling (which is why the "no project uses it any more" question is never asked then)
- [ ] Central packages: after an edit in the NuGet manager the projects are possibly evaluated twice (the explicit re-evaluation plus the props and project file watchers); unverified, the CentralPackageWatchers have no debounce

## Known limitations

- [ ] Encrypted NuGet feed passwords (`Password`, Windows DPAPI) can't be used; store a `ClearTextPassword` (the NuGet manager's "Enter New Token..." does that) or use the Azure Artifacts Credential Provider, which covers restore and build
- [ ] Building a single project does not clear stale build errors that an earlier solution build reported for other projects
- [ ] Files a project links from outside its own directory are not rolled up into the project's marker
- [ ] Updating a reference Visual Studio created changes the generator version in every type of `Reference.cs` (svcutil 8.0.0 instead of Visual Studio's 2.0.2)
- [ ] svcutil cannot read .NET Framework assembly references (`<Reference Include="System.ServiceModel" />`); remove them when porting before updating a reference
- [ ] Exclude From Project and Include In Project work on SDK-style projects only; a linked file has no Exclude, and Delete on it deletes the real file
- [ ] Include In Project adds C# files as Compile and everything else as None, so a Razor or web file left out by DefaultItemExcludes is not compiled or published until its item type is fixed by hand
- [ ] Drag & drop works within the Solution Explorer only: files dropped from VS Code's Explorer or the file manager are not taken (a webview gets no file paths from such drops)
- [ ] Dropping a project onto another project's Dependencies does not add a project reference; use Add Project Reference...
- [ ] After moving a solution folder of a `.slnx` file without an `Id` by drag & drop, the moved folder and the folders in it show collapsed (their tree ids come from their path)
- [ ] Central Package Management: a props file imported through a property (`$(SomeDir)/x.props`) or a wildcard is not watched, only imports written with a literal path, `$(MSBuildThisFileDirectory)` or `GetPathOfFileAbove` are; edit it, then change a project file or reopen the NuGet manager
- [ ] Central Package Management: props files outside the opened folder are only re-checked when the NuGet manager gets focus; the tree shows their changes after that, or after a project file changes
- [ ] Central Package Management: the Updates tab does not offer updates of pinned transitive packages (`CentralPackageTransitivePinningEnabled`); update them in `Directory.Packages.props`
- [ ] Central Package Management: a `PackageReference` that comes from a props file (not from the project file) cannot be uninstalled from the NuGet manager (`dotnet remove package` reports that the project has no such reference); edit the props file

## Phase 21: Connected Services, Part 2
- [ ] gRPC references from `.proto` files (Visual Studio's "Add Connected Service > gRPC", `dotnet-grpc`): add, update, remove, in Connected Services; plan in [the gRPC spec](superpowers/specs/2026-10-23-grpc-references-design.md)

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
- Search in the Solution Explorer (Visual Studio's Ctrl+;): Ctrl+P and Sync with Active Document cover it; to be built if someone opens an issue for it
- The diagnostic rules of each analyzer under Dependencies > Analyzers: `.editorconfig` sets their severities
- OpenAPI clients (Visual Studio's "Add Connected Service > OpenAPI"): Microsoft deprecated `<OpenApiReference>` and `dotnet openapi` in .NET 10 and recommends the generators' own tools (NSwag, Kiota with its VS Code extension); to be built if someone opens an issue
- Project Properties as a form and Visual Studio's Launch Profiles editor: Edit Project File covers the properties, and Open Launch Settings creates `launchSettings.json`, whose JSON schema helps with editing the profiles
