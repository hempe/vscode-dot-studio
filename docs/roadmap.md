# Roadmap

Ordered by what is needed to drop Visual Studio for daily work. Phases 1–21 are done (see [History](history.md)): web apps, SOAP clients, templates, tests, private feeds, the Visual Studio basics, publishing, readiness for others, solutions, projects and configurations, code cleanup and refactoring, and the second rounds for run & debug, for the Solution Explorer, for NuGet and for connected services. Phase 21, Part 5 is the limitations we want to fix, phase 22 quality and documentation, phase 23 the small limitations left until after the code review, phase 30 what may come later, phase 35 packages per target framework (last, only if it proves necessary). Everything else is under Not Planned: a change request on GitHub brings it back.

What still needs a check in VS Code itself is listed in [manual-testing.md](manual-testing.md).

## Known bugs

Bugs found later are listed here, to be fixed.

- [ ] Startup profiles: a project with the action "Start without debugging" is attached to the debugger anyway with the C# extension of Open VSX (`muhammad-sammy.csharp`, netcoredbg) but gets no breakpoints: its `launch.json` entry has `noDebug: true`, `ps` showed a netcoredbg process for it, its own log said `Debugger.IsAttached` true, and its breakpoints never hit (seen 2026-10-23 in `/home/hempe/manual-test/2-startup-profiles`; explanation, unverified: netcoredbg ignores `noDebug` for the launch but VS Code sends no breakpoints to a `noDebug` session; Microsoft's debugger not tried). To try: start such projects through a `node-terminal` configuration (a command in a terminal, no .NET debugger) inside the compound, and make Stop and `stopAll` end them
- [ ] Startup profiles: deleting the `.slnLaunch` file (or choosing the single project) when no single startup project was ever set before the profile removes the profile's `launch.json` entries and writes no `Startup` entry (`doRefreshStartup` in `startProfile.ts`, the branch without a remembered single project), so F5 asks "Select a debugger" until Set as Startup Project is used (seen 2026-10-23 in `/home/hempe/manual-test/2-startup-profiles`; read from the code and the user's result, not run); fall back to a default startup project (the first startable project, like Visual Studio) or say so
- [ ] A project without packages, project references and assemblies has no Dependencies node (`Project.getRootChildren`: `if (this.dependencies.length > 0)`), so a bare console project shows nothing to right-click for Add Project Reference / Add Service Reference; Visual Studio always shows Dependencies (with Analyzers and Frameworks) and offers Add Connected Service on it. Show the node on every SDK-style project and put Add Service Reference... in its menu (seen 2026-10-23 with `SoapClient` in `/home/hempe/manual-test/3-soap-references`)

## Phase 21, Part 5: Limitations we want to fix
Valuable for the team's daily work; fixed before the code review of Phase 22.

- [ ] Central packages: a `Version="$(Prop)"` shared by several packages is replaced by a literal version on the edited package only, so it no longer follows the property
- [ ] Building a single project does not clear stale build errors that an earlier solution build reported for other projects
- [ ] Include In Project adds C# files as Compile and everything else as None, so a Razor or web file left out by DefaultItemExcludes is not compiled or published until its item type is fixed by hand
- [ ] Dropping a project onto another project's Dependencies does not add a project reference; use Add Project Reference...

## Phase 22: Quality and documentation
- [ ] Code review of the whole code base, once the nice-to-haves are in: plan in [the code review plan](superpowers/plans/2026-10-21-code-review.md)
- [ ] Automate manual checks: spike driving VS Code with Playwright (`_electron.launch` on `code-oss`, webviews as frames) in the throwaway profile of `scripts/screenshots/capture.sh`; then automate the entries of [manual-testing.md](manual-testing.md) that need no native menu, no debugger and no other OS; tick those entries only when the automated run has passed
- [ ] Compare with Visual Studio feature by feature (including how its NuGet manager handles Central Package Management and which build actions it lists) and write the result into a new page (linked from the README): what we support, what works differently, what is not planned (and why) and what is still to come; replaces the loose notes in [Coming from Visual Studio](coming-from-visual-studio.md)

## Phase 23: Limitations to look at after the code review
Edge cases and cosmetics; decided to leave until the code review of Phase 22 is done. Phase 35 holds the per-framework package work.

- [ ] A file moved (renamed) on disk from elsewhere into a folder that is not shown keeps its old timestamps, so reading the folder does not take it for new and it stays hidden until the project is evaluated again; files created, copied or extracted there show (a folder read from disk evaluates again when an entry the item list lacks is newer than the evaluation)
- [ ] Files a project links from outside its own directory are not rolled up into the project's marker
- [ ] After moving a solution folder of a `.slnx` file without an `Id` by drag & drop, the moved folder and the folders in it show collapsed (their tree ids come from their path)
- [ ] Central Package Management: the Updates tab does not offer updates of pinned transitive packages (`CentralPackageTransitivePinningEnabled`); update them in `Directory.Packages.props`
- [ ] gRPC references: the Connected Services node of a project without that folder becomes the folder once a WCF reference creates it (its expansion state is not carried over)

## Phase 30: Later
- [ ] NuGet manager marks vulnerable packages (severity, advisory link) and deprecated ones (with the suggested replacement), with filters for them; restore already warns about vulnerable packages (NuGet Audit) in the Error List
- [ ] EF Core migrations from the context menu (Add Migration, Update Database, Remove Migration...) running the `dotnet ef` commands, since Visual Studio's Package Manager Console route is clumsy and teams use the CLI anyway
- [ ] NuGet package sources like Visual Studio, as an opt-in feature (a setting): a package source picker for Browse, a page to add, remove and enable feeds, and Package Source Mapping (shown in the package details, offered when installing, respected by Browse; restore already follows a mapping in `NuGet.Config`)
- [ ] Hot Reload with the debugger attached: not possible with netcoredbg (`dotnet watch` refuses assembly updates while a debugger is attached); revisit if a debugger that does Edit and Continue is available (Microsoft's, in Microsoft's C# extension)
- [ ] No C# extension needed: bundle our own debugger ([netcoredbg](https://github.com/Samsung/netcoredbg), MIT, prebuilt releases for Linux, Windows and macOS) and run the Roslyn and Razor language servers ourselves, with completion, diagnostics, navigation, code actions and formatting wired to the editor. The debugger alone is a contained job but gains little while the language server still comes from the C# extension

## Phase 35: Per-framework packages
**Goal** (hard and error prone: the team hand-writes these project files for a reason, so this comes last and only if it proves necessary; the read-only display of each framework's packages is the safe part, editing around conditions the risky one): Projects that reference different packages per target framework (`net10.0` and `net8.0` in one `.csproj`, or conditions in `Directory.Build.props` and `Directory.Packages.props`), which the team writes by hand because Visual Studio's UI cannot express them, are shown and edited correctly instead of only for the first framework. To start with real examples of what the team writes.

- [ ] Evaluate multi-targeted projects per target framework (today only the first one, see the Known bugs) and show each framework's packages in the tree, the NuGet manager and the update confirmation
- [ ] Edits respect conditions: update the `PackageVersion` or `PackageReference` that applies to the framework (or all of them, after a confirmation naming them) instead of the first match; a new conditional entry can be written for a chosen framework
- [ ] Packages declared in an imported props file without Central Package Management (`Directory.Build.props` with a `PackageReference`, e.g. one analyzer for every project): update and remove edit that file after a confirmation naming the projects it reaches (the `dotnet` CLI refuses: "Cannot edit items in imported files"), also offering "Set for This Project Only"; the machinery for `Directory.Packages.props` exists
- [ ] Consolidate and Updates ignore version differences that are on purpose between target frameworks or projects (e.g. `NeinLinq` 2.2.1 for `net471` and 7.4.0 for `net10.0`)
- [ ] Never offer an orphan removal of a version that another framework still uses (today any multi-targeted project suppresses the prompt)
- [ ] Docs, GIF and manual-testing entries for the conditional cases

## Not Planned
- ASP.NET (IIS Express), tests and old-style project files on .NET Framework 4.x: SDK-style `net4x` projects load, build, use the NuGet manager and run and debug with Mono on Linux and macOS, see [Troubleshooting](troubleshooting.md#known-limitations)
- `packages.config` and old-style project files
- Code navigation features that the C# extension already provides (Go to Definition, Find References, symbol search)
- Diagnostic Tools / profiler UI (the `dotnet-trace`, `dotnet-counters` and `dotnet-gcdump` CLI tools cover it)
- A `.resx` resource editor
- Task List (`// TODO` comments)
- Visual Studio's Git integration (also git status in the Solution Explorer): VS Code's Source Control view and Explorer cover it
- The other publish targets of Visual Studio, with the `.pubxml` format it writes for each: Azure App Service (ZIP deploy through the Azure CLI), container registry (the SDK's container publish), FTP/FTPS, IIS Web Deploy (Windows only); folder publishing exists and profiles for the other targets are listed but publish from Visual Studio; to be built if someone opens an issue
- Encrypted NuGet feed passwords (`Password`, Windows DPAPI) can't be used: store a `ClearTextPassword` (the NuGet manager's "Enter New Token..." does that) or use the Azure Artifacts Credential Provider, which covers restore and build
- `dotnet-svcutil` limits, not ours to fix: updating a reference Visual Studio created changes the generator version in every type of `Reference.cs` (svcutil 8.0.0 instead of Visual Studio's 2.0.2), and it cannot read .NET Framework assembly references (`<Reference Include="System.ServiceModel" />`; remove them when porting before updating a reference)
- Exclude From Project and Include In Project on old-style (non-SDK) projects, and Exclude for linked files: SDK-style projects only
- Drag & drop from VS Code's Explorer or the file manager into the Solution Explorer: a webview gets no file paths from such drops
- Central Package Management props files imported through a property (`$(SomeDir)/x.props`) or a wildcard, or located outside the opened folder, are not watched live (only imports written with a literal path, `$(MSBuildThisFileDirectory)` or `GetPathOfFileAbove` are, and outside files are re-checked when the NuGet manager gets focus): VS Code's file watching cannot see them; edit, then change a project file or reopen the NuGet manager
- Configure Service Reference (Visual Studio's dialog on a service reference to change its address, namespace and type reuse): Update Service Reference regenerates from the stored address in `ConnectedService.json` (`ExtendedData.inputs`), which can be edited by hand, or the reference removed and added again; to be built if someone opens an issue
- Search in the Solution Explorer (Visual Studio's Ctrl+;): Ctrl+P and Sync with Active Document cover it; to be built if someone opens an issue for it
- The diagnostic rules of each analyzer under Dependencies > Analyzers: `.editorconfig` sets their severities
- OpenAPI clients (Visual Studio's "Add Connected Service > OpenAPI"): Microsoft deprecated `<OpenApiReference>` and `dotnet openapi` in .NET 10 and recommends the generators' own tools (NSwag, Kiota with its VS Code extension); to be built if someone opens an issue
- Refactorings the C# extension's Roslyn server does not offer (Change Signature, Move to namespace, Pull members up, Visual Studio's Extract Interface dialog): only if they are missed; to be built if someone opens an issue
- Solution filters (`.slnf`, load part of a big solution): to be built if someone opens an issue
- Scaffolding ("New Scaffolded Item": controllers with EF, Identity): to be built if someone opens an issue
- Docker / docker-compose launch profiles: not used by the team, and those who use them write them by hand; to be built if someone opens an issue
- Encrypted NuGet credentials (`Password` is Windows DPAPI): on Linux the Azure Artifacts Credential Provider covers restore and build, and the NuGet manager explains rejected tokens; to be built if someone opens an issue
- Remote debugging on devices over SSH (`pipeTransport` launch configurations): not a Visual Studio feature for .NET (Visual Studio only attaches to running processes over SSH)
- Code coverage in the Test Explorer: an IDE's coverage is slow or slows the IDE down, so teams run coverage from a script (`dotnet test --collect`, ReportGenerator; ours is `run-coverage.ps1`), which remains the better way
- Project Properties as a form and Visual Studio's Launch Profiles editor: Edit Project File covers the properties, and Open Launch Settings creates `launchSettings.json`, whose JSON schema helps with editing the profiles
