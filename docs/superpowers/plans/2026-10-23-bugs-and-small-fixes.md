# Known Bugs and Small Fixes (Phase 21, Parts 3 and 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the known bugs of `docs/roadmap.md` "Phase 21, Part 3" and the limitations of "Phase 21, Part 4" before the code review of Phase 22: every item was reproduced first (real `dotnet`/MSBuild, the real code driven from Jest, a real VS Code in its own Xvfb display where a webview was involved); items that did not reproduce are dropped with the evidence instead of getting a fix.

**Architecture:** Small changes where the bugs are, grouped by code area:
- Project items and MSBuild (Tasks 1–2): `ProjectItemsService` remembers failed evaluations and retries them after 5 s, 30 s and 2 min, and when a folder is expanded; `Project.reloadLoadedFolders` reads parents before children.
- Project file edits (Tasks 3–5): `ProjectFileEditor` finds block-form items; file and folder node ids get an optional owning `project` in a nested project's folder so Exclude/Include edit the clicked project; Delete on a linked file warns, and a new **Remove Link** command removes only the item (`src/core/contextMenus.ts`, `npm run generate:menus`).
- Drag & drop (Tasks 6–7): the hover highlight becomes a class the tree controls (Chromium moves `:hover` after a drop); after a drop the target opens and the moved nodes are selected (`moveNodes` returns a `DropResult`, the provider reveals it on the next tree rebuild).
- Central packages (Task 8): files the extension writes are recorded with their stamp (`OwnWrites`), so the props and project file watchers skip them and the explicit re-evaluation after the restore is the only one.
- Test Explorer (Task 9): `RunSettingsFilePath` from the Test Explorer's own MSBuild query; VSTest gets the file without data collectors and loggers, VSTest projects sharing a file run in one session (so `MaxCpuCount` works); Microsoft.Testing.Platform apps with the VSTest bridge get `--settings`.
- gRPC references (Tasks 10–11): the case-only duplicate check is pinned by a test; an older `Google.Protobuf` the new packages need is raised after asking.
- Tests (Task 12): the bin/obj casing tests run every platform's branch on every system.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`/`noUnusedParameters`), VS Code extension API, React webview, Jest (`jsdom`, `@testing-library/react`), `dotnet msbuild -getItem/-getProperty`, vstest.console design mode, Microsoft.Testing.Platform server mode, NuGet V3 registration data.

**Verified while planning** (.NET SDK 10.0.111 and 8.0.130, nuget.org on 2026-10-23): every code block of Tasks 1–12 was applied to a scratch copy of the repository (`git archive HEAD`) in task order and run there: `npm run typecheck` clean, the full Jest suite green (163 suites, 1441 tests, up from 156 / 1357; the real-MSBuild and real-dotnet tests included), `npm run build:dev` exit 0. Each group of tasks (1–2, 3–4, 5, 6–7, 8 and 12, 9, 10–11) was also verified alone on HEAD. The repro of each item is in its task ("Repro (done while planning)").

**Items dropped or changed (with the evidence):**
- **Dropped, not reproducible: "Show All Files is read from a global that is set to the new solution only after it has loaded".** Driving the real `SolutionService.openSolution` (Jest, `vscode` mocked) on two copies of `src/__fixtures__/solution-hierarchy`, A with Show All Files on and B off, with every evaluation answered at once and each one a new item list (the "answered from the cache" case of the item), and counting `Project.loadFolderChildren` calls with the `ShowAllFiles.isOn()` they saw: 5 reads in A (all `true`), **0 reads while B loaded** and 0 in the 200 ms after; B then read `false`. The new `Project`s of B have no loaded tree and no expanded folder, and `evaluateItems` returns early for a collapsed tree, so nothing reads a folder before `ShowAllFiles.setSolution(solutionPath)`, which runs synchronously right after `await solution.ready` (no `await` between `setActiveSolution`, `setActiveSolutionPath` and `setSolution`; the only active-solution listener, `CentralPackageWatchers.update`, reads no folders). The roadmap item moves to the history as "checked, not reproducible" (Task 13); it comes back with a repro if someone sees a wrong setting.
- **Not reproducible, already handled: "gRPC references: a case-only duplicate such as `a.proto` / `A.PROTO` on Windows or macOS is not detected (unproven)".** `duplicateRefusal` and `isExistingReference` compare through `pathKey`, which lowercases on win32 and darwin; with `process.platform` overridden the real functions refuse `A.PROTO` against `a.proto` on win32 and darwin in all three paths (evaluation, project file text, link clash) and accept it on linux. No fix; Task 10 only adds the test that proves it.
- **Changed: "After a drag & drop a grey hover highlight sometimes stays ... (Chromium sends no mouse-leave during a drag); clear it on drag end".** Reproduced in a real VS Code (own Xvfb `:97`, `capture.sh`), but the cause is different: the highlight is pure CSS (`.tree-node:hover`), and right after the drop Chromium sends a `mouseover` with no movement at the drag's start position, moving `:hover` to whatever row is there now. Clearing state on drag end cannot fix a CSS `:hover`; Task 6 replaces it by a `hovered` class the tree sets from mouse events and suppresses from a drag's start until the mouse really moves. A plain Electron 42 page did not show it, only VS Code's webview.
- **Changed: "Central packages: ... possibly evaluated twice ... the CentralPackageWatchers have no debounce".** Measured in a real VS Code with every `runMsbuild` logged: Serilog 3.1.1 → 4.0.0 from the solution's NuGet manager ran **9 MSBuild evaluations for 5 projects** (the props watcher at +81 ms while the restore ran, then the explicit re-evaluation of the 4 affected projects at +1250 ms); a `VersionOverride` edit ran 2 instead of 1. The watchers were already one run per project, so a debounce would not remove the second run; Task 8 makes the watchers skip the extension's own writes instead.
- **Changed: "Item matching ... a block-form item (... or one with metadata children)".** A `Remove` item with child elements is an MSBuild error (`MSB4162: Child elements are not allowed below a item remove element`), so "metadata children" concerns `Include` items only; Task 3 covers both by matching an opening tag and its closing tag.
- **Wider than the item: Test Explorer run settings.** The user's decision was "the file's RunConfiguration section (MaxCpuCount, BatchSize...), not its data collectors". Task 9 passes the whole file except `DataCollectionRunSettings`, `InProcDataCollectionRunSettings` and `LoggerRunSettings`, because `TestRunParameters`, `RunConfiguration/EnvironmentVariables` and the adapter sections are what changes results (repro: tests reading a `TestRunParameters` value and an environment variable fail in our Testing view and pass with `dotnet test`). `MaxCpuCount` only parallelises assemblies within one vstest.console session, and the Test Explorer ran one session per project, so VSTest projects with the same vstest.console and the same run settings file now share one session (two assemblies of 3 s: 7.1 s with `MaxCpuCount` 1, 3.7 s with 0). `BatchSize` is passed but has no visible effect in design mode (7 batches either way). See open question 3.
- **Microsoft.Testing.Platform (decided after trying it):** an MSTest runner app in server mode accepts `--settings` and applies `TestRunParameters` and `MSTest/Parallelize` (it logs that `MaxCpuCount` is not supported and ignored); with `EnvironmentVariables` in the file it restarts itself as a separate test host that connects to our port a second time and crashes (`SocketException (111)`, exit 7); an xUnit v3 app answers `Unknown option '--settings'` and never connects. So `--settings` (a cleaned temp copy without collectors, loggers, `DesignMode` and `EnvironmentVariables`) is passed only when `Microsoft.Testing.Extensions.VSTestBridge.dll` lies next to the app (MSTest and NUnit runners), and the file's environment variables are set on the process the Test Explorer starts.

**Open questions for the user** (the plan goes ahead with the choice in brackets; each is one line to change):
1. Delete on a linked file: Visual Studio's Delete on a link, as far as known, removes only the link. The plan keeps your decision (a clear warning with the real path, plus Remove Link as a button and as a command). [warning + Remove Link]
2. gRPC and an older `Google.Protobuf`: raise it to the lowest version the new packages need, or to the newest stable? And when the user keeps the old version: add the reference without its packages, or cancel the Add? [lowest needed; add without packages, the message says what to raise]
3. Test Explorer: is passing the whole run settings file minus collectors and loggers (not only `RunConfiguration`) and running VSTest projects that share a file in one session acceptable? VSTest projects with different target frameworks would share a session too (not tried: only net10.0 test projects here; the fallback is the framework in the group key). Relative paths inside the file (`ResultsDirectory`, `TestAdaptersPaths`) do not resolve as with `dotnet test`. [yes; left as is]
4. Central packages: projects that the explicit re-evaluation leaves out after a NuGet manager edit (none in the measured case: the props watcher also evaluated Legacy, which has CPM off and is not affected) no longer get the watcher's evaluation. And projects without CPM still go through `dotnet add package`, which is probably also evaluated twice (the project watcher during the CLI run, then `cliUpdated`); not measured and not in the roadmap item. Measure it and add it to Known bugs? [left out]
5. Drag & drop: should a drop also move the keyboard focus into the tree? The namespace question may open the moved file in an editor first. [`focus: false`]
6. The Show All Files item is dropped as not reproducible and recorded in the history as checked. Keep it in the roadmap instead? [history]

**Conventions to follow (from CLAUDE.md and the memory notes):**
- Tests: `npx jest <path>`; the full suite is `npm test`; `npm run typecheck` before each commit. `noUnusedLocals`/`noUnusedParameters` break the build, also for private members left unused after a refactor.
- `npm run build:dev` builds two configurations: judge it by its exit code (`; echo "exit $?"`), not by its output.
- Extension-host tests mock `vscode` per file with `jest.mock('vscode', () => ({ … }), { virtual: true })`; tests with a real `Project` stub `ProjectItemsService.instance.evaluate`.
- Real-MSBuild/real-dotnet tests are skipped without `dotnet` (`spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip`), with a 150 s timeout.
- Windows is a CI gate: build every path in tests with `path.join`/`path.resolve`, never with `/` literals (file contents are text and stay as they are). Tests that override `process.platform` restore the original descriptor in `finally`.
- Webview code must not import `vscode`, Node modules or `nodeIdService`, and must not decode node ids (`src/test/unit/webview/shared/opaqueNodeIds.test.ts`); `src/test/unit/build/webviewBundle.test.ts` builds the bundle. Task 7's `selectNode` carries opaque ids only.
- Task 5 changes `src/core/contextMenus.ts`: run `npm run generate:menus` and commit `package.json` and `docs/context-menus.md` with it (unit tests fail when they are out of sync).
- Real VS Code runs (Task 7's GIF scene) go in their own Xvfb display (`scripts/screenshots/capture.sh` uses `:97`), with `WAYLAND_DISPLAY` unset, their own `--user-data-dir`/`--extensions-dir` and a copy of the fixture in `/tmp`; never on the user's desktop (CLAUDE.md, "Running VS Code or Electron").
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Commit to `master`, push after the last task (the user's workflow: no branches). `git add` only the files of the task, by path: other agents may have uncommitted work in the tree.
- Every task that changes what a user sees has its own docs step (docs page, an unticked `docs/manual-testing.md` entry, a GIF only where the change is hard to understand without one), in the same commit. Only Task 7 needs a GIF (`docs/images/drag-and-drop.gif` is re-captured because its scene changes); Tasks 1, 3, 4, 5, 6, 8, 9 and 11 say why they need none; Tasks 2, 10 and 12 change nothing a user sees.
- Several tasks append to the same docs (`docs/manual-testing.md`, `docs/solution-explorer.md`) and add tests at the end of `src/test/unit/core/Project.items.test.ts` ("before the closing `});` of the `describe`"): the anchors are text, not line numbers, so the tasks apply in order.

---

## File structure

| File | Task | Responsibility |
|---|---|---|
| `src/services/projectItems/projectItemsService.ts` (modify) | 1 | `RETRY_DELAYS_MS`, failures in a row, `retryDue`, `retryDelay`; `evaluate` runs again once a retry is due |
| `src/core/Project.ts` (modify) | 1, 2, 4, 5, 8 | retry timer and retry on expand (1); parents first in `reloadLoadedFolders` (2); the owning project in node ids (4); `linked` context value (5); skip own writes in the project file watcher (8) |
| `src/parsers/projectFileEditor.ts` (modify) | 3 | items matched by opening tag and closing tag (block form, metadata children) |
| `src/services/nodeIdService.ts`, `src/services/projectItems/projectItemEdits.ts`, `src/services/solutionExpansionService.ts` (modify) | 4 | optional `project` on file/folder ids, `inNestedProject`, the expansion uses the id's project |
| `src/services/projectItems/linkedItems.ts` (create), `src/services/projectItems/projectItems.ts`, `src/core/contextMenus.ts`, `src/types/commands/project-action.ts` (modify) | 5 | `removeLinkedItem`, the Delete texts, `isLinked`, the Remove Link command and menu |
| `src/services/solutionActionService.ts` (modify) | 4, 5, 7 | `_handleItemMembership` uses the id's project (4); Delete warning, Remove Link (5); `moveNodes` returns a `DropResult` (7) |
| `src/webview/solution-view/components/SolutionTree.tsx`, `TreeNode/TreeNode.tsx`, `types/index.ts`, `src/webview/providers/views/SolutionWebview.ts` (modify) | 6, 7 | the `hovered` class instead of `:hover` (6); `selectNode` with several ids (7) |
| `src/types/commands/ui.ts`, `src/webview/providers/SolutionWebviewProvider.ts`, `scripts/screenshots/capture.sh`, `docs/images/drag-and-drop.gif` (modify) | 7 | reveal after a drop, the GIF scene |
| `src/services/ownWrites.ts` (create), `src/services/nuget/centralPackageFiles.ts`, `centralPackageWatchers.ts`, `src/extension.ts` (modify) | 8 | the extension's own writes, skipped by the watchers |
| `src/services/testing/runSettings.ts` (create), `testProjects.ts`, `vstestClient.ts`, `testExplorer.ts` (modify) | 9 | reading and cleaning the run settings file, `RunSettingsFilePath`, one VSTest session per shared file, `--settings` for the VSTest bridge |
| `src/services/nuget/types.ts`, `nugetV3Service.ts`, `src/services/grpc/protobufReferences.ts`, `grpcReferenceService.ts` (modify) | 11 | package dependencies from the registration data, `rangeMinimum`, raising `Google.Protobuf` |
| `docs/solution-explorer.md`, `docs/tests.md`, `docs/connected-services.md`, `docs/context-menus.md` (generated), `docs/manual-testing.md`, `docs/roadmap.md`, `docs/history.md` | 1, 3–9, 11, 13 | docs, manual checks, roadmap and history |

Tests: per task, listed under **Files:**; new test files are `linkedItems.test.ts`, `linkedFiles.test.ts` (5), `itemMembership.nested.test.ts` (4), `ownWrites.test.ts` (8), `runSettings.test.ts`, `runSettings.dotnet.test.ts` (9).

---

### Task 1: A failed MSBuild evaluation is retried with a backoff and when a folder is expanded

**Files:**
- Modify: `src/services/projectItems/projectItemsService.ts`, `src/core/Project.ts`
- Test: `src/test/unit/services/projectItems/projectItemsService.test.ts`, `src/test/unit/core/Project.items.test.ts`
- Docs: `docs/solution-explorer.md`, `docs/manual-testing.md`

Repro (done while planning): a scratch project whose `App.csproj` held only the first 60 characters of a valid file, evaluated by the real `ProjectItemsService` with the real `runMsbuild` (SDK 10.0.111): MSBuild fails with `MSB4025: The project file could not be loaded. Unexpected end of file`, `evaluate` gives `undefined`. After writing the complete file, `evaluate` again gives `undefined` and `get` stays `undefined` without starting MSBuild (1 run in total): the failure is cached as `null` and only `invalidate` (a watcher event of the project file or a props file, new files) runs MSBuild again. The tree shows the plain disk listing meanwhile. A failure after an earlier good list keeps that list, but is not retried either (the list stays outdated). The existing test `a failing MSBuild gives undefined, is not retried until invalidated` pins this behaviour and is replaced.

The service remembers failures in a row with the time from which a retry is due (`RETRY_DELAYS_MS`: 5 s, 30 s, 2 min); `evaluate` runs MSBuild again once that time has passed, whoever asks. `Project` schedules the retries after each delay (at most three in a row), and reading a folder (expanding) asks again once the delay has passed, also after the third. A success clears the failure.

- [ ] **Step 1: Write the failing tests**

In `src/test/unit/services/projectItems/projectItemsService.test.ts` change the imports at the top to:
```ts
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectItemsService, RETRY_DELAYS_MS } from '../../../../services/projectItems/projectItemsService';
```
Replace the whole test `'a failing MSBuild gives undefined, is not retried until invalidated, and does not throw'` with:
```ts
    test('a failing MSBuild gives undefined and does not throw; it is not retried before the first delay', async () => {
        let clock = 1000;
        const run = jest.fn().mockRejectedValue(new Error('no sdk'));
        const service = new ProjectItemsService(run, 2, () => clock);
        expect(await service.evaluate(fixture)).toBeUndefined();
        clock += RETRY_DELAYS_MS[0] - 1;
        expect(await service.evaluate(fixture)).toBeUndefined();
        expect(service.get(fixture)).toBeUndefined();
        expect(run).toHaveBeenCalledTimes(1);
        service.invalidate(fixture);
        expect(await service.evaluate(fixture)).toBeUndefined();
        expect(run).toHaveBeenCalledTimes(2);
    });

    test('a failed evaluation is retried once its delay has passed, and the list it then gets is published', async () => {
        let clock = 1000;
        const run = jest.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(output('A.cs'));
        const service = new ProjectItemsService(run, 2, () => clock);
        expect(await service.evaluate(fixture)).toBeUndefined();
        expect(service.retryDue(fixture)).toBe(false);
        clock += RETRY_DELAYS_MS[0];
        expect(service.retryDue(fixture)).toBe(true);
        expect((await service.evaluate(fixture))?.isIncluded(path.join(dir, 'A.cs'))).toBe(true);
        expect(service.version(fixture)).toBe(1);
        expect(service.retryDue(fixture)).toBe(false);
        expect(service.retryDelay(fixture)).toBeUndefined();
        await service.evaluate(fixture);
        expect(run).toHaveBeenCalledTimes(2);
    });

    test('the delays grow with each failure in a row; after the last one the project no longer retries by itself', async () => {
        let clock = 1000;
        const service = new ProjectItemsService(jest.fn().mockRejectedValue(new Error('timeout')), 2, () => clock);
        expect(service.retryDelay(fixture)).toBeUndefined();
        const delays: (number | undefined)[] = [];
        await service.evaluate(fixture);
        for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
            delays.push(service.retryDelay(fixture));
            clock += service.retryDelay(fixture)!;
            await service.evaluate(fixture);
        }
        expect(delays).toEqual([...RETRY_DELAYS_MS]);
        expect(service.retryDelay(fixture)).toBeUndefined();
        // Asked for again (a folder expanded), it still runs MSBuild once the last delay has passed
        clock += RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
        expect(service.retryDue(fixture)).toBe(true);
    });

    test('a failure that keeps the last good list is retried too, and the retry replaces the list', async () => {
        let clock = 1000;
        const run = jest.fn()
            .mockResolvedValueOnce(output('A.cs'))
            .mockRejectedValueOnce(new Error('timeout'))
            .mockResolvedValueOnce(output('B.cs'));
        const service = new ProjectItemsService(run, 2, () => clock);
        await service.evaluate(fixture);
        service.invalidate(fixture);
        expect((await service.evaluate(fixture))?.isIncluded(path.join(dir, 'A.cs'))).toBe(true);
        expect(service.retryDelay(fixture)).toBe(RETRY_DELAYS_MS[0]);
        clock += RETRY_DELAYS_MS[0];
        expect((await service.evaluate(fixture))?.isIncluded(path.join(dir, 'B.cs'))).toBe(true);
        expect(run).toHaveBeenCalledTimes(3);
    });
```
and add after the test `'real MSBuild: Remove, DefaultItemExcludes and Link are followed'` (before `describe('packages from the same evaluation'`):
```ts
    (hasDotnet ? test : test.skip)('real MSBuild: a half-saved project file fails, and the retry after the delay reads the saved one', async () => {
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'items-retry-'));
        try {
            const project = path.join(scratch, 'App.csproj');
            const saved = '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n  </PropertyGroup>\n</Project>\n';
            fs.writeFileSync(path.join(scratch, 'A.cs'), 'class A { }\n');
            fs.writeFileSync(project, saved.slice(0, 60));
            let clock = 1000;
            const service = new ProjectItemsService(undefined, 2, () => clock);
            expect(await service.evaluate(project)).toBeUndefined();
            fs.writeFileSync(project, saved);
            expect(await service.evaluate(project)).toBeUndefined();
            clock += RETRY_DELAYS_MS[0];
            expect((await service.evaluate(project))?.isIncluded(path.join(scratch, 'A.cs'))).toBe(true);
        } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
        }
    }, 150000);
```

In `src/test/unit/core/Project.items.test.ts` add before the closing `});` of the `describe` (the last line of the file):
```ts
    test('a failed evaluation is tried again by itself after its delay, and a redraw follows when that gives a list', async () => {
        const evaluate = ProjectItemsService.instance.evaluate as jest.Mock;
        jest.spyOn(ProjectItemsService.instance, 'retryDelay').mockReturnValueOnce(20).mockReturnValue(undefined);
        const project = await newProject();
        await project.getRootChildren();
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(evaluate).toHaveBeenCalledTimes(1);
        let version = 0;
        jest.spyOn(ProjectItemsService.instance, 'version').mockImplementation(() => version);
        evaluate.mockImplementation(async () => { version = 1; return undefined; });
        fired(project).mockClear();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(evaluate).toHaveBeenCalledTimes(2);
        expect(fired(project)).toHaveBeenCalled();
        // no failure any more: no further retry
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(evaluate).toHaveBeenCalledTimes(2);
    });

    test('expanding a folder after a failed evaluation whose delay has passed evaluates again', async () => {
        const project = await newProject();
        const evaluate = ProjectItemsService.instance.evaluate as jest.Mock;
        evaluate.mockClear();
        await project.loadFolderChildren(dir);
        expect(evaluate).not.toHaveBeenCalled();
        jest.spyOn(ProjectItemsService.instance, 'retryDue').mockReturnValue(true);
        await project.loadFolderChildren(dir);
        expect(evaluate).toHaveBeenCalledTimes(1);
    });

    test('dispose cancels a pending retry', async () => {
        jest.spyOn(ProjectItemsService.instance, 'retryDelay').mockReturnValueOnce(20).mockReturnValue(undefined);
        const project = await newProject();
        await new Promise(resolve => setTimeout(resolve, 0));
        const evaluate = ProjectItemsService.instance.evaluate as jest.Mock;
        evaluate.mockClear();
        project.dispose();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(evaluate).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/test/unit/services/projectItems/projectItemsService.test.ts src/test/unit/core/Project.items.test.ts`
Expected: FAIL: `TS2305: Module '"../../../../services/projectItems/projectItemsService"' has no exported member 'RETRY_DELAYS_MS'` and `TS2339: Property 'retryDue' does not exist on type 'ProjectItemsService'` (and the same for `retryDelay` in `Project.items.test.ts`).

- [ ] **Step 3: The service remembers failures**

In `src/services/projectItems/projectItemsService.ts`:

After `runMsbuild` (before `/** What one MSBuild run gave`) add:
```ts
/**
 * After a failed evaluation (a timeout, a half-saved project file) the next attempts wait this long: the project
 * retries by itself after each delay, and after the last one only when the next evaluation is asked for (a folder
 * of it is expanded, the project or a props file changes).
 */
export const RETRY_DELAYS_MS: readonly number[] = [5_000, 30_000, 120_000];
```

Replace
```ts
    // null: MSBuild failed and there was no earlier result; not retried before `invalidate`
```
with
```ts
    // null: MSBuild failed and there was no earlier result
```

After `private readonly packageVersions = new Map<string, number>();` add:
```ts
    // Projects whose last evaluation failed: how often in a row, and from when on `evaluate` runs MSBuild again
    private readonly failures = new Map<string, { readonly count: number; readonly retryAt: number }>();
```

Replace the start of `evaluate`:
```ts
    /** The cached result, or the result of the evaluation running (or started now) for the project */
    evaluate(projectPath: string): Promise<ProjectItems | undefined> {
        if (this.cache.has(projectPath) && !this.stale.has(projectPath)) {
```
with
```ts
    /** Whether the last evaluation failed and its retry delay has passed: the next `evaluate` runs MSBuild again */
    retryDue(projectPath: string): boolean {
        const failure = this.failures.get(projectPath);
        return !!failure && this.now() >= failure.retryAt;
    }

    /**
     * How long until the project should retry its failed evaluation by itself (ms, at least 0); undefined when the
     * last evaluation did not fail, or after the last of `RETRY_DELAYS_MS`
     */
    retryDelay(projectPath: string): number | undefined {
        const failure = this.failures.get(projectPath);
        if (!failure || failure.count > RETRY_DELAYS_MS.length) {
            return undefined;
        }
        return Math.max(0, failure.retryAt - this.now());
    }

    /** The cached result, or the result of the evaluation running (or started now) for the project */
    evaluate(projectPath: string): Promise<ProjectItems | undefined> {
        if (this.cache.has(projectPath) && !this.stale.has(projectPath) && !this.retryDue(projectPath)) {
```

In `publish`, replace
```ts
    private publish(projectPath: string, { items, packages, startedAt }: Evaluation): ProjectItems | undefined {
        this.stale.delete(projectPath);
```
with
```ts
    private publish(projectPath: string, { items, packages, startedAt }: Evaluation): ProjectItems | undefined {
        this.stale.delete(projectPath);
        if (items) {
            this.failures.delete(projectPath);
        } else {
            const count = (this.failures.get(projectPath)?.count ?? 0) + 1;
            const delay = RETRY_DELAYS_MS[Math.min(count, RETRY_DELAYS_MS.length) - 1];
            this.failures.set(projectPath, { count, retryAt: this.now() + delay });
        }
```
(`publish` only runs for the evaluation whose result counts: an outdated run that is re-run after a change records nothing.)

- [ ] **Step 4: The project retries**

In `src/core/Project.ts`:

After the field `private _reevaluateTimer?: ...` add:
```ts
    private _retryTimer?: ReturnType<typeof setTimeout>; // A failed evaluation: try again after its delay
```

In `loadFolderChildren` replace
```ts
            const items = ProjectItemsService.instance.get(this._projectPath);
            const laidOut = layoutFolder(folderPath, disk, items, showAll, nonEmptyFolders);
```
with
```ts
            // The last evaluation failed (the tree shows the plain disk listing): expanding tries again once its delay has passed
            if (ProjectItemsService.instance.retryDue(this._projectPath) && !this._isUnloaded()) {
                void this.evaluateItems();
            }
            const items = ProjectItemsService.instance.get(this._projectPath);
            const laidOut = layoutFolder(folderPath, disk, items, showAll, nonEmptyFolders);
```

In `evaluateItems` replace
```ts
        await service.evaluate(this._projectPath);
        // New package versions (Directory.Packages.props changed): Dependencies > Packages shows them
```
with
```ts
        await service.evaluate(this._projectPath);
        this.scheduleRetry();
        // New package versions (Directory.Packages.props changed): Dependencies > Packages shows them
```

Before `/** New files may match a glob: evaluate again when no file was created for a moment */` add:
```ts
    /** A failed evaluation (timeout, half-saved project file) is tried again after a delay that grows with each failure */
    private scheduleRetry(): void {
        const delay = ProjectItemsService.instance.retryDelay(this._projectPath);
        if (delay === undefined || !this._isInitialized) {
            return;
        }
        if (this._retryTimer) {
            clearTimeout(this._retryTimer);
        }
        this._retryTimer = setTimeout(() => {
            this._retryTimer = undefined;
            void this.evaluateItems();
        }, delay);
    }

```

In `dispose`, after the block that clears `this._reevaluateTimer`, add:
```ts
        if (this._retryTimer) {
            clearTimeout(this._retryTimer);
            this._retryTimer = undefined;
        }
```
(`!this._isInitialized` in `scheduleRetry` keeps a disposed project from starting a timer when its last evaluation lands after `dispose`.)

- [ ] **Step 5: Run to verify they pass**

Run: `npx jest src/test/unit/services/projectItems/projectItemsService.test.ts src/test/unit/core/Project.items.test.ts`
Expected: PASS (the real-MSBuild test is skipped without `dotnet`).

- [ ] **Step 6: Docs**

`docs/solution-explorer.md`, section "Show All Files and linked files": after the paragraph that starts `The tree is drawn from the disk first and corrected as soon as MSBuild has evaluated the project`, add:
```markdown
When an evaluation fails (a timeout on a busy machine, a project file read while it was being saved), the tree keeps what it showed (the last result, or the disk listing) and tries again after 5 seconds, 30 seconds and 2 minutes, and after that whenever a folder of the project is expanded.
```

`docs/manual-testing.md`, append unticked:
```markdown
- [ ] A failed evaluation is retried: in a copy of `src/__fixtures__/project-items` run `dotnet new sln -n Items && dotnet sln Items.sln add ItemsApp/ItemsApp.csproj`, then put a `global.json` next to `Items.sln` with `{"sdk":{"version":"9.9.999","rollForward":"disable"}}` (an SDK that is not installed, so every evaluation fails); open the folder and expand ItemsApp: `Legacy/Old.cs` shows (the disk listing) and the Output channel logs `Could not evaluate the items`; delete `global.json` within 30 seconds of opening (no watcher sees it): at the next retry, at most 2 minutes later, `Old.cs` disappears by itself. Again with `global.json` and the window reloaded, but leave ItemsApp collapsed: after more than 3 minutes delete `global.json` and expand ItemsApp: `Old.cs` disappears a moment after the tree shows
```

No GIF: nothing new to see, the tree only recovers by itself.

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git add src/services/projectItems/projectItemsService.ts src/core/Project.ts src/test/unit/services/projectItems/projectItemsService.test.ts src/test/unit/core/Project.items.test.ts docs/solution-explorer.md docs/manual-testing.md
git commit -m "Project items: retry a failed MSBuild evaluation after 5 s, 30 s and 2 min, and when a folder is expanded

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: exit 0.

---

### Task 2: After a new item list the expanded folders are read again parents first

**Files:**
- Modify: `src/core/Project.ts`
- Test: `src/test/unit/core/Project.items.test.ts`

Repro (done while planning): the real `Project` (jest, `vscode` mocked as in `Project.items.test.ts`) with `Sub/Inner/A.cs`, expanded in the order restoring the expansion can ask for it (`getFolderChildren(Sub/Inner)` before `Sub` is loaded, then the root, `Sub`, `Sub/Inner`): `_collapsedState` holds `Sub/Inner, (root), Sub`. After an evaluation with a new list, `reloadLoadedFolders` read `(root)` and `Sub` only: reading the root had replaced the `Sub` node, so `Sub/Inner` was not found and skipped, and reading `Sub` afterwards left `Sub/Inner` unloaded (`isLoaded: false`, no children). The visible tree still ends right, because the redraw asks for `Sub/Inner` again and `expandFolder` reads it then; the cost is a folder read during the redraw instead of in the reload (and, with a child read before its parent, a read thrown away). Small, but the fix is one sort.

- [ ] **Step 1: Write the failing test**

In `src/test/unit/core/Project.items.test.ts` add before the closing `});` of the `describe` (the last line of the file):
```ts
    test('after a new item list the expanded folders are read again parents first, also when a subfolder was expanded first', async () => {
        const sub = path.join(dir, 'Sub');
        const inner = path.join(sub, 'Inner');
        fs.mkdirSync(inner, { recursive: true });
        fs.writeFileSync(path.join(inner, 'A.cs'), '');
        const project = await newProject();
        // Restoring the expansion asks for the subfolder before its parent is loaded (it is not found yet)
        await project.getFolderChildren(inner);
        await project.getRootChildren();
        await project.getFolderChildren(sub);
        await project.getFolderChildren(inner);
        expect([...project.getCollapsedState().keys()].map(key => path.relative(dir, key))).toEqual([path.join('Sub', 'Inner'), '', 'Sub']);
        let version = 0;
        jest.spyOn(ProjectItemsService.instance, 'version').mockImplementation(() => version);
        (ProjectItemsService.instance.evaluate as jest.Mock).mockImplementation(async () => { version = 1; return undefined; });
        const load = jest.spyOn(project, 'loadFolderChildren');
        await project.evaluateItems();
        expect(load.mock.calls.map(([folder]) => path.relative(dir, folder))).toEqual(['', 'Sub', path.join('Sub', 'Inner')]);
        // The subfolder's new listing is in the tree, not thrown away by reading its parent afterwards
        load.mockClear();
        expect((await project.getFolderChildren(inner)).map(child => child.name)).toEqual(['A.cs']);
        expect(load).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/test/unit/core/Project.items.test.ts -t "parents first"`
Expected: FAIL: the read folders are `['', 'Sub']` (`- Expected - 1`: `Sub/Inner` missing).

- [ ] **Step 3: Sort by depth**

In `src/core/Project.ts`, `reloadLoadedFolders`, replace
```ts
        const loaded = Array.from(this._collapsedState.entries()).filter(([, isCollapsed]) => !isCollapsed).map(([folderPath]) => folderPath);
        const projectDir = path.dirname(this._projectPath);
        const reloaded = new Set<ProjectFileNode>();
        for (const folderPath of [projectDir, ...loaded.filter(folderPath => folderPath !== projectDir)]) {
```
with
```ts
        const projectDir = path.dirname(this._projectPath);
        // Parents before children: reading a folder replaces the nodes of its subfolders, so a subfolder read first
        // would be thrown away again (the expanded folders are kept in the order they were first expanded)
        const depth = (folderPath: string) => path.relative(projectDir, folderPath).split(path.sep).length;
        const loaded = Array.from(this._collapsedState.entries())
            .filter(([folderPath, isCollapsed]) => !isCollapsed && folderPath !== projectDir)
            .map(([folderPath]) => folderPath)
            .sort((a, b) => depth(a) - depth(b));
        const reloaded = new Set<ProjectFileNode>();
        for (const folderPath of [projectDir, ...loaded]) {
```
(`Array.prototype.sort` is stable, so folders of the same depth keep their order.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/test/unit/core/Project.items.test.ts`
Expected: PASS

- [ ] **Step 5: Verify and commit**

No docs: nothing a user sees changes (the tree showed the same before, one read later). No manual check needed.

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git add src/core/Project.ts src/test/unit/core/Project.items.test.ts
git commit -m "Project items: read the expanded folders again parents first after a new item list

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: exit 0.

---

### Task 3: Block-form items in the project file editor (Include In Project, Exclude From Project)

**Files:**
- Modify: `src/parsers/projectFileEditor.ts`
- Test: `src/test/unit/parsers/projectFileEditor.items.test.ts`, `src/test/unit/services/projectItems/projectItemEdits.msbuild.test.ts`
- Docs: `docs/solution-explorer.md`, `docs/manual-testing.md`

**Repro (done while planning):** A project with `<Compile Remove="Old.cs"></Compile>` and `<None Remove="notes.txt">` / `</None>` (closing tag on the next line): real MSBuild leaves both files out (`-getItem:Compile` lists only `Program.cs`). The real `includeEdit` on `Old.cs` left the block-form `Remove` in place and appended `<Compile Include="Old.cs" />` after it; MSBuild then listed `Old.cs`, so the file is included but the project file holds both items. The real `excludeEdit` on `notes.txt` did not see the existing block-form `Remove` and added `<None Remove="notes.txt" />` below it. Cause: `ProjectFileEditor.findItemElements` only matches self-closing elements (`ITEM_ELEMENT_RE` ends in `\/>`). A `Remove` with metadata children is an MSBuild error (MSB4162), see Deviations.

- [ ] **Step 1: Write the failing tests**

In `src/test/unit/parsers/projectFileEditor.items.test.ts`, after the `describe('removeRemoveItem', ...)` block (its last test is `reports nothing removed when there is no such item`), before the final `});` of the file, add:
```ts
    describe('block-form items', () => {
        const withItems = (items: string) => sdkProject.replace('</Project>', `  <ItemGroup>\n${items}  </ItemGroup>\n\n</Project>`);

        test('removeRemoveItem deletes an empty block-form Remove, and the ItemGroup it leaves empty', () => {
            expect(ProjectFileEditor.removeRemoveItem(withItems('    <Compile Remove="Old.cs"></Compile>\n'), 'Old.cs'))
                .toEqual({ content: sdkProject, removed: true });
        });

        test('removeRemoveItem deletes a Remove whose closing tag is on its own line', () => {
            expect(ProjectFileEditor.removeRemoveItem(withItems('    <None Remove="notes.txt">\n    </None>\n'), 'notes.txt'))
                .toEqual({ content: sdkProject, removed: true });
        });

        test('removeRemoveItem keeps the other entries of a block-form Remove', () => {
            expect(ProjectFileEditor.removeRemoveItem(withItems('    <Compile Remove="A.cs;Old.cs"></Compile>\n'), 'Old.cs').content)
                .toBe(withItems('    <Compile Remove="A.cs"></Compile>\n'));
        });

        test('an item with metadata children does not hide the items after it', () => {
            const content = withItems('    <None Include="readme.txt">\n      <Pack>true</Pack>\n    </None>\n    <Compile Remove="Old.cs" />\n');
            expect(ProjectFileEditor.removeRemoveItem(content, 'Old.cs').content)
                .toBe(withItems('    <None Include="readme.txt">\n      <Pack>true</Pack>\n    </None>\n'));
        });

        test('excludeItem sees an existing block-form Remove', () => {
            const content = withItems('    <Compile Remove="Old.cs"></Compile>\n');
            expect(ProjectFileEditor.excludeItem(content, 'Compile', 'Old.cs')).toBe(content);
        });

        test('includeItem sees an existing Include with metadata children', () => {
            const content = withItems('    <None Include="Gen\\Made.txt">\n      <CopyToOutputDirectory>Always</CopyToOutputDirectory>\n    </None>\n');
            expect(ProjectFileEditor.includeItem(content, 'None', 'Gen\\Made.txt')).toBe(content);
        });

        test('block-form items in comments and targets are still skipped', () => {
            const content = withItems('    <!-- <Compile Remove="Old.cs"></Compile> -->\n')
                .replace('</Project>', '<Target Name="T">\n    <ItemGroup>\n      <Compile Remove="Old.cs"></Compile>\n    </ItemGroup>\n  </Target>\n</Project>');
            expect(ProjectFileEditor.removeRemoveItem(content, 'Old.cs')).toEqual({ content, removed: false });
        });
    });
```

In `src/test/unit/services/projectItems/projectItemEdits.msbuild.test.ts`, after the last test (`names with MSBuild special characters left out by DefaultItemExcludes get a literal Include`), before the final `});`, add:
```ts
    withDotnet('Include deletes a block-form Remove instead of adding an Include after it, and Exclude adds it back once', async () => {
        setUp(sdkProject('\n  <ItemGroup>\n    <Compile Remove="Old.cs"></Compile>\n  </ItemGroup>\n'), ['Program.cs', 'Old.cs']);
        expect((await evaluate()).isIncluded(at('Old.cs'))).toBe(false);
        expect((await include(at('Old.cs'))).isIncluded(at('Old.cs'))).toBe(true);
        expect(fs.readFileSync(projectPath, 'utf8')).toBe(sdkProject());
        expect((await exclude(at('Old.cs'))).isIncluded(at('Old.cs'))).toBe(false);
        expect(fs.readFileSync(projectPath, 'utf8').match(/Remove="Old\.cs"/g)).toHaveLength(1);
    }, TIMEOUT);
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/test/unit/parsers/projectFileEditor.items.test.ts src/test/unit/services/projectItems/projectItemEdits.msbuild.test.ts -t "block-form"`
Expected: FAIL, 6 failed: the five `block-form items` tests on deletion/exclude/include and the real-MSBuild one (`Expected - 0 / Received + 5`: the `Remove` and the added `Include` are still in the file). `an item with metadata children does not hide the items after it` and `block-form items in comments and targets are still skipped` already pass (they guard the new matching).

- [ ] **Step 3: Match opening tags in `findItemElements`**

In `src/parsers/projectFileEditor.ts` replace
```ts
    // Self-closing item element: `<Compile Remove="x" />`; attribute values may contain '>'
    private static readonly ITEM_ELEMENT_RE = /<([A-Za-z]+)\b((?:[^>"']|"[^"]*"|'[^']*')*?)\/>/g;
```
with
```ts
    // Opening tag of an item: `<Compile Remove="x" />` (group 3 is the slash) or `<Compile Remove="x">`; attribute values may contain '>'
    private static readonly ITEM_OPEN_TAG_RE = /<([A-Za-z][\w-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
```
and replace the whole method `findItemElements` (from its comment `/** Self-closing items carrying \`attribute\`, in document order */` to its closing brace) with:
```ts
    /**
     * Items carrying `attribute`, in document order: self-closing (`<Compile Remove="x" />`) or in block form
     * (`<Compile Remove="x"></Compile>`, an Include with metadata children); `end` is after the closing tag.
     * Only opening tags are matched, so an ItemGroup (or an item with children) does not hide the items in it.
     */
    private static findItemElements(content: string, attribute: 'Include' | 'Remove'): { itemType: string; value: string; start: number; end: number }[] {
        const attributeRe = new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
        const ignored = this.ignoredRanges(content);
        const items: { itemType: string; value: string; start: number; end: number }[] = [];
        for (const match of content.matchAll(this.ITEM_OPEN_TAG_RE)) {
            const found = attributeRe.exec(match[2]);
            if (!found || this.inRanges(ignored, match.index!)) {
                continue;
            }
            let end = match.index! + match[0].length;
            if (match[3] !== '/') {
                const closing = new RegExp(`</${match[1]}\\s*>`, 'g');
                closing.lastIndex = end;
                const close = closing.exec(content);
                if (!close) {
                    continue;
                }
                end = close.index + close[0].length;
            }
            items.push({ itemType: match[1], value: this.unescape(found[1] ?? found[2]), start: match.index!, end });
        }
        return items;
    }
```
Nothing else changes: `removeRemoveItem` rewrites the `Remove` attribute inside `start..end` (the opening tag comes first) or deletes `start..end` with `deleteElement`, which already handles elements over several lines; `addItemElement` looks for later items after `end`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/test/unit/parsers src/test/unit/services/projectItems`
Expected: PASS (the real-MSBuild tests included where `dotnet` is installed).

- [ ] **Step 5: Docs**

`docs/solution-explorer.md`, section "Exclude From Project and Include In Project", the **Include In Project** bullet ends with `When that would add more than 200 items it asks first.`; append to that bullet:
```markdown
 A `Remove` item written as a block (`<Compile Remove="Old.cs"></Compile>`) counts like the one-line form: Include In Project deletes it, and Exclude From Project does not add a second one.
```
(one line: the bullet becomes `... When that would add more than 200 items it asks first. A \`Remove\` item written as a block ...`).

`docs/manual-testing.md`, append unticked:
```markdown
- [ ] Include In Project with a block-form `Remove`: in a project with `<Compile Remove="Old.cs"></Compile>` (Show All Files on), Include In Project on the greyed-out `Old.cs` deletes that element (an `ItemGroup` left empty goes too) and adds no `Include`; Exclude From Project on it again writes one self-closing `<Compile Remove="Old.cs" />`
```
No GIF: nothing looks different in the tree; the change is in the text of the project file, which the docs sentence shows.

- [ ] **Step 6: Verify and commit**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git add src/parsers/projectFileEditor.ts src/test/unit/parsers/projectFileEditor.items.test.ts src/test/unit/services/projectItems/projectItemEdits.msbuild.test.ts docs/solution-explorer.md docs/manual-testing.md
git commit -m "Project file edits: find block-form items, so Include deletes a <Compile Remove></Compile> and Exclude sees it

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: exit 0.

---

### Task 4: Exclude/Include in a nested project's folder edits the project whose tree was clicked

**Files:**
- Modify: `src/services/nodeIdService.ts`, `src/services/projectItems/projectItemEdits.ts`, `src/core/Project.ts`, `src/services/solutionActionService.ts`, `src/services/solutionExpansionService.ts`
- Create: `src/test/unit/services/projectItems/itemMembership.nested.test.ts`
- Test: `src/test/unit/services/nodeIdService.test.ts`, `src/test/unit/services/projectItems/projectItemEdits.test.ts`, `src/test/unit/core/Project.items.test.ts`
- Docs: `docs/solution-explorer.md`, `docs/manual-testing.md`

**Repro (done while planning):** Solution `Nest.slnx` with `Outer/Outer.csproj` and `Outer/Inner/Inner.csproj`, files `Outer/OuterClass.cs`, `Outer/Inner/Foo.cs`, `Outer/Inner/Sub/Bar.cs`. Real MSBuild on `Outer.csproj` lists `Inner/Foo.cs`, `Inner/Sub/Bar.cs` and `OuterClass.cs` as `Compile` (the SDK globs do not stop at a nested project). Driving the real `Solution` and `SolutionActionService` from a Jest scratch test (real `ProjectItemsService`): the outer tree's `Inner` folder lists `Sub [included]` and `Foo.cs [included]`, with ids `{"type":"folder","path":".../Outer/Inner/Sub"}` and `{"type":"file","path":".../Outer/Inner/Foo.cs"}` (the same ids the Inner project's own tree uses). Exclude From Project on that `Foo.cs` left `Outer.csproj` unchanged and wrote `<Compile Remove="Foo.cs" />` into `Inner.csproj` (`projectForPath` picks the deepest project); no warning appeared, because the check afterwards evaluated `Inner.csproj` too.

Visual Studio edits the project whose tree was clicked, so the node id has to say which one that is: file and folder ids get an optional `project`, set by `Project.toProjectChild` only for nodes in a nested project's folder (all other ids stay as they are).

- [ ] **Step 1: Write the failing tests**

`src/test/unit/services/nodeIdService.test.ts`, append at the end of the file:
```ts

describe('NodeIdService: the project whose tree shows a file or folder', () => {
    test('file and folder ids carry the project only when it is given', () => {
        const file = NodeIdService.parse(NodeIdService.generateFileId('/s/Outer/Inner/Foo.cs', '/s/Outer/Outer.csproj'));
        expect(file).toEqual({ type: 'file', path: '/s/Outer/Inner/Foo.cs', project: '/s/Outer/Outer.csproj' });
        const folder = NodeIdService.parse(NodeIdService.generateFolderId('/s/Outer/Inner/Sub', '/s/Outer/Outer.csproj'));
        expect(folder).toEqual({ type: 'folder', path: '/s/Outer/Inner/Sub', project: '/s/Outer/Outer.csproj' });
    });

    test('without a project the ids stay as before (persisted expansion state still matches)', () => {
        const before = Buffer.from(JSON.stringify({ type: 'folder', path: '/s/App/Sub' }), 'utf8').toString('base64url');
        expect(NodeIdService.generateFolderId('/s/App/Sub')).toBe(before);
        expect(NodeIdService.generateFolderId('/s/App/Sub', undefined)).toBe(before);
        expect(NodeIdService.parse(NodeIdService.generateFileId('/s/App/A.cs'))).toEqual({ type: 'file', path: '/s/App/A.cs' });
    });
});
```
(The paths are only strings encoded and decoded, never touched on disk, so `/` literals are fine on Windows.)

`src/test/unit/services/projectItems/projectItemEdits.test.ts`: the import becomes
```ts
import { excludeEdit, inNestedProject, includeEdit, includeItemCount, listFilesUnder, membershipApplied, membershipRefusal } from '../../../../services/projectItems/projectItemEdits';
```
and before `describe('membershipApplied', () => {` add:
```ts
describe('inNestedProject', () => {
    const outer = path.join(dir, 'App.csproj');
    const inner = at('Deep', 'Inner', 'Inner.csproj');
    const solutionProjects = [outer, at('Tools', 'Tools.csproj'), inner];

    test('a file or folder in the folder of a project below the outer one', () => {
        expect(inNestedProject(at('Tools', 'T.cs'), outer, solutionProjects)).toBe(true);
        expect(inNestedProject(at('Deep', 'Inner', 'Sub'), outer, solutionProjects)).toBe(true);
        expect(inNestedProject(at('Deep', 'Inner'), outer, solutionProjects)).toBe(true);
    });

    test('not in the project\'s own folders, nor in the nested project\'s own tree', () => {
        expect(inNestedProject(at('Sub', 'A.cs'), outer, solutionProjects)).toBe(false);
        expect(inNestedProject(at('Deep', 'D.cs'), outer, solutionProjects)).toBe(false);
        expect(inNestedProject(at('Toolbox', 'T.cs'), outer, solutionProjects)).toBe(false);
        expect(inNestedProject(at('Deep', 'Inner', 'Sub', 'X.cs'), inner, solutionProjects)).toBe(false);
    });
});

```

`src/test/unit/core/Project.items.test.ts`: after `import { Project } from '../../../core/Project';` add
```ts
import { NodeIdService } from '../../../services/nodeIdService';
```
and before the test `does not offer Exclude on a folder without files of the project (empty, or only linked files)` add:
```ts
    test('files and folders in the folder of a nested project say in their id that they are shown in this project\'s tree', async () => {
        const tools = path.join(dir, 'Tools');
        fs.mkdirSync(path.join(tools, 'Sub'), { recursive: true });
        fs.writeFileSync(path.join(tools, 'T.cs'), '');
        fs.writeFileSync(path.join(tools, 'Sub', 'S.cs'), '');
        jest.spyOn(ProjectItemsService.instance, 'get').mockReturnValue(parseMsbuildItems(JSON.stringify({
            Items: { Compile: [
                { Identity: 'Program.cs', FullPath: path.join(dir, 'Program.cs') },
                { Identity: 'Tools/T.cs', FullPath: path.join(tools, 'T.cs') },
                { Identity: 'Tools/Sub/S.cs', FullPath: path.join(tools, 'Sub', 'S.cs') },
            ] },
        }), dir));
        const project = new Project(projectPath, { name: 'App', path: 'App.csproj', guid: 'g', typeGuid: 't' } as never, () => false,
            () => [projectPath, path.join(tools, 'Tools.csproj')]);
        while (!project.isInitialized) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        const owner = (child: { nodeId: string } | undefined) => (NodeIdService.parse(child!.nodeId as never) as { project?: string }).project;
        const root = await project.getFolderChildren(dir);
        expect(owner(root.find(child => child.name === 'Program.cs'))).toBeUndefined();
        expect(owner(root.find(child => child.name === 'Tools'))).toBe(projectPath);
        const inTools = await project.getFolderChildren(tools);
        expect(owner(inTools.find(child => child.name === 'T.cs'))).toBe(projectPath);
        expect(owner(inTools.find(child => child.name === 'Sub'))).toBe(projectPath);
        expect(inTools.find(child => child.name === 'T.cs')?.contextValue).toBe('included');
    });

```

`src/test/unit/services/projectItems/itemMembership.nested.test.ts` (create):
```ts
// Exclude From Project / Include In Project from the outer project's tree, on a file in the folder of a nested project
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ui = { warnings: [] as string[], errors: [] as string[] };

jest.mock('vscode', () => {
    const disposable = { dispose: () => { } };
    const watcher = { onDidChange: () => disposable, onDidCreate: () => disposable, onDidDelete: () => disposable, dispose: () => { } };
    class EventEmitter { event = () => disposable; fire() { } dispose() { } }
    return {
        EventEmitter,
        RelativePattern: class { constructor(public base: string, public pattern: string) { } },
        Uri: { file: (p: string) => ({ fsPath: p }) },
        workspace: { createFileSystemWatcher: () => watcher, workspaceFolders: undefined, getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
        window: {
            showWarningMessage: async (message: string) => { ui.warnings.push(message); return undefined; },
            showErrorMessage: async (message: string) => { ui.errors.push(message); return undefined; },
            showInformationMessage: async () => undefined,
        },
        commands: { executeCommand: async () => undefined },
    };
}, { virtual: true });

import { Solution } from '../../../../core/Solution';
import { SolutionService } from '../../../../services/solutionService';
import { SolutionActionService } from '../../../../services/solutionActionService';
import { ProjectItemsService } from '../../../../services/projectItems/projectItemsService';

const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip;
const sdkProject = '<Project Sdk="Microsoft.NET.Sdk">\n\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n  </PropertyGroup>\n\n</Project>\n';

describe('Exclude/Include on a file of a nested project\'s folder, from the outer project\'s tree (real MSBuild)', () => {
    let dir: string;
    let solution: Solution;
    const at = (...parts: string[]) => path.join(dir, ...parts);

    beforeEach(async () => {
        ui.warnings = [];
        ui.errors = [];
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nested-items-')));
        fs.mkdirSync(at('Outer', 'Inner', 'Sub'), { recursive: true });
        fs.writeFileSync(at('Outer', 'Outer.csproj'), sdkProject);
        fs.writeFileSync(at('Outer', 'Inner', 'Inner.csproj'), sdkProject);
        fs.writeFileSync(at('Outer', 'OuterClass.cs'), 'class OuterClass { }\n');
        fs.writeFileSync(at('Outer', 'Inner', 'Foo.cs'), 'class Foo { }\n');
        fs.writeFileSync(at('Outer', 'Inner', 'Sub', 'Bar.cs'), 'class Bar { }\n');
        fs.writeFileSync(at('Nest.slnx'), '<Solution>\n  <Project Path="Outer/Outer.csproj" />\n  <Project Path="Outer/Inner/Inner.csproj" />\n</Solution>\n');
        solution = new Solution(at('Nest.slnx'));
        for (let i = 0; i < 300 && !solution.isInitialized; i++) await new Promise(r => setTimeout(r, 10));
        (SolutionService as any).activeSolution = solution;
    });

    afterEach(() => {
        (SolutionService as any).activeSolution = undefined;
        solution.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    withDotnet('edits the outer project file, not the nested one', async () => {
        const outer = solution.projects.get(at('Outer', 'Outer.csproj'))!;
        await outer.reevaluateItems();
        await outer.getFolderChildren(at('Outer'));
        const inInner = await outer.getFolderChildren(at('Outer', 'Inner'));
        const foo = inInner.find(child => child.name === 'Foo.cs')!;
        const sub = inInner.find(child => child.name === 'Sub')!;
        expect(foo.contextValue).toBe('included');

        await SolutionActionService.handleProjectAction({ action: 'excludeFromProject', nodeId: foo.nodeId } as never);
        await SolutionActionService.handleProjectAction({ action: 'excludeFromProject', nodeId: sub.nodeId } as never);

        expect(fs.readFileSync(at('Outer', 'Inner', 'Inner.csproj'), 'utf8')).toBe(sdkProject);
        expect(fs.readFileSync(at('Outer', 'Outer.csproj'), 'utf8')).toContain('<Compile Remove="Inner\\Foo.cs" />');
        expect(fs.readFileSync(at('Outer', 'Outer.csproj'), 'utf8')).toContain('<Compile Remove="Inner\\Sub\\**" />');
        const items = await ProjectItemsService.instance.evaluate(at('Outer', 'Outer.csproj'));
        expect(items!.isIncluded(at('Outer', 'Inner', 'Foo.cs'))).toBe(false);
        expect(items!.isIncluded(at('Outer', 'Inner', 'Sub', 'Bar.cs'))).toBe(false);
        expect(ui.warnings).toEqual([]);

        await SolutionActionService.handleProjectAction({ action: 'includeInProject', nodeId: foo.nodeId } as never);
        expect(fs.readFileSync(at('Outer', 'Outer.csproj'), 'utf8')).not.toContain('Foo.cs');
        expect(fs.readFileSync(at('Outer', 'Inner', 'Inner.csproj'), 'utf8')).toBe(sdkProject);
        expect(ui.errors).toEqual([]);
    }, 150000);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/test/unit/services/nodeIdService.test.ts src/test/unit/services/projectItems/projectItemEdits.test.ts src/test/unit/core/Project.items.test.ts src/test/unit/services/projectItems/itemMembership.nested.test.ts`
Expected: FAIL: `nodeIdService.test.ts` and `projectItemEdits.test.ts` do not compile (`Expected 1 arguments, but got 2`; `Module ... has no exported member 'inNestedProject'`), the new `Project.items` test fails (`project` is undefined), and `itemMembership.nested.test.ts` fails on `Inner.csproj` (`Expected - 0 / Received + 5`: the `Remove` went into the nested project file; skipped without `dotnet`).

- [ ] **Step 3: The optional project on file and folder ids**

In `src/services/nodeIdService.ts` replace
```ts
export declare type FolderNodeId = {
    readonly type: 'folder';
    readonly path: string;
}

export declare type FileNodeId = {
    readonly type: 'file';
    readonly path: string;
}
```
with
```ts
export declare type FolderNodeId = {
    readonly type: 'folder';
    readonly path: string;
    /**
     * The project whose tree shows the folder, when the path alone would name another one: a folder in the folder
     * of a nested project, shown in the outer project's tree. Absent otherwise (the deepest project around the path).
     */
    readonly project?: string;
}

export declare type FileNodeId = {
    readonly type: 'file';
    readonly path: string;
    /** The project whose tree shows the file, when the path alone would name another one (see FolderNodeId) */
    readonly project?: string;
}
```
and the two generators become:
```ts
    static generateFolderId(folderPath: string, project?: string): NodeIdString {
        return this.encode({
            type: 'folder',
            path: folderPath,
            ...(project ? { project } : {}),
        });
    }
```
```ts
    static generateFileId(filePath: string, project?: string): NodeIdString {
        return this.encode({
            type: 'file',
            path: filePath,
            ...(project ? { project } : {}),
        });
    }
```
(keep the doc comments above them as they are).

- [ ] **Step 4: `inNestedProject`**

In `src/services/projectItems/projectItemEdits.ts`, before `/** Whether the project, as evaluated after the edit, has the file or folder out (exclude) or in (include) */` add:
```ts
/**
 * Whether the file or folder lies in the folder of another of the projects that is below the project's folder: a
 * nested project's file shown in the outer project's tree (the SDK globs include it). Its path alone names the
 * nested project, so its node id also names the project whose tree shows it.
 */
export function inNestedProject(target: string, projectPath: string, projects: readonly string[]): boolean {
    const projectDir = path.dirname(projectPath);
    return projects.some(other => {
        const otherDir = path.dirname(other);
        const toTarget = path.relative(otherDir, target);
        return other !== projectPath && isBelow(path.relative(projectDir, otherDir)) && (toTarget === '' || isBelow(toTarget));
    });
}

```

- [ ] **Step 5: The tree sets it, Exclude/Include and the expansion read it**

`src/core/Project.ts`: the import
```ts
import { holdsProject } from '../services/projectItems/projectItemEdits';
```
becomes
```ts
import { holdsProject, inNestedProject } from '../services/projectItems/projectItemEdits';
```
and in `toProjectChild` replace
```ts
        const folderValue = isFolder ? this.folderContextValue(node.path) : undefined;
        return {
            type: node.type,
            name: node.name,
            // Connected Services also lists the gRPC references
            hasChildren: node.hasChildren || (folderValue === 'connectedServices' && grpcReferenceNodes(this._projectPath).length > 0),
            nodeId: isFolder ? NodeIdService.generateFolderId(node.path) : NodeIdService.generateFileId(node.path),
```
with
```ts
        const folderValue = isFolder ? this.folderContextValue(node.path) : undefined;
        // In a nested project's folder the path alone names that project: the id says this tree shows the node
        const owner = inNestedProject(node.path, this._projectPath, this._solutionProjects()) ? this._projectPath : undefined;
        return {
            type: node.type,
            name: node.name,
            // Connected Services also lists the gRPC references
            hasChildren: node.hasChildren || (folderValue === 'connectedServices' && grpcReferenceNodes(this._projectPath).length > 0),
            nodeId: isFolder ? NodeIdService.generateFolderId(node.path, owner) : NodeIdService.generateFileId(node.path, owner),
```

`src/services/solutionActionService.ts`, in `_handleItemMembership` replace
```ts
        const projectPath = projectForPath(target);
        const project = projectPath ? solution?.projects.get(projectPath) : undefined;
        if (!projectPath || !project) {
            vscode.window.showWarningMessage('The item is not in a project.');
```
with
```ts
        // The project whose tree was clicked: in a nested project's folder the id names the outer one when it was there
        const shownIn = nodeId.type === 'file' || nodeId.type === 'folder' ? nodeId.project : undefined;
        const projectPath = shownIn ?? projectForPath(target);
        const project = projectPath ? solution?.projects.get(projectPath) : undefined;
        if (!projectPath || !project) {
            vscode.window.showWarningMessage('The item is not in a project.');
```
(`membershipRefusal` above stays: a folder that holds a project is still refused, from either tree.)

`src/services/solutionExpansionService.ts`, the expansion of a folder (in the `else if (node.type === 'folder')` branch) replace
```ts
                const project = solution.getProject(path);
                if (project) {
                    const folderChildren = await project.getFolderChildren(path);
                    children = SolutionTreeService.convertProjectChildrenToProjectNodes(folderChildren);

                    // Create lazy folder watcher for this expanded folder
```
with
```ts
                // A folder of a nested project's folder in the outer project's tree names the outer project
                const project = solution.getProject(node.project ?? path);
                if (project) {
                    const folderChildren = await project.getFolderChildren(path);
                    children = SolutionTreeService.convertProjectChildrenToProjectNodes(folderChildren);

                    // Create lazy folder watcher for this expanded folder
```
and the restore of a folder's expansion (the `} else if (nodeType === 'folder') {` branch further down) replace
```ts
            } else if (nodeType === 'folder') {
                const path = NodeIdService.parse(nodeId).path;

                if (!path) {
                    log.error(`Could not extract paths from folder expansion ID: ${nodeId}`);
                    return;
                }

                const project = solution.getProject(path);
```
with
```ts
            } else if (nodeType === 'folder') {
                const folder = NodeIdService.parse(nodeId);
                const path = folder.path;

                if (!path) {
                    log.error(`Could not extract paths from folder expansion ID: ${nodeId}`);
                    return;
                }

                const project = solution.getProject((folder.type === 'folder' ? folder.project : undefined) ?? path);
```
(`Solution.getProject` matches a project file path exactly first, so the id's project wins; ids without it behave as before.)

- [ ] **Step 6: Run to verify it passes**

Run: `npx jest src/test/unit/services/nodeIdService.test.ts src/test/unit/services/projectItems src/test/unit/core/Project.items.test.ts src/test/unit/webview/shared/opaqueNodeIds.test.ts`
Expected: PASS.

- [ ] **Step 7: Docs**

`docs/solution-explorer.md`, section "Exclude From Project and Include In Project": after the bullet that ends `For a nested project, use Remove or Delete on the project.` add the bullet:
```markdown
- The files and folders inside a nested project's folder also show in the outer project's tree when the outer project's wildcards include them (the SDK does not leave nested project folders out). Exclude From Project and Include In Project there edit the project whose tree you clicked, as in Visual Studio: in the outer project's tree the outer project file, under the nested project its own.
```

`docs/manual-testing.md`, append unticked:
```markdown
- [ ] Exclude/Include in a nested project's folder from the outer tree (`Outer/Outer.csproj` and `Outer/Inner/Inner.csproj` in one solution, `Outer/Inner/Foo.cs`): expand Outer > Inner, Exclude From Project on `Foo.cs` writes `<Compile Remove="Inner\Foo.cs" />` into `Outer.csproj` and leaves `Inner.csproj` as it was; Include In Project there takes it out again; Exclude on `Foo.cs` under the Inner project node edits `Inner.csproj`; expanding Outer > Inner > a subfolder and the same subfolder under Inner shows each project's view (no row expands or collapses the other)
```
No GIF: the tree looks the same; what changes is which project file gets the item, which the docs sentence says.

- [ ] **Step 8: Verify and commit**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git add src/services/nodeIdService.ts src/services/projectItems/projectItemEdits.ts src/core/Project.ts src/services/solutionActionService.ts src/services/solutionExpansionService.ts src/test/unit/services/nodeIdService.test.ts src/test/unit/services/projectItems/projectItemEdits.test.ts src/test/unit/core/Project.items.test.ts src/test/unit/services/projectItems/itemMembership.nested.test.ts docs/solution-explorer.md docs/manual-testing.md
git commit -m "Exclude/Include in a nested project's folder edit the project whose tree was clicked

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: exit 0. Windows: the new tests build every path with `path.join`/`path.resolve` (the `nodeIdService` ones only encode strings); `inNestedProject` uses `path.relative`, so drive letters and separators come out right.

---

### Task 5: Delete on a linked file warns, and Remove Link removes only the link

**Files:**
- Create: `src/services/projectItems/linkedItems.ts`
- Modify: `src/services/projectItems/projectItems.ts`, `src/core/contextMenus.ts`, `src/types/commands/project-action.ts`, `src/core/Project.ts`, `src/services/solutionActionService.ts`
- Generated: `package.json`, `docs/context-menus.md` (`npm run generate:menus`)
- Docs: `docs/solution-explorer.md`, `docs/manual-testing.md`
- Test: `src/test/unit/services/projectItems/linkedItems.test.ts` (create), `src/test/unit/services/linkedFiles.test.ts` (create), `src/test/unit/core/Project.items.test.ts` (one test)

**Repro (done while planning):** a scratch project `/tmp/ldrepro/App/App.csproj` with `<Compile Include="..\Shared\Shared.cs" Link="Linked\Shared.cs" />` and the file `/tmp/ldrepro/Shared/Shared.cs`. The real `ProjectItemsService` (real `dotnet msbuild`, SDK 10.0.111) lists it as `linkedFilesIn(App/Linked) = [{ fullPath: "/tmp/ldrepro/Shared/Shared.cs", virtualPath: "/tmp/ldrepro/App/Linked/Shared.cs", itemType: "Compile" }]`; the tree's node id of that row is the real file (`layoutFolder` gives linked entries `path: linked.fullPath`). Driving the real `SolutionActionService.handleProjectAction({ action: 'deleteFile', nodeId: generateFileId(fullPath) })` from a Jest scratch test (vscode mocked, `workspace.fs.delete` deleting for real) asked only `Delete the file 'Shared.cs'? It is moved to the trash.` (buttons: `Delete`); after answering Delete, `/tmp/ldrepro/Shared/Shared.cs` was gone and `App.csproj` still had the `<Compile Include="..\Shared\Shared.cs" ...>` item (the next build fails with CS2001, file not found). Multi-select Delete asks `Delete N items? They are moved to the trash.` and deletes the same way. Linked files have no `contextValue` today (`toProjectChild` only sets `included`/`excluded`), so their menu is the plain file menu.

**Decisions:**
- Delete on a linked file asks `Delete the linked file 'Shared.cs'?` with a detail that names the real path, says it is outside the project and that the projects linking it then miss it, and offers **Remove Link** next to **Delete** (the roadmap's "offer to remove only the link"). Remove Link there does what the command does.
- A new **Remove Link** command (`removeLink`) on linked files (`contextValue` `linked`, also in old-style projects: the edit is plain text). It deletes the items of the project file whose `Include` is exactly that file (every item type MSBuild lists it under; self-closing or with a `<Link>` child; comments and targets skipped; the ItemGroup goes when left empty; CRLF kept), then evaluates the project again. A link from a wildcard (`LinkBase`), a `;` list, properties, or another file (Directory.Build.props, an import) is not touched: a warning says where it comes from.
- Which projects link the file comes from the cached evaluations (`ProjectItems.isLinked`) of the solution's projects. The node id is only the file path, so with several linking projects Remove Link asks with a quick pick.
- No confirmation for Remove Link (it deletes nothing, like Exclude From Project).
- Multi-select Delete names the linked files among the selection in its one question; Remove Link has no multi-select variant.
- No GIF: one more menu entry and a clearer question; the docs text and the menu reference explain it.

- [ ] **Step 1: Write the failing tests**

`src/test/unit/services/projectItems/linkedItems.test.ts`:
```ts
import * as path from 'path';
import { linkedDeleteDetail, multiDeleteQuestion, removeLinkedItem } from '../../../../services/projectItems/linkedItems';
import { parseMsbuildItems } from '../../../../services/projectItems/projectItems';

const root = path.resolve('/repo');
const projectDir = path.join(root, 'App');
const shared = path.join(root, 'Shared', 'Shared.cs');

const project = (items: string) => `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <Compile Include="Local.cs" />
${items}
  </ItemGroup>

</Project>
`;

describe('removeLinkedItem', () => {
    test('deletes the self-closing item with a Link attribute', () => {
        const content = project('    <Compile Include="..\\Shared\\Shared.cs" Link="Linked\\Shared.cs" />');
        expect(removeLinkedItem(content, projectDir, shared, ['Compile'])).toEqual({ content: project('').replace('\n\n  </ItemGroup>', '\n  </ItemGroup>'), removed: true });
    });

    test('deletes the block form with a <Link> child element (old-style projects, Visual Studio\'s Add As Link)', () => {
        const block = '    <Compile Include="..\\Shared\\Shared.cs">\n      <Link>Shared.cs</Link>\n    </Compile>';
        const { content, removed } = removeLinkedItem(project(block), projectDir, shared, ['Compile']);
        expect(removed).toBe(true);
        expect(content).not.toContain('Shared');
        expect(content).toContain('<Compile Include="Local.cs" />');
    });

    test('takes the ItemGroup it leaves empty with it', () => {
        const content = project('').replace('    <Compile Include="Local.cs" />\n\n', '')
            .replace('  <ItemGroup>\n', '  <ItemGroup>\n    <None Include="../Shared/Shared.cs" Link="Shared.cs" />\n');
        const { content: edited } = removeLinkedItem(content, projectDir, shared, ['None']);
        expect(edited).not.toContain('<ItemGroup>');
        expect(edited).toContain('</PropertyGroup>');
    });

    test('removes it under every item type MSBuild lists the file under, and nothing else', () => {
        const content = project('    <Compile Include="..\\Shared\\Shared.cs" Link="Shared.cs" />\n    <None Include="..\\Shared\\Shared.cs" Link="Shared.cs" />\n    <Content Include="..\\Shared\\Other.cs" Link="Other.cs" />');
        const { content: edited } = removeLinkedItem(content, projectDir, shared, ['Compile', 'None']);
        expect(edited).not.toContain('Shared.cs');
        expect(edited).toContain('<Content Include="..\\Shared\\Other.cs" Link="Other.cs" />');
    });

    test('leaves items in comments and targets, wildcards, lists and properties: removed is false', () => {
        for (const item of [
            '    <!-- <Compile Include="..\\Shared\\Shared.cs" Link="Shared.cs" /> -->',
            '    <Compile Include="..\\Shared\\*.cs" LinkBase="Shared" />',
            '    <Compile Include="..\\Shared\\Shared.cs;..\\Shared\\Other.cs" LinkBase="Shared" />',
            '    <Compile Include="$(SharedDir)Shared.cs" Link="Shared.cs" />',
        ]) {
            const content = project(item);
            expect(removeLinkedItem(content, projectDir, shared, ['Compile'])).toEqual({ content, removed: false });
        }
        const inTarget = project('').replace('</Project>', '  <Target Name="T">\n    <ItemGroup>\n      <Compile Include="..\\Shared\\Shared.cs" Link="Shared.cs" />\n    </ItemGroup>\n  </Target>\n</Project>');
        expect(removeLinkedItem(inTarget, projectDir, shared, ['Compile']).removed).toBe(false);
    });

    test('an item type it was not asked for, or none at all, is left alone', () => {
        const content = project('    <None Include="..\\Shared\\Shared.cs" Link="Shared.cs" />');
        expect(removeLinkedItem(content, projectDir, shared, ['Compile']).removed).toBe(false);
        expect(removeLinkedItem(content, projectDir, shared, []).removed).toBe(false);
    });

    test('keeps CRLF line endings', () => {
        const content = project('    <Compile Include="..\\Shared\\Shared.cs" Link="Shared.cs" />').replace(/\n/g, '\r\n');
        const { content: edited } = removeLinkedItem(content, projectDir, shared, ['Compile']);
        expect(edited).not.toContain('Shared.cs');
        expect(edited.replace(/\r\n/g, '')).not.toContain('\n');
    });
});

describe('ProjectItems.isLinked', () => {
    test('is true for a file listed at a Link path, false for the project\'s own files and unknown ones', () => {
        const items = parseMsbuildItems(JSON.stringify({
            Items: { Compile: [
                { Identity: 'Local.cs', FullPath: path.join(projectDir, 'Local.cs') },
                { Identity: '..\\Shared\\Shared.cs', FullPath: shared, Link: 'Linked\\Shared.cs' },
            ] },
        }), projectDir)!;
        expect(items.isLinked(shared)).toBe(true);
        expect(items.isLinked(path.join(projectDir, 'Local.cs'))).toBe(false);
        expect(items.isLinked(path.join(root, 'Other.cs'))).toBe(false);
    });
});

describe('the confirmations', () => {
    test('Delete on a linked file names the real file, the projects that link it, and Remove Link', () => {
        const detail = linkedDeleteDetail(shared, ['App']);
        expect(detail).toContain(shared);
        expect(detail).toContain('outside the project');
        expect(detail).toContain('App then lists a missing file');
        expect(detail).toContain('Remove Link');
        expect(linkedDeleteDetail(shared, ['App', 'Web'])).toContain('App, Web then list a missing file');
    });

    test('Delete on several nodes says which of them are linked files', () => {
        expect(multiDeleteQuestion(3, [])).toBe('Delete 3 items? They are moved to the trash.');
        expect(multiDeleteQuestion(3, [shared])).toBe(`Delete 3 items? They are moved to the trash. One of them is a linked file: the real file outside the project is deleted (${shared}). To remove only a link, use Remove Link on it.`);
        expect(multiDeleteQuestion(3, [shared, shared])).toContain('2 of them are linked files: the real files outside the project are deleted');
    });
});
```

`src/test/unit/services/linkedFiles.test.ts`:
```ts
// Delete and Remove Link on linked files: SolutionActionService with a stubbed solution, on files in a temp folder
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ui = {
    answers: [] as (string | undefined)[],
    warnings: [] as { message: string; detail?: string; buttons: string[] }[],
    errors: [] as string[],
    picks: [] as string[][],
};

jest.mock('vscode', () => {
    const nodeFs = require('fs');
    return {
        Uri: { file: (p: string) => ({ fsPath: p }) },
        workspace: { fs: { delete: async (uri: { fsPath: string }) => nodeFs.rmSync(uri.fsPath, { recursive: true }) } },
        window: {
            showWarningMessage: async (message: string, ...rest: unknown[]) => {
                const options = rest.find(item => typeof item === 'object') as { detail?: string } | undefined;
                const buttons = rest.filter((item): item is string => typeof item === 'string');
                ui.warnings.push({ message, detail: options?.detail, buttons });
                return buttons.length > 0 ? ui.answers.shift() : undefined;
            },
            showErrorMessage: async (message: string) => { ui.errors.push(message); },
            showQuickPick: async (items: { label: string }[]) => {
                ui.picks.push(items.map(item => item.label));
                const answer = ui.answers.shift();
                return items.find(item => item.label === answer);
            },
        },
    };
}, { virtual: true });

import { SolutionService } from '../../../services/solutionService';
import { SolutionActionService } from '../../../services/solutionActionService';
import { NodeIdService } from '../../../services/nodeIdService';
import { ProjectItems, parseMsbuildItems } from '../../../services/projectItems/projectItems';
import { ProjectItemsService } from '../../../services/projectItems/projectItemsService';
import { NodeIdString } from '../../../types/nodeId';

const csproj = (items: string) => `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
  </PropertyGroup>
${items}
</Project>
`;
const linkItem = '\n  <ItemGroup>\n    <Compile Include="..\\Shared\\Shared.cs" Link="Linked\\Shared.cs" />\n  </ItemGroup>\n';

describe('linked files: Delete and Remove Link', () => {
    let dir: string;
    let shared: string;
    let items: Map<string, ProjectItems | undefined>;
    let projects: Map<string, { name: string; projectPath: string; reevaluateItems: jest.Mock }>;

    const addProject = (name: string, content: string, linksShared: boolean) => {
        const projectPath = path.join(dir, name, `${name}.csproj`);
        fs.mkdirSync(path.dirname(projectPath), { recursive: true });
        fs.writeFileSync(projectPath, content);
        fs.writeFileSync(path.join(dir, name, 'Program.cs'), '');
        projects.set(projectPath, { name, projectPath, reevaluateItems: jest.fn() });
        items.set(projectPath, parseMsbuildItems(JSON.stringify({
            Items: { Compile: [
                { Identity: 'Program.cs', FullPath: path.join(dir, name, 'Program.cs') },
                ...(linksShared ? [{ Identity: '..\\Shared\\Shared.cs', FullPath: shared, Link: 'Linked\\Shared.cs' }] : []),
            ] },
        }), path.dirname(projectPath)));
        return projectPath;
    };
    const action = (act: 'deleteFile' | 'removeLink', filePath: string) =>
        SolutionActionService.handleProjectAction({ action: act, nodeId: NodeIdService.generateFileId(filePath) });

    beforeEach(() => {
        ui.answers = [];
        ui.warnings = [];
        ui.errors = [];
        ui.picks = [];
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-linked-')));
        shared = path.join(dir, 'Shared', 'Shared.cs');
        fs.mkdirSync(path.dirname(shared));
        fs.writeFileSync(shared, 'namespace Shared;\n');
        items = new Map();
        projects = new Map();
        jest.spyOn(ProjectItemsService.instance, 'get').mockImplementation(projectPath => items.get(projectPath));
        (SolutionService as any).activeSolution = { projects };
    });

    afterEach(() => {
        (SolutionService as any).activeSolution = undefined;
        jest.restoreAllMocks();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('Delete on a linked file says that the real file outside the project goes, and deletes it when told to', async () => {
        const app = addProject('App', csproj(linkItem), true);
        ui.answers = ['Delete'];

        await action('deleteFile', shared);

        expect(ui.warnings).toEqual([{
            message: "Delete the linked file 'Shared.cs'?",
            detail: expect.stringContaining(`deletes the real file, outside the project:\n${shared}`),
            buttons: ['Remove Link', 'Delete'],
        }]);
        expect(ui.warnings[0].detail).toContain('App then lists a missing file');
        expect(fs.existsSync(shared)).toBe(false);
        expect(fs.readFileSync(app, 'utf8')).toBe(csproj(linkItem));
    });

    test('its Remove Link button removes only the link; Cancel changes nothing', async () => {
        const app = addProject('App', csproj(linkItem), true);
        ui.answers = [undefined];
        await action('deleteFile', shared);
        expect(fs.existsSync(shared)).toBe(true);
        expect(fs.readFileSync(app, 'utf8')).toBe(csproj(linkItem));

        ui.answers = ['Remove Link'];
        await action('deleteFile', shared);

        expect(fs.existsSync(shared)).toBe(true);
        expect(fs.readFileSync(app, 'utf8')).toBe(csproj(''));
        expect(projects.get(app)!.reevaluateItems).toHaveBeenCalledTimes(1);
    });

    test('Delete on a file of the project itself asks as before', async () => {
        addProject('App', csproj(linkItem), true);
        ui.answers = ['Delete'];

        await action('deleteFile', path.join(dir, 'App', 'Program.cs'));

        expect(ui.warnings.map(warning => warning.message)).toEqual(["Delete the file 'Program.cs'? It is moved to the trash."]);
        expect(fs.existsSync(path.join(dir, 'App', 'Program.cs'))).toBe(false);
    });

    test('Remove Link deletes the item, keeps the file and evaluates the project again', async () => {
        const app = addProject('App', csproj(linkItem), true);

        await action('removeLink', shared);

        expect(fs.readFileSync(app, 'utf8')).toBe(csproj(''));
        expect(fs.existsSync(shared)).toBe(true);
        expect(projects.get(app)!.reevaluateItems).toHaveBeenCalledTimes(1);
        expect(ui.warnings).toEqual([]);
    });

    test('Remove Link on a link the project file does not write itself (a wildcard, a props file) says so and changes nothing', async () => {
        const wildcard = csproj('\n  <ItemGroup>\n    <Compile Include="..\\Shared\\*.cs" LinkBase="Linked" />\n  </ItemGroup>\n');
        const app = addProject('App', wildcard, true);

        await action('removeLink', shared);

        expect(fs.readFileSync(app, 'utf8')).toBe(wildcard);
        expect(ui.warnings.map(warning => warning.message)).toEqual([
            'The link to Shared.cs is not an item of its own in App.csproj: a wildcard or another file (Directory.Build.props, an import) adds it. Remove it there.',
        ]);
        expect(projects.get(app)!.reevaluateItems).not.toHaveBeenCalled();
    });

    test('a file linked by several projects: Remove Link asks which one', async () => {
        const app = addProject('App', csproj(linkItem), true);
        const web = addProject('Web', csproj(linkItem), true);
        ui.answers = ['Web'];

        await action('removeLink', shared);

        expect(ui.picks).toEqual([['App', 'Web']]);
        expect(fs.readFileSync(web, 'utf8')).toBe(csproj(''));
        expect(fs.readFileSync(app, 'utf8')).toBe(csproj(linkItem));
    });

    test('Delete on several nodes names the linked files among them', async () => {
        addProject('App', csproj(linkItem), true);
        const program = path.join(dir, 'App', 'Program.cs');
        ui.answers = ['Delete'];

        await SolutionActionService.handleMultiAction('deleteFile', [shared, program].map(file => NodeIdService.generateFileId(file)) as NodeIdString[]);

        expect(ui.warnings.map(warning => warning.message)).toEqual([
            `Delete 2 items? They are moved to the trash. One of them is a linked file: the real file outside the project is deleted (${shared}). To remove only a link, use Remove Link on it.`,
        ]);
        expect(fs.existsSync(shared)).toBe(false);
        expect(fs.existsSync(program)).toBe(false);
    });

    const hasDotnet = spawnSync('dotnet', ['--version']).status === 0;
    (hasDotnet ? test : test.skip)('real MSBuild: the link is there before Remove Link and gone after it', async () => {
        const app = addProject('App', csproj(linkItem), true);
        const before = await new ProjectItemsService().evaluate(app);
        expect(before?.isLinked(shared)).toBe(true);
        items.set(app, before);

        await action('removeLink', shared);

        const after = await new ProjectItemsService().evaluate(app);
        expect(after).toBeDefined();
        expect(after!.isIncluded(shared)).toBe(false);
        expect(after!.isIncluded(path.join(dir, 'App', 'Program.cs'))).toBe(true);
    }, 150000);
});
```

`src/test/unit/core/Project.items.test.ts`, insert before the test `does not offer Exclude on a folder that is a project of the solution`:
```ts
    test('offers Remove Link on linked files (also in old-style projects), not Exclude', async () => {
        fs.writeFileSync(projectPath, '<Project ToolsVersion="15.0"></Project>');
        const outside = path.join(os.tmpdir(), 'Elsewhere', 'Common.cs');
        jest.spyOn(ProjectItemsService.instance, 'get').mockReturnValue(parseMsbuildItems(JSON.stringify({
            Items: { Compile: [{ Identity: outside, FullPath: outside, Link: 'Common.cs' }] },
        }), dir));
        const children = await (await newProject()).getFolderChildren(dir);
        expect(children.find(child => child.name === 'Common.cs')).toMatchObject({ itemState: 'linked', contextValue: 'linked' });
    });

```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/test/unit/services/projectItems/linkedItems.test.ts src/test/unit/services/linkedFiles.test.ts src/test/unit/core/Project.items.test.ts`
Expected: FAIL (`Cannot find module '../../../../services/projectItems/linkedItems'`; `linkedFiles.test.ts` fails on the type of `action: 'removeLink'` and on the question text; the Project test gets `contextValue: undefined`)

- [ ] **Step 3: `ProjectItems.isLinked`**

In `src/services/projectItems/projectItems.ts`, before `/** The file's item type; the first in ITEM_TYPES order when it is listed under several */` insert:
```ts
    /** Whether the project lists the file as a link: shown at its `Link` path, the file itself lives elsewhere */
    isLinked(fullPath: string): boolean {
        return (this.byFullPath.get(key(fullPath)) ?? []).some(entry => entry.linked);
    }

```

- [ ] **Step 4: Implement `src/services/projectItems/linkedItems.ts`**

```ts
import * as path from 'path';
import { ProjectFileEditor as Xml } from '../../parsers/projectFileEditor';
import { pathKey } from './projectItems';

/**
 * Linked files (`<Compile Include="..\Shared\x.cs" Link="x.cs" />`): the file lives outside the project folder, the
 * project only points to it. Remove Link takes the item out of the project file; Delete would delete the real file.
 */

const unescapeMsbuild = (value: string) => value.replace(/%([0-9A-Fa-f]{2})/g, (_all, hex: string) => String.fromCharCode(parseInt(hex, 16)));
/** The file an Include written in the project file stands for */
const resolveItem = (projectDir: string, value: string) =>
    path.resolve(projectDir, unescapeMsbuild(Xml.unescape(value)).trim().replace(/[\\/]/g, path.sep));
const sameFile = (a: string, b: string) => pathKey(path.normalize(a)) === pathKey(path.normalize(b));
/** A wildcard, a list of files, or properties/item lists: what it stands for takes MSBuild to tell */
const isExact = (include: string) => !/[*?;]|[$@]\(/.test(Xml.unescape(include));

interface Element {
    readonly include: string;
    readonly start: number;
    readonly end: number;
}

/** Items of the given types with an Include, self-closing or with children (`<Link>`), outside comments and targets */
function itemElements(content: string, itemTypes: readonly string[]): Element[] {
    const types = itemTypes.map(type => type.replace(/[^A-Za-z0-9_]/g, '')).filter(Boolean);
    if (types.length === 0) {
        return [];
    }
    const elementRe = new RegExp(`<(${types.join('|')})\\b((?:[^>"']|"[^"]*"|'[^']*')*?)(?:\\/>|>[\\s\\S]*?<\\/\\1\\s*>)`, 'g');
    const ignored = Xml.ignoredRanges(content);
    const result: Element[] = [];
    for (const match of content.matchAll(elementRe)) {
        const include = /\bInclude\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(match[2]);
        if (include && !Xml.inRanges(ignored, match.index!)) {
            result.push({ include: include[1] ?? include[2], start: match.index!, end: match.index! + match[0].length });
        }
    }
    return result;
}

/**
 * Removes the items of the project file that list exactly this file (one per item type MSBuild lists it under),
 * with their ItemGroup when it is left empty. `removed` is false when the project file has no such item: the link
 * comes from a wildcard (`LinkBase`), a list, properties, or another file (Directory.Build.props, an import).
 */
export function removeLinkedItem(content: string, projectDir: string, filePath: string, itemTypes: readonly string[]): { content: string; removed: boolean } {
    const matching = itemElements(content, itemTypes)
        .filter(element => isExact(element.include) && sameFile(resolveItem(projectDir, element.include), filePath));
    let result = content;
    // From the end, so the offsets of the earlier items stay valid
    for (const element of [...matching].reverse()) {
        result = Xml.deleteElement(result, element.start, element.end);
    }
    return { content: result, removed: matching.length > 0 };
}

/** The confirmation of Delete on a linked file: the real file goes, for every project that links it */
export function linkedDeleteDetail(filePath: string, projectNames: readonly string[]): string {
    return `This is a linked file: Delete deletes the real file, outside the project:\n${filePath}\n\n`
        + `It is moved to the trash, and ${projectNames.join(', ')} then ${projectNames.length > 1 ? 'list' : 'lists'} a missing file. `
        + 'Remove Link takes it out of the project and leaves the file.';
}

/** The confirmation of Delete on several nodes, some of them linked files */
export function multiDeleteQuestion(count: number, linkedFiles: readonly string[]): string {
    const question = `Delete ${count} items? They are moved to the trash.`;
    if (linkedFiles.length === 0) {
        return question;
    }
    return `${question} ${linkedFiles.length === 1 ? 'One of them is a linked file' : `${linkedFiles.length} of them are linked files`}: `
        + `the real ${linkedFiles.length === 1 ? 'file' : 'files'} outside the project ${linkedFiles.length === 1 ? 'is' : 'are'} deleted `
        + `(${linkedFiles.join(', ')}). To remove only a link, use Remove Link on it.`;
}
```

- [ ] **Step 5: The command, the menu and the context value**

`src/core/contextMenus.ts`:

after the `EXCLUDED_ITEM` constant insert
```ts
/** `contextValue` of linked files (the file lives outside the project folder): Remove Link takes the link out */
export const LINKED_ITEM = 'linked';
```
replace the `deleteFile` line of `menuCommands` with
```ts
    deleteFile: { title: 'Delete', description: 'Moves the file or folder to the trash, after asking. On a linked file this is the real file outside the project: the question says so and offers Remove Link instead.', key: 'delete', mac: 'cmd+backspace' },
    removeLink: { title: 'Remove Link', description: 'Takes a linked file out of the project: deletes the item that links it (the one with `Link`) from the project file. The file itself stays where it is.' },
```
in `contextMenus`, after ``[`folder.${EXCLUDED_ITEM}`]: [[], [], ['includeInProject']],`` insert
```ts
    [`file.${LINKED_ITEM}`]: [[], [], ['removeLink']],
```
in the `file` menu change the comment of the third group to `[], // excludeFromProject or includeInProject (SDK-style projects), removeLink on linked files`; in `conditionNames`, after the ``[`folder.${EXCLUDED_ITEM}`]`` entry insert
```ts
    [`file.${LINKED_ITEM}`]: 'On linked files (they live outside the project folder)',
```

`src/types/commands/project-action.ts`: before `export declare type CopyActionCmd = {` insert
```ts
export declare type RemoveLinkActionCmd = {
    readonly action: 'removeLink';
    readonly nodeId: NodeIdString;
}

```
and in the `ProjectActionCmd` union, after `| IncludeInProjectActionCmd`, add `| RemoveLinkActionCmd`.

`src/core/Project.ts`: the import becomes `import { INCLUDED_ITEM, EXCLUDED_ITEM, LINKED_ITEM } from './contextMenus';` and in `toProjectChild`
```ts
        const itemValue = !this._isSdkStyle ? undefined
            : node.itemState === 'excluded' ? EXCLUDED_ITEM
```
becomes
```ts
        // Remove Link edits the item, which works in old-style project files too
        const itemValue = !isFolder && node.itemState === 'linked' ? LINKED_ITEM
            : !this._isSdkStyle ? undefined
            : node.itemState === 'excluded' ? EXCLUDED_ITEM
```

The command is registered by `registerNativeContextMenuCommands` (it walks `menuCommands`) and reaches `SolutionActionService.handleProjectAction` through `runNodeAction`; nothing to add in the providers (the project's change event redraws the tree after the re-evaluation).

- [ ] **Step 6: Delete, Remove Link and the multi-select question in `SolutionActionService`**

`src/services/solutionActionService.ts`, after the import of `./grpc/grpcReferenceService` add:
```ts
import { linkedDeleteDetail, multiDeleteQuestion, removeLinkedItem } from './projectItems/linkedItems';
import type { Project } from '../core/Project';
```

In `handleProjectAction`, after the `excludeFromProject`/`includeInProject` case (`await this._handleItemMembership(...); break;`) add:
```ts

            case 'removeLink':
                await this._handleRemoveLink(nodeId);
                break;
```

In `_handleDeleteFile`, between `const itemType = isDirectory ? 'folder' : 'file';` and `const answer = await vscode.window.showWarningMessage(` insert:
```ts
            // A linked file lives outside the project: say that the real file goes, and offer to remove only the link
            const linking = isDirectory ? [] : this._projectsLinking(filePath);
            if (linking.length > 0) {
                const choice = await vscode.window.showWarningMessage(`Delete the linked file '${path.basename(filePath)}'?`,
                    { modal: true, detail: linkedDeleteDetail(filePath, linking.map(project => project.name)) }, 'Remove Link', 'Delete');
                if (choice === 'Remove Link') {
                    await this._handleRemoveLink(nodeId);
                } else if (choice === 'Delete') {
                    await vscode.workspace.fs.delete(vscode.Uri.file(filePath), { recursive: false, useTrash: true });
                    log.info(`linked file deleted: ${filePath}`);
                }
                return;
            }

```

Before `private static async _handleRemoveSolutionItem(nodeId: NodeId): Promise<void> {` insert:
```ts
    /** The loaded projects of the solution that link the file (their evaluation lists it at a `Link` path) */
    private static _projectsLinking(filePath: string): Project[] {
        const solution = SolutionService.getActiveSolution();
        return [...(solution?.projects.values() ?? [])]
            .filter(project => ProjectItemsService.instance.get(project.projectPath)?.isLinked(filePath));
    }

    /** Remove Link: deletes the item that links the file from the project file; the file itself stays */
    private static async _handleRemoveLink(nodeId: NodeId): Promise<void> {
        const filePath = nodeId.path;
        const name = path.basename(filePath);
        const linking = this._projectsLinking(filePath);
        if (linking.length === 0) {
            vscode.window.showWarningMessage(`${name} is not a linked file of a project.`);
            return;
        }
        let project = linking[0];
        if (linking.length > 1) {
            // The node id is the file: the tree row it was clicked in is not known
            const picked = await vscode.window.showQuickPick(linking.map(candidate => ({ label: candidate.name, project: candidate })),
                { placeHolder: `${name} is linked by several projects: remove the link from which one?` });
            if (!picked) {
                return;
            }
            project = picked.project;
        }
        const projectPath = project.projectPath;
        try {
            const itemTypes = ProjectItemsService.instance.get(projectPath)?.itemTypesOf(filePath) ?? [];
            const content = await fs.promises.readFile(projectPath, 'utf8');
            const edit = removeLinkedItem(content, path.dirname(projectPath), filePath, itemTypes);
            if (!edit.removed) {
                vscode.window.showWarningMessage(`The link to ${name} is not an item of its own in ${path.basename(projectPath)}: `
                    + 'a wildcard or another file (Directory.Build.props, an import) adds it. Remove it there.');
                return;
            }
            await fs.promises.writeFile(projectPath, edit.content, 'utf8');
            await project.reevaluateItems();
        } catch (error) {
            log.error(`Remove Link failed for ${filePath}:`, error);
            vscode.window.showErrorMessage(`Could not remove the link to ${name}: ${error instanceof Error ? error.message : error}`);
        }
    }

```

In `handleMultiAction`, case `'deleteFile'`, replace
```ts
                    if (await confirm(`Delete ${nodes.length} items? They are moved to the trash.`, 'Delete')) {
```
with
```ts
                    if (await confirm(multiDeleteQuestion(nodes.length,
                        nodes.filter(node => node.type === 'file' && this._projectsLinking(node.path).length > 0).map(node => node.path)), 'Delete')) {
```

- [ ] **Step 7: Generate the menus**

```bash
npm run generate:menus
git diff --stat package.json docs/context-menus.md
```
Expected: `package.json context menus and docs/context-menus.md updated`; `package.json` gains the `shinobi.solutionExplorer.removeLink` command, its `commandPalette` entry (`"when": "false"`) and a `webview/context` entry with `nodeType == 'file' && contextValue == 'linked'` in `03_group@1`; `docs/context-menus.md` gains "**On linked files (they live outside the project folder)**" with Remove Link under File, and the longer Delete description under Folder and File.

- [ ] **Step 8: Run to verify it passes**

Run: `npx jest src/test/unit/services/projectItems/linkedItems.test.ts src/test/unit/services/linkedFiles.test.ts src/test/unit/core/Project.items.test.ts src/test/unit/core/contextMenus.test.ts`
Expected: PASS (the real-MSBuild test in `linkedFiles.test.ts` runs when `dotnet` is installed, about a second)

- [ ] **Step 9: Docs**

`docs/solution-explorer.md`, section "Exclude From Project and Include In Project": replace the line `- A linked file has no Exclude entry. Its Delete deletes the real file.` with
```markdown
- A linked file has no Exclude entry; it has **Remove Link** instead, which deletes the item that links it (`<Compile Include="..\Shared\x.cs" Link="x.cs" />`) from the project file and leaves the file where it is. It also works in old-style projects. A link added by a wildcard (`LinkBase`) or by another file (`Directory.Build.props`, an import) is not an item of its own in the project file: Remove Link says so, and you remove it there. When several projects link the file, Remove Link asks which one.
- **Delete** on a linked file deletes the real file, outside the project, which every project that links it then misses. The question says so, shows the file's path and offers Remove Link instead. Deleting several nodes at once names the linked files among them.
```

`docs/manual-testing.md`, append unticked:
```markdown
- [ ] Linked files, Delete and Remove Link (a project with `<Compile Include="..\Shared\Shared.cs" Link="Linked\Shared.cs" />`): right-click `Linked/Shared.cs` shows Remove Link (no Exclude From Project); Remove Link takes the line out of the project file, the file stays in `Shared/` and the node leaves the tree; with the link back, Delete (menu and the Delete key) asks "Delete the linked file 'Shared.cs'?" with the real path and the buttons Remove Link and Delete; Remove Link there does the same as the menu, Delete moves `Shared/Shared.cs` to the trash; selecting the linked file and a file of the project and pressing Delete names the linked file in the question; a file linked by two projects asks which project Remove Link is for
```

No GIF: one more menu entry and a clearer question; the docs text and the generated menu reference explain it.

- [ ] **Step 10: Verify and commit**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git add src/services/projectItems/linkedItems.ts src/services/projectItems/projectItems.ts src/core/contextMenus.ts src/types/commands/project-action.ts src/core/Project.ts src/services/solutionActionService.ts package.json docs/context-menus.md docs/solution-explorer.md docs/manual-testing.md src/test/unit/services/projectItems/linkedItems.test.ts src/test/unit/services/linkedFiles.test.ts src/test/unit/core/Project.items.test.ts
git commit -m "Linked files: Delete says the real file goes and offers Remove Link; Remove Link command

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: exit 0 (while planning, alone on HEAD: 158 suites, 1376 tests).

---

### Task 6: Drag & drop leaves no grey hover highlight behind

**Files:**
- Modify: `src/webview/solution-view/types/index.ts`, `src/webview/solution-view/components/TreeNode/TreeNode.tsx`, `src/webview/solution-view/components/SolutionTree.tsx`, `src/webview/providers/views/SolutionWebview.ts`
- Test: `src/test/unit/webview/solution-view/components/SolutionTreeDragDrop.test.tsx`
- Docs: `docs/manual-testing.md`

**Repro (done while planning):** a scene added to a scratch copy of `scripts/screenshots/capture.sh` (VS Code in its own Xvfb, the screenshot sample) dragged Shop.Generators (row 4) onto the collapsed `tools` solution folder and took a screenshot without moving the mouse: the grey hover background sat on Shop.Web, the row now at the place where the drag started, while the pointer rested on `tools`; a second drag (Shop.Worker onto `tests`) left it on `tests`, again the row at the drag's start point. An event log rendered into the webview (scratch only) showed why: after `drop`/`dragend` Chromium sends `mouseover` at the last mouse position before the drag (`54,102 movementX=0`), on whatever row is there now; no mousemove follows until the mouse really moves. The highlight is pure CSS (`.tree-node:hover` in `SolutionWebview.ts`), so there is nothing to clear on drag end. A plain Electron 42 page with draggable rows (no iframe, no re-render) did not show it, so it takes VS Code's webview. After the fix below the same scene shows no grey row after either drop, and moving the mouse onto a row highlights it again.

The highlight becomes a class the tree sets from `mouseover`/`mousemove`; a drag clears it, and from the drag's start it stays off until a `mousemove` with a movement.

- [ ] **Step 1: Write the failing tests**

`src/test/unit/webview/solution-view/components/SolutionTreeDragDrop.test.tsx`: add to the imports at the top:
```tsx
import * as fs from 'fs';
import * as path from 'path';
```
and before the last `});` of the file (after the test 'nothing can be dragged while a name is being edited'):
```tsx

    // jsdom's MouseEvent has no movementX/Y: set by hand, like the modifier keys of the drag events
    const mouseMove = (target: Element, movement: number) => {
        const event = createEvent.mouseMove(target);
        Object.defineProperty(event, 'movementX', { value: movement });
        Object.defineProperty(event, 'movementY', { value: 0 });
        fireEvent(target, event);
    };
    const hovered = () => [...document.querySelectorAll('.tree-node.hovered')].map(el => el.textContent);

    it('the hover highlight follows the mouse', () => {
        const { row } = setup();
        fireEvent.mouseOver(row('A.cs'));
        expect(hovered()).toEqual(['A.cs']);
        fireEvent.mouseOver(row('B.cs'));
        expect(hovered()).toEqual(['B.cs']);
    });

    it('a drag clears the hover highlight; after the drop it comes back only when the mouse really moves', () => {
        const { row, drag } = setup();
        fireEvent.mouseOver(row('B.cs'));
        drag('dragStart', 'B.cs');
        expect(hovered()).toEqual([]);
        drag('dragOver', 'Controllers');
        drag('drop', 'Controllers');
        drag('dragEnd', 'B.cs');
        expect(hovered()).toEqual([]);

        // What Chromium sends after the drop, at the point where the drag started: no movement
        fireEvent.mouseOver(row('A.cs'));
        mouseMove(row('A.cs'), 0);
        expect(hovered()).toEqual([]);

        mouseMove(row('Models'), 3);
        expect(hovered()).toEqual(['Models']);
        fireEvent.mouseOver(row('A.cs'));
        expect(hovered()).toEqual(['A.cs']);
    });

    it('the hover highlight goes when the mouse is below the rows or leaves the tree', () => {
        const { row } = setup();
        const tree = document.querySelector('.solution-tree')!;
        fireEvent.mouseOver(row('A.cs'));
        fireEvent.mouseOver(tree);
        expect(hovered()).toEqual([]);
        fireEvent.mouseOver(row('A.cs'));
        fireEvent.mouseLeave(tree);
        expect(hovered()).toEqual([]);
    });

    it('the stylesheet highlights the hovered row by its class, not with :hover', () => {
        const html = fs.readFileSync(path.join(__dirname, '../../../../../webview/providers/views/SolutionWebview.ts'), 'utf8');
        expect(html).not.toContain('.tree-node:hover');
        expect(html).toContain('.tree-node.hovered {');
    });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/test/unit/webview/solution-view/components/SolutionTreeDragDrop.test.tsx`
Expected: FAIL, 3 failed ('the hover highlight follows the mouse', 'a drag clears the hover highlight…', 'the stylesheet highlights…'); 'the hover highlight goes when…' passes already (nothing is ever hovered by class yet).

- [ ] **Step 3: The props**

`src/webview/solution-view/types/index.ts`: the first line becomes
```ts
import type { DragEvent, MouseEvent } from 'react';
```
and at the end of `TreeNodeProps`, after `onNodeDragEnd?: () => void;`:
```ts
    /** The row under the mouse: a class, not CSS :hover, which Chromium moves to a wrong row after a drop */
    hoveredNodeId?: NodeIdString;
    /** A mouseover or mousemove on the row */
    onNodeHover?: (nodeId: NodeIdString, e: MouseEvent) => void;
```

- [ ] **Step 4: `TreeNode` sets the class and reports the mouse**

`src/webview/solution-view/components/TreeNode/TreeNode.tsx`:
- In the destructured props, `onNodeDragEnd` becomes:
```tsx
    onNodeDragEnd,
    hoveredNodeId,
    onNodeHover
}) => {
```
- The row's `className` gets the class at the end (the template string ends `… ${dropTargetId === nodeIdentifier ? 'drop-target' : ''}`; append):
```tsx
                className={`tree-node ${node.type} ${isSelected ? 'selected' : ''} ${isFocused ? 'focused' : ''} ${isActiveFile ? 'active' : ''} ${node.isUnloaded ? 'unloaded' : ''} ${node.itemState ?? ''} ${dropTargetId === nodeIdentifier ? 'drop-target' : ''} ${hoveredNodeId === nodeIdentifier ? 'hovered' : ''}`}
```
- After `onDragEnd={() => onNodeDragEnd?.()}`:
```tsx
                onMouseOver={e => onNodeHover?.(nodeIdentifier, e)}
                onMouseMove={e => onNodeHover?.(nodeIdentifier, e)}
```
- In the children's `<TreeNode … />`, after `onNodeDragEnd={onNodeDragEnd}`:
```tsx
                            hoveredNodeId={hoveredNodeId}
                            onNodeHover={onNodeHover}
```

- [ ] **Step 5: `SolutionTree` keeps the hovered row**

`src/webview/solution-view/components/SolutionTree.tsx`:
- After `useEffect(() => () => clearExpandTimer(), []);`:
```tsx

    // The row under the mouse. Not CSS :hover: after a drop Chromium sends a mouseover (and moves :hover) to the row now
    // at the point where the drag started, though the mouse is elsewhere. So from a drag's start nothing is hovered
    // until the mouse really moves: a mousemove with a movement (Chromium's own events after the drop have none)
    const [hoveredNodeId, setHoveredNodeId] = useState<NodeIdString | undefined>();
    const hoverPaused = useRef(false);
    const handleNodeHover = (nodeId: NodeIdString | undefined, e: React.MouseEvent) => {
        if (draggedIds.current.length > 0) {
            return;
        }
        if (hoverPaused.current) {
            if (e.type !== 'mousemove' || (!e.movementX && !e.movementY)) {
                return;
            }
            hoverPaused.current = false;
        }
        setHoveredNodeId(nodeId);
    };
```
- In `handleNodeDragStart`, after `draggedIds.current = ids;`:
```tsx
        hoverPaused.current = true;
        setHoveredNodeId(undefined);
```
- `endDrag` becomes:
```tsx
    const endDrag = () => {
        draggedIds.current = [];
        setDropTargetId(undefined);
        setHoveredNodeId(undefined);
        clearExpandTimer();
    };
```
- On the root `<div className="solution-tree" …>`, after `data-vscode-context={JSON.stringify({ preventDefaultContextMenuItems: true })}`:
```tsx
            onMouseOver={e => {
                // Below the last row: no row is hovered (a row's own handler sets it)
                if (!(e.target as Element).closest('.tree-node')) {
                    handleNodeHover(undefined, e);
                }
            }}
            onMouseMove={e => {
                if (!(e.target as Element).closest('.tree-node')) {
                    handleNodeHover(undefined, e);
                }
            }}
            onMouseLeave={() => setHoveredNodeId(undefined)}
```
- In the top-level `<TreeNode … />`, after `onNodeDragEnd={endDrag}`:
```tsx
                    hoveredNodeId={hoveredNodeId}
                    onNodeHover={handleNodeHover}
```

- [ ] **Step 6: The stylesheet**

`src/webview/providers/views/SolutionWebview.ts`: the rule `.tree-node:hover {` becomes (its body, `background-color: var(--vscode-list-hoverBackground);`, stays; it keeps its place before `.tree-node.selected`, so selection and drop target still win):
```css
                        /* The row under the mouse: a class set by the tree, as Chromium moves :hover to a wrong row after a drop */
                        .tree-node.hovered {
```

- [ ] **Step 7: Run to verify it passes**

Run: `npx jest src/test/unit/webview/solution-view`
Expected: PASS (9 suites)

- [ ] **Step 8: Docs**

No docs page change: nothing to describe (the highlight simply no longer stays behind). No GIF: a fix of a stray highlight. `docs/manual-testing.md`, append unticked:
```markdown
- [ ] Drag & drop hover highlight (BasicsTestProject): drag a file onto a folder further down and drop it without moving the mouse afterwards: no row stays grey (before: the row now at the point where the drag started); moving the mouse brings the hover highlight back on the row under it; also after dragging over several rows and after a drop that opened a folder
```

- [ ] **Step 9: Verify and commit**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git add src/webview/solution-view/types/index.ts src/webview/solution-view/components/TreeNode/TreeNode.tsx src/webview/solution-view/components/SolutionTree.tsx src/webview/providers/views/SolutionWebview.ts src/test/unit/webview/solution-view/components/SolutionTreeDragDrop.test.tsx docs/manual-testing.md
git commit -m "Drag & drop: no grey hover highlight left behind after a drop

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: exit 0.

---

### Task 7: After a drop the target opens and the moved nodes are selected

**Files:**
- Modify: `src/services/solutionExpansionService.ts`, `src/services/solutionActionService.ts`, `src/types/commands/ui.ts`, `src/webview/providers/SolutionWebviewProvider.ts`, `src/webview/solution-view/components/SolutionTree.tsx`, `scripts/screenshots/capture.sh`
- Test: `src/test/unit/services/solutionExpansionService.reveal.test.ts`, `src/test/unit/services/moveNodes.test.ts`, `src/test/unit/webview/solution-view/components/SolutionTreeSelect.test.tsx`
- Docs: `docs/solution-explorer.md`, `docs/manual-testing.md`, `docs/images/drag-and-drop.gif`

**Repro (done while planning):** in the real VS Code run of Task 6's repro, Shop.Generators dropped onto the collapsed `tools` solution folder disappeared from view: `tools` stayed collapsed, nothing was selected. From a Jest scratch test with the real code (a copy of `src/__fixtures__/solution-hierarchy`, `TestHierarchy.slnx`, `SolutionActionService.moveNodes` then `SolutionTreeService.buildSolutionTree` and `restoreExpansionStates` as the provider does): before `Tools expanded = undefined, children = []`; after moving StandaloneProject and `Web Projects/Shared` onto it `Tools expanded = undefined, children = [Shared, StandaloneProject]`, nothing saved as expanded, and the moved `Shared` no longer had its old id (in a `.slnx` without `Id` the folder's GUID comes from its path), so the webview could not even select it by the id it dragged. The drop path (`moveNodes` case in `SolutionWebviewProvider`) never touched the expansion state or the selection. After the fix the same scene shows `tools` open with Shop.Generators selected, and the drop of Coupon.cs onto Pricing selects Coupon.cs once MSBuild has evaluated Shop.Core again (about a second after the namespace question).

`moveNodes` returns where the drop went and what it moved; the provider keeps that until the next rebuild of the tree, where `SolutionExpansionService.revealDrop` opens the target (once) and finds the moved nodes by type and path (by name for solution folders), then the webview gets one `selectNode` with all of them. A moved file only shows after its project's next MSBuild evaluation, so rebuilds keep looking for 10 seconds.

- [ ] **Step 1: Write the failing tests**

`src/test/unit/services/solutionExpansionService.reveal.test.ts`, append at the end of the file:
```ts

describe('SolutionExpansionService.revealDrop (after a drop)', () => {
    const apiPath = path.resolve('/repo/src/Api/Api.csproj');

    it('opens the solution folder a project was dropped onto and returns the project, remembered as expanded', async () => {
        const nodes = tree();
        const ctx = context();

        const revealed = await SolutionExpansionService.revealDrop({ container: srcFolderId, nodes: [{ type: 'project', key: apiPath }] }, nodes, ctx, true, load);

        expect(revealed).toEqual([apiId]);
        expect(find(nodes, srcFolderId)?.expanded).toBe(true);
        expect(ctx.saved).toEqual([srcFolderId]);
    });

    it('finds a moved solution folder and solution item by name and path: their ids changed with the parent', async () => {
        const nodes = tree();
        const src = find(nodes, srcFolderId)!;
        const sharedId = NodeIdService.generateSolutionFolderId('Shared', '/repo/App.slnx', 'guid-new', 'guid-src');
        const readmeId = NodeIdService.generateSolutionItemId('README.md', 'guid-src', path.resolve('/repo/README.md'));
        src.children!.push({ type: 'solutionFolder', name: 'Shared', nodeId: sharedId, children: [] }, { type: 'solutionItem', name: 'README.md', nodeId: readmeId });

        const revealed = await SolutionExpansionService.revealDrop({
            container: srcFolderId,
            nodes: [{ type: 'solutionItem', key: path.resolve('/repo/README.md') }, { type: 'solutionFolder', key: 'Shared' }],
        }, nodes, context(), true, load);

        expect(revealed).toEqual([readmeId, sharedId]);
    });

    it('loads the children of a collapsed folder a file was dropped onto, nested files included', async () => {
        const nodes = tree();
        const api = find(nodes, apiId)!;
        api.expanded = true;
        api.children = await load(api);

        const revealed = await SolutionExpansionService.revealDrop({
            container: pagesId,
            nodes: [{ type: 'file', key: path.resolve('/repo/src/Api/Pages/Index.cshtml.cs') }],
        }, nodes, context(), true, load);

        expect(revealed).toEqual([pageCodeId]);
        expect(find(nodes, pagesId)?.expanded).toBe(true);
    });

    it('opens the target even when the tree does not show the moved nodes yet, and returns none', async () => {
        const nodes = tree();

        const revealed = await SolutionExpansionService.revealDrop({ container: srcFolderId, nodes: [{ type: 'project', key: path.resolve('/repo/Other/Other.csproj') }] }, nodes, context(), true, load);

        expect(revealed).toEqual([]);
        expect(find(nodes, srcFolderId)?.expanded).toBe(true);
    });

    it('a container the tree does not have: nothing is opened or remembered', async () => {
        const nodes = tree();
        const ctx = context();
        const gone = NodeIdService.generateSolutionFolderId('Gone', '/repo/App.slnx', 'guid-gone');

        expect(await SolutionExpansionService.revealDrop({ container: gone, nodes: [{ type: 'project', key: apiPath }] }, nodes, ctx, true, load)).toEqual([]);
        expect(ctx.saved).toEqual([]);
    });

    it('open false only looks: a target the user closed again stays closed', async () => {
        const nodes = tree();
        const ctx = context();

        const revealed = await SolutionExpansionService.revealDrop({ container: srcFolderId, nodes: [{ type: 'project', key: apiPath }] }, nodes, ctx, false, load);

        expect(revealed).toEqual([apiId]);
        expect(find(nodes, srcFolderId)?.expanded).toBe(false);
        expect(ctx.saved).toEqual([]);
    });
});
```

`src/test/unit/services/moveNodes.test.ts`: after the import of `ProjectItemsService` add
```ts
import { SolutionTreeService } from '../../../services/solutionTreeService';
import { SolutionExpansionService } from '../../../services/solutionExpansionService';
import { ProjectNode } from '../../../types';
```
and before the last `});` of the file:
```ts
    test('returns where the drop went and what it moved: paths, and the names of solution folders; nothing for a refused drop', async () => {
        write('namespace CoreLibrary;\n', 'lib', 'CoreLibrary', 'Helper.cs');
        ui.answers = ['Skip'];
        const readme = NodeIdService.generateSolutionItemId('README.md', guid('Web Projects'), at('README.md'));

        expect(await SolutionActionService.moveNodes([fileNode('lib', 'CoreLibrary', 'Helper.cs')], projectNode('lib', 'Utils', 'Utils.csproj'), false)).toEqual({
            container: projectNode('lib', 'Utils', 'Utils.csproj'),
            nodes: [{ type: 'file', key: at('lib', 'Utils', 'Helper.cs') }],
        });
        expect(await SolutionActionService.moveNodes(
            [projectNode('src', 'WebApp', 'WebApp.csproj'), readme, folderNode('Libraries', 'Shared')], folderNode('Tools'), false)).toEqual({
            container: folderNode('Tools'),
            nodes: [
                { type: 'project', key: at('src', 'WebApp', 'WebApp.csproj') },
                { type: 'solutionItem', key: at('README.md') },
                { type: 'solutionFolder', key: 'Shared' },
            ],
        });
        expect(await SolutionActionService.moveNodes([NodeIdService.generateDependenciesId(at('lib', 'Utils', 'Utils.csproj'))], folderNode('Tools'), false)).toBeUndefined();
    });

    test('.slnx: the rebuilt tree opens the collapsed solution folder of a drop and finds the moved nodes, also a solution folder whose id changed', async () => {
        const slnx = new Solution(at('TestHierarchy.slnx'));
        for (let i = 0; i < 100 && !slnx.isInitialized; i++) await new Promise(r => setTimeout(r, 10));
        (SolutionService as any).activeSolution = slnx;
        let saved: string[] = [];
        const ctx = { workspaceState: { get: (_key: string, fallback: string[]) => saved.length ? saved : fallback, update: (_key: string, value: string[]) => { saved = value; } } } as any;
        const all = (nodes: ProjectNode[]): ProjectNode[] => nodes.flatMap(node => [node, ...all(node.children ?? [])]);
        const child = (parent: ProjectNode, name: string) => parent.children!.find(node => node.name === name)!;
        try {
            const before = await SolutionTreeService.buildSolutionTree(slnx);
            const tools = all(before).find(node => node.type === 'solutionFolder' && node.name === 'Tools')!;
            const shared = child(all(before).find(node => node.name === 'Web Projects')!, 'Shared');
            const standalone = all(before).find(node => node.name === 'StandaloneProject')!;
            expect(tools.expanded).toBeFalsy();

            const drop = await SolutionActionService.moveNodes([standalone.nodeId, shared.nodeId], tools.nodeId, false);
            const after = await SolutionTreeService.buildSolutionTree(slnx);
            await SolutionExpansionService.restoreExpansionStates(after, ctx);
            const revealed = await SolutionExpansionService.revealDrop(drop!, after, ctx);

            const toolsAfter = all(after).find(node => node.nodeId === tools.nodeId)!;
            expect(toolsAfter.expanded).toBe(true);
            expect(saved).toContain(tools.nodeId);
            expect(revealed).toEqual([child(toolsAfter, 'StandaloneProject').nodeId, child(toolsAfter, 'Shared').nodeId]);
            // The folder's id comes from its path in a .slnx without Id attributes
            expect(revealed[1]).not.toBe(shared.nodeId);
        } finally {
            slnx.dispose();
        }
    });
```

`src/test/unit/webview/solution-view/components/SolutionTreeSelect.test.tsx`, before the last `});`:
```tsx

    it('selects all nodes a drop moved, the first one focused', () => {
        Element.prototype.scrollIntoView = () => { };
        const tree: ProjectNode[] = [{
            ...projects[0],
            children: [{ ...projects[0].children![0], children: [
                { type: 'file', name: 'A.cs', nodeId: 'a' as NodeIdString },
                { type: 'file', name: 'B.cs', nodeId: 'b' as NodeIdString },
            ] }],
        }];
        const { container } = render(<SolutionTree projects={tree} onProjectAction={() => { }} />);

        act(() => {
            window.dispatchEvent(new MessageEvent('message', { data: { type: 'selectNode', payload: { nodeId: 'a', nodeIds: ['a', 'b'], focus: true } } }));
        });

        expect([...container.querySelectorAll('.tree-node.selected')].map(el => el.textContent)).toEqual(['A.cs', 'B.cs']);
        expect(container.querySelector('.tree-node.focused')?.textContent).toBe('A.cs');
    });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/test/unit/services/solutionExpansionService.reveal.test.ts src/test/unit/services/moveNodes.test.ts src/test/unit/webview/solution-view/components/SolutionTreeSelect.test.tsx`
Expected: FAIL: two suites do not compile (`Property 'revealDrop' does not exist on type 'typeof SolutionExpansionService'`), and 'selects all nodes a drop moved, the first one focused' fails (only `A.cs` selected).

- [ ] **Step 3: `DropResult` and `revealDrop` in `src/services/solutionExpansionService.ts`**

After `const log = logger('SolutionExpansionService');`:
```ts

/** Where a drop went and what it moved or copied, to show them once the tree is rebuilt */
export interface DropResult {
    /** The node the drop went into (for a file target the folder or project it is in) */
    readonly container: NodeIdString;
    /**
     * In drop order: the path of projects, files, folders and solution items, the name of solution folders (the ids
     * of solution folders and solution items change with their parent, so they are found again by these)
     */
    readonly nodes: readonly { readonly type: NodeType; readonly key: string }[];
}

/** The `DropResult` key of a tree node: its type with its name (solution folders) or path */
function dropKey(node: ProjectNode): string | undefined {
    try {
        const id = NodeIdService.parse(node.nodeId);
        return `${id.type}|${id.type === 'solutionFolder' ? id.name : id.path}`;
    } catch {
        return undefined;
    }
}
```
and in the class, before `/** Loads the children of a project or folder for revealing a file, … */` (`_loadChildren`):
```ts
    /**
     * After a drop, like Visual Studio: opens the node the drop went into (loading its children where needed) and
     * remembers it as expanded, then returns the ids of the moved nodes below it, in drop order. Empty when the tree
     * does not have that node or does not show the moved nodes (yet).
     * @param open false: only look for the moved nodes (the node was opened before, the user may have closed it since)
     */
    static async revealDrop(
        drop: DropResult,
        nodes: ProjectNode[],
        context: vscode.ExtensionContext,
        open = true,
        loadChildren: (node: ProjectNode) => Promise<ProjectNode[]> = node => this._loadChildren(node)
    ): Promise<NodeIdString[]> {
        const container = SolutionTreeService.findNodeById(drop.container, nodes);
        if (!container) {
            return [];
        }
        if (open) {
            if (!container.children?.length && (container.type === 'project' || container.type === 'folder')) {
                container.children = await loadChildren(container);
                container.hasChildren = container.children.length > 0;
            }
            container.expanded = true;
            const expanded = this.getExpansionState(context);
            expanded.add(container.nodeId);
            this.saveExpansionState(expanded, context);
        }

        // Below the container, nested files included (a moved Index.cshtml.cs shows under Index.cshtml)
        const below = new Map<string, NodeIdString>();
        const walk = (list: ProjectNode[] | undefined) => list?.forEach(node => {
            const key = dropKey(node);
            if (key && !below.has(key)) {
                below.set(key, node.nodeId);
            }
            walk(node.children);
        });
        walk(container.children);
        return drop.nodes.map(node => below.get(`${node.type}|${node.key}`)).filter((id): id is NodeIdString => !!id);
    }

```

- [ ] **Step 4: `moveNodes` returns the drop**

`src/services/solutionActionService.ts`: after the import of `./grpc/grpcReferenceService`:
```ts
import type { DropResult } from './solutionExpansionService';
```
Replace `moveNodes` (from its doc comment to its closing brace) with:
```ts
    /**
     * Drag & drop in the tree. Checks the drop again (the webview is not trusted: the rule nodes are made from the
     * solution, and an id it does not have refuses the drop), then moves or copies files and folders through the paste
     * path, with one namespace question for what was moved, and moves projects, solution folders and solution items in
     * the solution file. Returns where the drop went and what it moved or copied (undefined: nothing), so the tree
     * can open the target and select them.
     */
    static async moveNodes(nodeIdStrings: readonly NodeIdString[], targetNodeIdString: NodeIdString, copy: boolean): Promise<DropResult | undefined> {
        const solution = SolutionService.getActiveSolution();
        if (!solution) {
            return undefined;
        }
        const target = solutionDropNode(solution, targetNodeIdString);
        const dragged = nodeIdStrings.map(id => solutionDropNode(solution, id));
        const known = dragged.filter((node): node is DropNode => !!node);
        const verdict = target && known.length === dragged.length ? canDrop(known, target, copy) : undefined;
        if (!verdict?.container || verdict.nodes.length === 0) {
            log.info(`Drop of ${nodeIdStrings.length} node(s) refused`);
            vscode.window.showWarningMessage('The items cannot be dropped there.');
            return undefined;
        }
        const dropped: DropResult['nodes'][number][] = [];
        try {
            const container = NodeIdService.parse(verdict.container.nodeId);
            const files = verdict.nodes.filter(node => node.type === 'file' || node.type === 'folder');
            if (files.length > 0) {
                const directory = container.type === 'project' ? path.dirname(container.path) : container.path;
                const operation = verdict.effect === 'copy' ? 'copy' : 'cut';
                const moved: string[] = [];
                for (const node of files) {
                    const destination = await this._pasteOne(NodeIdService.parse(node.nodeId).path, directory, operation);
                    if (destination) {
                        dropped.push({ type: node.type, key: destination });
                    }
                    if (destination && operation === 'cut') {
                        moved.push(destination);
                    }
                }
                await updateNamespacesAfterMove(moved, 'Moved');
            }
            const targetFolderGuid = container.type === 'solutionFolder' ? container.guid : undefined;
            for (const node of verdict.nodes) {
                const id = NodeIdService.parse(node.nodeId);
                if (id.type === 'project') {
                    await solution.moveToSolutionFolder({ kind: 'project', projectPath: id.path }, targetFolderGuid);
                    dropped.push({ type: 'project', key: id.path });
                } else if (id.type === 'solutionFolder') {
                    await solution.moveToSolutionFolder({ kind: 'solutionFolder', folderGuid: id.guid }, targetFolderGuid);
                    dropped.push({ type: 'solutionFolder', key: id.name });
                } else if (id.type === 'solutionItem') {
                    await solution.moveToSolutionFolder({ kind: 'solutionItem', filePath: id.path, folderGuid: id.guid }, targetFolderGuid);
                    dropped.push({ type: 'solutionItem', key: id.path });
                }
            }
        } catch (error) {
            log.error('Drop failed:', error);
            vscode.window.showErrorMessage(`Could not move: ${error instanceof Error ? error.message : error}`);
        }
        // What went through before an error is shown too
        return dropped.length > 0 ? { container: verdict.container.nodeId, nodes: dropped } : undefined;
    }
```

- [ ] **Step 5: `selectNode` can select several nodes**

`src/types/commands/ui.ts`, `SelectNodeCmd` becomes:
```ts
/** Selects, focuses and scrolls to a tree node, e.g. after "Sync with Active Document" or a drop */
export declare type SelectNodeCmd = {
    readonly type: 'selectNode',
    readonly payload: {
        readonly nodeId: NodeIdString,
        /** All nodes to select, `nodeId` among them (the nodes a drop moved); without it only `nodeId` */
        readonly nodeIds?: readonly NodeIdString[],
        /** Move the keyboard focus to the tree; not when only following the active editor */
        readonly focus?: boolean,
    }
}
```
`src/webview/solution-view/components/SolutionTree.tsx`, in the message handler the `selectNode` branch's first line `setSelectedNodeId(message.payload.nodeId);` becomes:
```tsx
                setSelection(message.payload.nodeIds?.length ? [...message.payload.nodeIds] : [message.payload.nodeId]);
                setSelectionAnchor(message.payload.nodeId);
```
(the ids stay opaque: the webview only compares them.)

- [ ] **Step 6: The provider reveals the drop when it rebuilds the tree**

`src/webview/providers/SolutionWebviewProvider.ts`:
- The import of `SolutionExpansionService` becomes:
```ts
import { DropResult, SolutionExpansionService } from '../../services/solutionExpansionService';
```
- After `const log = logger('SolutionWebviewProvider');`:
```ts
/** How long after a drop the tree still looks for the moved nodes to select them (a moved file waits for MSBuild) */
const DROP_REVEAL_MS = 10000;
```
- After `private readonly _updateViewDebouncer: SimpleDebounceManager;`:
```ts
    /** A drop whose target opens and whose moved nodes are selected once the tree is rebuilt (and shows them) */
    private _dropToReveal?: { readonly drop: DropResult; readonly until: number; opened: boolean };
```
- In the debounced update (constructor), the lines from `await SolutionExpansionService.restoreExpansionStates(solutionData, this._context);` to `this._cachedSolutionData = solutionData;` become:
```ts
                await SolutionExpansionService.restoreExpansionStates(solutionData, this._context);
                const dropped = await this._revealDrop(solutionData);
                await this._sendSolutionData(solutionData);

                this._cachedSolutionData = solutionData;
                if (dropped.length > 0) {
                    sendToUi(this.webview, { type: 'selectNode', payload: { nodeId: dropped[0], nodeIds: dropped, focus: false } });
                }
```
- In `case 'moveNodes':` the line `await SolutionActionService.moveNodes(nodeIds, targetNodeId, copy === true);` becomes:
```ts
                const drop = await SolutionActionService.moveNodes(nodeIds, targetNodeId, copy === true);
                if (drop) {
                    this._dropToReveal = { drop, until: Date.now() + DROP_REVEAL_MS, opened: false };
                }
```
(the refresh calls after it stay: they trigger the rebuild that reveals.)
- Before the doc comment of `_triggerImmediateTreeRefresh`:
```ts
    /**
     * After a drop, like Visual Studio: the node it went into opens (once) and the moved nodes get selected. A moved
     * file shows only once MSBuild evaluated its project again, so later rebuilds look for them, for a while.
     */
    private async _revealDrop(tree: ProjectNode[]): Promise<NodeIdString[]> {
        const pending = this._dropToReveal;
        if (!pending) {
            return [];
        }
        if (Date.now() > pending.until) {
            this._dropToReveal = undefined;
            return [];
        }
        const revealed = await SolutionExpansionService.revealDrop(pending.drop, tree, this._context, !pending.opened);
        pending.opened = true;
        if (revealed.length > 0) {
            this._dropToReveal = undefined;
        }
        return revealed;
    }

```
`focus: false`: the selection does not take the keyboard focus from the editor the namespace question may have opened (the tree had it for the drop anyway).

- [ ] **Step 7: Run to verify it passes**

Run: `npx jest src/test/unit/services/solutionExpansionService.reveal.test.ts src/test/unit/services/moveNodes.test.ts src/test/unit/webview/solution-view`
Expected: PASS

- [ ] **Step 8: Docs and the GIF**

`docs/solution-explorer.md`, the first paragraph of "## Drag and drop" becomes:
```markdown
Drag nodes to move them, as in Visual Studio. The row a drop would go into is highlighted; where a drop is not possible the pointer says so. Hovering a collapsed folder or solution folder for a moment opens it. After the drop the node it went into is open and the moved nodes are selected, so they stay in sight (a moved file is selected once its project has been evaluated again, a moment later).
```

`docs/manual-testing.md`, append unticked:
```markdown
- [ ] Drag & drop opens the target (copy of BasicsTestProject, a `.sln`, and the screenshot sample, a `.slnx`): a project, and a solution folder with projects, dropped onto a collapsed solution folder: the folder opens and the moved node is selected; two projects at once: both selected; a file dropped onto a collapsed folder: the folder opens and the file is selected a moment later (after the namespace question, if any); collapsing the target right after the drop keeps it collapsed
```

The GIF scene opened `tools` by hand after the drop (click + Right), which would now close it again. `scripts/screenshots/capture.sh`, scene `gif-drag-and-drop`, the lines
```bash
    # Pricing is open now: 8 Discounts, 9 Coupon.cs, 10 PriceCalculator.cs, 11 Shop.Generators, ..., 15 tools.
    # Shop.Generators onto the tools solution folder, which is opened afterwards to show it
    drag 70 "$(row_y 11)" 330 "$(row_y 15)"; pause 2
    click 200 "$(row_y 14)"; key Right; pause 2
```
become
```bash
    # Pricing is open now, Coupon.cs selected: 8 Discounts, 9 Coupon.cs, 10 PriceCalculator.cs, 11 Shop.Generators, ...,
    # 15 tools. Shop.Generators onto the collapsed tools solution folder, which opens with it selected
    drag 70 "$(row_y 11)" 330 "$(row_y 15)"; pause 3
```
Re-capture the GIF (VS Code in its own Xvfb, never on the desktop; see CLAUDE.md "Running VS Code or Electron"):
```bash
npm run build:dev
env -u WAYLAND_DISPLAY SCENES="gif-drag-and-drop" scripts/screenshots/capture.sh
```
Expected: `docs/images/drag-and-drop.gif (… KB)`; its last frames show `tools` open with Shop.Generators selected, and Coupon.cs selected under Pricing after the namespace question (checked while planning with `CODE=code`, 140 frames, about 208 KB).

- [ ] **Step 9: Verify and commit**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git add src/services/solutionExpansionService.ts src/services/solutionActionService.ts src/types/commands/ui.ts src/webview/providers/SolutionWebviewProvider.ts src/webview/solution-view/components/SolutionTree.tsx scripts/screenshots/capture.sh src/test/unit/services/solutionExpansionService.reveal.test.ts src/test/unit/services/moveNodes.test.ts src/test/unit/webview/solution-view/components/SolutionTreeSelect.test.tsx docs/solution-explorer.md docs/manual-testing.md docs/images/drag-and-drop.gif
git commit -m "Drag & drop: the target opens and the moved nodes are selected

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: exit 0 (Jest: 13 tests more than before Task 6, with both tasks).

---

### Task 8: Central packages: one evaluation per project after a NuGet manager edit

**Files:**
- Create: `src/services/ownWrites.ts`
- Modify: `src/services/nuget/centralPackageFiles.ts`, `src/services/nuget/centralPackageWatchers.ts`, `src/extension.ts`, `src/core/Project.ts`
- Test: `src/test/unit/services/ownWrites.test.ts` (create), `src/test/unit/services/nuget/centralPackageWatch.test.ts`, `src/test/unit/core/Project.items.test.ts`

**Measurement (done while planning):** a real VS Code 1.136 (downloaded by `@vscode/test-electron`, own `--user-data-dir`/`--extensions-dir` under `/tmp`) ran the scratch extension on a copy of `src/__fixtures__/central-packages/cpm`. The scratch build logged every `runMsbuild` start and the restore, and had a throw-away command calling `changePackageVersions` exactly as the NuGet manager's install/update does (solution context, all projects using the package selected, so no confirmation). Result for **Serilog 3.1.1 → 4.0.0** (edits `Directory.Packages.props`):
```
+0 ms     restore start Central.slnx
+81 ms    msbuild App, GlobalOnly, Legacy, OptOut, Override     <- props watcher (extension.ts) -> reevaluateAllProjects
+1249 ms  restore end
+1250 ms  msbuild App, GlobalOnly, OptOut, Override             <- afterEdits -> host.reevaluate (the affected projects)
```
9 MSBuild runs instead of 5: every project that uses the props file was evaluated twice (Legacy, CPM off, once). A `VersionOverride` edit in `Override.csproj` gave the same pattern through the project file watcher: `msbuild Override` at +80 ms (the `_evaluatedProjectFile` guard is only set when the explicit re-evaluation starts, after the restore) and again after the restore: 2 runs instead of 1. So the double evaluation is real; it is not a missing debounce among the watchers (they were already one run per project), it is the watchers reacting to the extension's own write while the restore runs.

- [ ] **Step 1: Write the failing tests**

`src/test/unit/services/ownWrites.test.ts`:
```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OwnWrites } from '../../../services/ownWrites';
import { applyPackageEdits } from '../../../services/nuget/centralPackageFiles';

describe('OwnWrites', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'own-writes-')); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    test('a file is ours while it is as we wrote it; a later edit or a deletion is not', () => {
        const file = path.join(dir, 'Directory.Packages.props');
        fs.writeFileSync(file, '<Project />');
        expect(OwnWrites.isOwn(file)).toBe(false);
        OwnWrites.record(file);
        expect(OwnWrites.isOwn(file)).toBe(true);
        fs.writeFileSync(file, '<Project>\n</Project>\n');
        expect(OwnWrites.isOwn(file)).toBe(false);
        OwnWrites.record(file);
        // same size, another time
        fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
        expect(OwnWrites.isOwn(file)).toBe(false);
        OwnWrites.record(file);
        fs.rmSync(file);
        expect(OwnWrites.isOwn(file)).toBe(false);
    });

    test('the package edits record the files they write', async () => {
        const file = path.join(dir, 'Directory.Packages.props');
        fs.writeFileSync(file, '<Project>\n  <ItemGroup>\n    <PackageVersion Include="Serilog" Version="3.1.1" />\n  </ItemGroup>\n</Project>\n');
        expect(await applyPackageEdits([{ kind: 'setPackageVersion', file, id: 'Serilog', version: '4.0.0' }])).toEqual([file]);
        expect(OwnWrites.isOwn(file)).toBe(true);
    });
});
```

`src/test/unit/services/nuget/centralPackageWatch.test.ts`: add the import after the `parseMsbuildPackages` import:
```ts
import { applyPackageEdits } from '../../../../services/nuget/centralPackageFiles';
```
and replace the test "a change seen by a watcher evaluates the projects again" (the watcher callbacks now get the `Uri`) with these three tests:
```ts
    test('a change seen by a watcher evaluates the projects again', () => {
        const reevaluate = jest.fn().mockResolvedValue(undefined);
        const watchers = new CentralPackageWatchers(reevaluate);
        const versions = path.join(dir, 'build', 'Versions.props');
        evaluated(versions);
        const created = createdWatchers().results[0].value;
        for (const event of [created.onDidChange, created.onDidCreate, created.onDidDelete]) {
            event.mock.calls[0][0]({ fsPath: versions });
        }
        expect(reevaluate).toHaveBeenCalledTimes(3);
        watchers.dispose();
    });

    const writeVersions = (file: string) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '<Project>\n  <ItemGroup>\n    <PackageVersion Include="Serilog" Version="3.1.1" />\n  </ItemGroup>\n</Project>\n');
    };

    test('the watcher event of a file the NuGet manager wrote does not evaluate (the manager does, after the restore); a later edit does', async () => {
        const versions = path.join(dir, 'build', 'Versions.props');
        writeVersions(versions);
        const reevaluate = jest.fn().mockResolvedValue(undefined);
        const watchers = new CentralPackageWatchers(reevaluate);
        evaluated(versions);
        const onDidChange = createdWatchers().results[0].value.onDidChange.mock.calls[0][0];
        await applyPackageEdits([{ kind: 'setPackageVersion', file: versions, id: 'Serilog', version: '4.0.0' }]);
        onDidChange({ fsPath: versions });
        expect(reevaluate).not.toHaveBeenCalled();
        fs.writeFileSync(versions, fs.readFileSync(versions, 'utf8').replace('4.0.0', '4.10.0'));
        onDidChange({ fsPath: versions });
        expect(reevaluate).toHaveBeenCalledTimes(1);
        watchers.dispose();
    });

    test('recheck leaves out a props file outside the workspace that the NuGet manager wrote', async () => {
        const file = path.join(outside, 'Company.Packages.props');
        writeVersions(file);
        const reevaluate = jest.fn().mockResolvedValue(undefined);
        const watchers = new CentralPackageWatchers(reevaluate);
        evaluated(file);
        await applyPackageEdits([{ kind: 'setPackageVersion', file, id: 'Serilog', version: '4.0.0' }]);
        await watchers.recheck();
        expect(reevaluate).not.toHaveBeenCalled();
        watchers.dispose();
    });
```
(The later edit changes the size, `4.0.0` → `4.10.0`, so the test does not depend on the file system's time resolution.)

`src/test/unit/core/Project.items.test.ts`: add the import after the `ShowAllFiles` import:
```ts
import { OwnWrites } from '../../../services/ownWrites';
```
and append after the test "the watcher event of a project file edit already evaluated (Include, Exclude) does not evaluate again":
```ts
    test('the watcher event of a package edit of the NuGet manager does not evaluate (the manager does, after the restore)', async () => {
        const project = await newProject();
        const invalidate = jest.spyOn(ProjectItemsService.instance, 'invalidate');
        const changed = (project as unknown as { handleFileChanged(uri: { fsPath: string }): Promise<void> });
        fs.writeFileSync(projectPath, '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Serilog" VersionOverride="4.0.0" /></ItemGroup></Project>');
        OwnWrites.record(projectPath);
        await changed.handleFileChanged({ fsPath: projectPath });
        expect(invalidate).not.toHaveBeenCalled();
        fs.writeFileSync(projectPath, '<Project Sdk="Microsoft.NET.Sdk"></Project>');
        await changed.handleFileChanged({ fsPath: projectPath });
        expect(invalidate).toHaveBeenCalledTimes(1);
    });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/test/unit/services/ownWrites.test.ts src/test/unit/services/nuget/centralPackageWatch.test.ts src/test/unit/core/Project.items.test.ts`
Expected: FAIL: `ownWrites.test.ts` and `Project.items.test.ts` with `Cannot find module '../../../services/ownWrites'`; in `centralPackageWatch.test.ts` the two new tests fail (`reevaluate` was called).

- [ ] **Step 3: Implement `src/services/ownWrites.ts`**

```ts
import * as path from 'path';
import { pathKey } from './projectItems/projectItems';
import { Stamp, stampOf } from './nuget/centralPackageWatch';

/** Each file the extension wrote, with its stamp right after the write */
const written = new Map<string, Stamp>();
const keyOf = (file: string) => pathKey(path.normalize(file));

/**
 * Files the extension wrote itself. The code that writes them evaluates the projects once it is done (the NuGet
 * manager after its restore), so a file watcher that sees that same version must not start another evaluation;
 * a later edit (another `mtime|size`) is not ours any more.
 */
export const OwnWrites = {
    /** Call right after writing the file */
    record(file: string): void {
        written.set(keyOf(file), stampOf(file));
    },
    /** Whether the file is still as the extension wrote it */
    isOwn(file: string): boolean {
        const recorded = written.get(keyOf(file));
        return recorded !== undefined && recorded === stampOf(file);
    },
};
```

- [ ] **Step 4: Record the writes, skip them in the watchers**

`src/services/nuget/centralPackageFiles.ts`: after `import { CentralEntry } from './centralPackages';` add
```ts
import { OwnWrites } from '../ownWrites';
```
and in `applyPackageEdits` replace
```ts
            await fs.promises.writeFile(result.file, result.edited, 'utf8');
            written.push(result);
```
with
```ts
            await fs.promises.writeFile(result.file, result.edited, 'utf8');
            // The caller evaluates the projects after its restore: the watchers leave this version alone
            OwnWrites.record(result.file);
            written.push(result);
```
(A rollback after a failed write writes the old content again: another stamp, so the watchers evaluate as before.)

`src/services/nuget/centralPackageWatchers.ts`: after `import { Stamp, changedFiles, watchPlan } from './centralPackageWatch';` add
```ts
import { OwnWrites } from '../ownWrites';
```
replace
```ts
            const changed = () => { void this.reevaluate(); };
```
with
```ts
            const changed = (uri: vscode.Uri) => {
                // An edit of the NuGet manager: it evaluates the projects itself, after the restore
                if (!OwnWrites.isOwn(uri.fsPath)) {
                    void this.reevaluate();
                }
            };
```
and in `recheck` replace
```ts
        if (changedFiles(this.plan().outside, this.stamps).length > 0) {
```
with
```ts
        if (changedFiles(this.plan().outside, this.stamps).some(file => !OwnWrites.isOwn(file))) {
```

`src/extension.ts`: after `import { CentralPackageWatchers } from './services/nuget/centralPackageWatchers';` add
```ts
import { OwnWrites } from './services/ownWrites';
```
and replace
```ts
    const handleBuildPropsChange = async (uri: vscode.Uri) => {
        if (isExcluded(uri.fsPath, rootOf(uri.fsPath))) {
```
with
```ts
    const handleBuildPropsChange = async (uri: vscode.Uri) => {
        // A version the NuGet manager wrote: it evaluates the projects itself, after the restore
        if (isExcluded(uri.fsPath, rootOf(uri.fsPath)) || OwnWrites.isOwn(uri.fsPath)) {
```

`src/core/Project.ts`: after `import { PackageVersionSource } from '../services/nuget/types';` add
```ts
import { OwnWrites } from '../services/ownWrites';
```
and replace
```ts
    /**
     * A watcher saw the project file change. When it is the version an evaluation was already asked for (an edit
     * of ours like Include or Exclude, or a second watcher of the same folder), that evaluation reads it: no new one.
     */
    private async reevaluateItemsIfProjectFileChanged(): Promise<void> {
        const stamp = this.projectFileStamp();
        if (stamp !== undefined && stamp === this._evaluatedProjectFile) {
```
with
```ts
    /**
     * A watcher saw the project file change. When it is the version an evaluation was already asked for (an edit
     * of ours like Include or Exclude, or a second watcher of the same folder), that evaluation reads it: no new one.
     * The same for a package edit of the NuGet manager, which evaluates the project itself after its restore.
     */
    private async reevaluateItemsIfProjectFileChanged(): Promise<void> {
        const stamp = this.projectFileStamp();
        if (stamp !== undefined && (stamp === this._evaluatedProjectFile || OwnWrites.isOwn(this._projectPath))) {
```
(The project file is still parsed and the tree told about the change; only the second MSBuild run is skipped.)

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest src/test/unit/services/ownWrites.test.ts src/test/unit/services/nuget/centralPackageWatch.test.ts src/test/unit/core/Project.items.test.ts`
Expected: PASS (3 suites, 34 tests).

- [ ] **Step 6: Docs**

No docs page: nothing a user sees changes except fewer `dotnet msbuild` processes after an edit in the NuGet manager. `docs/manual-testing.md`, append unticked:
```markdown
- [ ] Central packages, one evaluation per edit (copy of `src/__fixtures__/central-packages/cpm`, `dotnet.logLevel` on debug or watching `ps`/Task Manager for `dotnet msbuild`): updating Serilog in the solution's NuGet manager starts one `dotnet msbuild` per project that uses `Directory.Packages.props`, after the restore, not a second round during it; editing `Directory.Packages.props` by hand afterwards still updates the tree
```

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git add src/services/ownWrites.ts src/services/nuget/centralPackageFiles.ts src/services/nuget/centralPackageWatchers.ts src/extension.ts src/core/Project.ts src/test/unit/services/ownWrites.test.ts src/test/unit/services/nuget/centralPackageWatch.test.ts src/test/unit/core/Project.items.test.ts docs/manual-testing.md
git commit -m "Central packages: the watchers leave the NuGet manager's own writes alone, one evaluation per edit

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: exit 0.

---

### Task 9: The Test Explorer uses the project's run settings file (`RunSettingsFilePath`)

**Files:**
- Create: `src/services/testing/runSettings.ts`
- Modify: `src/services/testing/testProjects.ts`, `src/services/testing/vstestClient.ts`, `src/services/testing/testExplorer.ts`
- Test: `src/test/unit/services/testing/runSettings.test.ts` (create), `src/test/unit/services/testing/runSettings.dotnet.test.ts` (create), `src/test/unit/services/testing/testProjects.test.ts`, `src/test/unit/services/testing/vstestClient.test.ts`, `src/test/unit/services/testing/testExplorer.test.ts` (extend)
- Docs: `docs/tests.md`, `docs/manual-testing.md`

**Repro (done while planning, SDK 10.0.111):** scratch solution `/tmp/rs2` with two NUnit VSTest projects `A` and `B` (`Microsoft.NET.Test.Sdk` 18.0.1, NUnit 4.3.2, NUnit3TestAdapter 5.0.0), each with `RunSettingsFilePath` pointing to `../team.runsettings` (`MaxCpuCount` 0, `BatchSize` 2, `EnvironmentVariables/TEAM_VAR=yes`, `TestRunParameters` `Env=team`, a coverage data collector) and tests `Param` (reads `TestContext.Parameters["Env"]`), `Variable` (reads `TEAM_VAR`) and `Slow` (sleeps 3 s). `dotnet test A` passes all three. The real `connectVsTest` against the SDK's `vstest.console.dll`, driven from a scratch Jest test with both assemblies in one session: today's fixed settings give `Param:failed Variable:failed` in both projects, 6.9 s. With the settings this task sends (`vstestRunSettings` of the file): all pass; `MaxCpuCount` 1 takes 7.1 s, `MaxCpuCount` 0 takes 3.7 s (the two assemblies in parallel). Through the Test Explorer itself (one session per project) `MaxCpuCount` can't matter: hence the grouping. Microsoft.Testing.Platform, an MSTest runner project `MR` (MSTest 4.0.1) with the same tests, started in server mode by the real `connectTestApp`: without `--settings` both fail; with `--settings` and a file holding only `TestRunParameters`, `MaxCpuCount` and an `MSTest/Parallelize` section, `Param` passes and the app logs `Runsettings attribute 'MaxCpuCount' is not supported by Microsoft.Testing.Platform and will be ignored` and `Test Parallelization enabled ... (Workers: 2, Scope: MethodLevel)`; with `EnvironmentVariables` in the file it crashes as described under Decisions. An xUnit v3 app (3.2.2) in server mode with `--settings` prints `Unknown option '--settings'` and never connects. The new real-dotnet test of Step 1 fails on the unchanged code with `failed Param`, `failed Variable` in all three projects and passes after Step 6.

- [ ] **Step 1: Write the failing tests**

`src/test/unit/services/testing/runSettings.test.ts`:
```ts
import { DEFAULT_RUN_SETTINGS, testingPlatformRunSettings, vstestRunSettings } from '../../../../services/testing/runSettings';

const team = `<?xml version="1.0" encoding="utf-8"?>
<!-- the team's settings -->
<RunSettings>
  <RunConfiguration>
    <MaxCpuCount>0</MaxCpuCount>
    <BatchSize>10</BatchSize>
    <DesignMode>false</DesignMode>
    <EnvironmentVariables>
      <TEAM_VAR>yes</TEAM_VAR>
      <CONNECTION>a=1&amp;b=2</CONNECTION>
    </EnvironmentVariables>
  </RunConfiguration>
  <TestRunParameters>
    <Parameter name="Env" value="team" />
  </TestRunParameters>
  <DataCollectionRunSettings>
    <DataCollectors>
      <DataCollector friendlyName="XPlat Code Coverage" />
    </DataCollectors>
  </DataCollectionRunSettings>
  <LoggerRunSettings><Loggers><Logger friendlyName="trx" /></Loggers></LoggerRunSettings>
  <MSTest><Parallelize><Workers>2</Workers></Parallelize></MSTest>
</RunSettings>
`;

const squash = (xml: string) => xml.replace(/>\s+</g, '><').trim();

describe('run settings for VSTest', () => {
    test('keeps RunConfiguration, TestRunParameters and adapter sections; leaves out data collectors and loggers; DesignMode is ours', () => {
        expect(squash(vstestRunSettings(team)!)).toBe(squash(`<RunSettings>
  <RunConfiguration><DesignMode>true</DesignMode>
    <MaxCpuCount>0</MaxCpuCount>
    <BatchSize>10</BatchSize>
    <EnvironmentVariables>
      <TEAM_VAR>yes</TEAM_VAR>
      <CONNECTION>a=1&amp;b=2</CONNECTION>
    </EnvironmentVariables>
  </RunConfiguration>
  <TestRunParameters>
    <Parameter name="Env" value="team" />
  </TestRunParameters>
  <MSTest><Parallelize><Workers>2</Workers></Parallelize></MSTest>
</RunSettings>`));
    });

    test('adds RunConfiguration when the file has none, or only an empty one', () => {
        expect(vstestRunSettings('<RunSettings><TestRunParameters /></RunSettings>'))
            .toBe('<RunSettings><RunConfiguration><DesignMode>true</DesignMode></RunConfiguration><TestRunParameters /></RunSettings>');
        expect(vstestRunSettings('<RunSettings><RunConfiguration /></RunSettings>'))
            .toBe('<RunSettings><RunConfiguration><DesignMode>true</DesignMode></RunConfiguration></RunSettings>');
        expect(vstestRunSettings('\uFEFF<RunSettings></RunSettings>')).toBe(DEFAULT_RUN_SETTINGS);
    });

    test('elements in comments are not settings', () => {
        expect(vstestRunSettings('<RunSettings><!-- <RunConfiguration><MaxCpuCount>4</MaxCpuCount></RunConfiguration> --></RunSettings>')).toBe(DEFAULT_RUN_SETTINGS);
    });

    test('refuses what is not a RunSettings document', () => {
        expect(vstestRunSettings('')).toBeUndefined();
        expect(vstestRunSettings('<Project><PropertyGroup /></Project>')).toBeUndefined();
        expect(vstestRunSettings('<RunSettings><RunConfiguration>')).toBeUndefined();
    });
});

describe('run settings for Microsoft.Testing.Platform apps', () => {
    test('the environment variables go to the process, the rest to --settings, without DesignMode, collectors and loggers', () => {
        const settings = testingPlatformRunSettings(team)!;
        expect(settings.environment).toEqual({ TEAM_VAR: 'yes', CONNECTION: 'a=1&b=2' });
        expect(squash(settings.settings)).toBe(squash(`<RunSettings>
  <RunConfiguration>
    <MaxCpuCount>0</MaxCpuCount>
    <BatchSize>10</BatchSize>
  </RunConfiguration>
  <TestRunParameters>
    <Parameter name="Env" value="team" />
  </TestRunParameters>
  <MSTest><Parallelize><Workers>2</Workers></Parallelize></MSTest>
</RunSettings>`));
    });

    test('no environment variables, no RunSettings document', () => {
        expect(testingPlatformRunSettings('<RunSettings><TestRunParameters /></RunSettings>')!.environment).toEqual({});
        expect(testingPlatformRunSettings('<Project />')).toBeUndefined();
    });
});
```

`src/test/unit/services/testing/testProjects.test.ts`: change the import line to
```ts
import * as path from 'path';
import { isTestProjectCandidate, parseTestProperties, testProjectFrom } from '../../../../services/testing/testProjects';
```
and add inside the `describe`, after the last `it`:
```ts
    it('reads the run settings file, relative to the project folder when MSBuild gives a relative path', () => {
        const projectPath = path.resolve('repo', 'tests', 'A', 'A.csproj');
        const json = (runSettings: string) => JSON.stringify({ Properties: { IsTestingPlatformApplication: 'false', TargetPath: path.resolve('repo', 'A.dll'), RunSettingsFilePath: runSettings } });
        expect(testProjectFrom(projectPath, json(path.join(path.dirname(projectPath), '..', 'team.runsettings')))?.runSettingsPath)
            .toBe(path.resolve('repo', 'tests', 'team.runsettings'));
        expect(testProjectFrom(projectPath, json('local.runsettings'))?.runSettingsPath).toBe(path.resolve('repo', 'tests', 'A', 'local.runsettings'));
        expect(testProjectFrom(projectPath, json(''))).not.toHaveProperty('runSettingsPath');
        expect(testProjectFrom(projectPath, 'error MSB1009')).toBeUndefined();
    });
```

`src/test/unit/services/testing/vstestClient.test.ts`: after the `testTree` import add
```ts
import { DEFAULT_RUN_SETTINGS } from '../../../../services/testing/runSettings';
```
and add inside the `describe`, after the last `it`:
```ts
    it('sends the given run settings for discovery and runs, the default ones otherwise', async () => {
        const settings = '<RunSettings><RunConfiguration><DesignMode>true</DesignMode><MaxCpuCount>0</MaxCpuCount></RunConfiguration></RunSettings>';
        const sent: any[] = [];
        const session = await connectVsTest(replay('NUnitTests-discover', sent));
        await session.discover(['/repo/x.dll'], settings);
        await session.discover(['/repo/x.dll']);
        await session.close();
        expect(sent.filter(m => m.MessageType === 'TestDiscovery.Start').map(m => m.Payload.RunSettings)).toEqual([settings, DEFAULT_RUN_SETTINGS]);

        const ran: any[] = [];
        const running = await connectVsTest(replay('NUnitTests-run', ran));
        await running.run({ sources: ['/repo/a.dll', '/repo/b.dll'], runSettings: settings }, () => { });
        await running.close();
        const request = ran.find(m => m.MessageType === 'TestExecution.RunAllWithDefaultHost');
        expect(request.Payload).toEqual({ Sources: ['/repo/a.dll', '/repo/b.dll'], RunSettings: settings });
    });
```

`src/test/unit/services/testing/testExplorer.test.ts`: after `import { replay as replayVsTest } from './vstestReplay';` add
```ts
import { DEFAULT_RUN_SETTINGS } from '../../../../services/testing/runSettings';
```
Insert this block right before `    describe('running the tests of a Solution Explorer node', () => {`:
```ts
    describe('run settings (RunSettingsFilePath)', () => {
        const team = '<RunSettings><RunConfiguration><MaxCpuCount>0</MaxCpuCount><EnvironmentVariables><TEAM_VAR>yes</TEAM_VAR></EnvironmentVariables></RunConfiguration>'
            + '<TestRunParameters><Parameter name="Env" value="team" /></TestRunParameters><DataCollectionRunSettings><DataCollectors /></DataCollectionRunSettings></RunSettings>';
        const withSettings = async (p: string) => ({ projectPath: p, targetPath: '/repo/X3/bin/Debug/net10.0/X3.dll', testingPlatform: true, runSettingsPath: '/repo/team.runsettings' });
        const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => { } }) };

        it('gives a Microsoft.Testing.Platform app with the VSTest bridge the settings (--settings) and their environment variables', async () => {
            const starts: { args: string[]; environment: Record<string, string> }[] = [];
            const written: string[] = [];
            const tests = explorer({
                evaluate: withSettings,
                hasVsTestBridge: () => true,
                readRunSettings: (file: string) => file === '/repo/team.runsettings' ? team : undefined,
                writeRunSettings: (content: string) => { written.push(content); return '/tmp/shinobi-1.runsettings'; },
                start: async (_project: unknown, args: string[], _debug: boolean, environment: Record<string, string>) => { starts.push({ args, environment }); return replayApp(args); },
            });
            await tests.refresh(false);
            const [run] = mock.controller.profiles;
            await run.handler({ include: undefined, exclude: [] }, token);

            expect(starts).toHaveLength(2);
            for (const start of starts) {
                expect(start.args.slice(-2)).toEqual(['--settings', '/tmp/shinobi-1.runsettings']);
                expect(start.environment).toEqual({ TEAM_VAR: 'yes' });
            }
            expect(written[0]).toContain('<Parameter name="Env" value="team" />');
            expect(written[0]).not.toContain('EnvironmentVariables');
            expect(written[0]).not.toContain('DataCollectionRunSettings');
            expect(mock.runs[0].events).toContain('passed Adds');
        });

        it('starts apps without the VSTest bridge (xUnit v3, TUnit: they refuse --settings) as before', async () => {
            const starts: { args: string[]; environment: Record<string, string> }[] = [];
            const tests = explorer({
                evaluate: withSettings,
                hasVsTestBridge: () => false,
                readRunSettings: () => team,
                start: async (_project: unknown, args: string[], _debug: boolean, environment: Record<string, string>) => { starts.push({ args, environment }); return replayApp(args); },
            });
            await tests.refresh(false);
            expect(starts).toHaveLength(1);
            expect(starts[0].args).not.toContain('--settings');
            expect(starts[0].environment).toEqual({});
        });
    });
```
and this block inside `describe('classic VSTest projects ...')`, after its last `it` (`'debugs them by attaching the debugger to the test host VSTest starts'`), before the `    });` that closes that `describe`:
```ts
        describe('run settings', () => {
            const team = '<RunSettings><RunConfiguration><MaxCpuCount>0</MaxCpuCount></RunConfiguration><DataCollectionRunSettings><DataCollectors /></DataCollectionRunSettings></RunSettings>';
            const evaluate = (settingsOf: (p: string) => string | undefined) => async (p: string) => ({
                projectPath: p,
                targetPath: p.replace(/[^/]+\.csproj$/, `bin/Debug/net10.0/${path.basename(p, '.csproj')}.dll`),
                testingPlatform: false,
                vstestConsolePath: '/sdk/vstest.console.dll',
                ...(settingsOf(p) ? { runSettingsPath: settingsOf(p) } : {}),
            });

            it('discovers with the project\'s run settings, and runs projects sharing them in one vstest.console session', async () => {
                const discoverySent: any[] = [];
                const tests = vstestExplorer('XUnit2Tests-discover', {
                    evaluate: evaluate(() => '/repo/team.runsettings'),
                    readRunSettings: () => team,
                    startVsTest: async (project: any, port: number) => replayVsTest(project.projectPath === nunit ? 'NUnitTests-discover' : 'XUnit2Tests-discover', discoverySent)(port),
                });
                await tests.refresh(false);
                const discovery = discoverySent.filter(m => m.MessageType === 'TestDiscovery.Start');
                expect(discovery).toHaveLength(2);
                expect(discovery[0].Payload.RunSettings).toBe('<RunSettings><RunConfiguration><DesignMode>true</DesignMode><MaxCpuCount>0</MaxCpuCount></RunConfiguration></RunSettings>');

                const sent: any[] = [];
                let sessions = 0;
                (tests as any).deps.startVsTest = async (_project: any, port: number) => { sessions++; return replayVsTest('XUnit2Tests-run', sent)(port); };
                const [run] = mock.controller.profiles;
                await run.handler({ include: undefined, exclude: [] }, token);

                expect(sessions).toBe(1);
                const request = sent.find(m => m.MessageType === 'TestExecution.RunAllWithDefaultHost');
                expect(request.Payload.Sources).toEqual([
                    '/repo/tests/Shop.Core.XUnit2Tests/bin/Debug/net10.0/Shop.Core.XUnit2Tests.dll',
                    '/repo/tests/Shop.Core.NUnitTests/bin/Debug/net10.0/Shop.Core.NUnitTests.dll',
                ]);
                expect(request.Payload.RunSettings).toContain('<MaxCpuCount>0</MaxCpuCount>');
                expect(request.Payload.RunSettings).not.toContain('DataCollectionRunSettings');
                expect(mock.runs[0].events).toEqual(expect.arrayContaining(['passed NoDiscountBelowTen', 'failed FailsOnPurpose']));
            });

            it('one project runs selected tests: the whole group goes as test cases', async () => {
                const tests = vstestExplorer('XUnit2Tests-discover', { evaluate: evaluate(() => '/repo/team.runsettings'), readRunSettings: () => team });
                await tests.refresh(false);
                const sent: any[] = [];
                (tests as any).deps.startVsTest = async (_project: any, port: number) => replayVsTest('NUnitTests-run', sent)(port);
                const orderTests = mock.controller.items.get(nunit).children.get('namespace:Shop.Core.NUnitTests.Orders').children.get('class:Shop.Core.NUnitTests.Orders.OrderTests');
                const [run] = mock.controller.profiles;

                await run.handler({ include: [mock.controller.items.get(xunit2), orderTests.children.get('6c9c8c82-38ae-7f87-8c24-0a264044ae98')], exclude: [] }, token);

                const request = sent.find(m => m.MessageType === 'TestExecution.RunAllWithDefaultHost');
                expect(request.Payload.Sources).toBeUndefined();
                // all four xUnit cases, and the one NUnit test
                expect(request.Payload.TestCases.map((test: any) => test.Source.replace(/^.*\//, ''))).toEqual([
                    'Shop.Core.XUnit2Tests.dll', 'Shop.Core.XUnit2Tests.dll', 'Shop.Core.XUnit2Tests.dll', 'Shop.Core.XUnit2Tests.dll', 'Shop.Core.NUnitTests.dll',
                ]);
                expect(request.Payload.TestCases[4].DisplayName).toBe('FailsOnPurpose');
            });

            it('projects with different run settings get their own sessions; an unreadable file runs with the default settings', async () => {
                const tests = vstestExplorer('XUnit2Tests-discover', {
                    evaluate: evaluate(p => p === nunit ? '/repo/missing.runsettings' : undefined),
                    readRunSettings: () => undefined,
                });
                await tests.refresh(false);
                const sent: any[] = [];
                let sessions = 0;
                (tests as any).deps.startVsTest = async (_project: any, port: number) => { sessions++; return replayVsTest('XUnit2Tests-run', sent)(port); };
                const [run] = mock.controller.profiles;
                await run.handler({ include: undefined, exclude: [] }, token);

                expect(sessions).toBe(2);
                expect(sent.filter(m => m.MessageType === 'TestExecution.RunAllWithDefaultHost').map(m => m.Payload.RunSettings))
                    .toEqual([DEFAULT_RUN_SETTINGS, DEFAULT_RUN_SETTINGS]);
            });
        });
```

`src/test/unit/services/testing/runSettings.dotnet.test.ts` (the `vscode` mock is the one of `testExplorer.dotnet.test.ts`, copied unchanged):
```ts
// Run settings with real dotnet: a team's .runsettings (RunSettingsFilePath in Directory.Build.props) reaches NUnit
// tests through VSTest and MSTest runner tests through Microsoft.Testing.Platform's VSTest bridge
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

jest.mock('vscode', () => {
    class Collection {
        private readonly map = new Map<string, any>();
        constructor(private readonly owner?: any) { }
        add(item: any) { item.parent = this.owner; this.map.set(item.id, item); }
        delete(id: string) { this.map.delete(id); }
        get(id: string) { return this.map.get(id); }
        replace(items: any[]) { this.map.clear(); items.forEach(item => this.add(item)); }
        forEach(callback: (item: any) => void) { [...this.map.values()].forEach(callback); }
        get size() { return this.map.size; }
    }
    class TestMessage {
        location: unknown;
        constructor(public message: string) { }
        static diff(message: string, expected: string, actual: string) { return Object.assign(new TestMessage(message), { expectedOutput: expected, actualOutput: actual }); }
    }
    const runs: any[] = [];
    const controller: any = {
        items: new Collection(),
        profiles: [] as any[],
        createTestItem: (id: string, label: string, uri?: unknown) => {
            const item: any = { id, label, uri };
            item.children = new Collection(item);
            return item;
        },
        createRunProfile: (label: string, kind: number, handler: Function) => controller.profiles.push({ label, kind, handler }),
        createTestRun: () => {
            const events: string[] = [];
            const run = {
                events, messages: new Map<string, any>(),
                enqueued: (item: any) => events.push(`enqueued ${item.label}`),
                started: (item: any) => events.push(`started ${item.label}`),
                passed: (item: any) => events.push(`passed ${item.label}`),
                skipped: (item: any) => events.push(`skipped ${item.label}`),
                failed: (item: any, message: any) => { events.push(`failed ${item.label}`); run.messages.set(item.label, message); },
                errored: (item: any, message: any) => { events.push(`errored ${item.label}`); run.messages.set(item.label, message); },
                appendOutput: () => { },
                end: () => events.push('end'),
            };
            runs.push(run);
            return run;
        },
        dispose: () => { },
    };
    const disposable = { dispose: () => { } };
    return {
        controller, runs, TestMessage,
        tests: { createTestController: () => controller },
        TestRunProfileKind: { Run: 1, Debug: 2 },
        Uri: { file: (p: string) => ({ fsPath: p }) },
        Range: class { constructor(public startLine: number, public startCharacter: number, public endLine: number, public endCharacter: number) { } },
        Location: class { constructor(public uri: unknown, public range: unknown) { } },
        tasks: { onDidEndTaskProcess: () => disposable },
        debug: { onDidStartDebugSession: () => disposable },
        workspace: { workspaceFolders: undefined, getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
        commands: { executeCommand: async () => undefined },
    };
}, { virtual: true });

import * as vscode from 'vscode';
import { TestExplorer } from '../../../../services/testing/testExplorer';

const mock = vscode as any;
const hasDotnet = spawnSync('dotnet', ['--version']).status === 0;

const nunitProject = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net10.0</TargetFramework><IsPackable>false</IsPackable></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="18.0.1" />
    <PackageReference Include="NUnit" Version="4.3.2" />
    <PackageReference Include="NUnit3TestAdapter" Version="5.0.0" />
  </ItemGroup>
</Project>`;
const nunitTests = (ns: string) => `using NUnit.Framework;
namespace ${ns};
public class SettingsTests
{
    [Test] public void Param() => Assert.That(TestContext.Parameters["Env"], Is.EqualTo("team"));
    [Test] public void Variable() => Assert.That(System.Environment.GetEnvironmentVariable("TEAM_VAR"), Is.EqualTo("yes"));
}
`;
const files: Record<string, string> = {
    'Directory.Build.props': '<Project><PropertyGroup><RunSettingsFilePath>$(MSBuildThisFileDirectory)team.runsettings</RunSettingsFilePath></PropertyGroup></Project>',
    'team.runsettings': `<?xml version="1.0" encoding="utf-8"?>
<RunSettings>
  <RunConfiguration>
    <MaxCpuCount>0</MaxCpuCount>
    <EnvironmentVariables><TEAM_VAR>yes</TEAM_VAR></EnvironmentVariables>
  </RunConfiguration>
  <TestRunParameters><Parameter name="Env" value="team" /></TestRunParameters>
  <DataCollectionRunSettings><DataCollectors><DataCollector friendlyName="XPlat Code Coverage" /></DataCollectors></DataCollectionRunSettings>
</RunSettings>`,
    'A/A.csproj': nunitProject,
    'A/SettingsTests.cs': nunitTests('A'),
    'B/B.csproj': nunitProject,
    'B/SettingsTests.cs': nunitTests('B'),
    'MR/MR.csproj': `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net10.0</TargetFramework><OutputType>Exe</OutputType><ImplicitUsings>enable</ImplicitUsings><EnableMSTestRunner>true</EnableMSTestRunner></PropertyGroup>
  <ItemGroup><PackageReference Include="MSTest" Version="4.0.1" /></ItemGroup>
</Project>`,
    'MR/SettingsTests.cs': `namespace MR;
[TestClass]
public class SettingsTests
{
    public TestContext TestContext { get; set; } = null!;
    [TestMethod] public void Param() => Assert.AreEqual("team", TestContext.Properties["Env"]?.ToString());
    [TestMethod] public void Variable() => Assert.AreEqual("yes", Environment.GetEnvironmentVariable("TEAM_VAR"));
}
`,
};

describe('Test Explorer with a run settings file and dotnet', () => {
    jest.setTimeout(600000);
    let dir: string;

    beforeAll(() => {
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-runsettings-')));
        for (const [file, content] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
            fs.writeFileSync(path.join(dir, file), content);
        }
    });
    afterAll(() => {
        try {
            fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
        } catch {
            // a leftover temp folder must not fail the suite
        }
    });

    it('TestRunParameters and environment variables reach VSTest (NUnit) and MSTest runner tests', async () => {
        if (!hasDotnet || ['A', 'B', 'MR'].some(project => spawnSync('dotnet', ['restore', path.join(dir, project)]).status !== 0)) {
            console.warn('dotnet or the test packages are not available, skipping');
            return;
        }
        const projects = ['A', 'B', 'MR'].map(name => path.join(dir, name, `${name}.csproj`));
        const explorer = new TestExplorer({ projects: () => projects });
        await explorer.refresh(true);

        const [run] = mock.controller.profiles;
        await run.handler({ include: undefined, exclude: [] }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => { } }) });
        const events: string[] = mock.runs[0].events;
        expect(events.filter(e => e.startsWith('failed') || e.startsWith('errored'))).toEqual([]);
        expect(events.filter(e => e.startsWith('passed')).sort()).toEqual(['passed Param', 'passed Param', 'passed Param', 'passed Variable', 'passed Variable', 'passed Variable']);
        explorer.dispose();
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/test/unit/services/testing`
Expected: FAIL: `runSettings.test.ts`, `vstestClient.test.ts` and `testExplorer.test.ts` with `Cannot find module '../../../../services/testing/runSettings'`, `testProjects.test.ts` with `testProjectFrom` not exported; `runSettings.dotnet.test.ts` (with dotnet) with `failed Param`, `failed Variable` three times each.

- [ ] **Step 3: Implement `src/services/testing/runSettings.ts`**

```ts
/**
 * The RunSettings the Test Explorer sends to VSTest: a team's `.runsettings` file (`RunSettingsFilePath`) without
 * the parts that only matter for coverage and reports, plus what the design-mode protocol needs.
 */

/** What VSTest gets when a project has no run settings file */
export const DEFAULT_RUN_SETTINGS = '<RunSettings><RunConfiguration><DesignMode>true</DesignMode></RunConfiguration></RunSettings>';

/**
 * Left out of a team's file: data collectors (coverage stays a script, a missing collector would only print
 * warnings) and loggers (the results go to the Test Explorer, not to TRX or console loggers)
 */
const LEFT_OUT = ['DataCollectionRunSettings', 'InProcDataCollectionRunSettings', 'LoggerRunSettings'];

/**
 * The settings for VSTest from the content of a `.runsettings` file: everything except data collectors and loggers,
 * with `DesignMode` set to true (the protocol needs it: source locations, debugging by attaching). Undefined when the
 * content is not a RunSettings document.
 */
export function vstestRunSettings(content: string): string | undefined {
    const text = content.replace(/^\uFEFF/, '').replace(/<\?xml[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').trim();
    if (!/^<RunSettings\b[^>]*>[\s\S]*<\/RunSettings\s*>$/.test(text)) {
        return undefined;
    }
    let settings = text;
    for (const element of LEFT_OUT) {
        settings = settings.replace(new RegExp(`<${element}\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/${element}\\s*>)`, 'g'), '');
    }
    settings = settings.replace(/<DesignMode\b[^>]*?(?:\/>|>[\s\S]*?<\/DesignMode\s*>)/g, '');
    if (/<RunConfiguration\b[^>]*\/>/.test(settings)) {
        return settings.replace(/<RunConfiguration\b([^>]*?)\s*\/>/, '<RunConfiguration$1><DesignMode>true</DesignMode></RunConfiguration>');
    }
    if (/<RunConfiguration\b[^>]*>/.test(settings)) {
        return settings.replace(/<RunConfiguration\b[^>]*>/, open => `${open}<DesignMode>true</DesignMode>`);
    }
    return settings.replace(/<RunSettings\b[^>]*>/, open => `${open}<RunConfiguration><DesignMode>true</DesignMode></RunConfiguration>`);
}

/** What a Microsoft.Testing.Platform app gets from a run settings file */
export interface TestingPlatformRunSettings {
    /** The file's content for `--settings`, without data collectors, loggers and environment variables */
    readonly settings: string;
    /** `RunConfiguration/EnvironmentVariables`: set on the process we start (in the file they make the app restart itself as a separate test host, which then cannot connect to us) */
    readonly environment: Readonly<Record<string, string>>;
}

const unescapeXml = (value: string) => value
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/**
 * The settings for a Microsoft.Testing.Platform app with the VSTest bridge (MSTest and NUnit runners): MSTest/NUnit
 * sections, `TestRunParameters` and the rest of `RunConfiguration` stay in the file, the environment variables are
 * taken out. Undefined when the content is not a RunSettings document.
 */
export function testingPlatformRunSettings(content: string): TestingPlatformRunSettings | undefined {
    const settings = vstestRunSettings(content);
    if (settings === undefined) {
        return undefined;
    }
    const environment: Record<string, string> = {};
    const block = /<EnvironmentVariables\b[^>]*?(?:\/>|>([\s\S]*?)<\/EnvironmentVariables\s*>)/.exec(settings);
    for (const variable of (block?.[1] ?? '').matchAll(/<([A-Za-z_][\w.-]*)\b[^>]*?(?:\/>|>([\s\S]*?)<\/\1\s*>)/g)) {
        environment[variable[1]] = unescapeXml(variable[2] ?? '');
    }
    return {
        settings: settings
            .replace(/<EnvironmentVariables\b[^>]*?(?:\/>|>[\s\S]*?<\/EnvironmentVariables\s*>)/g, '')
            .replace('<DesignMode>true</DesignMode>', ''),
        environment,
    };
}
```

- [ ] **Step 4: `RunSettingsFilePath` in the test project evaluation**

In `src/services/testing/testProjects.ts`:

In `interface TestProject`, after `readonly vstestConsolePath?: string;` add:
```ts
    /** The team's `.runsettings` file (`RunSettingsFilePath`), absolute */
    readonly runSettingsPath?: string;
```

The signature of `parseTestProperties` becomes
```ts
export function parseTestProperties(msbuildJson: string): { testingPlatform: boolean; targetPath?: string; vstestConsolePath?: string; runSettingsPath?: string } {
```
and after its line `...(properties.VSTestConsolePath ? { vstestConsolePath: properties.VSTestConsolePath } : {}),` add
```ts
            ...(properties.RunSettingsFilePath ? { runSettingsPath: properties.RunSettingsFilePath } : {}),
```

Replace `evaluateTestProject` and its comment (from `/** Asks MSBuild whether the project is a Microsoft.Testing.Platform app` to the end of the file) with:
```ts
/** The project from what MSBuild said; a relative `RunSettingsFilePath` is relative to the project folder */
export function testProjectFrom(projectPath: string, msbuildJson: string): TestProject | undefined {
    const { testingPlatform, targetPath, vstestConsolePath, runSettingsPath } = parseTestProperties(msbuildJson);
    return targetPath ? {
        projectPath, targetPath, testingPlatform,
        ...(vstestConsolePath ? { vstestConsolePath } : {}),
        ...(runSettingsPath ? { runSettingsPath: path.resolve(path.dirname(projectPath), runSettingsPath) } : {}),
    } : undefined;
}

/** Asks MSBuild whether the project is a Microsoft.Testing.Platform app, where it builds to, where vstest.console is and which run settings file it uses */
export function evaluateTestProject(projectPath: string, configuration: string): Promise<TestProject | undefined> {
    return new Promise(resolve => {
        execFile('dotnet', [
            'msbuild', projectPath, '-nologo',
            '-getProperty:IsTestingPlatformApplication', '-getProperty:TargetPath', '-getProperty:VSTestConsolePath', '-getProperty:RunSettingsFilePath',
            `-property:Configuration=${configuration}`,
        ], { cwd: path.dirname(projectPath), timeout: 60000 }, (_error, stdout) => resolve(testProjectFrom(projectPath, stdout ?? '')));
    });
}
```

- [ ] **Step 5: The VSTest client sends the given settings**

In `src/services/testing/vstestClient.ts`:
- after `import { TestApp, TestNode } from './testingPlatformClient';` add `import { DEFAULT_RUN_SETTINGS } from './runSettings';`
- delete the line `const RUN_SETTINGS = '<RunSettings><RunConfiguration><DesignMode>true</DesignMode></RunConfiguration></RunSettings>';`
- in `interface VsTestSession` replace
```ts
    /** The test cases in the test assemblies */
    discover(sources: string[]): Promise<VsTestCase[]>;
```
with
```ts
    /** The test cases in the test assemblies; `runSettings` from `vstestRunSettings`, else the default */
    discover(sources: string[], runSettings?: string): Promise<VsTestCase[]>;
```
and `request: { readonly sources?: string[]; readonly testCases?: VsTestCase[] },` with `request: { readonly sources?: string[]; readonly testCases?: VsTestCase[]; readonly runSettings?: string },`
- in the session: `discover: async sources => {` becomes `discover: async (sources, runSettings) => {`; `send('TestDiscovery.Start', { Sources: sources, RunSettings: RUN_SETTINGS });` becomes `send('TestDiscovery.Start', { Sources: sources, RunSettings: runSettings ?? DEFAULT_RUN_SETTINGS });`; `run: async ({ sources, testCases }, onResults, attach) => {` becomes `run: async ({ sources, testCases, runSettings }, onResults, attach) => {`; in the `payload` line `RunSettings: RUN_SETTINGS };` becomes `RunSettings: runSettings ?? DEFAULT_RUN_SETTINGS };`

```bash
grep -c "RUN_SETTINGS\b" src/services/testing/vstestClient.ts; grep -c "DEFAULT_RUN_SETTINGS" src/services/testing/vstestClient.ts
```
Expected: `0`, then `3`.

- [ ] **Step 6: The Test Explorer reads the file, groups VSTest projects, and gives MSTest/NUnit runner apps `--settings`**

In `src/services/testing/testExplorer.ts`:

Imports: after `import * as fs from 'fs';` add `import * as os from 'os';`; after `import * as path from 'path';` add `import { createHash } from 'crypto';`; after the `vstestClient` import add `import { testingPlatformRunSettings, vstestRunSettings } from './runSettings';`.

In `interface TestExplorerDeps` replace
```ts
    /** Starts the test app with the server arguments, in the debugger for debug runs */
    start(project: TestProject, args: string[], debug: boolean): Promise<TestApp>;
```
with
```ts
    /** Starts the test app with the server arguments, in the debugger for debug runs, with extra environment variables */
    start(project: TestProject, args: string[], debug: boolean, environment: Readonly<Record<string, string>>): Promise<TestApp>;
```
and after `modified(file: string): number | undefined;` add
```ts
    /** The content of a run settings file; undefined when it can't be read */
    readRunSettings(file: string): string | undefined;
    /** Whether the Microsoft.Testing.Platform app has the VSTest bridge, which reads run settings (`--settings`) */
    hasVsTestBridge(targetPath: string): boolean;
    /** Writes run settings for `--settings` to a temporary file and gives its path */
    writeRunSettings(content: string): string;
```

`startProcess`: the signature becomes `function startProcess(project: TestProject, args: string[], environment: Readonly<Record<string, string>>): Promise<TestApp> {` and its `env` line `env: { ...process.env, TESTINGPLATFORM_TELEMETRY_OPTOUT: '1', ...environment },`.
`startInDebugger`: the signature becomes `async function startInDebugger(project: TestProject, args: string[], environment: Readonly<Record<string, string>>): Promise<TestApp> {` and its `env` line `env: { TESTINGPLATFORM_TELEMETRY_OPTOUT: '1', ...environment },`.

In `defaultDeps`: `start` becomes
```ts
    start: (project, args, debug, environment) => debug ? startInDebugger(project, args, environment) : startProcess(project, args, environment),
```
and after the `modified` entry (before the closing `};` of `defaultDeps`) add
```ts
    readRunSettings: file => {
        try {
            return fs.readFileSync(file, 'utf8');
        } catch {
            return undefined;
        }
    },
    hasVsTestBridge: targetPath => fs.existsSync(path.join(path.dirname(targetPath), 'Microsoft.Testing.Extensions.VSTestBridge.dll')),
    writeRunSettings: content => {
        // One file per content: concurrent runs of projects with different settings don't overwrite each other
        const file = path.join(os.tmpdir(), `shinobi-${createHash('sha256').update(content).digest('hex').slice(0, 16)}.runsettings`);
        fs.writeFileSync(file, content, 'utf8');
        return file;
    },
```

After `interface ProjectState { ... }` add
```ts
/** A project in a run: its tests to run, or undefined for all of them */
interface ProjectRun {
    readonly state: ProjectState;
    readonly items: vscode.TestItem[] | undefined;
}
```

In `discover`, replace
```ts
                const session = await connectTestApp(args => this.deps.start(state.project, args, false));
```
with
```ts
                const settings = this.testingPlatformSettings(state.project);
                const session = await connectTestApp(args => this.deps.start(state.project, [...args, ...settings.args], false, settings.environment));
```
and `for (const testCase of await session.discover([state.project.targetPath])) {` with `for (const testCase of await session.discover([state.project.targetPath], this.vstestSettings(state.project))) {`.

Replace the three methods `run`, `runProject` and `runVsTestProject` (from `    private async run(request: vscode.TestRunRequest` to the blank line before `    dispose(): void {`) with:
```ts
    private async run(request: vscode.TestRunRequest, token: vscode.CancellationToken, debug: boolean): Promise<void> {
        if (this.states.size === 0) {
            await this.refresh(false);
        }
        const exclude = request.exclude ?? [];
        const roots: vscode.TestItem[] = [];
        if (request.include) {
            roots.push(...request.include);
        } else {
            this.controller.items.forEach(item => roots.push(item));
        }

        // Per project: the tests to run, or everything when the whole project was asked for
        const byProject = new Map<ProjectState, { items: Set<vscode.TestItem>; all: boolean }>();
        for (const root of roots) {
            const state = this.projectOf(root);
            if (!state) {
                continue;
            }
            const entry = byProject.get(state) ?? { items: new Set(), all: false };
            entry.all ||= root === state.item && exclude.length === 0;
            this.leaves(root, exclude).forEach(item => entry.items.add(item));
            byProject.set(state, entry);
        }

        const run = this.controller.createTestRun(request);
        const configuration = BuildConfiguration.active;
        // VSTest projects with the same vstest.console and run settings run in one session, as in Visual Studio:
        // that is where the run settings' MaxCpuCount runs test assemblies in parallel
        const vstestGroups = new Map<string, ProjectRun[]>();
        try {
            for (const [state, { items, all }] of byProject) {
                if (token.isCancellationRequested) {
                    break;
                }
                items.forEach(item => run.enqueued(item));
                if (!await this.deps.build(state.project.projectPath, configuration, text => run.appendOutput(terminal(text)))) {
                    items.forEach(item => run.errored(item, new vscode.TestMessage('Build failed, see the Problems panel')));
                    continue;
                }
                const projectRun = { state, items: all ? undefined : [...items] };
                if (state.project.testingPlatform) {
                    await this.runProject(projectRun, run, token, debug);
                } else {
                    const key = `${state.project.vstestConsolePath}|${state.project.runSettingsPath ?? ''}`;
                    vstestGroups.set(key, [...(vstestGroups.get(key) ?? []), projectRun]);
                }
            }
            for (const group of vstestGroups.values()) {
                if (token.isCancellationRequested) {
                    break;
                }
                await this.runVsTestProjects(group, run, token, debug);
            }
        } finally {
            run.end();
        }
    }

    /** Reports the results of the projects' tests to the run; `fail` marks the requested tests errored */
    private reporter(projects: readonly ProjectRun[], run: vscode.TestRun): { report(node: TestNode): void; fail(error: unknown): void } {
        const byUid = new Map<string, vscode.TestItem>();
        const collect = (item: vscode.TestItem) => {
            const node = this.nodes.get(item);
            if (node) {
                byUid.set(node.uid, item);
            }
            item.children.forEach(collect);
        };
        projects.forEach(({ state }) => collect(state.item));

        const report = (node: TestNode) => {
            const item = byUid.get(node.uid);
            const outcome = outcomeOf(node);
            if (!item || !outcome) {
                return;
            }
            const output = [node.standardOutput, node.standardError].filter(Boolean).join('\n');
            if (output) {
                run.appendOutput(terminal(`${output}\n`), undefined, item);
            }
            switch (outcome.state) {
                case 'started': run.started(item); break;
                case 'passed': run.passed(item, outcome.duration); break;
                case 'skipped': run.skipped(item); break;
                case 'failed':
                case 'errored': {
                    const text = outcome.stackTrace ? `${outcome.message}\n\n${outcome.stackTrace}` : outcome.message;
                    const message = outcome.expected !== undefined
                        ? vscode.TestMessage.diff(text, outcome.expected, outcome.actual ?? '')
                        : new vscode.TestMessage(text);
                    if (item.uri && item.range) {
                        message.location = new vscode.Location(item.uri, item.range);
                    }
                    outcome.state === 'failed' ? run.failed(item, message, outcome.duration) : run.errored(item, message, outcome.duration);
                    break;
                }
            }
        };
        const fail = (error: unknown) => {
            const message = new vscode.TestMessage(error instanceof Error ? error.message : String(error));
            projects.flatMap(({ state, items }) => items ?? this.leaves(state.item, [])).forEach(item => run.errored(item, message));
        };
        return { report, fail };
    }

    /** Runs or debugs the tests of a Microsoft.Testing.Platform project in its test app */
    private async runProject(projectRun: ProjectRun, run: vscode.TestRun, token: vscode.CancellationToken, debug: boolean): Promise<void> {
        const { state, items } = projectRun;
        const { report, fail } = this.reporter([projectRun], run);
        const settings = this.testingPlatformSettings(state.project, text => run.appendOutput(terminal(text)));

        let session: TestSession;
        try {
            session = await connectTestApp(args => this.deps.start(state.project, [...args, ...settings.args], debug, settings.environment));
        } catch (error) {
            fail(error);
            return;
        }
        const cancel = token.onCancellationRequested(() => void session.close());

        session.onLog((level, message) => {
            if (!['Trace', 'Debug'].includes(level)) {
                run.appendOutput(terminal(message.endsWith('\n') ? message : `${message}\n`));
            }
        });
        session.onUpdate(nodes => nodes.forEach(report));

        try {
            const tests = items?.map(item => this.nodes.get(item)!).map(node => ({ uid: node.uid, 'display-name': node['display-name'] }));
            await session.run(tests);
        } catch (error) {
            run.appendOutput(terminal(`${error instanceof Error ? error.message : error}\n`));
        } finally {
            cancel.dispose();
            await session.close();
        }
    }

    /**
     * Runs or debugs (attaching to the test hosts) the tests of VSTest projects that share vstest.console and the run
     * settings file, in one vstest.console session
     */
    private async runVsTestProjects(projects: readonly ProjectRun[], run: vscode.TestRun, token: vscode.CancellationToken, debug: boolean): Promise<void> {
        const { report, fail } = this.reporter(projects, run);
        const first = projects[0].state.project;
        let session: VsTestSession;
        try {
            session = await connectVsTest(port => this.deps.startVsTest(first, port));
        } catch (error) {
            fail(error);
            return;
        }
        const cancel = token.onCancellationRequested(() => void session.close());
        session.onLog(message => run.appendOutput(terminal(`${message}\n`)));

        try {
            // VSTest takes either whole assemblies or test cases: once a project runs only some tests, all go as test cases
            const selective = projects.some(({ items }) => items);
            const testCases = selective
                ? projects.flatMap(({ state, items }) => (items ?? this.leaves(state.item, [])).flatMap(item => this.vstestCases.get(this.nodes.get(item)!.uid) ?? []))
                : undefined;
            await session.run(
                { ...(testCases ? { testCases } : { sources: projects.map(({ state }) => state.project.targetPath) }), runSettings: this.vstestSettings(first, text => run.appendOutput(terminal(text))) },
                results => results.map(vstestResultNode).forEach(report),
                debug ? processId => this.deps.attachDebugger(first, processId) : undefined
            );
        } catch (error) {
            run.appendOutput(terminal(`${error instanceof Error ? error.message : error}\n`));
        } finally {
            cancel.dispose();
            await session.close();
        }
    }

    /** The project's run settings file, or undefined when it has none or it can't be used (said in the output) */
    private runSettingsContent(project: TestProject, output?: (text: string) => void): string | undefined {
        if (!project.runSettingsPath) {
            return undefined;
        }
        const content = this.deps.readRunSettings(project.runSettingsPath);
        if (content === undefined) {
            const problem = `The run settings file ${project.runSettingsPath} (RunSettingsFilePath of ${path.basename(project.projectPath)}) can't be read; running without it.\n`;
            log.warn(problem);
            output?.(problem);
        }
        return content;
    }

    /** What VSTest gets: the project's run settings without data collectors and loggers, else the default */
    private vstestSettings(project: TestProject, output?: (text: string) => void): string | undefined {
        const content = this.runSettingsContent(project, output);
        const settings = content === undefined ? undefined : vstestRunSettings(content);
        if (content !== undefined && settings === undefined) {
            const problem = `${project.runSettingsPath} is not a run settings file (<RunSettings>); running without it.\n`;
            log.warn(problem);
            output?.(problem);
        }
        return settings;
    }

    /**
     * What a Microsoft.Testing.Platform app gets: `--settings` with the project's run settings when the app has the
     * VSTest bridge (MSTest, NUnit runner; xUnit v3 and TUnit don't read run settings and would refuse the option),
     * and the file's environment variables
     */
    private testingPlatformSettings(project: TestProject, output?: (text: string) => void): { args: string[]; environment: Readonly<Record<string, string>> } {
        const none = { args: [], environment: {} };
        if (!project.runSettingsPath || !this.deps.hasVsTestBridge(project.targetPath)) {
            return none;
        }
        const content = this.runSettingsContent(project, output);
        const settings = content === undefined ? undefined : testingPlatformRunSettings(content);
        if (!settings) {
            if (content !== undefined) {
                const problem = `${project.runSettingsPath} is not a run settings file (<RunSettings>); running without it.\n`;
                log.warn(problem);
                output?.(problem);
            }
            return none;
        }
        return { args: ['--settings', this.deps.writeRunSettings(settings.settings)], environment: settings.environment };
    }
```

- [ ] **Step 7: Run to verify it passes**

Run: `npx jest src/test/unit/services/testing`
Expected: PASS (8 suites; `runSettings.dotnet.test.ts` takes about 10 s with the packages in the local cache, and only warns "skipping" without dotnet or the packages).

- [ ] **Step 8: Docs**

`docs/tests.md`, a new section before "## When tests appear":
```markdown
## Run settings

A project's `.runsettings` file is used when MSBuild names it in `RunSettingsFilePath` (in the project file or, for every project, in `Directory.Build.props`), the way `dotnet test` and Visual Studio find it:

| Kind | What is used |
|---|---|
| **VSTest** | Everything in the file except data collectors and loggers: `RunConfiguration` (`MaxCpuCount`, `EnvironmentVariables`, `TestSessionTimeout`...), `TestRunParameters` and the sections of the adapters (`NUnit`, `MSTest`, `xUnit`). VSTest projects that use the same file run in one VSTest session, so `MaxCpuCount` runs their test assemblies in parallel |
| **Microsoft.Testing.Platform** | MSTest and NUnit runner projects get the file (`--settings`) and its environment variables; xUnit v3 and TUnit do not read run settings files. `MaxCpuCount` does not apply there (the platform says so in the test output) |

Code coverage stays a script (`dotnet test --collect "XPlat Code Coverage"`): the data collectors in the file are not run from the Testing view. A file that is missing or not a run settings file is skipped with a line in the test output.
```

`docs/manual-testing.md`, append unticked:
```markdown
- [ ] Run settings in the Testing view (two NUnit VSTest projects and an MSTest runner project, `Directory.Build.props` with `<RunSettingsFilePath>$(MSBuildThisFileDirectory)team.runsettings</RunSettingsFilePath>`, the file with `MaxCpuCount` 0, an environment variable, a `TestRunParameters` parameter and a coverage data collector; the tests of `src/test/unit/services/testing/runSettings.dotnet.test.ts`): Run All passes the tests that read the parameter and the variable in all three projects, the two NUnit projects run in parallel (with a 3 s sleep in each the run takes about 3 s, not 6), Debug stops at a breakpoint in both kinds, the test output shows no warning about the coverage collector; with the file renamed, a run says it can't be read and runs without it; two VSTest projects with different target frameworks (net8.0 and net10.0) sharing the file both run
```

No GIF: nothing new to see (the same Testing view, only results that now match `dotnet test`); the table says it.

- [ ] **Step 9: Verify and commit**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git add src/services/testing/runSettings.ts src/services/testing/testProjects.ts src/services/testing/vstestClient.ts src/services/testing/testExplorer.ts src/test/unit/services/testing/runSettings.test.ts src/test/unit/services/testing/runSettings.dotnet.test.ts src/test/unit/services/testing/testProjects.test.ts src/test/unit/services/testing/vstestClient.test.ts src/test/unit/services/testing/testExplorer.test.ts docs/tests.md docs/manual-testing.md
git commit -m "Test Explorer: use the project's run settings file (RunSettingsFilePath) for VSTest and MSTest/NUnit runner projects

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: exit 0 (verified in the planning copy on top of HEAD d788c2b: typecheck clean, 158 suites / 1371 tests, the real-dotnet tests included, `build:dev` exit 0).

---

### Task 10: gRPC references: pin the case-only duplicate check with a test (no code change)

**Files:**
- Test: `src/test/unit/services/grpc/protobufReferences.test.ts`

**Repro (done while planning):** the roadmap item ("a case-only duplicate such as `a.proto` / `A.PROTO` on Windows or macOS is not detected (unproven)") is **not reproducible: it is already handled**. `duplicateRefusal` and `isExistingReference` (`src/services/grpc/protobufReferences.ts`) compare files with `sameFile`, which goes through `pathKey` (`src/services/projectItems/projectItems.ts`): lowercased when `process.platform` is `win32` or `darwin`. A Jest scratch test of the real functions with `process.platform` overridden gave, for an existing `Protos\a.proto` and a new `Protos\A.PROTO` (from the evaluation, from the project file text only, and an outside `shared/A.PROTO` that would be linked as `Protos\A.PROTO`): on `win32` and `darwin` all three refused (`A.PROTO is already a gRPC reference of Client.` twice, `Protos\A.PROTO is already taken by the gRPC reference Protos\a.proto; rename one of the files.`), on `linux` none (correct there: two different files). The wildcard check of Remove (`wildcardMatches`) is case-insensitive outside Linux too. So no fix; the item gets a test so it is proven, and moves to the history as "already handled".

- [ ] **Step 1: Add the test**

In `src/test/unit/services/grpc/protobufReferences.test.ts`, inside `describe('duplicateRefusal', ...)`, before `test('a new file is fine', ...)`, add:
```ts
    test('a name that differs only in case (A.PROTO for a.proto) is the same file on Windows and macOS, another file on Linux', () => {
        const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
        const lower = { include: 'Protos\\a.proto', fullPath: path.join(projectDir, 'Protos', 'a.proto') };
        const lowerXml = addProtobufReference(project, { include: 'Protos\\a.proto', services: 'Client' });
        const upper = path.join(projectDir, 'Protos', 'A.PROTO');
        const outside = path.join(root, 'shared', 'A.PROTO');
        const refusals = (name: string) => {
            Object.defineProperty(process, 'platform', { value: name });
            try {
                return [
                    duplicateRefusal([lower], project, projectDir, upper, protobufReferenceFor(projectDir, upper, 'Client')),
                    duplicateRefusal([], lowerXml, projectDir, upper, protobufReferenceFor(projectDir, upper, 'Client')),
                    duplicateRefusal([lower], project, projectDir, outside, protobufReferenceFor(projectDir, outside, 'Client')),
                ];
            } finally {
                Object.defineProperty(process, 'platform', platform);
            }
        };
        const taken = 'Protos\\A.PROTO is already taken by the gRPC reference Protos\\a.proto; rename one of the files.';
        expect(refusals('win32')).toEqual(['A.PROTO is already a gRPC reference of Client.', 'A.PROTO is already a gRPC reference of Client.', taken]);
        expect(refusals('darwin')).toEqual(['A.PROTO is already a gRPC reference of Client.', 'A.PROTO is already a gRPC reference of Client.', taken]);
        expect(refusals('linux')).toEqual([undefined, undefined, undefined]);
    });
```

- [ ] **Step 2: Run it**

Run: `npx jest src/test/unit/services/grpc/protobufReferences.test.ts`
Expected: PASS (the behaviour exists already; on Windows CI the override still restores the real platform afterwards).

- [ ] **Step 3: Typecheck and commit**

No docs step: nothing a user sees changes (`docs/connected-services.md` already says a file the project references is refused).
```bash
npm run typecheck; echo "exit $?"
git add src/test/unit/services/grpc/protobufReferences.test.ts
git commit -m "gRPC references: test that a case-only duplicate .proto is refused on Windows and macOS

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: exit 0.

---

### Task 11: gRPC references: raise an older Google.Protobuf the new packages need (no NU1605)

**Files:**
- Modify: `src/services/nuget/types.ts`, `src/services/nuget/nugetV3Service.ts`, `src/services/grpc/protobufReferences.ts`, `src/services/grpc/grpcReferenceService.ts`
- Test: `src/test/unit/services/nuget/packageDetails.test.ts`, `src/test/unit/services/grpc/protobufReferences.test.ts`, `src/test/unit/services/grpc/grpcReferenceService.test.ts`, `src/test/unit/services/grpc/grpcReferenceUpdate.test.ts`
- Docs: `docs/connected-services.md`, `docs/manual-testing.md`

**Repro (done while planning, .NET SDK 10.0.111, nuget.org on 2026-10-23):** newest stable versions: `Grpc.AspNetCore` 2.84.0 (depends on `Google.Protobuf [3.35.1, )`, `Grpc.Tools`, `Grpc.AspNetCore.Server.ClientFactory`), `Grpc.Net.ClientFactory` 2.84.0 and `Grpc.Tools` 2.84.0 (no dependency on `Google.Protobuf`), `Google.Protobuf` 3.36.2. A Jest scratch test drove the real `addGrpcReference` + `installGrpcPackages` (real `PackageOperationsService.installPackage`, i.e. `dotnet add package`; the CPM edits for CPM) on copies of `src/__fixtures__/grpc`, then ran a real `dotnet build`:
- `Web` (Both) with `<PackageReference Include="Google.Protobuf" Version="3.20.0" />`: `dotnet add package Grpc.AspNetCore --version 2.84.0` printed `error: NU1605: Warning As Error: Detected package downgrade: Google.Protobuf from 3.35.1 to 3.20.0` but still wrote the reference; the extension reported "gRPC reference greet.proto added, but adding its packages failed. Once the package sources can be reached, add the same reference again" (wrong reason), and `dotnet build` failed with NU1605. **Reproduced.**
- `Web` (Both) under CPM with `<PackageVersion Include="Google.Protobuf" Version="3.20.0" />`: the extension said the reference was added; `dotnet build` failed with the same NU1605. **Reproduced.**
- `Client` (Client) with 3.20.0, with and without CPM: `Grpc.Net.ClientFactory` and `Grpc.Tools` 2.84.0 were added, `dotnet build` succeeded (0 warnings): the client packages do not depend on `Google.Protobuf`, and the code Grpc.Tools 2.84.0 generates compiled against 3.20.0. Nothing to fix there.

**Fix (decided):** the registration data the NuGet code already fetches (`NuGetV3Service.getPackageDetails`) carries each version's `dependencyGroups`; it is kept per version (`NuGetPackage.dependencies`). Before the packages are added, when the project's evaluated `Google.Protobuf` is lower than what one of them needs, a modal asks "Grpc.AspNetCore 2.84.0 needs Google.Protobuf 3.35.1 or newer; Web has 3.20.0." with **Raise to 3.35.1**; Raise puts `Google.Protobuf` at that lowest needed version first in the same batch (so `dotnet add package` of the gRPC package restores without NU1605; under CPM the central version is set through the same CPM code, which asks before it changes other projects); declining adds the `<Protobuf>` item without packages and says what to raise. With the fix applied, the same scratch test gave: Web (pinned) asked, wrote `Google.Protobuf 3.35.1` + `Grpc.AspNetCore 2.84.0`, `dotnet build` succeeded; Web (CPM) raised the `PackageVersion` to 3.35.1, build succeeded; declined: only the item, the info message, build of the untouched packages succeeded.

- [ ] **Step 1: Write the failing tests**

`src/test/unit/services/nuget/packageDetails.test.ts`, add inside `describe('NuGetV3Service.getPackageDetails', ...)` after the existing `it(...)`:
```ts
    it('keeps the dependencies of each version, all target frameworks together', async () => {
        const withDependencies = (version: string, protobuf: string) => ({
            catalogEntry: {
                '@type': 'PackageDetails', id: 'Grpc.AspNetCore', version, dependencyGroups: [
                    { targetFramework: 'net8.0', dependencies: [{ id: 'Google.Protobuf', range: protobuf }, { id: 'Grpc.Tools', range: `[${version}, )` }] },
                    { targetFramework: 'net9.0', dependencies: [{ id: 'Google.Protobuf', range: protobuf }] },
                ],
            },
        });
        const pages: Record<string, unknown> = {
            'https://deps/index.json': { resources: [{ '@type': 'RegistrationsBaseUrl', '@id': 'https://deps/reg/' }] },
            'https://deps/reg/grpc.aspnetcore/index.json': { items: [
                { '@id': 'https://deps/reg/grpc.aspnetcore/page/0.json', lower: '2.71.0', upper: '2.84.0', items: [withDependencies('2.71.0', '[3.30.2, )'), withDependencies('2.84.0', '[3.35.1, )')] },
            ] },
        };
        jest.spyOn(NuGetV3Service as any, 'makeRequest').mockImplementation(async (url: any) =>
            url in pages ? { body: JSON.stringify(pages[url]), statusCode: 200 } : { body: '', statusCode: 404 });

        const details = await NuGetV3Service.getPackageDetails('Grpc.AspNetCore', [{ name: 'deps', url: 'https://deps/index.json', enabled: true } as any]);

        expect(details?.dependencies?.['2.84.0']).toEqual([
            { id: 'Google.Protobuf', range: '[3.35.1, )' }, { id: 'Grpc.Tools', range: '[2.84.0, )' }, { id: 'Google.Protobuf', range: '[3.35.1, )' },
        ]);
        expect(details?.dependencies?.['2.71.0']?.[0]).toEqual({ id: 'Google.Protobuf', range: '[3.30.2, )' });
    });
```

`src/test/unit/services/grpc/protobufReferences.test.ts`: add `rangeMinimum` to the import list (`protobufReferenceFor, protoFileName, rangeMinimum, referenceLabel, removeProtobufReference, sourceUrlInProjectFile,`), and before `describe('ensureDevelopmentDependency', ...)` add:
```ts
describe('rangeMinimum', () => {
    test('the lower bound of a NuGet version range, undefined when there is none', () => {
        expect(rangeMinimum('3.35.1')).toBe('3.35.1');
        expect(rangeMinimum('[3.35.1, )')).toBe('3.35.1');
        expect(rangeMinimum('[3.35.1,4.0.0)')).toBe('3.35.1');
        expect(rangeMinimum('(3.0.0, )')).toBe('3.0.0');
        expect(rangeMinimum('[1.2.3]')).toBe('1.2.3');
        expect(rangeMinimum('(, 4.0.0)')).toBeUndefined();
        expect(rangeMinimum('')).toBeUndefined();
    });
});
```

`src/test/unit/services/grpc/grpcReferenceService.test.ts`:
1. The import of the service becomes:
```ts
import { addGrpcReference, GrpcHost, installGrpcPackages, vscodeGrpcHost } from '../../../../services/grpc/grpcReferenceService';
import { PackageBrowseService } from '../../../../services/nuget/packageBrowseService';
```
2. `referencedPackages` returns packages with versions now; replace exactly:
   - `host({ referencedPackages: async () => ['Grpc.AspNetCore'] })` with `host({ referencedPackages: async () => [{ id: 'Grpc.AspNetCore', version: '2.71.0' }] })`
   - `host({ items: async () => items, referencedPackages: async () => ['Grpc.AspNetCore'] })` with `host({ items: async () => items, referencedPackages: async () => [{ id: 'Grpc.AspNetCore', version: '2.71.0' }] })`
   - `referencedPackages: async projectPath => (await new ProjectItemsService().evaluatePackages(projectPath))?.references.map(reference => reference.id) ?? [],` with `referencedPackages: async projectPath => (await new ProjectItemsService().evaluatePackages(projectPath))?.references ?? [],`
3. Both host builders get the new method: in `const fake: GrpcHost = {` (the `host` of `describe('addGrpcReference')`) after the `latestVersion: async id => ({ ... } as Record<string, string>)[id],` line add `            dependencyMinimum: async () => undefined,`; in `const grpcHost = (ops: OperationsHost): GrpcHost => ({` after `        latestVersion: async id => versions[id],` add `        dependencyMinimum: async () => undefined,`.
4. Before `test('a URL: downloaded into Protos (created), referenced with its SourceUrl', ...)` add:
```ts
    describe('a project that pins an older Google.Protobuf than the new packages need (NU1605 at restore)', () => {
        const pinned = (version: string, ask: (message: string) => boolean) => host({
            referencedPackages: async () => [{ id: 'Google.Protobuf', version }],
            dependencyMinimum: async (id, version, dependency) => id === 'Grpc.AspNetCore' && version === '2.71.0' && dependency === 'Google.Protobuf' ? '3.30.2' : undefined,
            ask: async message => ask(message),
        });

        test('asks, then raises Google.Protobuf to what the packages need, before adding them', async () => {
            const asked: string[] = [];
            const { fake, calls } = pinned('3.20.0', message => { asked.push(message); return true; });
            expect(await addGrpcReference(web, fake)).toBe(true);
            expect(asked).toEqual(['Grpc.AspNetCore 2.71.0 needs Google.Protobuf 3.30.2 or newer; Web has 3.20.0.']);
            expect(calls.installed).toEqual(['Google.Protobuf 3.30.2', 'Grpc.AspNetCore 2.71.0']);
            expect(calls.info).toEqual(['gRPC reference greet.proto added (Both). The code is generated when the project builds.']);
            expect(calls.fail).toEqual([]);
        });

        test('kept: the reference is added without the packages, and the message says what to raise', async () => {
            const { fake, calls } = pinned('3.20.0', () => false);
            expect(await addGrpcReference(web, fake)).toBe(true);
            expect(fs.readFileSync(web, 'utf8')).toContain('<Protobuf Include="..\\shared\\greet.proto" Link="Protos\\greet.proto" />');
            expect(calls.installed).toEqual([]);
            expect(calls.info).toEqual(['gRPC reference greet.proto added, but not its packages: Grpc.AspNetCore 2.71.0 needs Google.Protobuf 3.30.2 or newer '
                + 'and Web keeps 3.20.0. Raise Google.Protobuf, then add the same reference again: that adds the missing packages.']);
            expect(calls.fail).toEqual([]);
        });

        test('a Google.Protobuf that is new enough, or not known, is left alone without a question', async () => {
            for (const version of ['3.30.2', '3.31.0', '']) {
                const asked: string[] = [];
                const { fake, calls } = pinned(version, message => { asked.push(message); return true; });
                expect(await addGrpcReference(web, fake)).toBe(true);
                expect(asked).toEqual([]);
                expect(calls.installed).toEqual(['Grpc.AspNetCore 2.71.0']);
                fs.cpSync(path.join(fixture, 'Web', 'Web.csproj'), web);
            }
        });

        test('Client packages do not depend on Google.Protobuf: nothing is asked (the project keeps its version)', async () => {
            const asked: string[] = [];
            const { fake, calls } = pinned('3.20.0', message => { asked.push(message); return true; });
            expect(await addGrpcReference(client, fake)).toBe(true);
            expect(asked).toEqual([]);
            expect(calls.installed).toEqual(['Grpc.Net.ClientFactory 2.71.0', 'Grpc.Tools 2.71.0']);
        });
    });
```
5. At the end of the file add:
```ts
describe('vscodeGrpcHost.dependencyMinimum', () => {
    afterEach(() => jest.restoreAllMocks());

    test('the highest lower bound over the target frameworks of that version; undefined without such a dependency', async () => {
        jest.spyOn(PackageBrowseService, 'getPackageDetails').mockResolvedValue({
            id: 'Grpc.AspNetCore', currentVersion: '2.84.0', dependencies: {
                '2.84.0': [{ id: 'Google.Protobuf', range: '[3.30.0, )' }, { id: 'google.protobuf', range: '[3.35.1, )' }, { id: 'Grpc.Tools', range: '[2.84.0, )' }],
            },
        });
        expect(await vscodeGrpcHost.dependencyMinimum('Grpc.AspNetCore', '2.84.0', 'Google.Protobuf')).toBe('3.35.1');
        expect(await vscodeGrpcHost.dependencyMinimum('Grpc.AspNetCore', '2.71.0', 'Google.Protobuf')).toBeUndefined();
        expect(await vscodeGrpcHost.dependencyMinimum('Grpc.AspNetCore', '2.84.0', 'Serilog')).toBeUndefined();
    });
});
```

`src/test/unit/services/grpc/grpcReferenceUpdate.test.ts`: in `const fake: GrpcHost = {` after `            latestVersion: async () => undefined,` add `            dependencyMinimum: async () => undefined,`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/test/unit/services/grpc src/test/unit/services/nuget/packageDetails.test.ts`
Expected: FAIL (TS errors: `Property 'dependencies' does not exist on type 'NuGetPackage'`, `has no exported member 'rangeMinimum'`, `'dependencyMinimum' does not exist in type 'GrpcHost'`).

- [ ] **Step 3: The dependencies of each version (`types.ts`, `nugetV3Service.ts`)**

`src/services/nuget/types.ts`, in `interface NuGetPackage` replace
```ts
    /** Package source URL or name where this package was found */
    readonly source?: string;
}
```
with
```ts
    /** Package source URL or name where this package was found */
    readonly source?: string;
    /** Per version, the packages it depends on (all target frameworks together); from the registration data */
    readonly dependencies?: Readonly<Record<string, readonly PackageDependency[]>>;
}

/** A dependency of a package version: `{ id: 'Google.Protobuf', range: '[3.35.1, )' }` */
export interface PackageDependency {
    readonly id: string;
    readonly range: string;
}
```
(`packageSharedService` copies only named fields into what the webview gets, so the webview messages do not grow.)

`src/services/nuget/nugetV3Service.ts`: the import becomes `import { NuGetPackage, PackageDependency, PackageSearchOptions, PackageSource, upgradeNuGetOrgUrl } from './types';`; after `const log = logger('NuGetV3Service');` add
```ts

/** The dependencies of a registration catalog entry, every target framework's group in turn */
function dependenciesOf(entry: { dependencyGroups?: { dependencies?: { id?: string; range?: string }[] }[] }): PackageDependency[] {
    return (entry.dependencyGroups ?? []).flatMap(group => (group.dependencies ?? [])
        .filter(dependency => dependency.id)
        .map(dependency => ({ id: dependency.id!, range: dependency.range ?? '' })));
}
```
and at the end of `parsePackageDetails` replace
```ts
                versions: sorted.filter(x => x.version).map(x => x.version)
            };
```
with
```ts
                versions: sorted.filter(x => x.version).map(x => x.version),
                dependencies: Object.fromEntries(sorted.filter(x => x.version).map(x => [x.version, dependenciesOf(x)])),
            };
```

- [ ] **Step 4: `rangeMinimum` (`protobufReferences.ts`)**

In `src/services/grpc/protobufReferences.ts`, before the doc comment `/**\n * Marks a development dependency (Grpc.Tools)` add:
```ts
/**
 * The lowest version a NuGet version range allows: `3.35.1` and `[3.35.1, )` (what a package's dependency says) give
 * `3.35.1`; undefined for a range without a lower bound (`(, 4.0.0)`)
 */
export function rangeMinimum(range: string): string | undefined {
    const lower = range.trim().replace(/^[[(]\s*/, '').split(/[\s,\])]/)[0];
    return lower ? lower : undefined;
}

```

- [ ] **Step 5: Ask and raise (`grpcReferenceService.ts`)**

In `src/services/grpc/grpcReferenceService.ts`:

a) The import from `./protobufReferences` becomes:
```ts
import {
    addProtobufReference, contentHash, defaultGrpcServices, downloadedContentRefusal, duplicateRefusal, ensureDevelopmentDependency, GRPC_SERVICES,
    GrpcServices, grpcPackages, isExistingReference, notListedMessage, protobufReferenceFor, protoFileName, PROTOS_FOLDER, rangeMinimum,
    removeProtobufReference, servicesOf, sourceUrlInProjectFile,
} from './protobufReferences';
```

b) After `export type GrpcSource = ...;` add:
```ts

/** A package a project references, with the version it gets ('' when not known) */
export interface ReferencedPackage {
    readonly id: string;
    readonly version: string;
}
```

c) In `interface GrpcHost` replace
```ts
    /** Ids of the packages the project references (evaluated, so also those from props files) */
    referencedPackages(projectPath: string): Promise<readonly string[]>;
    /** The newest stable version on the configured package sources */
    latestVersion(id: string): Promise<string | undefined>;
```
with
```ts
    /** The packages the project references (evaluated, so also those from props files); version '' when not known */
    referencedPackages(projectPath: string): Promise<readonly ReferencedPackage[]>;
    /** The newest stable version on the configured package sources */
    latestVersion(id: string): Promise<string | undefined>;
    /** The lowest version of `dependency` that version `version` of package `id` needs; undefined when it needs none (or the sources do not say) */
    dependencyMinimum(id: string, version: string, dependency: string): Promise<string | undefined>;
```

d) Replace everything from `const PACKAGES_FAILED = ...` down to (and including) the end of `addPackages` (the line `    return true;\n}` after the Grpc.Tools marking) with:
```ts
const PACKAGES_FAILED = 'Once the package sources can be reached, add the same reference again: that adds the missing packages.';
const PROTOBUF = 'Google.Protobuf';

/**
 * What adding the packages came to: added, failed (see the output), or kept: the user did not want the project's older
 * Google.Protobuf raised, so nothing was added (`message` says why)
 */
type PackagesOutcome = { readonly kind: 'added' | 'failed' } | { readonly kind: 'kept'; readonly message: string };

/**
 * Add on a file the project references already: adds the packages the reference needs and the project lacks (an Add
 * whose packages failed, e.g. offline, is finished this way); else says it is a reference already
 */
async function completeExistingReference(
    projectPath: string, protoPath: string, services: GrpcServices, refusal: string, projectXml: string, host: GrpcHost,
): Promise<boolean> {
    const name = path.basename(protoPath);
    const referenced = await host.referencedPackages(projectPath);
    const ids = grpcPackages(services, isWebProject(projectXml), referenced.map(entry => entry.id));
    if (ids.length === 0) {
        host.info(refusal);
        return false;
    }
    return host.progress(`Adding the packages of gRPC reference ${name}...`, async () => {
        host.log(`${name} is a gRPC reference of ${path.basename(projectPath)} already, but ${ids.join(', ')} ${ids.length === 1 ? 'is' : 'are'} missing.`);
        const outcome = await addPackages(projectPath, ids, referenced, host);
        await host.reevaluate(projectPath);
        if (outcome.kind === 'added') {
            host.info(`${name} was a gRPC reference already; its missing packages were added. The code is generated when the project builds.`);
        } else if (outcome.kind === 'kept') {
            host.info(`${name} is a gRPC reference already; its missing packages were not added: ${outcome.message}`);
        } else {
            host.fail(`Adding the packages of gRPC reference ${name} failed. ${PACKAGES_FAILED}`);
        }
        return outcome.kind === 'added';
    });
}

/**
 * The Google.Protobuf the new packages need when the project references an older one (Grpc.AspNetCore 2.84.0 needs
 * 3.35.1 or newer): restoring would fail with NU1605 (package downgrade). Undefined when nothing needs raising.
 */
async function protobufNeeded(
    packages: readonly { id: string; version: string }[], current: string, host: GrpcHost,
): Promise<{ version: string; by: string } | undefined> {
    let needed: { version: string; by: string } | undefined;
    for (const entry of packages) {
        const minimum = await host.dependencyMinimum(entry.id, entry.version, PROTOBUF);
        if (minimum && VersionUtils.isOutdated(current, minimum) && (!needed || VersionUtils.isOutdated(needed.version, minimum))) {
            needed = { version: minimum, by: `${entry.id} ${entry.version}` };
        }
    }
    return needed;
}

/**
 * Adds the packages the reference needs and the project lacks. A Google.Protobuf of the project older than they need
 * is raised first, after asking (else nothing is added).
 */
async function addPackages(projectPath: string, ids: readonly string[], referenced: readonly ReferencedPackage[], host: GrpcHost): Promise<PackagesOutcome> {
    if (ids.length === 0) {
        return { kind: 'added' };
    }
    const packages: { id: string; version: string }[] = [];
    for (const id of ids) {
        const version = await host.latestVersion(id);
        if (!version) {
            host.log(`${id} was not found on the package sources.`);
            return { kind: 'failed' };
        }
        packages.push({ id, version });
    }
    const project = path.basename(projectPath, path.extname(projectPath));
    const current = referenced.find(entry => entry.id.toLowerCase() === PROTOBUF.toLowerCase())?.version;
    const needed = current ? await protobufNeeded(packages, current, host) : undefined;
    if (current && needed) {
        if (!await host.ask(`${needed.by} needs ${PROTOBUF} ${needed.version} or newer; ${project} has ${current}.`,
            `Raise ${PROTOBUF} to ${needed.version}? Restoring the project fails otherwise (NU1605, package downgrade).`, `Raise to ${needed.version}`)) {
            host.log(`${PROTOBUF} ${current} of ${project} was kept: ${ids.join(', ')} not added.`);
            return {
                kind: 'kept',
                message: `${needed.by} needs ${PROTOBUF} ${needed.version} or newer and ${project} keeps ${current}. `
                    + 'Raise Google.Protobuf, then add the same reference again: that adds the missing packages.',
            };
        }
        // First: `dotnet add package` restores after each package, and the gRPC one would fail with the old version
        packages.unshift({ id: PROTOBUF, version: needed.version });
    }
    host.log(`Adding ${packages.map(entry => `${entry.id} ${entry.version}`).join(', ')} to ${path.basename(projectPath)}`);
    const results = await host.installPackages(projectPath, packages);
    results.forEach(result => host.log(result.message));
    if (results.some(result => !result.success)) {
        return { kind: 'failed' };
    }
    // Under Central Package Management the reference is written bare: mark Grpc.Tools as dotnet add package does
    if (ids.includes('Grpc.Tools')) {
        const content = fs.readFileSync(projectPath, 'utf8');
        const marked = ensureDevelopmentDependency(content, 'Grpc.Tools');
        if (marked !== content) {
            fs.writeFileSync(projectPath, marked);
        }
    }
    return { kind: 'added' };
}
```

e) In `addGrpcReference`, replace
```ts
        const ids = grpcPackages(services, isWebProject(projectXml), await host.referencedPackages(projectPath));
        const packagesAdded = await addPackages(projectPath, ids, host);
        await host.reevaluate(projectPath);
        if (packagesAdded) {
            host.info(`gRPC reference ${path.basename(protoPath)} added (${services}). The code is generated when the project builds.`);
        } else {
```
with
```ts
        const referenced = await host.referencedPackages(projectPath);
        const ids = grpcPackages(services, isWebProject(projectXml), referenced.map(entry => entry.id));
        const outcome = await addPackages(projectPath, ids, referenced, host);
        await host.reevaluate(projectPath);
        if (outcome.kind === 'added') {
            host.info(`gRPC reference ${path.basename(protoPath)} added (${services}). The code is generated when the project builds.`);
        } else if (outcome.kind === 'kept') {
            host.info(`gRPC reference ${path.basename(protoPath)} added, but not its packages: ${outcome.message}`);
        } else {
```

f) In `vscodeGrpcHost`, replace the body of `referencedPackages`'s evaluation branch and fallback:
```ts
        const packages = await ProjectItemsService.instance.evaluatePackages(projectPath);
        if (packages) {
            return packages.references.map(reference => reference.id);
        }
        // No evaluation: the project file's own references
        return [...fs.readFileSync(projectPath, 'utf8').matchAll(/<PackageReference\b[^>]*\bInclude\s*=\s*"([^"]+)"/gi)].map(match => match[1]);
    },
```
with
```ts
        const packages = await ProjectItemsService.instance.evaluatePackages(projectPath);
        if (packages) {
            return packages.references.map(reference => ({ id: reference.id, version: reference.version }));
        }
        // No evaluation: the project file's own references
        return [...fs.readFileSync(projectPath, 'utf8').matchAll(/<PackageReference\b([^>]*)>/gi)].flatMap(match => {
            const id = /\bInclude\s*=\s*"([^"]+)"/i.exec(match[1])?.[1];
            return id ? [{ id, version: /\bVersion\s*=\s*"([^"]*)"/i.exec(match[1])?.[1] ?? '' }] : [];
        });
    },
```
and after the `latestVersion: async id => { ... },` entry add:
```ts
    dependencyMinimum: async (id, version, dependency) => {
        const details = await PackageBrowseService.getPackageDetails(id);
        const versionKey = Object.keys(details?.dependencies ?? {}).find(candidate => candidate.toLowerCase() === version.toLowerCase());
        const minimums = (versionKey ? details!.dependencies![versionKey] : [])
            .filter(entry => entry.id.toLowerCase() === dependency.toLowerCase())
            .map(entry => rangeMinimum(entry.range))
            .filter((minimum): minimum is string => !!minimum);
        // Per target framework: the highest
        return minimums.sort((a, b) => VersionUtils.compare(a, b))[0];
    },
```
(`VersionUtils.compare` sorts descending, so `[0]` is the highest. `getPackageDetails` is cached for 10 minutes, so `latestVersion` and `dependencyMinimum` of the same package fetch once.)

- [ ] **Step 6: Run to verify it passes**

Run: `npx jest src/test/unit/services/grpc src/test/unit/services/nuget/packageDetails.test.ts`
Expected: PASS (88 tests incl. Task 10's).

- [ ] **Step 7: Docs**

`docs/connected-services.md`, "### Packages": replace `Packages the project already references, or gets from one it references, are left alone. With Central` with:
```markdown
Packages the project already references, or gets from one it references, are left alone. When the project references an older `Google.Protobuf` than the new packages need (Grpc.AspNetCore 2.84.0 needs 3.35.1 or newer), restoring would fail with NU1605 (package downgrade): you are asked first, and **Raise to 3.35.1** raises it to the lowest version they need before they are added; when you keep your version, the reference is added without its packages and the message says what to raise. With Central
```

`docs/manual-testing.md`, append unticked:
```markdown
- [ ] Add gRPC reference to a project that pins an older Google.Protobuf (copy of `src/__fixtures__/grpc`, `Web.csproj` with `<PackageReference Include="Google.Protobuf" Version="3.20.0" />`): Web > Add Service Reference... > gRPC > `shared/greet.proto` > Both asks to raise Google.Protobuf to the version Grpc.AspNetCore needs; Raise sets that version and adds Grpc.AspNetCore, `dotnet build` succeeds (no NU1605); Cancel adds only the `<Protobuf>` item and says to raise Google.Protobuf; the same with `Google.Protobuf` in a `Directory.Packages.props` (the `PackageVersion` is raised, other projects that use it are asked about first)
```

No GIF: one extra modal question with a self-explaining button; the existing `docs/images/grpc.gif` (Add from a URL, Update, Remove) stays correct.

- [ ] **Step 8: Verify and commit**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git add src/services/nuget/types.ts src/services/nuget/nugetV3Service.ts src/services/grpc/protobufReferences.ts src/services/grpc/grpcReferenceService.ts src/test/unit/services/nuget/packageDetails.test.ts src/test/unit/services/grpc/protobufReferences.test.ts src/test/unit/services/grpc/grpcReferenceService.test.ts src/test/unit/services/grpc/grpcReferenceUpdate.test.ts docs/connected-services.md docs/manual-testing.md
git commit -m "gRPC references: raise an older Google.Protobuf the new packages need, after asking (no NU1605)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: exit 0 (in the planning scratch copy, with Tasks 10 and 11 applied to HEAD: 156 suites, 1365 tests).

---

### Task 12: The path casing tests run both branches on every system

**Files:**
- Modify: `src/test/unit/services/projectItems/folderLayout.test.ts`

**Repro (done while planning):** the test "bin and obj are hidden by any casing ..." picks its expectation from `process.platform` (`ignoresCase ? ... : ...`), so on Linux only the case-sensitive expectation is checked. Proof: with `isBuildOutput` in `src/services/projectItems/folderLayout.ts` broken on purpose to `BUILD_OUTPUT_FOLDERS.includes(name)` (case-sensitive, wrong on Windows and macOS), the current `folderLayout.test.ts` still passes on Linux (12/12); the rewritten test below fails twice (win32 and darwin). `pathKey` reads `process.platform` when it is called, and `projectItems.test.ts` already overrides it with `Object.defineProperty(process, 'platform', { value })`: the same is used here. The items must be parsed after the override (their keys are made at parse time).

- [ ] **Step 1: Rewrite the test**

In `src/test/unit/services/projectItems/folderLayout.test.ts` replace
```ts
const items = parseMsbuildItems(JSON.stringify({
    Items: {
        Compile: [
            { Identity: 'Program.cs', FullPath: at('Program.cs') },
            { Identity: 'Sub\\Util.cs', FullPath: at('Sub', 'Util.cs') },
            { Identity: '..\\Shared\\Shared.cs', FullPath: path.resolve('/work/Shared/Shared.cs'), Link: 'Linked\\Shared.cs' },
        ],
    },
}), dir);
```
with
```ts
const itemsJson = JSON.stringify({
    Items: {
        Compile: [
            { Identity: 'Program.cs', FullPath: at('Program.cs') },
            { Identity: 'Sub\\Util.cs', FullPath: at('Sub', 'Util.cs') },
            { Identity: '..\\Shared\\Shared.cs', FullPath: path.resolve('/work/Shared/Shared.cs'), Link: 'Linked\\Shared.cs' },
        ],
    },
});
const items = parseMsbuildItems(itemsJson, dir);
```
and replace
```ts
    // pathKey compares case-sensitively on Linux, so Bin/OBJ are ordinary folders there
    const ignoresCase = process.platform === 'win32' || process.platform === 'darwin';
    test('bin and obj are hidden by any casing without Show All Files, shown with it (where paths ignore case)', () => {
        const mixed = [folder('Bin'), folder('OBJ')];
        const all = new Set<string>(); // empty folders count as included unless they are build output
        expect(summary(layoutFolder(dir, mixed, items, false, all))).toEqual(
            ignoresCase ? ['Linked:linked'] : ['Bin:included', 'OBJ:included', 'Linked:linked']);
        expect(summary(layoutFolder(dir, mixed, items, true, all))).toEqual(
            ignoresCase ? ['Bin:excluded', 'OBJ:excluded', 'Linked:linked'] : ['Bin:included', 'OBJ:included', 'Linked:linked']);
    });
```
with
```ts
    // pathKey reads process.platform when it is called: every branch runs on every system
    describe('bin and obj in another casing', () => {
        const original = process.platform;
        const setPlatform = (value: string) => Object.defineProperty(process, 'platform', { value });
        afterEach(() => setPlatform(original));
        const mixed = [folder('Bin'), folder('OBJ')];
        const all = new Set<string>(); // empty folders count as included unless they are build output

        test.each(['win32', 'darwin'])('are build output on %s (paths ignore case): hidden without Show All Files, excluded with it', platform => {
            setPlatform(platform);
            const caseless = parseMsbuildItems(itemsJson, dir);
            expect(summary(layoutFolder(dir, mixed, caseless, false, all))).toEqual(['Linked:linked']);
            expect(summary(layoutFolder(dir, mixed, caseless, true, all))).toEqual(['Bin:excluded', 'OBJ:excluded', 'Linked:linked']);
        });

        test('are ordinary folders on linux (paths respect case)', () => {
            setPlatform('linux');
            const cased = parseMsbuildItems(itemsJson, dir);
            expect(summary(layoutFolder(dir, mixed, cased, false, all))).toEqual(['Bin:included', 'OBJ:included', 'Linked:linked']);
            expect(summary(layoutFolder(dir, mixed, cased, true, all))).toEqual(['Bin:included', 'OBJ:included', 'Linked:linked']);
        });
    });
```

- [ ] **Step 2: Run it, and see it catch a case-sensitive `isBuildOutput`**

Run: `npx jest src/test/unit/services/projectItems/folderLayout.test.ts`
Expected: PASS (14 tests).

Then, only as a check (do not commit): change `isBuildOutput` in `src/services/projectItems/folderLayout.ts` to `const isBuildOutput = (name: string) => BUILD_OUTPUT_FOLDERS.includes(name);`, run the same command: FAIL in "are build output on win32" and "are build output on darwin". Undo it: `git checkout src/services/projectItems/folderLayout.ts`.

- [ ] **Step 3: Verify and commit**

No docs: test-only change.
```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git add src/test/unit/services/projectItems/folderLayout.test.ts
git commit -m "Tests: the bin/obj casing tests run the Windows, macOS and Linux branches on every system

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: exit 0.

---

### Task 13: Roadmap and history; final verification and push

**Files:**
- Modify: `docs/roadmap.md`, `docs/history.md`

- [ ] **Step 1: History**

Append to the end of `docs/history.md` (after the "Phase 21: Connected Services, Part 2" section):
```markdown

## Phase 21, Part 3: Known bugs
**Goal**: The bugs found along the way, fixed before the code review of Phase 22.

- [x] A failed MSBuild evaluation (a timeout, a half-saved project file) was cached as "no item list" until the project changed again: it is now retried after 5 s, 30 s and 2 min, and after that whenever a folder of the project is expanded; a success clears it
- [x] Exclude From Project / Include In Project on a file or folder in the folder of a nested project, from the outer project's tree, edited the nested project's file: file and folder ids in a nested project's folder carry the project whose tree shows them (other ids unchanged), and Exclude/Include and the folder expansion use it
- [x] Item matching in the project file found only self-closing items: block-form items (`<Compile Remove="Old.cs"></Compile>`, items with metadata children) are found now, so Include In Project deletes such a `Remove` and Exclude From Project sees it (a `Remove` with child elements is an MSBuild error, MSB4162)
- [x] After a new item list the expanded folders are read again parents first (by depth), not in the order they were first expanded
- [x] The bin/obj casing tests (`folderLayout.test.ts`) run the Windows, macOS and Linux branches on every system (`process.platform` overridden)
- [x] After a drop the target (a collapsed solution folder, folder or project) opens and the moved nodes are selected, also when their ids change (`.slnx` folders without `Id`) and when a moved file only shows after its project's next evaluation; the drag & drop GIF was captured again
- [x] No grey hover highlight stays behind after a drag & drop: the cause was Chromium moving `:hover` to the drag's start position right after the drop (a `mouseover` without movement), so the highlight is a class the tree sets from mouse events
- [x] Central packages: an edit in the NuGet manager evaluated each affected project twice (measured: 9 MSBuild runs for 5 projects, the watchers reacting to the extension's own write while the restore ran); files the extension writes are recorded with their stamp and the watchers skip them, so the re-evaluation after the restore is the only one
- [x] Delete on a linked file warns that it deletes the real file outside the project (with its path and the projects that then miss it) and offers Remove Link; the new Remove Link command removes only the item from the project file (links from wildcards or props files are left alone with a message)
- Checked, not reproducible: "Show All Files is read from a global that is set to the new solution only after it has loaded". Opening a second solution reads no folder before `ShowAllFiles.setSolution`, which runs right after the solution is ready (measured with the real `SolutionService`: 0 folder reads while it loaded); comes back with a repro

## Phase 21, Part 4: Limitations we could fix
**Goal**: Small limitations, no design needed.

- [x] The Test Explorer uses a project's `.runsettings` file (`RunSettingsFilePath`, read in the test project evaluation): VSTest gets everything but data collectors and loggers (`DesignMode` stays ours), and VSTest projects sharing the file run in one session so `MaxCpuCount` runs their assemblies in parallel (3.7 s instead of 7.1 s for two assemblies of 3 s each); MSTest and NUnit runner apps (VSTest bridge) get `--settings` with a cleaned copy and the file's environment variables on the process; xUnit v3/TUnit don't read run settings; coverage stays a script
- [x] gRPC references: when the project has an older `Google.Protobuf` than the new packages need (NU1605 at restore), it asks and raises it to the lowest version they need, through the Central Package Management aware installs; kept, the reference is added without its packages and the message says what to raise
- [x] gRPC references: a case-only duplicate (`a.proto` / `A.PROTO`) was already refused on Windows and macOS (`pathKey`); a test now proves it
```

- [ ] **Step 2: Roadmap**

In `docs/roadmap.md`:
- Remove the sections "## Phase 21, Part 3: Known bugs" and "## Phase 21, Part 4: Limitations we can fix" (headings and items).
- The intro sentence `Phase 21, Parts 3 to 5 are the known bugs and the limitations we can and want to fix, phase 22 quality and documentation,` becomes `Phase 21, Part 5 is the limitations we want to fix, phase 22 quality and documentation,` (the rest of the paragraph stays).
- Under "## Known bugs", `Bugs found later are listed here, to be fixed. The ones found so far are in Phase 21, Part 3.` becomes `Bugs found later are listed here, to be fixed.`

Check that nothing else links to the removed sections:
```bash
grep -rn "Part 3\|Part 4\|part-3\|part-4" docs README.md DEVELOPER.md | grep -v "docs/history.md\|docs/superpowers"
```
Expected: no output.

- [ ] **Step 3: Read the changed docs once more**

`docs/solution-explorer.md` got sentences from Tasks 1, 3, 4, 5 and 7, `docs/manual-testing.md` an entry from Tasks 1, 3–9 and 11: read them in place, check the order and that no sentence says something the tasks did not build. `README.md` stays as it is (a store page; Remove Link is in the generated menu reference, not a feature of its own).

- [ ] **Step 4: Final verification and push**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git status --short
git add docs/roadmap.md docs/history.md
git commit -m "Phase 21, Parts 3 and 4: known bugs and small fixes done

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push origin master
```
Expected: exit 0 (while planning, all tasks together: 163 suites, 1441 tests); `git status --short` shows nothing of this work (other agents' untracked files may remain). After the push check that the GitHub pipeline is green (Windows included): `gh run list --limit 1`, then `gh run watch` if it is still running. Windows watch-outs: the tests build paths with `path.join`/`path.resolve`; the platform overrides (Tasks 10, 12) restore `process.platform` in `finally`; `inNestedProject` and the reveal after a drop compare paths with `path.relative`/`path.normalize`; the real-dotnet tests are skipped where `dotnet` is missing.

---

## Self-review (done while writing)

- **Roadmap coverage, Part 3:** MSBuild failure cached → Task 1 (retry with backoff and on expand, as the item suggests); nested project Exclude/Include → Task 4 (the clicked project, files and subfolders; folders holding a project stay refused); block-form items → Task 3 (Include deletes a block `Remove`, Exclude sees it, items with metadata children found; `Remove` with children is invalid MSBuild); `reloadLoadedFolders` order → Task 2; Show All Files global → dropped, not reproducible (evidence above, recorded in the history by Task 13); casing tests on Linux → Task 12; collapsed solution folder after a drop → Task 7 (expand and select, generalised to every drop as Visual Studio does); hover highlight → Task 6 (different cause, evidence above); double evaluation → measured, real, Task 8 (not a debounce, evidence above); Delete on a linked file → Task 5 (warning with the real path and Remove Link, both as a button of the question and as a command in `contextMenus.ts` with `npm run generate:menus`, menu and command descriptions).
- **Roadmap coverage, Part 4:** run settings → Task 9 (`RunSettingsFilePath` from the Test Explorer's own MSBuild query, VSTest without data collectors, the MTP decision made after trying it); gRPC `Google.Protobuf` → Task 11 (reproduced NU1605 for Grpc.AspNetCore, which needs `Google.Protobuf [3.35.1, )`; client-only references were fine); case-only duplicate → Task 10 (already handled, a test proves it).
- **User decisions kept:** Remove Link as a separate command and a clear warning in Delete (Task 5); run settings without data collectors, coverage stays a script (Task 9; passing more than `RunConfiguration` is listed as a deviation and open question 3); the MTP path checked and decided (Task 9).
- **Webview rules:** Task 6 changes only webview components and CSS (no `vscode`/Node imports); Task 7's `selectNode` gets opaque ids from the host, which alone finds the moved nodes (`revealDrop` in the extension host); node ids are decoded only in the extension host (Task 4's `project` field is read in `solutionActionService`/`solutionExpansionService`). `opaqueNodeIds.test.ts` and `webviewBundle.test.ts` pass with all tasks.
- **Overlaps between tasks:** `Project.ts` (Tasks 1, 2, 4, 5, 8) and `solutionActionService.ts` (Tasks 4, 5, 7) are changed in different regions; Tasks 5 and 7 both add an import after the `./grpc/grpcReferenceService` import (the anchor stays). Applying all tasks in order in the scratch copy needed no change to any snippet.
- **Placeholders:** none in code. Task 7's GIF scene was run while planning (own Xvfb `:97`); its click positions may need tuning on another machine, as in earlier scenes.
- **Type consistency:** `RETRY_DELAYS_MS`/`retryDue`/`retryDelay` (Task 1) are used by `Project` only; the optional `project` of `FileNodeId`/`FolderNodeId` (Task 4) by `toProjectChild`, `_handleItemMembership` and the folder expansion; `LINKED_ITEM` and `removeLink` (Task 5) by `contextMenus.ts`, `Project.toProjectChild` and `handleProjectAction`; `DropResult` (Task 7) by `moveNodes`, `SolutionWebviewProvider` and `revealDrop`; `OwnWrites` (Task 8) by `applyPackageEdits`, the props handler, `CentralPackageWatchers` and `Project`; `NuGetPackage.dependencies` (Task 11) is read by `grpcReferenceService` only; `packageSharedService` copies named fields into the webview messages, so they do not grow.
