# Phase 21, Part 5 and Two Startup/Tree Bugs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four limitations of `docs/roadmap.md` "Phase 21, Part 5" and two of its "Known bugs" (the startup project after a startup profile goes away, the missing Dependencies node) before the code review of Phase 22. Each item was reproduced first (real `dotnet`/MSBuild, the real code driven from Jest, a real VS Code in its own Xvfb display for the Error List). One did not reproduce and is dropped with the evidence instead of getting a fix.

**Architecture:** Small changes where the items are:
- Include In Project (Task 1): a new `src/services/projectItems/defaultItems.ts` asks MSBuild which item type (and output metadata) the SDK's own globs would give a file if `DefaultItemExcludes` left nothing out (one evaluation with `DefaultItemExcludes` as a global property); `includeEdit` writes that instead of "`Compile` for `.cs`, `None` for the rest".
- Central packages (Task 2): a `Version="$(Prop)"` is recognised; the property's definition (in `Directory.Build.props`, `Directory.Packages.props` or a file they import, checked against MSBuild's evaluated version) is edited through a new edit kind `setVersionProperty`; when other packages follow the property, or it cannot be edited, the NuGet manager asks first (`src/services/nuget/versionProperties.ts`).
- Tree (Task 3): every project shows Dependencies; Add Service Reference... joins its menu (`src/core/contextMenus.ts`, `npm run generate:menus`).
- Drag & drop (Task 4): a project dropped onto another project's Dependencies (or Projects under it) adds a project reference (`dropRules.ts` gets the `link` effect, `solutionDropNodes.ts` knows Dependencies, `moveNodes` calls a new `src/services/projectReferences.ts` that refuses self, duplicate and circular references before `dotnet add reference`).
- Startup (Task 5): when a startup profile stops being used and no single startup project was ever set, the first project of the solution that can be started becomes the startup project, with a message.
- Task 6 moves the finished items to the history, pushes and watches CI.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`/`noUnusedParameters`), VS Code extension API, React webview, Jest (`jsdom`, `@testing-library/react`), `dotnet msbuild -getItem/-getProperty`, `dotnet add reference`, `dotnet publish`.

**Verified while planning** (.NET SDK 10.0.111 and 8.0.130, VS Code - OSS 1.136.1 for the Error List repro, 2026-10-23): every code block of Tasks 1–5 was applied to a scratch copy of the repository (`git archive HEAD` of `a26dac7`) in task order and run there: `npm run typecheck` clean, the full Jest suite green (169 suites, 1521 tests, up from 163 / 1479; the real-MSBuild and real-dotnet tests included), `npm run build:dev` exit 0. For each task, the task's tests were also run on the code before the task, giving the failures written in its Step 2. The repro of each item is in its task ("Repro (done while planning)").

**Items dropped or changed (with the evidence):**
- **Dropped, not reproducible: "Building a single project does not clear stale build errors that an earlier solution build reported for other projects".** Reproduced in a real VS Code - OSS 1.136.1 (own Xvfb display `:96`, own `--user-data-dir`/`--extensions-dir` in `/tmp`, a copy of a solution with two class libraries A and B, each with a `CS0029` error, no C# extension so only build problems exist), the extension of this repository and a small probe extension that ran the extension's own `shinobi-dotnet` tasks (`$msCompile`) and read `vscode.languages.getDiagnostics()` 2 s after each task ended: `build Sol` → A and B have `CS0029`; fix A on disk, `build B` → only B (A's stale error is **gone**); `build Sol` again, then `build B` with nothing fixed → only B (A's still valid error is gone too); fix B, `build B` → nothing. VS Code clears every `$msCompile` problem of earlier task runs whenever a task with that matcher ends (the problem matcher's owner is shared), so stale errors of other projects never stay. The opposite happens (a project build drops the other projects' still valid errors); Visual Studio clears its build errors at the start of each build too, as far as known (not checked in Visual Studio). The roadmap item moves to the history as "checked, not reproducible" (Task 6). See open question 1.
- **Changed, wider than the item: Include In Project.** The item asked for `Content` for web files. The plan uses the type MSBuild itself gives the file without the exclude (`Content` for `.cshtml`, `.razor`, `.json`, `wwwroot/**` in a Web SDK project; `None` for the same `.cshtml` in a plain SDK project; `EmbeddedResource` for `.resx`; `Compile` for `.cs`) **and** the output metadata of the SDK's glob (`CopyToOutputDirectory`, `CopyToPublishDirectory`, `ExcludeFromSingleFile`): with only `<Content Include="Pages\Legacy\data.json" />` the file was not copied to the publish folder (the Web SDK puts `CopyToPublishDirectory` on its glob, an explicit item gets nothing), with the metadata the publish and build output equal those of the project without the exclude.
- **Changed: central versions as a property.** Not only "shared by several packages": a property only the edited package uses is edited too (no question), since writing a literal over it is the same loss. `dotnet add package` (SDK 10.0.111) replaces `$(SerilogVersion)` with a literal on the edited package only, exactly like the extension does now, so this goes beyond the CLI; what Visual Studio's NuGet manager does was not checked (no Visual Studio here). Consolidate goes through the same question.
- **Changed: Dependencies node.** Shown on every project, old-style projects too (they showed none when they had no references; Visual Studio always shows References there). Analyzers was already always listed under Dependencies. **Frameworks** (`Microsoft.NETCore.App`, `Microsoft.AspNetCore.App`) is not added: it needs `FrameworkReference` items from the evaluation and a node type without Remove; see open question 3.
- **Changed: startup fallback.** Visual Studio's default is the first project of the solution file, even a library that then cannot start (as far as known); the plan takes the first project that can be started (not a library, not a test project, not unloaded) and says so in a message and in the log.

**Open questions for the user** (the plan goes ahead with the choice in brackets):
1. Error List: VS Code drops the build errors of the other projects when one project is built. Keep that (it matches Visual Studio's "a build clears the build errors", unverified), or keep the other projects' build errors until they are built again (needs our own problem collection per project)? [keep, item dropped]
2. Central versions as a property: is "Change SerilogVersion / Set Serilog Only" the right question? For a property only Serilog uses nothing is asked. [as planned]
3. Frameworks under Dependencies (`Microsoft.NETCore.App`, `Microsoft.AspNetCore.App`, like Visual Studio): add to Phase 23, or build now? An explicit `<FrameworkReference>` in a project file is counted today but shown nowhere. [Phase 23, added by Task 6]
4. Add Project Reference... still uses a terminal with `dotnet add reference` and no circle check. Switch it to `addProjectReferences` of Task 4 (same refusals as the drop)? [left as is; Known bug added by Task 6]
5. A drop of a project onto Dependencies opens and selects nothing (the reference shows after the project file watcher); open Dependencies > Projects like Visual Studio? [no]

**Conventions to follow (from CLAUDE.md and the memory notes):**
- Tests: `npx jest <path>`; the full suite is `npm test`; `npm run typecheck` before each commit. `noUnusedLocals`/`noUnusedParameters` break the build.
- `npm run build:dev` builds two configurations: judge it by its exit code (`; echo "exit $?"`), not by its output.
- Extension-host tests mock `vscode` per file with `jest.mock('vscode', () => ({ … }), { virtual: true })`.
- Real-MSBuild/real-dotnet tests are skipped without `dotnet` (`spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip`), with a 150 s timeout. They need no network (no packages are restored; the Web SDK restore of Task 1 is offline).
- Windows is a CI gate: build every path in tests with `path.join`/`path.resolve`; file contents stay text. Task 1 passes `-property:DefaultItemExcludes="bin/**;obj/**;**/node_modules/**"` with the quotes inside the argument (MSBuild splits an unquoted value at `;`: `MSB1006`); `execFile` on Windows keeps the quotes for MSBuild, which only the Windows CI run proves.
- Webview code must not import `vscode`, Node modules or `nodeIdService`, and must not decode node ids. Task 4's drop rule in the webview reads only `type` and `contextValue` (`projects`) of the tree nodes; `src/core/dropRules.ts` stays type-imports only.
- Task 3 changes `src/core/contextMenus.ts`: run `npm run generate:menus` and commit `package.json` and `docs/context-menus.md` with it.
- Changes to existing files are given as unified diffs against the state after the earlier tasks (the plan's starting point is `a26dac7`). Apply a block with `git apply` (save it to a file, e.g. `/tmp/step.diff`, then `git apply /tmp/step.diff`) or by hand; new files are given in full.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Commit to `master`, push after the last task. `git add` only the files of the task, by path: other agents may have uncommitted work in the tree (untracked plan files are there now).
- Every task that changes what a user sees has a docs step (its page, an unticked `docs/manual-testing.md` entry). **No task needs a GIF**: Task 1 changes text in the project file, Task 2 a question, Task 3 one more row in the tree and one menu entry (the menu reference is generated), Task 4 a gesture the drag and drop table describes (the existing `docs/images/drag-and-drop.gif` stays valid: its scene moves files and projects only), Task 5 a message. Several tasks append to `docs/manual-testing.md` and `docs/solution-explorer.md`; the anchors are text, so the tasks apply in order.
- Only verifiable by hand (the user cannot test in the next days, so each task says what): native menus, the drag pointer in a real webview, F5 itself, the NuGet manager's modal. These go to `docs/manual-testing.md`, unticked.

---

## File structure

| File | Task | Responsibility |
|---|---|---|
| `src/services/projectItems/defaultItems.ts` (create) | 1 | `itemsWithoutExcludes`, `parseNewItems`, `newItemFor`, `KEPT_METADATA` |
| `src/services/projectItems/projectItemEdits.ts`, `src/parsers/projectFileEditor.ts` (modify) | 1 | `includeEdit` takes the new items; `includeItem` writes metadata attributes |
| `src/services/solutionActionService.ts` (modify) | 1, 4 | Include In Project asks MSBuild (1); `moveNodes` adds references for `link` drops (4) |
| `src/services/nuget/centralPackageEdits.ts` (modify) | 2 | `setVersionProperty` edit kind, `writtenVersion`, `propertyReference`, `propertyDefinitions`, `setVersionProperty`, `packagesUsingProperty`, `propertyUseCount` |
| `src/services/nuget/versionProperties.ts` (create) | 2 | `findVersionProperties`, `propertyQuestion`, `propertyEdit`, `changesOnlyItself` |
| `src/services/nuget/centralPackages.ts`, `centralPackagePlan.ts`, `centralPackageOperations.ts` (modify) | 2 | `buildPropsPath` from the evaluation; the question in Install/Update and Consolidate; projects below an edited `Directory.Build.props` evaluated again |
| `src/core/Project.ts`, `src/core/contextMenus.ts` (modify), `package.json`, `docs/context-menus.md` (generated) | 3 | Dependencies always; Add Service Reference... on it |
| `src/core/dropRules.ts`, `src/services/solutionDropNodes.ts`, `src/webview/solution-view/components/SolutionTree.tsx` (modify), `src/services/projectReferences.ts` (create) | 4 | the `link` effect, Dependencies as a drop target, reference checks and `dotnet add reference` |
| `src/services/startupProfiles/startProfile.ts` (modify) | 5 | `defaultStartupProject`, the fallback in `doRefreshStartup` |
| `docs/solution-explorer.md`, `docs/nuget.md`, `docs/run-and-debug.md`, `docs/manual-testing.md`, `docs/roadmap.md`, `docs/history.md` | 1–6 | docs, manual checks, roadmap and history |

Tests: new files `defaultItems.test.ts`, `defaultItems.msbuild.test.ts` (1), `versionProperties.test.ts`, `versionProperties.msbuild.test.ts`, `centralPackageOperations.properties.test.ts` (2), `projectReferences.test.ts` (4); additions to `projectItemEdits.test.ts` (1), `centralPackageEdits.test.ts` (2), `Project.items.test.ts` (3), `dropRules.test.ts`, `moveNodes.test.ts`, `SolutionTreeDragDrop.test.tsx` (4), `startupProfileLaunch.test.ts` (5).

---

### Task 1: Include In Project uses the item type MSBuild would give the file

**Files:**
- Create: `src/services/projectItems/defaultItems.ts`
- Modify: `src/services/projectItems/projectItemEdits.ts`, `src/parsers/projectFileEditor.ts`, `src/services/solutionActionService.ts`
- Test: `src/test/unit/services/projectItems/defaultItems.test.ts`, `src/test/unit/services/projectItems/defaultItems.msbuild.test.ts` (create), `src/test/unit/services/projectItems/projectItemEdits.test.ts` (modify)
- Docs: `docs/solution-explorer.md`, `docs/manual-testing.md`

Repro (done while planning): a `dotnet new webapp` project (net10.0) with `<DefaultItemExcludes>$(DefaultItemExcludes);Pages\Legacy\**;wwwroot\old\**</DefaultItemExcludes>` and `Pages/Legacy/{Hello.cshtml, Hello.cshtml.cs, Strings.resx, data.json, notes.txt, Comp.razor}`, `wwwroot/old/{site.css, app.js, index.html}`. The real `includeEdit` (driven from Jest) on both folders wrote `<None Include=...>` for everything but `Hello.cshtml.cs` (`Compile`); `dotnet publish` then had no `Hello from legacy` in `Web.dll` (page not compiled), no `Web.Pages.Legacy.Strings.resources` (resource not embedded), no `wwwroot/old` and no `data.json` in the publish folder. `dotnet msbuild -getItem:... -property:DefaultItemExcludes=` (excludes emptied) gives `Content` for `Hello.cshtml`, `Comp.razor`, `data.json` and the three `wwwroot/old` files, `EmbeddedResource` for `Strings.resx`, `None` for `notes.txt`, with `CopyToPublishDirectory=PreserveNewest` (and `CopyToOutputDirectory` on `data.json`, `ExcludeFromSingleFile=true` on all `Content`). Writing those types without metadata compiled the page and embedded the resource, but `data.json` was still missing from the publish and build output; with the metadata, the publish and `bin` file lists equal those of the same project without the exclude. Explicit items get none of this metadata (it is on the SDK's globs, not in an `ItemDefinitionGroup`: an explicit `<Content Include="Pages\Legacy\data.json" />` evaluates without it). An unquoted `-property:DefaultItemExcludes=bin/**;obj/**` fails with `MSB1006: Property is not valid. Switch: obj/**`; quoted it works.

What Visual Studio does was not checked here (no Visual Studio on Linux); its project system picks the build action from the file's kind in the same way (Content for web files in web projects), as far as known.

- [ ] **Step 1: Write the failing tests**

Create `src/test/unit/services/projectItems/defaultItems.msbuild.test.ts`:
```ts
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { itemsWithoutExcludes, newItemFor } from '../../../../services/projectItems/defaultItems';
import { includeEdit, listFilesUnder } from '../../../../services/projectItems/projectItemEdits';

/** Include In Project against the real SDK: the item types MSBuild gives, and that the build and publish then use the files */
const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip;
const TIMEOUT = 150000;

describe('Include In Project with the item types of the SDK (real MSBuild)', () => {
    let root: string;
    let dir: string;
    let projectPath: string;
    const at = (...parts: string[]) => path.join(dir, ...parts);
    const write = (file: string, content: string) => {
        fs.mkdirSync(path.dirname(at(file)), { recursive: true });
        fs.writeFileSync(at(file), content);
    };

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'default-items-')));
        dir = path.join(root, 'Web');
        projectPath = path.join(dir, 'Web.csproj');
        write('Web.csproj', `<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <DefaultItemExcludes>$(DefaultItemExcludes);Pages\\Legacy\\**;wwwroot\\old\\**</DefaultItemExcludes>
  </PropertyGroup>

</Project>
`);
        write('Program.cs', 'var app = WebApplication.CreateBuilder(args).Build();\napp.MapRazorPages();\napp.Run();\n');
        write('Pages/_ViewImports.cshtml', '@addTagHelper *, Microsoft.AspNetCore.Mvc.TagHelpers\n');
        write('Pages/Legacy/Hello.cshtml', '@page\n@model Web.Pages.Legacy.HelloModel\n<h1>Hello from legacy</h1>\n');
        write('Pages/Legacy/Hello.cshtml.cs', 'using Microsoft.AspNetCore.Mvc.RazorPages;\nnamespace Web.Pages.Legacy;\npublic class HelloModel : PageModel { public void OnGet() { } }\n');
        write('Pages/Legacy/Strings.resx', '<?xml version="1.0" encoding="utf-8"?>\n<root>\n  <data name="Greeting" xml:space="preserve"><value>Hi</value></data>\n</root>\n');
        write('Pages/Legacy/data.json', '{}\n');
        write('Pages/Legacy/notes.txt', 'notes\n');
        write('wwwroot/old/site.css', 'body { }\n');
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    withDotnet('the types and the output metadata MSBuild would give the excluded files', async () => {
        const items = await itemsWithoutExcludes(projectPath);
        expect(newItemFor(at('Pages', 'Legacy', 'Hello.cshtml'), items)).toEqual({ itemType: 'Content', metadata: { CopyToPublishDirectory: 'PreserveNewest', ExcludeFromSingleFile: 'true' } });
        expect(newItemFor(at('Pages', 'Legacy', 'Hello.cshtml.cs'), items)).toEqual({ itemType: 'Compile', metadata: {} });
        expect(newItemFor(at('Pages', 'Legacy', 'Strings.resx'), items)).toEqual({ itemType: 'EmbeddedResource', metadata: {} });
        expect(newItemFor(at('Pages', 'Legacy', 'data.json'), items)).toEqual({
            itemType: 'Content', metadata: { CopyToOutputDirectory: 'PreserveNewest', CopyToPublishDirectory: 'PreserveNewest', ExcludeFromSingleFile: 'true' },
        });
        expect(newItemFor(at('Pages', 'Legacy', 'notes.txt'), items)).toEqual({ itemType: 'None', metadata: {} });
        expect(newItemFor(at('wwwroot', 'old', 'site.css'), items).itemType).toBe('Content');
    }, TIMEOUT);

    withDotnet('in a project of the plain SDK the same .cshtml is None, as MSBuild says', async () => {
        fs.writeFileSync(projectPath, fs.readFileSync(projectPath, 'utf8').replace('Microsoft.NET.Sdk.Web', 'Microsoft.NET.Sdk'));
        expect(newItemFor(at('Pages', 'Legacy', 'Hello.cshtml'), await itemsWithoutExcludes(projectPath)).itemType).toBe('None');
    }, TIMEOUT);

    withDotnet('after Include In Project the page is compiled, the resource embedded and the files published', async () => {
        const items = await itemsWithoutExcludes(projectPath);
        let content = fs.readFileSync(projectPath, 'utf8');
        for (const folder of [at('Pages', 'Legacy'), at('wwwroot', 'old')]) {
            content = includeEdit(content, dir, folder, true, await listFilesUnder(folder), items);
        }
        fs.writeFileSync(projectPath, content);
        const publishDir = path.join(root, 'publish');
        const result = spawnSync('dotnet', ['publish', projectPath, '-o', publishDir, '-nologo'], { cwd: dir, encoding: 'utf8' });
        expect(result.stdout + result.stderr).not.toMatch(/error/i);
        const dll = fs.readFileSync(path.join(publishDir, 'Web.dll'));
        // The page's HTML is a UTF-16 string literal of the compiled view; the resource is embedded by name
        expect(dll.includes(Buffer.from('<h1>Hello from legacy</h1>', 'utf16le'))).toBe(true);
        expect(dll.includes(Buffer.from('Web.Pages.Legacy.Strings.resources'))).toBe(true);
        expect(fs.existsSync(path.join(publishDir, 'Pages', 'Legacy', 'data.json'))).toBe(true);
        expect(fs.existsSync(path.join(publishDir, 'wwwroot', 'old', 'site.css'))).toBe(true);
        expect(fs.existsSync(path.join(publishDir, 'Pages', 'Legacy', 'notes.txt'))).toBe(false);
    }, TIMEOUT);
});
```

Create `src/test/unit/services/projectItems/defaultItems.test.ts`:
```ts
import * as path from 'path';
import { itemsWithoutExcludes, newItemFor, parseNewItems } from '../../../../services/projectItems/defaultItems';

const dir = path.resolve('/work/Web');
const at = (...parts: string[]) => path.join(dir, ...parts);
const output = (items: Record<string, object[]>, properties: Record<string, string> = { TargetFramework: 'net10.0', TargetFrameworks: '' }) =>
    JSON.stringify({ Properties: properties, Items: items });

describe('parseNewItems', () => {
    test('a file listed as None and as another type gets the other type, with the output metadata of that item', () => {
        const items = parseNewItems(output({
            None: [{ FullPath: at('Pages', 'Old.cshtml') }, { FullPath: at('notes.txt') }],
            Content: [{ FullPath: at('Pages', 'Old.cshtml'), CopyToPublishDirectory: 'PreserveNewest', ExcludeFromSingleFile: 'true', DefiningProjectFullPath: '/sdk/x.props' }],
            EmbeddedResource: [{ FullPath: at('S.resx') }],
        }), dir)!;
        expect(newItemFor(at('Pages', 'Old.cshtml'), items)).toEqual({ itemType: 'Content', metadata: { CopyToPublishDirectory: 'PreserveNewest', ExcludeFromSingleFile: 'true' } });
        expect(newItemFor(at('notes.txt'), items)).toEqual({ itemType: 'None', metadata: {} });
        expect(newItemFor(at('S.resx'), items)).toEqual({ itemType: 'EmbeddedResource', metadata: {} });
    });

    test('linked items and types outside the item list are left out; a file MSBuild did not list goes by its extension', () => {
        const items = parseNewItems(output({
            Compile: [{ FullPath: at('Shared.cs'), Link: 'Links/Shared.cs' }],
            PackageReference: [{ Identity: 'Serilog', FullPath: at('Serilog') }],
        }), dir)!;
        expect(items.size).toBe(0);
        expect(newItemFor(at('Shared.cs'), items)).toEqual({ itemType: 'Compile', metadata: {} });
        expect(newItemFor(at('S.resx'), undefined)).toEqual({ itemType: 'EmbeddedResource', metadata: {} });
        expect(newItemFor(at('site.css'), undefined)).toEqual({ itemType: 'None', metadata: {} });
    });

    test('not the JSON result: undefined', () => {
        expect(parseNewItems('error MSB4025: The project file could not be loaded.', dir)).toBeUndefined();
    });
});

describe('itemsWithoutExcludes', () => {
    test('asks MSBuild with DefaultItemExcludes as a global property that keeps only bin, obj and node_modules out', async () => {
        const run = jest.fn().mockResolvedValue(output({ Content: [{ FullPath: at('a.css') }] }));
        const items = await itemsWithoutExcludes(at('Web.csproj'), run);
        expect(run).toHaveBeenCalledTimes(1);
        expect(run.mock.calls[0][1]).toContain('-property:DefaultItemExcludes="bin/**;obj/**;**/node_modules/**"');
        expect(newItemFor(at('a.css'), items).itemType).toBe('Content');
    });

    test('a multi-targeted project is asked again for its first framework', async () => {
        const run = jest.fn()
            .mockResolvedValueOnce(output({}, { TargetFramework: '', TargetFrameworks: 'net8.0;net10.0' }))
            .mockResolvedValueOnce(output({ Compile: [{ FullPath: at('A.cs') }] }));
        const items = await itemsWithoutExcludes(at('Web.csproj'), run);
        expect(run.mock.calls[1][1]).toContain('-property:TargetFramework=net8.0');
        expect(newItemFor(at('A.cs'), items).itemType).toBe('Compile');
    });

    test('MSBuild failing gives undefined', async () => {
        expect(await itemsWithoutExcludes(at('Web.csproj'), jest.fn().mockRejectedValue(new Error('no sdk')))).toBeUndefined();
    });
});
```

Change `src/test/unit/services/projectItems/projectItemEdits.test.ts`:
```diff
diff --git a/src/test/unit/services/projectItems/projectItemEdits.test.ts b/src/test/unit/services/projectItems/projectItemEdits.test.ts
index c93609c..dfaa3ce 100644
--- a/src/test/unit/services/projectItems/projectItemEdits.test.ts
+++ b/src/test/unit/services/projectItems/projectItemEdits.test.ts
@@ -2,7 +2,8 @@ import * as fs from 'fs';
 import * as os from 'os';
 import * as path from 'path';
 import { excludeEdit, inNestedProject, includeEdit, includeItemCount, listFilesUnder, membershipApplied, membershipRefusal } from '../../../../services/projectItems/projectItemEdits';
-import { parseMsbuildItems } from '../../../../services/projectItems/projectItems';
+import { parseMsbuildItems, pathKey } from '../../../../services/projectItems/projectItems';
+import { NewItem } from '../../../../services/projectItems/defaultItems';
 
 const dir = path.resolve('/work/App');
 const at = (...parts: string[]) => path.join(dir, ...parts);
@@ -53,6 +54,18 @@ describe('includeEdit', () => {
         expect(edited).toContain('<Compile Include="Gen\\a.cs" />');
         expect(edited).toContain('<None Include="Gen\\deep\\b.txt" />');
     });
+
+    test('the item type and output metadata come from what MSBuild would give the file without the exclude', () => {
+        const newItems = new Map<string, NewItem>([
+            [pathKey(at('Views', 'Old.cshtml')), { itemType: 'Content', metadata: { CopyToPublishDirectory: 'PreserveNewest', ExcludeFromSingleFile: 'true' } }],
+            [pathKey(at('Views', 'data.json')), { itemType: 'Content', metadata: { CopyToOutputDirectory: 'PreserveNewest' } }],
+        ]);
+        const edited = includeEdit(project, dir, at('Views'), true, [at('Views', 'Old.cshtml'), at('Views', 'data.json'), at('Views', 'S.resx')], newItems);
+        expect(edited).toContain('<Content Include="Views\\Old.cshtml" CopyToPublishDirectory="PreserveNewest" ExcludeFromSingleFile="true" />');
+        expect(edited).toContain('<Content Include="Views\\data.json" CopyToOutputDirectory="PreserveNewest" />');
+        // A file MSBuild did not list goes by its extension
+        expect(edited).toContain('<EmbeddedResource Include="Views\\S.resx" />');
+    });
 });
 
 describe('paths outside the project folder', () => {
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/test/unit/services/projectItems/`
Expected: FAIL, 3 suites: `TS2307: Cannot find module '../../../../services/projectItems/defaultItems'` (in `projectItemEdits.test.ts`, `defaultItems.test.ts`, `defaultItems.msbuild.test.ts`) and `TS2554: Expected 5 arguments, but got 6.` for `includeEdit`.

- [ ] **Step 3: Implement**

Change `src/parsers/projectFileEditor.ts`:
```diff
diff --git a/src/parsers/projectFileEditor.ts b/src/parsers/projectFileEditor.ts
index 6871481..13243c3 100644
--- a/src/parsers/projectFileEditor.ts
+++ b/src/parsers/projectFileEditor.ts
@@ -156,9 +156,9 @@ export class ProjectFileEditor {
         return this.addItemElement(content, itemType, 'Remove', relativePath);
     }
 
-    /** `<Compile Include="path" />`: puts a file the project does not contain into it */
-    static includeItem(content: string, itemType: string, relativePath: string): string {
-        return this.addItemElement(content, itemType, 'Include', relativePath);
+    /** `<Compile Include="path" />`: puts a file the project does not contain into it; `metadata` become attributes */
+    static includeItem(content: string, itemType: string, relativePath: string, metadata: Readonly<Record<string, string>> = {}): string {
+        return this.addItemElement(content, itemType, 'Include', relativePath, metadata);
     }
 
     /**
@@ -166,14 +166,17 @@ export class ProjectFileEditor {
      * `Include` before a later `Remove` of the same file (or the other way round) would change nothing.
      * Goes at the end of the last ItemGroup, or in a new ItemGroup at the end when that one has a Condition.
      */
-    private static addItemElement(content: string, itemType: string, attribute: 'Include' | 'Remove', value: string): string {
+    private static addItemElement(
+        content: string, itemType: string, attribute: 'Include' | 'Remove', value: string, metadata: Readonly<Record<string, string>> = {},
+    ): string {
         const same = this.findItemElements(content, attribute).filter(item => item.itemType === itemType && item.value === value);
         const lastSame = same[same.length - 1];
         // Already there, and no later item of the type undoes it
         if (lastSame && !new RegExp(`<${itemType}\\b`).test(this.blankIgnored(content).slice(lastSame.end))) {
             return content;
         }
-        return this.appendToLastItemGroup(content, indent => [`${indent}<${itemType} ${attribute}="${this.escape(value)}" />`]);
+        const attributes = Object.entries(metadata).map(([name, metadataValue]) => ` ${name}="${this.escape(metadataValue)}"`).join('');
+        return this.appendToLastItemGroup(content, indent => [`${indent}<${itemType} ${attribute}="${this.escape(value)}"${attributes} />`]);
     }
 
     /** Adds the elements at the end of the last ItemGroup, or in a new ItemGroup at the end when that one has a Condition */
```

Create `src/services/projectItems/defaultItems.ts`:
```ts
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ITEM_TYPES, crossTargetingFramework, parseMsbuildJson, pathKey } from './projectItems';

const execFileAsync = promisify(execFile);

/**
 * Metadata the SDK's own default items carry that decide what goes to the output and publish folders (the Web SDK
 * sets them on its `Content` globs, e.g. `CopyToPublishDirectory` on `*.cshtml` and `wwwroot/**`,
 * `CopyToOutputDirectory` too on `*.json`). An explicit `Include` gets none of it, so Include In Project writes it.
 */
export const KEPT_METADATA = ['CopyToOutputDirectory', 'CopyToPublishDirectory', 'ExcludeFromSingleFile'] as const;

/** What an `Include` for a file gets: the item type and the metadata of the SDK's default item */
export interface NewItem {
    readonly itemType: string;
    readonly metadata: Readonly<Record<string, string>>;
}

/** Runs `dotnet msbuild <project> -nologo <args>` and gives its output; replaced in tests */
export type RunMsbuildWith = (projectPath: string, args: readonly string[]) => Promise<string>;

const runDotnetMsbuild: RunMsbuildWith = async (projectPath, args) => (await execFileAsync('dotnet',
    ['msbuild', projectPath, '-nologo', ...args],
    { cwd: path.dirname(projectPath), timeout: 120000, maxBuffer: 64 * 1024 * 1024 })).stdout;

/**
 * Folders still left out while asking for the default items: Include In Project never adds files from them (see
 * `listFilesUnder`), and listing `node_modules` or the build output would only make the evaluation slow. A global
 * property is taken literally (no `$(BaseOutputPath)`), so the usual folder names are written out. Quoted: MSBuild
 * splits an unquoted `-property:` value at `;` into several properties (MSB1006).
 */
const STILL_EXCLUDED = '"bin/**;obj/**;**/node_modules/**"';

/** The type of a file several item types list: what it is built as, not the `None` other globs may give it too */
function primaryType(types: readonly string[]): string | undefined {
    const ordered = (ITEM_TYPES as readonly string[]).filter(type => types.includes(type));
    return ordered.find(type => type !== 'None') ?? ordered[0];
}

/** Reads the output of the evaluation of itemsWithoutExcludes; undefined when it is not the JSON result */
export function parseNewItems(output: string, projectDir: string): Map<string, NewItem> | undefined {
    const parsed = parseMsbuildJson(output);
    if (!parsed) {
        return undefined;
    }
    const byFile = new Map<string, Map<string, Readonly<Record<string, string | undefined>>>>();
    for (const [itemType, items] of Object.entries(parsed.Items ?? {})) {
        if (!(ITEM_TYPES as readonly string[]).includes(itemType)) {
            continue;
        }
        for (const item of items as unknown as Readonly<Record<string, string | undefined>>[]) {
            const fullPath = item.FullPath ?? (item.Identity ? path.resolve(projectDir, item.Identity) : undefined);
            // A linked item is a file outside the folder: not what Include In Project adds
            if (!fullPath || item.Link?.trim()) {
                continue;
            }
            const key = pathKey(path.normalize(fullPath));
            const types = byFile.get(key) ?? new Map<string, Readonly<Record<string, string | undefined>>>();
            if (!types.has(itemType)) {
                types.set(itemType, item);
            }
            byFile.set(key, types);
        }
    }
    const result = new Map<string, NewItem>();
    for (const [key, types] of byFile) {
        const itemType = primaryType([...types.keys()])!;
        const item = types.get(itemType)!;
        const metadata: Record<string, string> = {};
        for (const name of KEPT_METADATA) {
            const value = item[name]?.trim();
            if (value) {
                metadata[name] = value;
            }
        }
        result.set(key, { itemType, metadata });
    }
    return result;
}

/**
 * The items MSBuild would give the project's files if `DefaultItemExcludes` left nothing out: the SDK's own globs
 * decide the type (`Content` for Razor and web files in a Web SDK project, `EmbeddedResource` for `.resx`, `Compile`
 * for `.cs`) and the output metadata. One evaluation with `DefaultItemExcludes` as a global property, which overrides
 * what the project and its props files set; a multi-targeted project is evaluated for its first framework, as the
 * tree is. Keyed by `pathKey(path.normalize(file))`; undefined when MSBuild fails.
 */
export async function itemsWithoutExcludes(projectPath: string, run: RunMsbuildWith = runDotnetMsbuild): Promise<Map<string, NewItem> | undefined> {
    const args = [`-getItem:${ITEM_TYPES.join(',')}`, '-getProperty:TargetFramework,TargetFrameworks', `-property:DefaultItemExcludes=${STILL_EXCLUDED}`];
    try {
        const output = await run(projectPath, args);
        const framework = crossTargetingFramework(output);
        return parseNewItems(framework ? await run(projectPath, [...args, `-property:TargetFramework=${framework}`]) : output, path.dirname(projectPath));
    } catch {
        return undefined;
    }
}

/** The item for a file, from MSBuild's answer; without one (MSBuild failed, or no glob of the SDK takes the file) by its extension */
export function newItemFor(file: string, items: ReadonlyMap<string, NewItem> | undefined): NewItem {
    return items?.get(pathKey(path.normalize(file))) ?? { itemType: fallbackItemType(file), metadata: {} };
}

/** C# files are compiled, resources embedded, everything else `None`: the SDK's choice outside the Web SDK */
function fallbackItemType(file: string): string {
    switch (path.extname(file).toLowerCase()) {
        case '.cs': return 'Compile';
        case '.resx': return 'EmbeddedResource';
        default: return 'None';
    }
}
```

Change `src/services/projectItems/projectItemEdits.ts`:
```diff
diff --git a/src/services/projectItems/projectItemEdits.ts b/src/services/projectItems/projectItemEdits.ts
index 29a7899..6f7dce2 100644
--- a/src/services/projectItems/projectItemEdits.ts
+++ b/src/services/projectItems/projectItemEdits.ts
@@ -3,6 +3,7 @@ import * as path from 'path';
 import { ProjectFileEditor } from '../../parsers/projectFileEditor';
 import { BUILD_OUTPUT_FOLDERS } from './folderLayout';
 import { ProjectItems } from './projectItems';
+import { NewItem, newItemFor } from './defaultItems';
 
 /** Whether `relative` (from path.relative) points below the folder it is relative to */
 const isBelow = (relative: string) =>
@@ -67,8 +68,6 @@ export function membershipApplied(items: ProjectItems, target: string, isFolder:
     return included !== exclude;
 }
 
-const itemTypeForNewItem = (file: string) => path.extname(file).toLowerCase() === '.cs' ? 'Compile' : 'None';
-
 /** Visual Studio's Exclude From Project for an SDK-style project: `Remove` items for the file, or for everything under the folder, per item type */
 export function excludeEdit(content: string, projectDir: string, target: string, isFolder: boolean, items: ProjectItems): string {
     const value = removeValue(projectDir, target, isFolder);
@@ -80,17 +79,24 @@ export function excludeEdit(content: string, projectDir: string, target: string,
 
 /**
  * Include In Project: deletes the `Remove` item that excluded the file or folder; when there is none (the
- * defaults leave it out, `DefaultItemExcludes`) adds `Include` items, one per file for a folder.
+ * defaults leave it out, `DefaultItemExcludes`) adds `Include` items, one per file for a folder, of the type (and
+ * with the output metadata) MSBuild would give the file without the exclude, like Visual Studio.
  * @param filesUnder the files on disk under the folder (only used for a folder)
+ * @param newItems itemsWithoutExcludes of the project; without it (or for a file it lacks) the type goes by the extension
  */
-export function includeEdit(content: string, projectDir: string, target: string, isFolder: boolean, filesUnder: readonly string[]): string {
+export function includeEdit(
+    content: string, projectDir: string, target: string, isFolder: boolean, filesUnder: readonly string[],
+    newItems?: ReadonlyMap<string, NewItem>,
+): string {
     const removed = ProjectFileEditor.removeRemoveItem(content, removeValue(projectDir, target, isFolder));
     if (removed.removed) {
         return removed.content;
     }
     const files = isFolder ? filesUnder : [target];
-    return files.reduce((edited, file) =>
-        ProjectFileEditor.includeItem(edited, itemTypeForNewItem(file), itemPath(projectDir, file)), content);
+    return files.reduce((edited, file) => {
+        const item = newItemFor(file, newItems);
+        return ProjectFileEditor.includeItem(edited, item.itemType, itemPath(projectDir, file), item.metadata);
+    }, content);
 }
 
 /** Include In Project asks first when it would add more `Include` items than this */
```

Change `src/services/solutionActionService.ts`:
```diff
diff --git a/src/services/solutionActionService.ts b/src/services/solutionActionService.ts
index 35d5394..b8a83aa 100644
--- a/src/services/solutionActionService.ts
+++ b/src/services/solutionActionService.ts
@@ -26,6 +26,7 @@ import { runSyncNamespaces } from './namespaceSync/runSyncNamespaces';
 import { projectForPath } from './templates/templateService';
 import { ProjectItemsService } from './projectItems/projectItemsService';
 import { excludeEdit, includeEdit, includeItemCount, INCLUDE_CONFIRM_LIMIT, listFilesUnder, membershipApplied, membershipRefusal } from './projectItems/projectItemEdits';
+import { itemsWithoutExcludes } from './projectItems/defaultItems';
 import { DebugConfigService } from './debugConfigService';
 import { startWithHotReload } from './hotReload/startWithHotReload';
 import { dependentRenames } from './templates/dependentRenames';
@@ -1377,9 +1378,11 @@ export class SolutionActionService {
                     return;
                 }
             }
+            // The item types MSBuild would give the files without the exclude (one more evaluation, only when Include adds items)
+            const newItems = adding > 0 ? await itemsWithoutExcludes(projectPath) : undefined;
             const edited = exclude
                 ? excludeEdit(content, projectDir, target, isFolder, items!)
-                : includeEdit(content, projectDir, target, isFolder, filesUnder);
+                : includeEdit(content, projectDir, target, isFolder, filesUnder, newItems);
             if (edited !== content) {
                 await fs.promises.writeFile(projectPath, edited, 'utf8');
             }
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/test/unit/services/projectItems/ && npm run typecheck`
Expected: PASS (the real-MSBuild publish test takes about 10 s; it restores the Web SDK project offline).

- [ ] **Step 5: Docs**

In `docs/solution-explorer.md`, section "Exclude From Project and Include In Project", replace
```markdown
it adds `Include` items instead: `Compile` for `.cs` files, `None` for the rest, one per file for a folder
```
with
```markdown
it adds `Include` items instead, one per file for a folder, of the item type MSBuild would give the file without the exclude, as Visual Studio does: `Compile` for `.cs`, `EmbeddedResource` for `.resx`, `Content` for Razor and web files (`.cshtml`, `.razor`, `wwwroot`, `.json`...) in a web project, `None` for the rest. The `Content` items also get the SDK's `CopyToOutputDirectory`/`CopyToPublishDirectory`, so the files are built and published as if they had never been excluded (when the .NET SDK cannot evaluate the project: `Compile` for `.cs`, `EmbeddedResource` for `.resx`, `None` for the rest)
```
(the rest of the sentence, from `(\`bin\`, \`obj\`, ...` on, stays).

Append to `docs/manual-testing.md`:
```markdown
- [ ] Include In Project picks the item type (copy of a web project with `<DefaultItemExcludes>$(DefaultItemExcludes);Pages\Legacy\**</DefaultItemExcludes>` and `Pages/Legacy/Hello.cshtml`, `Hello.cshtml.cs`, `Strings.resx`, `data.json`, `notes.txt`, Show All Files on): Include In Project on `Legacy` writes `Content` for `Hello.cshtml` (with `CopyToPublishDirectory`) and `data.json` (with `CopyToOutputDirectory`), `Compile`, `EmbeddedResource` and `None` for the others; `/Legacy/Hello` answers after F5; in a console project the same `.cshtml` becomes `None`
```
No GIF: the change is the text written into the project file. Only by hand: the menu entry in a real VS Code and the page answering in a browser (the build and publish are covered by the real-MSBuild test).

- [ ] **Step 6: Commit**

```bash
npm run typecheck
git add src/services/projectItems/defaultItems.ts src/services/projectItems/projectItemEdits.ts src/parsers/projectFileEditor.ts src/services/solutionActionService.ts \
  src/test/unit/services/projectItems/defaultItems.test.ts src/test/unit/services/projectItems/defaultItems.msbuild.test.ts src/test/unit/services/projectItems/projectItemEdits.test.ts \
  docs/solution-explorer.md docs/manual-testing.md
git commit -m "Include In Project: the item type and output metadata MSBuild would give the file (Content for Razor and web files)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Central versions written as a property: change the property, ask when others follow it

**Files:**
- Create: `src/services/nuget/versionProperties.ts`
- Modify: `src/services/nuget/centralPackageEdits.ts`, `src/services/nuget/centralPackagePlan.ts`, `src/services/nuget/centralPackages.ts`, `src/services/nuget/centralPackageOperations.ts`
- Test: `src/test/unit/services/nuget/versionProperties.test.ts`, `src/test/unit/services/nuget/versionProperties.msbuild.test.ts`, `src/test/unit/services/nuget/centralPackageOperations.properties.test.ts` (create), `src/test/unit/services/nuget/centralPackageEdits.test.ts` (modify)
- Docs: `docs/nuget.md`, `docs/manual-testing.md`

Repro (done while planning): `Directory.Packages.props` with `<SerilogVersion>3.1.1</SerilogVersion>`, `<PackageVersion Include="Serilog" Version="$(SerilogVersion)" />` and `<PackageVersion Include="Serilog.Extensions.Logging" Version="$(SerilogVersion)" />`; project A references Serilog, B Serilog.Extensions.Logging. With both projects evaluated by the real `ProjectItemsService`, the real `planVersionChange('Serilog', '4.0.0', [A])` gave one edit `setPackageVersion` on `Directory.Packages.props`, `alsoChanges: []` (so no confirmation), and `applyEdit` wrote `<PackageVersion Include="Serilog" Version="4.0.0" />`: re-evaluated, A had Serilog 4.0.0, B Serilog.Extensions.Logging 3.1.1, the property still 3.1.1 and nothing asked. `dotnet add package Serilog --version 4.0.0` in A (SDK 10.0.111, nuget.org) wrote the same literal. With the property also in `Directory.Build.props` (3.0.0) MSBuild evaluated 3.1.1 from `Directory.Packages.props` (`DirectoryBuildPropsPath` is set by MSBuild; Directory.Build.props is read first, the later definition wins).

Behaviour after the task: the definition is searched in the `Directory.Build.props` and the `Directory.Packages.props` chains (imports followed) of the projects using the entry; it is edited only when it is the last definition, unconditional, the value MSBuild evaluated for each of those projects, and not redefined in a project file. Other packages using `$(Prop)` (in those files and the solution's project files) and the projects referencing them are named in the question: **Change Prop** edits the definition, **Set Pkg Only** writes the literal (today's behaviour), Cancel stops. No question when only the edited packages (changed to one version) use the property. When the definition cannot be edited only **Set Pkg Only** is offered. A `Directory.Build.props` edit evaluates every project below it again. The existing "Update All Projects / Set for This Project Only" confirmation comes first, unchanged.

- [ ] **Step 1: Write the failing tests**

Change `src/test/unit/services/nuget/centralPackageEdits.test.ts`:
```diff
diff --git a/src/test/unit/services/nuget/centralPackageEdits.test.ts b/src/test/unit/services/nuget/centralPackageEdits.test.ts
index ea77b8d..8cf7d72 100644
--- a/src/test/unit/services/nuget/centralPackageEdits.test.ts
+++ b/src/test/unit/services/nuget/centralPackageEdits.test.ts
@@ -1,6 +1,7 @@
 import {
-    addGlobalOptOut, addPackageReference, addPackageVersion, applyEdit, removeGlobalOptOut, removeGlobalPackageReference,
-    removePackageVersion, removeVersionOverride, setGlobalPackageVersion, setPackageVersion, setVersionOverride,
+    addGlobalOptOut, addPackageReference, addPackageVersion, applyEdit, packagesUsingProperty, propertyDefinitions, propertyReference,
+    propertyUseCount, removeGlobalOptOut, removeGlobalPackageReference, removePackageVersion, removeVersionOverride, setGlobalPackageVersion,
+    setPackageVersion, setVersionOverride, setVersionProperty, writtenVersion,
 } from '../../../../services/nuget/centralPackageEdits';
 
 const props = `<Project>
@@ -144,3 +145,63 @@ describe('central package edits: the project file', () => {
         expect(applyEdit(project, { kind: 'addPackageReference', file: 'p', id: 'Polly' })).toContain('<PackageReference Include="Polly" />');
     });
 });
+
+describe('versions written as MSBuild properties', () => {
+    const shared = `<Project>
+  <PropertyGroup>
+    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
+    <SerilogVersion>3.1.1</SerilogVersion>
+    <!-- <SerilogVersion>2.0.0</SerilogVersion> -->
+  </PropertyGroup>
+  <PropertyGroup Condition="'$(Configuration)' == 'Release'">
+    <PollyVersion>8.0.0</PollyVersion>
+  </PropertyGroup>
+  <ItemGroup>
+    <PackageVersion Include="Serilog" Version="$(SerilogVersion)" />
+    <PackageVersion Include="Serilog.Extensions.Logging">
+      <Version>$(serilogversion)</Version>
+    </PackageVersion>
+    <PackageVersion Include="Polly" Version="$(PollyVersion)" />
+    <PackageVersion Include="Humanizer" Version="$(SerilogVersion)-beta" />
+    <PackageVersion Include="Newtonsoft.Json" Version="13.0.1">
+      <SerilogVersion>not a property</SerilogVersion>
+    </PackageVersion>
+  </ItemGroup>
+</Project>
+`;
+
+    test('the version as written, and the property it is when it is nothing else', () => {
+        expect(writtenVersion(shared, 'PackageVersion', 'serilog')).toBe('$(SerilogVersion)');
+        expect(writtenVersion(shared, 'PackageVersion', 'Serilog.Extensions.Logging')).toBe('$(serilogversion)');
+        expect(writtenVersion(shared, 'PackageVersion', 'Missing')).toBeUndefined();
+        expect(propertyReference('$(SerilogVersion)')).toBe('SerilogVersion');
+        expect(propertyReference(' $( Serilog_Version.2 ) ')).toBe('Serilog_Version.2');
+        expect(propertyReference('$(SerilogVersion)-beta')).toBeUndefined();
+        expect(propertyReference('3.1.1')).toBeUndefined();
+        expect(propertyReference(undefined)).toBeUndefined();
+    });
+
+    test('definitions: in PropertyGroups only, outside comments, conditional when the group has a Condition', () => {
+        expect(propertyDefinitions(shared, 'serilogversion').map(definition => [definition.value, definition.conditional])).toEqual([['3.1.1', false]]);
+        expect(propertyDefinitions(shared, 'PollyVersion').map(definition => [definition.value, definition.conditional])).toEqual([['8.0.0', true]]);
+        const choose = '<Project>\n  <Choose>\n    <When Condition="true">\n      <PropertyGroup>\n        <V>1.0.0</V>\n      </PropertyGroup>\n    </When>\n  </Choose>\n</Project>\n';
+        expect(propertyDefinitions(choose, 'V').map(definition => definition.conditional)).toEqual([true]);
+    });
+
+    test('setVersionProperty changes the last unconditional definition and nothing else', () => {
+        const twice = shared.replace('</PropertyGroup>', '  <SerilogVersion>3.1.2</SerilogVersion>\n  </PropertyGroup>');
+        const edited = setVersionProperty(twice, 'SerilogVersion', '4.0.0');
+        expect(edited).toBe(twice.replace('<SerilogVersion>3.1.2</SerilogVersion>', '<SerilogVersion>4.0.0</SerilogVersion>'));
+        expect(() => setVersionProperty(shared, 'PollyVersion', '8.1.0')).toThrow('No <PollyVersion> in the file');
+        expect(applyEdit(shared, { kind: 'setVersionProperty', file: 'p', property: 'SerilogVersion', version: '4.0.0' }))
+            .toContain('<SerilogVersion>4.0.0</SerilogVersion>');
+    });
+
+    test('the packages whose version is just the property, and every use of it', () => {
+        expect(packagesUsingProperty(shared, 'SerilogVersion')).toEqual(['Serilog', 'Serilog.Extensions.Logging']);
+        const project = '<Project>\n  <ItemGroup>\n    <PackageReference Include="Serilog.Sinks.File" VersionOverride="$(SerilogVersion)" />\n  </ItemGroup>\n</Project>\n';
+        expect(packagesUsingProperty(project, 'SerilogVersion')).toEqual(['Serilog.Sinks.File']);
+        // Serilog, Serilog.Extensions.Logging and Humanizer's "$(SerilogVersion)-beta"; not the comment
+        expect(propertyUseCount(shared, 'SerilogVersion')).toBe(3);
+    });
+});
```

Create `src/test/unit/services/nuget/centralPackageOperations.properties.test.ts`:
```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({ window: { showWarningMessage: jest.fn() } }), { virtual: true });
jest.mock('../../../../services/solutionService', () => ({ SolutionService: { getActiveSolution: () => undefined } }));

import { OperationsHost, changePackageVersions, consolidatePackages } from '../../../../services/nuget/centralPackageOperations';
import { ProjectState } from '../../../../services/nuget/centralPackagePlan';
import { ProjectPackages, parseMsbuildPackages } from '../../../../services/nuget/centralPackages';

/** Changing a version written as `$(Property)`: the property, after a question when other packages follow it */
describe('central versions written as properties (operations, real files)', () => {
    let root: string;
    const csproj = (name: string) => path.join(root, name, `${name}.csproj`);
    const props = () => path.join(root, 'Directory.Packages.props');
    const read = (file: string) => fs.readFileSync(file, 'utf8');

    const states = (serilog = '3.1.1'): ProjectState[] => ['A', 'B'].map(name => ({
        name, path: csproj(name), packages: parseMsbuildPackages(JSON.stringify({
            Properties: { ManagePackageVersionsCentrally: 'true', DirectoryPackagesPropsPath: props() },
            Items: {
                PackageReference: [{ Identity: name === 'A' ? 'Serilog' : 'Serilog.Extensions.Logging', DefiningProjectFullPath: csproj(name) }],
                PackageVersion: [
                    { Identity: 'Serilog', Version: serilog, DefiningProjectFullPath: props() },
                    { Identity: 'Serilog.Extensions.Logging', Version: serilog, DefiningProjectFullPath: props() },
                ],
            },
        }), csproj(name)) as ProjectPackages,
    }));

    let host: jest.Mocked<OperationsHost>;
    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-properties-')));
        fs.writeFileSync(props(), `<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
    <SerilogVersion>3.1.1</SerilogVersion>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Serilog" Version="$(SerilogVersion)" />
    <PackageVersion Include="Serilog.Extensions.Logging" Version="$(SerilogVersion)" />
  </ItemGroup>
</Project>
`);
        for (const name of ['A', 'B']) {
            fs.mkdirSync(path.join(root, name));
            fs.writeFileSync(csproj(name), '<Project Sdk="Microsoft.NET.Sdk"></Project>\n');
        }
        host = {
            ask: jest.fn(),
            states: jest.fn().mockImplementation(async () => states()),
            install: jest.fn(),
            uninstall: jest.fn(),
            restore: jest.fn().mockResolvedValue({ success: true, message: 'restored' }),
            solutionPath: jest.fn().mockReturnValue(path.join(root, 'S.slnx')),
            reevaluate: jest.fn().mockResolvedValue(undefined),
        };
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    test('asks, naming the package and the project that follow the property; "Change SerilogVersion" edits the property', async () => {
        host.ask.mockResolvedValue('Change SerilogVersion');
        const outcome = await changePackageVersions([{ id: 'Serilog', version: '4.0.0', projects: [csproj('A')] }], 'shared', host);
        expect(host.ask).toHaveBeenCalledTimes(1);
        expect(host.ask).toHaveBeenCalledWith("Serilog's version is $(SerilogVersion), which other packages follow too.",
            expect.stringContaining('also changes Serilog.Extensions.Logging (used by B)'), 'Change SerilogVersion', 'Set Serilog Only');
        expect(outcome.cancelled).toBe(false);
        expect(read(props())).toContain('<SerilogVersion>4.0.0</SerilogVersion>');
        expect(read(props())).toContain('<PackageVersion Include="Serilog" Version="$(SerilogVersion)" />');
        expect((host.reevaluate.mock.calls[0][0] as string[]).map(file => path.basename(file)).sort()).toEqual(['A.csproj', 'B.csproj']);
    });

    test('"Set Serilog Only" writes a literal version on Serilog alone, as before', async () => {
        host.ask.mockResolvedValue('Set Serilog Only');
        await changePackageVersions([{ id: 'Serilog', version: '4.0.0', projects: [csproj('A')] }], 'shared', host);
        expect(read(props())).toContain('<SerilogVersion>3.1.1</SerilogVersion>');
        expect(read(props())).toContain('<PackageVersion Include="Serilog" Version="4.0.0" />');
        expect(read(props())).toContain('<PackageVersion Include="Serilog.Extensions.Logging" Version="$(SerilogVersion)" />');
    });

    test('Cancel changes nothing', async () => {
        host.ask.mockResolvedValue(undefined);
        const before = read(props());
        expect((await changePackageVersions([{ id: 'Serilog', version: '4.0.0', projects: [csproj('A')] }], 'shared', host)).cancelled).toBe(true);
        expect(read(props())).toBe(before);
        expect(host.restore).not.toHaveBeenCalled();
    });

    test('both packages updated to the same version (Update Selected): the property is changed once, without a question', async () => {
        await changePackageVersions([
            { id: 'Serilog', version: '4.0.0', projects: [csproj('A')] },
            { id: 'Serilog.Extensions.Logging', version: '4.0.0', projects: [csproj('B')] },
        ], 'shared', host);
        expect(host.ask).not.toHaveBeenCalled();
        expect(read(props())).toContain('<SerilogVersion>4.0.0</SerilogVersion>');
        expect(read(props()).match(/\$\(SerilogVersion\)/g)).toHaveLength(2);
    });

    test('Consolidate goes through the same question', async () => {
        host.states.mockImplementation(async () => [states()[0], { ...states()[1], packages: { ...states()[1].packages!, references: [
            { id: 'Serilog', version: '3.0.0', source: 'override', versionFile: csproj('B') },
            { id: 'Serilog.Extensions.Logging', version: '3.1.1', source: 'central', versionFile: props() },
        ] } }]);
        host.ask.mockResolvedValueOnce('Consolidate').mockResolvedValueOnce('Change SerilogVersion');
        await consolidatePackages([{ id: 'Serilog', version: '4.0.0' }], host);
        expect(host.ask).toHaveBeenCalledTimes(2);
        expect(read(props())).toContain('<SerilogVersion>4.0.0</SerilogVersion>');
    });
});
```

Create `src/test/unit/services/nuget/versionProperties.msbuild.test.ts`:
```ts
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({ window: { showWarningMessage: jest.fn() } }), { virtual: true });
jest.mock('../../../../services/solutionService', () => ({ SolutionService: { getActiveSolution: () => undefined } }));

import { OperationsHost, changePackageVersions } from '../../../../services/nuget/centralPackageOperations';
import { ProjectItemsService } from '../../../../services/projectItems/projectItemsService';

/** A shared version property against real MSBuild: the projects are evaluated before and after (no restore, no network) */
const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip;
const TIMEOUT = 150000;

describe('central versions written as properties (real MSBuild)', () => {
    let root: string;
    const csproj = (name: string) => path.join(root, name, `${name}.csproj`);
    const write = (file: string, content: string) => {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), content);
    };
    const versions = async () => {
        const service = new ProjectItemsService();
        return Object.fromEntries(await Promise.all(['A', 'B'].map(async name =>
            [name, (await service.evaluatePackages(csproj(name)))?.references.map(reference => `${reference.id} ${reference.version}`)])));
    };
    const host = (answer: string | undefined): jest.Mocked<OperationsHost> => ({
        ask: jest.fn().mockResolvedValue(answer),
        states: jest.fn().mockImplementation(async () => {
            const service = new ProjectItemsService();
            return Promise.all(['A', 'B'].map(async name => ({ name, path: csproj(name), packages: await service.evaluatePackages(csproj(name)) })));
        }),
        install: jest.fn(),
        uninstall: jest.fn(),
        restore: jest.fn().mockResolvedValue({ success: true, message: 'restored' }),
        solutionPath: jest.fn().mockReturnValue(undefined),
        reevaluate: jest.fn().mockResolvedValue(undefined),
    });

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-property-msbuild-')));
        write('Directory.Packages.props', `<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Serilog" Version="$(SerilogVersion)" />
    <PackageVersion Include="Serilog.Extensions.Logging" Version="$(SerilogVersion)" />
  </ItemGroup>
</Project>
`);
        write('Directory.Build.props', '<Project>\n  <PropertyGroup>\n    <SerilogVersion>3.1.1</SerilogVersion>\n  </PropertyGroup>\n</Project>\n');
        for (const [name, id] of [['A', 'Serilog'], ['B', 'Serilog.Extensions.Logging']]) {
            write(`${name}/${name}.csproj`, `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n  </PropertyGroup>\n  <ItemGroup>\n    <PackageReference Include="${id}" />\n  </ItemGroup>\n</Project>\n`);
        }
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    withDotnet('"Change SerilogVersion" edits Directory.Build.props, and MSBuild then gives both packages the new version', async () => {
        expect(await versions()).toEqual({ A: ['Serilog 3.1.1'], B: ['Serilog.Extensions.Logging 3.1.1'] });
        const asked = host('Change SerilogVersion');
        await changePackageVersions([{ id: 'Serilog', version: '4.0.0', projects: [csproj('A')] }], 'shared', asked);
        expect(asked.ask).toHaveBeenCalledWith("Serilog's version is $(SerilogVersion), which other packages follow too.",
            expect.stringContaining('Change SerilogVersion to 4.0.0 in Directory.Build.props: this also changes Serilog.Extensions.Logging (used by B).'),
            'Change SerilogVersion', 'Set Serilog Only');
        expect(fs.readFileSync(path.join(root, 'Directory.Build.props'), 'utf8')).toContain('<SerilogVersion>4.0.0</SerilogVersion>');
        expect(await versions()).toEqual({ A: ['Serilog 4.0.0'], B: ['Serilog.Extensions.Logging 4.0.0'] });
    }, TIMEOUT);

    withDotnet('"Set Serilog Only": Serilog alone gets the literal version, the other package keeps following the property', async () => {
        await changePackageVersions([{ id: 'Serilog', version: '4.0.0', projects: [csproj('A')] }], 'shared', host('Set Serilog Only'));
        expect(await versions()).toEqual({ A: ['Serilog 4.0.0'], B: ['Serilog.Extensions.Logging 3.1.1'] });
    }, TIMEOUT);
});
```

Create `src/test/unit/services/nuget/versionProperties.test.ts`:
```ts
import * as path from 'path';
import { parseMsbuildPackages, ProjectPackages } from '../../../../services/nuget/centralPackages';
import { ProjectState } from '../../../../services/nuget/centralPackagePlan';
import { PackageEdit } from '../../../../services/nuget/centralPackageEdits';
import { changesOnlyItself, findVersionProperties, propertyEdit, propertyQuestion } from '../../../../services/nuget/versionProperties';

const root = path.resolve('/repo');
const at = (...parts: string[]) => path.join(root, ...parts);
const packagesProps = at('Directory.Packages.props');
const buildProps = at('Directory.Build.props');

/** Files by path; `chain` gives a file alone (no imports) */
let files: Record<string, string>;
const read = (file: string) => files[file];
const chain = (file: string) => [file];

const props = (definitions: string, versions: string) => `<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>${definitions}
  </PropertyGroup>
  <ItemGroup>
${versions}
  </ItemGroup>
</Project>
`;
const project = (body = '') => `<Project Sdk="Microsoft.NET.Sdk">${body}</Project>`;

/** A project as MSBuild evaluates it: the central versions (evaluated) and the packages it references */
const state = (name: string, references: string[], versions: Record<string, string>, withBuildProps = false): ProjectState => ({
    name,
    path: at(name, `${name}.csproj`),
    packages: parseMsbuildPackages(JSON.stringify({
        Properties: { ManagePackageVersionsCentrally: 'true', DirectoryPackagesPropsPath: packagesProps, DirectoryBuildPropsPath: withBuildProps ? buildProps : '' },
        Items: {
            PackageReference: references.map(id => ({ Identity: id, DefiningProjectFullPath: at(name, `${name}.csproj`) })),
            PackageVersion: Object.entries(versions).map(([id, version]) => ({ Identity: id, Version: version, DefiningProjectFullPath: packagesProps })),
        },
    }), at(name, `${name}.csproj`)) as ProjectPackages,
});

const versions = { Serilog: '3.1.1', 'Serilog.Extensions.Logging': '3.1.1', Polly: '8.1.0' };
const edit = (id: string, version = '4.0.0'): PackageEdit => ({ kind: 'setPackageVersion', file: packagesProps, id, version });

describe('findVersionProperties', () => {
    beforeEach(() => {
        files = {
            [packagesProps]: props('\n    <SerilogVersion>3.1.1</SerilogVersion>',
                '    <PackageVersion Include="Serilog" Version="$(SerilogVersion)" />\n'
                + '    <PackageVersion Include="Serilog.Extensions.Logging" Version="$(SerilogVersion)" />\n'
                + '    <PackageVersion Include="Polly" Version="8.1.0" />'),
            [at('A', 'A.csproj')]: project(),
            [at('B', 'B.csproj')]: project(),
        };
    });
    const states = () => [state('A', ['Serilog'], versions), state('B', ['Serilog.Extensions.Logging'], versions)];

    test('a literal version is not listed', () => {
        expect(findVersionProperties([edit('Polly', '8.2.0')], states(), read, chain)).toEqual([]);
    });

    test('a property shared with another package: its definition, the other package and the project using it', () => {
        const [entry] = findVersionProperties([edit('Serilog')], states(), read, chain);
        expect(entry).toEqual(expect.objectContaining({
            property: 'SerilogVersion', definition: packagesProps, alsoPackages: ['Serilog.Extensions.Logging'], alsoProjects: ['B'], otherUses: 0,
        }));
        expect(changesOnlyItself(entry)).toBe(false);
        expect(propertyEdit(entry)).toEqual({ kind: 'setVersionProperty', file: packagesProps, property: 'SerilogVersion', version: '4.0.0' });
        expect(propertyQuestion(entry)).toEqual({
            message: "Serilog's version is $(SerilogVersion), which other packages follow too.",
            detail: 'Change SerilogVersion to 4.0.0 in Directory.Packages.props: this also changes Serilog.Extensions.Logging (used by B). '
                + 'Set Serilog Only writes 4.0.0 instead of $(SerilogVersion): Serilog no longer follows it.',
            change: 'Change SerilogVersion',
            only: 'Set Serilog Only',
        });
    });

    test('both packages of the property changed to the same version: nothing else follows it, no question', () => {
        const found = findVersionProperties([edit('Serilog'), edit('Serilog.Extensions.Logging')], states(), read, chain);
        expect(found.map(entry => [entry.edit.id, entry.alsoPackages, changesOnlyItself(entry)])).toEqual([
            ['Serilog', [], true], ['Serilog.Extensions.Logging', [], true],
        ]);
    });

    test('to different versions: the property cannot follow both', () => {
        const found = findVersionProperties([edit('Serilog'), edit('Serilog.Extensions.Logging', '9.0.0')], states(), read, chain);
        expect(found.map(entry => entry.refusal)).toEqual(['conflict', 'conflict']);
        expect(found[0].definition).toBeUndefined();
        expect(propertyQuestion(found[0]).change).toBeUndefined();
        expect(propertyQuestion(found[0]).detail).toBe('Other packages that follow SerilogVersion get other versions in this change. '
            + 'Set Serilog Only writes 4.0.0 instead of $(SerilogVersion): Serilog no longer follows it.');
    });

    test('defined in Directory.Build.props; a later definition in Directory.Packages.props wins', () => {
        files[buildProps] = '<Project>\n  <PropertyGroup>\n    <SerilogVersion>3.1.1</SerilogVersion>\n  </PropertyGroup>\n</Project>\n';
        files[packagesProps] = files[packagesProps].replace('\n    <SerilogVersion>3.1.1</SerilogVersion>', '');
        const withBuildProps = [state('A', ['Serilog'], versions, true), state('B', ['Serilog.Extensions.Logging'], versions, true)];
        expect(findVersionProperties([edit('Serilog')], withBuildProps, read, chain)[0].definition).toBe(buildProps);
        files[packagesProps] = files[packagesProps].replace('<ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>',
            '<ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>\n    <SerilogVersion>3.1.1</SerilogVersion>');
        expect(findVersionProperties([edit('Serilog')], withBuildProps, read, chain)[0].definition).toBe(packagesProps);
    });

    test('not editable: not found, under a condition, or another value than MSBuild evaluated', () => {
        const refusal = () => findVersionProperties([edit('Serilog')], states(), read, chain)[0].refusal;
        const original = files[packagesProps];
        files[packagesProps] = original.replace('<SerilogVersion>3.1.1</SerilogVersion>', '');
        expect(refusal()).toBe('notFound');
        files[packagesProps] = original.replace('<SerilogVersion>3.1.1</SerilogVersion>', '<SerilogVersion Condition="true">3.1.1</SerilogVersion>');
        expect(refusal()).toBe('conditional');
        files[packagesProps] = original;
        files[at('A', 'A.csproj')] = project('<PropertyGroup><SerilogVersion>3.1.1</SerilogVersion></PropertyGroup>');
        expect(refusal()).toBe('differs');
        files[at('A', 'A.csproj')] = project();
        const evaluatedOtherwise = [state('A', ['Serilog'], { ...versions, Serilog: '3.0.0' }), state('B', ['Serilog.Extensions.Logging'], versions)];
        expect(findVersionProperties([edit('Serilog')], evaluatedOtherwise, read, chain)[0].refusal).toBe('differs');
        expect(propertyQuestion({ ...findVersionProperties([edit('Serilog')], evaluatedOtherwise, read, chain)[0] }).message)
            .toBe("Serilog's version is $(SerilogVersion), which cannot be changed here.");
    });

    test('used only by the edited package: changed without a question', () => {
        files[packagesProps] = files[packagesProps].replace('Include="Serilog.Extensions.Logging" Version="$(SerilogVersion)"', 'Include="Serilog.Extensions.Logging" Version="3.1.1"');
        expect(changesOnlyItself(findVersionProperties([edit('Serilog')], states(), read, chain)[0])).toBe(true);
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/test/unit/services/nuget/`
Expected: FAIL: `TS2307: Cannot find module '../../../../services/nuget/versionProperties'`, `TS2305: Module '"../../../../services/nuget/centralPackageEdits"' has no exported member 'packagesUsingProperty'` (and `propertyDefinitions`, `propertyReference`, `propertyUseCount`, `setVersionProperty`, `writtenVersion`); in `centralPackageOperations.properties.test.ts` and `versionProperties.msbuild.test.ts` 5 tests fail (no question is asked, `<SerilogVersion>` stays `3.1.1`).

- [ ] **Step 3: Implement**

Change `src/services/nuget/centralPackageEdits.ts`:
```diff
diff --git a/src/services/nuget/centralPackageEdits.ts b/src/services/nuget/centralPackageEdits.ts
index 213e1eb..06d9372 100644
--- a/src/services/nuget/centralPackageEdits.ts
+++ b/src/services/nuget/centralPackageEdits.ts
@@ -9,7 +9,9 @@ import { ProjectFileEditor as Xml } from '../../parsers/projectFileEditor';
 /** One change to one file; `file` is the props file or the project file it is applied to */
 export type PackageEdit =
     | { readonly kind: 'setPackageVersion' | 'addPackageVersion' | 'setGlobalPackageVersion' | 'setVersionOverride'; readonly file: string; readonly id: string; readonly version: string }
-    | { readonly kind: 'removePackageVersion' | 'removeGlobalPackageReference' | 'addPackageReference' | 'removeVersionOverride' | 'addGlobalOptOut' | 'removeGlobalOptOut'; readonly file: string; readonly id: string };
+    | { readonly kind: 'removePackageVersion' | 'removeGlobalPackageReference' | 'addPackageReference' | 'removeVersionOverride' | 'addGlobalOptOut' | 'removeGlobalOptOut'; readonly file: string; readonly id: string }
+    /** The value of the MSBuild property a `Version="$(property)"` names, where it is defined */
+    | { readonly kind: 'setVersionProperty'; readonly file: string; readonly property: string; readonly version: string };
 
 interface Element {
     readonly id: string;
@@ -169,9 +171,89 @@ export function globalPackageReferences(content: string): { id: string; version:
     });
 }
 
+/** The version written on `<tag Include="id">` (attribute or child element), unescaped and trimmed; undefined without one */
+export function writtenVersion(content: string, tag: string, id: string): string | undefined {
+    const element = find(content, tag, id);
+    const text = element ? content.slice(element.start, element.end) : '';
+    const found = /\sVersion\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(text) ?? /<Version\s*>([^<]*)<\/Version\s*>/.exec(text);
+    return found ? Xml.unescape(found[1] ?? found[2]).trim() : undefined;
+}
+
+/** The name of the property a version is when it is just `$(Name)`; undefined for a literal or anything around it */
+export function propertyReference(version: string | undefined): string | undefined {
+    return /^\$\(\s*([A-Za-z_][\w.-]*)\s*\)$/.exec(version?.trim() ?? '')?.[1];
+}
+
+const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
+
+/** A `<Name>value</Name>` in a PropertyGroup; `conditional` when it or its group has a Condition, or it is in a Choose */
+export interface PropertyDefinition {
+    readonly value: string;
+    readonly conditional: boolean;
+    /** Where the value is (between the tags) */
+    readonly valueStart: number;
+    readonly valueEnd: number;
+}
+
+/** The definitions of an MSBuild property in the file, in document order (names compare case-insensitively, as MSBuild's do) */
+export function propertyDefinitions(content: string, name: string): PropertyDefinition[] {
+    const ignored = Xml.ignoredRanges(content);
+    const definitions: PropertyDefinition[] = [];
+    for (const match of content.matchAll(new RegExp(`<${escapeRe(name)}(\\s(?:[^>"']|"[^"]*"|'[^']*')*?)?>([^<]*)<\\/${escapeRe(name)}\\s*>`, 'gi'))) {
+        const index = match.index!;
+        const groupOpen = content.slice(0, index).match(/<PropertyGroup\b(?:[^>"']|"[^"]*"|'[^']*')*>(?![\s\S]*<\/PropertyGroup\s*>)/i);
+        // Outside a PropertyGroup the element is item metadata, not a property
+        if (!groupOpen || Xml.inRanges(ignored, index)) {
+            continue;
+        }
+        const before = content.slice(0, index);
+        const inChoose = before.lastIndexOf('<Choose') > before.lastIndexOf('</Choose');
+        const valueStart = index + match[0].indexOf('>') + 1;
+        definitions.push({
+            value: Xml.unescape(match[2]).trim(),
+            conditional: inChoose || /\bCondition\s*=/i.test(match[1] ?? '') || /\bCondition\s*=/i.test(groupOpen[0]),
+            valueStart,
+            valueEnd: valueStart + match[2].length,
+        });
+    }
+    return definitions;
+}
+
+/** Sets the property's last unconditional definition in the file (the one MSBuild ends up with) */
+export function setVersionProperty(content: string, name: string, version: string): string {
+    const definition = propertyDefinitions(content, name).filter(candidate => !candidate.conditional).pop();
+    if (!definition) {
+        throw new Error(`No <${name}> in the file`);
+    }
+    return content.slice(0, definition.valueStart) + Xml.escape(version) + content.slice(definition.valueEnd);
+}
+
+/** The packages whose version is `$(name)`: PackageVersion, GlobalPackageReference, PackageReference (Version or VersionOverride) */
+export function packagesUsingProperty(content: string, name: string): string[] {
+    const ids: string[] = [];
+    for (const tag of ['PackageVersion', 'GlobalPackageReference', 'PackageReference']) {
+        for (const element of findElements(content, tag)) {
+            const text = content.slice(element.start, element.end);
+            const versions = [...text.matchAll(/\s(?:Version|VersionOverride)\s*=\s*(?:"([^"]*)"|'([^']*)')|<(?:Version|VersionOverride)\s*>([^<]*)</g)]
+                .map(found => Xml.unescape(found[1] ?? found[2] ?? found[3]));
+            if (versions.some(version => propertyReference(version)?.toLowerCase() === name.toLowerCase())) {
+                ids.push(element.id);
+            }
+        }
+    }
+    return ids;
+}
+
+/** How often `$(name)` is used in the file, outside comments and targets */
+export function propertyUseCount(content: string, name: string): number {
+    const ignored = Xml.ignoredRanges(content);
+    return [...content.matchAll(new RegExp(`\\$\\(\\s*${escapeRe(name)}\\s*\\)`, 'gi'))].filter(match => !Xml.inRanges(ignored, match.index!)).length;
+}
+
 /** Applies one planned edit to the text of its file */
 export function applyEdit(content: string, edit: PackageEdit): string {
     switch (edit.kind) {
+        case 'setVersionProperty': return setVersionProperty(content, edit.property, edit.version);
         case 'setPackageVersion': return setPackageVersion(content, edit.id, edit.version);
         case 'addPackageVersion': return addPackageVersion(content, edit.id, edit.version);
         case 'setGlobalPackageVersion': return setGlobalPackageVersion(content, edit.id, edit.version);
```

Change `src/services/nuget/centralPackageOperations.ts`:
```diff
diff --git a/src/services/nuget/centralPackageOperations.ts b/src/services/nuget/centralPackageOperations.ts
index 7e194f2..256efcc 100644
--- a/src/services/nuget/centralPackageOperations.ts
+++ b/src/services/nuget/centralPackageOperations.ts
@@ -1,4 +1,5 @@
 import * as vscode from 'vscode';
+import * as fs from 'fs';
 import * as path from 'path';
 import { logger } from '../../core/logger';
 import { SolutionService } from '../solutionService';
@@ -7,6 +8,8 @@ import { PackageOperationsService } from './packageOperationsService';
 import { PackageOperationResult } from './types';
 import { centralFiles } from './centralPackages';
 import { applyPackageEdits, declaredGlobals, importChain } from './centralPackageFiles';
+import { PackageEdit } from './centralPackageEdits';
+import { changesOnlyItself, findVersionProperties, propertyEdit, propertyQuestion } from './versionProperties';
 import { pathKey } from '../projectItems/projectItems';
 import {
     ProjectState, VersionChangePlan, VersionScope, confirmationText, consolidationText, globalUninstallEdits, planConsolidate, planUninstall,
@@ -75,13 +78,65 @@ export const vscodeHost: OperationsHost = {
 
 const isProjectFile = (file: string) => /\.(cs|vb|fs)proj$/i.test(file);
 const same = (a: string, b: string) => pathKey(path.normalize(a)) === pathKey(path.normalize(b));
+/** Whether a props file reaches the project: MSBuild finds Directory.*.props files in the project's folder and above */
+const reaches = (propsFile: string, projectPath: string) => {
+    const relative = path.relative(path.dirname(propsFile), path.dirname(projectPath));
+    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
+};
+const propertyFiles = (edits: readonly PackageEdit[]) => edits.filter(edit => edit.kind === 'setVersionProperty').map(edit => edit.file);
+const readText = (file: string) => {
+    try {
+        return fs.readFileSync(file, 'utf8');
+    } catch {
+        return undefined;
+    }
+};
+
+/**
+ * Versions written as `$(Property)`: the property's definition is changed instead of writing a literal over the
+ * reference; asked first when other packages follow the property or it cannot be changed (then the package can get a
+ * literal version alone). One answer per property. Undefined: the user cancelled.
+ */
+async function resolveVersionProperties(edits: readonly PackageEdit[], states: readonly ProjectState[], host: OperationsHost): Promise<PackageEdit[] | undefined> {
+    const found = findVersionProperties(edits, states, readText, importChain);
+    const answers = new Map<string, boolean>();
+    const result: PackageEdit[] = [];
+    const add = (edit: PackageEdit) => {
+        const key = (candidate: PackageEdit) => `${candidate.kind}|${pathKey(path.normalize(candidate.file))}|${('id' in candidate ? candidate.id : candidate.property).toLowerCase()}`;
+        if (!result.some(other => key(other) === key(edit))) {
+            result.push(edit);
+        }
+    };
+    for (const edit of edits) {
+        const entry = found.find(candidate => candidate.edit === edit);
+        if (!entry) {
+            add(edit);
+            continue;
+        }
+        const answerKey = `${entry.definition ?? entry.edit.id}|${entry.property}`.toLowerCase();
+        let change = changesOnlyItself(entry) || answers.get(answerKey);
+        if (change === undefined) {
+            const question = propertyQuestion(entry);
+            const choice = await host.ask(question.message, question.detail, ...(question.change ? [question.change] : []), question.only);
+            if (!choice) {
+                return undefined;
+            }
+            change = choice === question.change;
+            answers.set(answerKey, change);
+        }
+        add(change ? propertyEdit(entry) : edit);
+    }
+    return result;
+}
 
 /**
  * After edits: restore (the whole solution when a props file changed, it reaches every project below it) and
- * evaluate the projects whose files or props files changed, and those the CLI updated (`cliUpdated`)
+ * evaluate the projects whose files or props files changed, those the CLI updated (`cliUpdated`) and those below a
+ * file whose version property changed (`propertyFiles`)
  */
 async function afterEdits(
     changed: readonly string[], states: readonly ProjectState[], host: OperationsHost, cliUpdated: readonly string[] = [],
+    propertyFiles: readonly string[] = [],
 ): Promise<PackageOperationResult[]> {
     if (changed.length === 0) {
         if (cliUpdated.length > 0) {
@@ -91,7 +146,9 @@ async function afterEdits(
     }
     const propsChanged = changed.filter(file => !isProjectFile(file));
     const affected = states.filter(state => changed.some(file => same(file, state.path))
-        || (!!state.packages && centralFiles(state.packages).some(file => propsChanged.some(changedFile => same(file, changedFile)))));
+        || (!!state.packages && centralFiles(state.packages).some(file => propsChanged.some(changedFile => same(file, changedFile))))
+        // A property used as a version is read by every project below its file (Directory.Build.props is no central file)
+        || propertyFiles.some(file => reaches(file, state.path)));
     const solutionPath = host.solutionPath();
     const targets = propsChanged.length > 0 && solutionPath ? [solutionPath] : affected.map(state => state.path);
     const results: PackageOperationResult[] = [];
@@ -140,10 +197,14 @@ export async function changePackageVersions(
         }
     }
 
+    const edits = await resolveVersionProperties(plans.flatMap(candidate => candidate.edits), states, host);
+    if (!edits) {
+        return { cancelled: true, results: [] };
+    }
     const results: PackageOperationResult[] = [];
     // Projects `dotnet add package` changed: evaluated again with the edited ones
     const cliUpdated: string[] = [];
-    const { changed, result } = await apply(plans.flatMap(candidate => candidate.edits));
+    const { changed, result } = await apply(edits);
     if (result) {
         return { cancelled: false, results: [result] };
     }
@@ -159,7 +220,7 @@ export async function changePackageVersions(
             }
         }
     }
-    results.push(...(await afterEdits(changed, states, host, cliUpdated)).filter(restore => !restore.success));
+    results.push(...(await afterEdits(changed, states, host, cliUpdated, propertyFiles(edits))).filter(restore => !restore.success));
     return { cancelled: false, results };
 }
 
@@ -231,7 +292,11 @@ export async function consolidatePackages(changes: readonly { id: string; versio
     if (question && await host.ask(question.message, question.detail, 'Consolidate') !== 'Consolidate') {
         return { cancelled: true, results: [] };
     }
-    const { changed, result } = await apply(plans.flatMap(plan => plan.edits));
+    const edits = await resolveVersionProperties(plans.flatMap(plan => plan.edits), states, host);
+    if (!edits) {
+        return { cancelled: true, results: [] };
+    }
+    const { changed, result } = await apply(edits);
     if (result) {
         return { cancelled: false, results: [result] };
     }
@@ -252,6 +317,6 @@ export async function consolidatePackages(changes: readonly { id: string; versio
             results.push({ success: true, message: `${plan.id} is already at ${plan.version} in all projects`, packageId: plan.id });
         }
     }
-    results.push(...(await afterEdits(changed, states, host, cliUpdated)).filter(restore => !restore.success));
+    results.push(...(await afterEdits(changed, states, host, cliUpdated, propertyFiles(edits))).filter(restore => !restore.success));
     return { cancelled: false, results };
 }
```

Change `src/services/nuget/centralPackagePlan.ts`:
```diff
diff --git a/src/services/nuget/centralPackagePlan.ts b/src/services/nuget/centralPackagePlan.ts
index 866f84e..bb76481 100644
--- a/src/services/nuget/centralPackagePlan.ts
+++ b/src/services/nuget/centralPackagePlan.ts
@@ -65,7 +65,7 @@ export function planVersionChange(
     const shared = new Map<string, PackageEdit>();
     let overridable = true;
     const share = (edit: PackageEdit) => {
-        const key = `${edit.kind}|${fileKey(edit.file)}|${lower(edit.id)}`;
+        const key = `${edit.kind}|${fileKey(edit.file)}|${lower('id' in edit ? edit.id : edit.property)}`;
         if (!shared.has(key)) {
             shared.set(key, edit);
             edits.push(edit);
```

Change `src/services/nuget/centralPackages.ts`:
```diff
diff --git a/src/services/nuget/centralPackages.ts b/src/services/nuget/centralPackages.ts
index 22d6a38..049a6fe 100644
--- a/src/services/nuget/centralPackages.ts
+++ b/src/services/nuget/centralPackages.ts
@@ -3,7 +3,7 @@ import { parseMsbuildJson, pathKey } from '../projectItems/projectItems';
 import { PackageVersionSource } from './types';
 
 /** Asked of MSBuild together with the project items: one evaluation per project answers both */
-export const PACKAGE_PROPERTIES = ['ManagePackageVersionsCentrally', 'DirectoryPackagesPropsPath', 'CentralPackageVersionOverrideEnabled'] as const;
+export const PACKAGE_PROPERTIES = ['ManagePackageVersionsCentrally', 'DirectoryPackagesPropsPath', 'CentralPackageVersionOverrideEnabled', 'DirectoryBuildPropsPath'] as const;
 export const PACKAGE_ITEM_TYPES = ['PackageReference', 'PackageVersion', 'GlobalPackageReference'] as const;
 
 /** A package the project references, with the version MSBuild gives it and where that version is written */
@@ -35,6 +35,8 @@ export interface ProjectPackages {
     readonly centrallyManaged: boolean;
     /** The `Directory.Packages.props` MSBuild picked (also set when the project turned CPM off) */
     readonly propsPath?: string;
+    /** The `Directory.Build.props` MSBuild imported, if any: properties used as versions may be defined there */
+    readonly buildPropsPath?: string;
     /** `CentralPackageVersionOverrideEnabled` is not false: "Set for this project only" may write a VersionOverride */
     readonly overridesEnabled: boolean;
     /**
@@ -113,6 +115,7 @@ export function parseMsbuildPackages(output: string, projectPath: string): Proje
         projectPath,
         centrallyManaged,
         propsPath: properties.DirectoryPackagesPropsPath ? path.normalize(properties.DirectoryPackagesPropsPath) : undefined,
+        ...(properties.DirectoryBuildPropsPath?.trim() ? { buildPropsPath: path.normalize(properties.DirectoryBuildPropsPath.trim()) } : {}),
         overridesEnabled: !isFalse(properties.CentralPackageVersionOverrideEnabled),
         multiTargeted: (properties.TargetFrameworks ?? '').split(';').filter(framework => framework.trim()).length > 1,
         references,
```

Create `src/services/nuget/versionProperties.ts`:
```ts
import * as path from 'path';
import { PackageEdit, packagesUsingProperty, propertyDefinitions, propertyReference, propertyUseCount, writtenVersion } from './centralPackageEdits';
import { ProjectState } from './centralPackagePlan';
import { pathKey } from '../projectItems/projectItems';

/**
 * Central versions written as an MSBuild property (`<PackageVersion Include="Serilog" Version="$(SerilogVersion)" />`):
 * changing the version edits the property's definition, so the package keeps following it, instead of writing a
 * literal over the reference (what `dotnet add package` does, checked with SDK 10.0.111). The definition is looked
 * for where MSBuild reads it before the versions: `Directory.Build.props`, `Directory.Packages.props` and the files
 * they import, the last unconditional one winning, and it is only edited when its value is the version MSBuild
 * evaluated for every project that uses the entry. Pure: files come through `read` and `chain`.
 */

/** An edit of a central (`PackageVersion`) or global (`GlobalPackageReference`) version */
type VersionEdit = PackageEdit & { readonly kind: 'setPackageVersion' | 'setGlobalPackageVersion'; readonly id: string; readonly version: string };

/** Why the property cannot be edited for the change */
export type PropertyRefusal = 'notFound' | 'conditional' | 'differs' | 'conflict';

export interface VersionProperty {
    /** The edit that would write a literal over `$(property)` */
    readonly edit: VersionEdit;
    readonly property: string;
    /** The file whose definition is edited; undefined when it cannot be (see `refusal`) */
    readonly definition?: string;
    readonly refusal?: PropertyRefusal;
    /** Other packages whose version is the property, not changed to the same version by this change */
    readonly alsoPackages: readonly string[];
    /** The projects that use those packages */
    readonly alsoProjects: readonly string[];
    /** Uses of `$(property)` that are no package version */
    readonly otherUses: number;
}

const lower = (text: string) => text.toLowerCase();
const fileKey = (file: string) => pathKey(path.normalize(file));
const isVersionEdit = (edit: PackageEdit): edit is VersionEdit => edit.kind === 'setPackageVersion' || edit.kind === 'setGlobalPackageVersion';

/** The projects whose version of the package comes from the entry in `file` */
function usersOfEntry(states: readonly ProjectState[], edit: VersionEdit): ProjectState[] {
    return states.filter(state => {
        const packages = state.packages;
        const entry = edit.kind === 'setPackageVersion'
            ? packages?.centralVersions.get(lower(edit.id))
            : packages?.globals.find(global => lower(global.id) === lower(edit.id));
        return !!entry && fileKey(entry.file) === fileKey(edit.file);
    });
}

/** The version MSBuild evaluated for the entry in a project */
function evaluatedVersion(state: ProjectState, edit: VersionEdit): string | undefined {
    return edit.kind === 'setPackageVersion'
        ? state.packages?.centralVersions.get(lower(edit.id))?.version
        : state.packages?.globals.find(global => lower(global.id) === lower(edit.id))?.version;
}

/**
 * The version edits of a change whose entry is written as `$(property)`, with where the property can be changed and
 * what else follows it. Edits of literal versions are not listed.
 * @param read the text of a file, undefined when it cannot be read
 * @param chain a props file and the files it imports, in MSBuild's order (importChain)
 */
export function findVersionProperties(
    edits: readonly PackageEdit[], states: readonly ProjectState[], read: (file: string) => string | undefined, chain: (file: string) => string[],
): VersionProperty[] {
    const found: Omit<VersionProperty, 'alsoPackages' | 'alsoProjects'>[] = [];
    const scanned = new Map<string, string[]>();
    for (const edit of edits.filter(isVersionEdit)) {
        const content = read(edit.file);
        const property = content === undefined ? undefined
            : propertyReference(writtenVersion(content, edit.kind === 'setPackageVersion' ? 'PackageVersion' : 'GlobalPackageReference', edit.id));
        if (!property) {
            continue;
        }
        const users = usersOfEntry(states, edit);
        // Directory.Build.props is imported before Directory.Packages.props: a later definition wins
        const files: string[] = [];
        for (const state of users) {
            for (const file of [...(state.packages?.buildPropsPath ? chain(state.packages.buildPropsPath) : []), ...(state.packages?.propsPath ? chain(state.packages.propsPath) : [])]) {
                if (!files.some(known => fileKey(known) === fileKey(file))) {
                    files.push(file);
                }
            }
        }
        if (!files.some(known => fileKey(known) === fileKey(edit.file))) {
            files.push(edit.file);
        }
        scanned.set(`${fileKey(edit.file)}|${lower(property)}`, [...files, ...states.map(state => state.path)]);
        const definitions = files.flatMap(file => propertyDefinitions(read(file) ?? '', property).map(definition => ({ file, definition })));
        const last = definitions[definitions.length - 1];
        // A project file's own definition comes after the props files and would win for that project
        const inProject = users.some(state => propertyDefinitions(read(state.path) ?? '', property).length > 0);
        const refusal: PropertyRefusal | undefined = !last ? 'notFound'
            : definitions.some(candidate => candidate.definition.conditional) ? 'conditional'
            : inProject || users.some(state => evaluatedVersion(state, edit) !== last.definition.value) ? 'differs'
            : undefined;
        const otherUses = files.reduce((count, file) => {
            const text = read(file) ?? '';
            return count + propertyUseCount(text, property) - packagesUsingProperty(text, property).length;
        }, 0);
        found.push({ edit, property, ...(refusal ? { refusal } : { definition: last.file }), otherUses });
    }

    return found.map(entry => {
        // Other changes of this operation that follow the same definition, and whether they agree on the version
        const same = found.filter(other => other.definition && entry.definition && fileKey(other.definition) === fileKey(entry.definition)
            && lower(other.property) === lower(entry.property));
        const conflict = same.some(other => other.edit.version !== entry.edit.version);
        const changing = new Set(same.map(other => lower(other.edit.id)));
        const files = scanned.get(`${fileKey(entry.edit.file)}|${lower(entry.property)}`) ?? [];
        const alsoPackages = [...new Map(files.flatMap(file => packagesUsingProperty(read(file) ?? '', entry.property))
            .filter(id => lower(id) !== lower(entry.edit.id) && !changing.has(lower(id)))
            .map(id => [lower(id), id] as const)).values()].sort((a, b) => a.localeCompare(b));
        const alsoProjects = states
            .filter(state => state.packages?.references.some(reference => alsoPackages.some(id => lower(id) === lower(reference.id))))
            .map(state => state.name).sort();
        const refused = conflict ? { refusal: 'conflict' as const, definition: undefined } : {};
        return { ...entry, ...refused, alsoPackages, alsoProjects };
    }).map(({ definition, ...rest }) => definition ? { ...rest, definition } : rest);
}

/** The edit that changes the property instead of writing a literal */
export function propertyEdit(entry: VersionProperty): PackageEdit {
    return { kind: 'setVersionProperty', file: entry.definition!, property: entry.property, version: entry.edit.version };
}

/** Whether the property can simply be changed: nothing else follows it */
export function changesOnlyItself(entry: VersionProperty): boolean {
    return !!entry.definition && entry.alsoPackages.length === 0 && entry.otherUses === 0;
}

const REFUSALS: Record<PropertyRefusal, (entry: VersionProperty) => string> = {
    notFound: entry => `${entry.property} is not defined in Directory.Build.props, Directory.Packages.props or a file they import.`,
    conditional: entry => `${entry.property} is set under a condition.`,
    differs: entry => `${entry.property} gets another value later (in a project file or another props file).`,
    conflict: entry => `Other packages that follow ${entry.property} get other versions in this change.`,
};

/**
 * The question for a property other packages follow, or that cannot be changed: changing the property (named with
 * what else follows it) or setting the package alone, which writes a literal version
 */
export function propertyQuestion(entry: VersionProperty): { message: string; detail: string; change?: string; only: string } {
    const { id, version } = entry.edit;
    const only = `Set ${id} Only`;
    const alone = `${only} writes ${version} instead of $(${entry.property}): ${id} no longer follows it.`;
    if (!entry.definition) {
        return {
            message: `${id}'s version is $(${entry.property}), which cannot be changed here.`,
            detail: `${REFUSALS[entry.refusal ?? 'notFound'](entry)} ${alone}`,
            only,
        };
    }
    const others = [
        ...(entry.alsoPackages.length > 0 ? [`${entry.alsoPackages.join(', ')}${entry.alsoProjects.length > 0 ? ` (used by ${entry.alsoProjects.join(', ')})` : ''}`] : []),
        ...(entry.otherUses > 0 ? [`${entry.otherUses} other use${entry.otherUses === 1 ? '' : 's'} of $(${entry.property})`] : []),
    ];
    return {
        message: `${id}'s version is $(${entry.property}), which ${entry.alsoPackages.length > 0 ? 'other packages follow too' : 'is used elsewhere too'}.`,
        detail: `Change ${entry.property} to ${version} in ${path.basename(entry.definition)}: this also changes ${others.join(' and ')}. ${alone}`,
        change: `Change ${entry.property}`,
        only,
    };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/test/unit/services/nuget/ src/test/unit/services/projectItems/ && npm run typecheck`
Expected: PASS (the existing operations tests unchanged: an edit that is no property edit evaluates the same projects as before).

- [ ] **Step 5: Docs**

In `docs/nuget.md`, section "What Install, Update and Uninstall change", after the sentence ending `since MSBuild applies it over the \`Include\`.` (and before ` The files of one change are written together`), split the paragraph there: the first part ends with that sentence; then add the paragraph
```markdown
**Versions written as a property** (`<PackageVersion Include="Serilog" Version="$(SerilogVersion)" />`): the property's definition is changed, so the package keeps following it; it is looked for in `Directory.Build.props`, `Directory.Packages.props` and the files they import (the last one MSBuild reads wins). When other packages use the same property, you are asked first: **Change SerilogVersion** (named with the packages that change along and the projects that use them) or **Set Serilog Only**, which writes the version on Serilog alone (it no longer follows the property; what `dotnet add package` always does). When the definition cannot be changed (not found, under a `Condition`, set again in a project file, or other packages of the same change want another version) only Set Serilog Only is offered. Updating all packages of a property to the same version (Update Selected) changes the property once, without a question.
```
(In the scratch copy the paragraph was inserted right after that sentence, keeping ` The files of one change are written together: ...` after it on the same line; either is fine.)

Append to `docs/manual-testing.md`:
```markdown
- [ ] Central versions as a property (copy of `src/__fixtures__/central-packages/cpm` with `<SerilogVersion>3.1.1</SerilogVersion>` and `Version="$(SerilogVersion)"` on Serilog and on a second package another project uses): updating Serilog in the NuGet manager asks Change SerilogVersion / Set Serilog Only and names the other package and project; Change SerilogVersion edits the property and both trees show the new version after the restore; Set Serilog Only writes the version on Serilog; Cancel changes nothing; with the property used by Serilog alone nothing is asked
```
No GIF: a modal question, described in the page. Only by hand: the modal in VS Code and the tree after the real restore (the edit and MSBuild's evaluation after it are covered by `versionProperties.msbuild.test.ts`).

- [ ] **Step 6: Commit**

```bash
npm run typecheck
git add src/services/nuget/versionProperties.ts src/services/nuget/centralPackageEdits.ts src/services/nuget/centralPackagePlan.ts src/services/nuget/centralPackages.ts src/services/nuget/centralPackageOperations.ts \
  src/test/unit/services/nuget/versionProperties.test.ts src/test/unit/services/nuget/versionProperties.msbuild.test.ts src/test/unit/services/nuget/centralPackageOperations.properties.test.ts src/test/unit/services/nuget/centralPackageEdits.test.ts \
  docs/nuget.md docs/manual-testing.md
git commit -m "Central packages: a version written as \$(Property) changes the property, asking when other packages follow it

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Every project shows Dependencies, with Add Service Reference... in its menu

**Files:**
- Modify: `src/core/Project.ts`, `src/core/contextMenus.ts`; generated: `package.json`, `docs/context-menus.md`
- Test: `src/test/unit/core/Project.items.test.ts`
- Docs: `docs/solution-explorer.md`, `docs/manual-testing.md`

Repro (done while planning): real `Project` instances (Jest, `vscode` mocked, the real `ProjectItemsService` with real MSBuild) for three projects with a `Program.cs`: a bare `OutputType Exe` SDK project → `getRootChildren` gave `["file:Program.cs"]`, `dependencies` `[]`; the same with `<PackageReference Include="Serilog" Version="4.0.0" />` → `["dependencies:Dependencies","file:Program.cs"]`; an old-style project (`ToolsVersion="15.0"`, no references) → `["file:Program.cs"]`. `hasAnyChildren` was `true` for all three (it has files). Under Dependencies, `getDependencies` already lists Analyzers, Packages, Projects and Assemblies even when empty.

- [ ] **Step 1: Write the failing tests**

Change `src/test/unit/core/Project.items.test.ts`:
```diff
diff --git a/src/test/unit/core/Project.items.test.ts b/src/test/unit/core/Project.items.test.ts
index d8552eb..70c72d8 100644
--- a/src/test/unit/core/Project.items.test.ts
+++ b/src/test/unit/core/Project.items.test.ts
@@ -504,4 +504,21 @@ describe('Project file tree with the item overlay', () => {
         expect((await project.getFolderChildren(inner)).map(child => child.name)).toEqual(['A.cs']);
         expect(load).not.toHaveBeenCalled();
     });
+    test('a project without packages, project references and assemblies still has its Dependencies node, first', async () => {
+        const project = await newProject();
+        expect(project.dependencies).toEqual([]);
+        const children = await project.getRootChildren();
+        expect(children[0]).toEqual(expect.objectContaining({ type: 'dependencies', name: 'Dependencies', nodeId: NodeIdService.generateDependenciesId(projectPath) }));
+        expect(project.getDependencies().map(category => category.name)).toEqual(['Analyzers', 'Packages', 'Projects', 'Assemblies']);
+    });
+
+    test('an old-style project without references has it too, and every project can be expanded', async () => {
+        fs.writeFileSync(projectPath, '<?xml version="1.0" encoding="utf-8"?>\n<Project ToolsVersion="15.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">\n'
+            + '  <ItemGroup>\n    <Compile Include="Program.cs" />\n  </ItemGroup>\n</Project>\n');
+        fs.rmSync(path.join(dir, 'Program.cs'));
+        fs.rmSync(path.join(dir, 'Old.cs'));
+        const project = await newProject();
+        expect((await project.getRootChildren()).map(child => child.type)).toEqual(['dependencies']);
+        expect(await project.hasAnyChildren()).toBe(true);
+    });
 });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/test/unit/core/Project.items.test.ts`
Expected: FAIL, 2 tests: the root children start with `Program.cs` / are `[]` instead of `dependencies`.

- [ ] **Step 3: Implement**

Change `src/core/Project.ts`:
```diff
diff --git a/src/core/Project.ts b/src/core/Project.ts
index 8ec8339..242e631 100644
--- a/src/core/Project.ts
+++ b/src/core/Project.ts
@@ -535,45 +535,9 @@ export class Project {
         return paths;
     }
 
-    /**
-     * Quick check if project has any children without loading them
-     */
+    /** Whether the project node can be expanded: always, every project shows its Dependencies node, as in Visual Studio */
     async hasAnyChildren(): Promise<boolean> {
-        try {
-            // Quick check for dependencies
-            if (this.dependencies.length > 0) {
-                return true;
-            }
-
-            // Quick check for root level files/folders
-            const projectDir = path.dirname(this._projectPath);
-
-            try {
-                const entries = await fs.promises.readdir(projectDir, { withFileTypes: true });
-
-                // Check if there are any non-project files or folders
-                for (const entry of entries) {
-                    if (entry.isDirectory() && !shouldSkipDirectory(entry.name)) {
-                        return true; // Found a folder
-                    } else if (entry.isFile()) {
-                        // Skip project files
-                        if (!(entry.name.endsWith('.csproj') ||
-                            entry.name.endsWith('.vbproj') ||
-                            entry.name.endsWith('.fsproj'))) {
-                            return true; // Found a non-project file
-                        }
-                    }
-                }
-
-                return false; // No children found
-            } catch (error) {
-                log.error(`Error checking children for ${this.name}:`, error);
-                return true; // Assume it has children on error
-            }
-        } catch (error) {
-            log.error(`Error in hasAnyChildren for ${this.name}:`, error);
-            return true; // Safe fallback
-        }
+        return true;
     }
 
     /**
@@ -606,15 +570,13 @@ export class Project {
         const items: ProjectChild[] = [];
 
         try {
-            // Add Dependencies container if there are dependencies
-            if (this.dependencies.length > 0) {
-                items.push({
-                    type: 'dependencies',
-                    name: 'Dependencies',
-                    nodeId: NodeIdService.generateDependenciesId(this._projectPath),
-                    hasChildren: true
-                });
-            }
+            // Every project has Dependencies, also one without references (as in Visual Studio): its menu adds them
+            items.push({
+                type: 'dependencies',
+                name: 'Dependencies',
+                nodeId: NodeIdService.generateDependenciesId(this._projectPath),
+                hasChildren: true
+            });
 
             // Get root level files and folders
             const projectDir = path.dirname(this._projectPath);
```

Change `src/core/contextMenus.ts`:
```diff
diff --git a/src/core/contextMenus.ts b/src/core/contextMenus.ts
index 9001bce..3e6bf94 100644
--- a/src/core/contextMenus.ts
+++ b/src/core/contextMenus.ts
@@ -220,7 +220,7 @@ export const contextMenus: Readonly<Record<NodeType, Menu>> & Readonly<Partial<R
     ],
     dependencies: [
         ['manageNuGetPackages'],
-        ['addProjectReference', 'addAssemblyReference'],
+        ['addProjectReference', 'addAssemblyReference', 'addServiceReference'],
         ['restoreDependencies'],
     ],
     dependency: [
```

Then regenerate the menus:
```bash
npm run generate:menus
```
Expected: `package.json context menus and docs/context-menus.md updated`; `git diff --stat` shows `package.json` (one `webview/context` entry for `addServiceReference` with `nodeType == 'dependencies'`, group `02_group@3`) and `docs/context-menus.md` (one row under Dependencies).

- [ ] **Step 4: Run the tests**

Run: `npx jest src/test/unit/core src/test/unit/services/grpc && npm run typecheck`
Expected: PASS (`contextMenus` tests check that `package.json` and the reference are in sync).

- [ ] **Step 5: Docs**

In `docs/solution-explorer.md` replace
```markdown
## Dependencies

Under each project:
```
with
```markdown
## Dependencies

Every project has a Dependencies node, also one without packages or references (as in Visual Studio); right-click it for Manage NuGet Packages..., Add Project Reference..., Add Assembly Reference..., Add Service Reference... and Restore Dependencies. Under it:
```
Append to `docs/manual-testing.md`:
```markdown
- [ ] Dependencies on every project (a fresh `dotnet new console` project in a solution): the project shows Dependencies with Analyzers, Packages, Projects, Assemblies; its menu has Add Service Reference..., which offers WCF and gRPC like the project menu
```
No GIF: one more node; the menu reference is generated. Only by hand: the native menu entry.

- [ ] **Step 6: Commit**

```bash
npm run typecheck
git add src/core/Project.ts src/core/contextMenus.ts package.json docs/context-menus.md src/test/unit/core/Project.items.test.ts docs/solution-explorer.md docs/manual-testing.md
git commit -m "Every project shows Dependencies, with Add Service Reference... in its menu

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Dropping a project onto another project's Dependencies adds a project reference

**Files:**
- Create: `src/services/projectReferences.ts`
- Modify: `src/core/dropRules.ts`, `src/services/solutionDropNodes.ts`, `src/services/solutionActionService.ts`, `src/webview/solution-view/components/SolutionTree.tsx`
- Test: `src/test/unit/services/projectReferences.test.ts` (create), `src/test/unit/core/dropRules.test.ts`, `src/test/unit/services/moveNodes.test.ts`, `src/test/unit/webview/solution-view/components/SolutionTreeDragDrop.test.tsx` (modify)
- Docs: `docs/solution-explorer.md`, `docs/manual-testing.md`

Repro (done while planning): the real `canDrop` with a project `Lib` dragged onto the `dependencies` node of project `App` (ancestors App, solution) gave `{"nodes":[],"effect":"move"}`: refused, so the webview shows the not-allowed pointer; on the host `solutionDropNode` returned `ancestors: []` for Dependencies. `dotnet add A reference B` then `dotnet add B reference A` (SDK 10.0.111) **both succeed** (a circular reference is written, exit 0); a second `dotnet add A reference B` prints `Project already has a reference to ...` with exit 0; a net10.0 project added to a net8.0 project fails with exit 1 and `cannot be added due to incompatible targeted frameworks`. Visual Studio refuses circular references, so the checks run before the CLI. The drag starts with `effectAllowed = 'copyMove'`, and a `dropEffect` of `link` outside it cancels the drop (HTML drag and drop), so it becomes `all`.

- [ ] **Step 1: Write the failing tests**

Change `src/test/unit/core/dropRules.test.ts`:
```diff
diff --git a/src/test/unit/core/dropRules.test.ts b/src/test/unit/core/dropRules.test.ts
index 03ca038..536720a 100644
--- a/src/test/unit/core/dropRules.test.ts
+++ b/src/test/unit/core/dropRules.test.ts
@@ -115,3 +115,35 @@ describe('dropRules', () => {
         expect(drop(['Libs'], 'App').nodes).toEqual([]);
     });
 });
+
+describe('projects onto Dependencies: a project reference', () => {
+    const refTree: ProjectNode[] = [node('solution', 'S', [
+        node('project', 'Web', [
+            node('dependencies', 'Web.Dependencies', [
+                node('dependencyCategory', 'Web.Projects', undefined, { contextValue: 'projects' }),
+                node('dependencyCategory', 'Web.Packages', undefined, { contextValue: 'packages' }),
+            ]),
+            node('file', 'Program.cs'),
+        ]),
+        node('project', 'Lib'),
+        node('project', 'Gone', undefined, { isUnloaded: true }),
+    ])];
+    const refs = dropNodeIndex(refTree);
+    const get = (name: string) => refs.get(name as NodeIdString)!;
+
+    test('another project onto Dependencies or onto its Projects category links, also with the copy key', () => {
+        expect(canDrop([get('Lib')], get('Web.Dependencies'))).toEqual({ nodes: [get('Lib')], container: get('Web.Dependencies'), effect: 'link' });
+        expect(canDrop([get('Lib')], get('Web.Projects'), true).effect).toBe('link');
+    });
+
+    test('not the project onto its own Dependencies, not onto Packages, not files, not an unloaded project', () => {
+        expect(canDrop([get('Web')], get('Web.Dependencies')).nodes).toEqual([]);
+        expect(canDrop([get('Lib')], get('Web.Packages')).nodes).toEqual([]);
+        expect(canDrop([get('Program.cs')], get('Web.Dependencies')).nodes).toEqual([]);
+        expect(canDrop([get('Gone')], get('Web.Dependencies')).nodes).toEqual([]);
+    });
+
+    test('with the project itself among several, only the others link', () => {
+        expect(canDrop([get('Web'), get('Lib')], get('Web.Dependencies')).nodes.map(n => n.nodeId)).toEqual(['Lib']);
+    });
+});
```

Change `src/test/unit/services/moveNodes.test.ts`:
```diff
diff --git a/src/test/unit/services/moveNodes.test.ts b/src/test/unit/services/moveNodes.test.ts
index b0461a3..514a172 100644
--- a/src/test/unit/services/moveNodes.test.ts
+++ b/src/test/unit/services/moveNodes.test.ts
@@ -279,4 +279,20 @@ describe('SolutionActionService.moveNodes (drag & drop)', () => {
             slnx.dispose();
         }
     });
+    (require('child_process').spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip)(
+        'a project dropped onto another project\'s Dependencies becomes a project reference; a circle is refused', async () => {
+            const webApi = at('src', 'WebApi', 'WebApi.csproj');
+            const deps = (...parts: string[]) => NodeIdService.generateDependenciesId(at(...parts));
+            expect(solutionDropNode(solution, deps('src', 'WebApi', 'WebApi.csproj'))!.ancestors[0]).toEqual({ nodeId: projectNode('src', 'WebApi', 'WebApi.csproj'), type: 'project' });
+
+            const before = parentName('Utils');
+            expect(await SolutionActionService.moveNodes([projectNode('lib', 'Utils', 'Utils.csproj')], deps('src', 'WebApi', 'WebApi.csproj'), false)).toBeUndefined();
+            expect(fs.readFileSync(webApi, 'utf8')).toMatch(/<ProjectReference Include="..[\\/]..[\\/]lib[\\/]Utils[\\/]Utils.csproj" \/>/);
+            // Not moved in the solution file
+            expect(parentName('Utils')).toBe(before);
+
+            await SolutionActionService.moveNodes([projectNode('src', 'WebApi', 'WebApi.csproj')], deps('lib', 'Utils', 'Utils.csproj'), false);
+            expect(ui.warnings).toEqual(['A reference from Utils to WebApi would cause a circular dependency.']);
+            expect(fs.readFileSync(at('lib', 'Utils', 'Utils.csproj'), 'utf8')).not.toContain('ProjectReference');
+        }, 150000);
 });
```

Create `src/test/unit/services/projectReferences.test.ts`:
```ts
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addProjectReferences, projectReferencesIn, referenceRefusal } from '../../../services/projectReferences';

const at = (...parts: string[]) => path.resolve('/repo', ...parts);

describe('project references', () => {
    test('read from the project file, relative to its folder, not from comments', () => {
        const content = '<Project>\n  <ItemGroup>\n    <ProjectReference Include="..\\Lib\\Lib.csproj" />\n'
            + '    <!-- <ProjectReference Include="..\\Old\\Old.csproj" /> -->\n    <ProjectReference Include=\'../Core/Core.csproj\'>\n'
            + '      <Private>false</Private>\n    </ProjectReference>\n  </ItemGroup>\n</Project>\n';
        expect(projectReferencesIn(content, at('Web'))).toEqual([at('Lib', 'Lib.csproj'), at('Core', 'Core.csproj')]);
    });

    test('refused: itself, one it has, and one that would close a circle through others', () => {
        const graph: Record<string, string[]> = {
            [at('Web', 'Web.csproj')]: [at('Lib', 'Lib.csproj')],
            [at('Lib', 'Lib.csproj')]: [at('Core', 'Core.csproj')],
            [at('Core', 'Core.csproj')]: [],
        };
        const of = (project: string) => graph[project] ?? [];
        expect(referenceRefusal(at('Web', 'Web.csproj'), at('Web', 'Web.csproj'), of)).toBe('Web cannot reference itself.');
        expect(referenceRefusal(at('Web', 'Web.csproj'), at('Lib', 'Lib.csproj'), of)).toBe('Web already references Lib.');
        expect(referenceRefusal(at('Core', 'Core.csproj'), at('Web', 'Web.csproj'), of)).toBe('A reference from Core to Web would cause a circular dependency.');
        expect(referenceRefusal(at('Web', 'Web.csproj'), at('Core', 'Core.csproj'), of)).toBeUndefined();
    });

    test('the refused ones are left out of the dotnet call; none left: no call', async () => {
        const run = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
        const of = (project: string) => project === at('Lib', 'Lib.csproj') ? [at('Web', 'Web.csproj')] : [];
        const result = await addProjectReferences(at('Web', 'Web.csproj'), [at('Lib', 'Lib.csproj'), at('Core', 'Core.csproj')], run, of);
        expect(result).toEqual({ added: [at('Core', 'Core.csproj')], refused: ['A reference from Web to Lib would cause a circular dependency.'] });
        expect(run).toHaveBeenCalledWith(['add', at('Web', 'Web.csproj'), 'reference', at('Core', 'Core.csproj')], at('Web'));
        run.mockClear();
        await addProjectReferences(at('Web', 'Web.csproj'), [at('Web', 'Web.csproj')], run, of);
        expect(run).not.toHaveBeenCalled();
    });

    const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip;
    withDotnet('real dotnet: adds the reference, and says why when the target frameworks do not fit', async () => {
        const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'project-references-')));
        try {
            const project = (name: string, framework: string) => {
                fs.mkdirSync(path.join(root, name));
                fs.writeFileSync(path.join(root, name, `${name}.csproj`), `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>${framework}</TargetFramework>\n  </PropertyGroup>\n</Project>\n`);
                return path.join(root, name, `${name}.csproj`);
            };
            const web = project('Web', 'net8.0');
            const lib = project('Lib', 'net8.0');
            const newer = project('Newer', 'net10.0');
            expect(await addProjectReferences(web, [lib])).toEqual({ added: [lib], refused: [] });
            expect(projectReferencesIn(fs.readFileSync(web, 'utf8'), path.dirname(web))).toEqual([lib]);
            expect(await addProjectReferences(lib, [web])).toEqual({ added: [], refused: ['A reference from Lib to Web would cause a circular dependency.'] });
            const failed = await addProjectReferences(web, [newer]);
            expect(failed.added).toEqual([]);
            expect(failed.error).toMatch(/incompatible targeted frameworks/);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    }, 150000);
});
```

Change `src/test/unit/webview/solution-view/components/SolutionTreeDragDrop.test.tsx`:
```diff
diff --git a/src/test/unit/webview/solution-view/components/SolutionTreeDragDrop.test.tsx b/src/test/unit/webview/solution-view/components/SolutionTreeDragDrop.test.tsx
index 4e9c4ef..d59e25e 100644
--- a/src/test/unit/webview/solution-view/components/SolutionTreeDragDrop.test.tsx
+++ b/src/test/unit/webview/solution-view/components/SolutionTreeDragDrop.test.tsx
@@ -31,9 +31,9 @@ type Keys = { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean };
 describe('SolutionTree drag & drop', () => {
     beforeEach(() => { sent.length = 0; });
 
-    const setup = () => {
+    const setup = (tree: ProjectNode[] = projects) => {
         const onExpandNode = jest.fn();
-        const { container } = render(<SolutionTree projects={projects} onProjectAction={() => { }} onExpandNode={onExpandNode} />);
+        const { container } = render(<SolutionTree projects={tree} onProjectAction={() => { }} onExpandNode={onExpandNode} />);
         const row = (name: string) => [...container.querySelectorAll('.tree-node')].find(el => el.textContent === name)!;
         const data: Record<string, string> = {};
         const transfer = {
@@ -74,7 +74,7 @@ describe('SolutionTree drag & drop', () => {
         fireEvent.click(row('B.cs'), { ctrlKey: true });
 
         drag('dragStart', 'A.cs');
-        expect(transfer.effectAllowed).toBe('copyMove');
+        expect(transfer.effectAllowed).toBe('all');
         expect(JSON.parse(transfer.data[DRAG_DATA_TYPE])).toEqual(['A.cs', 'B.cs']);
         drag('dragOver', 'Controllers');
         drag('drop', 'Controllers');
@@ -244,4 +244,22 @@ describe('SolutionTree drag & drop', () => {
         expect(html).not.toContain('.tree-node:hover');
         expect(html).toContain('.tree-node.hovered {');
     });
+    it('a project over another project\'s Dependencies shows the link pointer and sends the drop; not over its own', () => {
+        const withLib = [node('solution', 'App', [
+            node('project', 'Api', [node('dependencies', 'Dependencies', undefined, { hasChildren: true }), node('file', 'A.cs')], { expanded: true }),
+            node('project', 'Lib'),
+        ], { expanded: true })];
+        const { drag, transfer, moves, highlighted } = setup(withLib);
+        drag('dragStart', 'Lib');
+        drag('dragOver', 'Dependencies');
+        expect(transfer.dropEffect).toBe('link');
+        expect(highlighted()).toEqual(['Dependencies']);
+        drag('drop', 'Dependencies');
+        expect(moves()).toEqual([{ nodeIds: ['Lib'], targetNodeId: 'Dependencies', copy: false }]);
+
+        transfer.dropEffect = 'none';
+        drag('dragStart', 'Api');
+        const over = drag('dragOver', 'Dependencies');
+        expect(over.defaultPrevented).toBe(false);
+    });
 });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/test/unit/core/dropRules.test.ts src/test/unit/services/projectReferences.test.ts src/test/unit/services/moveNodes.test.ts src/test/unit/webview/solution-view/components/SolutionTreeDragDrop.test.tsx`
Expected: FAIL: `TS2307: Cannot find module '../../../services/projectReferences'`; in the others 5 tests fail, e.g. `Expected: "all" Received: "copyMove"`, `Expected: "link" Received: "none"`, the Dependencies drop node's first ancestor `Received: undefined`, and the drop rules give `nodes: []`.

- [ ] **Step 3: Implement**

Change `src/core/dropRules.ts`:
```diff
diff --git a/src/core/dropRules.ts b/src/core/dropRules.ts
index 17163a2..c77984b 100644
--- a/src/core/dropRules.ts
+++ b/src/core/dropRules.ts
@@ -17,22 +17,27 @@ export interface DropNode extends DropAncestor {
     readonly isUnloaded?: boolean;
     readonly isTemporary?: boolean;
     readonly itemState?: 'excluded' | 'linked';
+    /** The node's `contextValue`: tells the Projects category under Dependencies from the others */
+    readonly contextValue?: string;
 }
 
-export type DropEffect = 'move' | 'copy';
+/** `link`: projects dropped onto Dependencies get a project reference */
+export type DropEffect = 'move' | 'copy' | 'link';
 
 export interface DropVerdict {
     /** The dragged nodes that go to the target, in drag order; none: the drop is not allowed */
     readonly nodes: readonly DropNode[];
     /** Where they go: the target, or for a file target the folder or project it is in */
     readonly container?: DropAncestor;
-    /** `copy` only for files and folders with Ctrl (Cmd on macOS) held */
+    /** `copy` only for files and folders with Ctrl (Cmd on macOS) held; `link` for projects onto Dependencies */
     readonly effect: DropEffect;
 }
 
 const FILE_LIKE: readonly NodeType[] = ['file', 'folder'];
 const SOLUTION_LEVEL: readonly NodeType[] = ['project', 'solutionFolder', 'solutionItem'];
 const isContainer = (node: DropAncestor) => node.type === 'folder' || node.type === 'project';
+/** Dependencies, or Projects under it: a project dropped there becomes a project reference, as in Visual Studio */
+const isReferenceTarget = (node: DropNode) => node.type === 'dependencies' || (node.type === 'dependencyCategory' && node.contextValue === 'projects');
 
 /**
  * Files, folders, projects, solution folders and solution items have a move; not linked files, unloaded projects,
@@ -66,6 +71,8 @@ function containerFor(node: DropNode, target: DropNode): DropAncestor | undefine
             }
             return target.type === 'file' ? target.ancestors.find(isContainer) : undefined;
         case 'project':
+            // Onto another project's Dependencies: its own project is in the target's ancestors, so canDrop refuses that
+            return target.type === 'solution' || target.type === 'solutionFolder' || isReferenceTarget(target) ? target : undefined;
         case 'solutionFolder':
             return target.type === 'solution' || target.type === 'solutionFolder' ? target : undefined;
         case 'solutionItem':
@@ -96,7 +103,8 @@ export function canDrop(dragged: readonly DropNode[], target: DropNode, copyKey
         return true;
     });
     const copy = copyKey && nodes.length > 0 && nodes.every(node => FILE_LIKE.includes(node.type));
-    return { nodes, container: nodes.length > 0 ? container : undefined, effect: copy ? 'copy' : 'move' };
+    const effect: DropEffect = nodes.length > 0 && isReferenceTarget(target) ? 'link' : copy ? 'copy' : 'move';
+    return { nodes, container: nodes.length > 0 ? container : undefined, effect };
 }
 
 /** The rule nodes of a tree the webview shows, by id (only what is loaded: collapsed folders have no children yet) */
@@ -111,6 +119,7 @@ export function dropNodeIndex(roots: readonly ProjectNode[]): Map<NodeIdString,
                 isUnloaded: node.isUnloaded,
                 isTemporary: node.isTemporary,
                 itemState: node.itemState,
+                contextValue: node.contextValue,
             });
             if (node.children) {
                 walk(node.children, [{ nodeId: node.nodeId, type: node.type }, ...ancestors]);
```

Create `src/services/projectReferences.ts`:
```ts
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ProjectFileEditor } from '../parsers/projectFileEditor';
import { pathKey } from './projectItems/projectItems';

const execFileAsync = promisify(execFile);

const key = (file: string) => pathKey(path.normalize(file));

/** The projects a project file references (`<ProjectReference Include="..."/>`, outside comments and targets), as full paths */
export function projectReferencesIn(content: string, projectDir: string): string[] {
    const ignored = ProjectFileEditor.ignoredRanges(content);
    return [...content.matchAll(/<ProjectReference\b(?:[^>"']|"[^"]*"|'[^']*')*?\bInclude\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
        .filter(match => !ProjectFileEditor.inRanges(ignored, match.index!))
        .map(match => path.resolve(projectDir, ProjectFileEditor.unescape(match[1] ?? match[2]).replace(/[\\/]/g, path.sep)));
}

/** The references of a project file on disk; none when it cannot be read */
export function projectReferencesOf(projectPath: string): string[] {
    try {
        return projectReferencesIn(fs.readFileSync(projectPath, 'utf8'), path.dirname(projectPath));
    } catch {
        return [];
    }
}

/**
 * Why `project` must not reference `reference`, or undefined when it may: itself, a reference it has, or one that
 * would close a circle (the reference already depends on the project, directly or through others). Visual Studio
 * refuses the circle; `dotnet add reference` writes it (checked with SDK 10.0.111).
 */
export function referenceRefusal(project: string, reference: string, referencesOf: (projectPath: string) => readonly string[] = projectReferencesOf): string | undefined {
    const name = (file: string) => path.basename(file, path.extname(file));
    if (key(project) === key(reference)) {
        return `${name(project)} cannot reference itself.`;
    }
    if (referencesOf(project).some(existing => key(existing) === key(reference))) {
        return `${name(project)} already references ${name(reference)}.`;
    }
    const seen = new Set<string>();
    const pending = [reference];
    while (pending.length > 0) {
        const current = pending.pop()!;
        if (seen.has(key(current))) {
            continue;
        }
        seen.add(key(current));
        for (const next of referencesOf(current)) {
            if (key(next) === key(project)) {
                return `A reference from ${name(project)} to ${name(reference)} would cause a circular dependency.`;
            }
            pending.push(next);
        }
    }
    return undefined;
}

export type RunDotnet = (args: readonly string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;

const runDotnet: RunDotnet = (args, cwd) => execFileAsync('dotnet', [...args], { cwd, timeout: 120000 });

/**
 * `dotnet add <project> reference <references...>` (it checks the target frameworks); the references that are refused
 * (see referenceRefusal) are left out and returned with the reason
 */
export async function addProjectReferences(
    project: string, references: readonly string[], run: RunDotnet = runDotnet, referencesOf?: (projectPath: string) => readonly string[],
): Promise<{ added: string[]; refused: string[]; error?: string }> {
    const refused: string[] = [];
    const added: string[] = [];
    for (const reference of references) {
        const refusal = referenceRefusal(project, reference, referencesOf);
        if (refusal) {
            refused.push(refusal);
        } else if (!added.some(other => key(other) === key(reference))) {
            added.push(reference);
        }
    }
    if (added.length === 0) {
        return { added, refused };
    }
    try {
        await run(['add', project, 'reference', ...added], path.dirname(project));
        return { added, refused };
    } catch (error) {
        const output = error as { stdout?: string; stderr?: string; message?: string };
        return { added: [], refused, error: `${output.stdout ?? ''}${output.stderr ?? ''}`.trim() || output.message || String(error) };
    }
}
```

Change `src/services/solutionActionService.ts`:
```diff
diff --git a/src/services/solutionActionService.ts b/src/services/solutionActionService.ts
index b8a83aa..3999270 100644
--- a/src/services/solutionActionService.ts
+++ b/src/services/solutionActionService.ts
@@ -27,6 +27,7 @@ import { projectForPath } from './templates/templateService';
 import { ProjectItemsService } from './projectItems/projectItemsService';
 import { excludeEdit, includeEdit, includeItemCount, INCLUDE_CONFIRM_LIMIT, listFilesUnder, membershipApplied, membershipRefusal } from './projectItems/projectItemEdits';
 import { itemsWithoutExcludes } from './projectItems/defaultItems';
+import { addProjectReferences } from './projectReferences';
 import { DebugConfigService } from './debugConfigService';
 import { startWithHotReload } from './hotReload/startWithHotReload';
 import { dependentRenames } from './templates/dependentRenames';
@@ -1532,6 +1533,10 @@ export class SolutionActionService {
             vscode.window.showWarningMessage('The items cannot be dropped there.');
             return undefined;
         }
+        if (verdict.effect === 'link') {
+            await this._addDroppedReferences(NodeIdService.parse(verdict.container.nodeId).path, verdict.nodes.map(node => NodeIdService.parse(node.nodeId).path));
+            return undefined;
+        }
         const dropped: DropResult['nodes'][number][] = [];
         try {
             const container = NodeIdService.parse(verdict.container.nodeId);
@@ -1573,6 +1578,24 @@ export class SolutionActionService {
         return dropped.length > 0 ? { container: verdict.container.nodeId, nodes: dropped } : undefined;
     }
 
+    /**
+     * Projects dropped onto another project's Dependencies: project references, as in Visual Studio. Refused ones
+     * (itself, already referenced, a circle) are named in a warning; `dotnet add reference` refuses incompatible target
+     * frameworks, its message is shown. The project file watcher shows the new references.
+     */
+    private static async _addDroppedReferences(projectPath: string, references: readonly string[]): Promise<void> {
+        const result = await addProjectReferences(projectPath, references);
+        if (result.added.length > 0) {
+            log.info(`Added project references to ${path.basename(projectPath)}: ${result.added.map(reference => path.basename(reference)).join(', ')}`);
+        }
+        if (result.refused.length > 0) {
+            vscode.window.showWarningMessage(result.refused.join(' '));
+        }
+        if (result.error) {
+            vscode.window.showErrorMessage(`Could not add the project reference: ${result.error}`);
+        }
+    }
+
     /** Copies or moves one file or folder into `pasteTargetPath`, asking before replacing; returns where it went (undefined: not done) */
     private static async _pasteOne(sourcePath: string, pasteTargetPath: string, operation: 'copy' | 'cut'): Promise<string | undefined> {
         const sourceName = path.basename(sourcePath);
```

Change `src/services/solutionDropNodes.ts`:
```diff
diff --git a/src/services/solutionDropNodes.ts b/src/services/solutionDropNodes.ts
index 555d493..f01828c 100644
--- a/src/services/solutionDropNodes.ts
+++ b/src/services/solutionDropNodes.ts
@@ -132,8 +132,22 @@ export function solutionDropNode(solution: Solution, nodeIdString: NodeIdString)
                 ancestors: [...folders, { nodeId: projectId(projectPath), type: 'project' }, ...chainFrom(parentGuidOf(projectEntry(projectPath)?.guid))],
             };
         }
+        case 'dependencies':
+        case 'dependencyCategory': {
+            // A target for project references: the project above it keeps a project from referencing itself
+            const entry = projectEntry(path.resolve(node.path));
+            if (!entry || UnloadedProjects.isUnloaded(solution.solutionPath, path.resolve(solutionDir, entry.path))) {
+                return undefined;
+            }
+            return {
+                nodeId: nodeIdString,
+                type: node.type,
+                ...(node.type === 'dependencyCategory' ? { contextValue: node.name } : {}),
+                ancestors: [{ nodeId: projectId(path.resolve(solutionDir, entry.path)), type: 'project' }, ...chainFrom(parentGuidOf(entry.guid))],
+            };
+        }
         default:
-            // Dependencies, analyzers, generated files and the like: no move and no target
+            // Analyzers, generated files and the like: no move and no target
             return { nodeId: nodeIdString, type: node.type, ancestors: [] };
     }
 }
```

Change `src/webview/solution-view/components/SolutionTree.tsx`:
```diff
diff --git a/src/webview/solution-view/components/SolutionTree.tsx b/src/webview/solution-view/components/SolutionTree.tsx
index 5900f8d..5810d44 100644
--- a/src/webview/solution-view/components/SolutionTree.tsx
+++ b/src/webview/solution-view/components/SolutionTree.tsx
@@ -222,7 +222,8 @@ export const SolutionTree: React.FC<SolutionTreeProps> = ({ projects, activeFile
         hoverPaused.current = true;
         setHoveredNodeId(undefined);
         e.dataTransfer.setData(DRAG_DATA_TYPE, JSON.stringify(ids));
-        e.dataTransfer.effectAllowed = 'copyMove';
+        // `link` too: a project dropped onto Dependencies becomes a reference (a dropEffect not allowed here cancels the drop)
+        e.dataTransfer.effectAllowed = 'all';
     };
 
     const handleNodeDragOver = (nodeId: NodeIdString, e: React.DragEvent) => {
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/test/unit/core/dropRules.test.ts src/test/unit/services/projectReferences.test.ts src/test/unit/services/moveNodes.test.ts src/test/unit/webview src/test/unit/build && npm run typecheck`
Expected: PASS (`opaqueNodeIds.test.ts` and `webviewBundle.test.ts` included: the webview change is one assignment).

- [ ] **Step 5: Docs**

In `docs/solution-explorer.md`, section "Drag and drop", add a row after the "Solution items" row of the table:
```markdown
| Projects | Another project's Dependencies (or Projects under it) | Adds a project reference (`dotnet add reference`); refused onto the project itself, for a reference it has, and when it would make a circle | Adds a reference |
```
and replace
```markdown
- Files dropped from outside the tree (VS Code's Explorer, the file manager) are not taken, and dropping a project onto Dependencies adds no reference: use Add Project Reference...
```
with
```markdown
- Files dropped from outside the tree (VS Code's Explorer, the file manager) are not taken.
- A project reference to a project with a target framework that does not fit is refused with the .NET SDK's message.
```
Append to `docs/manual-testing.md`:
```markdown
- [ ] Project onto Dependencies (BasicsTestProject): drag a class library onto a console project's Dependencies: the pointer shows a link, the drop adds the `ProjectReference` and Dependencies > Projects lists it; dropping it again says it is already referenced; dropping the console project onto the library's Dependencies says it would cause a circular dependency; dropping onto Projects under Dependencies works the same; a net10.0 project onto a net8.0 project's Dependencies shows the SDK's message
```
No GIF (the table describes the gesture; `drag-and-drop.gif` stays valid). Only by hand: the link pointer in a real webview (Chromium's drag cursors), the refresh of Dependencies > Projects through the file watcher.

- [ ] **Step 6: Commit**

```bash
npm run typecheck
git add src/services/projectReferences.ts src/core/dropRules.ts src/services/solutionDropNodes.ts src/services/solutionActionService.ts src/webview/solution-view/components/SolutionTree.tsx \
  src/test/unit/services/projectReferences.test.ts src/test/unit/core/dropRules.test.ts src/test/unit/services/moveNodes.test.ts src/test/unit/webview/solution-view/components/SolutionTreeDragDrop.test.tsx \
  docs/solution-explorer.md docs/manual-testing.md
git commit -m "Drag & drop: a project dropped onto another project's Dependencies becomes a project reference

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: A startup profile that goes away falls back to the first project that can be started

**Files:**
- Modify: `src/services/startupProfiles/startProfile.ts`
- Test: `src/test/unit/services/startupProfiles/startupProfileLaunch.test.ts`
- Docs: `docs/run-and-debug.md`, `docs/manual-testing.md`

Repro (done while planning): the real `StartupChoice` and `refreshStartup` in the harness of `startupProfileLaunch.test.ts` (`vscode` mocked, a temp workspace with Lib, Api, Worker and the `Shop.slnLaunch` profile "Both"): `useProfile` without a remembered single project, `refreshStartup` → `launch.json` had the two hidden configurations and the `Startup` compound; after deleting `Shop.slnLaunch` and `refreshStartup` it was `{"version": "0.2.0", "configurations": [], "compounds": []}`, `getStartupProject()` `null`, no message; `startStartupProject` then said `There is no startup project. Right-click a project ...` and plain F5 has no configuration (VS Code asks "Select a debugger", the user's observation; not run here). Elsewhere the extension never picks a startup project by itself: only Set as Startup Project, Configure Startup Projects and the framework picker write it.

- [ ] **Step 1: Write the failing tests**

Change `src/test/unit/services/startupProfiles/startupProfileLaunch.test.ts`:
```diff
diff --git a/src/test/unit/services/startupProfiles/startupProfileLaunch.test.ts b/src/test/unit/services/startupProfiles/startupProfileLaunch.test.ts
index 0ae4986..a530fb8 100644
--- a/src/test/unit/services/startupProfiles/startupProfileLaunch.test.ts
+++ b/src/test/unit/services/startupProfiles/startupProfileLaunch.test.ts
@@ -55,7 +55,7 @@ jest.mock('../../../../services/unloadedProjects', () => ({
 
 import { DebugConfigService } from '../../../../services/debugConfigService';
 import { StartupChoice } from '../../../../services/startupProfiles/startupChoice';
-import { refreshStartup, selectStartupProfile } from '../../../../services/startupProfiles/startProfile';
+import { defaultStartupProject, refreshStartup, selectStartupProfile } from '../../../../services/startupProfiles/startProfile';
 import { parseJsonc } from '../../../../core/jsonc';
 
 class Memento {
@@ -311,4 +311,52 @@ describe('startup profiles: the "Startup" launch entry, F5 and Ctrl+F5', () => {
         expect(DebugConfigService.getStartupProject()).toBe(apiPath);
         expect(launchJson().configurations[0].launchSettingsProfile).toBe('http');
     }, 60000);
+    it('a profile that goes away when no startup project was set before it: the first project that can start becomes the startup project', async () => {
+        const libPath = path.join(env.workspacePath, 'Lib', 'Lib.csproj');
+        const workerPath = path.join(env.workspacePath, 'Worker', 'Worker.csproj');
+        env.solution = {
+            ...env.solution,
+            configurationProjects: [{ path: 'Lib/Lib.csproj' }, { path: 'Api/Api.csproj' }, { path: 'Worker/Worker.csproj' }],
+            projects: new Map([
+                [libPath, { isExecutable: false, isTestProject: false }],
+                [apiPath, { isExecutable: true, isTestProject: false }],
+                [workerPath, { isExecutable: true, isTestProject: false }],
+            ]),
+        };
+        await StartupChoice.useProfile(solutionPath, { name: 'Both', source: 'shared' });
+        await refreshStartup();
+        expect(launchJson().compounds).toEqual([COMPOUND]);
+
+        fs.rmSync(path.join(env.workspacePath, 'Shop.slnLaunch'));
+        await refreshStartup();
+
+        expect(launchJson().compounds).toEqual([]);
+        expect(launchJson().configurations.map((config: any) => config.name)).toEqual(['Startup']);
+        expect(DebugConfigService.getStartupProject()).toBe(apiPath);
+        expect(env.messages).toEqual([expect.stringContaining('F5 starts Api, the first project of the solution that can be started')]);
+    }, 60000);
+
+    it('none of the projects can start: the profile entries go and it says F5 has nothing to start', async () => {
+        await StartupChoice.useProfile(solutionPath, { name: 'Both', source: 'shared' });
+        await refreshStartup();
+        await StartupChoice.useSingle(solutionPath);
+        await refreshStartup();
+
+        expect(launchJson().compounds).toEqual([]);
+        expect(launchJson().configurations).toEqual([]);
+        expect(env.messages).toEqual([expect.stringContaining('F5 has nothing to start')]);
+    }, 60000);
+
+    it('defaultStartupProject skips libraries, test projects and unloaded projects, in the solution file\'s order', () => {
+        const project = (isExecutable: boolean, isTestProject = false) => ({ isExecutable, isTestProject });
+        const at = (name: string) => path.join(env.workspacePath, name, `${name}.csproj`);
+        const solution = {
+            solutionPath,
+            configurationProjects: ['Lib', 'Tests', 'Gone', 'Worker', 'Api'].map(name => ({ path: `${name}/${name}.csproj` })),
+            projects: new Map([[at('Lib'), project(false)], [at('Tests'), project(true, true)], [at('Gone'), project(true)], [at('Worker'), project(true)], [at('Api'), project(true)]]),
+        };
+        env.unloaded = [at('Gone')];
+        expect(defaultStartupProject(solution)).toBe(at('Worker'));
+        expect(defaultStartupProject({ ...solution, configurationProjects: [{ path: 'Lib/Lib.csproj' }] })).toBeUndefined();
+    });
 });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/test/unit/services/startupProfiles/startupProfileLaunch.test.ts`
Expected: FAIL: `TS2305: Module '"../../../../services/startupProfiles/startProfile"' has no exported member 'defaultStartupProject'.`

- [ ] **Step 3: Implement**

Change `src/services/startupProfiles/startProfile.ts`:
```diff
diff --git a/src/services/startupProfiles/startProfile.ts b/src/services/startupProfiles/startProfile.ts
index f486318..cf46cf5 100644
--- a/src/services/startupProfiles/startProfile.ts
+++ b/src/services/startupProfiles/startProfile.ts
@@ -89,6 +89,34 @@ export function startupPickItems(
     return items;
 }
 
+/** What defaultStartupProject needs of the solution */
+export interface StartableProjects {
+    readonly solutionPath: string;
+    /** The projects in the solution file's order (paths relative to the solution, forward slashes) */
+    readonly configurationProjects: readonly { path: string }[];
+    readonly projects: ReadonlyMap<string, { readonly isExecutable: boolean; readonly isTestProject: boolean }>;
+}
+
+/**
+ * The startup project when none was ever set: the first project of the solution file that can be started (console,
+ * web, worker...; not a library, a test project or an unloaded project). Visual Studio takes the first project of the
+ * solution file, even a library that then cannot start; the first one that can start is what that is meant to be.
+ */
+export function defaultStartupProject(solution: StartableProjects): string | undefined {
+    const solutionDir = path.dirname(solution.solutionPath);
+    const same = (a: string, b: string) => process.platform === 'win32' || process.platform === 'darwin'
+        ? path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase()
+        : path.normalize(a) === path.normalize(b);
+    for (const entry of solution.configurationProjects) {
+        const projectPath = path.resolve(solutionDir, entry.path);
+        const project = [...solution.projects].find(([candidate]) => same(candidate, projectPath))?.[1];
+        if (project?.isExecutable && !project.isTestProject && !UnloadedProjects.isUnloaded(solution.solutionPath, projectPath)) {
+            return projectPath;
+        }
+    }
+    return undefined;
+}
+
 let lastWarning = '';
 
 async function writeProfileStartup(profile: StartupProfile, solutionPath: string): Promise<void> {
@@ -137,8 +165,21 @@ async function doRefreshStartup(): Promise<void> {
         const single = solutionPath ? StartupChoice.rememberedSingle(solutionPath) : undefined;
         if (single && fs.existsSync(single.projectPath)) {
             await DebugConfigService.updateStartupConfiguration(single.projectPath, single.framework, false, single.launchProfile);
+            return;
+        }
+        // No startup project was set before the profile: without one F5 would ask "Select a debugger"
+        const solution = SolutionService.getActiveSolution();
+        const fallback = solution ? defaultStartupProject(solution) : undefined;
+        if (fallback && await DebugConfigService.updateStartupConfiguration(fallback)) {
+            const message = `F5 starts ${projectName(fallback)}, the first project of the solution that can be started: `
+                + 'no startup project was set before the startup profile. Set as Startup Project chooses another.';
+            log.info(message);
+            void vscode.window.showInformationMessage(message);
         } else {
             DebugConfigService.removeStartupProfileConfiguration();
+            const message = 'The startup profile is no longer used and the solution has no project that can be started: F5 has nothing to start.';
+            log.info(message);
+            void vscode.window.showInformationMessage(message);
         }
         return;
     }
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/test/unit/services/startupProfiles src/test/unit/services/debugConfigService.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Docs**

In `docs/run-and-debug.md` replace
```markdown
if the file or the profile is gone, F5 starts the single startup project again.
```
with
```markdown
if the file or the profile is gone (or Single is chosen), F5 starts the single startup project again. When no startup project was set before the profile, the first project of the solution that can be started becomes the startup project, and a message says so (Visual Studio takes the first project of the solution file).
```
Append to `docs/manual-testing.md`:
```markdown
- [ ] Startup fallback (copy of `/home/hempe/manual-test/2-startup-profiles` without `.vscode`): Select Startup Profile... picks a profile before any Set as Startup Project; deleting the `.slnLaunch` file shows "F5 starts <first startable project>..." and F5 starts it (no "Select a debugger"); the same after choosing Single in Configure Startup Projects
```
No GIF: a message. Only by hand: F5 itself and the Run and Debug dropdown.

- [ ] **Step 6: Commit**

```bash
npm run typecheck
git add src/services/startupProfiles/startProfile.ts src/test/unit/services/startupProfiles/startupProfileLaunch.test.ts docs/run-and-debug.md docs/manual-testing.md
git commit -m "Startup profiles: without a startup project set before the profile, the first startable project takes over when it goes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Roadmap and history; final verification, push and CI

**Files:**
- Modify: `docs/roadmap.md`, `docs/history.md`

- [ ] **Step 1: History**

Append to the end of `docs/history.md`:
```markdown

## Phase 21, Part 5: Limitations we want to fix
**Goal**: Valuable for the team's daily work; fixed before the code review of Phase 22.

- [x] Central packages: a version written as `$(Property)` changes the property's definition (`Directory.Build.props`, `Directory.Packages.props` or a file they import, checked against MSBuild's evaluated version) instead of a literal on the edited package; when other packages follow the property, or it cannot be changed, the NuGet manager asks (Change Property / Set Package Only) and names the packages and projects reached; Consolidate too
- [x] Include In Project writes the item type MSBuild would give the file without the exclude (`Content` for Razor and web files in web projects, `EmbeddedResource` for `.resx`, `Compile` for `.cs`) with the SDK's `CopyToOutputDirectory`/`CopyToPublishDirectory`, so the files are compiled and published (checked with a real publish)
- [x] Dropping a project onto another project's Dependencies (or Projects under it) adds a project reference; itself, an existing reference and a circular one are refused (`dotnet add reference` would write the circle), incompatible frameworks show the SDK's message
- Checked, not reproducible: "Building a single project does not clear stale build errors that an earlier solution build reported for other projects". In VS Code 1.136.1 every `$msCompile` task run clears the build problems of earlier runs, the other projects' included (measured with the extension's own build tasks); comes back with a repro

## Known bugs fixed after Phase 21, Part 4
- [x] Deleting the `.slnLaunch` file (or choosing Single) when no single startup project was set before the profile left `launch.json` without a `Startup` entry: the first project of the solution that can be started becomes the startup project, with a message
- [x] A project without packages, project references and assemblies had no Dependencies node: every project shows it (old-style projects too), and its menu has Add Service Reference...
```

- [ ] **Step 2: Roadmap**

In `docs/roadmap.md`:
- Remove the section "## Phase 21, Part 5: Limitations we want to fix" (heading, the line under it and its four items).
- Under "## Known bugs" remove the two items that start with `- [ ] Startup profiles: deleting the \`.slnLaunch\` file` and `- [ ] A project without packages, project references and assemblies has no Dependencies node`, and add:
```markdown
- [ ] Add Project Reference... runs `dotnet add reference` in a terminal without the checks of the drop onto Dependencies: a circular reference is written (the CLI allows it). Use `addProjectReferences` of `src/services/projectReferences.ts`
```
- In the intro paragraph replace `Phase 21, Part 5 is the limitations we want to fix, phase 22 quality and documentation,` with `Phase 22 is quality and documentation,`.
- Under "## Phase 23: Limitations to look at after the code review" add:
```markdown
- [ ] Dependencies has no Frameworks node (`Microsoft.NETCore.App`, `Microsoft.AspNetCore.App`, as in Visual Studio): needs the `FrameworkReference` items from the evaluation (also the implicit ones) and a node without Remove; an explicit `<FrameworkReference>` in a project file is shown nowhere today
```

Check that nothing else links to the removed section:
```bash
grep -rn "Part 5\|part-5" docs README.md DEVELOPER.md | grep -v "docs/history.md\|docs/superpowers"
```
Expected: no output.

- [ ] **Step 3: Read the changed docs once more**

`docs/solution-explorer.md` got text from Tasks 1, 3 and 4, `docs/nuget.md` from Task 2, `docs/run-and-debug.md` from Task 5, `docs/manual-testing.md` one entry from each of Tasks 1–5: read them in place and check that no sentence says something the tasks did not build. `README.md` stays as it is (a store page; nothing here is a feature of its own).

- [ ] **Step 4: Final verification and push**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git status --short
git add docs/roadmap.md docs/history.md
git commit -m "Phase 21, Part 5 and two startup/tree bugs done: history, roadmap

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push origin master
```
Expected: exit 0 (while planning, all tasks together: 169 suites, 1521 tests); `git status --short` shows nothing of this work (other agents' untracked files may remain).

Then watch CI (Windows is a gate):
```bash
gh run list --branch master --limit 1
gh run watch "$(gh run list --branch master --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status; echo "ci $?"
```
Expected: `ci 0`, both `ubuntu-latest` and `windows-latest` green. If Windows fails, `gh run view --log-failed` and fix before anything else. Windows watch-outs: Task 1's quoted `-property:DefaultItemExcludes="..."` through `execFile` (if `defaultItems.msbuild.test.ts` fails on Windows only with `MSB1006`, the quotes did not reach MSBuild; do not escape `;` as `%3B`, which stays a literal character in item globs); the real-dotnet publish test (Task 1) and `dotnet add reference` test (Task 4) on the Windows runner; `defaultStartupProject` compares paths case-insensitively on win32; `projectReferencesIn` turns `\` and `/` into `path.sep`; the tests build paths with `path.join`/`path.resolve`.

---

## Self-review (done while writing)

- **Roadmap coverage, Part 5:** `$(Prop)` shared by several packages → Task 2 (the definition is edited, found where MSBuild reads it and checked against MSBuild's evaluated version; the question names the other packages and the projects using them, so the NuGet manager's confirmation names what is reached; Set Package Only keeps today's literal as a choice); stale build errors → dropped, not reproducible (evidence above, open question 1, recorded by Task 6); Include In Project item type → Task 1 (MSBuild's own answer with `DefaultItemExcludes` overridden, plus output metadata, checked by a real build and publish); project onto Dependencies → Task 4 (Dependencies and Projects as targets, the existing `dotnet add reference` path of Add Project Reference reused through a helper that adds the checks Visual Studio has).
- **Known bugs:** startup fallback → Task 5 (first startable project, message and log; the `useSingle` path goes through the same branch and is tested); Dependencies node → Task 3 (every project, old-style too; Add Service Reference... in its menu, `npm run generate:menus`; Analyzers already listed; Frameworks → Phase 23 and open question 3).
- **Webview rules:** Task 4 changes `effectAllowed` only; the drop rule reads `type` and `contextValue` of tree nodes (no id decoding); the host builds its own drop nodes from the solution and the project path in the Dependencies id.
- **Overlaps between tasks:** `solutionActionService.ts` (Tasks 1 and 4) changes in different regions (imports: Task 4's import goes after Task 1's); `docs/solution-explorer.md` (Tasks 1, 3, 4) and `docs/manual-testing.md` (Tasks 1–5) by text anchors. Applying all tasks in order in the scratch copy needed no change to any block.
- **Placeholders:** none in code.
- **Type consistency:** `NewItem`/`newItemFor`/`itemsWithoutExcludes` (Task 1) are used by `includeEdit` and `_handleItemMembership`; the `setVersionProperty` edit kind (Task 2) is applied by `applyEdit`, made by `propertyEdit`, and `centralPackagePlan`'s share key handles its `property` field; `ProjectPackages.buildPropsPath` is optional, so existing literals and `toEqual`s stay valid; `DropEffect` `link` (Task 4) is set by `canDrop` and read by `moveNodes`; `StartableProjects` (Task 5) is satisfied by `Solution` (`configurationProjects`, `projects` of `Project` with `isExecutable`/`isTestProject`).
