# Settings

## This extension

Settings > Extensions > Shinobi .NET Studio, grouped as below.

### Solution Explorer

| Setting | Default | |
|---|---|---|
| `shinobi.solutionExplorer.location` | `sidebar` | The Solution Explorer in the primary or the secondary side bar (`secondary-sidebar`) |
| `shinobi.solutionExplorer.fileNesting` | `default` | Visual Studio's File Nesting: `off` (every file in its folder), `default` (code-behind, designer files, `appsettings.*.json`, resources) or `web` (also `site.ts` > `site.js` > `site.min.js`, `.map` files, `.scss` > `.css`) |
| `shinobi.solutionExplorer.trackActiveItem` | `false` | Select the active editor's file in the tree whenever you switch files, like Visual Studio's "Track Active Item in Solution Explorer". It doesn't move the keyboard focus. Without it, use Sync with Active Document (Ctrl+[, S) |
| `shinobi.solution.offerSlnxConversion` | `true` | Offer to convert a `.sln` to `.slnx` when it opens ("Don't Ask Again" turns it off for one solution) |

### Error List

| Setting | Default | |
|---|---|---|
| `shinobi.diagnostics.showErrors` | `true` | Errors in the Error List and the Solution Explorer (the Error List's Errors toggle) |
| `shinobi.diagnostics.showWarnings` | `true` | Warnings, likewise (Warnings toggle) |
| `shinobi.diagnostics.showInfos` | `false` | Infos and suggestions, Visual Studio's "Messages" (Messages toggle); replaces `shinobi.solutionExplorer.diagnostics.showInfos` |

### Run & Debug

| Setting | Default | |
|---|---|---|
| `shinobi.debug.checkDevCertificate` | `true` | When a project with an `https://` launch profile starts, check once per session whether the HTTPS development certificate is trusted and offer to trust it. Off: nothing is checked (the *Trust HTTPS Development Certificate* command still works) |

### Build

| Setting | Default | |
|---|---|---|
| `shinobi.build.emitGeneratedFiles` | `true` | Builds started by this extension write what source generators produce, so Dependencies > Analyzers can show it. Off: builds write nothing extra, and generators show no files |

### Code Cleanup

| Setting | Default | |
|---|---|---|
| `shinobi.codeCleanup.severity` | `warn` | Which code style rules of the `.editorconfig` Code Cleanup fixes, by the severity the rule has there: `info` (suggestions, warnings and errors), `warn` (warnings and errors) or `error` (errors only) |

### Tests

| Setting | Default | |
|---|---|---|
| `shinobi.tests.discoverAfterBuild` | `true` | Discover tests again after every build. Turn it off for very large solutions and use the Test Explorer's refresh button |

### NuGet

| Setting | Default | |
|---|---|---|
| `shinobi.nuget.includePrerelease` | `false` | Open the NuGet Package Manager with "Include prerelease" checked |

## C# extension defaults this extension changes

These belong to the C# extension. This extension only changes their **default**; a value you set yourself (user or workspace settings) wins.

| Setting | New default | Why |
|---|---|---|
| `dotnet.server.useOmnisharp` | `false` | `muhammad-sammy.csharp` starts OmniSharp by default, which is in maintenance mode and can't load .slnx solutions. `false` makes it start the Roslyn language server it ships with, the one Visual Studio uses. Microsoft's C# extension already defaults to it. Set `true` to keep OmniSharp; for .slnx solutions you are then offered to switch back |
| `dotnet.codeLens.enableTestsCodeLens` | `false` | The "Run Test \| Debug Test" code lenses run tests through VSTest, which fails for Microsoft.Testing.Platform projects without `Microsoft.NET.Test.Sdk`. The Test Explorer's gutter icons cover them. Set `true` to get the lenses back |

## Useful C# extension settings

- `"dotnet.backgroundAnalysis.compilerDiagnosticsScope": "fullSolution"`: live errors for all files, not only open ones (slower on big solutions).
