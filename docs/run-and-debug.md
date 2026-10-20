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

![Configure Startup Projects](images/startup-projects.gif)

### Configure Startup Projects

Right-click the solution > **Configure Startup Projects...** (also in the title bar's ⚙ menu and the command palette) opens the tab, like Visual Studio's Solution Properties > Configure Startup Projects:

- **Single startup project** and a dropdown of the projects that can be started: the same as **Set as Startup Project**, applied when you pick one. Choosing the radio goes back to the single startup project.
- **Multiple startup projects** shows the profiles of the solution above a table with every project of the solution (default action None):
  - **Action**: None, Start or Start without debugging.
  - **Launch profile**: the profiles of the project's `launchSettings.json` that run the project; `(default)` leaves the choice to the extension (the first one).
  - **Order**: the arrows move a project up or down; projects start in the order of the table.
- Select a profile in the list to edit it, **New profile** starts one (named `Startup`, `Startup 2`, ...), **Delete** removes the selected one. A rename is a change of the **Profile name**.
- **Share profile** puts the profile into the `.slnLaunch` file next to the solution (for source control, Visual Studio reads it); unticked it goes to the `.slnLaunch.user` file. Changing the box moves the profile between the two files.
- **Apply** writes the file and makes the profile the one F5 starts. Nothing is saved before: "Unsaved changes" shows until you apply, and Apply stays disabled while the name is empty or another profile has it. If a profile file cannot be read (half edited, a merge conflict), the tab says so and writes nothing to it.

Keys of a profile that this extension does not know stay as they are when you apply.

**Select Startup Profile...** in the title bar's ⚙ menu (shown once a `.slnLaunch` file exists) or the command palette chooses what F5 starts: `Single: <project>` (the startup project) or a profile; profiles of the `.user` file are marked "user file". The active profile's name shows next to the view title instead of the framework (`Debug · Feature Profile`). **Set as Startup Project** on a project goes back to a single startup project. The choice is kept per workspace.

| | |
|---|---|
| **F5** | Builds the solution once, then starts every project of the profile: **Start** ones in the debugger, **Start without debugging** ones without it |
| **Ctrl+F5** | The same, every project without the debugger |
| **Stop** (Shift+F5, the toolbar) | Stops every project of the profile. A project that ends on its own leaves the others running |

Projects that are [unloaded](solution-explorer.md#unload-and-reload-projects) are left out of the build, so they are not started either; they start again once reloaded. The Run and Debug view lists one session per project. Each project uses its newest framework and the launch profile set in the file (`DebugTarget`), else its first one (the startup project keeps its own).

The file format (a JSON array of profiles, paths relative to the solution), if you prefer to edit it by hand or want to see what the tab writes:

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
- Projects the solution does not have are skipped, with a warning. Adding or removing a project in the solution file updates the launches.
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

Visual Studio's Debug > Attach to Process: run **.NET: Attach to Process...** from the command palette, or from the `...` menu in the Solution Explorer's title bar. A picker lists the running .NET programs, and picking one attaches the C# extension's debugger (`coreclr`) to it.

![Attach to Process](images/attach-to-process.gif)

Each entry reads like `Shop.Web (pid 1234) :5181`: the program, its process id and the TCP ports it listens on. The description is the project of the open solution it belongs to; the second line is the command line. Programs of the solution's projects come first, the others follow by name. Type a project name, a port or a pid to filter.

What counts as a .NET program:
- `dotnet App.dll` (also `dotnet exec`, and the test hosts `dotnet test` starts),
- apphosts (`Shop.Web`, `Shop.Web.exe`) that sit in a project's `bin` folder, or have their `.dll` and `.runtimeconfig.json` beside them.

The dotnet command line tool itself (`dotnet build`, `dotnet run`, `dotnet watch`), MSBuild, the compiler servers and the language servers are left out. A program is matched to a project by its name (the assembly name against the project's name) or by living in the project's `bin` folder.

The processes come from `ps` (Linux, macOS) or PowerShell's `Get-CimInstance Win32_Process` (Windows), the ports from `ss` (or `lsof`) on Linux, `lsof` on macOS and `netstat` on Windows. A missing port tool only means no ports in the list.

Limits:
- Only `coreclr` (.NET and .NET Core). Mono and .NET Framework processes cannot be attached.
- It needs a C# extension for the debugger; without one, the command points to the extension to install.
- Only processes on this machine are listed, not remote ones.
- Starting the app first is up to you (Ctrl+F5, `dotnet run`, a terminal); the picker says so when nothing runs.

Without the picker, a launch configuration in `.vscode/launch.json` does the same with VS Code's own process list:

```jsonc
{
    "name": "Attach",
    "type": "coreclr",
    "request": "attach",
    "processId": "${command:pickProcess}"
}
```

## HTTPS development certificate

ASP.NET Core's `https://localhost` needs the HTTPS development certificate, and the browser warns about it until the system trusts it. When a project starts with a launch profile that has an `https://` entry in its `applicationUrl` (F5, Ctrl+F5, Start New Instance, Start Without Debugging, or a startup profile with such a project), the extension checks the certificate once per VS Code window with `dotnet dev-certs https --check-trust-machine-readable`.

![The HTTPS certificate notification](images/dev-cert.gif)

- The check runs next to the start and never delays it. A check that fails (no `dotnet`, no answer within 15 seconds) is only written to the log, nothing is shown.
- No valid certificate, or one that nothing trusts: a notification says so, with the buttons **Trust Certificate** (runs `dotnet dev-certs https --trust` in a terminal called "HTTPS certificate", which creates the certificate first when there is none; the next start checks again), **Not Now** (silent until the window is reloaded) and **Don't Ask Again** (stored in VS Code's global state; the command below still works).
- A trusted certificate, or one that is trusted by some stores only (what Linux reports), shows nothing. An expired certificate counts as none.
- **.NET: Trust HTTPS Development Certificate** in the command palette does the same on demand: it says "The HTTPS development certificate is trusted." when it is, and trusts otherwise.
- The setting `shinobi.debug.checkDevCertificate` (default on) switches the check on starts off.

On Windows and macOS `dotnet dev-certs https --trust` opens the system's own confirmation. On Linux trusting is only partial: .NET's documentation says it sets up trust for the .NET tools (OpenSSL), not for browsers, which keep their own certificate stores and need manual steps that differ by distribution. After Trust Certificate the browser may keep warning on Linux; see [dotnet dev-certs](https://learn.microsoft.com/dotnet/core/tools/dotnet-dev-certs) and [Enforce HTTPS in ASP.NET Core](https://learn.microsoft.com/aspnet/core/security/enforcing-ssl).

## While debugging

Breakpoints, Variables, Watch, Call Stack and the Debug Console (Visual Studio's Immediate window) are VS Code's Run and Debug view. Exception breakpoints are in its Breakpoints section. Visual Studio's Diagnostic Tools, Hot Reload and Edit and Continue are not available (Hot Reload is planned).
