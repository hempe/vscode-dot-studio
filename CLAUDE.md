# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

VS Code extension providing a Visual Studio–style Solution Explorer (.sln and .slnx), NuGet package manager UI, and project/file operations for .NET. Needs a C# extension (`ms-dotnettools.csharp` or `muhammad-sammy.csharp`) for the `coreclr` debugger and C# rename; `package.json` can't require one of two, so `services/csharpExtensionCheck.ts` warns at activation if neither is installed. Activates on `workspaceContains:*.sln`.

## Commands

```bash
npm run build:dev        # webpack dev build (default VS Code build task)
npm run watch            # webpack watch
npm run build            # production build (used by vscode:prepublish)
npm run compile:extension  # build only the extension host bundle
npm run compile:webview    # build only the React webview bundles
npm run typecheck        # tsc --noEmit
npm test                 # jest (all tests)
npx jest path/to/file.test.ts          # single test file
npx jest -t "test name substring"      # single test by name
```

Tests live both next to sources (`*.spec.ts`) and under `src/test/unit/**` (`*.test.ts(x)`); Jest picks up both. Environment is `jsdom` for all tests. `jest.setup.js` mocks `acquireVsCodeApi` and silences `console.log/debug/info`. Extension-host tests mock `vscode` per file via `jest.mock('vscode', ...)` (no shared `__mocks__`). Fixture solutions are in `src/__fixtures__/`.

TypeScript is `strict` with `noUnusedLocals`/`noUnusedParameters`, and webpack builds use `noEmitOnError` — unused variables break the build. `npm run build:dev` builds two configurations; judge it by its exit code, not by grepping for "compiled successfully" (the extension half can succeed while the webview half fails). Webview code runs in a browser: it must not reach `vscode` or Node modules, not even through shared files like `core/logger.ts`; `src/test/unit/build/webviewBundle.test.ts` builds the webview bundles to catch that.

## Architecture

Two separate webpack bundles (see `webpack.config.js`):
- **extension** (`target: node`, entry `src/extension.ts` → `out/extension.js`)
- **webview** (`target: web`, React, entries `src/webview/solution-view/index.tsx` and `src/webview/nuget-view/index.tsx` → `out/webview/<name>/`), compiled with `src/webview/tsconfig.json`. Webview code must not import `vscode` or Node modules.

### Extension host

- `src/extension.ts` registers the Solution Explorer webview view provider (twice: sidebar and secondary-sidebar, selected via `shinobi.solutionExplorer.location`), the NuGet custom editor (`*.nuget` / `shinobi.nugetPackageManager`), commands, and file watchers for `*.sln*` and `*.{csproj,vbproj,fsproj}` that forward to `SolutionWebviewProvider.handleFileChange`.
- `SolutionService` (static) owns the single active `Solution` (`discoverAndInitializeSolution`, `getActiveSolution`, `dispose`).
- `core/Solution.ts` is the in-memory solution model: parses the solution file, holds `Project` instances (`core/Project.ts`), watches files and `launch.json` (startup project / framework cache), and fires `onDidChange`. All solution-file mutations (add/remove projects, solution folders, solution items) go through it.
- `src/handlers/` abstracts the solution file format: `createSolutionFileHandler(path)` returns `SolutionFileHandler` (.sln, via `parsers/solutionFileParser.ts`) or `SolutionXFileHandler` (.slnx, via `parsers/solutionXFileParser.ts`) implementing `ISolutionFileHandler` (read/write/parse → `SolutionFile`). `Solution` mutations branch on file type: .sln uses line-based edits in `Solution.ts`, .slnx uses `parsers/solutionXFileEditor.ts` (text edits that preserve formatting; .slnx folders are flat, with hierarchy encoded in `Name="/a/b/"`, and items without an `Id` get deterministic GUIDs derived from their path).
- `services/solutionTreeService.ts` converts the `Solution` model into `ProjectNode` trees for the UI; `fileNesting.ts` applies VS-style file nesting; `solutionExpansionService.ts` persists expanded nodes.
- `services/solutionActionService.ts` handles context-menu actions (build/rebuild/clean, add reference, restore, file ops). dotnet CLI commands for these run in VS Code terminals; NuGet services under `services/nuget/` use `child_process.exec` and the NuGet V3 API (`nugetV3Service.ts`, cached with `core/persistentCache.ts`).
- Logging: use `logger('Name')` from `core/logger.ts` (webview has its own in `webview/shared/logger.ts`).

### Webview ⇄ extension messaging

Messages are discriminated unions keyed by `type` with a `payload`:
- `src/types/commands/backend.ts` — webview → extension (`BackendCmd`), e.g. `getSolutionData`, `projectAction`, `expandNode`, NuGet commands.
- `src/types/commands/ui.ts` — extension → webview.
- `src/types/commands/project-action.ts` — `projectAction` sub-actions.

Providers in `src/webview/providers/` (`SolutionWebviewProvider`, `NuGetCustomEditorProvider`) switch on `message.type`; HTML shells are in `providers/views/`. When adding a message, add the type to these files and handle it on both sides.

### Solution Explorer context menus

Context menus are native VS Code menus (`webview/context`), not rendered by React. `src/core/contextMenus.ts` is the single source: commands (`shinobi.solutionExplorer.<action>`), per-node-type menus, and key bindings. After editing it run `npm run generate:menus` to rewrite the matching `package.json` contributions and the menu reference `docs/context-menus.md` (unit tests fail if either is out of sync). Every command needs a `description`, which is what the reference shows. Tree rows carry `data-vscode-context` (`nodeType`, `nodeId`); `providers/nativeContextMenu.ts` registers the commands and routes them to `SolutionWebviewProvider.runNodeAction`. Key bindings get no node argument and act on the focused node, which the webview reports via `treeFocusChanged` (also sets the `shinobi.solutionExplorer.focusedNodeType` context key; empty while renaming so keys reach the input). Rename is handed back to the webview with `startRename`.

### Documentation

User documentation is in `docs/` (index: `docs/README.md`), one page per area. `README.md` is the store page (features with screenshots from `docs/images/`, captured by `scripts/screenshots/capture.sh`, links into `docs/`); the roadmap with known bugs is `docs/roadmap.md`, finished phases move to `docs/history.md`, and how to build and run is `DEVELOPER.md`. The README must stay a store page: features and how to use them, no roadmap, phases or contributor material (those go in `DEVELOPER.md` and `docs/`). A change a user can notice updates its page in the same commit (`docs/context-menus.md` is generated, see above; tests check that `docs/keyboard-shortcuts.md` lists every key binding and `docs/settings.md` every setting in `package.json`). `docs/manual-testing.md` lists checks still to do in VS Code itself; tick an entry only when the user confirms.

### Node IDs

Tree nodes are identified by `NodeIdString` (branded string, `src/types/nodeId.ts`). `services/nodeIdService.ts` encodes a typed JSON object (`{type: 'solution'|'project'|'folder'|'file'|'solutionFolder'|..., path, ...}`) as base64url (older gzipped IDs still parse). The webview treats IDs as opaque strings (`webview/shared/nodeIdUtils.ts` is browser-safe and does not decode); only the extension host encodes/decodes them via `nodeIdService`, and a test fails if webview code imports it or decodes IDs.
