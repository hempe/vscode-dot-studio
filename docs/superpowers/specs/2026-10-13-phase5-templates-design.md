# Phase 5: New Project & New Item Templates — Design

## Findings (SDK 10.0.111)

- `dotnet new list --type project` / `--type item` print a table (`Template Name`, `Short Name`, `Language`, `Tags`) whose column widths follow the dashed line under the header. The default language is shown in brackets (`[C#],F#,VB`); config templates (`gitignore`, `editorconfig`, `nugetconfig`, `globaljson`, `tool-manifest`, `buildprops`, ...) have no language.
- Hidden item templates `class`, `interface`, `enum`, `record`, `struct` exist but have no namespace option: `dotnet new class -n Customer -o Models` in project `Demo` writes `namespace Demo;`, not `Demo.Models`, and takes about a second.
- Some item templates (`apicontroller`, `mvccontroller`, ...) take `--namespace` but default to `MyApp.Namespace`.

## 1. Add New Item

"Add New Item..." on project and folder nodes, after "Add File...".

1. Quick pick: the built-in C# items Class, Interface, Record, Enum, Struct first, then the `dotnet new list --type item` templates for the project's language (templates listing it, or without a language), grouped by their first tag (Web, Test, Config, ...). The template list is read once per session.
2. Templates with a language: the existing inline temporary node in the tree, prefilled with a default name (`Class1.cs`, `Interface1.cs`, ...; for `dotnet new` templates the template name without spaces plus `1`, e.g. `APIController1`) and the base name selected. Templates without a language (config files) are created right away without a name.
3. Creation:
   - Built-in items are written directly: file-scoped namespace (modern .NET only), `public <kind> <Name>` with an empty body (`public record <Name>;` style is not used, the body is `{ }` like Visual Studio's templates).
   - `dotnet new` templates run as `dotnet new <short> -n <Name> -o <folder> [--language <lang>]` (the name without a typed extension). Afterwards the first `namespace X` declaration in each new `.cs` file is set to the expected namespace.
   - The expected namespace is `namespaceService.calculateExpectedNamespace` (RootNamespace + folders); folder names are made valid identifiers like Visual Studio does (`Connected Services` → `Connected_Services`, a leading digit gets `_`).
4. The new file (the first new `.cs`/`.razor`/`.cshtml` file for `dotnet new` templates) opens in the editor. An existing file with the same name is not overwritten: error message, nothing created.

## 2. Add New Project

"Add New Project..." on the solution and on solution folders (it was a stub).

1. Quick pick of `dotnet new list --type project` templates, grouped by first tag, recently used (per user, global state, last 5) on top.
2. Input box: name; a valid identifier-like name (`[A-Za-z_][A-Za-z0-9_.]*`) that is not already a project name in the solution.
3. Input box: location, prefilled with `<folder most existing projects' folders live in>/<Name>` relative to the solution directory (e.g. `src/MyLib`; `MyLib` when projects sit next to the solution or there are none). The target must not exist or be an empty folder.
4. Target framework: the most common target framework of the solution's projects, passed as `--framework` only when `dotnet new <short> -h` lists it; otherwise the template default.
5. `dotnet new <short> -n <Name> -o <dir> [--framework <tfm>]` (C# unless the template has no C#), behind a progress notification, then `Solution.addProject` with the solution folder path when started on a solution folder (root otherwise).

## 3. Rename with nested files

Renaming a file renames the files nested under it (by `FileNestingService`, recursively) whose names start with the old name: a dependent starting with `<old file name>.` gets that prefix replaced by the new file name (`Index.cshtml.cs` → `Home.cshtml.cs`), otherwise one starting with `<old base name>.` gets the base name replaced (`Form1.Designer.cs`, `Form1.resx` → `Main.Designer.cs`, `Main.resx`). Dependents are renamed after the main file with `workspace.fs.rename`; a dependent whose new name already exists is skipped and logged. The existing type rename offer is unchanged.

## 4. Errors

`dotnet new` failures write the output to the "Shinobi .NET: Templates" output channel and show an error with "Show Output". Nothing is added to the solution when project creation fails.

## 5. Tests

- Unit: table parsing with real `dotnet new list` output as fixtures; built-in item content and default names; namespace replacement; namespace segments from folder names; default location and most common framework; dependent renames.
- Integration (skipped without dotnet): create a classlib in a temporary .slnx solution, at the root and in a solution folder; create an `apicontroller` item and check its namespace.

## README

Phase 5 items ticked; "Add New Project is a stub" leaves Known Issues; the Phase 4 test task stays open as the last item.
