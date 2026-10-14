# Settings

## This extension

| Setting | Default | |
|---|---|---|
| `shinobi.solutionExplorer.location` | `sidebar` | The Solution Explorer in the primary or the secondary side bar (`secondary-sidebar`) |
| `shinobi.diagnostics.showErrors` | `true` | Errors in the Error List and the Solution Explorer (the Error List's Errors toggle) |
| `shinobi.diagnostics.showWarnings` | `true` | Warnings, likewise (Warnings toggle) |
| `shinobi.diagnostics.showInfos` | `false` | Infos and suggestions, Visual Studio's "Messages" (Messages toggle); replaces `shinobi.solutionExplorer.diagnostics.showInfos` |

## C# extension defaults this extension changes

These belong to the C# extension. This extension only changes their **default**; a value you set yourself (user or workspace settings) wins.

| Setting | New default | Why |
|---|---|---|
| `dotnet.server.useOmnisharp` | `false` | `muhammad-sammy.csharp` starts OmniSharp by default, which is in maintenance mode and can't load .slnx solutions. `false` makes it start the Roslyn language server it ships with, the one Visual Studio uses. Microsoft's C# extension already defaults to it. Set `true` to keep OmniSharp; for .slnx solutions you are then offered to switch back |
| `dotnet.codeLens.enableTestsCodeLens` | `false` | The "Run Test \| Debug Test" code lenses run tests through VSTest, which fails for Microsoft.Testing.Platform projects without `Microsoft.NET.Test.Sdk`. The Test Explorer's gutter icons cover them. Set `true` to get the lenses back |

## Useful C# extension settings

- `"dotnet.backgroundAnalysis.compilerDiagnosticsScope": "fullSolution"`: live errors for all files, not only open ones (slower on big solutions).
