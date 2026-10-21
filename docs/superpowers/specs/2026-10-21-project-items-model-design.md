# Phase 19, part 1: the project items model (Show All Files, Exclude/Include, linked files)

Covers the first two items of Phase 19 in `docs/roadmap.md`. Search, drag & drop, analyzer rules, Project Properties and the Launch Profiles editor are separate cycles.

## Goal

The Solution Explorer tree follows the project's items like Visual Studio: files the project excludes are hidden, linked files appear, "Show All Files" reveals the excluded ones greyed out, and Exclude From Project / Include In Project write the matching items.

## Today

`Project.loadFolderChildren` lists the folder with `readdir` and skips the `shouldSkipDirectory` folders (`bin`, `obj`, ...). The project file is not consulted, so `<Compile Remove>` and `DefaultItemExcludes` have no effect and linked files (`Include="..\x.cs" Link="x.cs"`) never appear. Expanded folders have lazy file watchers; the project file has its own watcher.

## Approach: item overlay

`readdir` stays the base listing (milliseconds). A new `ProjectItemsService` asks MSBuild what the project contains and the tree applies that as an overlay. Replacing the listing with MSBuild's output was rejected (every expand would wait about a second); parsing the csproj ourselves was rejected (misses `Directory.Build.props` and conditions).

### ProjectItemsService

- Runs `dotnet msbuild <project> -nologo -getItem:Compile,None,Content,EmbeddedResource` (the same mechanism as `userSecrets.ts`; cross-platform, part of the .NET SDK).
- Result per project: the set of included files (absolute paths) with their item type, and for linked items the `Link` path.
- Cached per project, in memory. Re-queried when the project file, `Directory.Build.props` or `Directory.Build.targets` changes, and after Include/Exclude edits.
- Concurrent requests for one project share a single process.
- On failure (no SDK, broken project) it returns `undefined`; the tree keeps the plain disk listing and logs a warning.

### Tree

- Each file node gets a state: `included`, `excluded` (on disk, not in the project) or `linked`.
- Folder loading: disk listing, then overlay. Until the overlay arrives the tree shows the disk listing as today and re-renders when it does. A project without `Remove` or `Link` items looks unchanged.
- Show All Files off (default, like Visual Studio): excluded files and `bin`/`obj` are hidden. Linked files appear under their `Link` path (intermediate folders are synthesized) with a link overlay on the icon.
- Show All Files on: excluded files appear greyed out, `bin`/`obj` appear.
- The toggle is a Solution Explorer toolbar button, remembered per solution (same place as the expansion state).

### Exclude / Include

- Exclude From Project (included files and folders): adds `<{ItemType} Remove="path" />` using the item type of the evaluated item; a folder uses `Remove="Dir\**"`.
- Include In Project (excluded files and folders, only visible with Show All Files on): if a matching `Remove` item exists in the project file, delete it; otherwise (`EnableDefaultCompileItems=false`, `DefaultItemExcludes`) add `<Compile Include="path" />` (`None` for non-code files).
- Edits go through `parsers/projectFileEditor.ts` (text edits, formatting preserved), then the overlay is re-queried.
- SDK-style projects only; for old-style projects the entries are disabled.
- Menu entries and key handling are added to `core/contextMenus.ts`, then `npm run generate:menus`.

### Freshness

- New file on disk: checked against the cached overlay; a file in an excluded folder shows as excluded, a glob miss triggers a re-query.
- Project file, props and targets changes: re-query, then refresh the tree.

## Testing

- Unit: overlay merge (included, excluded, linked, synthesized folders), `Remove`/`Include` edits, cache invalidation, MSBuild failure falls back to disk.
- Fixtures: a project with `Compile Remove`, `DefaultItemExcludes` and a `Link` under `src/__fixtures__/`.
- Webview bundle test stays green (no `vscode`/Node in webview code).

## Docs

- `docs/solution-explorer.md`: Show All Files, linked files, Exclude/Include.
- GIF scene in `scripts/screenshots/capture.sh` (record where X11 and ffmpeg exist, otherwise say so).
- `docs/context-menus.md` regenerated; `docs/manual-testing.md` gets the unticked VS Code checks.
- `docs/roadmap.md`: tick the two items when done.

## Out of scope

Drag & drop (next cycle, builds on this), Exclude for old-style projects, editing items other than the four types above.
