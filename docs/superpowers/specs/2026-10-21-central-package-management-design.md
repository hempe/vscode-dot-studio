# Phase 20: Central Package Management in the NuGet UI

Covers the "Central Package Management (`Directory.Packages.props`)" item of Phase 20 in `docs/roadmap.md`.

## Goal

The NuGet manager, the Dependencies tree and the Updates/Consolidate tabs work in solutions that use Central Package Management (CPM): versions come from the right place, changes go where they belong, and the user is told when a change reaches other projects. `GlobalPackageReference` (an analyzer for every project, set once in `Directory.Packages.props`) is supported, including update and uninstall.

## What is broken today

A spike (real CPM solutions, dotnet SDK 10) found, with the extension's own parser and the exact `dotnet` commands it runs:

- Installed list (solution context) and the Dependencies tree: every CPM package has version "Unknown" (`projectFileParser.ts` reads only the csproj `Version` attribute); a `VersionOverride` is ignored; `GlobalPackageReference` packages are missing.
- Updates tab (solution context): every CPM package is listed as outdated (`VersionUtils.compare(x, 'Unknown')` is -1).
- `dotnet add package X --version Y` rewrites the shared `PackageVersion`: updating or installing in one project silently changes all of them; for a project with `VersionOverride` it rewrites the override instead.
- Install/update fail when the `PackageVersion` lives in a props file that is imported by `Directory.Packages.props` ("defined in incorrect location").
- Uninstall of a `GlobalPackageReference` fails (the CLI cannot edit imported items); the project-context list still offers the button.
- Consolidate never offers anything (all versions "Unknown").
- Nothing watches `Directory.Packages.props`: a change to it does not refresh the tree.

Works already: Browse > Install of a new package, uninstall of a normal reference, transitive pinning, the project-context Installed list (it uses `dotnet list`).

## Behaviour (decided)

- **A version change edits the central version.** Updating or installing another version of a package that has a central `PackageVersion` changes that entry (what CPM is for, and what the CLI does). Before it happens a confirmation lists the other projects that use the package. A separate action, "Set for this project only", writes a `VersionOverride` in the project instead.
- **Global references are shown and editable.** `GlobalPackageReference` packages appear in Installed and in Dependencies, labelled "global", for every project. Update changes the version of the `GlobalPackageReference`, Uninstall removes it. A project can opt out with `<GlobalPackageReference Remove="X" />` (verified with MSBuild), which the UI shows as not installed for that project.
- **The extension edits `Directory.Packages.props` itself** (the CLI refuses imported files and global references), as text edits that keep the formatting, in the file that defines the entry.
- **Uninstall** of a normal reference removes the `PackageReference` from the csproj; when no project uses the package afterwards the UI asks whether to remove its now unused `PackageVersion` (never silently).
- **Consolidate under CPM:** versions differ only through `VersionOverride`s; it offers to set the central version to the chosen one and to remove the overrides. Projects that do not use CPM in the same solution keep today's per-project behaviour.
- **Left out:** pinned transitive packages in the Updates tab, and any version edit through `dotnet add package`.

## Design

### PackageVersionSource service

`src/services/nuget/centralPackages.ts` (no `vscode` import, injectable runner like `ProjectItemsService`). Per project it evaluates once with MSBuild:

```
dotnet msbuild <proj> -nologo -getProperty:ManagePackageVersionsCentrally -getProperty:DirectoryPackagesPropsPath -getItem:PackageReference -getItem:PackageVersion
```

(about 0.45 s per project; cached, concurrency-limited, invalidated and re-evaluated when the project file or a props file changes, with the stale-while-revalidate behaviour of `ProjectItemsService`; consider extending that service's queue instead of a second one.) The result per project:

- `centrallyManaged: boolean`, `propsPath` (the `Directory.Packages.props` MSBuild picked),
- per reference: id, effective version, and the **source**: `project` (csproj `Version`), `central` (with the defining file from `DefiningProjectFullPath` of the `PackageVersion` item), `override` (csproj `VersionOverride`), or `global` (defined by the `GlobalPackageReference` in a props file; MSBuild reports it as defined in `NuGet.targets`, so the defining props file is found by reading the `GlobalPackageReference` items of the props files, see below).

Items not visible to MSBuild's item list are read with a small XML reader over `propsPath` and the files it imports: `centralPackageFiles(propsPath)` returns the props files in the import chain, and for each `PackageVersion` and `GlobalPackageReference` entry the file and element position, used by the editor below.

If MSBuild fails (no SDK), the fallback is today's behaviour, with unknown versions shown as "not known" and never treated as outdated.

### Data and UI

- The solution-view parser/`getAllProjectsInfoFromActiveSolution` and `Project.getDependenciesByCategory` take versions and sources from the service: "Unknown" disappears; an override is shown as "13.0.2 (override)"; a global reference is shown with the label "global" in Installed (all projects) and in the tree of every project that has it.
- The Updates filter treats an unknown version as "not known", not outdated.
- The project-context list keeps `dotnet list` but marks the global entries and overrides from the same service.

### Operations

`src/services/nuget/centralPackageEdits.ts` (pure text edits, tested like `projectFileEditor`): `setPackageVersion`, `addPackageVersion`, `removePackageVersion`, `setGlobalPackageVersion`, `removeGlobalPackageReference`, and in the csproj `setVersionOverride`/`removeVersionOverride`/`addPackageReference` (no `Version`), `removeGlobalOptOut`/`addGlobalOptOut`.

- **Install** (Browse): csproj gets a `PackageReference` without `Version`; if no central `PackageVersion` exists one is added to the props file that defines the others (else the nearest `Directory.Packages.props`); if one exists with another version than the chosen one, the version-change rule applies (confirmation, central).
- **Update / bulk update:** per package once (not once per project): central entries are edited once, overrides per project, global references in their props file. The affected projects are listed in the confirmation (one confirmation for a bulk update).
- **Uninstall:** as above; a global reference in project context removes the `GlobalPackageReference` after a confirmation naming all projects it applies to, or, as the alternative offered in the same prompt, adds an opt-out for this one project.
- Edits run through the same refresh path as other project edits; after an edit the service re-evaluates and the lists refresh.

### Watching

A watcher on `**/Directory.Packages.props` plus the imported props files (re-registered when the import chain changes) invalidates the service and refreshes the NuGet editor and tree. Props files outside the workspace folder cannot be watched by a workspace watcher: re-check them when the NuGet editor gets focus.

### Messages

New or extended `BackendCmd`/UI messages for the confirmation data (list of affected projects) and the "set for this project only" action; follow the existing NuGet messages in `src/types/commands/backend.ts` and `ui.ts` and handle both sides.

## Testing

- Fixtures under `src/__fixtures__/central-packages/`: CPM on with `PackageVersion`s, a project with `VersionOverride`, a project that only gets a global reference, an imported props file, a solution without CPM, a mixed solution.
- Pure tests of `centralPackageEdits` (formatting kept, CRLF, `PackageVersion` in the defining file, comments).
- Service tests with an injected runner; a real-MSBuild integration test (skipped without `dotnet`, like `projectItemEdits.msbuild.test.ts`) for the effective versions, sources, opt-out, and the edits (evaluate before and after).
- NuGet webview tests for the labels, the override marker, the confirmation with the affected projects, the Updates filter no longer listing current packages.
- Regression test: the Updates list of a CPM solution is empty when everything is current.

## Docs

`docs/nuget.md`: a Central Package Management section (what is shown, what each action edits, the confirmation, global references and the opt-out, consolidate). GIF scene for the NuGet manager on a CPM solution (add a fixture to `scripts/screenshots/sample` or a second sample). `docs/manual-testing.md` unticked checks, `docs/roadmap.md` ticked when done, Known limitations: props files outside the workspace, transitive pinning not offered in Updates.
