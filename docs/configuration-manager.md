# Configuration Manager

**Configuration Manager...** opens a tab like Visual Studio's Build > Configuration Manager: the solution's configurations (Debug, Release) and platforms (Any CPU, x64), and which configuration and platform each project builds in, or whether it builds at all.

## Opening it

- Right-click the solution > **Configuration Manager...**
- The configuration submenu in the Solution Explorer's title bar (the ⚙ button) > **Configuration Manager...**
- The command palette: **.NET: Configuration Manager...**

## Active configuration and platform

The two dropdowns at the top set the active solution configuration and platform. The platform dropdown is hidden while the solution has only **Any CPU**.

The same choices are in the title bar: **Select Solution Configuration...** and **Select Solution Platform...** (the latter only when the solution has several platforms). The view title shows the active pair, for example `Debug | x64 · net9.0`. The choice is kept per workspace.

## Editing the lists

**Edit Configurations...** and **Edit Platforms...** open the list of each:

- **Add:** a name and **Copy settings from** (an existing entry whose project settings the new one starts with), then **Add**.
- **Rename** an entry. Each project keeps its own names: after renaming the solution configuration `Release` to `Prod`, every project that built in its own `Release` still does.
- **Remove** an entry. The last one cannot be removed.

## Project contexts

The grid lists every project with, for the active configuration and platform:

| Column | |
|---|---|
| Configuration | The configuration the project builds in |
| Platform | The platform the project builds in |
| Build | Whether the solution build includes the project |

The dropdowns offer what the project file declares (`<Configurations>` and `<Platforms>`), or Debug/Release and Any CPU when it declares nothing.

## What is written to the solution file

Every change is written to the solution file at once; there is no OK or Cancel. The tab refreshes when the file changes on disk.

- **.sln:** the `SolutionConfigurationPlatforms` and `ProjectConfigurationPlatforms` sections, in Visual Studio's format.
- **.slnx:** a `<Configurations>` element, and per project `<BuildType>`, `<Platform>` and `<Build>` elements. Only deviations from the default (the project uses the same name as the solution) are written, and the rest of the file keeps its formatting:

```xml
<Solution>
  <Configurations>
    <BuildType Name="Debug" />
    <BuildType Name="Release" />
    <Platform Name="Any CPU" />
    <Platform Name="x64" />
  </Configurations>
  <Project Path="src/App/App.csproj" />
  <Project Path="src/Lib/Lib.csproj">
    <BuildType Solution="Release|*" Project="Debug" />
    <Build Solution="Debug|x64" Project="false" />
  </Project>
</Solution>
```

Visual Studio and `dotnet` read both formats the same way, so teammates see the same mapping.

## How builds use it

- **Solution builds** (Ctrl+Shift+B, Rebuild, Clean) run with `--configuration <configuration>` and `-property:Platform=<platform>` (left out for **Any CPU**, MSBuild's default). MSBuild skips projects with Build unchecked and builds the others in their own configuration and platform.
- **Single-project builds,** the build before F5, **Pack** and the analyzers use the configuration and platform the grid maps the project to.

## Limits

- The project dropdowns list what the project file declares; this tab does not add configurations or platforms to project files.
- Building a single project runs even when its Build is unchecked.
