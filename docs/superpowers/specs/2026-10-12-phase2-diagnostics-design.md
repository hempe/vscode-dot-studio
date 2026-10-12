# Phase 2: Build Tasks and Diagnostics in the Solution Explorer

Roadmap: README "Phase 2: Errors in the Problems Panel and the Solution Explorer".

## Goals

- Build/Rebuild/Clean/Restore run as VS Code tasks with the `$msCompile` problem matcher, so errors land in the Problems panel and link to file and line.
- Ctrl+Shift+B builds the solution (via a task provider, not a keybinding override).
- The Solution Explorer marks files with errors/warnings (infos opt-in) and rolls the most severe state up to nested parent files, folders, projects, solution folders and the solution, updating live.

## 1. Build tasks

New `src/services/dotnetTaskProvider.ts`, registered in `extension.ts` with `vscode.tasks.registerTaskProvider('shinobi-dotnet', ...)`.

- `package.json` `contributes.taskDefinitions`: type `shinobi-dotnet`, required `action` (`build` | `rebuild` | `clean` | `restore`) and `target` (absolute path to the solution or project file).
- `provideTasks` returns all four actions for the active solution and for each of its projects. All tasks use group `vscode.TaskGroup.Build`. The solution `build` task has `group.isDefault = true`, so Ctrl+Shift+B runs it unless the user's `tasks.json` defines its own default build task.
- `resolveTask` builds the task from its definition, so tasks referenced in `tasks.json` work too.
- Task name: `<action> <TargetName>`, e.g. `build MySolution`.
- Execution: `ShellExecution` with the `dotnet` command and arguments, `cwd` = directory of the target.
  - build: `dotnet build "<target>" -nologo -consoleLoggerParameters:NoSummary -property:GenerateFullPaths=true`
  - rebuild: the same with `--no-incremental`
  - clean: `dotnet clean "<target>" -nologo -consoleLoggerParameters:NoSummary`
  - restore: `dotnet restore "<target>"`
- Problem matcher: `$msCompile` (built into VS Code) on build, rebuild and clean. Restore gets no matcher.
- A pure helper `createDotnetTask(action, targetPath)` constructs the task, so it can be tested on its own.

`SolutionActionService._handleBuild` and `_handleRestoreDependencies` stop creating terminals. They call `vscode.tasks.executeTask(createDotnetTask(...))`.

## 2. Diagnostics aggregation

New `src/services/diagnosticsService.ts` (extension host).

- Subscribes to `vscode.languages.onDidChangeDiagnostics`, debounced by about 300 ms, and reads `vscode.languages.getDiagnostics()`. The result merges `$msCompile` build output with the C# language server.
- Per-file counts: `Map<normalizedPath, { errors, warnings, infos }>`.
  - Duplicates are removed per file by (start line, code, message). This handles the same error from both the build and the language server, and repeated errors from multi-target builds.
  - Error and Warning always count. Information counts only when the `dotnet.solutionExplorer.diagnostics.showInfos` setting is on (boolean, default `false`). Hint never counts.
  - Only `file:` URIs count.
- Fires an `onDidChange` event after each recompute. Changing the setting also triggers a recompute.

Rollup is a pure function in `src/services/diagnosticsRollup.ts`. Its input is the per-file counts and a list of node descriptors `{ nodeId, kind, path, childNodeIds? }`; its output is `Record<NodeIdString, NodeMarker>`:

```ts
interface NodeMarker {
    severity: 'error' | 'warning' | 'info';
    errors: number;
    warnings: number;
    infos: number;
}
```

- **file**: its own counts plus those of its nested child files (e.g. `Form.Designer.cs` under `Form.cs`).
- **folder** and **project**: the sum over every file whose path lies under the folder or project directory. Matching is by path prefix, so it works for collapsed nodes whose children were never loaded.
- **solution folder**: the sum of its child nodes (projects, solution items, nested solution folders), taken from the solution model.
- **solution**: the sum over all projects and solution items.
- `severity` is the most severe non-zero count. Nodes with all counts at zero are left out.

The provider (`SolutionWebviewProvider`) builds the descriptors from the loaded tree plus the `Solution` model. The extension host decodes node IDs with `nodeIdService`.

## 3. Messaging and rendering

- New UI message in `src/types/commands/ui.ts`: `{ type: 'diagnostics', payload: { markers: Record<NodeIdString, NodeMarker> } }`.
- The provider sends it:
  - when `DiagnosticsService` changes
  - right after it sends `solutionData`
  - after a node expands, since new descendants become visible
- The webview keeps the latest markers in state and passes `marker` to each `TreeNode`. The webview does no rollup.
- `TreeNode` rendering:
  - name colour: `var(--vscode-list-errorForeground)` for an error, `var(--vscode-list-warningForeground)` for a warning, unchanged for info
  - file nodes: a right-aligned count badge showing the count at the node's severity
  - other nodes: a small right-aligned dot in the severity colour (`--vscode-editorInfo-foreground` for info)
  - tooltip (`title`): e.g. "2 errors, 5 warnings"

## 4. Docs

- README: tick off the Phase 2 items. Note that build markers are reliable after a (re)build, as in Visual Studio. Mention `"dotnet.backgroundAnalysis.compilerDiagnosticsScope": "fullSolution"` for live errors in unopened files.

## 5. Testing

- `diagnosticsRollup` (pure):
  - file, nested file, folder prefix, project, solution folder and solution rollup
  - severity selection; zero counts left out
  - prefix false positives (`/a/Foo` must not match `/a/FooBar/x.cs`)
- `DiagnosticsService` counting:
  - deduplication
  - the infos setting
  - hints and non-file URIs ignored
- `createDotnetTask`:
  - command and arguments for each action
  - matcher present except for restore
  - Build group, default only for the solution build
- `TreeNode`: renders the colour class, badge and dot, and the tooltip text.

## Known limitations

- VS Code clears `$msCompile` problems per task run. Building one project does not clear stale build errors that an earlier solution build left on other projects.
- Projects that include files from outside their directory (linked files) do not roll those files up.
