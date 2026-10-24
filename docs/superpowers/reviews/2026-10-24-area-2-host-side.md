# Code Review, Area 2: Solution Explorer Host Side (2026-10-24)

Scope: `src/webview/providers/` (SolutionWebviewProvider, nativeContextMenu, NuGetCustomEditorProvider host parts, the other panels' message handling, the HTML shells' CSP), `services/solutionTreeService.ts`, `solutionExpansionService.ts`, `solutionActionService.ts`, `types/commands/*`, `core/contextMenus.ts` (+ generated package.json/doc), `extension.ts`.

Method: everything in scope read in full; proofs run as jest scratch tests in a copy of the repo (`/tmp/rev2/repo`, `node_modules` symlinked, files `src/review/area2.test.ts` and `src/review/refreshCount.test.ts`, the second built on the setup of `moveNodes.test.ts` with the `solution-hierarchy` fixture). No VS Code was started. The existing tests of the area (`contextMenus`, `moveNodes`, `solutionExpansionService.*`, `nodeIdService`) pass (6 suites, 51 tests). Known bugs and Not Planned items of `docs/roadmap.md` were left out.

## Summary

| Id | Severity | Proven? | One line |
|---|---|---|---|
| A2-1 | bug | proven | Delete Project trashes `dirname(project)`: a project next to its `.sln` takes the whole solution folder (other projects, `.git`) with it |
| A2-2 | bug | proven | Add > New File with the name of an existing file empties that file (`writeFile(path, '')`, no existence check, not via trash) |
| A2-3 | bug | proven | Remove on a Dependencies node rewrites the whole project file with xml2js (comments and blank lines lost) and removes other project references whose name ends in the same name (`Core` also removes `MyCore`) |
| A2-4 | bug | proven | Tree refreshes requested while a rebuild runs are dropped (`DebounceManager._process` skips instead of re-scheduling): the tree stays stale |
| A2-5 | bug | proven (emulated `Uri.parse`) | NuGet manager for a project whose path contains `&`, `+`, `#` or `%` opens for the wrong target or fails (path packed into an `untitled:` URI query and decoded three times) |
| A2-6 | bug | proven | Rename and new file/folder names are not validated: `../x` or `a/b` moves or creates outside the folder (also outside the project/workspace) |
| A2-7 | bug | proven | Creating a file or folder stores the temporary node's id (with timestamp) as "expanded": one never-pruned entry per creation, one `[ERR]` log line per entry on every tree rebuild |
| A2-8 | risk | proven (listener count), VS Code re-resolve from the API docs | `resolveWebviewView` adds an active-editor listener each time without disposing the old one; no `onDidDispose` handling (`_view` points to a disposed webview) |
| A2-9 | risk | proven | Every file operation re-parses every project of the solution, a drop/paste once per item: 3 files dropped in a 5-project solution = 15 `Project.refresh()` calls, plus one more round from the provider |
| A2-10 | risk | proven (code) | The host trusts node ids and paths from the webview: ids are self-describing JSON, only `moveNodes` checks them against the solution; a malformed id makes the handler reject unhandled |
| A2-11 | risk | proven (bundle grep) | Solution Explorer webview loads icons from `api.iconify.design` (third-party, needs network); its CSP allows `connect-src https:` and `'unsafe-eval'` (the bundle has no eval) |
| A2-12 | risk | suspected | An expand that arrives while a rebuild runs is applied to the old tree and lost when the new tree replaces it (node collapses again) |
| A2-13 | risk | suspected | Configuration Manager and Configure Startup Projects listen to the solution open when the tab opened; after Open Solution or a solution rename they stop refreshing |
| A2-14 | cleanup | proven (grep) | Dead messages and code: `loading`, `setFramework` (+ `frameworks` sent with every tree), `removeTemporaryNodes` (never matches), `_isRenaming`, the `':'` branch of collapse (so folder watchers are never removed), `firstLoad`, `parseNodeId`, `MessageData` |
| A2-15 | cleanup | - | `solutionActionService.ts` (1709 lines) should be split; proposal below |
| A2-16 | cleanup | proven (code) | Provider not in `context.subscriptions` (its `dispose()` and the debounce timer never run); unhandled promise rejections in event listeners; noisy `info` logging of whole models on every rebuild |

## Findings

### A2-1 (bug, proven): Delete Project trashes the solution folder when the project sits next to the `.sln`

`src/services/solutionActionService.ts:868-876`: after "Delete", the handler removes the project from the solution and then deletes `path.dirname(projectPath)` recursively (to the trash). Nothing checks that this directory holds only this project: the solution file, other projects in subfolders (a test project under `App/Tests/`), `.git`, `.vscode` go with it.

Scenario: `dotnet new console -n App -o .` and `dotnet new sln` in the same folder (very common for small solutions), or a repo where `App.csproj` is at the root and the tests are below it. Delete on project App: the whole repository folder goes to the trash, the extension then shows an empty tree.

Proof (`area2.test.ts`, test I, solution `/repo/App.sln`, project `/repo/App.csproj`, answer "Delete"):

```
I: deleted [{"path":"/repo","options":{"recursive":true,"useTrash":true}}]
```

Visual Studio only removes a project from the solution; when we keep Delete, it should refuse (or delete only the project file and its own items) when the directory contains the solution file, another project of the solution or anything above the project's own items. On file systems without a trash (remote, some WSL setups) `useTrash` may fail or delete permanently: not checked.

### A2-2 (bug, proven): Add > New File overwrites an existing file with an empty one

`src/webview/providers/SolutionWebviewProvider.ts:666-679` → `SolutionActionService.createFile` (`solutionActionService.ts:1298-1317`): `fs.writeFile(filePath, '', 'utf8')` without checking whether the file exists. The webview does not check names either (`TreeNode.tsx:131-153`).

Scenario: "Add File..." on a folder, type `Program.cs` (already there): `Program.cs` is now empty, not in the trash, no undo (only an open editor with the old text saves the user).

Proof (test D, `Program.cs` with 40 characters, then the confirm message the webview sends):

```
D: Program.cs now has 0 chars; ...
```

Fix: refuse an existing name (Visual Studio says the file exists), `writeFile` with flag `wx`.

### A2-3 (bug, proven): Remove on a dependency rewrites the project file and over-matches project references

`solutionActionService.ts:1098-1261` (`_removeDependencyFromCsproj`, used by the single and the multi-select Remove on Dependencies > Packages/Projects/Assemblies): parses the project file with xml2js and writes `builder.buildObject(...)` back.

1. The whole file is re-serialised: XML comments are dropped, blank lines removed, indentation forced to two spaces, CRLF becomes LF, empty item groups vanish. The rest of the code base edits project files as text (`ProjectFileEditor`, `projectItemEdits`) for exactly this reason.
2. Project references match with `include.includes(dependencyName + '.csproj')` and `endsWith`: removing `Core` also removes `..\MyCore\MyCore.csproj` (and `FooCore`, ...).
3. Strong-named assembly references (`<Reference Include="Legacy, Version=1.2.0.0, ...">`, as Visual Studio writes them) are compared with the short name (`include !== 'Legacy'`): never removed, "Failed to remove Legacy from App".
4. Packages bypass the NuGet manager's `uninstallPackages` (CPM-aware: orphan `PackageVersion`, packages from `Directory.Build.props`): a package from an imported props file gives "Failed to remove", and under CPM the `PackageVersion` stays without the question the NuGet manager asks.

Proof (test B, project with a comment and references to `..\Core\Core.csproj` and `..\MyCore\MyCore.csproj`, Remove `Core`):

```
B: result true
--- after ---
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>
```

Both references and the comment are gone. Test J: Remove on `Legacy, Version=1.2.0.0, ...` returns `false`.

### A2-4 (bug, proven): refresh triggers during a running rebuild are lost

`src/services/debounceManager.ts:126-130`: when the timer fires while the callback is still running, `_process` logs "Already processing, skipping" and returns; the timer is gone, nothing runs later. `SolutionWebviewProvider._updateViewDebouncer` (`SolutionWebviewProvider.ts:76-107`) rebuilds the tree in that callback with several awaits (`buildSolutionTree`, `restoreExpansionStates` loading the children of every expanded node, `_revealDrop`), so every `refresh()` / `handleFileChange` / `solution.onDidChange` that arrives during a rebuild after the model was read is dropped.

Scenario: a build ends (`onDidEndTaskProcess` → `refresh()`, new source generator output under Analyzers) or a file is created by a tool while the tree is being rebuilt after a save: the tree keeps the old state until some unrelated later change. Same for `_triggerImmediateTreeRefresh`, which `await`s `trigger()` (returns `void`, so it does not wait at all).

Proof (test A, callback taking 300 ms, a second trigger 150 ms after the first):

```
A: callback ran 1 time(s) for 2 triggers
```

Fix: remember a pending trigger while processing and run once more afterwards.

### A2-5 (bug, proven by emulating `Uri.parse`): NuGet manager breaks for paths with `&`, `+`, `#`, `%`

`src/webview/providers/NuGetCustomEditorProvider.ts:245-249` and `294-298` build `untitled:<name>.nuget?context=project&target=<encodeURIComponent(path)>`; `_getContextFromUri` (`311-320`) reads it back. The file name part is not encoded (a `#` in the project name ends the path and moves the query into the fragment), and the target is decoded three times: by `Uri.parse` (percent-decoding of the query), by `URLSearchParams` (`+` becomes a space, `&` splits) and by `decodeURIComponent` (a literal `%` throws).

Proof (`/tmp/rev2/uri.js`, VS Code's `URI.parse` regex and percent-decoding copied from `src/vs/base/common/uri.ts`, then the provider's own code):

```
/src/R&D/App/App.csproj                          -> "/src/R"
/src/C++Interop/Interop.csproj                   -> "/src/C  Interop/Interop.csproj"
/src/Shinobi.C#Tools/Shinobi.C#Tools.csproj      -> ""
/src/100%Done/App.csproj                         -> "THROWS URI malformed"
```

The real `vscode.Uri.parse` was not run (only emulated). Fix: keep the target in a map keyed by a generated id, or use `Uri.from({ scheme: 'untitled', path, query })` with a single encoding.

### A2-6 (bug, proven): names from the rename and new item inputs are joined into paths unchecked

- `solutionActionService.ts:408` (file and folder rename): `path.join(path.dirname(oldPath), newName)`.
- `SolutionWebviewProvider.ts:678` and `723` (new file/folder): `path.join(parentPath, fileName)`, with `mkdir -p` of the parent in `createFile`.

Only solution items (`/[\\/]/`) and the solution (`/[\\/:*?"<>|]/`) are validated. Typing `../Shared` moves a folder out of its project, `Sub/Name.cs` creates folders, `../../../x` writes outside the workspace. Visual Studio refuses names with path characters.

Proof (test C, folder `Proj/Models` renamed to `../../Escaped`): the folder ended up at `<tmp>/../Escaped`, outside the test's root (`C: entries of tmp root [ 'Proj' ]`).

### A2-7 (bug, proven): every new file or folder leaves a bogus "expanded" id behind

`SolutionWebviewProvider.ts:692-699` and `739-749` add `parentNodeId` to the stored expansion state, but on confirmation the webview sends the temporary node's id (`TreeNode.tsx:135-150`, id from `NodeIdService.generateTemporaryId`, which contains a timestamp and a random part). The real parent is not kept expanded by this code, and each creation adds a unique id to `workspaceState['solutionTreeExpanded']` that `restoreExpansionStates` never removes (it only drops ids that fail to decode). Each rebuild then logs one `[ERR] Failed to update expansion state for node` per such id (`solutionExpansionService.ts:538-541`); the list grows with every file created. The same never-pruned growth happens for expanded folders that were deleted or renamed.

Proof (test D): the stored ids after one New File are `[{ type: 'temporary', path: '/tmp/rev2-04s8Qa', nodeType: 'file', timestamp: 1792842371108, random: 'f4hl9p' }]`; after `restoreExpansionStates` the id is still there and the log shows `[ERR] SolutionExpansionService: Failed to update expansion state for node: eyJ0eXBlIjoidGVtcG9yYXJ5Ii...`.

### A2-8 (risk; listener leak proven, VS Code's re-resolve taken from the API docs)

`SolutionWebviewProvider.ts:115-170`: `resolveWebviewView` assigns `this._activeEditorListener = vscode.window.onDidChangeActiveTextEditor(...)` without disposing the previous one; `onDidReceiveMessage` and `onDidChangeVisibility` are registered with throwaway disposable arrays; there is no `webviewView.onDidDispose`. VS Code calls `resolveWebviewView` again when a view is hidden and shown again (API doc of `resolveWebviewView`; the view has no `retainContextWhenHidden`), and the same provider instance serves both registered views (`extension.ts:156-165`, `shinobi.solutionExplorer.location`). Each re-resolve adds one more active-editor listener, so each editor switch posts `activeFileChanged` (and with `trackActiveItem` runs `syncWithActiveDocument`, which sends the whole tree) once per past resolve. After the view is disposed, `_view` still points to it; per the API docs, using a disposed view throws.

Proof (test E, three resolves):

```
E: 3 listeners registered, 0 disposed
```

`ErrorListViewProvider.resolveWebviewView` (`ErrorListViewProvider.ts:31-37`) has the same pattern (smaller: it retains its context).

### A2-9 (risk, proven): file operations re-parse every project of the solution

`_pasteOne` (`solutionActionService.ts:1646-1650`) calls `solution.forceRefreshAllProjects()` after every single item; `SolutionWebviewProvider._triggerImmediateTreeRefresh` (`780-795`) does it again after rename, delete, remove project, add existing item, folder creation (twice) and every drop; `moveNodes` additionally calls `handleFileChange(solutionPath)`. `forceRefreshAllProjects` runs `Project.refresh()` = `parseProjectFile()` + `reloadLoadedFolders()` + a change event, for every project.

Proof (`refreshCount.test.ts`, fixture with 5 projects, Ctrl+drop of 3 files onto a project, only `SolutionActionService.moveNodes`):

```
H: 5 projects, Project.refresh called 15 times for a drop of 3 files
```

The provider adds 5 more. In a 100-project solution a drop of 20 files means 2100 project parses and folder reloads for one gesture; the folder watchers and project watchers already report these changes. Not measured in a real 100-project solution.

### A2-10 (risk, proven from code): the host trusts ids and paths from the webview

Node ids are base64url JSON (`nodeIdService.ts:165-175`); whoever controls the webview can name any path and type. Only `moveNodes` re-checks against the solution (`solutionActionService.ts:1522-1535`, `solutionDropNode`). Every other `projectAction` acts on the decoded path: `deleteFile`/`deleteProject` (with a confirmation), `rename`, `addFile` (writes), `openInTerminal`, `removeDependency` (rewrites any XML file named in the id), `excludeFromProject`. In the NuGet editor, `installPackage`/`uninstallPackage` take `projects: string[]` from the webview and edit those files without checking they belong to the solution (`NuGetCustomEditorProvider.ts:452-471`). Payload shapes are not validated (`treeSelectionChanged.nodeIds`, `data.newName`, `data.name`), and `NodeIdService.parse` throws on a malformed id, so `SolutionActionService.handleProjectAction`'s `if (!nodeId)` (`63-66`) is unreachable and the provider's handler rejects with nothing catching it (`webviewView.webview.onDidReceiveMessage(message => this._handleMessage(message))`).

Proof: test F (`_handleMessage` with `nodeId: 'not-an-id'` rejects with `Failed to parse nodeId`), test G (a hand-made id `{type:'project', path:'/etc/passwd'}` decodes to that path).

Low exposure today (our own React bundle, nonce CSP, React escapes names), but one XSS in a webview would reach the file system. Suggestion: one guard in `_handleMessage` that looks the id up in the cached tree (or `solutionDropNode`) before any action, and a try/catch with a log line around the handler.

### A2-11 (risk, proven by grep of the bundle): third-party icon requests and a wide CSP

`TreeNode.tsx` uses `@iconify/react`'s `<Icon icon="mdi:...">` (28 icon names) without bundled collections; that component fetches icon data at runtime from `https://api.iconify.design` (fallbacks `api.simplesvg.com`, `api.unisvg.com`; all three are in `node_modules/@iconify/react/dist/iconify.js`, and `api.iconify.design` is in `out/webview/solution-view/bundle.js`). The CSP in `views/SolutionWebview.ts:23` allows it with `connect-src https: data:`. Effects: the Solution Explorer contacts a third-party server from the user's machine (offline or behind a proxy the icons are missing), which corporate users may not expect. The same CSP has `'unsafe-eval'`, also `NuGetWebview.ts:25`; the built solution and NuGet bundles contain no `eval(` or `new Function` (grep), so it looks unnecessary. Network traffic was not captured; this is from the library code and the CSP. (The rendering side belongs to area 3.)

### A2-12 (risk, suspected): an expand during a rebuild is lost

`handleExpandNode` (`solutionExpansionService.ts:47-205`) mutates the `cachedSolutionData` array it was given and saves the expansion state computed from it; the debounced rebuild meanwhile has already read the saved state in `restoreExpansionStates` and replaces `_cachedSolutionData` with its own tree when it finishes (`SolutionWebviewProvider.ts:83-89`). An expand whose awaits (`getRootChildren`, `analyzerChildren`) overlap a rebuild therefore ends up in a tree that is thrown away; the next `solutionData` shows the node collapsed. Also `getExpandedNodePaths` replaces the stored set with what the old tree holds, dropping ids the rebuild just restored elsewhere. Not reproduced (needs a slow evaluation during a rebuild); suggestion: apply webview requests to the current cache after the awaits, or serialise them with the rebuild.

### A2-13 (risk, suspected): Configuration Manager and Startup Projects tabs keep the first solution

`ConfigurationManagerPanel.watchSolution` (`ConfigurationManagerPanel.ts:63-68`) and `StartupProjectsPanel.watchSolution` (`StartupProjectsPanel.ts:66-77`) subscribe once, to the solution active when the tab opened (and the latter watches that solution's `.slnLaunch*`). After Open Solution... or renaming the solution (both load a new `Solution`), the tab edits the new solution (`handle` uses `getActiveSolution()`) but no longer refreshes when it changes on disk. Not run.

### A2-14 (cleanup, proven by grep): dead messages and code

- UI message `loading` (`types/commands/ui.ts:96`): neither sent nor handled.
- Backend message `setFramework`: `FrameworkSelector` is never rendered, so nothing sends it; nonetheless every `solutionData` (also every expand) carries `frameworks` and `activeFramework` (`SolutionWebviewProvider.ts:518-526`).
- `removeTemporaryNodes` (`SolutionWebviewProvider.ts:729-734`) sends a file system path that the webview compares with node ids (`useVsCodeApi.ts:159-163`): never matches; the commented-out copy at `683-690` and `//return this._triggerImmediateTreeRefresh` at `701` are leftovers.
- `_isRenaming` (`SolutionWebviewProvider.ts:42`, `445`) is never set.
- `handleCollapseNode`'s folder branch (`solutionExpansionService.ts:229-248`) parses an old `project:folder` format: on Linux/macOS it never runs, on Windows `C:\...` splits at the drive letter and matches nothing. As a result `Project.removeFolderWatcher` is never called: every folder ever expanded keeps a `FileSystemWatcher` until the project is disposed.
- `SolutionExpansionService.firstLoad` starts `false`, so its filter never runs; `restoreExpansionStates`' `logTreeStructure` walks the tree twice per rebuild and logs nothing.
- `NodeIdService.parseNodeId` alias, `MessageData` and `_handlePaste`'s `_data` parameter unused; `require('path')`/`require('fs')` inside functions next to the top-level imports (`solutionActionService.ts:1078`, `1100-1102`, `1302-1303`, `1326`; `solutionExpansionService.ts:120`, `719`).
- The `error` message to the Solution Explorer is only logged by the webview (`useVsCodeApi.ts:228-231`): a failed tree load shows no message to the user.

### A2-15 (cleanup): split `solutionActionService.ts`

1709 lines, one static class, five unrelated concerns. Proposal (sizes approximate):

| New module | Contents | Lines |
|---|---|---|
| `solutionActions.ts` (dispatcher) | `handleProjectAction`, `handleMultiAction`, `multiSelectActions` | ~300 |
| `fileOperations.ts` | open, rename (files, folders, nested dependents), delete, create file/folder, copy/cut/paste, `_pasteOne`, `moveNodes`, add existing item; one place for the name validation of A2-6 and the existence check of A2-2 | ~450 |
| `solutionStructureActions.ts` | solution folders, solution items, add existing / remove / delete project, rename project and solution, startup project | ~350 |
| `dependencyActions.ts` | add project/assembly reference, restore, remove dependency (rewritten as a text edit with `ProjectFileEditor`, packages through the NuGet services' `uninstallPackages`) | ~150 after the rewrite (330 today) |
| `projectItems/membershipActions.ts` | include/exclude, remove link, `_projectsLinking` | ~130 |

The `projectAction` special cases split between `SolutionWebviewProvider._handleMessage` (addFile/addFolder/addNewItem and the "which actions refresh" lists at `284` and `294`) and the service should move into the dispatcher, so each action declares whether it changes the solution file or the disk instead of the two string lists.

### A2-16 (cleanup)

- `extension.ts:130-136`: `solutionWebviewProvider` is not pushed to `context.subscriptions`, so its `dispose()` never runs and `_updateViewDebouncer` is never cancelled (a pending rebuild can fire after deactivate against the disposed solution).
- Event listeners that return rejected promises with nobody catching: `BuildConfiguration.onDidChange(async ...)`, `StartupChoice.onDidChange(async ...)`, `onDidChangeConfiguration(async ...)` (`extension.ts:228-239`, `292-297`), `startupProfilesChanged(...).then(...)` without `.catch` (`79`), the launch-settings and props watchers (`334-360`).
- Logging in the hot path at `info` (the default level of the output channel): `Got solution data:` dumps the whole `SolutionFile` model on every rebuild (`SolutionWebviewProvider.ts:420`), every webview message with its payload (`247`), one line per project and per path in `buildLazyHierarchicalNodes`, one line per expanded node in `restoreExpansionStates`. In a large solution each rebuild writes hundreds of lines.
- `extension.ts:75`: `filePath.split('/').pop()` gives the whole path on Windows (log only).

## Checked and fine

- Context menus: `contextMenus.ts` is the single source; the generator test keeps `package.json` and `docs/context-menus.md` in sync (passes); every command has a description; key bindings are scoped to `shinobi.solutionExplorer.focusedNodeType`, which the webview clears on window blur and the host on hide (`SolutionTree.tsx:488-504`, `SolutionWebviewProvider.ts:135-140`).
- `moveNodes` re-validates every dropped id and the target against nodes built from the solution (`solutionDropNode` + `canDrop`), refuses unknown ids; drop onto Dependencies goes through `addProjectReferences` (self, existing, circular refused).
- Deletes go to the trash after a modal confirmation; multi-select asks once and names linked files; linked-file delete offers Remove Link.
- Multi-select actions filter the selection by the node types whose menu has the action.
- NuGet editor: every message handled inside one try/catch that reports to the webview; install/uninstall/bulk send their completion message also on error; icons and READMEs are URLs, not fetched by the host.
- Configuration Manager and Startup Projects: requests are validated by `applyRequest`/`planRequest`, which throw before anything is written; panels dispose their subscriptions on close; Publish profile rename validates names.
- Error List: `openUrl` only opens `http(s)` URLs; the HTML title of the wizard shell is escaped.
- Tree building does no per-project process start (`hasAnyChildren` is a constant), activation registers only cheap things before the view is shown.
- Message types: every backend and UI message type except those in A2-14 has a sender and a handler (grep of all `type:` names).
- Message ordering between `_sendSolutionData` and `_cachedSolutionData`: `getAvailableFrameworks` is synchronous, so the only interleaving is the one in A2-12.

## Not reviewed / limits of this review

- Nothing was run inside VS Code: the re-resolve behaviour of `WebviewView` (A2-8), the real `vscode.Uri.parse` (A2-5, emulated), trash behaviour on remote file systems (A2-1) and the network requests of A2-11 are taken from the API docs and library code.
- No real `dotnet`/MSBuild was needed for these findings; A2-12 (timing) was not reproduced, and A2-9 was measured on the 5-project fixture, not a 100-project solution.
- `Solution.ts`, `Project.ts`, parsers and `projectItems/` (area 1), the webview React code (area 3), the NuGet services behind the editor (area 4), and the services the actions call into (templates, publish, service references, debug: areas 5 and 6) were only followed as far as needed for the host-side findings. Command construction in `_handleAddProjectReference` (`terminal.sendText` with the paths in double quotes, so `$(...)` in a path would run in a POSIX shell) belongs to the Known bug that replaces it with `addProjectReferences`.
- Windows and macOS were checked by reading only (A2-14's collapse branch, A2-16's log line); the Windows CI was not run.
