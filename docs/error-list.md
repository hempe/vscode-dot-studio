# Error List

Visual Studio's Error List, in the panel next to Problems, Output and Terminal: errors, warnings and messages as a table.

| Column | |
|---|---|
| (severity) | Error, warning or message |
| Code | The diagnostic code (CS0103, CA1822, IDE0090, ...), linked to its documentation |
| Description | The message |
| Project | The project of the file |
| File, Line | Where it is; double-click or Enter opens the file at the line |

- **Errors / Warnings / Messages** toggles show or hide each severity. Messages are infos and suggestions (the editor's `···` hints), which VS Code's Problems panel never shows; they are off by default. The toggles are the settings `shinobi.diagnostics.showErrors`, `showWarnings` and `showInfos`, and also decide which markers the [Solution Explorer](solution-explorer.md#errors-in-the-tree) shows.
- **Sort** by any column (click its header), **search** all columns, and **filter** Code, Project and File by their values (the filter icon in the header), like Visual Studio's column filters.
- The tab badge shows the number of errors.

## Problems of one node

Click the count or the dot next to a node in the Solution Explorer: the Error List opens with only the problems of the files that node's marker adds up (a file, a folder, a project, a solution folder). A chip with the node's name appears in the toolbar; click it to show the whole solution again. The toggles' counts then are the node's.

## Where the entries come from

1. **The last build.** Build, Rebuild and F5's pre-build run with VS Code's `$msCompile` problem matcher; their errors and warnings are reliable for the whole solution, as in Visual Studio after a build.
2. **The C# language server**, live, for open files. For live errors in all files, set `"dotnet.backgroundAnalysis.compilerDiagnosticsScope": "fullSolution"` (slower on big solutions).

The same problem from both sources shows once.

**Known issue:** building a single project doesn't clear errors that an earlier solution build reported for other projects; build the solution again.
