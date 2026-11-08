# Playwright spike: driving VS Code

`./run.sh [script.mjs]` (default `spike.mjs`) starts its own Xvfb display (`PW_DISPLAY`, default 93; never the desktop), launches the real VS Code (Code - OSS) through
Playwright's `_electron.launch` with this extension loaded (`--extensionDevelopmentPath`, so `npm run build:dev` first), a throwaway
profile in `/tmp` and a copy of the sample solution, opens the Solution Explorer, expands the tree with the keyboard and prints the rows.

Setup once: `cd scripts/spikes/playwright && npm install` (only `playwright-core`; no browser is downloaded, Electron is VS Code's).

What the spike found (2026-11-05, Code - OSS 1.136.1 with Electron 42 from Arch):

- Playwright needs the Electron binary and VS Code's entry, not the `code-oss` wrapper script: `/usr/lib/electron42/electron /usr/lib/code/code.mjs`
  (`ELECTRON_BIN`, `CODE_MAIN` override them).
- A fresh profile shows a two-step welcome dialog ("Continue without Signing In", then "Get Started") that covers everything; click both away.
- Open the folder, not the `.slnx` (that opens the file as text and the view says "no solution").
- The activity bar item toggles the side bar: find it with `.activitybar [role=tab]:has(a[aria-label="Solution Explorer"])` and click only
  when `aria-expanded` is not `true`.
- Webviews are frames of the window: `vscode-webview://.../index.html` (outer) and `fake.html` (the content, where `[data-vscode-context]`
  rows are). Locators work in that frame; the keyboard is the window's (`win.keyboard`), not the frame's.
- Startup is the cost: ~25 s with a fresh profile (most of it waiting for the welcome dialog), ~7 s from a warm one. `launch` keeps the
  profile of the first run as a template in `/tmp/shinobi-pw-profile-template` and copies it for every later run (delete it to start cold).
- One VS Code for several checks (changing the workspace settings file while it runs) was tried and dropped at first: after a change of
  `fileNesting` the rows that were open showed an open chevron without their children (`wwwroot` without `js`). That was a bug (a project's
  folders were restored before the project had loaded; fixed 2026-11-07, `check-file-nesting.mjs` covers it), but each setting value still
  gets its own start; checks that need the same settings can share one.
- `run.sh` waits for the previous Xvfb to be gone; started right after another run, the new server did not get the display and every
  second run failed with "Missing X server or $DISPLAY".
- Everything stops cleanly on `app.close()`; no process is left behind.
- Context menus, quick picks, input boxes, modal dialogs and notifications are in the page: `launch` writes `window.menuStyle: custom`,
  `window.dialogStyle: custom`, `files.simpleDialog.enable` (the open and save dialogs become quick inputs) and
  `terminal.integrated.gpuAcceleration: off` (the terminal's text is in the DOM) into the profile. lib.mjs has helpers for them
  (`contextMenu`, `menuLabels`, `pickQuick`, `answerInput`, `modal`, `waitForToast`, `terminalText`, `editorTabs`). A menu ignores a
  click that comes right after it opened (the mouse-up of the right-click): `pickMenu` waits 0.6 s and hovers first.
- `part(name, fn)` runs a part of a check and turns an exception into a failed check, so the rest still runs.

Not tried yet: the C# extension in the profile (needed for refactorings, rename, debugging), native context menus (not reachable
from the DOM), the editor area's refactoring forms, the NuGet custom editor.

## Checks

`lib.mjs` holds the helpers (workspace copy with settings and extra files, launch, the welcome dialog, the view's frame, `expandPath`,
`rowInfo`); a check is a script that uses them and prints PASS/FAIL (exit code 1 on a failure):

- `check-file-nesting.mjs`: the `fileNesting` setting (`default`, `off`, `web`) on the Shop.Web sample, from the "new settings" entry of
  [manual-testing.md](../../../docs/manual-testing.md). A tree row is `.tree-node` (padding-left is its depth, a `.expand-icon` means
  it has children, `rotate(90deg)` means open); each setting value starts its own VS Code, about 20 s for the three.
- `check-tracking.mjs`: `trackActiveItem` on (a file opened with Ctrl+P is selected in the tree, a nested one is revealed, the editor keeps
  the focus) and off (nothing is selected), and Ctrl+Alt+L focusing the Solution Explorer. Files are opened by keyboard, as a user does.
- `check-emit-generated.mjs`: `shinobi.build.emitGeneratedFiles` on and off: builds the sample with the default build task (Ctrl+Shift+B,
  needs the .NET SDK and the sample's packages in the NuGet cache) and looks at the generators under Shop.Core > Dependencies > Analyzers
  (files to expand, or none). About 30 s. Row names are matched by their full text (`normalize-space(.)`), not the first text node.
- `check-discover-after-build.mjs`: `shinobi.tests.discoverAfterBuild` on (the tests show after Ctrl+Shift+B) and off (they stay "not built yet"
  until the refresh button, which builds and discovers). Found two bugs in the Test Explorer on the way (both fixed): three test projects were
  built at once, and the "not built yet" description stayed after discovery because VS Code ignores `description = undefined`.
- `PW_LOG=shinobi.dotnet-studio=trace ./run.sh ...` starts VS Code with that log level; the extension's log is then in
  `<work>/profile/logs/*/window1/exthost/shinobi.dotnet-studio/` (the work folder is in /tmp, printed by `prepareWorkspace` users on failure).
- `check-include-prerelease.mjs`: `shinobi.nuget.includePrerelease` on and off: the NuGet manager (opened from the command palette) shows
  "Include prerelease" checked or unchecked. The manager is a custom editor, so its webview is one more frame of the window.
- `check-configuration-grid.mjs`: Configuration Manager on a `.sln` and a `.slnx`: the grid's Configuration against `dotnet build` of the solution, Copy settings from and a rename (the projects keep building in the copied configuration), the active configuration against Ctrl+Shift+B, the last configuration cannot be removed. Found: a copy from a configuration without explicit mappings built the projects in a configuration of the new name.
- `check-drag-opens-target.mjs`: a drop opens its target: a project, two projects and a solution folder onto a collapsed solution folder (`.sln` and `.slnx`), a file onto a collapsed folder (selected a moment later), collapsing right after the drop; an open solution folder with open subfolders moved in a `.slnx` without Ids stays open. Found: the open folders lost their children after a refresh (the fix above).
- `check-dependencies-fresh.mjs`: a fresh `dotnet new console` project shows Dependencies with Analyzers, Packages, Projects, Assemblies and Frameworks.
- `check-global-json.mjs`: the New Project wizard with a `global.json` pinning SDK 8.0.130 next to 10.0: the framework option lists net8.0 and not net10.0, Create writes a net8.0 project without "Invalid option(s)".
- `check-tabs-follow-solution.mjs`: Configuration Manager and Configure Startup Projects open, then Open Solution... switches the solution (two solutions in the folder: the extension asks which one first): the tabs show the new solution's projects and configurations, an edit of the old file does not reach them.
- `check-failed-evaluation.mjs`: a project whose evaluation fails (a `global.json` pinning an SDK that is not installed) shows the disk listing, the log says so, and deleting `global.json` makes the listing right by itself at the next retry; also after the project stayed collapsed for 5 minutes. Takes about 25 seconds with the delays scaled by `SHINOBI_RETRY_DELAY_SCALE` (`SKIP_FIRST=1` runs only the second part).
- `check-project-menus.mjs`: from the context menus, on `.slnx` and `.sln`: Add Solution Folder and Rename with a taken name (an error, the file unchanged), the same name under another parent; Unload Project (greyed out, Build skips it, still unloaded after a restart, Reload); Pack only on libraries, its message and the IsPackable warning; Open Launch Settings (opens, creates for a console and a web project, not on libraries and test projects); Manage User Secrets (the value reaches the app). Found: an xUnit v3 test project counted as startable.
- `check-exclude-include.mjs`: Exclude From Project and Include In Project on files, folders, a big folder (the question, Cancel), explicit and block-form items, Directory.Build.targets, the item types Include picks (and the Razor page answers), the entries missing where they make no sense. Found: after a change of the items, a file with nested files (Index.cshtml) opened without them.
- `check-nested-projects.mjs`: a nested project's folder in the outer tree (Exclude edits the right project, the two views open and close on their own); Directory.Build.props (DefaultItemExcludes) and Directory.Build.targets (Compile Remove) change the trees without a reload.
- `check-nuget-manager.mjs`: NuGet manager on the solution: authors (no "by Unknown"), the vulnerable and deprecated labels with their details and checkboxes, the Updates tab and Refresh, and no `unsafe-eval` in the policy of the Solution Explorer and the manager. Runs with a throwaway HOME.
- `check-nuget-sources.mjs`: the Sources tab (disable and enable against `dotnet nuget list source`, Add to the user's and the solution's config, a duplicate and a bad address, Remove asks), the Package source dropdown of Browse and the filter of Updates against a feed served over HTTP from a folder (`startFeed` in lib.mjs), and Refresh showing a version published meanwhile (found: Refresh kept the package details for ten minutes).
- `check-configuration-manager.mjs`: Configuration Manager: opens from the palette, no platform dropdown with only Any CPU, the Build checkbox against `dotnet build` of the solution, add, rename (Enter commits) and remove a configuration; a rename changes only the solution side, the projects keep their own configuration name (as in Visual Studio). Platforms (add, rename, remove) and the refresh when the file changes on disk are covered; the .sln variant is not.
- `check-error-list.mjs`: the Error List after a build: rows, counts, sort, search, code link, double-click to the line (editor tab and the status
  bar's `Ln 15`), the Warnings toggle also emptying the tree's markers (`.node-name.diagnostic-warning`). Opened from the palette ("Show Error List"); its
  webview and the tree's are both `fake.html` frames, told apart by their content. Not covered: the column filters.
- `check-transitive-packages.mjs`: Shop.Web > Dependencies > Packages > Microsoft.EntityFrameworkCore.Sqlite expanding to a third level; the NuGet manager
  of the solution with the collapsed "Transitive packages (N)" section, a transitive package's marks and no uninstall. A row name ending in `*`
  matches the start of the text (package rows carry their version). The manager loads from nuget.org: allow up to a minute.
- `check-hover.mjs`: the Solution Explorer's `.tree-node.hovered` (a class, not CSS :hover): under the mouse, moving, gone when the mouse leaves (activity
  bar, below the rows) and after a real drag and drop (mouse down, moves, up) until it moves again. Leaving onto another webview does not clear it
  under Playwright's synthetic mouse; not known whether that happens for a real mouse.
- `check-drag-drop.mjs`: plain files dragged with the real mouse: refusals (a file on a solution folder or on Dependencies, a folder on its own
  subfolder), Dependencies not draggable, a collapsed folder opening after 0.7 s of hovering, a Ctrl+click selection moving together, an unselected row
  moving alone (a second start: after moves the open folders show no children, a known bug).
- `check-test-explorer.mjs`: the Testing view (native, so plain DOM: `.pane-body .monaco-list-row`, state in the `testing-*-icon` class) with the three sample
  test projects: refresh builds and discovers, Test: Run All Tests from the palette, the states, messages, parameterized cases, double-click to the line.
- `check-namespace-after-move.mjs`: needs the installed C# extension, which `launch(ws, { csharp: true })` links into the profile (with the .NET runtime
  extension) and the language server needs ~20 s to load the projects. The modal question is an HTML dialog because `lib.mjs` sets
  `window.dialogStyle: custom` (a native dialog is invisible to Playwright); the per-file questions of Review Each are notifications. Found: the
  files that use a moved type do not follow in this run ("the server offers no fix": the Change namespace code action was not offered, also with
  `analyzerDiagnosticsScope: fullSolution` and IDE0130 in `.editorconfig`); the declarations are changed by the text fallback. Not known whether
  that is the run (timing right after the move) or a real gap; check by hand.
