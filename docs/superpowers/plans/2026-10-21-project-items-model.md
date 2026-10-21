# Project Items Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Solution Explorer tree follows the project's items like Visual Studio: excluded files are hidden, linked files appear, "Show All Files" reveals excluded files greyed out, and Exclude From Project / Include In Project write the matching items.

**Architecture:** `readdir` stays the base listing. A new `ProjectItemsService` runs `dotnet msbuild -getItem:…` per project (cached, deduplicated, invalidated on project/props changes) and `layoutFolder` merges that overlay into the disk listing, giving every node an `itemState`. `Project.loadFolderChildren` uses both; a "Show All Files" toggle (per solution, `workspaceState`) decides whether excluded files show. Exclude/Include are context-menu actions that edit the project file through `ProjectFileEditor` and re-evaluate.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`), VS Code extension API, React webview, Jest (`jsdom`), `dotnet msbuild`.

Spec: `docs/superpowers/specs/2026-10-21-project-items-model-design.md`.

**Deviations from the spec (decided while planning):**
- The queried item types are wider than the four in the spec (`Page`, `Resource`, `ApplicationDefinition`, `AdditionalFiles`, `RazorComponent`, `RazorGenerate`, `Protobuf`, `SplashScreen` too). A file is "excluded" when it is in none of them, so a short list would hide Blazor/WPF files that belong to the project. Task 9 checks this against real projects.
- Empty folders on disk always show (a folder created with "Add Folder..." must not vanish); only folders that have files but none included are hidden.
- Including a folder that has no matching `Remove` item adds one `Include` per file under it (as Visual Studio does).
- Exclude/Include act on the one clicked node (no multi-select variant).

**Conventions to follow (from CLAUDE.md and the memory notes):**
- Tests: `npx jest <path>`; the full suite is `npm test`; `npm run typecheck` before each commit. `noUnusedLocals` breaks the build.
- Extension-host tests mock `vscode` per file: `jest.mock('vscode', () => ({}), { virtual: true });` at the top (see `src/test/unit/services/userSecrets.test.ts`).
- Webview code must not import `vscode`/Node modules or `nodeIdService`.
- After editing `src/core/contextMenus.ts` run `npm run generate:menus` (rewrites `package.json` contributions and `docs/context-menus.md`).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Commit to `master`, push after the last task (the user's workflow: no branches).
- Every task that changes UI has its own docs step; do not leave docs for the end.

---

## File structure

| File | Responsibility |
|---|---|
| `src/parsers/projectFileEditor.ts` (modify) | `excludeItem`, `includeItem`, `removeRemoveItem`: text edits of `Remove`/`Include` items |
| `src/services/projectItems/projectItems.ts` (create) | `ProjectItems` model + `parseMsbuildItems` (pure) |
| `src/services/projectItems/projectItemsService.ts` (create) | runs MSBuild, caches, dedupes, invalidates, notifies (no `vscode` import) |
| `src/services/projectItems/folderLayout.ts` (create) | `layoutFolder`: disk listing + `ProjectItems` + show-all → entries with state (pure) |
| `src/services/projectItems/projectItemEdits.ts` (create) | `excludeEdit` / `includeEdit`: project file text → new text (pure) |
| `src/services/showAllFiles.ts` (create) | per-solution toggle state, context key |
| `src/core/Project.ts` (modify) | uses the above in `loadFolderChildren`, re-evaluates, exposes states |
| `src/core/contextMenus.ts` (modify) | `excludeFromProject`/`includeInProject` commands and `included`/`excluded` menus |
| `src/services/solutionActionService.ts` (modify) | handles the two actions |
| `src/types/index.ts`, `src/types/commands/project-action.ts`, `src/services/solutionTreeService.ts` (modify) | `itemState` on nodes, new actions |
| `src/webview/providers/views/SolutionWebview.ts` (modify) | CSS for `excluded` and `linked` rows |
| `src/webview/solution-view/components/TreeNode/TreeNode.tsx` (modify) | row classes, link overlay |
| `src/extension.ts`, `package.json` (modify) | toggle command, `Directory.Build.*` watcher |
| `src/__fixtures__/project-items/` (create) | fixture project with `Remove`, `DefaultItemExcludes`, `Link` |
| `docs/solution-explorer.md`, `docs/manual-testing.md`, `docs/roadmap.md`, `scripts/screenshots/capture.sh` (modify) | docs, checks, roadmap, GIF scene |

---

### Task 1: Project file edits for `Remove` / `Include` items

**Files:**
- Modify: `src/parsers/projectFileEditor.ts`
- Test: `src/test/unit/parsers/projectFileEditor.items.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

```ts
import { ProjectFileEditor } from '../../../parsers/projectFileEditor';

describe('ProjectFileEditor items', () => {
    const sdkProject = `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>

</Project>
`;

    describe('excludeItem', () => {
        test('adds a new ItemGroup with the Remove item', () => {
            expect(ProjectFileEditor.excludeItem(sdkProject, 'Compile', 'Legacy\\Old.cs')).toBe(`<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <Compile Remove="Legacy\\Old.cs" />
  </ItemGroup>

</Project>
`);
        });

        test('adds after the last Remove item of the same type', () => {
            const once = ProjectFileEditor.excludeItem(sdkProject, 'Compile', 'A.cs');
            expect(ProjectFileEditor.excludeItem(once, 'Compile', 'B.cs')).toBe(`<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <Compile Remove="A.cs" />
    <Compile Remove="B.cs" />
  </ItemGroup>

</Project>
`);
        });

        test('is a no-op when the item is already there', () => {
            const once = ProjectFileEditor.excludeItem(sdkProject, 'None', 'x.txt');
            expect(ProjectFileEditor.excludeItem(once, 'None', 'x.txt')).toBe(once);
        });

        test('escapes the path for XML', () => {
            expect(ProjectFileEditor.excludeItem(sdkProject, 'None', 'a&b.txt')).toContain('Remove="a&amp;b.txt"');
        });
    });

    describe('includeItem', () => {
        test('adds a new ItemGroup with the Include item', () => {
            expect(ProjectFileEditor.includeItem(sdkProject, 'Compile', 'Gen\\Made.cs')).toContain(
                '  <ItemGroup>\n    <Compile Include="Gen\\Made.cs" />\n  </ItemGroup>');
        });

        test('keeps CRLF line endings', () => {
            const crlf = sdkProject.replace(/\n/g, '\r\n');
            const edited = ProjectFileEditor.includeItem(crlf, 'None', 'a.txt');
            expect(edited).toContain('<None Include="a.txt" />');
            expect(edited.replace(/\r\n/g, '')).not.toContain('\n');
        });
    });

    describe('removeRemoveItem', () => {
        test('deletes the item and the ItemGroup it leaves empty', () => {
            const excluded = ProjectFileEditor.excludeItem(sdkProject, 'Compile', 'Legacy\\Old.cs');
            expect(ProjectFileEditor.removeRemoveItem(excluded, 'Legacy\\Old.cs')).toEqual({ content: sdkProject, removed: true });
        });

        test('keeps the other items of the group', () => {
            const two = ProjectFileEditor.excludeItem(ProjectFileEditor.excludeItem(sdkProject, 'Compile', 'A.cs'), 'Compile', 'B.cs');
            const result = ProjectFileEditor.removeRemoveItem(two, 'A.cs');
            expect(result.removed).toBe(true);
            expect(result.content).toContain('<Compile Remove="B.cs" />');
            expect(result.content).not.toContain('A.cs');
        });

        test('takes one entry out of a Remove list', () => {
            const content = '<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup>\n    <Compile Remove="A.cs;B.cs" Condition="true" />\n  </ItemGroup>\n</Project>\n';
            const result = ProjectFileEditor.removeRemoveItem(content, 'A.cs');
            expect(result.content).toContain('<Compile Remove="B.cs" Condition="true" />');
        });

        test('reports nothing removed when there is no such item', () => {
            expect(ProjectFileEditor.removeRemoveItem(sdkProject, 'Nope.cs')).toEqual({ content: sdkProject, removed: false });
        });
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/test/unit/parsers/projectFileEditor.items.test.ts`
Expected: FAIL (`excludeItem is not a function`)

- [ ] **Step 3: Implement** — add inside `class ProjectFileEditor` in `src/parsers/projectFileEditor.ts`, next to `addAssemblyReference` (reuse the existing private helpers `appendItemGroup`, `lineIndent`, `escape`, `unescape`):

```ts
    // Self-closing item element: `<Compile Remove="x" />`; attribute values may contain '>'
    private static readonly ITEM_ELEMENT_RE = /<([A-Za-z]+)\b((?:[^>"']|"[^"]*"|'[^']*')*?)\/>/g;

    /** Self-closing items carrying `attribute`, in document order */
    private static findItemElements(content: string, attribute: 'Include' | 'Remove'): { itemType: string; value: string; start: number; end: number }[] {
        const attributeRe = new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
        const items: { itemType: string; value: string; start: number; end: number }[] = [];
        for (const match of content.matchAll(this.ITEM_ELEMENT_RE)) {
            const found = attributeRe.exec(match[2]);
            if (found) {
                items.push({
                    itemType: match[1],
                    value: this.unescape(found[1] ?? found[2]),
                    start: match.index!,
                    end: match.index! + match[0].length,
                });
            }
        }
        return items;
    }

    /** `<Compile Remove="path" />`: the file leaves the project (Visual Studio's Exclude From Project) */
    static excludeItem(content: string, itemType: string, relativePath: string): string {
        return this.addItemElement(content, itemType, 'Remove', relativePath);
    }

    /** `<Compile Include="path" />`: puts a file the project does not contain into it */
    static includeItem(content: string, itemType: string, relativePath: string): string {
        return this.addItemElement(content, itemType, 'Include', relativePath);
    }

    private static addItemElement(content: string, itemType: string, attribute: 'Include' | 'Remove', value: string): string {
        const sameType = this.findItemElements(content, attribute).filter(item => item.itemType === itemType);
        if (sameType.some(item => item.value === value)) {
            return content;
        }
        const nl = content.includes('\r\n') ? '\r\n' : '\n';
        const element = (indent: string) => [`${indent}<${itemType} ${attribute}="${this.escape(value)}" />`];
        const last = sameType[sameType.length - 1];
        if (last) {
            const indent = this.lineIndent(content, last.start);
            return content.slice(0, last.end) + nl + element(indent).join(nl) + content.slice(last.end);
        }
        return this.appendItemGroup(content, element);
    }

    /** Takes `value` out of the `Remove` items; `removed` tells whether there was one */
    static removeRemoveItem(content: string, value: string): { content: string; removed: boolean } {
        const entries = (itemValue: string) => itemValue.split(';').map(entry => entry.trim()).filter(Boolean);
        const matching = this.findItemElements(content, 'Remove').filter(item => entries(item.value).includes(value));
        let result = content;
        // From the end, so the offsets of the earlier items stay valid
        for (const item of matching.reverse()) {
            const rest = entries(item.value).filter(entry => entry !== value);
            if (rest.length > 0) {
                const text = result.slice(item.start, item.end)
                    .replace(/(\bRemove\s*=\s*)(?:"[^"]*"|'[^']*')/, (_all, prefix: string) => `${prefix}"${this.escape(rest.join(';'))}"`);
                result = result.slice(0, item.start) + text + result.slice(item.end);
            } else {
                result = this.deleteElement(result, item.start, item.end);
            }
        }
        return { content: result, removed: matching.length > 0 };
    }

    /** Deletes the element and, when it was alone on its line, the line; an ItemGroup left empty goes too */
    private static deleteElement(content: string, start: number, end: number): string {
        const lineStart = content.lastIndexOf('\n', start - 1) + 1;
        const lineBreak = content.indexOf('\n', end);
        const lineEnd = lineBreak < 0 ? content.length : lineBreak + 1;
        if (content.slice(lineStart, start).trim() !== '' || content.slice(end, lineBreak < 0 ? content.length : lineBreak).trim() !== '') {
            return content.slice(0, start) + content.slice(end);
        }
        let out = content.slice(0, lineStart) + content.slice(lineEnd);

        const previousStart = out.lastIndexOf('\n', lineStart - 2) + 1;
        const nextBreak = out.indexOf('\n', lineStart);
        const previous = out.slice(previousStart, lineStart);
        const next = out.slice(lineStart, nextBreak < 0 ? out.length : nextBreak);
        if (previous.trim() === '<ItemGroup>' && next.trim() === '</ItemGroup>') {
            out = out.slice(0, previousStart) + out.slice(nextBreak < 0 ? out.length : nextBreak + 1);
            // Two empty lines are left where the group was: keep one
            const blankAt = previousStart;
            const blankBreak = out.indexOf('\n', blankAt);
            const lineBefore = out.slice(out.lastIndexOf('\n', blankAt - 2) + 1, blankAt);
            if (out.slice(blankAt, blankBreak < 0 ? out.length : blankBreak).trim() === '' && lineBefore.trim() === '') {
                out = out.slice(0, blankAt) + out.slice(blankBreak < 0 ? out.length : blankBreak + 1);
            }
        }
        return out;
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/test/unit/parsers/projectFileEditor.items.test.ts`
Expected: PASS. If the empty-group test differs only in blank lines, adjust `deleteElement` until the output equals `sdkProject` exactly (that is the contract), not the test.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck && npx jest src/test/unit/parsers
git add src/parsers/projectFileEditor.ts src/test/unit/parsers/projectFileEditor.items.test.ts
git commit -m "Project items: edits for Remove and Include items

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The `ProjectItems` model and the MSBuild JSON parser

**Files:**
- Create: `src/services/projectItems/projectItems.ts`
- Test: `src/test/unit/services/projectItems/projectItems.test.ts`

`dotnet msbuild -getItem:Compile,None` prints `{"Items":{"Compile":[{"Identity":"Program.cs","FullPath":"/p/Program.cs","Link":"Linked\\x.cs", …}]}}` (every item has `Identity` and the well-known metadata such as `FullPath`; custom metadata like `Link` is present when set).

- [ ] **Step 1: Write the failing tests**

```ts
import * as path from 'path';
import { parseMsbuildItems } from '../../../../services/projectItems/projectItems';

const dir = path.resolve('/work/App');
const at = (...parts: string[]) => path.join(dir, ...parts);

const json = JSON.stringify({
    Items: {
        Compile: [
            { Identity: 'Program.cs', FullPath: at('Program.cs') },
            { Identity: path.join('Sub', 'Util.cs'), FullPath: at('Sub', 'Util.cs') },
            { Identity: '..\\Shared\\Shared.cs', FullPath: path.resolve('/work/Shared/Shared.cs'), Link: 'Linked\\Deep\\Shared.cs' },
        ],
        None: [{ Identity: 'notes.txt', FullPath: at('notes.txt') }],
    },
});

describe('parseMsbuildItems', () => {
    const items = parseMsbuildItems(json, dir)!;

    test('knows what is included and with which item type', () => {
        expect(items.isIncluded(at('Program.cs'))).toBe(true);
        expect(items.itemTypeOf(at('notes.txt'))).toBe('None');
        expect(items.isIncluded(at('Legacy.cs'))).toBe(false);
    });

    test('a folder has included files when one lies under it, a linked file counts at its link path', () => {
        expect(items.hasIncludedUnder(at('Sub'))).toBe(true);
        expect(items.hasIncludedUnder(at('Linked'))).toBe(true);
        expect(items.hasIncludedUnder(at('Linked', 'Deep'))).toBe(true);
        expect(items.hasIncludedUnder(at('Other'))).toBe(false);
    });

    test('lists linked files and folders of a folder', () => {
        expect(items.linkedFilesIn(at('Linked', 'Deep')).map(item => item.fullPath)).toEqual([path.resolve('/work/Shared/Shared.cs')]);
        expect(items.linkedFilesIn(dir)).toEqual([]);
        expect(items.linkedFoldersIn(dir)).toEqual(['Linked']);
        expect(items.linkedFoldersIn(at('Linked'))).toEqual(['Deep']);
    });

    test('item types of everything under a folder', () => {
        expect(items.itemTypesUnder(at('Sub'))).toEqual(['Compile']);
    });

    test('returns undefined for output that is not JSON', () => {
        expect(parseMsbuildItems('MSBuild version 17', dir)).toBeUndefined();
    });

    test('skips text before the JSON (SDK banners)', () => {
        expect(parseMsbuildItems(`warning NU1701\n${json}`, dir)?.isIncluded(at('Program.cs'))).toBe(true);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/test/unit/services/projectItems/projectItems.test.ts` → FAIL (module not found)

- [ ] **Step 3: Implement `src/services/projectItems/projectItems.ts`**

```ts
import * as path from 'path';

/**
 * Item types whose files belong to the project. A file in none of them counts as excluded, so the list
 * is wide: Razor, WPF, gRPC and the like would otherwise disappear from the tree.
 */
export const ITEM_TYPES = [
    'Compile', 'None', 'Content', 'EmbeddedResource', 'Page', 'Resource', 'ApplicationDefinition', 'SplashScreen',
    'AdditionalFiles', 'RazorComponent', 'RazorGenerate', 'Protobuf',
] as const;

export interface LinkedItem {
    /** The file on disk, outside the project folder */
    readonly fullPath: string;
    /** Where the tree shows it, absolute (project folder + `Link`) */
    readonly virtualPath: string;
    readonly itemType: string;
}

interface Entry {
    readonly fullPath: string;
    readonly virtualPath: string;
    readonly itemType: string;
    readonly linked: boolean;
}

/** What MSBuild evaluates a project to contain */
export class ProjectItems {
    private readonly byFullPath = new Map<string, Entry>();

    constructor(readonly projectDir: string, entries: readonly Entry[]) {
        this.entries = entries;
        for (const entry of entries) {
            this.byFullPath.set(path.normalize(entry.fullPath), entry);
        }
    }

    private readonly entries: readonly Entry[];

    isIncluded(fullPath: string): boolean {
        return this.byFullPath.has(path.normalize(fullPath));
    }

    itemTypeOf(fullPath: string): string | undefined {
        return this.byFullPath.get(path.normalize(fullPath))?.itemType;
    }

    /** Whether a file lies under the folder as the tree shows it (linked files at their link path) */
    hasIncludedUnder(folder: string): boolean {
        const prefix = path.normalize(folder) + path.sep;
        return this.entries.some(entry => entry.virtualPath.startsWith(prefix));
    }

    /** The item types of the files under the folder, for excluding all of them */
    itemTypesUnder(folder: string): string[] {
        const prefix = path.normalize(folder) + path.sep;
        return [...new Set(this.entries.filter(entry => entry.fullPath.startsWith(prefix)).map(entry => entry.itemType))];
    }

    /** Linked files shown directly in the folder */
    linkedFilesIn(folder: string): LinkedItem[] {
        const normalized = path.normalize(folder);
        return this.entries
            .filter(entry => entry.linked && path.dirname(entry.virtualPath) === normalized)
            .map(({ fullPath, virtualPath, itemType }) => ({ fullPath, virtualPath, itemType }));
    }

    /** Names of the folders below `folder` that only exist because of links */
    linkedFoldersIn(folder: string): string[] {
        const prefix = path.normalize(folder) + path.sep;
        const names = new Set<string>();
        for (const entry of this.entries) {
            if (entry.linked && entry.virtualPath.startsWith(prefix)) {
                const rest = entry.virtualPath.slice(prefix.length);
                const separator = rest.indexOf(path.sep);
                if (separator > 0) {
                    names.add(rest.slice(0, separator));
                }
            }
        }
        return [...names];
    }
}

interface MsbuildItem { FullPath?: string; Identity?: string; Link?: string }

/** Reads the output of `dotnet msbuild -getItem:...`; undefined when it is not the JSON result */
export function parseMsbuildItems(output: string, projectDir: string): ProjectItems | undefined {
    const start = output.indexOf('{');
    if (start < 0) {
        return undefined;
    }
    let parsed: { Items?: Record<string, MsbuildItem[]> };
    try {
        parsed = JSON.parse(output.slice(start));
    } catch {
        return undefined;
    }
    const entries: Entry[] = [];
    for (const [itemType, items] of Object.entries(parsed.Items ?? {})) {
        for (const item of items) {
            const fullPath = item.FullPath ?? (item.Identity ? path.resolve(projectDir, item.Identity) : undefined);
            if (!fullPath) {
                continue;
            }
            const link = item.Link?.replace(/[\\/]/g, path.sep);
            entries.push({
                fullPath,
                virtualPath: link ? path.resolve(projectDir, link) : fullPath,
                itemType,
                linked: !!link,
            });
        }
    }
    return new ProjectItems(projectDir, entries);
}
```

Declare `private readonly entries` before the constructor if the compiler complains about use-before-assign (move the field above the constructor).

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/test/unit/services/projectItems/projectItems.test.ts` → PASS

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/services/projectItems/projectItems.ts src/test/unit/services/projectItems/projectItems.test.ts
git commit -m "Project items: the model MSBuild's item list is read into

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `ProjectItemsService` (MSBuild, cache, invalidation) and the fixture

**Files:**
- Create: `src/services/projectItems/projectItemsService.ts`
- Create: `src/__fixtures__/project-items/ItemsApp/ItemsApp.csproj`, `Program.cs`, `Legacy/Old.cs`, `Excluded/Skip.cs`, `notes.txt`, `src/__fixtures__/project-items/Shared/Shared.cs`
- Test: `src/test/unit/services/projectItems/projectItemsService.test.ts`

- [ ] **Step 1: Create the fixture**

`src/__fixtures__/project-items/ItemsApp/ItemsApp.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <DefaultItemExcludes>$(DefaultItemExcludes);Excluded\**</DefaultItemExcludes>
  </PropertyGroup>

  <ItemGroup>
    <Compile Remove="Legacy\Old.cs" />
    <Compile Include="..\Shared\Shared.cs" Link="Linked\Shared.cs" />
  </ItemGroup>

</Project>
```
`Program.cs`: `System.Console.WriteLine("hi");` · `Legacy/Old.cs`: `class Old { }` · `Excluded/Skip.cs`: `class Skip { }` · `notes.txt`: `notes` · `../Shared/Shared.cs`: `class Shared { }`.

- [ ] **Step 2: Write the failing tests**

```ts
import { spawnSync } from 'child_process';
import * as path from 'path';
import { ProjectItemsService } from '../../../../services/projectItems/projectItemsService';

const fixture = path.resolve(__dirname, '../../../../__fixtures__/project-items/ItemsApp/ItemsApp.csproj');
const dir = path.dirname(fixture);
const output = (...files: string[]) => JSON.stringify({ Items: { Compile: files.map(file => ({ Identity: file, FullPath: path.join(dir, file) })) } });

describe('ProjectItemsService', () => {
    test('caches the result and runs MSBuild once for concurrent requests', async () => {
        const run = jest.fn().mockResolvedValue(output('A.cs'));
        const service = new ProjectItemsService(run);
        const [first, second] = await Promise.all([service.evaluate(fixture), service.evaluate(fixture)]);
        expect(first).toBe(second);
        expect(service.get(fixture)?.isIncluded(path.join(dir, 'A.cs'))).toBe(true);
        await service.evaluate(fixture);
        expect(run).toHaveBeenCalledTimes(1);
    });

    test('invalidate makes the next evaluation run again', async () => {
        const run = jest.fn().mockResolvedValueOnce(output('A.cs')).mockResolvedValueOnce(output('B.cs'));
        const service = new ProjectItemsService(run);
        await service.evaluate(fixture);
        service.invalidate(fixture);
        expect(service.get(fixture)).toBeUndefined();
        const again = await service.evaluate(fixture);
        expect(again?.isIncluded(path.join(dir, 'B.cs'))).toBe(true);
    });

    test('an evaluation that was running when the project changed does not fill the cache', async () => {
        let finish!: (value: string) => void;
        const run = jest.fn()
            .mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }))
            .mockResolvedValueOnce(output('Fresh.cs'));
        const service = new ProjectItemsService(run);
        const stale = service.evaluate(fixture);
        service.invalidate(fixture);
        const fresh = await service.evaluate(fixture);
        finish(output('Stale.cs'));
        await stale;
        expect(fresh?.isIncluded(path.join(dir, 'Fresh.cs'))).toBe(true);
        expect(service.get(fixture)?.isIncluded(path.join(dir, 'Fresh.cs'))).toBe(true);
    });

    test('a failing MSBuild gives undefined, is not retried until invalidated, and does not throw', async () => {
        const run = jest.fn().mockRejectedValue(new Error('no sdk'));
        const service = new ProjectItemsService(run);
        expect(await service.evaluate(fixture)).toBeUndefined();
        expect(await service.evaluate(fixture)).toBeUndefined();
        expect(run).toHaveBeenCalledTimes(1);
        service.invalidate(fixture);
        await service.evaluate(fixture);
        expect(run).toHaveBeenCalledTimes(2);
    });

    test('tells listeners when a project was evaluated', async () => {
        const service = new ProjectItemsService(jest.fn().mockResolvedValue(output('A.cs')));
        const listener = jest.fn();
        service.onDidEvaluate(listener);
        await service.evaluate(fixture);
        expect(listener).toHaveBeenCalledWith(fixture);
    });

    const hasDotnet = spawnSync('dotnet', ['--version']).status === 0;
    (hasDotnet ? test : test.skip)('real MSBuild: Remove, DefaultItemExcludes and Link are followed', async () => {
        const items = await new ProjectItemsService().evaluate(fixture);
        expect(items).toBeDefined();
        expect(items!.isIncluded(path.join(dir, 'Program.cs'))).toBe(true);
        expect(items!.isIncluded(path.join(dir, 'notes.txt'))).toBe(true);
        expect(items!.isIncluded(path.join(dir, 'Legacy', 'Old.cs'))).toBe(false);
        expect(items!.isIncluded(path.join(dir, 'Excluded', 'Skip.cs'))).toBe(false);
        expect(items!.linkedFilesIn(path.join(dir, 'Linked')).map(item => path.basename(item.fullPath))).toEqual(['Shared.cs']);
    }, 120000);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx jest src/test/unit/services/projectItems/projectItemsService.test.ts` → FAIL (module not found)

- [ ] **Step 4: Implement `src/services/projectItems/projectItemsService.ts`**

```ts
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../core/logger';
import { ITEM_TYPES, ProjectItems, parseMsbuildItems } from './projectItems';

const execFileAsync = promisify(execFile);
const log = logger('ProjectItems');

export type RunMsbuild = (projectPath: string) => Promise<string>;

const runMsbuild: RunMsbuild = async projectPath => {
    const { stdout } = await execFileAsync('dotnet', ['msbuild', projectPath, '-nologo', `-getItem:${ITEM_TYPES.join(',')}`],
        { cwd: path.dirname(projectPath), timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
};

/**
 * What each project contains according to MSBuild (globs, `Remove`, `DefaultItemExcludes`, `Link`, props files).
 * Evaluating starts a process, so results are cached until the project file or a props file changes.
 */
export class ProjectItemsService {
    static readonly instance = new ProjectItemsService();

    // null: MSBuild failed; not retried before `invalidate`
    private readonly cache = new Map<string, ProjectItems | null>();
    private readonly pending = new Map<string, Promise<ProjectItems | undefined>>();
    private readonly generation = new Map<string, number>();
    private readonly listeners = new Set<(projectPath: string) => void>();

    constructor(private readonly run: RunMsbuild = runMsbuild) { }

    /** The cached result, without starting an evaluation */
    get(projectPath: string): ProjectItems | undefined {
        return this.cache.get(projectPath) ?? undefined;
    }

    async evaluate(projectPath: string): Promise<ProjectItems | undefined> {
        if (this.cache.has(projectPath)) {
            return this.cache.get(projectPath) ?? undefined;
        }
        const running = this.pending.get(projectPath);
        if (running) {
            return running;
        }
        const generation = this.generation.get(projectPath) ?? 0;
        const promise = this.evaluateNow(projectPath, generation);
        this.pending.set(projectPath, promise);
        try {
            return await promise;
        } finally {
            if (this.pending.get(projectPath) === promise) {
                this.pending.delete(projectPath);
            }
        }
    }

    private async evaluateNow(projectPath: string, generation: number): Promise<ProjectItems | undefined> {
        let items: ProjectItems | undefined;
        try {
            items = parseMsbuildItems(await this.run(projectPath), path.dirname(projectPath));
            if (!items) {
                log.warn(`MSBuild gave no item list for ${projectPath}`);
            }
        } catch (error) {
            log.warn(`Could not evaluate the items of ${projectPath}:`, error);
        }
        if ((this.generation.get(projectPath) ?? 0) === generation) {
            this.cache.set(projectPath, items ?? null);
            this.listeners.forEach(listener => listener(projectPath));
        }
        return items;
    }

    /** The project changed: forget the result, and ignore an evaluation that is still running */
    invalidate(projectPath: string): void {
        this.generation.set(projectPath, (this.generation.get(projectPath) ?? 0) + 1);
        this.cache.delete(projectPath);
        this.pending.delete(projectPath);
    }

    onDidEvaluate(listener: (projectPath: string) => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
    }
}
```

Check `core/logger.ts` imports no `vscode` unconditionally in tests: the other services under test (`userSecrets`) mock `vscode` virtually; add `jest.mock('vscode', () => ({}), { virtual: true });` as the first line of the test file if the import fails.

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest src/test/unit/services/projectItems/projectItemsService.test.ts` → PASS (the real MSBuild test runs when `dotnet` is installed)

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/services/projectItems src/test/unit/services/projectItems src/__fixtures__/project-items
git commit -m "Project items: evaluate a project's items with MSBuild, cached

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `layoutFolder`, the overlay merge

**Files:**
- Create: `src/services/projectItems/folderLayout.ts`
- Test: `src/test/unit/services/projectItems/folderLayout.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import * as path from 'path';
import { layoutFolder, DiskEntry } from '../../../../services/projectItems/folderLayout';
import { parseMsbuildItems } from '../../../../services/projectItems/projectItems';

const dir = path.resolve('/work/App');
const at = (...parts: string[]) => path.join(dir, ...parts);
const file = (name: string): DiskEntry => ({ name, isDirectory: false });
const folder = (name: string): DiskEntry => ({ name, isDirectory: true });

const items = parseMsbuildItems(JSON.stringify({
    Items: {
        Compile: [
            { Identity: 'Program.cs', FullPath: at('Program.cs') },
            { Identity: 'Sub\\Util.cs', FullPath: at('Sub', 'Util.cs') },
            { Identity: '..\\Shared\\Shared.cs', FullPath: path.resolve('/work/Shared/Shared.cs'), Link: 'Linked\\Shared.cs' },
        ],
    },
}), dir);

const summary = (entries: ReturnType<typeof layoutFolder>) => entries.map(entry => `${entry.name}:${entry.state ?? '-'}`);

describe('layoutFolder', () => {
    const disk = [file('Program.cs'), file('Old.cs'), folder('Sub'), folder('Legacy'), folder('Empty'), folder('bin')];
    const nonEmpty = new Set([at('Sub'), at('Legacy')]);

    test('without an item list the disk listing is shown as is', () => {
        expect(summary(layoutFolder(dir, disk, undefined, false, nonEmpty))).toEqual(
            ['Program.cs:-', 'Old.cs:-', 'Sub:-', 'Legacy:-', 'Empty:-']);
    });

    test('hides excluded files and folders without included files, keeps empty folders, adds linked ones', () => {
        expect(summary(layoutFolder(dir, disk, items, false, nonEmpty))).toEqual(
            ['Program.cs:included', 'Sub:included', 'Empty:included', 'Linked:linked']);
    });

    test('Show All Files lists excluded ones, and bin/obj', () => {
        expect(summary(layoutFolder(dir, disk, items, true, nonEmpty))).toEqual(
            ['Program.cs:included', 'Old.cs:excluded', 'Sub:included', 'Legacy:excluded', 'Empty:included', 'bin:excluded', 'Linked:linked']);
    });

    test('a linked file shows under its link name with the real path', () => {
        const [linked] = layoutFolder(at('Linked'), [], items, false, new Set());
        expect(linked).toEqual({ name: 'Shared.cs', path: path.resolve('/work/Shared/Shared.cs'), isDirectory: false, state: 'linked' });
    });

    test('a folder that exists on disk is not listed twice for its linked files', () => {
        const names = layoutFolder(dir, [folder('Linked')], items, false, new Set([at('Linked')])).map(entry => entry.name);
        expect(names).toEqual(['Linked']);
    });

    test('bin and obj stay hidden without Show All Files even with an item list', () => {
        expect(summary(layoutFolder(dir, [folder('obj')], items, false, new Set([at('obj')])))).toEqual(['Linked:linked']);
    });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx jest src/test/unit/services/projectItems/folderLayout.test.ts` → FAIL

- [ ] **Step 3: Implement `src/services/projectItems/folderLayout.ts`**

```ts
import * as path from 'path';
import { ProjectItems } from './projectItems';

export interface DiskEntry {
    readonly name: string;
    readonly isDirectory: boolean;
}

/** `included` is in the project, `excluded` is on disk only, `linked` is in the project but lives elsewhere */
export type ItemState = 'included' | 'excluded' | 'linked';

export interface LaidOutEntry {
    readonly name: string;
    readonly path: string;
    readonly isDirectory: boolean;
    /** Undefined while MSBuild has not told what the project contains */
    readonly state: ItemState | undefined;
}

/** The folders Show All Files reveals on top of the excluded files; other skipped folders (.git, node_modules...) stay hidden */
export const BUILD_OUTPUT_FOLDERS = ['bin', 'obj'];

/**
 * The entries of a folder: what is on disk, judged by what the project contains, plus linked files.
 * @param nonEmptyFolders disk folders that hold something; an empty folder is shown as included (it carries no exclusion)
 */
export function layoutFolder(
    folderPath: string,
    disk: readonly DiskEntry[],
    items: ProjectItems | undefined,
    showAll: boolean,
    nonEmptyFolders: ReadonlySet<string>,
): LaidOutEntry[] {
    const entries: LaidOutEntry[] = [];
    for (const entry of disk) {
        const entryPath = path.join(folderPath, entry.name);
        const hidden = entry.isDirectory && BUILD_OUTPUT_FOLDERS.includes(entry.name) && !showAll;
        if (hidden) {
            continue;
        }
        if (!items) {
            entries.push({ name: entry.name, path: entryPath, isDirectory: entry.isDirectory, state: undefined });
            continue;
        }
        const included = entry.isDirectory
            ? items.hasIncludedUnder(entryPath) || !nonEmptyFolders.has(entryPath)
            : items.isIncluded(entryPath);
        if (included || showAll) {
            entries.push({ name: entry.name, path: entryPath, isDirectory: entry.isDirectory, state: included ? 'included' : 'excluded' });
        }
    }

    if (items) {
        const onDisk = new Set(disk.filter(entry => entry.isDirectory).map(entry => entry.name));
        for (const name of items.linkedFoldersIn(folderPath)) {
            if (!onDisk.has(name)) {
                entries.push({ name, path: path.join(folderPath, name), isDirectory: true, state: 'linked' });
            }
        }
        for (const linked of items.linkedFilesIn(folderPath)) {
            entries.push({ name: path.basename(linked.virtualPath), path: linked.fullPath, isDirectory: false, state: 'linked' });
        }
    }
    return entries;
}
```

Note the order check in the tests: with `showAll` the disk order is kept and linked entries come last (folders before files, as in the test). `Project` sorts folders-first afterwards (Task 5).

- [ ] **Step 4: Run to verify it passes** — `npx jest src/test/unit/services/projectItems/folderLayout.test.ts` → PASS

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/services/projectItems/folderLayout.ts src/test/unit/services/projectItems/folderLayout.test.ts
git commit -m "Project items: lay a folder out from the disk listing and the item list

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Show All Files state, then the overlay in `Project`

**Files:**
- Create: `src/services/showAllFiles.ts`
- Modify: `src/core/Project.ts`, `src/core/contextMenus.ts` (two constants), `src/types/index.ts`, `src/services/solutionTreeService.ts`
- Test: `src/test/unit/services/showAllFiles.test.ts`, `src/test/unit/core/Project.items.test.ts`

- [ ] **Step 1: Write the failing test for the toggle state**

```ts
jest.mock('vscode', () => ({ commands: { executeCommand: jest.fn() } }), { virtual: true });

import * as vscode from 'vscode';
import { ShowAllFiles } from '../../../services/showAllFiles';

const memento = () => {
    const values = new Map<string, unknown>();
    return { get: <T>(key: string, fallback?: T) => (values.has(key) ? values.get(key) : fallback) as T, update: async (key: string, value: unknown) => { values.set(key, value); }, keys: () => [...values.keys()] };
};

describe('ShowAllFiles', () => {
    beforeEach(() => ShowAllFiles.initialize(memento() as never));

    test('is off by default', () => {
        ShowAllFiles.setSolution('/a.sln');
        expect(ShowAllFiles.isOn()).toBe(false);
    });

    test('toggles, and remembers per solution', async () => {
        ShowAllFiles.setSolution('/a.sln');
        await ShowAllFiles.toggle();
        expect(ShowAllFiles.isOn()).toBe(true);
        ShowAllFiles.setSolution('/b.sln');
        expect(ShowAllFiles.isOn()).toBe(false);
        ShowAllFiles.setSolution('/a.sln');
        expect(ShowAllFiles.isOn()).toBe(true);
    });

    test('keeps the context key in step (the title bar button shows it pressed)', async () => {
        ShowAllFiles.setSolution('/a.sln');
        await ShowAllFiles.toggle();
        expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith('setContext', 'shinobi.solutionExplorer.showAllFiles', true);
    });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx jest src/test/unit/services/showAllFiles.test.ts` → FAIL

- [ ] **Step 3: Implement `src/services/showAllFiles.ts`**

```ts
import * as vscode from 'vscode';

/** Visual Studio's "Show All Files" of the Solution Explorer: remembered per solution, off by default */
export class ShowAllFiles {
    static readonly CONTEXT_KEY = 'shinobi.solutionExplorer.showAllFiles';
    private static readonly STORAGE_KEY = 'showAllFiles';
    private static state: vscode.Memento | undefined;
    private static solutionPath = '';

    static initialize(state: vscode.Memento): void {
        this.state = state;
    }

    /** The solution whose setting applies; also updates the title bar button */
    static setSolution(solutionPath: string): void {
        this.solutionPath = solutionPath;
        void vscode.commands.executeCommand('setContext', this.CONTEXT_KEY, this.isOn());
    }

    static isOn(): boolean {
        return !!this.all()[this.solutionPath];
    }

    static async toggle(): Promise<boolean> {
        const on = !this.isOn();
        await this.state?.update(this.STORAGE_KEY, { ...this.all(), [this.solutionPath]: on });
        await vscode.commands.executeCommand('setContext', this.CONTEXT_KEY, on);
        return on;
    }

    private static all(): Record<string, boolean> {
        return this.state?.get<Record<string, boolean>>(this.STORAGE_KEY, {}) ?? {};
    }
}
```

- [ ] **Step 4: Run to verify it passes** — `npx jest src/test/unit/services/showAllFiles.test.ts` → PASS

- [ ] **Step 5: Constants and node fields**

In `src/core/contextMenus.ts`, next to `UNLOADED_PROJECT`:
```ts
/** `contextValue` of files and folders the project contains (SDK-style projects): they can be excluded */
export const INCLUDED_ITEM = 'included';
/** `contextValue` of files and folders on disk the project does not contain (shown with Show All Files): they can be included */
export const EXCLUDED_ITEM = 'excluded';
```
In `src/types/index.ts` add to **both** `ProjectChild` and `ProjectNode`:
```ts
    /** Files the project does not contain (greyed out) or contains from elsewhere (link overlay); undefined for ordinary items */
    readonly itemState?: 'excluded' | 'linked';
```
In `SolutionTreeService.convertProjectChildrenToProjectNodes` add `itemState: child.itemState,` to the returned object.

- [ ] **Step 6: Write the failing `Project` test**

Create `src/test/unit/core/Project.items.test.ts`. It uses a real temp folder and a stub item list (no MSBuild):

```ts
jest.mock('vscode', () => {
    const watcher = () => ({ onDidCreate: jest.fn(), onDidChange: jest.fn(), onDidDelete: jest.fn(), dispose: jest.fn() });
    return {
        workspace: { createFileSystemWatcher: jest.fn(watcher), workspaceFolders: [], getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
        EventEmitter: class { event = jest.fn(); fire = jest.fn(); dispose = jest.fn(); },
        RelativePattern: class { constructor(public base: string, public pattern: string) { } },
        Uri: { file: (fsPath: string) => ({ fsPath }) },
        commands: { executeCommand: jest.fn() },
    };
}, { virtual: true });

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Project } from '../../../core/Project';
import { parseMsbuildItems } from '../../../services/projectItems/projectItems';
import { ProjectItemsService } from '../../../services/projectItems/projectItemsService';
import { ShowAllFiles } from '../../../services/showAllFiles';

describe('Project file tree with the item overlay', () => {
    let dir: string;
    let projectPath: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'items-'));
        projectPath = path.join(dir, 'App.csproj');
        fs.writeFileSync(projectPath, '<Project Sdk="Microsoft.NET.Sdk"></Project>');
        fs.writeFileSync(path.join(dir, 'Program.cs'), '');
        fs.writeFileSync(path.join(dir, 'Old.cs'), '');
        ProjectItemsService.instance.invalidate(projectPath);
        jest.spyOn(ShowAllFiles, 'isOn').mockReturnValue(false);
    });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); jest.restoreAllMocks(); });

    const withItems = () => jest.spyOn(ProjectItemsService.instance, 'get').mockReturnValue(parseMsbuildItems(JSON.stringify({
        Items: { Compile: [{ Identity: 'Program.cs', FullPath: path.join(dir, 'Program.cs') }, { Identity: 'App.csproj', FullPath: projectPath }] },
    }), dir));
    const newProject = () => new Project(projectPath, { name: 'App', path: 'App.csproj', guid: 'g', typeGuid: 't' } as never);

    test('hides files the project does not contain', async () => {
        withItems();
        const names = (await newProject().loadFolderChildren(dir)).map(node => node.name);
        expect(names).toContain('Program.cs');
        expect(names).not.toContain('Old.cs');
    });

    test('shows them greyed out with Show All Files', async () => {
        withItems();
        (ShowAllFiles.isOn as jest.Mock).mockReturnValue(true);
        const nodes = await newProject().loadFolderChildren(dir);
        expect(nodes.find(node => node.name === 'Old.cs')?.itemState).toBe('excluded');
        expect(nodes.find(node => node.name === 'Program.cs')?.itemState).toBe('included');
    });

    test('shows everything while the item list is not known', async () => {
        const names = (await newProject().loadFolderChildren(dir)).map(node => node.name);
        expect(names).toEqual(expect.arrayContaining(['Program.cs', 'Old.cs']));
    });

    test('offers Exclude on included files and Include on excluded ones, as context values', async () => {
        withItems();
        (ShowAllFiles.isOn as jest.Mock).mockReturnValue(true);
        const project = newProject();
        const children = await project.getFolderChildren(dir);
        expect(children.find(child => child.name === 'Program.cs')?.contextValue).toBe('included');
        expect(children.find(child => child.name === 'Old.cs')?.contextValue).toBe('excluded');
    });
});
```

The `Project` constructor starts `initialize()` (async: parse, watcher, file tree); if `getFolderChildren` needs `_fileTree`, await a tick (`await new Promise(r => setImmediate(r))`) after construction, or call `loadFolderChildren` directly as above (it does not need the tree). Adjust the mocks until `Project` constructs; `ProjectFileParser`/`parseProjectFiles` may need the file to be a valid project — the minimal csproj above is.

- [ ] **Step 7: Run to verify it fails** — `npx jest src/test/unit/core/Project.items.test.ts` → FAIL (no `itemState`)

- [ ] **Step 8: Change `Project`**

1. Imports:
```ts
import { ProjectItemsService } from '../services/projectItems/projectItemsService';
import { layoutFolder, ItemState, BUILD_OUTPUT_FOLDERS } from '../services/projectItems/folderLayout';
import { ShowAllFiles } from '../services/showAllFiles';
import { INCLUDED_ITEM, EXCLUDED_ITEM } from './contextMenus';
```
(`contextMenus.ts` imports no `vscode`; it is safe in the extension host.)

2. `ProjectFileNode` gets `itemState?: ItemState;` and `isVirtual?: boolean` is **not** needed (a virtual folder is just a folder whose path does not exist: `loadFolderChildren` handles `ENOENT`).

3. A field `private _isSdkStyle = false;` set in `parseProjectFile` after `projectXml` is read:
```ts
this._isSdkStyle = /<Project\b[^>]*\bSdk\s*=/.test(projectXml) || /<Sdk\s+Name\s*=/.test(projectXml);
```
(and `false` in its catch block).

4. Replace the top of `loadFolderChildren` (from `const entries = await fs.promises.readdir…` through the `for (const folder of folders…)` loop and the `fileList` construction) with:

```ts
            const showAll = ShowAllFiles.isOn();
            let entries: fs.Dirent[] = [];
            try {
                entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
            } catch (error) {
                // A folder that only exists because of linked files has nothing on disk
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    throw error;
                }
            }

            const disk = entries
                .filter(entry => entry.isFile() || (entry.isDirectory() && (!shouldSkipDirectory(entry.name) || (showAll && BUILD_OUTPUT_FOLDERS.includes(entry.name)))))
                .map(entry => ({ name: entry.name, isDirectory: entry.isDirectory() }));
            const nonEmptyFolders = new Set<string>();
            for (const entry of disk.filter(entry => entry.isDirectory)) {
                const full = path.join(folderPath, entry.name);
                if (await this.checkFolderHasChildren(full)) {
                    nonEmptyFolders.add(full);
                }
            }
            const laidOut = layoutFolder(folderPath, disk, ProjectItemsService.instance.get(this._projectPath), showAll, nonEmptyFolders);

            const children: ProjectFileNode[] = [];
            const folders = laidOut.filter(entry => entry.isDirectory).sort((a, b) => a.name.localeCompare(b.name));
            for (const folder of folders) {
                children.push({
                    name: folder.name,
                    path: folder.path,
                    type: 'folder',
                    children: [], // Will be loaded on demand
                    isLoaded: false,
                    hasChildren: nonEmptyFolders.has(folder.path) || folder.state === 'linked',
                    ...(folder.state === 'excluded' || folder.state === 'linked' ? { itemState: folder.state } : {}),
                    ...(folder.state === 'included' ? { itemState: 'included' as const } : {}),
                });
            }

            // Apply file nesting to files (the nested ones keep their own state through `files`)
            const files = laidOut.filter(entry => !entry.isDirectory);
            const fileStates = new Map(files.map(file => [file.path, file.state]));
            const fileList = files.map(file => ({ name: file.name, path: file.path }));
```
and in `convertNestedFiles`, set the state when creating each node:
```ts
                    const node: ProjectFileNode = {
                        name: nestedFile.name,
                        path: nestedFile.path,
                        type: 'file',
                        ...(fileStates.get(nestedFile.path) ? { itemState: fileStates.get(nestedFile.path) } : {}),
                    };
```
(Keep the rest of the method as it is: `nestedFiles`, `convertNestedFiles`, `children.push(...)`.)

`ProjectFileNode.itemState` keeps all three states (`included` too) so `toProjectChild` can derive the context value; `ProjectChild.itemState` only gets `excluded`/`linked` (below).

5. `toProjectChild`:
```ts
    private toProjectChild(node: ProjectFileNode): ProjectChild {
        const isFolder = node.type === 'folder';
        const itemValue = !this._isSdkStyle ? undefined
            : node.itemState === 'excluded' ? EXCLUDED_ITEM
            : node.itemState === 'included' ? INCLUDED_ITEM : undefined;
        return {
            type: node.type,
            name: node.name,
            hasChildren: node.hasChildren,
            nodeId: isFolder ? NodeIdService.generateFolderId(node.path) : NodeIdService.generateFileId(node.path),
            contextValue: isFolder ? this.folderContextValue(node.path) ?? itemValue : itemValue,
            ...(node.itemState === 'excluded' || node.itemState === 'linked' ? { itemState: node.itemState } : {}),
            // Folders load their children when expanded; nested files are known with their parent
            ...(!isFolder && node.children?.length ? { children: node.children.map(child => this.toProjectChild(child)) } : {}),
        };
    }
```

6. Evaluation and re-evaluation. Add to `Project`:
```ts
    /** Asks MSBuild what the project contains, then shows the tree accordingly (it was drawn from the disk before) */
    async evaluateItems(): Promise<void> {
        const items = await ProjectItemsService.instance.evaluate(this._projectPath);
        if (items) {
            await this.reloadLoadedFolders();
            this._changeEmitter.fire();
        }
    }

    /** The project file or a props file changed, or the items were edited: evaluate again */
    async reevaluateItems(): Promise<void> {
        ProjectItemsService.instance.invalidate(this._projectPath);
        await this.evaluateItems();
    }

    private async reloadLoadedFolders(): Promise<void> {
        const loaded = Array.from(this._collapsedState.entries()).filter(([, isCollapsed]) => !isCollapsed).map(([folderPath]) => folderPath);
        const projectDir = path.dirname(this._projectPath);
        for (const folderPath of [projectDir, ...loaded.filter(folderPath => folderPath !== projectDir)]) {
            const node = this.findNodeById(folderPath);
            if (node) {
                node.children = await this.loadFolderChildren(folderPath);
                node.isLoaded = true;
            }
        }
    }
```
and make `refresh()` use it (replace its expanded-folders loop with `await this.reloadLoadedFolders();`).

Call `void this.evaluateItems();` at the end of `initialize()` (after `initializeFileTree`), and in `handleFileCreated`/`handleFileChanged`, in the branch where the project file itself changed (`await this.parseProjectFile(); this._changeEmitter.fire();`), replace the `fire()` with `await this.reevaluateItems();` followed by the existing `fire()` (the evaluation fires too; a double refresh is harmless, but prefer only `reevaluateItems` plus the fire when it returned no items).

7. A new file in a folder: `handleFileSystemChange` already reloads the parent. A new file not in the cached overlay shows as excluded (hidden) until the glob is evaluated again: in `handleFileCreated`'s `else` branch call `ProjectItemsService.instance.invalidate(this._projectPath)` **before** `handleFileSystemChange`, then `void this.evaluateItems()` after it. (Spec: "a glob miss triggers a re-query"; invalidating on every create is the simple, correct form, MSBuild runs once per burst because of the pending-evaluation sharing.)

8. In `SolutionWebviewProvider` where the active solution is obtained (`_getSolution`-like code near line 335–340 that calls `SolutionService.getActiveSolution()` / `discoverAndInitializeSolution()`), after `solution` is set call `ShowAllFiles.setSolution(solution.solutionPath);`. In `extension.ts` next to `UnloadedProjects.initialize(context.workspaceState);` add `ShowAllFiles.initialize(context.workspaceState);`.

- [ ] **Step 9: Run to verify it passes**

Run: `npx jest src/test/unit/core/Project.items.test.ts src/test/unit/services` → PASS. Then `npm test` for regressions (existing tests may assert `contextValue: undefined` on files or exact `loadFolderChildren` output; update those expectations deliberately, not by loosening).

- [ ] **Step 10: Typecheck, docs note, commit**

No user-visible docs yet (nothing is reachable from the UI until Tasks 6–8; the docs come with Task 6 and 7).

```bash
npm run typecheck
git add -A src
git commit -m "Solution Explorer: the tree follows the project's items

Excluded files are hidden and linked files appear, from what MSBuild
evaluates the project to contain; Show All Files is remembered per solution.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Show All Files button, row styles and docs

**Files:**
- Modify: `package.json`, `src/extension.ts`, `src/webview/providers/SolutionWebviewProvider.ts`, `src/webview/providers/views/SolutionWebview.ts`, `src/webview/solution-view/components/TreeNode/TreeNode.tsx`
- Modify: `docs/solution-explorer.md`, `docs/settings.md` (only if a setting is added; none is)
- Test: `src/test/unit/webview/solution-view/components/TreeNode.test.tsx`

- [ ] **Step 1: Write the failing webview test** — add to `TreeNode.test.tsx` (follow how existing tests there render a node; copy the props helper they use):

```tsx
    it('greys out a file the project does not contain', () => {
        renderNode({ type: 'file', name: 'Old.cs', nodeId: 'f1' as NodeIdString, itemState: 'excluded' });
        expect(screen.getByText('Old.cs').closest('.tree-node')).toHaveClass('excluded');
    });

    it('marks a linked file', () => {
        renderNode({ type: 'file', name: 'Shared.cs', nodeId: 'f2' as NodeIdString, itemState: 'linked' });
        const row = screen.getByText('Shared.cs').closest('.tree-node')!;
        expect(row).toHaveClass('linked');
        expect(row.querySelector('.link-overlay')).not.toBeNull();
    });
```
(`renderNode` stands for whatever helper/inline render the file already uses; reuse it, do not invent a second one.)

- [ ] **Step 2: Run to verify it fails** — `npx jest src/test/unit/webview/solution-view/components/TreeNode.test.tsx` → FAIL

- [ ] **Step 3: Implement the row styling**

In `TreeNode.tsx` extend the row's `className` template (line ~319):
```tsx
className={`tree-node ${node.type} ${isSelected ? 'selected' : ''} ${isFocused ? 'focused' : ''} ${isActiveFile ? 'active' : ''} ${node.isUnloaded ? 'unloaded' : ''} ${node.itemState ?? ''}`}
```
and render the overlay inside the node's icon wrapper: find where the file/folder icon `<Icon …/>` is rendered and wrap or follow it with
```tsx
{node.itemState === 'linked' && <Icon icon="codicon:link" className="link-overlay" width="10" height="10" />}
```
In `SolutionWebview.ts` after the `.tree-node.unloaded` rule:
```css
                        /* Files the project does not contain (Show All Files), as Visual Studio greys them out */
                        .tree-node.excluded {
                            opacity: 0.55;
                        }

                        /* Files the project links from elsewhere: a small link badge at the icon */
                        .tree-node.linked .link-overlay {
                            position: relative;
                            left: -6px;
                            top: 4px;
                            margin-right: -10px;
                        }
```
Tune the offsets only if the badge overlaps the file name when seen (needs the GIF run, Step 8).

- [ ] **Step 4: Run to verify it passes** — `npx jest src/test/unit/webview/solution-view` → PASS

- [ ] **Step 5: The toggle command**

`package.json` → `contributes.commands`, next to `shinobi.solution.collapseAll`:
```json
      {
        "command": "shinobi.solution.showAllFiles",
        "title": "Show All Files",
        "category": ".NET",
        "icon": "$(files)",
        "toggled": {
          "condition": "shinobi.solutionExplorer.showAllFiles",
          "icon": "$(files)",
          "tooltip": "Hide the files the project does not contain"
        }
      },
```
`contributes.menus["view/title"]`, after the `collapseAll` entry:
```json
        {
          "command": "shinobi.solution.showAllFiles",
          "when": "view == shinobi-solution-webview || view == shinobi-solution-webview-secondary-sidebar",
          "group": "navigation@4"
        },
```
(Check the existing `navigation@` numbers of the sibling entries and take the free slot before `collapseAll`'s `@5`.) Also add `shinobi.solution.showAllFiles` to the `commandPalette` section only if sibling title commands are listed there (follow `collapseAll`).

`extension.ts`, beside the `collapseAll` registration:
```ts
        vscode.commands.registerCommand('shinobi.solution.showAllFiles', () => solutionWebviewProvider.toggleShowAllFiles()),
```
`SolutionWebviewProvider`, beside `collapseAll()`:
```ts
    /** Visual Studio's "Show All Files" in the title bar */
    public async toggleShowAllFiles(): Promise<void> {
        await ShowAllFiles.toggle();
        const solution = SolutionService.getActiveSolution();
        await Promise.all([...(solution?.projects.values() ?? [])].map(project => project.refresh()));
        this.refresh();
    }
```
(import `ShowAllFiles` from `../../services/showAllFiles`.) `project.refresh()` reloads the expanded folders, which now honour the new setting.

- [ ] **Step 6: Watch props files**

In `extension.ts`, next to `launchSettingsWatcher`:
```ts
    // Directory.Build.props/targets change what every project below contains
    const buildPropsWatcher = vscode.workspace.createFileSystemWatcher('**/Directory.Build.{props,targets}');
    const handleBuildPropsChange = async (uri: vscode.Uri) => {
        if (isExcluded(uri.fsPath, rootOf(uri.fsPath))) {
            return;
        }
        const solution = SolutionService.getActiveSolution();
        await Promise.all([...(solution?.projects.values() ?? [])].map(project => project.reevaluateItems()));
    };
    buildPropsWatcher.onDidCreate(handleBuildPropsChange);
    buildPropsWatcher.onDidChange(handleBuildPropsChange);
    buildPropsWatcher.onDidDelete(handleBuildPropsChange);
```
and add `buildPropsWatcher` to the same `context.subscriptions.push(...)` the sibling watchers use.

- [ ] **Step 7: Docs**

`docs/solution-explorer.md`: add a section "Show All Files and linked files": the title bar button (like Visual Studio's), off by default, remembered per solution; with it off the tree shows only what the project contains (so `<Compile Remove>`, `DefaultItemExcludes` and the like hide files), with it on excluded files and `bin`/`obj` appear greyed out; linked files (`<Compile Include="..\x.cs" Link="x.cs" />`) appear under their link path with a link badge; the tree is first drawn from the disk and corrected when MSBuild has evaluated the project (a moment on big solutions); needs the .NET SDK. Add the matching setting-free note to the README feature list only if the README lists Solution Explorer features (add one line there).

- [ ] **Step 8: Verify**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
```
Expected: all pass, build exit code 0 (judge by exit code, see CLAUDE.md).

- [ ] **Step 9: Commit**

```bash
git add -A package.json src docs README.md
git commit -m "Solution Explorer: Show All Files, linked files, props files re-evaluate

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Exclude From Project / Include In Project

**Files:**
- Create: `src/services/projectItems/projectItemEdits.ts`
- Modify: `src/core/contextMenus.ts`, `src/types/commands/project-action.ts`, `src/services/solutionActionService.ts`, `package.json` + `docs/context-menus.md` (generated)
- Test: `src/test/unit/services/projectItems/projectItemEdits.test.ts`, `src/test/unit/core/contextMenus.test.ts` (extend)

- [ ] **Step 1: Write the failing tests for the edits**

```ts
import * as path from 'path';
import { excludeEdit, includeEdit } from '../../../../services/projectItems/projectItemEdits';
import { parseMsbuildItems } from '../../../../services/projectItems/projectItems';

const dir = path.resolve('/work/App');
const at = (...parts: string[]) => path.join(dir, ...parts);
const project = '<Project Sdk="Microsoft.NET.Sdk">\n\n</Project>\n';

const items = parseMsbuildItems(JSON.stringify({
    Items: {
        Compile: [{ Identity: 'Sub\\A.cs', FullPath: at('Sub', 'A.cs') }, { Identity: 'Sub\\B.cs', FullPath: at('Sub', 'B.cs') }],
        None: [{ Identity: 'Sub\\n.txt', FullPath: at('Sub', 'n.txt') }],
    },
}), dir)!;

describe('excludeEdit', () => {
    test('a file gets a Remove item of its own item type, with MSBuild separators', () => {
        const edited = excludeEdit(project, dir, at('Sub', 'A.cs'), false, items);
        expect(edited).toContain('<Compile Remove="Sub\\A.cs" />');
    });

    test('a file the item list does not know is removed as None', () => {
        expect(excludeEdit(project, dir, at('x.txt'), false, items)).toContain('<None Remove="x.txt" />');
    });

    test('a folder removes everything under it, per item type', () => {
        const edited = excludeEdit(project, dir, at('Sub'), true, items);
        expect(edited).toContain('<Compile Remove="Sub\\**" />');
        expect(edited).toContain('<None Remove="Sub\\**" />');
    });
});

describe('includeEdit', () => {
    test('undoes an Exclude by deleting its Remove item', () => {
        const excluded = excludeEdit(project, dir, at('Sub', 'A.cs'), false, items);
        expect(includeEdit(excluded, dir, at('Sub', 'A.cs'), false, [at('Sub', 'A.cs')])).toBe(project);
    });

    test('undoes a folder Exclude', () => {
        const excluded = excludeEdit(project, dir, at('Sub'), true, items);
        expect(includeEdit(excluded, dir, at('Sub'), true, [at('Sub', 'A.cs')])).toBe(project);
    });

    test('without a Remove item a file is included by an Include item (C# as Compile, others as None)', () => {
        expect(includeEdit(project, dir, at('Gen', 'Made.cs'), false, [])).toContain('<Compile Include="Gen\\Made.cs" />');
        expect(includeEdit(project, dir, at('readme.md'), false, [])).toContain('<None Include="readme.md" />');
    });

    test('without a Remove item a folder includes each file under it', () => {
        const edited = includeEdit(project, dir, at('Gen'), true, [at('Gen', 'a.cs'), at('Gen', 'deep', 'b.txt')]);
        expect(edited).toContain('<Compile Include="Gen\\a.cs" />');
        expect(edited).toContain('<None Include="Gen\\deep\\b.txt" />');
    });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx jest src/test/unit/services/projectItems/projectItemEdits.test.ts` → FAIL

- [ ] **Step 3: Implement `projectItemEdits.ts`**

```ts
import * as path from 'path';
import { ProjectFileEditor } from '../../parsers/projectFileEditor';
import { ProjectItems } from './projectItems';

/** MSBuild item paths, relative to the project folder, with backslashes like the project templates */
const itemPath = (projectDir: string, target: string) => path.relative(projectDir, target).replace(/\//g, '\\');

const itemTypeForNewItem = (file: string) => path.extname(file).toLowerCase() === '.cs' ? 'Compile' : 'None';

/** Visual Studio's Exclude From Project for an SDK-style project: `Remove` items for the file, or for everything under the folder */
export function excludeEdit(content: string, projectDir: string, target: string, isFolder: boolean, items: ProjectItems): string {
    const relative = itemPath(projectDir, target);
    if (!isFolder) {
        return ProjectFileEditor.excludeItem(content, items.itemTypeOf(target) ?? 'None', relative);
    }
    const types = items.itemTypesUnder(target);
    return (types.length > 0 ? types : ['None']).reduce(
        (edited, type) => ProjectFileEditor.excludeItem(edited, type, `${relative}\\**`), content);
}

/**
 * Include In Project: deletes the `Remove` item that excluded the file or folder; when there is none (the
 * defaults leave it out, `DefaultItemExcludes`) adds `Include` items, one per file for a folder.
 * @param filesUnder the files on disk under the folder (only used for a folder)
 */
export function includeEdit(content: string, projectDir: string, target: string, isFolder: boolean, filesUnder: readonly string[]): string {
    const relative = itemPath(projectDir, target);
    const removed = ProjectFileEditor.removeRemoveItem(content, isFolder ? `${relative}\\**` : relative);
    if (removed.removed) {
        return removed.content;
    }
    const files = isFolder ? filesUnder : [target];
    return files.reduce((edited, file) =>
        ProjectFileEditor.includeItem(edited, itemTypeForNewItem(file), itemPath(projectDir, file)), content);
}
```
A folder excluded by `Remove="Sub\**"` per type leaves one `Remove` item per type; `removeRemoveItem` deletes all of them in one call (it removes every matching element).

- [ ] **Step 4: Run to verify it passes** — `npx jest src/test/unit/services/projectItems/projectItemEdits.test.ts` → PASS

- [ ] **Step 5: Commands and menus**

`src/core/contextMenus.ts` — in `menuCommands`, after `deleteFile`:
```ts
    excludeFromProject: { title: 'Exclude From Project', description: 'Takes the file or folder out of the project (a `Remove` item in the project file) and leaves it on disk. It stays visible with Show All Files, greyed out.' },
    includeInProject: { title: 'Include In Project', description: 'Puts a file or folder the project does not contain back into it: deletes the `Remove` item that excluded it, or adds `Include` items. Shown with Show All Files.' },
```
In `contextMenus`, add (next to `'folder.connectedServices'`; the empty groups keep the item in the slot after Add, before Copy, as Visual Studio has it — put it in the group of `rename`/`deleteFile`, which is index 2 for both file and folder):
```ts
    [`file.${INCLUDED_ITEM}`]: [[], [], ['excludeFromProject']],
    [`folder.${INCLUDED_ITEM}`]: [[], [], ['excludeFromProject']],
    [`file.${EXCLUDED_ITEM}`]: [[], [], ['includeInProject']],
    [`folder.${EXCLUDED_ITEM}`]: [[], [], ['includeInProject']],
```
In `conditionNames`:
```ts
    [`file.${INCLUDED_ITEM}`]: 'On files the project contains (SDK-style projects)',
    [`folder.${INCLUDED_ITEM}`]: 'On folders the project contains (SDK-style projects)',
    [`file.${EXCLUDED_ITEM}`]: 'On files the project does not contain (Show All Files)',
    [`folder.${EXCLUDED_ITEM}`]: 'On folders the project does not contain (Show All Files)',
```
`src/types/commands/project-action.ts` — add, following the style above:
```ts
export declare type ExcludeFromProjectActionCmd = {
    readonly action: 'excludeFromProject';
    readonly nodeId: NodeIdString;
}

export declare type IncludeInProjectActionCmd = {
    readonly action: 'includeInProject';
    readonly nodeId: NodeIdString;
}
```
and add both to the `ProjectActionCmd` union at the bottom of that file.

Add a contextMenus test (extend `src/test/unit/core/contextMenus.test.ts`):
```ts
    it('offers Exclude on included items and Include on excluded ones, never both', () => {
        expect(contextMenus[`file.${INCLUDED_ITEM}`].flat()).toEqual(['excludeFromProject']);
        expect(contextMenus[`file.${EXCLUDED_ITEM}`].flat()).toEqual(['includeInProject']);
        expect(contextMenus.file.flat()).not.toContain('excludeFromProject');
    });
```
(import the two constants.) Then regenerate: `npm run generate:menus`; its output changes `package.json` and `docs/context-menus.md` (commit both).

- [ ] **Step 6: The action handlers**

`solutionActionService.ts`: near `case 'copy':` add
```ts
            case 'excludeFromProject':
            case 'includeInProject':
                await this._handleItemMembership(nodeId, cmd.action === 'excludeFromProject');
                break;
```
and the method (put it next to `_handleCopy`; `fs`, `path`, `SolutionService`, `ProjectFileEditor`-free: it uses the edit functions):
```ts
    /** Exclude From Project / Include In Project: edits the project file, then evaluates the project again */
    private static async _handleItemMembership(nodeId: NodeId, exclude: boolean): Promise<void> {
        const target = nodeId.path;
        const isFolder = nodeId.type === 'folder';
        const project = [...(SolutionService.getActiveSolution()?.projects.values() ?? [])]
            .filter(candidate => target.startsWith(path.dirname(candidate.projectPath) + path.sep))
            .sort((a, b) => b.projectPath.length - a.projectPath.length)[0];
        if (!project) {
            vscode.window.showWarningMessage('The item is not in a project.');
            return;
        }
        try {
            const items = await ProjectItemsService.instance.evaluate(project.projectPath);
            if (exclude && !items) {
                vscode.window.showErrorMessage('Could not read the project items (is the .NET SDK installed?).');
                return;
            }
            const projectDir = path.dirname(project.projectPath);
            const content = await fs.promises.readFile(project.projectPath, 'utf8');
            const edited = exclude
                ? excludeEdit(content, projectDir, target, isFolder, items!)
                : includeEdit(content, projectDir, target, isFolder, isFolder ? await listFilesUnder(target) : []);
            if (edited !== content) {
                await fs.promises.writeFile(project.projectPath, edited, 'utf8');
            }
            await project.reevaluateItems();
        } catch (error) {
            log.error(`${exclude ? 'Exclude' : 'Include'} failed for ${target}:`, error);
            vscode.window.showErrorMessage(`Could not ${exclude ? 'exclude' : 'include'} ${path.basename(target)}: ${error instanceof Error ? error.message : error}`);
        }
    }
```
with `listFilesUnder` added to `projectItemEdits.ts` (it needs `fs`, so keep the pure functions above untouched and export this one separately):
```ts
/** Every file under a folder, skipping bin and obj */
export async function listFilesUnder(folder: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await fs.promises.readdir(folder, { withFileTypes: true })) {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) {
            if (!BUILD_OUTPUT_FOLDERS.includes(entry.name)) {
                files.push(...await listFilesUnder(full));
            }
        } else {
            files.push(full);
        }
    }
    return files;
}
```
(imports `fs` and `BUILD_OUTPUT_FOLDERS` from `./folderLayout` in that file.) Use the names this file already uses for `fs`, `path`, `log` and the node-id type in `solutionActionService.ts`; the `nodeId` parameter there is the parsed `NodeId` (`nodeId.path`, as in `DebugConfigService.startProject(nodeId.path, …)` above).

After the edit the tree refreshes through `reevaluateItems()` (it reloads the loaded folders and fires the project's change event).

- [ ] **Step 7: Verify**

```bash
npm run generate:menus && npm run typecheck && npm test && npm run build:dev; echo "exit $?"
```
Expected: pass; `git diff --stat` shows `package.json` and `docs/context-menus.md` changed by the generator only.

- [ ] **Step 8: Docs**

`docs/solution-explorer.md`: extend the section from Task 6: Exclude From Project (what it writes: `<Compile Remove="…" />`, folders `Remove="Dir\**"`), Include In Project (appears with Show All Files; deletes the `Remove` item, otherwise adds `Include` items), SDK-style projects only. `docs/keyboard-shortcuts.md` needs nothing (no key binding).

- [ ] **Step 9: Commit**

```bash
git add -A package.json src docs
git commit -m "Solution Explorer: Exclude From Project and Include In Project

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Is the item list complete? Check against real projects

(Run this task as soon as Task 5 works if you can: a missing item type there hides real files, so finding it early is cheaper.)

The wide `ITEM_TYPES` list is a guess about which files belong to a project; a miss hides real files for users. This task checks it.

**Files:** none unless the check finds a gap (then `src/services/projectItems/projectItems.ts`).

- [ ] **Step 1: Check each reference project**

For `BasicsTestProject`, `ApiDotNetTestProject` (see the memory note `reference-test-solutions`), plus throwaway projects made with `dotnet new blazor`, `dotnet new wpf` (skip if the template is missing), `dotnet new mvc`, `dotnet new worker`, run in the project folder:

```bash
dotnet msbuild <Project>.csproj -nologo -getItem:Compile,None,Content,EmbeddedResource,Page,Resource,ApplicationDefinition,SplashScreen,AdditionalFiles,RazorComponent,RazorGenerate,Protobuf > /tmp/items.json
```
and compare against the files on disk (outside `bin`, `obj`, dot-folders):
```bash
node -e '
const fs=require("fs"),path=require("path");
const items=JSON.parse(fs.readFileSync("/tmp/items.json","utf8").slice(fs.readFileSync("/tmp/items.json","utf8").indexOf("{"))).Items;
const inc=new Set(Object.values(items).flat().map(i=>path.normalize(i.FullPath)));
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.name.startsWith(".")||["bin","obj"].includes(e.name)?[]:e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
for(const f of walk(".")) if(!inc.has(path.resolve(f))) console.log("NOT IN ANY ITEM:",f);
'
```
Expected: only files that Visual Studio also hides (`*.csproj`, `*.csproj.user`, `*.user`, `*.sln`) are listed. Any other file listed means a missing item type: find its type with `dotnet msbuild -getItem:<Type>` guesses or `-pp:` and add the type to `ITEM_TYPES`.

- [ ] **Step 2: Fix and test**

For each gap add the type to `ITEM_TYPES` and a line to the `parseMsbuildItems` test showing it counts. Run `npx jest src/test/unit/services/projectItems`.

- [ ] **Step 3: Commit (only if something changed)**

```bash
git add -A src
git commit -m "Project items: more item types count as part of a project

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: GIF scene, manual checks, roadmap, push

**Files:**
- Modify: `scripts/screenshots/capture.sh` (and `scripts/screenshots/sample/` as needed), `docs/images/` (GIF), `docs/solution-explorer.md`, `docs/manual-testing.md`, `docs/roadmap.md`, `docs/history.md` (no: phases move there when all of Phase 19 is done)

- [ ] **Step 1: A GIF scene**

Read the `gif-sync-namespaces` and `gif-code-cleanup` scenes in `scripts/screenshots/capture.sh` and the sample solution under `scripts/screenshots/sample/` as the template. Add a scene `gif-show-all-files` (add it to the default `SCENES` list): in the sample project add a `<Compile Remove="Legacy\Old.cs" />` file pair, then record: tree without the file → click the Show All Files button → `Old.cs` appears greyed → right-click → Include In Project → it is normal → Exclude From Project → gone again (button back off). Save as `docs/images/show-all-files.gif`, embed in `docs/solution-explorer.md` in the new section. The scene needs X11 and ffmpeg: run `SCENES=gif-show-all-files scripts/screenshots/capture.sh`; if the environment cannot record, say so plainly in the final report so the user can record it, and leave the scene committed.

The scene edits the sample project; like the other scenes put the work copy back afterwards (see how `gif-startup-projects` restores the solution file).

- [ ] **Step 2: Manual checks**

Append unticked entries to `docs/manual-testing.md` (follow its existing format), e.g.:
- Show All Files button toggles, is remembered after reloading the window, and is separate per solution.
- A `<Compile Remove>` file is hidden; with Show All Files it is greyed; Include In Project makes it normal and removes the `Remove` item from the `.csproj` (formatting kept).
- A linked file (`Link="Linked\x.cs"`) appears in a `Linked` folder with the link badge and opens the real file.
- Exclude From Project on a folder writes `Remove="Dir\**"` for each item type; Include brings it back.
- A new file created in a folder shows up; one created in an excluded folder does not (until Show All Files).
- Editing `Directory.Build.props` (e.g. adding `DefaultItemExcludes`) updates the tree.
- A Blazor project's `.razor` files and a WPF project's XAML files stay visible.
- With the .NET SDK missing from `PATH` the tree still shows every file on disk.

- [ ] **Step 3: Roadmap and README**

`docs/roadmap.md` Phase 19: tick the two items (`The tree follows the project's items…`, `Exclude From Project / Include In Project…`); add under "Known limitations": `- [ ] Exclude From Project and Include In Project work on SDK-style projects only; a linked file has no Exclude, and Delete on it deletes the real file`. Make sure `README.md` (the store page) mentions Show All Files / Exclude From Project in its Solution Explorer feature list, with the GIF if the README uses GIFs per feature; keep it a store page.

- [ ] **Step 4: Final verification and push**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git status --short
git add -A docs scripts README.md
git commit -m "Phase 19: docs, GIF and manual checks for the project items model

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push origin master
```
Expected: exit 0 and a clean tree (apart from the older untracked plan files). After the push check that the GitHub pipeline is green (Windows included): `gh run list --limit 1`, then `gh run watch` if it is still running. Windows-specific watch-outs: paths in tests use `path.join`/`path.resolve` (done above); `Link` values with `\` are normalised in `parseMsbuildItems`.

---

## Self-review (done while writing)

- **Spec coverage:** item overlay and `ProjectItemsService` (Tasks 2–3, 5), tree states and Show All Files off by default with toolbar toggle remembered per solution (Tasks 4–6), linked files under their link path with badge (Tasks 2, 4, 6), Exclude/Include semantics incl. `Remove` deletion, per-file `Include`, folder `\**` (Tasks 1, 7), SDK-style only (contextValue only set when `_isSdkStyle`, Task 5), freshness: project file / props / new files / own edits re-query (Tasks 5–7), MSBuild failure keeps the disk listing (Tasks 3, 5), tests and fixtures (every task), docs, GIF, manual checks, roadmap (Tasks 6, 7, 9).
- **Placeholders:** none; the places that say "use the names the file already uses" (`solutionActionService.ts` imports, the `TreeNode.test.tsx` render helper, the `navigation@` slot) point at code that exists and could not be quoted exactly without reading it at implementation time.
- **Type consistency:** `ItemState` (`included | excluded | linked`) is used by `folderLayout`, `ProjectFileNode.itemState`; `ProjectChild`/`ProjectNode.itemState` is the narrower `'excluded' | 'linked'`; `ProjectItems` methods used later (`isIncluded`, `itemTypeOf`, `hasIncludedUnder`, `itemTypesUnder`, `linkedFilesIn`, `linkedFoldersIn`) are all defined in Task 2; `Project.evaluateItems/reevaluateItems/reloadLoadedFolders` defined in Task 5 and used in Tasks 6–7; `INCLUDED_ITEM`/`EXCLUDED_ITEM` defined in Task 5 and used in Task 7.
