# Tests

Test projects of the solution show in VS Code's **Testing** view (the flask icon), grouped like Visual Studio's Test Explorer: project > namespace > class > test > parameterized cases. Tests in the editor get ▷ icons in the gutter.

## Supported test projects

| Kind | Frameworks | How it runs |
|---|---|---|
| **Microsoft.Testing.Platform** | xUnit v3, MSTest runner, TUnit, NUnit runner | The test app is started in server mode and reports its tests and results |
| **VSTest** (classic) | xUnit v2, NUnit and MSTest with their VSTest adapters (`Microsoft.NET.Test.Sdk`) | Through the SDK's `vstest.console`, like Visual Studio |

Which kind a project is, MSBuild decides (`IsTestingPlatformApplication`).

A multi-targeted test project (`<TargetFrameworks>`) is built and run for one framework: the one picked with **Select Framework** in the title bar (the same choice F5 uses, see [Run and debug](run-and-debug.md)) when the project targets it, `net472` included. Otherwise (Auto, or a framework the project doesn't target) the highest .NET version an installed runtime supports (else the highest .NET version, else the first framework, e.g. `net472`). A new choice takes effect with the next run or refresh. The **Shinobi .NET Studio** output says which framework each test project runs on and why.

## .NET Framework test projects (net472, net48, ...)

On Windows they run like any other VSTest project. On Linux and macOS they run under [Mono](https://www.mono-project.com/) (the `mono` command must work):

- The .NET SDK for Linux and macOS has no .NET Framework test host, so `dotnet test` fails there (`Cannot open assembly '.../TestHostNetFramework/testhost.net472.exe'`). The Test Explorer instead runs the tests through the .NET Framework `vstest.console.exe` of the `Microsoft.TestPlatform.Portable` package under Mono. The first run downloads that package (about 13 MB) into the NuGet packages folder and copies its runner to the temp folder.
- Without Mono the project shows why in the Testing view and in the run output (`.NET Framework test projects need Mono outside Windows ...`); install Mono, or pick a modern framework with Select Framework.
- Debugging .NET Framework tests is not supported outside Windows: the C# debugger (`coreclr`) cannot attach to Mono processes. Debug Tests says so; run them instead, or debug them on a modern framework.
- Building needs no Developer Pack: the SDK references `Microsoft.NETFramework.ReferenceAssemblies` by itself.

## Running and debugging

- In the **Testing view**: ▷ runs, the bug icon debugs a test, class, namespace or project; the refresh button builds and discovers again.
- In the **editor gutter**: the ▷ next to a test or class. VS Code's **Test: Run Test at Cursor** (Ctrl+; C) and **Debug Test at Cursor** (Ctrl+; Ctrl+C) work too.
- In the **Solution Explorer**: right-click the solution, a test project, or a folder or file in it > **Run Tests** / **Debug Tests**. The Testing view opens with the results.

Each run builds the project first. Results show the failure message, the stack trace and, where the framework reports them, expected and actual values; the message links to the failing line.

**Debugging** stops at breakpoints in tests and in the code they test. For VSTest projects, VSTest starts the test host paused and the debugger attaches to it before the tests run.

## When tests appear

After every build started by this extension (Ctrl+Shift+B, the context menu, F5) and when the solution loads, for projects that were built. The refresh button builds first.

## The C# extension's test commands

The C# extension has its own test commands, which go through VSTest and fail for Microsoft.Testing.Platform projects without `Microsoft.NET.Test.Sdk` ("testhost.dll was not found"). This extension hides its "Run Test | Debug Test" code lenses by default (`"dotnet.codeLens.enableTestsCodeLens": true` brings them back). Its **Run/Debug Tests in Context** menu items can't be hidden by another extension; use the commands above instead.
