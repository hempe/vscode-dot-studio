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

**File nesting** works like Visual Studio's: `Index.cshtml.cs` sits under `Index.cshtml`, `Form1.Designer.cs` under `Form1.cs`, `appsettings.Development.json` under `appsettings.json`. Renaming the parent renames the nested files with it.

**Icons** come from your file icon theme (`workbench.iconTheme`: Seti, Material Icon Theme, vscode-icons, ...). Dependencies, and solutions and projects the theme has no icon for, use built-in icons.

The tree follows changes on disk: new, deleted and renamed files, edited project and solution files.

## Title bar

| Button | What it does |
|---|---|
| ⚙ Solution Configuration | Debug or Release (and other configurations of the solution) for builds, F5 and tests. The active one shows next to the view title |
| Select Framework | The target framework of multi-targeted startup projects |
| ▷ Start Debugging | F5: starts the selected launch configuration, normally the startup project |
| ▷ Start Without Debugging | Ctrl+F5: runs the startup project without the debugger |
| ⇄ Sync with Active Document | Opens the tree down to the file in the active editor and selects it (Ctrl+[, S) |
| Collapse All | Collapses everything; the solution keeps showing its top level |

## Keyboard

Click a node or use the arrow keys: Up/Down move, Right expands, Left collapses or goes to the parent, Enter opens a file or expands a node.

| Key | Command |
|---|---|
| F2 | Rename |
| Delete (macOS: Cmd+Backspace) | Delete or remove the node |
| Ctrl+C / Ctrl+X / Ctrl+V | Copy, cut and paste files and folders |
| Ctrl+[, S | Sync with Active Document (also from the editor) |
| Ctrl+Shift+B | Build the solution |
| F5 / Ctrl+F5 | Start with / without debugging |

Every right-click menu, command by command: [Context menus](context-menus.md). All keys, including Visual Studio's in VS Code: [Keyboard shortcuts](keyboard-shortcuts.md).

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

## Moving the Solution Explorer

`shinobi.solutionExplorer.location`: `sidebar` (default) or `secondary-sidebar`, the side bar on the right, like Visual Studio's.
