# Templates

## Create a New Project (a new solution)

Like Visual Studio's "Create a new project": run **.NET: Create New Project...**, click **Create New .NET Project** on VS Code's start screen when no folder is open, or use the Solution Explorer's `...` menu.

1. Pick a project template, as in Add New Project below.
2. **Project name**, **Location** (the folder the solution goes in; **Browse...**), **Solution name** (follows the project name until you change it), and **Place solution and project in the same directory**.
3. The template's settings.

**Create** makes `<Solution>/<Solution>.slnx` (a `.sln` with SDKs before 9.0.200) with the project in `<Solution>/<Project>/`, or both in one folder. The solution opens: in this window if it is inside the opened folder, otherwise its folder opens.

## Add New Project

Right-click the solution or a solution folder > **Add New Project...**: a wizard like Visual Studio's.

1. **Pick a template:** every installed `dotnet new` project template, with search, categories, and the recently used ones first.
2. **Name and location:** the location defaults to where the solution's other projects are.
3. **The template's settings:** framework (preselected from the solution), authentication, HTTPS, controllers, and whatever else the template offers.

**Create** adds the project to the solution, or to the solution folder you started from.

More templates: `dotnet new install <package>`, e.g. `dotnet new install Microsoft.Identity.Web.ProjectTemplates`.

## Add New Item

Right-click a project or folder > **Add New Item...**:

- **Built in:** Class, Interface, Record, Enum, Struct, with the namespace of the folder.
- **From `dotnet new`:** API controllers, Razor pages and components, test classes, config files (`.gitignore`, `.editorconfig`, `global.json`, ...) and your own item templates, with their settings.

The new file opens in the editor. **Add File...** creates an empty file instead; **Add Existing Item...** copies files in.

## Namespaces

New C# files get the namespace Visual Studio would give them: the project's `RootNamespace` (the project name by default) plus the folder path, with folder names made valid identifiers (`Connected Services` becomes `Connected_Services`).

Moving C# files or folders to another folder (cut and paste, or drag and drop) and renaming a folder offer to update their namespaces the same way, with one question for all the files that no longer match: Update All, Review Each (a question per file) or Skip. A single file gets a question of its own. Files whose namespace already matches, and files without a namespace, are not counted; copies keep their namespaces. Renaming a C# file offers to rename the type of the same name and its references.
