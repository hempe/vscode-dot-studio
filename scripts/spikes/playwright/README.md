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
- Everything stops cleanly on `app.close()`; no process is left behind.

Not tried yet: the C# extension in the profile (needed for refactorings, rename, debugging), native context menus (not reachable
from the DOM), the editor area's refactoring forms, the NuGet custom editor.

## Checks

`lib.mjs` holds the helpers (workspace copy with settings and extra files, launch, the welcome dialog, the view's frame, `expandPath`,
`rowInfo`); a check is a script that uses them and prints PASS/FAIL (exit code 1 on a failure):

- `check-file-nesting.mjs`: the `fileNesting` setting (`default`, `off`, `web`) on the Shop.Web sample, from the "new settings" entry of
  [manual-testing.md](../../../docs/manual-testing.md). A tree row is `.tree-node` (padding-left is its depth, a `.expand-icon` means
  it has children, `rotate(90deg)` means open); each check starts its own VS Code, about 40 s.
