# Phase 19, part 2: drag & drop in the Solution Explorer

Covers the "Drag & drop of files, folders and projects" item of Phase 19 in `docs/roadmap.md`. Builds on the project items model (`2026-10-21-project-items-model-design.md`).

## Goal

Move things in the tree by dragging, as Visual Studio does: files and folders into other folders and projects, projects and solution folders into solution folders, solution items between solution folders.

## Scope

In:
- Files and folders within the tree (within a project and between projects).
- Projects and solution folders into solution folders or to the solution root.
- Solution items between solution folders.

Out (recorded under "Known limitations" in the roadmap):
- Drops from outside the tree (VS Code Explorer, the OS file manager): a webview gets no file paths from OS drops, so there is no sensible implementation to promise.
- Dropping a project on another project's Dependencies node to add a reference (Add Project Reference covers it; not confirmed as Visual Studio behaviour).

## Today

No drag support exists. Cut/Paste of files and folders is implemented in `SolutionActionService._handleCut` / `_handlePaste` / `_pasteOne` (name collision prompt, namespace update prompt for moved C# files). `Solution` can add and remove solution folders, projects and solution items, but has no operation that moves one to another solution folder. `.sln` keeps the hierarchy in `GlobalSection(NestedProjects)`; `.slnx` encodes it in the folder `Name="/a/b/"`.

## Rules (Visual Studio)

| Dragged | Valid targets | Default | With Ctrl (Cmd on macOS) |
|---|---|---|---|
| file, folder | folder, project, file (means its parent folder) | move | copy |
| project | solution folder, solution (root) | move | move |
| solution folder | solution folder, solution (root), not itself or a descendant | move | move |
| solution item | solution folder | move | move |

- Several selected nodes are dragged together; nodes that do not fit the target are left out, and if none fit the drop is invalid.
- A folder cannot be dropped onto itself or into its own descendants; a node dropped where it already is does nothing.
- Nodes without a move (Dependencies, packages, analyzers, generated files, linked files, unloaded projects, the solution node, nodes of a tree being renamed) are not draggable.
- Everything else is not a valid target.

## Design

### Shared validity rules

`src/core/dropRules.ts`: pure, no `vscode`/Node imports (loaded by the webview and the extension host). `canDrop(dragged: DragNode[], target: DropTarget): DropVerdict` where nodes carry type, id and an opaque path-free description the webview already has (type, nodeId, parent chain of nodeIds). The webview uses it to show the drop highlight; the extension runs it again on the message (never trust the webview). Cycle checks (a solution folder into its descendant) use the parent chain of node IDs, not paths.

### Webview

- Draggable rows (`draggable`, `onDragStart`) set `dataTransfer` to the selected node IDs (dragging an unselected row drags just that row, as for the context menu); `effectAllowed = 'copyMove'`.
- `onDragOver` on a row asks `canDrop`; valid: `preventDefault`, set `dropEffect` to `copy` if Ctrl/Cmd is held and the drag is files/folders, else `move`, add the `drop-target` class (highlight). Invalid: no `preventDefault` (cursor shows not-allowed).
- Hovering a collapsed expandable valid target for about 700 ms expands it (the existing `onToggleExpand`).
- `onDrop` sends `moveNodes { nodeIds, targetNodeId, copy }` (new `BackendCmd`).
- No drag while a rename is in progress.

### Extension host

- `SolutionWebviewProvider` handles `moveNodes` and calls `SolutionActionService.moveNodes(nodeIds, targetNodeId, copy)`.
- It decodes the IDs, re-validates with `canDrop`, then:
  - files/folders: for each source, `_pasteOne(source, targetFolder, copy ? 'copy' : 'cut')` (a file target means its parent folder, a project target its project folder); then the namespaces, see below.
  - projects, solution folders, solution items: `Solution.moveToSolutionFolder(kind, id, targetFolderGuid | undefined)`.
- Errors show a message; the tree refreshes through the normal solution/project change events.

### Namespaces after a move

Moving a C# file to another folder or project changes the namespace it should have. Today `_pasteOne` checks this only for a single moved `.cs` file, and asks once per file (a modal each); a moved folder is not checked at all (folder rename is). Dragging would make both visible, so the shared move path is fixed and Cut/Paste gets the same behaviour:
- After a move (not after a copy), the C# files that were moved are collected: the file itself, or for a folder every `.cs` file under it (`NamespaceService.getCSharpFilesInDirectory`), at their new location.
- One prompt per drop, the one the folder rename uses: Update All, Review Each, Skip (`_updateNamespacesInFiles`); with a single file, the existing single-file prompt.
- Files whose namespace already matches the new location are not counted; if none need an update there is no prompt.
- Nothing is changed without the user's choice, as today.

### Solution file moves

`Solution.moveToSolutionFolder(kind: 'project' | 'solutionFolder' | 'solutionItem', id, targetFolderGuid?)`:
- `.sln`: change or remove the entry of the node in `NestedProjects` (add/remove helpers exist); solution items move between the `ProjectSection(SolutionItems)` blocks of the two folders.
- `.slnx`: the folder hierarchy is in `Name`; moving a solution folder renames it and every solution folder below it (`/a/b/` to `/c/b/`), and projects and items sit inside `<Folder>` elements that are moved as XML nodes. Edits go through `parsers/solutionXFileEditor.ts` as text edits that keep the formatting.
- Duplicate names: moving into a folder that already has a folder or project with the same name is refused with a message.

## Testing

- `dropRules`: every row of the table, multi-select filtering, descendant and self cycles, drop on the same parent is a no-op.
- `.sln` and `.slnx` reparenting on fixtures (`src/__fixtures__/solution-hierarchy`): project to folder, folder to folder (with children), to root, solution item between folders, duplicate name refused, cycle refused; unrelated lines and formatting unchanged.
- File moves and copies through the paste path with a temp folder, and the namespace step: a moved folder with several `.cs` files gives one prompt, a copy gives none, files that already match give none.
- TreeNode/SolutionTree drag tests in the webview (drag start payload, valid and invalid highlight, drop message, Ctrl copy, no drag while renaming).
- The webview bundle test stays green (`dropRules` must not pull in `vscode`).

## Docs

- `docs/solution-explorer.md`: a drag & drop section with the table above (what can go where, Ctrl to copy).
- GIF scene in `scripts/screenshots/capture.sh`: drag a file into a folder, a project into a solution folder.
- `docs/manual-testing.md`: unticked checks (drag cursor and highlight, auto-expand, Ctrl copy, `.sln` and `.slnx` moves open in Visual Studio, multi-select).
- `docs/roadmap.md`: tick the item, add the two out-of-scope cases under "Known limitations".

## Not doing

Drops from outside the tree, project-reference drops, reordering of nodes (the tree is sorted), undo.
