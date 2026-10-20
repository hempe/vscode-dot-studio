# Run & Debug

## Startup project

Right-click a project > **Set as Startup Project**. It is offered on projects that can be started: console, desktop, web, worker and Aspire host projects, not class libraries or test projects. The startup project is shown in **bold**.

Setting it writes two entries, keeping your other configurations and comments:
- a `Startup` configuration in `.vscode/launch.json` (the program, its working folder, the launch profile, the browser), and
- a `StartupPreBuild` task in `.vscode/tasks.json` that builds the project before each start.

Commit them to give the team a default startup project, or add them to `.gitignore` to keep the choice personal (Visual Studio keeps it in `.vs/`, per user).

## Launch profiles

Profiles from `Properties/launchSettings.json` with `"commandName": "Project"` apply when the app starts: `applicationUrl`, `environmentVariables`, `commandLineArgs`. With `launchBrowser`, the browser opens at `launchUrl` once the app logs "Now listening on".

- **Open Launch Settings** on a project that can be started opens its `Properties/launchSettings.json`. A project without one gets it first, with the profiles `dotnet new` writes: `http` and `https` with free ports for web projects, one profile named after the project for the others. Visual Studio hides this file behind Properties > Debug > "Open debug launch profiles UI".
- **Set as Startup Project** asks for the profile when there are several.
- **Set Launch Profile...** on the startup project picks another one.
- Edits to `launchSettings.json` are picked up; a removed or renamed profile falls back to another.

IIS Express, Docker and similar profiles don't apply.

## Starting

| | |
|---|---|
| **F5** | Debugs the configuration selected in VS Code's Run and Debug view, the `Startup` configuration by default. Also ▷ in the Solution Explorer's title bar |
| **Ctrl+F5** | Runs the startup project without the debugger. Also in the title bar |
| **Debug > Start New Instance** | On any project that can be started: builds it and starts it in the debugger next to what already runs, without making it the startup project |
| **Debug > Start Without Debugging** | The same without the debugger |

Start New Instance uses the project's first launch profile and newest framework; on the startup project, its chosen profile and framework. If the build fails, nothing starts.

## Startup profiles (several startup projects)

A startup profile starts several projects with one F5, like Visual Studio's "Multiple startup projects". Each project has an action: **Start** (with the debugger), **Start without debugging**, or none; they start in the profile's order.

Profiles use Visual Studio's own file (Visual Studio 2022 17.11 and later): `<Solution>.slnLaunch` next to the solution. Commit it and colleagues in Visual Studio and in VS Code share the same profiles. Profiles you keep for yourself go in `<Solution>.slnLaunch.user` (Visual Studio's name for its unshared file is not confirmed yet).

**Select Startup Profile...** in the title bar's ⚙ menu (shown once a `.slnLaunch` file exists) or the command palette chooses what F5 starts: `Single: <project>` (the startup project) or a profile; profiles of the `.user` file are marked "user file". The active profile's name shows next to the view title instead of the framework (`Debug · Feature Profile`). **Set as Startup Project** on a project goes back to a single startup project. The choice is kept per workspace.

| | |
|---|---|
| **F5** | Builds the solution once, then starts every project of the profile: **Start** ones in the debugger, **Start without debugging** ones without it |
| **Ctrl+F5** | The same, every project without the debugger |
| **Stop** (Shift+F5, the toolbar) | Stops every project of the profile. A project that ends on its own leaves the others running |

The Run and Debug view lists one session per project. Each project uses its newest framework and the launch profile set in the file (`DebugTarget`), else its first one (the startup project keeps its own).

There is no dialog to create profiles yet ("Configure Startup Projects..." comes next); meanwhile write the file by hand, paths relative to the solution:

```json
[
  {
    "Name": "Feature Profile",
    "Projects": [
      { "Path": "src\\Shop.Web\\Shop.Web.csproj", "Action": "Start" },
      { "Path": "src\\Shop.Worker\\Shop.Worker.csproj", "Action": "StartWithoutDebugging" }
    ]
  }
]
```

How it works: the profile is written to `.vscode/launch.json` as one configuration per project (named `<profile>: <project>`) and a compound named `Startup` that lists them, builds the solution first (`StartupPreBuild` in `tasks.json`) and stops them together (`stopAll`). It replaces the single `Startup` configuration while the profile is active, and is rewritten when the profile, the configuration or a launch profile changes. Limits:
- Projects the solution does not have are skipped, with a warning.
- A failed build stops the start with VS Code's own prompt, as for a single startup project.
- A profile that starts no project makes F5 fall back to the next entry of the Run and Debug view; Ctrl+F5 says so.
- If the `.slnLaunch` file cannot be read (for example half edited), F5 keeps starting what it started before; if the file or the profile is gone, F5 starts the single startup project again.

## Debug / Release

The ⚙ button in the Solution Explorer's title bar switches the solution configuration for builds, F5 and tests, with the configurations the solution file defines. The active configuration (and framework, or the [startup profile](#startup-profiles-several-startup-projects)) shows next to the view title and is kept per workspace.

Solutions with several platforms (Any CPU, x64) add **Select Solution Platform...** to that menu, and the view title shows both (`Debug | x64`). Which configuration and platform each project builds in, and whether it builds, is set in the [Configuration Manager](configuration-manager.md); F5 and the build before it use the project's mapped values.

**Select Framework** in the title bar picks the target framework of multi-targeted startup projects.

The program path comes from MSBuild, so `OutputPath`, `AssemblyName` and the artifacts layout work.

## .NET Framework projects on Linux and macOS

SDK-style projects that target .NET Framework (`net48`, `net472`, ...) run and debug with Mono: install Mono (the `mono` command must work) and Microsoft's [Mono Debug](https://marketplace.visualstudio.com/items?itemName=ms-vscode.mono-debug) extension (`ms-vscode.mono-debug`). The `Startup` configuration then has the type `mono` and points at the `.exe`; the launch profile's `commandLineArgs` and `environmentVariables` go into its `args` and `env` (Mono Debug does not read `launchSettings.json`, and has no `applicationUrl` or browser launch). Ctrl+F5, Start New Instance and Start Without Debugging tell what is missing before they start; with plain F5, VS Code reports the missing debug type. In a multi-targeted project (`net48;net10.0`) F5 picks the newest framework, Select Framework switches to `net48`.

It is meant for console, worker and desktop-style programs. ASP.NET on .NET Framework (IIS Express), test projects, and old-style project files are not supported; on Windows, use Visual Studio for .NET Framework.

## Attach to Process

Visual Studio's Debug > Attach to Process is a launch configuration of the C# extension. Add it to `.vscode/launch.json` (next to `Startup`):

```jsonc
{
    "name": "Attach",
    "type": "coreclr",
    "request": "attach",
    "processId": "${command:pickProcess}"
}
```

Select **Attach** in VS Code's Run and Debug view and press F5: a list of running processes appears; pick your app (search by name). A picker with project names and ports like Visual Studio's is planned (Phase 18).

## While debugging

Breakpoints, Variables, Watch, Call Stack and the Debug Console (Visual Studio's Immediate window) are VS Code's Run and Debug view. Exception breakpoints are in its Breakpoints section. Visual Studio's Diagnostic Tools, Hot Reload and Edit and Continue are not available (Hot Reload is planned).
