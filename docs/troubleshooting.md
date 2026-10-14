# Troubleshooting

## The log

Everything this extension does is logged to **Output > Shinobi .NET** (or run **.NET: Show Log**). For more detail, run **Developer: Set Log Level...**, pick **Shinobi .NET** and choose **Debug** or **Trace**; the level is kept until you change it.

The C# extension logs to its own channels (**C#**, **C# LSP Trace Logs**), and builds, tests and publishing write to the terminal.

## The Solution Explorer

**It doesn't appear.** The extension starts when the folder you opened contains a `.sln` or `.slnx` file. With several, you pick one. Open the folder of the solution, not a folder above it.

**"Could not load App.slnx: ..."** The message says why. Common reasons:
- `.slnx` files need the .NET SDK 9.0.200 or later; check with `dotnet --version`.
- The `.slnx` has a folder name without `/` around it, the same folder twice, or a project path that doesn't exist. `dotnet sln list` shows what the SDK thinks of the file.

**Files are missing or extra.** The tree shows what is on disk under each project's folder; `bin`, `obj` and similar folders are left out. Files a project includes from outside its folder (linked files) and files it excludes aren't reflected yet.

**Packages under Dependencies don't expand.** They expand from the last restore (`obj/project.assets.json`); build or restore the project.

**Analyzers show no generated files.** They come from the last build started by this extension. Rebuild the project once (a project that was up to date doesn't recompile), and check that `shinobi.build.emitGeneratedFiles` is on.

## C# editing and debugging

**No IntelliSense, or "OmniSharp only supports ... .sln" in the C# output.** OmniSharp, the old language server of `muhammad-sammy.csharp`, can't load `.slnx`. This extension makes the Roslyn language server the default (`"dotnet.server.useOmnisharp": false`); if you set `true` yourself, set it back to `false` and reload the window.

**"A C# extension is needed" / F5 does nothing.** Install `ms-dotnettools.csharp` (VS Code) or `muhammad-sammy.csharp` (VSCodium); it provides the debugger.

**F5 starts the wrong thing.** F5 runs the configuration selected in VS Code's Run and Debug view; select `Startup` there, or set the startup project again.

## Build errors

**Fixed errors stay in the Error List.** Building a single project doesn't clear errors an earlier solution build reported for other projects; build the solution again (Ctrl+Shift+B).

**Live errors only for open files.** That's the C# extension's default; `"dotnet.backgroundAnalysis.compilerDiagnosticsScope": "fullSolution"` analyzes all files.

## Tests

**Tests don't appear.** Tests are discovered from the built test app: build the project (or press refresh in the Testing view, which builds first). The log says which projects were found and whether they are Microsoft.Testing.Platform or VSTest projects. With `shinobi.tests.discoverAfterBuild` off, only refresh discovers.

**"testhost.dll was not found" from "Run/Debug Tests in Context".** That command belongs to the C# extension and needs `Microsoft.NET.Test.Sdk`; use this extension's Run Tests / Debug Tests, the gutter icons or the Testing view. See [Tests](tests.md#the-c-extensions-test-commands).

## NuGet

**A private feed says 401 / Unauthorized.** The message names the feed and where its credentials are; **Enter New Token...** stores a new one. Encrypted `Password` values (Windows DPAPI) can't be read outside Windows; use `ClearTextPassword` or the Azure Artifacts Credential Provider. See [NuGet](nuget.md#private-feeds).

## Service references

**"dotnet-svcutil is not installed".** Install it when asked (for the repository or globally). It needs .NET 9 or later. See [Connected Services](connected-services.md).

## Reporting a problem

Open an issue at [github.com/hempe/vscode-dot-studio/issues](https://github.com/hempe/vscode-dot-studio/issues) with:
- what you did and what happened,
- the **Shinobi .NET** log at **Debug** level,
- `dotnet --info`, your editor (VS Code or VSCodium) and its version, and the C# extension you use.
