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

## Verification (second pass, 2026-10-24)

Adversarial second pass at HEAD `50536ff`: every finding re-read in the code and, where possible, re-proven in a scratch copy under `/tmp/v7` (node_modules symlinked, scratch `TMPDIR`); VS Code was not started. Result:

| Id | Verdict | Severity after verification | Note |
|---|---|---|---|
| A7-1 | CONFIRMED | bug | Mechanism proven in the resolver; also swallows Ctrl+[ (ESC) in the integrated terminal; binding is deliberate VS parity ("also from the editor"), Shift+Tab still outdents; fix: `&& !terminalFocus` + document, or drop the editor use |
| A7-2 | PARTIALLY CONFIRMED | risk (latent hardening) | No secrets/variables are set today, sole collaborator, fork PRs never reach `release.yml`; today's real exposure is the persisted `contents: write` token (missed); `ci.yml` default is `read` (refuted); master-check point moot for a single maintainer |
| A7-3 | CONFIRMED | risk (licence) | Rebuilt, listed bundled packages per bundle from source maps; codicon.css keeps its MIT header, the font's CC-BY attribution is missing |
| A7-4 | CONFIRMED | risk | Defaults confirmed; "silent" overstated: Extensions view shows "Disabled in Restricted Mode", only the reason text is missing |
| A7-5 | UNVERIFIED | risk (suspected) | Needs Windows; mechanism plausible from the code; VS has the same key |
| A7-6 | CONFIRMED | cleanup | Reproduced the log line from the production bundle |
| A7-7 | CONFIRMED | cleanup | No style-loader runtime in any bundle |
| A7-8 | CONFIRMED | cleanup | Cancelled commits are still covered by the next run cumulatively |
| A7-9 | CONFIRMED | bug | 22 palette commands, `*.nuget`, and also Ctrl+K Ctrl+E in any `.cs` file (missed) activate it |
| A7-10 | PARTIALLY CONFIRMED | risk (suspected) | `extensions.all` only lists the host's own extensions, so the theme is not found at all; the proposed `workspace.fs` fix would not help; document the fallback |
| A7-11 (new) | CONFIRMED by reading | risk (compat/docs) | `engines ^1.74` too low in practice: `secondarySidebar` 1.106, readonly-in-session command 1.79, current C# extensions require ^1.106.0 |


### A7-1: CONFIRMED (mechanism), severity bug kept, but it is a trade-off of a deliberate VS binding, not an oversight

Re-read in Code - OSS 1.136.1 (`/usr/lib/code/out/vs/workbench/workbench.desktop.main.js`, not started):

- `editor.action.outdentLines`: `kbOpts:{kbExpr:ye.editorTextFocus,primary:2140,weight:100}`; 2140 = `CtrlCmd (2048) | BracketLeft (92)`, so Ctrl+[ on Linux/Windows and Cmd+[ on macOS, matching the extension's `key`/`mac`.
- Extension key bindings get `weight = 400 + index` (`t?f=300+i:f=400+i`, `t` = built-in extension); `getDefaultKeybindings()` concatenates core and extension entries and sorts by `weight1` ascending (`BCo`), so the extension entry is after the core one.
- `resolve()`: for the first key, every entry whose first chord is Ctrl+[ is a candidate; `_findCommand` walks backwards and returns the first whose `when` matches. `shinobi.workspaceHasDotnetFiles` is a global context key (set once in `activate`, `src/extension.ts:86`), so it matches in the editor, the terminal, everywhere. The winner has two chords, so the result is "more chords needed": `_doDispatch` returns `n=!0` (the key event is consumed), `_expectAnotherChord` shows the status bar message "(Ctrl+[) was pressed. Waiting for second key of chord..." and `_scheduleLeaveChordMode` leaves chord mode after 5 s (checked every 500 ms) or when the window loses focus. There is no fallback to the shorter binding: VS Code does not remember the outdent candidate.

What the user experiences in a C# file, all three OSes:
- Ctrl+[ (Cmd+[) alone: nothing is outdented; the status bar shows the "waiting for second key" message for up to 5 s.
- Then S: Sync with Active Document runs (intended). Then any other key: the status bar says "The key combination (Ctrl+[, X) is not a command." for 10 s and that key is swallowed too (`d(3063,...)`, `n=!0`).
- Ctrl+[ twice (the usual way of outdenting by two levels): first one enters chord mode, second one is "(Ctrl+[, Ctrl+[) is not a command"; no outdent at all.
- Ctrl+] (indent) still works, so the pair is asymmetric. Shift+Tab (`outdent`, VS Code's other default) still outdents the line or selection, which is what Visual Studio users press anyway (Ctrl+[ is not an outdent key in Visual Studio).
- Addition the reviewer missed: in the integrated terminal, `attachCustomKeyEventHandler` sends the key to the workbench instead of the shell when `softDispatch(...).kind === 1` ("more chords") and `terminal.integrated.allowChords` (default true) and `key !== "Escape"`. Ctrl+[ is the terminal's ESC alternative (vi mode in bash/zsh, vim in the terminal); with this binding it is swallowed there too, in every .NET workspace (read from the code, not pressed).

Intent: `docs/solution-explorer.md:72` says "Sync with Active Document (also from the editor)" and `docs/keyboard-shortcuts.md:10` "Anywhere": the binding is meant to work from the editor, because that is where Visual Studio's Ctrl+[, S is used. A `focusedView == 'shinobi-solution-webview' || focusedView == 'shinobi-solution-webview-secondary-sidebar'` condition would restore outdent but remove the main use (from the editor you are in the editor, not in the view). So the minimal fix is a decision, not a one-word `when`:
1. Keep the binding (VS parity) and add `&& !terminalFocus` (gives Ctrl+[ back to the shell; no VS loss), and document in `docs/keyboard-shortcuts.md` that Ctrl+[ replaces VS Code's Outdent Line in .NET workspaces and Shift+Tab outdents. This is the cheapest correct fix.
2. Or restrict it to `!editorTextFocus && !terminalFocus` (keeps the button and the palette command, loses the editor use).
A context key `shinobi.solutionExplorer.focused` does not exist; `focusedView` is enough if option 2 is wanted.

Severity: bug kept (a default editing key and the terminal's ESC are taken in every target workspace), but "Ctrl+[ no longer works in the editor" should say "Ctrl+[ starts a chord; outdent needs Shift+Tab", and the fix is a documented trade-off plus `!terminalFocus`.

### A7-9: CONFIRMED, plus one more activation path

- `src/extension.ts:86` sets `shinobi.workspaceHasDotnetFiles` to `true` unconditionally; nothing resets it (only setContext call for that key in `src/`).
- Explicit activation events are only `workspaceContains:**/*.sln` and `workspaceContains:**/*.slnx`; with `engines.vscode ^1.74` VS Code adds `onCommand:` for every contributed command, `onView:` for the three views and `onCustomEditor:shinobi.nugetPackageManager`.
- Reachable in a non-.NET workspace: 22 of the 83 commands are not hidden from the palette (`menus.commandPalette` hides the rest with `when: false`): Open NuGet Package Manager (and for Solution), Select Framework, Select Solution Configuration/Platform/Startup Profile, Configure Startup Projects, Attach to Process, Trust HTTPS Development Certificate, Start with Hot Reload, Configuration Manager, Start Debugging, Start Without Debugging, Sync with Active Document, Collapse All, Show All Files, Open Solution, Create New Project, Focus Solution Explorer, Show Error List, Show Log; Code Cleanup only for C# files. The views are hidden by the same key, so `onView` does not fire before activation; opening a `*.nuget` file does.
- Missed by the reviewer: the key binding Ctrl+K Ctrl+E (`shinobi.codeCleanup.file`, `when: editorTextFocus && editorLangId == csharp`) is not gated by the workspace key, so pressing it in any `.cs` file (a loose C# file, a Unity or script folder without `.sln`) activates the extension and flips the key as well.
- Afterwards: VS Code's `workbench.action.debug.run` (Ctrl+F5, core rule, weight 200) loses to the extension binding (`ctrl+f5`, `when: shinobi.workspaceHasDotnetFiles && !inDebugMode`, weight 400+), which runs `DebugConfigService.startStartupProject(true)` (`src/extension.ts:243`); without a solution there is no startup project, so it only shows "There is no startup project. Right-click a project in the Solution Explorer and choose \"Set as Startup Project\"." (`src/services/debugConfigService.ts:399-401`). The Solution Explorer container (activity bar or secondary side bar) and the Error List panel appear; Ctrl+[ (A7-1) and Ctrl+Alt+L (A7-5) are taken. Lasts until the window is reloaded (context keys are per window session, not persisted).
- Fix as proposed; note that a folder with only a `.csproj` (no solution) is a legitimate target too, so the check should be "a solution or a project file was found", re-run when the `*.sln*` / project watchers see a create (Create New Project into the open folder).

Severity: bug kept.

### A7-2: PARTIALLY CONFIRMED, severity lowered to risk (latent hardening): no publishing credential exists today

Checked with `gh` (read-only): the repository has **no** secrets (`gh secret list` empty) and **no** variables (so `OVSX_TRUSTED_PUBLISHING` is off), one collaborator (`hempe`), no branch protection on master, default workflow permissions `read` (`gh api .../actions/permissions/workflow` returns `"default_workflow_permissions":"read"`). Releases so far: v0.1.0 and v0.1.1 (pre-releases).

What holds:
- `release.yml:16-27`: `VSCE_PAT`/`OVSX_PAT` are job-level `env` and `id-token: write` is workflow-level, so once a token or trusted publishing is switched on (RELEASING.md plans trusted publishing), every step, including the install scripts of `npm ci`, the whole Jest run and webpack, can read the token or request the OIDC token (`ACTIONS_ID_TOKEN_REQUEST_URL/TOKEN` are in every step's environment). Open VSX cannot tell a postinstall's OIDC token from the publish step's: same repository, same workflow file `release.yml`, and the registration has "no environment". The installed `ovsx` 1.3.0 even says trusted publishing is "Enabled automatically when a CI system provides an ID token and no access token is given" (`node_modules/ovsx/lib/main.js:65`).
- Today's real exposure, missed by the reviewer: `contents: write` for the whole workflow, and `actions/checkout` persists the job's `GITHUB_TOKEN` for later git commands by default (`persist-credentials: true`), so a malicious dev dependency during `npm ci`/`npm test` of a release can push to master (unprotected) or replace the `.vsix` asset of the release, which is the file uploaded to the Marketplace by hand (RELEASING.md). This is the current-day risk, not the PATs.
- `npx --yes ovsx@1.2.0` resolves its dependency tree outside the lock file, while the locked `ovsx` 1.3.0 (`package-lock.json`, `^1.3.0` dev dependency) already has `--trusted-publishing`: confirmed; the pin was a guess (RELEASING.md:55 says so).

What does not hold or is overstated:
- Who can trigger it: `release: published` needs write access to the repository (only `hempe`). Fork pull requests run only `ci.yml` (`pull_request`), get a read-only token and no secrets; `release.yml` never runs for them. A malicious PR can only matter after it is merged into master, and then its code would also be in the shipped bundle, so for code in this repository splitting jobs changes nothing; the split protects only against a compromised **dev-only** dependency (the ~900 packages that are not bundled) or test code.
- "The master-only check lives in the tagged commit's own workflow": true (a `release` event runs the workflow of the tagged commit), but moot here: the only person who can publish a release can push to an unprotected master anyway. Only relevant once there are collaborators or branch protection.
- "`ci.yml` has no `permissions`, so write for older repositories": refuted for this repository; the default is `read`. Adding `permissions: contents: read` is defence in depth (survives a change of the repository setting), not a fix.
- Floating major tags of the four GitHub-owned actions: all four tags exist (`actions/checkout` v7, `setup-node` v7, `setup-dotnet` v6, `upload-artifact` v7: HTTP 200 from the GitHub API); pinning by SHA is good practice but the risk of a first-party action tag being moved is low compared to the npm one.
- A build-time compromise can still poison the `.vsix` itself (webpack runs in the job that produces the artifact); splitting the job protects the credentials, not the artifact.

Hardening worth doing (in this order, all small): `persist-credentials: false` on checkout; job `build` with `permissions: contents: read`, no secrets, running `npm ci`, typecheck, tests, `vsce package` and uploading the `.vsix` as an artifact; job `publish` (`needs: build`, `environment: release`, `permissions: contents: write, id-token: write`) that downloads the artifact and runs only `gh release upload` and the locked `npx ovsx publish` (no `npm ci` beyond `--ignore-scripts`, or `npx --yes ovsx@1.3.0` with the token as step-level `env`); register the trusted publisher with environment `release` (registration has to be recreated, RELEASING.md:53). SHA pins and `ci.yml` permissions are optional.


### A7-3: CONFIRMED, risk (licence) kept

Production build in `/tmp/v7/repo` (`npm run build`, exit 0), `npx vsce ls`: 23 files, the only notices are `out/extension.js.LICENSE.txt` (one line: `/*! http://mths.be/fromcodepoint v0.1.0 by @mathias */`) and the webviews' `bundle.js.LICENSE.txt` (React's five `@license` banners only); no `ThirdPartyNotices`. Packages in each bundle from the source maps (licence from their `package.json`):

- `out/extension.js`: `balanced-match` (MIT), `brace-expansion` (MIT), `glob` (BlueOak-1.0.0), `jsonc-parser` (MIT), `minimatch` (BlueOak-1.0.0), `sax` (BlueOak-1.0.0), `semver` (ISC), `xml2js` (MIT), `xmlbuilder` (MIT); `path-scurry` & co. are in the bundle too (their classes `PathScurryPosix`/`Win`/`Darwin` are in `out/extension.js`) although concatenated modules are missing from the map.
- Webviews: `react`, `react-dom`, `scheduler` (MIT, notices kept), `@iconify/react`, `markdown-to-jsx`, `vscrui` (which ships `styled-components` in its own `dist`) (MIT, no notice), `semver` (ISC).
- `out/webview/codicons/codicon.css` keeps Microsoft's MIT header (copied, not minified); `codicon.ttf` is under CC-BY-4.0 (`@vscode/codicons/package.json` `"license": "CC-BY-4.0"`, `LICENSE` and `LICENSE-CODE` in the package): needs an attribution, none shipped.

What the licences require: MIT and ISC: the copyright and permission notice "shall be included in all copies or substantial portions" (a minified bundle is a copy); BlueOak-1.0.0 (`node_modules/sax/LICENSE.md` "Notices"): everyone who gets a copy must also get the licence text or a link to it; CC-BY-4.0: credit, licence link, indication of changes. The terser default (`extractComments` keeps only `/*!`, `@license`, `@preserve`) drops all of them because these packages have no banner comments.

Cheapest correct fix: `license-webpack-plugin` (not installed yet) in both webpack configs, writing e.g. `out/THIRD_PARTY_NOTICES.txt` per configuration (`outputFilename`, with `perChunkOutput: false` for the webviews), plus a hand-written codicons line ("Codicons, (c) Microsoft, CC BY 4.0, https://creativecommons.org/licenses/by/4.0/") appended via `additionalModules`/`licenseTextOverrides` or a static file, and add the file(s) to the `.vscodeignore` allow list; a unit test can check `vsce ls` contains it.

### A7-4: CONFIRMED, wording corrected ("silent" is overstated), risk kept

Re-read `getExtensionUntrustedWorkspaceSupportType` (returns `!0` when trust is off or the extension has no `main`, else configured > product override > `capabilities.untrustedWorkspaces.supported` > product default > `!1`) and `getExtensionVirtualWorkspaceSupportType` (configured > product override > `capabilities.virtualWorkspaces` > product default > `!0`) in 1.136.1: as the reviewer says. Correction: Restricted Mode is not silent: the window shows the Restricted Mode banner and status item, and the Extensions view lists the extension under "Disabled in Restricted Mode" (strings in `out/nls.messages.json`); only an extension-specific reason is missing (the `description` field). Declaring `untrustedWorkspaces.supported: false` changes nothing but that text. The virtual-workspace part holds (default supported); its effect stays suspected (not run with Remote Repositories). Proposed declaration is right; it can be one block of `package.json` with no code change.

### A7-5: UNVERIFIED (needs Windows), plausible; risk kept as suspected

VS Code turns AltGr into Ctrl+Alt only through the browser's modifier flags (`resolveKeyboardEvent`: `ctrlKey || _mapAltGrToCtrlAlt && altGraphKey`); on Windows, Chromium reports AltGr as `ctrlKey && altKey` (Windows synthesizes left Ctrl), so the event is Ctrl+Alt+L and the extension binding (`when: shinobi.workspaceHasDotnetFiles`, no focus condition) matches before the character is typed. Polish (Programmers) has `ł` on AltGr+L. Not pressed on Windows. Note that Visual Studio uses the same key, so the conflict exists there too; `!editorTextFocus` would cost the "from the editor" use, which is the main one, so a docs note is the more likely fix.

### A7-6: CONFIRMED, cleanup

Value import `sendToUi` from `src/webview/nuget-view/shared.ts` in `NuGetCustomEditorProvider.ts:8` and `SolutionWebviewProvider.ts:15` pulls the module into the host bundle (the `LocalNuGetPackage` imports in `types/commands/*.ts` and `nugetManagerService.ts:13` are types only and erased). Loading the production `out/extension.js` with a stubbed `vscode` under Node prints `C# 21:08:59.538 [INF] NuGetReact: Using fallback VSCodeAPI for development` (rerun in `/tmp/v7/load`). Root `tsconfig.json` has `lib: ["ES2020", "DOM"]`. As reported.

### A7-7: CONFIRMED, cleanup

`grep` over `src`, `scripts`, `webpack.config.js`, `jest.config.js`, `jest.setup.js`: no import of `uuid` (in `dependencies`), `sinon`, `@types/sinon`, `@vscode/test-electron`, `webpack-dev-server`; `style-loader`/`css-loader` only in the `.css` rule of `webpack.config.js:78-79`, no `.css` import in `src` (codicon.css is copied by `copy-webpack-plugin`), and no bundle contains style-loader's runtime (`styleTagTransform`/`insertStyleElement` absent). `uuid` is not bundled, so removing it changes nothing in the vsix (`--no-dependencies`), it is only noise in `dependencies`.

### A7-8: CONFIRMED, cleanup

`ci.yml:10-12` (`group: ci-${{ github.ref }}`, `cancel-in-progress: true`) and `scripts/screenshots/capture.sh:29` (exports `DISPLAY=:97`, no `unset WAYLAND_DISPLAY`), `test:coverage` exists (`package.json:1777`) but no workflow runs it and `jest.config.js` has no `coverageThreshold`. Nuance on the first point: the cancelled run's commit is still tested as part of the next push's run (cumulative), only that intermediate commit has no own result.

### A7-10: PARTIALLY CONFIRMED, mechanism is "the theme is not listed", not "the path does not exist"; risk kept

In the extension host (`/usr/lib/code/out/vs/workbench/api/node/extensionHostProcess.js`), `vscode.extensions.all` returns `va.mine.getAllExtensionDescriptions()`, i.e. `_myRegistry` = only the extensions running in **this** extension host (`myExtensions` from the init data); the extensions of other hosts are only in `allAcrossExtensionHosts`, which needs the proposed API `extensionsAny`. Icon theme extensions have no `main`; the `iconThemes` extension point declares no `defaultExtensionKind`, so they deduce `["ui","workspace","web"]` and, installed locally, run on the UI side. In Remote-SSH/WSL/Dev Containers the extension (deduced `["workspace"]`, it has `main`) therefore does not see the theme in `extensions.all` at all: `_load` (`src/services/iconThemeService.ts:160-183`) finds no contribution, `_theme` stays undefined and the Solution Explorer uses its own icons. The `fs.readFileSync` path is never reached, so the proposed fix (`vscode.workspace.fs` with the theme's `extensionUri`) would not help: the theme extension is not reachable from the remote host with stable API. Only works when the user also installs the theme on the remote. Fix: accept the fallback and document it in `docs/solution-explorer.md` ("with Remote, install the icon theme on the remote too, or the built-in icons are used"). Not tried on a remote host.

### `engines.vscode` (^1.74.0, README.md:137 and docs/README.md:28 "VS Code 1.74 or later")

`@types/vscode` is `1.74.0` and `npm run typecheck` passes, so every TypeScript-visible API (`LogOutputChannel` 1.74, `window.tabGroups`/`TabInputText`/`TabInputCustom` 1.67, the test API with `TestItem.description`, `TestRunProfile.isDefault`, `TestRunRequest` 1.59, `createFileSystemWatcher(glob | RelativePattern)` without the newer options overload) exists in 1.74. What the types cannot check:

| Used | Where | First VS Code version | On older versions |
|---|---|---|---|
| `contributes.viewsContainers.secondarySidebar` | `package.json` | 1.106 (proposed `contribSecondarySideBar` in 1.104, finalized in 1.106: vscode-docs `release-notes/v1_104.md:639`, `v1_106.md:746`) | unknown key; the view `shinobi-solution-webview-secondary-sidebar` references an unknown container and VS Code puts such views into the Explorer; only visible when `shinobi.solutionExplorer.location` is `secondary-sidebar` |
| `workbench.action.files.setActiveEditorReadonlyInSession` | `src/services/solutionActionService.ts:340` (generated files) | 1.79 (`release-notes/v1_79.md:79`) | "command not found" thrown, caught by the surrounding `try`, which logs it and shows the error message "Error opening file: Error: command ... not found" although the file did open (writable) |
| `presentation.hidden` / `presentation.order` in launch.json | `debugConfigService.ts:197-202` | long before 1.74 | fine |
| `menus.webview/context`, `webview` views, custom editors, `viewsWelcome` | `package.json` | before 1.74 (webview/context 1.70) | fine |
| Required C# extension: `ms-dotnettools.csharp` (`dotnet/vscode-csharp` main) and `muhammad-sammy.csharp` 2.160.9 on Open VSX | `csharpExtensionCheck.ts` | both declare `engines.vscode ^1.106.0` | on 1.74-1.105 only old C# versions install |

So the declared minimum is too low in practice: the secondary-sidebar location and the current C# extensions need 1.106, read-only generated files need 1.79. Options: raise `engines.vscode` (and README.md:137, docs/README.md:28) to `^1.106.0` and `@types/vscode` with it, or keep 1.74 and document that "Solution Explorer location: secondary side bar" needs 1.106. Nobody has run the extension on 1.74 (the reviewer's "Not reviewed" says so too). New finding, call it A7-11 (risk, docs/compat).
