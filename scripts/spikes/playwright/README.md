# Playwright spike: driving VS Code

`./run.sh` starts its own Xvfb display (`PW_DISPLAY`, default 93; never the desktop), launches the real VS Code (Code - OSS) through
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
