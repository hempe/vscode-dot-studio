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
- One VS Code for several checks (changing the workspace settings file while it runs) was tried and dropped: after a change of
  `fileNesting` the rows that were open show an open chevron without their children (`wwwroot` without `js`, see the roadmap's known bugs),
  so each setting value gets its own start; checks that need the same settings can share one.
- `run.sh` waits for the previous Xvfb to be gone; started right after another run, the new server did not get the display and every
  second run failed with "Missing X server or $DISPLAY".
- Everything stops cleanly on `app.close()`; no process is left behind.

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
