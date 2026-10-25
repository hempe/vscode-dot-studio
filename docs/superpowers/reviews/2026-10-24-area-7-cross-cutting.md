# Code Review, Area 7: Cross-cutting (2026-10-24)

Scope: logging (`core/logger.ts`, `webview/shared/logger.ts`, what the code logs), settings in `package.json` against `docs/settings.md` and the code, `package.json` contributions against the code (commands, menus, keybindings, activation, capabilities, remote, `engines`), activation and disposal, bundle and dependencies, build, release and CI (`.github/workflows`, `scripts/`, webpack, tsconfig, jest, the vsix).

Method: read the code and configs; `npm run build` (production) in a scratch copy under `/tmp/a7/repo` (node_modules symlinked), `npx vsce ls` / `vsce package --no-dependencies` there, `npm audit`, `npm outdated`, the production `out/extension.js` loaded under Node 16.20.2 and Node 26 with a stubbed `vscode`; VS Code behaviour checked in the code of the installed Code - OSS 1.136.1 (`/usr/lib/code/out/vs/workbench/workbench.desktop.main.js`), VS Code itself not started. Findings of areas 1-6 are not repeated (logging of whole models: A2-16, A3-13; credentials in logs and cache names: A4-1, A4-6; watcher leaks: A1-16, A2-8, A2-16; test item leak: A5-1).

## Summary

| Id | Severity | Proven? | One line |
|---|---|---|---|
| A7-1 | bug | proven (VS Code resolver code) | The `ctrl+[ s` chord (Sync with Active Document) applies in the editor too and shadows Ctrl+[ / Cmd+[ (Outdent Line) in every .NET workspace |
| A7-2 | risk (security) | proven by reading | Release job: `VSCE_PAT`/`OVSX_PAT` and `id-token: write` are visible to `npm ci`, `npm test` and the build; floating action tags; `npx --yes ovsx@1.2.0` outside the lock file; the master-only check lives in the tagged commit's own workflow; trusted publisher without environment; `ci.yml` without `permissions` |
| A7-3 | risk (licence) | proven | The vsix bundles MIT/ISC/BlueOak code (xml2js, jsonc-parser, semver, glob, ...) and CC-BY-4.0 codicons without their notices; `extension.js.LICENSE.txt` holds one line |
| A7-4 | risk | proven (VS Code code), effect suspected | No `capabilities`: Restricted Mode disables the extension silently (correct), but virtual workspaces default to supported, so it can activate on `vscode-vfs://` and fail with fs/dotnet |
| A7-5 | risk (Windows) | suspected | Ctrl+Alt+L "Anywhere" can take AltGr+L (`ł` on Polish layouts) from the editor |
| A7-6 | cleanup | proven | Host bundle imports `webview/nuget-view/shared.ts` and runs its mock `VSCodeAPI` at load ("Using fallback VSCodeAPI for development"); host tsconfig has `lib: DOM` |
| A7-7 | cleanup | proven | Unused: `uuid` (runtime), `sinon`, `@types/sinon`, `@vscode/test-electron`, `webpack-dev-server`, the css loaders |
| A7-8 | cleanup | proven by reading | CI cancels master runs on a quick second push; `capture.sh` does not unset `WAYLAND_DISPLAY`; no coverage gate |
| A7-9 | bug | proven by reading | Any palette command (e.g. Create New Project) in a non-.NET workspace sets `shinobi.workspaceHasDotnetFiles`: Ctrl+F5 then says "There is no startup project" instead of VS Code's Run Without Debugging, Solution Explorer and Error List appear |
| A7-10 | risk (Remote) | suspected | The icon theme is read with `fs` from `extension.extensionPath` on the (remote) extension host: in SSH/WSL/containers the theme is on the UI side |

## Findings

### A7-1 (bug, proven from VS Code's resolver code): Ctrl+[ (Outdent Line) no longer works in the editor of any .NET workspace

`package.json:1692-1696`: Sync with Active Document is bound to the chord `ctrl+[ s` (macOS `cmd+[ s`) with `"when": "shinobi.workspaceHasDotnetFiles"`, which is true everywhere once the extension is active (`src/extension.ts:86`, never reset), also in the text editor.

VS Code's default `Ctrl+[` / `Cmd+[` is `editor.action.outdentLines` (`when: editorTextFocus`, weight 100). VS Code's `KeybindingResolver.resolve` (Code - OSS 1.136.1, `/usr/lib/code/out/vs/workbench/workbench.desktop.main.js`) takes, among all entries whose first chord is the pressed key, the *last* one whose `when` matches (`_findCommand` walks the list backwards), and if that entry has more chords it waits for the next key:

```
let a=this._findCommand(o,r);return a?i.length<a.chords.length?(... `awaiting ${a.chords.length-i.length} more chord(s)` ...),u0n)
_findCommand(o,e){for(let t=e.length-1;t>=0;t--){let i=e[t];if(s._contextMatchesRules(o,i.when))return i}return null}
```

The entries are sorted by weight ascending (`BCo`: `s.weight1-o.weight1`), and extension key bindings have weight 400+ (`ExternalExtension`), so the extension's chord is the last match and wins over the editor's outdent.

Scenario: a C# developer selects lines in `Program.cs` and presses Ctrl+[ (Cmd+[ on macOS, the standard outdent on every OS): the status bar shows "(Ctrl+[) was pressed. Waiting for second key of chord...", and the lines are not outdented; the next key is swallowed. Only in workspaces with a `.sln`, i.e. every workspace this extension targets. `docs/keyboard-shortcuts.md:10` lists the binding as "Anywhere" without the conflict.

Fix: add `&& !editorTextFocus` (or `focusedView == 'shinobi-solution-webview' || ...`) to the `when`, or document the conflict next to the Ctrl+Alt+L one; Visual Studio users who want Ctrl+[, S in the editor can rebind outdent.

### A7-2 (risk, proven by reading): the release job hands its publishing secrets and its OIDC identity to every step, including `npm ci` and the whole test suite

`.github/workflows/release.yml:16-27`: `permissions: id-token: write` is set for the workflow and `VSCE_PAT` / `OVSX_PAT` are job-level `env`, so they are present in `npm ci` (`:63`, which runs the install scripts of ~900 dev packages), `npm test` (`:65`, all test code plus whatever the tests spawn, including `dotnet restore` against nuget.org) and `vsce package` (`:76`, which runs `vscode:prepublish` = webpack with its plugins). The OIDC token request (`ACTIONS_ID_TOKEN_REQUEST_URL`/`_TOKEN`) is likewise available to every step once `id-token: write` is granted.

Scenario: one compromised transitive dev dependency (the npm worm pattern of 2025: a postinstall that reads `process.env` and the Actions OIDC endpoint) runs during `npm ci` of a release: it reads `OVSX_PAT`, or, with trusted publishing, requests an OIDC token for the Open VSX audience and publishes its own `shinobi.dotnet-studio` version. The extension runs `dotnet` and writes files on the users' machines, so a hijacked version is a direct code-execution channel.

In addition:
- Actions are referenced by floating major tags (`actions/checkout@v7`, `setup-node@v7`, `setup-dotnet@v6`, `upload-artifact@v7`), not by commit SHA, in the job that holds the secrets.
- `:102` downloads `ovsx@1.2.0` at run time with `npx --yes` (no lock file, its own dependency tree resolved fresh), although the locked dev dependency `ovsx` 1.3.0 is installed by `npm ci` and has `--trusted-publishing` (proven: `node_modules/ovsx/lib/main.js:65`).
- The "Only commits of master" check (`:44-50`) runs inside the workflow file of the tagged commit (a `release` event uses the workflow of the tag's commit), so it guards against mistakes, not against a tag on a branch whose `release.yml` drops the check; the trusted publisher is registered with "no environment" (`RELEASING.md:53`), so Open VSX accepts any run of a `release.yml` of this repository.
- `ci.yml` has no `permissions:` block, so its `GITHUB_TOKEN` gets the repository default (write for older repositories) in `npm ci`/`npm test` of every push.

Fix: move the build and tests into a job without secrets and without `id-token`, upload the `.vsix` as an artifact, and publish from a second job that only downloads it and runs the locked `npx ovsx` (step-level `env` for the token, `id-token: write` only on that job); use a GitHub environment `release` with a tag rule and register that environment in the Open VSX trusted publisher; pin actions by SHA; add `permissions: contents: read` to `ci.yml`.

### A7-3 (risk, proven): the `.vsix` ships third-party code without the licence notices its licences require

`.vscodeignore` includes only the bundles and `out/*/bundle.js.LICENSE.txt`. Webpack's licence extraction only keeps `/*! */` and `@license` comments:

```
$ cat out/extension.js.LICENSE.txt          # after `npm run build` in a scratch copy
/*! http://mths.be/fromcodepoint v0.1.0 by @mathias */
```

`out/extension.js` (863 KB) bundles `xml2js`, `xmlbuilder`, `jsonc-parser`, `semver`, `glob`, `minimatch`, `sax`, `path-scurry`, `lru-cache`, `minipass` (licences: MIT, ISC, BlueOak-1.0.0), whose copyright and permission notices must be included in copies; none is. The webview bundles keep React's comment only. `out/webview/codicons/codicon.ttf` and `codicon.css` are `@vscode/codicons`, licensed CC-BY-4.0 (attribution required), shipped without any notice. The vsix (`npx vsce package --no-dependencies`, 25 files, 890 KB) has no `ThirdPartyNotices` file.

Fix: generate a third-party notice file at build time (e.g. `license-webpack-plugin` or `webpack-license-plugin`) and add it to `.vscodeignore`'s allow list.

### A7-4 (risk, proven from VS Code's code; effect suspected): Restricted Mode is handled by default, virtual workspaces are not declared

`package.json` has no `capabilities`. In VS Code 1.136.1, `getExtensionUntrustedWorkspaceSupportType` returns `false` when nothing is declared, so the extension (which runs `dotnet`, MSBuild evaluations and writes files at activation) is disabled in Restricted Mode: correct, but silent: the Extensions view shows no reason. `getExtensionVirtualWorkspaceSupportType` returns `true` when nothing is declared (`return i?.default!==void 0?i.default:!0`), so in a virtual workspace (Remote Repositories / `vscode-vfs://`, opened in the desktop app) the extension is enabled and `workspaceContains:**/*.sln` can activate it; its code then reads `workspaceFolders[0].uri.fsPath` with Node `fs` and runs `dotnet` on a path that does not exist locally (suspected: errors and an empty Solution Explorer instead of the extension being disabled with a reason).

Fix: declare `"capabilities": { "untrustedWorkspaces": { "supported": false, "description": "Runs dotnet and MSBuild on the workspace's project files." }, "virtualWorkspaces": { "supported": false, "description": "Needs the project files on disk." } }`.

### A7-5 (risk, suspected, Windows): Ctrl+Alt+L "Anywhere" can take AltGr+L from the editor

`package.json` key binding `shinobi.solution.focusSolutionExplorer`, `"key": "ctrl+alt+l"`, `"when": "shinobi.workspaceHasDotnetFiles"` (no focus condition, so also in the text editor). On Windows AltGr is reported as Ctrl+Alt, and on the Polish (programmer's) layout AltGr+L types `ł` (other layouts put characters on AltGr+L too). VS Code dispatches a Ctrl+Alt key binding that matches before the character is typed, so a Polish developer typing `ł` in a C# string or comment would move the focus to the Solution Explorer instead. Not tried on Windows (Linux only here); `docs/keyboard-shortcuts.md:12` already notes the Linux lock-screen clash. Fix if confirmed: `"when": "shinobi.workspaceHasDotnetFiles && !editorTextFocus && !inputFocus"` or a note in the docs.

### A7-6 (cleanup, proven): the extension host bundle contains and runs webview code

`src/types/commands/backend.ts:2`, `src/types/commands/ui.ts:3`, `src/services/nuget/nugetManagerService.ts:13`, `src/webview/providers/NuGetCustomEditorProvider.ts:8` and `src/webview/providers/SolutionWebviewProvider.ts:15` import from `src/webview/nuget-view/shared.ts`, a webview module. Its top level (`:59-68`) calls `window.acquireVsCodeApi()`, which throws `ReferenceError` in Node, and builds the development mock `VSCodeAPI` instead, at load of `out/extension.js`:

```
$ cd /tmp/a7/load && node -e 'require("./extension.js")'      # production bundle, `vscode` stubbed
C# 20:53:26.697 [INF] NuGetReact: Using fallback VSCodeAPI for development
```

(the line goes to `console.log` because it runs before `activate` sets the log channel). It compiles because the root `tsconfig.json` gives host code `lib: ["DOM"]`, so `window` and `document` type-check in extension-host code; the webview guard tests only check the other direction. Fix: move `LocalNuGetPackage` and `sendToUi` to `src/types` or a host module, and drop `DOM` from the host's `lib` (the webview has its own tsconfig).

### A7-7 (cleanup, proven by grep and build): unused dependencies, one runtime dependency among them

No file in `src/`, `scripts/` or the configs imports `uuid` (a runtime `dependency`), `sinon`, `@types/sinon`, `@vscode/test-electron` or `webpack-dev-server` (there is no `devServer` config); `style-loader`/`css-loader` serve a `.css` rule in `webpack.config.js` that no source file uses (no `import '*.css'` in `src`). `npm outdated` shows only patch updates apart from `@types/vscode` (held at 1.74 on purpose) and `typescript` 7. Each of the seven webviews bundles its own React (the smallest bundle, the Error List, is 224 KB of 2.99 MB unpacked vsix content); acceptable at a 890 KB vsix, noted for later.

### A7-8 (cleanup, proven by reading): CI and screenshot script details

- `.github/workflows/ci.yml:10-12`: `cancel-in-progress: true` also for pushes to `master` (group `ci-refs/heads/master`): two pushes in quick succession cancel the first run, so that commit is never tested on Windows. Use `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`.
- `scripts/screenshots/capture.sh:29` sets `DISPLAY=:97` but does not `unset WAYLAND_DISPLAY` (CLAUDE.md asks for it): on a Wayland session with `--ozone-platform-hint=auto` in `~/.config/code-flags.conf` (read by Arch's `code-oss` launcher) or `ELECTRON_OZONE_PLATFORM_HINT`, the Code - OSS window would open on the user's desktop instead of Xvfb. The current session here is X11, so it did not happen.
- Jest has no coverage threshold and `test:coverage` is not run in CI; that is a choice, but it means area 8's coverage list has to be produced by hand.

### A7-9 (bug, proven by reading): any `shinobi.*` command run in a non-.NET workspace turns the window into a ".NET workspace": Ctrl+F5 stops working

`src/extension.ts:86` sets `shinobi.workspaceHasDotnetFiles` to `true` unconditionally in `activate`. The extension activates not only through `workspaceContains:**/*.sln(x)` but, since VS Code 1.74, on every contributed command (implicit `onCommand`), and 22 of them are in the Command Palette in every workspace (`.NET: Create New Project...`, `Open Solution...`, `Show Log`, `Attach to Process...`, `NuGet` ...; `menus.commandPalette` hides only the context-menu ones), plus the `*.nuget` custom editor.

Scenario: in a Node or Python repository, a developer runs **.NET: Create New Project...** (offered as the way to start a solution, `README.md:146`) to scaffold a service elsewhere, or cancels it. From then on, in that window:
- Ctrl+F5 runs `shinobi.solution.startWithoutDebugging` instead of VS Code's Run Without Debugging (`package.json` key binding, `when: shinobi.workspaceHasDotnetFiles && !inDebugMode`), which only says "There is no startup project. Right-click a project in the Solution Explorer..." (`src/services/debugConfigService.ts:399-401`); the workspace's own Node launch configuration no longer starts with Ctrl+F5.
- The Solution Explorer activity bar entry and the Error List panel appear (their `when` is the same key), the Solution Explorer showing "No solution found".
- Ctrl+[ then waits for a chord in the editor (A7-1), Ctrl+Alt+L is taken (A7-5).

Fix: set the key from what was found (`SolutionDiscovery` / a `workspace.findFiles('**/*.{sln,slnx}', excludes, 1)` at activation, again when the solution watcher sees a create), not unconditionally.

### A7-10 (risk, suspected, Remote): the Solution Explorer reads the file icon theme with `fs` on the extension host

`src/services/iconThemeService.ts:160-176` looks up the icon theme in `vscode.extensions.all` and reads `extension.extensionPath/<theme>.json` with `fs.readFileSync`; `payloadFor` makes webview URIs from `vscode.Uri.file(...)`. The extension has no `extensionKind`, so it runs in the remote extension host (deduced `["workspace"]`, `getExtensionVirtualWorkspaceSupportType`/`deduceExtensionKind` in VS Code 1.136.1). Icon theme extensions (no `main`) are installed on the UI side. In Remote-SSH, WSL or a Dev Container the theme's files are on the local machine, so either the remote host does not list the theme or the path does not exist there: the Solution Explorer would fall back to its own icons (which come from `api.iconify.design`, A3-1, often blocked on remote build hosts). Not tried (no remote set up here). A fix would read the theme through `vscode.workspace.fs` with the extension's `extensionUri` (VS Code maps UI-side extension resources for the remote host) or accept the fallback and document it.

## Checked and fine

- **Logging:** `core/logger.ts` sends everything to one `LogOutputChannel` (`extension.ts:54-58`, disposed with the context, sink reset on dispose); VS Code applies "Set Log Level", default Info. The token prompt (`feedAuth.ts:100`) uses `password: true`, the token never travels in a webview message (`types/commands/*` have no token field) and is not logged by the logger itself; the leaks through cache keys are A4-1/A4-6. The webview logger only writes to the webview's DevTools console. Arguments are `util.inspect`ed (depth 4) before the channel filters the level, so `debug` calls with objects cost even when hidden; there are few of them (`attachToProcess.ts:49`), the expensive ones are the `info` lines of A2-16.
- **Settings:** all 13 `shinobi.*` settings in `package.json` are read by the code with the same defaults (`services/settings.ts`, `diagnosticsFilter.ts`, `devCertCheck.ts:92`, `codeCleanup.ts:78`, `extension.ts:249`), all are in `docs/settings.md` with the same defaults, the legacy `shinobi.solutionExplorer.diagnostics.showInfos` has a deprecation message and is still honoured; no setting holds an executable path or command (so no `machine` scope is needed); the two `configurationDefaults` are documented. `dotnet.server.useOmnisharp` is written to the workspace only after the user clicks "Use Roslyn".
- **Commands:** every declared command is registered (the 57 context-menu commands through `registerNativeContextMenuCommands` from `core/contextMenus.ts`, kept in sync by the generator test); the three registered but undeclared ones are `shinobi.internal.*`; every menu and key binding references a declared command; every `shinobi.*` context key used in a `when` is set somewhere (`extension.ts:86`, `buildConfiguration.ts:129-135`, `startupChoice.ts:139`, `showAllFiles.ts`, `SolutionWebviewProvider.ts:138/314`). The editing keys (Ctrl+C/X/V, F2, Delete) are guarded by `focusedNodeType`, which the webview clears on window blur (`SolutionTree.tsx:485-503`) and the host on hide (`SolutionWebviewProvider.ts:135-140`).
- **Activation:** `.sln` and `.slnx` are both activation events; the view, Error List and NuGet editor activate implicitly. `.slnf` is Not Planned (roadmap). A folder with only a `.csproj` does not activate the extension; `.NET: Create New Project...` and Open Solution remain reachable (but see A7-9).
- **Restricted Mode:** without `capabilities.untrustedWorkspaces`, VS Code 1.136.1 returns `false` (`getExtensionUntrustedWorkspaceSupportType`), so nothing runs in an untrusted folder (A7-4 only asks for an explicit declaration with a reason).
- **`engines.vscode` ^1.74:** `@types/vscode` is pinned to `~1.74.0`, so newer APIs fail the typecheck; the only `as any` casts are on Node/JSON data, not on `vscode` objects. `LogOutputChannel` (`{ log: true }`) exists since 1.74. The production `out/extension.js` loads under Node 16.20.2 (the Node of VS Code 1.74) with `vscode` stubbed, although `glob`/`minimatch`/`path-scurry` declare Node 18+ (their code paths at run time were not exercised under Node 16).
- **Disposal at the extension level:** the four global watchers, the task provider, the test explorer, diagnostics, `CentralPackageWatchers` (watchers re-planned and disposed), `Solution` (watchers, debouncer, projects) and `Project` (watcher, folder watchers, timers) dispose; the remaining leaks are the ones areas 1, 2 and 5 found.
- **vsix contents:** `.vscodeignore` is an allow list: 25 files, 890 KB packed (2.99 MB unpacked): the bundles, codicons, `package.json`, README, CHANGELOG, LICENCE, icon. No source maps, fixtures, docs, scripts, `.github` or test output. `out/extension.js` 863 KB, webviews 224-410 KB each (production build, exit 0, only webpack's size warnings).
- **Dependencies:** `npm audit --omit=dev`: 0 vulnerabilities. Full `npm audit`: 5 in dev tools only (`@azure/msal-node` via `@vscode/vsce`, `body-parser`/`fast-uri` via the dev server and schema tools, `serialize-javascript` via `copy-webpack-plugin`), none bundled. `npm outdated`: patch versions only (plus TypeScript 7, `@types/vscode` on purpose).
- **Release workflow logic:** the tag is validated by a regex before use, the tag name goes through `env` (no `${{ }}` injection of free text into scripts), the version passed to `vsce` is the validated capture, `gh` uses the job token only in its step, `ovsx@1.2.0` does have `--trusted-publishing` (checked in its tarball), the locally locked 1.3.0 too. `scripts/release-notes.js` escapes the version in its regex.
- **TypeScript and webpack:** `strict`, `noUnusedLocals`, `noUnusedParameters` for host and webviews, `noEmitOnError` in both webpack configs, `target`/`lib` ES2020, `nosources-source-map` for the host, maps not shipped.

## Not reviewed / limits of this review

- VS Code was not started (no Xvfb run): A7-1 and A7-9 are proven from VS Code's resolver code and the extension's code, not by pressing keys; A7-5 (Windows AltGr) and A7-10 (Remote) need Windows and a remote host.
- `engines.vscode`: not checked per contribution point when each was introduced (e.g. `viewsContainers.secondarySidebar`, which is much newer than 1.74: on an older VS Code the secondary-sidebar view would land in the Explorer); not run on VS Code 1.74.
- Startup cost per project at activation (processes started per project, MSBuild evaluations) was left to areas 1, 2 and 5 (A1-10, A2-9, A4-16); no measurement on a 100-project solution here.
- Licences: only the direct runtime dependencies and the main transitive ones of the host bundle were checked; no full SBOM of the webview bundles (`vscrui` pulls `styled-components` and others).
- CI was read, not run; flaky tests and the Windows job's timing were not looked at (area 8).
- Logging: the 409 `info`/`debug` calls were sampled by grep for objects, payloads, contents and credentials, not read one by one.
