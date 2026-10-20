# Solution Explorer

The solution as Visual Studio shows it: solution folders, projects, their files and dependencies. It reads `.sln` and `.slnx` files and edits them when you add, remove or rename things.

## The tree

| Node | What it is |
|---|---|
| Solution | The `.sln` / `.slnx` file |
| Solution folder | A virtual folder in the solution file (not on disk); holds projects, other solution folders and solution items |
| Solution item | A file listed in a solution folder, e.g. a README or `Directory.Build.props` |
| Project | A `.csproj`, `.vbproj` or `.fsproj`. The **startup project** is shown in **bold** |
| Folder, file | What is in the project's folder. SDK-style projects include files by location, and so does the tree (`bin`, `obj` and similar are left out) |
| Dependencies | The project's references, see below |

**File nesting** works like Visual Studio's: `Index.cshtml.cs` sits under `Index.cshtml`, `Form1.Designer.cs` under `Form1.cs`, `appsettings.Development.json` under `appsettings.json`. Renaming the parent renames the nested files with it. The setting `shinobi.solutionExplorer.fileNesting` switches it off or adds Visual Studio's web rules (`site.min.js` under `site.js` under `site.ts`), like Visual Studio's File Nesting button.

**Icons** come from your file icon theme (`workbench.iconTheme`: Seti, Material Icon Theme, vscode-icons, ...). Dependencies, and solutions and projects the theme has no icon for, use built-in icons.

The tree follows changes on disk: new, deleted and renamed files, edited project and solution files.

## Title bar

| Button | What it does |
|---|---|
| ⚙ Solution Configuration | Debug or Release (and other configurations of the solution) for builds, F5 and tests. The active one shows next to the view title; its menu also has the platform, the startup profile and the [Configuration Manager](configuration-manager.md) |
| Select Framework | The target framework of multi-targeted startup projects |
| ▷ Start Debugging | F5: starts the selected launch configuration, normally the startup project |
| ▷ Start Without Debugging | Ctrl+F5: runs the startup project without the debugger |
| ⇄ Sync with Active Document | Opens the tree down to the file in the active editor and selects it (Ctrl+[, S). To do this on every switch of files, turn on `shinobi.solutionExplorer.trackActiveItem` (Visual Studio's "Track Active Item") |
| Collapse All | Collapses everything; the solution keeps showing its top level |

## Keyboard

Click a node or use the arrow keys: Up/Down move, Right expands, Left collapses or goes to the parent, Enter opens a file or expands a node, Home/End go to the first/last node. Type a name to jump to it, like in Visual Studio.

| Key | Command |
|---|---|
| F2 | Rename |
| Delete (macOS: Cmd+Backspace) | Delete or remove the node |
| Ctrl+C / Ctrl+X / Ctrl+V | Copy, cut and paste files and folders |
| Ctrl+[, S | Sync with Active Document (also from the editor) |
| Ctrl+K, Ctrl+E | [Code Cleanup](code-cleanup.md) of the open C# file (in the editor; the tree menu has it on solution, project, folder and file) |
| Ctrl+Shift+B | Build the solution |
| F5 / Ctrl+F5 | Start with / without debugging |

**Selecting several nodes** works like in Visual Studio: Ctrl+click (macOS: Cmd+click) adds or removes a node, Shift+click selects the range from the last clicked node. Right-clicking a selected node opens the menu for the selection; these commands then act on all selected nodes that offer them, asking once: Delete, Remove from Solution, Remove (references, solution items), Copy, Cut (Paste puts them all into the target), Build, Rebuild and Clean (one after the other). The other commands act on the clicked node. Right-clicking a node outside the selection selects only that node.

On the solution node, **Configure Startup Projects...** opens the tab for one startup project or a [profile of several](run-and-debug.md#startup-profiles-several-startup-projects), and **Configuration Manager...** the [Configuration Manager](configuration-manager.md).

Sync Namespaces, on projects and folders, is described in [Sync Namespaces](sync-namespaces.md). Every right-click menu, command by command: [Context menus](context-menus.md). All keys, including Visual Studio's in VS Code: [Keyboard shortcuts](keyboard-shortcuts.md).

## Dependencies

Under each project:

| Node | Shows |
|---|---|
| **Analyzers** | The project's analyzers and source generators: from .NET, from NuGet packages and from projects referenced as analyzers. Generators expand to the files they generated in the last build; those open read-only |
| **Packages** | The NuGet packages the project references, with their versions. Each package expands to the packages it depends on, as many levels deep as they go, with the versions the last restore resolved |
| **Projects** | Project references |
| **Assemblies** | References to `.dll` files |

**Generated code is from the last build.** Builds started by this extension (Build, Rebuild, F5, tests) write what the source generators produce to `obj/<configuration>/<framework>/generated/`, and the tree shows that. A project that was up to date before needs one Rebuild. Packages expand once the project has been restored (a build restores too).

## Errors in the tree

Files with errors or warnings get a red or yellow squiggly underline and a count; folders, projects, solution folders and the solution show a dot when anything below them has problems.

The markers come from the last build, as in Visual Studio, plus the C# language server's live errors for open files. Which severities are marked follows the Error List's Errors / Warnings / Messages toggles. See [Error List](error-list.md).

## Opening solutions

The extension opens the solution of the folder you opened: a `.sln` or `.slnx` directly in it, or else one in its subfolders (up to three levels down, skipping `bin`, `obj`, `node_modules` and hidden folders). With several, you pick one, and the choice is remembered for the workspace.

In a **multi-root workspace**, every folder is searched; the folder that holds the solution is where its `.vscode/launch.json`, tasks and tool manifests go.

**Open Solution...** in the title bar's `...` menu (or **.NET: Open Solution...**), like Visual Studio's File > Open > Solution, lists the solutions of the workspace and offers **Browse...** for any other `.sln` or `.slnx`. The solution you open is the one that opens next time.

## .sln and .slnx

`.slnx` is the current solution format (XML, readable diffs), the default since the .NET 10 SDK and supported by Visual Studio 2022 17.13 and later. When a `.sln` opens, you are offered to convert it:

- **Convert** runs `dotnet sln migrate` (needs the .NET SDK 9.0.200 or later), which writes the `.slnx` next to the `.sln` with the same projects, solution folders and configurations. Then you choose whether to delete the `.sln`: teammates on Visual Studio before 2022 17.13 still need it, and with both files you are asked which solution to open each time. The `.slnx` opens either way; the startup project and Debug/Release stay as they were.
- **Not Now** asks again next time; **Don't Ask Again** never asks again for this solution in this workspace.

There is no offer when a `.slnx` of the same name already exists.

## Unload and reload projects

**Unload Project** on a project (like Visual Studio's) leaves it out of solution builds: the project stays in the tree, greyed out as "(unloaded)", collapsed and without files, and its menu shrinks to Reload Project, Edit Project File, Remove, Delete and the path commands. Build, Rebuild, Clean and Restore on the solution (and Ctrl+Shift+B) then run through a solution filter of the other projects, which the extension writes to your temp folder. **Reload Project** takes it back.

Unloaded projects are remembered per workspace and solution, not stored in the solution file. A loaded project that references an unloaded one still builds it, and building the unloaded project itself (or starting it with F5) still works.

## Moving the Solution Explorer

`shinobi.solutionExplorer.location`: `sidebar` (default) or `secondary-sidebar`, the side bar on the right, like Visual Studio's.
