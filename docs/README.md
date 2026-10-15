# Shinobi .NET Documentation

Visual Studio's Solution Explorer, NuGet Package Manager, Error List, Test Explorer, templates and Publish for .NET in VS Code and VSCodium.

| Page | What it covers |
|---|---|
| [Getting started](#getting-started) | Install, open a solution, build, run, test |
| [Coming from Visual Studio](coming-from-visual-studio.md) | What works differently, and why |
| [Solution Explorer](solution-explorer.md) | The tree, title bar, keys, Dependencies, errors in the tree |
| [Context menus](context-menus.md) | Every right-click menu of the Solution Explorer, command by command |
| [Keyboard shortcuts](keyboard-shortcuts.md) | This extension's keys, and Visual Studio's keys in VS Code |
| [Run & Debug](run-and-debug.md) | Startup project, launch profiles, Debug/Release, F5, Ctrl+F5, Start New Instance |
| [Error List](error-list.md) | Errors, warnings and messages as a table |
| [Tests](tests.md) | The Test Explorer for Microsoft.Testing.Platform and VSTest projects |
| [NuGet](nuget.md) | Browse, Installed (with transitive packages), Updates, Consolidate, private feeds |
| [Templates](templates.md) | Add New Project and Add New Item |
| [Publish](publish.md) | The Publish tab and Folder profiles |
| [Connected Services](connected-services.md) | WCF/SOAP service references |
| [Settings](settings.md) | This extension's settings and the C# extension defaults it changes |
| [Troubleshooting](troubleshooting.md) | The log, common problems, reporting a bug |

## Getting started

### What you need
- **VS Code** 1.74 or later, or **VSCodium** / another Open VSX editor
- The **.NET SDK** 8.0 or later; .slnx solutions need 9.0.200 or later
- A **C# extension**: [C#](https://marketplace.visualstudio.com/items?itemName=ms-dotnettools.csharp) (`ms-dotnettools.csharp`) in VS Code, or [the open source fork](https://open-vsx.org/extension/muhammad-sammy/csharp) (`muhammad-sammy.csharp`) in VSCodium. It provides C# editing (IntelliSense, live errors, navigation, refactorings) and the debugger; this extension provides the Visual Studio parts around them. C# Dev Kit is not needed.

### Open a solution
Open the folder of your repository. The extension looks for `.sln` and `.slnx` files in it, and, when there are none at the top, in its subfolders (`src/App.sln`). The **Solution Explorer** appears in the activity bar (move it to the secondary side bar with the `shinobi.solutionExplorer.location` setting). With several solutions you pick one, once: the choice is remembered. **.NET: Open Solution...** (also in the Solution Explorer's `...` menu) switches to another.

No solution yet? **.NET: Create New Project...** creates one with its first project, like Visual Studio's "Create a new project". See [Templates](templates.md#create-a-new-project-a-new-solution).

### Build, run, test
1. **Build:** Ctrl+Shift+B builds the solution; right-click a project for Build, Rebuild and Clean. Errors show in the [Error List](error-list.md) and as red and yellow markers in the tree.
2. **Run:** right-click a web or console project > **Set as Startup Project**, then F5 to debug or Ctrl+F5 to run without the debugger. See [Run & Debug](run-and-debug.md).
3. **Test:** test projects appear in VS Code's Testing view after a build; right-click a test project, folder or file > **Run Tests**. See [Tests](tests.md).
4. **Packages:** right-click a project > **Manage NuGet Packages...**. See [NuGet](nuget.md).

## Project

- [Roadmap](roadmap.md): what's next, known bugs and limitations
- [History](history.md): what's done, phase by phase
- [Developer guide](../DEVELOPER.md): build, run and test the extension; [Manual testing](manual-testing.md) lists what still needs a check in VS Code itself
