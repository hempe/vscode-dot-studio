<!-- Generated from src/core/contextMenus.ts by `npm run generate:menus`; edit the descriptions there. -->
# Solution Explorer Context Menus

What each right-click menu of the Solution Explorer offers, by node. Keys work while the node has focus in the tree. With several nodes selected, Delete, Remove, Copy, Cut, Build, Rebuild and Clean act on all of them.

## Solution

| Command | Key | What it does |
|---|---|---|
| Add New Project... |  | Opens the Add New Project wizard; the new project goes into the solution or into this solution folder. |
| Add Existing Project... |  | Adds a project file from disk to the solution or to this solution folder. |
| Add Solution Folder |  | Adds a solution folder (a virtual folder in the solution file, not on disk). |
| Add Solution Item... |  | Adds a file to the solution as a solution item (on the solution: into the "Solution Items" folder). A project file is added as a project. |
| Manage NuGet Packages... |  | Opens the NuGet Package Manager for all projects of the solution, with Consolidate. |
| Build |  | Builds the solution or project as a task (`dotnet build`); errors go to the Error List. |
| Rebuild |  | Builds everything again, ignoring what is up to date (`dotnet build --no-incremental`). |
| Clean |  | Deletes the build output (`dotnet clean`). |
| Restore NuGet Packages |  | Restores the NuGet packages of the solution (`dotnet restore`). |
| Run Tests |  | Builds and runs the tests in the solution, project, folder or file; results appear in the Test Explorer. |
| Debug Tests |  | Like Run Tests, with the debugger attached: breakpoints in tests and tested code are hit. |
| Rename | F2 | Renames inline in the tree. Renaming a C# file offers to rename the type of the same name; nested files (Designer, code-behind) are renamed with their parent. |
| Copy Full Path |  | Copies the full path of the item to the clipboard. |
| Reveal in Explorer |  | Shows the file or folder in your operating system's file manager. |
| Open in Terminal |  | Opens a terminal in the folder of the solution, project or folder. |

## Solution folder

| Command | Key | What it does |
|---|---|---|
| Add New Project... |  | Opens the Add New Project wizard; the new project goes into the solution or into this solution folder. |
| Add Existing Project... |  | Adds a project file from disk to the solution or to this solution folder. |
| Add Solution Folder |  | Adds a solution folder (a virtual folder in the solution file, not on disk). |
| Add Solution Item... |  | Adds a file to the solution as a solution item (on the solution: into the "Solution Items" folder). A project file is added as a project. |
| Remove | Delete (macOS: Cmd+Backspace) | Removes the solution folder from the solution, with the projects and folders in it; files on disk stay. |
| Rename | F2 | Renames inline in the tree. Renaming a C# file offers to rename the type of the same name; nested files (Designer, code-behind) are renamed with their parent. |

## Solution item

| Command | Key | What it does |
|---|---|---|
| Open |  | Opens the file in the editor. Generated files open read-only. |
| Rename | F2 | Renames inline in the tree. Renaming a C# file offers to rename the type of the same name; nested files (Designer, code-behind) are renamed with their parent. |
| Remove from Solution | Delete (macOS: Cmd+Backspace) | Removes the file from the solution; it stays on disk. |
| Copy Full Path |  | Copies the full path of the item to the clipboard. |
| Reveal in Explorer |  | Shows the file or folder in your operating system's file manager. |

## Project

| Command | Key | What it does |
|---|---|---|
| Edit Project File |  | Opens the project file (`.csproj`) in the editor, like double-clicking the project. |
| Add New Item... |  | Opens the Add New Item wizard: C# types with the folder's namespace, or any `dotnet new` item template. |
| Add Existing Item... |  | Copies files from anywhere into the project or folder; asks before replacing a file with the same name. |
| Add File... |  | Creates an empty file; type its name in the tree. |
| Add Folder... |  | Creates a folder; type its name in the tree. |
| Add Service Reference... |  | Adds a WCF/SOAP service reference from a WSDL URL or file, generated with `dotnet-svcutil` into `Connected Services/<Name>/`. |
| Paste | Ctrl+V (macOS: Cmd+V) | Pastes the copied or cut file or folder into this folder or project. |
| Manage NuGet Packages... |  | Opens the NuGet Package Manager for the project. |
| Manage User Secrets |  | Opens the project's `secrets.json` in your user profile (outside the repository); adds a `UserSecretsId` to the project first if it has none. |
| Rename | F2 | Renames inline in the tree. Renaming a C# file offers to rename the type of the same name; nested files (Designer, code-behind) are renamed with their parent. |
| Remove from Solution |  | Removes the project from the solution; its files stay on disk. |
| Delete |  | Removes the project from the solution and moves its folder to the trash, after asking. |
| Build |  | Builds the solution or project as a task (`dotnet build`); errors go to the Error List. |
| Rebuild |  | Builds everything again, ignoring what is up to date (`dotnet build --no-incremental`). |
| Clean |  | Deletes the build output (`dotnet clean`). |
| Publish... |  | Opens the Publish tab of the project: publish profiles, settings and the Publish button. |
| Copy Full Path |  | Copies the full path of the item to the clipboard. |
| Reveal in Explorer |  | Shows the file or folder in your operating system's file manager. |
| Open in Terminal |  | Opens a terminal in the folder of the solution, project or folder. |

**On projects that can be started**

| Command | Key | What it does |
|---|---|---|
| Set as Startup Project |  | Makes the project the one F5 and Ctrl+F5 start; asks for the launch profile if it has several. Writes the `Startup` configuration to `.vscode/launch.json`. |
| Open Launch Settings |  | Opens the project's `Properties/launchSettings.json` (URLs, environment variables, command line arguments of its launch profiles); creates it with the default profiles first if it has none. |
| Debug > Start New Instance |  | Builds the project and starts it in the debugger next to whatever already runs, without making it the startup project. |
| Debug > Start Without Debugging |  | Builds the project and runs it without the debugger, without making it the startup project. |

**On the startup project**

| Command | Key | What it does |
|---|---|---|
| Open Launch Settings |  | Opens the project's `Properties/launchSettings.json` (URLs, environment variables, command line arguments of its launch profiles); creates it with the default profiles first if it has none. |
| Debug > Start New Instance |  | Builds the project and starts it in the debugger next to whatever already runs, without making it the startup project. |
| Debug > Start Without Debugging |  | Builds the project and runs it without the debugger, without making it the startup project. |

**On the startup project, when it has several launch profiles**

| Command | Key | What it does |
|---|---|---|
| Set Launch Profile... |  | Picks another launch profile (`Properties/launchSettings.json`) of the startup project. |
| Open Launch Settings |  | Opens the project's `Properties/launchSettings.json` (URLs, environment variables, command line arguments of its launch profiles); creates it with the default profiles first if it has none. |
| Debug > Start New Instance |  | Builds the project and starts it in the debugger next to whatever already runs, without making it the startup project. |
| Debug > Start Without Debugging |  | Builds the project and runs it without the debugger, without making it the startup project. |

**In test projects**

| Command | Key | What it does |
|---|---|---|
| Run Tests |  | Builds and runs the tests in the solution, project, folder or file; results appear in the Test Explorer. |
| Debug Tests |  | Like Run Tests, with the debugger attached: breakpoints in tests and tested code are hit. |

## Folder

| Command | Key | What it does |
|---|---|---|
| Add New Item... |  | Opens the Add New Item wizard: C# types with the folder's namespace, or any `dotnet new` item template. |
| Add Existing Item... |  | Copies files from anywhere into the project or folder; asks before replacing a file with the same name. |
| Add File... |  | Creates an empty file; type its name in the tree. |
| Add Folder... |  | Creates a folder; type its name in the tree. |
| Copy | Ctrl+C (macOS: Cmd+C) | Copies the file or folder; Paste puts a copy into another folder. |
| Cut | Ctrl+X (macOS: Cmd+X) | Marks the file or folder to move; Paste moves it and updates the namespaces of moved C# files. |
| Paste | Ctrl+V (macOS: Cmd+V) | Pastes the copied or cut file or folder into this folder or project. |
| Rename | F2 | Renames inline in the tree. Renaming a C# file offers to rename the type of the same name; nested files (Designer, code-behind) are renamed with their parent. |
| Delete | Delete (macOS: Cmd+Backspace) | Moves the file or folder to the trash, after asking. |
| Copy Full Path |  | Copies the full path of the item to the clipboard. |
| Reveal in Explorer |  | Shows the file or folder in your operating system's file manager. |
| Open in Terminal |  | Opens a terminal in the folder of the solution, project or folder. |

**On the Connected Services folder**

| Command | Key | What it does |
|---|---|---|
| Add Service Reference... |  | Adds a WCF/SOAP service reference from a WSDL URL or file, generated with `dotnet-svcutil` into `Connected Services/<Name>/`. |

**On a service reference (a folder in Connected Services)**

| Command | Key | What it does |
|---|---|---|
| Update Service Reference |  | Regenerates the service reference from its WSDL, for the project's current target framework. |
| Remove Service Reference |  | Removes the service reference: deletes its folder after asking; the WCF packages stay. |

**In test projects**

| Command | Key | What it does |
|---|---|---|
| Run Tests |  | Builds and runs the tests in the solution, project, folder or file; results appear in the Test Explorer. |
| Debug Tests |  | Like Run Tests, with the debugger attached: breakpoints in tests and tested code are hit. |

## File

| Command | Key | What it does |
|---|---|---|
| Open |  | Opens the file in the editor. Generated files open read-only. |
| Copy | Ctrl+C (macOS: Cmd+C) | Copies the file or folder; Paste puts a copy into another folder. |
| Cut | Ctrl+X (macOS: Cmd+X) | Marks the file or folder to move; Paste moves it and updates the namespaces of moved C# files. |
| Paste | Ctrl+V (macOS: Cmd+V) | Pastes the copied or cut file or folder into this folder or project. |
| Rename | F2 | Renames inline in the tree. Renaming a C# file offers to rename the type of the same name; nested files (Designer, code-behind) are renamed with their parent. |
| Delete | Delete (macOS: Cmd+Backspace) | Moves the file or folder to the trash, after asking. |
| Copy Full Path |  | Copies the full path of the item to the clipboard. |
| Reveal in Explorer |  | Shows the file or folder in your operating system's file manager. |

**In test projects**

| Command | Key | What it does |
|---|---|---|
| Run Tests |  | Builds and runs the tests in the solution, project, folder or file; results appear in the Test Explorer. |
| Debug Tests |  | Like Run Tests, with the debugger attached: breakpoints in tests and tested code are hit. |

## Dependencies

| Command | Key | What it does |
|---|---|---|
| Manage NuGet Packages... |  | Opens the NuGet Package Manager for the project. |
| Add Project Reference... |  | Adds a reference to another project of the solution. |
| Add Assembly Reference... |  | Adds a reference to a `.dll` file (with its hint path). |
| Restore Dependencies |  | Restores the NuGet packages of the project (`dotnet restore`). |

## Analyzers, Packages, Projects, Assemblies (under Dependencies)

**On Packages**

| Command | Key | What it does |
|---|---|---|
| Manage NuGet Packages... |  | Opens the NuGet Package Manager for the project. |
| Restore Dependencies |  | Restores the NuGet packages of the project (`dotnet restore`). |

**On Projects**

| Command | Key | What it does |
|---|---|---|
| Add Project Reference... |  | Adds a reference to another project of the solution. |

**On Assemblies**

| Command | Key | What it does |
|---|---|---|
| Add Assembly Reference... |  | Adds a reference to a `.dll` file (with its hint path). |

## Package, project or assembly reference

| Command | Key | What it does |
|---|---|---|
| Remove | Delete (macOS: Cmd+Backspace) | Removes the package, project or assembly reference from the project file, after asking. |

## Package a package depends on

No context menu.

## Analyzer

No context menu.

## Source generator

No context menu.

## Generated file

| Command | Key | What it does |
|---|---|---|
| Open |  | Opens the file in the editor. Generated files open read-only. |
| Copy Full Path |  | Copies the full path of the item to the clipboard. |
