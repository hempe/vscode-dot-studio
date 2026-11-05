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
