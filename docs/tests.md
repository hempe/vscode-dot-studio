# Tests

Test projects of the solution show in VS Code's **Testing** view (the flask icon), grouped like Visual Studio's Test Explorer: project > namespace > class > test > parameterized cases. Tests in the editor get ▷ icons in the gutter.

## Supported test projects

| Kind | Frameworks | How it runs |
|---|---|---|
| **Microsoft.Testing.Platform** | xUnit v3, MSTest runner, TUnit, NUnit runner | The test app is started in server mode and reports its tests and results |
| **VSTest** (classic) | xUnit v2, NUnit and MSTest with their VSTest adapters (`Microsoft.NET.Test.Sdk`) | Through the SDK's `vstest.console`, like Visual Studio |

Which kind a project is, MSBuild decides (`IsTestingPlatformApplication`).

A multi-targeted test project (`<TargetFrameworks>`) is tested for every target framework, as in Visual Studio: the Testing view shows one item per framework (`MyTests (net8.0)`, `MyTests (net10.0)`), each with its own discovery, run and results; Run Tests on the project runs all of them. Their builds run one after the other. Select Framework (which framework F5 starts) doesn't matter for tests. A framework whose runtime isn't installed shows the error of `dotnet` on its item. The **Shinobi .NET Studio** output lists the framework each item tests.

## .NET Framework test projects (net472, net48, ...)

On Windows they run like any other VSTest project. On Linux and macOS they run under [Mono](https://www.mono-project.com/) (the `mono` command must work):

- The .NET SDK for Linux and macOS has no .NET Framework test host, so `dotnet test` fails there (`Cannot open assembly '.../TestHostNetFramework/testhost.net472.exe'`). The Test Explorer instead runs the tests through the .NET Framework `vstest.console.exe` of the `Microsoft.TestPlatform.Portable` package under Mono. The first run downloads that package (about 13 MB) into the NuGet packages folder and copies its runner to the temp folder.
- Microsoft.Testing.Platform apps that target .NET Framework (xUnit v3 `net472`) are started as their own `.exe`: on Windows directly, elsewhere with `mono`; no download is needed.
- Without Mono the project shows why in the Testing view and in the run output (`.NET Framework test projects need Mono outside Windows ...`); install Mono; the other frameworks of the project are tested without it.
- Debugging .NET Framework tests is not supported outside Windows: the C# debugger (`coreclr`) cannot attach to Mono processes. Debug Tests says so; run them instead, or debug them on a modern framework.
- Building needs no Developer Pack: the SDK references `Microsoft.NETFramework.ReferenceAssemblies` by itself.

## Running and debugging

- In the **Testing view**: ▷ runs, the bug icon debugs a test, class, namespace or project; the refresh button builds and discovers again.
- In the **editor gutter**: the ▷ next to a test or class. VS Code's **Test: Run Test at Cursor** (Ctrl+; C) and **Debug Test at Cursor** (Ctrl+; Ctrl+C) work too.
- In the **Solution Explorer**: right-click the solution, a test project, or a folder or file in it > **Run Tests** / **Debug Tests**. The Testing view opens with the results.

Each run builds the project first. Results show the failure message, the stack trace and, where the framework reports them, expected and actual values; the message links to the failing line.

**Debugging** stops at breakpoints in tests and in the code they test. For VSTest projects, VSTest starts the test host paused and the debugger attaches to it before the tests run.

## Run settings

A project's `.runsettings` file is used when MSBuild names it in `RunSettingsFilePath` (in the project file or, for every project, in `Directory.Build.props`), the way `dotnet test` and Visual Studio find it:

| Kind | What is used |
|---|---|
| **VSTest** | Everything in the file except data collectors and loggers: `RunConfiguration` (`MaxCpuCount`, `EnvironmentVariables`, `TestSessionTimeout`...), `TestRunParameters` and the sections of the adapters (`NUnit`, `MSTest`, `xUnit`). VSTest projects that use the same file run in one VSTest session, so `MaxCpuCount` runs their test assemblies in parallel (.NET Framework projects run under Mono outside Windows get a session of their own) |
| **Microsoft.Testing.Platform** | MSTest and NUnit runner projects get the file (`--settings`) and its environment variables; xUnit v3 and TUnit do not read run settings files. `MaxCpuCount` does not apply there (the platform says so in the test output) |

Code coverage stays a script (`dotnet test --collect "XPlat Code Coverage"`): the data collectors in the file are not run from the Testing view. A file that is missing or not a run settings file is skipped with a line in the test output.

## When tests appear

After every build started by this extension (Ctrl+Shift+B, the context menu, F5) and when the solution loads, for projects that were built. The refresh button builds first.

A test project that was never built shows *not built yet: Run or refresh builds it* next to its name. **Run All Tests** (or Run/Debug on the project) builds such projects, discovers their tests and then runs them, so the first run on a freshly cloned solution reports its results and fills the tree. If a result arrives for a test the tree doesn't have, the project is discovered again; results that still have no test are listed in the Test Results output instead of being dropped.

## The C# extension's test commands

The C# extension has its own test commands, which go through VSTest and fail for Microsoft.Testing.Platform projects without `Microsoft.NET.Test.Sdk` ("testhost.dll was not found"). This extension hides its "Run Test | Debug Test" code lenses by default (`"dotnet.codeLens.enableTestsCodeLens": true` brings them back). Its **Run/Debug Tests in Context** menu items can't be hidden by another extension; use the commands above instead.
