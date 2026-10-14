# Tests

Test projects of the solution show in VS Code's **Testing** view (the flask icon), grouped like Visual Studio's Test Explorer: project > namespace > class > test > parameterized cases. Tests in the editor get ▷ icons in the gutter.

## Supported test projects

| Kind | Frameworks | How it runs |
|---|---|---|
| **Microsoft.Testing.Platform** | xUnit v3, MSTest runner, TUnit, NUnit runner | The test app is started in server mode and reports its tests and results |
| **VSTest** (classic) | xUnit v2, NUnit and MSTest with their VSTest adapters (`Microsoft.NET.Test.Sdk`) | Through the SDK's `vstest.console`, like Visual Studio |

Which kind a project is, MSBuild decides (`IsTestingPlatformApplication`).

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
