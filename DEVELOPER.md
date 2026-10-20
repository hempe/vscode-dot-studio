# Developer guide

Where things stand: [Roadmap](docs/roadmap.md) (what's next, known bugs) and [History](docs/history.md) (what's done, with implementation notes). Bugs and ideas: [issues](https://github.com/hempe/vscode-dot-studio/issues). How to publish a new version: [Releasing](#releasing).

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

A release is one click on GitHub; the rest is automatic (`.github/workflows/release.yml`). The version number lives only in the tag: `package.json` stays at `0.0.1` in git on purpose.

### Every release

1. Make sure what should go out is on `master` and the CI badge/run of that commit is green (Actions > CI; the Windows job is informational until it has been green once).
2. Add a section to [CHANGELOG.md](CHANGELOG.md) for the new version, newest first, as `## 0.2.0 - 2026-12-01` followed by what changed for users. **The release fails without it** (the same text is the release notes if you leave them empty, and the stores show the changelog).
3. Commit and push that to `master`.
4. GitHub > Releases > **Draft a new release**: choose "Create new tag" and type `v0.2.0` (the tag is the version, `v` + `major.minor.patch`, nothing else), target `master`. Tick **Set as a pre-release** for a first or risky release. Leave the notes empty to use the changelog section, or write them. Click **Publish release**.
5. Watch Actions > Release. It runs typecheck and tests, builds one `.vsix` with the tag's version, publishes it to the Visual Studio Marketplace (VS Code) and Open VSX (VSCodium), and attaches it to the release. The run's summary says which stores got it.
6. Check the listings a few minutes later: marketplace.visualstudio.com/items?itemName=shinobi.dotnet and open-vsx.org/extension/shinobi/dotnet. Install the new version in VS Code once.

Version numbers: `major.minor.patch`. For the Marketplace's pre-release channel use an odd minor for pre-releases (`0.1.x`) and an even one for stable (`0.2.x`); a store never accepts the same version twice, so a failed publish after the version went out needs a new patch number.

### If the run fails

- *CHANGELOG.md has no "## x.y.z" section*: add it, then delete the release **and its tag** (Releases > the release > Delete, then `git push origin :refs/tags/v0.2.0`), and publish again.
- *The tagged commit is not on master*: tag a commit that is on master.
- *401 or 403 from a store*: the token expired or lost its scope. Azure DevOps tokens expire (at most one year): create a new one (scope **Marketplace > Manage**, all accessible organizations) and update the secret `VSCE_PAT`. For Open VSX create a token at open-vsx.org > Settings > Access Tokens, update `OVSX_PAT`, and check it with `npx ovsx verify-pat shinobi -p <token>`.
- *Version already exists*: the stores keep every version forever; use the next patch number.
- Try packaging by hand any time with `npx vsce package` (it runs the production build and lists what goes into the `.vsix`).

### One-time setup (do this before the first release)

- [ ] **Visual Studio Marketplace:** a Microsoft account, an Azure DevOps organization (dev.azure.com), a Personal Access Token with scope *Marketplace > Manage* for all accessible organizations, and the publisher `shinobi` created at marketplace.visualstudio.com/manage. Store the token as the repository secret `VSCE_PAT` (Settings > Secrets and variables > Actions).
- [ ] **Open VSX (VSCodium):** sign in at open-vsx.org with GitHub, create an Eclipse account and sign the Publisher Agreement, create an access token, run `npx ovsx create-namespace shinobi -p <token>` once, and store the token as the secret `OVSX_PAT`. Optional: ask for the namespace to be verified (instructions in the Open VSX wiki) so the listing does not show "unverified publisher".
- [ ] Until a secret exists, the workflow skips that store and still makes the GitHub release, so you can try the whole flow with a pre-release first.
