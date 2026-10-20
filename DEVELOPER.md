# Developer guide

Where things stand: [Roadmap](docs/roadmap.md) (what's next, known bugs) and [History](docs/history.md) (what's done, with implementation notes). Bugs and ideas: [issues](https://github.com/hempe/vscode-dot-studio/issues). How to publish a new version: [RELEASING.md](RELEASING.md).

## Getting started

Needs Node.js 20 or later, the .NET SDK 8 or later (9.0.200 for `.slnx`) and a C# extension in the VS Code you develop with.

```bash
npm install
npm run build:dev     # or: npm run watch
npm test
```

To try your changes, press **F5** in VS Code with this launch configuration in `.vscode/launch.json` (the file is ignored by git, so everyone points it at their own solutions). It builds the extension and opens a second VS Code window, the Extension Development Host, on the sample solution in `scripts/screenshots/sample/`:

```jsonc
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Run Extension",
            "type": "extensionHost",
            "request": "launch",
            "args": ["--extensionDevelopmentPath=${workspaceFolder}", "${workspaceFolder}/scripts/screenshots/sample"],
            "outFiles": ["${workspaceFolder}/out/**/*.js"],
            "preLaunchTask": "${defaultBuildTask}"
        }
    ]
}
```

| Command | |
|---|---|
| `npm run build:dev` | Development build of both bundles; judge it by the exit code, the webview half can fail while the extension half succeeds |
| `npm run watch` | The same, rebuilding on changes |
| `npm run build` | Production build (used when packaging) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | All Jest tests; `npx jest path/to/file.test.ts` or `npx jest -t "name"` for one |
| `npm run generate:menus` | Writes the context menus from `src/core/contextMenus.ts` into `package.json` and `docs/context-menus.md` (a test fails if you forget) |
| `scripts/screenshots/capture.sh` | Captures the screenshots in `docs/images/` (see below) |

## Project structure

```
src/
├── extension.ts            # Entry point
├── core/                   # Solution & Project models, context menu definitions, logger
├── handlers/               # .sln / .slnx file handlers
├── parsers/                # .sln, .slnx and project file parsers/editors
├── services/               # Solution tree, actions, build tasks, debug config, diagnostics
│   ├── nuget/              # NuGet feeds, credentials, package operations
│   ├── publish/            # Publish profiles (.pubxml)
│   ├── serviceReferences/  # Connected Services (dotnet-svcutil)
│   ├── templates/          # dotnet new templates, Add New Project / Item
│   └── testing/            # Test Explorer (Microsoft.Testing.Platform and VSTest)
├── types/                  # Webview ⇄ extension message types
├── webview/                # React UIs (Solution Explorer, NuGet manager, Error List, template wizard, Publish) and their providers
└── test/unit/              # Jest tests (more sit next to the sources as *.spec.ts)
docs/                       # User documentation, roadmap, history
scripts/                    # Menu generator, screenshot script and its sample solution
```

There are two webpack bundles: the extension (Node) and the webviews (browser). Webview code must not import `vscode` or Node modules, not even through shared files; a test builds the webview bundles to catch it. [CLAUDE.md](CLAUDE.md) describes the architecture in more detail.

## Conventions

- **Like Visual Studio.** Features follow Visual Studio's behaviour, names and keys, so people coming from it feel at home. Ideas Visual Studio doesn't have go to Phase 30 of the roadmap unless they're small.
- **Documentation with the change.** A change users can notice updates its page in `docs/` in the same commit. Tests check that `docs/keyboard-shortcuts.md` lists every key binding and `docs/settings.md` every setting.
- **Manual checks.** What unit tests can't cover goes into [docs/manual-testing.md](docs/manual-testing.md), and is ticked once someone tried it in VS Code.
- TypeScript is strict, with `noUnusedLocals`/`noUnusedParameters`: unused variables break the build.

## Screenshots

`scripts/screenshots/capture.sh ["Theme"]` captures every image in `docs/images/` in a virtual display, so it doesn't disturb your desktop. Rerun it after UI or theme changes. It needs Linux with Xvfb, xdotool and ImageMagick (Arch: `pacman -S xorg-server-xvfb xdotool imagemagick`), `code-oss` or `code` (`CODE=code`), a C# extension and a built extension. `SCENES="nuget publish"` captures only some. The script describes each scene; it steers VS Code with clicks at fixed positions, so a layout change may need its coordinates adjusted.

## Releasing

Publishing a new version is a GitHub Release plus a changelog entry; the accounts and tokens are a one-time setup. Everything, including what to do when a run fails, is in [RELEASING.md](RELEASING.md).
