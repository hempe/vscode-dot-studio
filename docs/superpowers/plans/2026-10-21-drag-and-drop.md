# Drag & Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nodes move in the Solution Explorer by dragging, as in Visual Studio: files and folders into other folders and projects (Ctrl/Cmd copies), projects and solution folders into solution folders or to the root, solution items between solution folders. Moved C# files get one namespace question per drop, and Cut/Paste asks the same way.

**Architecture:** A pure `src/core/dropRules.ts` (node types and parent chains of opaque ids, no `vscode`/Node imports) decides what may go where. The webview builds the rule nodes from its tree (`dropNodeIndex`) for the drop highlight and sends `moveNodes`. The extension builds the rule nodes again from the solution model (`services/solutionDropNodes.ts`), runs the same rules, then moves files and folders through the paste path (`_pasteOne`) and solution nodes through the new `Solution.moveToSolutionFolder`: line edits in `Solution.ts` for `.sln`, `SolutionXFileEditor` text edits for `.slnx`. The namespace question after a move becomes one shared step (`services/namespaceAfterMove.ts`) used by drops, Cut/Paste and folder renames.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`/`noUnusedParameters`), VS Code extension API, React webview (HTML5 drag events), Jest (`jsdom`, `@testing-library/react`).

Spec: `docs/superpowers/specs/2026-10-21-drag-and-drop-design.md`.

**Deviations from the spec (decided while planning):**
- `canDrop(dragged, target, copyKey)` takes the Ctrl/Cmd state too and returns `{ nodes, container, effect }`: the dragged nodes that fit, where they go (the target, or for a file target the folder or project it is in) and `move`/`copy`. The webview and the extension both need all three.
- A dragged node lying under another dragged node is left out (it goes along with that one). Without this, a folder and a file in it dragged together would fail on the file ("Source item no longer exists").
- `Solution.moveToSolutionFolder(node: SolutionNodeMove, targetFolderGuid)` takes a tagged object instead of `(kind, id, …)`: a solution item needs its file and the folder it is in.
- The extension does not decode the webview's parent chain; it makes the rule nodes itself from paths, solution folders and `NestedProjects` (`solutionDropNode`), with ids it generates for every node alike (the rules only compare ids).
- Files excluded from their project (greyed out by Show All Files) can be dragged: they are on disk. Linked files and linked folders can neither be dragged nor be targets (their tree path is not where the file is).
- A copy dropped onto the folder the file is already in does nothing (spec: "a node dropped where it already is does nothing"; Visual Studio would make "X - Copy.cs").
- `.sln`: a `NestedProjects` section or a `ProjectSection(SolutionItems)` left empty is removed, as Visual Studio writes none. `.slnx`: moved `<Folder>` elements keep their place in the file (not re-sorted); a moved solution folder without an `Id` gets a new derived GUID, so its expansion state is lost after the move.
- Files without a namespace (global) are not counted in the namespace question: there is nothing to rename. Today they are counted and then silently skipped.

**Conventions to follow (from CLAUDE.md and the memory notes):**
- Tests: `npx jest <path>`; the full suite is `npm test`; `npm run typecheck` before each commit. `noUnusedLocals`/`noUnusedParameters` break the build, also for private members left unused after a refactor.
- `npm run build:dev` builds two configurations: judge it by its exit code (`; echo "exit $?"`), not by its output.
- Extension-host tests mock `vscode` per file with `jest.mock('vscode', () => ({ … }), { virtual: true })` (copy the shape from `src/test/unit/core/Solution.solutionFolders.test.ts`); tests with a real `Solution` in a temp folder also mock `core/constants`' `isSystemPath` and stub `ProjectItemsService.instance.evaluate` (same file).
- Windows is a CI gate: build every path in tests with `path.join`/`path.resolve`, never with `/` literals (solution-file contents are text and stay as they are).
- Webview code must not import `vscode`, Node modules or `nodeIdService`, and must not decode ids (`src/test/unit/webview/shared/opaqueNodeIds.test.ts`); `dropRules.ts` uses `import type` only (like `core/contextMenus.ts`) and `src/test/unit/build/webviewBundle.test.ts` builds the bundle.
- A drop adds no menu entry: do not run `npm run generate:menus` (no change to `src/core/contextMenus.ts`).
- Another agent works on project item types (`src/services/projectItems/*`, `src/core/Project.ts`, the `show-all-files` GIF). Do not edit their files; where this plan touches shared files (`solutionActionService.ts`, `TreeNode.tsx`, `SolutionWebview.ts`, `capture.sh`, the docs), change only the lines named here and keep their changes.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Commit to `master`, push after the last task (the user's workflow: no branches). `git add` only the files of the task.
- Every task that changes UI has its own docs step (docs page, GIF, manual-testing entries in the same task).

---

## File structure

| File | Responsibility |
|---|---|
| `src/core/dropRules.ts` (create) | `DropNode`, `isDraggable`, `canDrop`, `dropNodeIndex` (pure, shared by webview and extension) |
| `src/services/namespaceAfterMove.ts` (create) | `namespaceChangesAfterMove`, `offerNamespaceUpdates`, `updateNamespacesAfterMove`: one question per move |
| `src/services/solutionActionService.ts` (modify) | `_pasteOne` returns where it put the item, Paste/rename use the shared namespace step, `moveNodes` |
| `src/core/Solution.ts` (modify) | `SolutionNodeMove`, `moveToSolutionFolder`, `.sln` line helpers |
| `src/parsers/solutionXFileEditor.ts` (modify) | `moveProject`, `moveFolder`, `moveFile` and their helpers |
| `src/services/solutionDropNodes.ts` (create) | `solutionDropNode`: rule nodes built from the solution model |
| `src/types/commands/backend.ts` (modify) | `MoveNodesCmd` |
| `src/webview/providers/SolutionWebviewProvider.ts` (modify) | routes `moveNodes`, refreshes the tree |
| `src/webview/solution-view/components/SolutionTree.tsx`, `TreeNode/TreeNode.tsx`, `src/webview/solution-view/types/index.ts` (modify) | draggable rows, highlight, Ctrl copy, auto-expand, drop message |
| `src/webview/providers/views/SolutionWebview.ts` (modify) | `.tree-node.drop-target` style |
| `src/__fixtures__/solution-hierarchy/TestHierarchy.sln` (modify), `TestHierarchy.slnx`, `README.md` (create) | nested solution folders, a solution item, a duplicate folder name |
| `docs/solution-explorer.md`, `docs/templates.md`, `docs/manual-testing.md`, `scripts/screenshots/capture.sh`, `docs/images/drag-and-drop.gif`, `README.md`, `docs/roadmap.md`, `docs/history.md` (modify/create) | docs, checks, GIF scene, roadmap |

Tests (all create): `src/test/unit/core/dropRules.test.ts`, `src/test/unit/services/namespaceAfterMove.test.ts`, `src/test/unit/core/Solution.moveToSolutionFolder.test.ts`, `src/test/unit/services/moveNodes.test.ts`, `src/test/unit/webview/solution-view/components/SolutionTreeDragDrop.test.tsx`; `src/test/unit/parsers/solutionXFileEditor.test.ts` (modify).

---

### Task 1: The drop rules

**Files:**
- Create: `src/core/dropRules.ts`
- Test: `src/test/unit/core/dropRules.test.ts`

The webview's ids are opaque, so the rules work on node types and on the chain of ancestor ids the tree already has. The test uses names as ids.

- [ ] **Step 1: Write the failing tests**

```ts
import { canDrop, dropNodeIndex, DropNode, isDraggable } from '../../../core/dropRules';
import { ProjectNode } from '../../../types';
import { NodeIdString } from '../../../types/nodeId';

const node = (type: ProjectNode['type'], name: string, children?: ProjectNode[], extra: Partial<ProjectNode> = {}): ProjectNode =>
    ({ type, name, nodeId: name as NodeIdString, children, ...extra });

const tree: ProjectNode[] = [node('solution', 'App', [
    node('solutionFolder', 'Libs', [
        node('solutionFolder', 'Inner'),
        node('project', 'Lib', [
            node('folder', 'Models', [
                node('file', 'Order.cs', [node('file', 'Order.Designer.cs')]),
            ]),
            node('file', 'A.cs'),
            node('file', 'Linked.cs', undefined, { itemState: 'linked' }),
            node('file', 'Old.cs', undefined, { itemState: 'excluded' }),
        ]),
        node('solutionItem', 'README.md'),
    ]),
    node('solutionFolder', 'Tools'),
    node('project', 'Api', [
        node('dependencies', 'Dependencies', [node('dependencyCategory', 'Packages', [node('dependency', 'Serilog')])]),
        node('folder', 'Controllers', [node('file', 'C.cs')]),
        node('generatedFile', 'Gen.g.cs'),
    ]),
    node('project', 'Unloaded', undefined, { isUnloaded: true }),
])];

const index = dropNodeIndex(tree);
const n = (name: string): DropNode => index.get(name as NodeIdString)!;
const drop = (dragged: string[], target: string, copyKey = false) => {
    const verdict = canDrop(dragged.map(n), n(target), copyKey);
    return { nodes: verdict.nodes.map(x => x.nodeId), into: verdict.container?.nodeId, effect: verdict.effect };
};

describe('dropRules', () => {
    test('the index lists every node with its ancestors, nearest first', () => {
        expect(n('Order.Designer.cs').ancestors.map(a => a.nodeId)).toEqual(['Order.cs', 'Models', 'Lib', 'Libs', 'App']);
        expect(n('App').ancestors).toEqual([]);
    });

    describe('the table of the spec', () => {
        test('files and folders go into folders and projects, onto a file means its folder; Ctrl copies', () => {
            expect(drop(['A.cs'], 'Controllers')).toEqual({ nodes: ['A.cs'], into: 'Controllers', effect: 'move' });
            expect(drop(['A.cs'], 'Api')).toEqual({ nodes: ['A.cs'], into: 'Api', effect: 'move' });
            expect(drop(['A.cs'], 'C.cs')).toEqual({ nodes: ['A.cs'], into: 'Controllers', effect: 'move' });
            expect(drop(['Models'], 'Controllers', true)).toEqual({ nodes: ['Models'], into: 'Controllers', effect: 'copy' });
            expect(drop(['Old.cs'], 'Api').nodes).toEqual(['Old.cs']);
        });

        test('projects go into solution folders and the solution root; Ctrl still moves', () => {
            expect(drop(['Api'], 'Tools', true)).toEqual({ nodes: ['Api'], into: 'Tools', effect: 'move' });
            expect(drop(['Lib'], 'App')).toEqual({ nodes: ['Lib'], into: 'App', effect: 'move' });
            expect(drop(['Api'], 'Controllers').nodes).toEqual([]);
            expect(drop(['Api'], 'Lib').nodes).toEqual([]);
        });

        test('solution folders go into solution folders and the root, not into themselves or their descendants', () => {
            expect(drop(['Inner'], 'Tools').nodes).toEqual(['Inner']);
            expect(drop(['Inner'], 'App').nodes).toEqual(['Inner']);
            expect(drop(['Libs'], 'Libs').nodes).toEqual([]);
            expect(drop(['Libs'], 'Inner').nodes).toEqual([]);
        });

        test('solution items go into solution folders only', () => {
            expect(drop(['README.md'], 'Tools')).toEqual({ nodes: ['README.md'], into: 'Tools', effect: 'move' });
            expect(drop(['README.md'], 'App').nodes).toEqual([]);
            expect(drop(['README.md'], 'Api').nodes).toEqual([]);
        });

        test('everything else is not a target', () => {
            for (const target of ['Dependencies', 'Packages', 'Serilog', 'Gen.g.cs', 'Inner', 'README.md', 'Linked.cs', 'Unloaded']) {
                expect(drop(['A.cs'], target).nodes).toEqual([]);
            }
        });
    });

    test('nodes without a move are not draggable', () => {
        for (const name of ['App', 'Dependencies', 'Packages', 'Serilog', 'Gen.g.cs', 'Linked.cs', 'Unloaded']) {
            expect(isDraggable(n(name))).toBe(false);
        }
        expect(isDraggable({ type: 'file', isTemporary: true })).toBe(false);
        for (const name of ['A.cs', 'Models', 'Lib', 'Libs', 'README.md', 'Old.cs']) {
            expect(isDraggable(n(name))).toBe(true);
        }
    });

    test('of several dragged nodes only those that fit go; if none fit there is no drop', () => {
        expect(drop(['A.cs', 'Api'], 'Tools').nodes).toEqual(['Api']);
        expect(drop(['A.cs', 'Api'], 'Controllers').nodes).toEqual(['A.cs']);
        expect(drop(['Dependencies', 'Gen.g.cs'], 'Controllers')).toEqual({ nodes: [], into: undefined, effect: 'move' });
    });

    test('Ctrl copies only when what goes is files and folders', () => {
        expect(drop(['A.cs', 'Api'], 'Controllers', true).effect).toBe('copy');
        expect(drop(['A.cs', 'Api'], 'Tools', true).effect).toBe('move');
    });

    test('a node under another dragged node goes along with it', () => {
        expect(drop(['Models', 'Order.cs'], 'Controllers').nodes).toEqual(['Models']);
    });

    test('a folder cannot go onto itself or anything inside it', () => {
        expect(drop(['Models'], 'Models').nodes).toEqual([]);
        expect(drop(['Models'], 'Order.Designer.cs').nodes).toEqual([]);
    });

    test('a node dropped where it already is does nothing', () => {
        expect(drop(['A.cs'], 'Lib').nodes).toEqual([]);
        expect(drop(['A.cs'], 'Old.cs').nodes).toEqual([]);
        expect(drop(['Order.Designer.cs'], 'Order.cs').nodes).toEqual([]);
        expect(drop(['Lib'], 'Libs').nodes).toEqual([]);
        expect(drop(['README.md'], 'Libs').nodes).toEqual([]);
        expect(drop(['Libs'], 'App').nodes).toEqual([]);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/test/unit/core/dropRules.test.ts`
Expected: FAIL (`Cannot find module '../../../core/dropRules'`)

- [ ] **Step 3: Implement `src/core/dropRules.ts`**

```ts
/**
 * What may be dropped where in the Solution Explorer, like Visual Studio. Pure and browser-safe (type imports only):
 * the webview uses it for the drop highlight, the extension host checks every drop again with nodes it makes from the
 * solution itself. Nodes are compared by id only; ids are opaque here.
 */
import type { NodeType, ProjectNode } from '../types';
import type { NodeIdString } from '../types/nodeId';

export interface DropAncestor {
    readonly nodeId: NodeIdString;
    readonly type: NodeType;
}

export interface DropNode extends DropAncestor {
    /** The nodes above it, nearest first, up to the solution node */
    readonly ancestors: readonly DropAncestor[];
    readonly isUnloaded?: boolean;
    readonly isTemporary?: boolean;
    readonly itemState?: 'excluded' | 'linked';
}

export type DropEffect = 'move' | 'copy';

export interface DropVerdict {
    /** The dragged nodes that go to the target, in drag order; none: the drop is not allowed */
    readonly nodes: readonly DropNode[];
    /** Where they go: the target, or for a file target the folder or project it is in */
    readonly container?: DropAncestor;
    /** `copy` only for files and folders with Ctrl (Cmd on macOS) held */
    readonly effect: DropEffect;
}

const FILE_LIKE: readonly NodeType[] = ['file', 'folder'];
const SOLUTION_LEVEL: readonly NodeType[] = ['project', 'solutionFolder', 'solutionItem'];
const isContainer = (node: DropAncestor) => node.type === 'folder' || node.type === 'project';

/**
 * Files, folders, projects, solution folders and solution items have a move; not linked files, unloaded projects,
 * nodes being created, nor Dependencies, packages, analyzers, generated files and the solution
 */
export function isDraggable(node: Pick<DropNode, 'type' | 'isUnloaded' | 'isTemporary' | 'itemState'>): boolean {
    if (node.isTemporary || node.itemState === 'linked') {
        return false;
    }
    if (node.type === 'project') {
        return !node.isUnloaded;
    }
    return FILE_LIKE.includes(node.type) || SOLUTION_LEVEL.includes(node.type);
}

/** Where a node is now: for files and folders the folder or project they are in, otherwise their parent */
function currentContainer(node: DropNode): DropAncestor | undefined {
    return FILE_LIKE.includes(node.type) ? node.ancestors.find(isContainer) : node.ancestors[0];
}

/** Where `node` would go when dropped on `target`; undefined: not there */
function containerFor(node: DropNode, target: DropNode): DropAncestor | undefined {
    switch (node.type) {
        case 'file':
        case 'folder':
            if (target.isTemporary || target.isUnloaded || target.itemState === 'linked') {
                return undefined;
            }
            if (isContainer(target)) {
                return target;
            }
            return target.type === 'file' ? target.ancestors.find(isContainer) : undefined;
        case 'project':
        case 'solutionFolder':
            return target.type === 'solution' || target.type === 'solutionFolder' ? target : undefined;
        case 'solutionItem':
            return target.type === 'solutionFolder' ? target : undefined;
        default:
            return undefined;
    }
}

export function canDrop(dragged: readonly DropNode[], target: DropNode, copyKey = false): DropVerdict {
    const draggedIds = new Set(dragged.map(node => node.nodeId));
    // The target and everything above it: a node dropped there would land inside itself
    const targetChain = new Set([target.nodeId, ...target.ancestors.map(ancestor => ancestor.nodeId)]);
    let container: DropAncestor | undefined;
    const nodes = dragged.filter(node => {
        if (!isDraggable(node) || targetChain.has(node.nodeId)) {
            return false;
        }
        // It goes along with a dragged node above it
        if (node.ancestors.some(ancestor => draggedIds.has(ancestor.nodeId))) {
            return false;
        }
        const into = containerFor(node, target);
        if (!into || into.nodeId === currentContainer(node)?.nodeId) {
            return false;
        }
        container = into;
        return true;
    });
    const copy = copyKey && nodes.length > 0 && nodes.every(node => FILE_LIKE.includes(node.type));
    return { nodes, container: nodes.length > 0 ? container : undefined, effect: copy ? 'copy' : 'move' };
}

/** The rule nodes of a tree the webview shows, by id (only what is loaded: collapsed folders have no children yet) */
export function dropNodeIndex(roots: readonly ProjectNode[]): Map<NodeIdString, DropNode> {
    const index = new Map<NodeIdString, DropNode>();
    const walk = (nodes: readonly ProjectNode[], ancestors: readonly DropAncestor[]) => {
        for (const node of nodes) {
            index.set(node.nodeId, {
                nodeId: node.nodeId,
                type: node.type,
                ancestors,
                isUnloaded: node.isUnloaded,
                isTemporary: node.isTemporary,
                itemState: node.itemState,
            });
            if (node.children) {
                walk(node.children, [{ nodeId: node.nodeId, type: node.type }, ...ancestors]);
            }
        }
    };
    walk(roots, []);
    return index;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/test/unit/core/dropRules.test.ts`
Expected: PASS. A failing row means the rules are wrong, not the table: the table is the spec's.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck && npx jest src/test/unit/core
git add src/core/dropRules.ts src/test/unit/core/dropRules.test.ts
git commit -m "Drag & drop: the drop rules, shared by the webview and the extension

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: One namespace question per move, shared with Cut/Paste and folder rename

**Files:**
- Create: `src/services/namespaceAfterMove.ts`
- Modify: `src/services/solutionActionService.ts`, `docs/templates.md`, `docs/manual-testing.md`
- Test: `src/test/unit/services/namespaceAfterMove.test.ts`

Today `_pasteOne` asks per moved `.cs` file (a modal each, via `_checkAndUpdateNamespace`), a moved folder is not checked, and a renamed folder asks about all its `.cs` files, matching or not (`_handleNamespaceUpdatesAfterRename` → `_updateNamespacesInFiles`). After this task all three use one step: collect the moved C# files that no longer match, ask once.

- [ ] **Step 1: Write the failing tests**

```ts
// The namespace question after a move: one per move (drop, Paste, folder rename), only for files that do not match
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ui = {
    answers: [] as (string | undefined)[],
    questions: [] as string[],
    errors: [] as string[],
};

jest.mock('vscode', () => {
    const disposable = { dispose: () => { } };
    const watcher = { onDidChange: () => disposable, onDidCreate: () => disposable, onDidDelete: () => disposable, dispose: () => { } };
    class EventEmitter { event = () => disposable; fire() { } dispose() { } }
    const nodeFs = require('fs');
    // A message with buttons is a question (answered from ui.answers); one without is a notice
    const ask = async (message: string, ...rest: unknown[]) => {
        if (!rest.some(item => typeof item === 'string')) {
            return undefined;
        }
        ui.questions.push(message);
        return ui.answers.shift();
    };
    return {
        EventEmitter,
        Position: class { constructor(public line: number, public character: number) { } },
        RelativePattern: class { constructor(public base: string, public pattern: string) { } },
        Uri: { file: (p: string) => ({ fsPath: p }) },
        FileType: { File: 1, Directory: 2 },
        workspace: {
            createFileSystemWatcher: () => watcher,
            workspaceFolders: undefined,
            getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
            // No editor here: NamespaceService falls back to editing the file
            openTextDocument: async () => { throw new Error('no editor in unit tests'); },
            fs: {
                stat: async (uri: any) => ({ type: nodeFs.statSync(uri.fsPath).isDirectory() ? 2 : 1 }),
                rename: async (from: any, to: any) => nodeFs.renameSync(from.fsPath, to.fsPath),
                copy: async (from: any, to: any) => nodeFs.cpSync(from.fsPath, to.fsPath, { recursive: true }),
            },
        },
        window: {
            showInformationMessage: ask,
            showWarningMessage: ask,
            showErrorMessage: async (message: string) => { ui.errors.push(message); },
        },
        commands: { executeCommand: async () => undefined },
    };
}, { virtual: true });

import { namespaceChangesAfterMove, updateNamespacesAfterMove } from '../../../services/namespaceAfterMove';
import { SolutionService } from '../../../services/solutionService';
import { SolutionActionService } from '../../../services/solutionActionService';
import { NodeIdService } from '../../../services/nodeIdService';

describe('namespaces after a move', () => {
    let dir: string;
    let project: string;
    const write = (relative: string, content: string) => {
        const file = path.join(project, ...relative.split('/'));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        return file;
    };
    const read = (relative: string) => fs.readFileSync(path.join(project, ...relative.split('/')), 'utf8');
    const movedFolder = () => {
        write('New/Old/A.cs', 'namespace App.Old;\n\npublic class A { }\n');
        write('New/Old/B.cs', 'namespace App.Old\n{\n    public class B { }\n}\n');
        write('New/Old/Sub/C.cs', 'namespace App.New.Old.Sub;\n\npublic class C { }\n');
        write('New/Old/G.cs', 'public class G { }\n');
        return path.join(project, 'New', 'Old');
    };

    beforeEach(() => {
        ui.answers = [];
        ui.questions = [];
        ui.errors = [];
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-ns-')));
        project = path.join(dir, 'App');
        write('App.csproj', '<Project Sdk="Microsoft.NET.Sdk" />');
        // NamespaceService finds a file's project through the active solution
        (SolutionService as any).activeSolution = {
            getDotNetProjects: () => [{ projectPath: path.join(project, 'App.csproj'), name: 'App' }],
            forceRefreshAllProjects: async () => { },
        };
    });

    afterEach(() => {
        (SolutionService as any).activeSolution = undefined;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('a moved folder: its C# files that no longer match, not the matching or global ones', async () => {
        const changes = await namespaceChangesAfterMove([movedFolder()]);

        expect(changes.map(c => [path.basename(c.filePath), c.currentNamespace, c.expectedNamespace]).sort()).toEqual([
            ['A.cs', 'App.Old', 'App.New.Old'],
            ['B.cs', 'App.Old', 'App.New.Old'],
        ]);
    });

    test('several files: one question, Update All updates them all', async () => {
        const folder = movedFolder();
        ui.answers = ['Update All'];

        await updateNamespacesAfterMove([folder], 'Moved');

        expect(ui.questions).toEqual([expect.stringContaining('2 C# files')]);
        expect(read('New/Old/A.cs')).toContain('namespace App.New.Old;');
        expect(read('New/Old/B.cs')).toContain('namespace App.New.Old\n{');
        expect(read('New/Old/Sub/C.cs')).toContain('namespace App.New.Old.Sub;');
    });

    test('Review Each asks per file; Skip changes nothing', async () => {
        const folder = movedFolder();
        ui.answers = ['Review Each', 'Update', 'Skip All Remaining'];
        await updateNamespacesAfterMove([folder], 'Moved');
        expect(ui.questions).toHaveLength(3);
        expect(['A.cs', 'B.cs'].filter(file => read(`New/Old/${file}`).includes('App.New.Old'))).toHaveLength(1);

        ui.questions = [];
        ui.answers = ['Skip'];
        const before = read('New/Old/A.cs') + read('New/Old/B.cs');
        await updateNamespacesAfterMove([folder], 'Moved');
        expect(ui.questions).toHaveLength(1);
        expect(read('New/Old/A.cs') + read('New/Old/B.cs')).toBe(before);
    });

    test('a single file gets the single-file question', async () => {
        const file = write('Models/A.cs', 'namespace App;\n\npublic class A { }\n');
        ui.answers = ['Update Namespace'];

        await updateNamespacesAfterMove([file], 'Moved');

        expect(ui.questions).toEqual([expect.stringContaining("Update namespace in 'A.cs'")]);
        expect(read('Models/A.cs')).toContain('namespace App.Models;');
    });

    test('nothing to update: no question', async () => {
        await updateNamespacesAfterMove([write('Models/A.cs', 'namespace App.Models;\n')], 'Moved');
        expect(ui.questions).toEqual([]);
    });

    test('Cut and Paste of two C# files asks once (it asked for each file before)', async () => {
        const files = [write('A.cs', 'namespace App;\n\npublic class A { }\n'), write('B.cs', 'namespace App;\n\npublic class B { }\n')];
        fs.mkdirSync(path.join(project, 'Models'));
        await SolutionActionService.handleMultiAction('cut', files.map(file => NodeIdService.generateFileId(file)));
        ui.answers = ['Update All'];

        await SolutionActionService.handleProjectAction({ action: 'paste', nodeId: NodeIdService.generateFolderId(path.join(project, 'Models')) });

        expect(ui.questions).toHaveLength(1);
        expect(read('Models/A.cs')).toContain('namespace App.Models;');
        expect(read('Models/B.cs')).toContain('namespace App.Models;');
        expect(ui.errors).toEqual([]);
    });

    test('Copy and Paste asks nothing', async () => {
        const file = write('A.cs', 'namespace App;\n\npublic class A { }\n');
        fs.mkdirSync(path.join(project, 'Models'));
        await SolutionActionService.handleProjectAction({ action: 'copy', nodeId: NodeIdService.generateFileId(file) });

        await SolutionActionService.handleProjectAction({ action: 'paste', nodeId: NodeIdService.generateFolderId(path.join(project, 'Models')) });

        expect(ui.questions).toEqual([]);
        expect(read('Models/A.cs')).toContain('namespace App;');
        expect(fs.existsSync(file)).toBe(true);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/test/unit/services/namespaceAfterMove.test.ts`
Expected: FAIL (`Cannot find module '../../../services/namespaceAfterMove'`). Once the module exists (Step 3), the Cut/Paste test still fails with two questions until Step 4.

- [ ] **Step 3: Implement `src/services/namespaceAfterMove.ts`**

```ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../core/logger';
import { NamespaceService } from './namespaceService';

const log = logger('NamespaceAfterMove');

/** A moved C# file whose namespace does not match its new folder */
export interface NamespaceChange {
    readonly filePath: string;
    readonly currentNamespace: string;
    readonly expectedNamespace: string;
}

/**
 * The C# files now at `movedPaths` (a file itself, every `.cs` file under a folder) whose namespace does not match
 * their new place. Files without a namespace (the global one) are left out: there is nothing to rename.
 */
export async function namespaceChangesAfterMove(movedPaths: readonly string[]): Promise<NamespaceChange[]> {
    const files: string[] = [];
    for (const moved of movedPaths) {
        const stat = await fs.promises.stat(moved).catch(() => undefined);
        if (stat?.isDirectory()) {
            files.push(...await NamespaceService.getCSharpFilesInDirectory(moved));
        } else if (stat?.isFile() && moved.endsWith('.cs')) {
            files.push(moved);
        }
    }
    const changes: NamespaceChange[] = [];
    for (const filePath of files) {
        const analysis = await NamespaceService.analyzeNamespaceChanges(filePath);
        if (analysis.needsUpdate && analysis.currentNamespace && analysis.expectedNamespace) {
            changes.push({ filePath, currentNamespace: analysis.currentNamespace, expectedNamespace: analysis.expectedNamespace });
        }
    }
    return changes;
}

const fileQuestion = (operation: string, change: NamespaceChange) =>
    `${operation}: Update namespace in '${path.basename(change.filePath)}'?\n\nFrom: ${change.currentNamespace}\nTo: ${change.expectedNamespace}`;

/**
 * One question for the whole move: Update All, Review Each or Skip; a single file gets the single-file question.
 * Nothing changes without the user's choice.
 */
export async function offerNamespaceUpdates(changes: readonly NamespaceChange[], operation: string): Promise<void> {
    if (changes.length === 0) {
        return;
    }
    if (changes.length === 1) {
        const [change] = changes;
        const choice = await vscode.window.showInformationMessage(fileQuestion(operation, change), { modal: true }, 'Update Namespace', 'Skip');
        if (choice === 'Update Namespace'
            && !await NamespaceService.updateNamespaceViaRename(change.filePath, change.currentNamespace, change.expectedNamespace)) {
            vscode.window.showWarningMessage(`Failed to update namespace in '${path.basename(change.filePath)}'`);
        }
        return;
    }
    const choice = await vscode.window.showInformationMessage(
        `${operation}: ${changes.length} C# files have a namespace that does not match their new folder. Update them?`,
        { modal: true }, 'Update All', 'Review Each', 'Skip');
    if (choice !== 'Update All' && choice !== 'Review Each') {
        return;
    }
    let updated = 0;
    let skipped = 0;
    for (const change of changes) {
        if (choice === 'Review Each') {
            const answer = await vscode.window.showInformationMessage(fileQuestion(operation, change), 'Update', 'Skip', 'Skip All Remaining');
            if (answer === 'Skip All Remaining') {
                skipped = changes.length - updated;
                break;
            }
            if (answer !== 'Update') {
                skipped++;
                continue;
            }
        }
        if (await NamespaceService.updateNamespaceViaRename(change.filePath, change.currentNamespace, change.expectedNamespace)) {
            updated++;
        } else {
            log.warn(`Failed to update namespace in ${change.filePath}`);
            skipped++;
        }
    }
    vscode.window.showInformationMessage(`Namespace updates: updated ${updated} file(s)${skipped > 0 ? `, skipped ${skipped}` : ''}`);
}

/** After a move (not a copy): finds what needs a new namespace and asks once */
export async function updateNamespacesAfterMove(movedPaths: readonly string[], operation: string): Promise<void> {
    try {
        await offerNamespaceUpdates(await namespaceChangesAfterMove(movedPaths), operation);
    } catch (error) {
        log.error('Namespace update after a move failed:', error);
    }
}
```

- [ ] **Step 4: Use it in `SolutionActionService`**

In `src/services/solutionActionService.ts`:

1. Import: `import { updateNamespacesAfterMove } from './namespaceAfterMove';`
2. `_pasteOne` returns where the item went. Change its signature and doc comment to

```ts
    /** Copies or moves one file or folder into `pasteTargetPath`, asking before replacing; returns where it went (undefined: not done) */
    private static async _pasteOne(sourcePath: string, pasteTargetPath: string, operation: 'copy' | 'cut'): Promise<string | undefined> {
```
make both early `return;` statements `return undefined;`, delete the `wasFileMoved` lines (`const wasFileMoved = …`, its `log.debug`) and the whole `// Now check namespace updates for moved C# files` block at the end, and end the method with `return destinationPath;` after the `forceRefreshAllProjects` block.

3. In `_handlePaste`, replace the paste loop and the clipboard reset:

```ts
            const { paths, operation } = this.clipboard;
            const moved: string[] = [];
            for (const sourcePath of paths) {
                const destination = await this._pasteOne(sourcePath, pasteTargetPath, operation);
                if (destination && operation === 'cut') {
                    moved.push(destination);
                }
            }
            if (operation === 'cut') {
                this.clipboard = null;
                // One question for everything that was moved, as after a drop
                await updateNamespacesAfterMove(moved, 'Moved');
            }
```

4. In `_handleRename` replace `await this._handleNamespaceUpdatesAfterRename(oldPath, newPath, itemType);` with

```ts
                await updateNamespacesAfterMove([newPath], nodeId.type === 'folder' ? 'Folder renamed' : 'File renamed');
```
(`itemType` stays used by the log line at the top of `_handleRename`.)

5. Delete `_checkAndUpdateNamespace`, `_handleNamespaceUpdatesAfterRename` and `_updateNamespacesInFiles` (now unused: `noUnusedLocals` fails on unused private members), then delete `import { NamespaceService } from './namespaceService';` (its only uses were in those methods; confirm with `grep -n "NamespaceService" src/services/solutionActionService.ts`).

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest src/test/unit/services/namespaceAfterMove.test.ts src/test/unit/core/Solution.solutionFolders.test.ts`
Expected: PASS (the second file runs Cut/Paste-adjacent actions through `SolutionActionService` and must stay green).

- [ ] **Step 6: Docs**

`docs/templates.md`, section "Namespaces": replace the sentence "Moving C# files to another folder (cut and paste) and renaming a folder offer to update their namespaces the same way." with

```markdown
Moving C# files or folders to another folder (cut and paste, or drag and drop) and renaming a folder offer to update their namespaces the same way, with one question for all the files that no longer match: Update All, Review Each (a question per file) or Skip. A single file gets a question of its own. Files whose namespace already matches, and files without a namespace, are not counted; copies keep their namespaces.
```
`docs/manual-testing.md`, before `## Bug fixes to confirm`, add:

```markdown
- [ ] Namespaces after Cut/Paste (BasicsTestProject): cut a folder with three C# files whose namespaces match their old place and paste it into another folder: one question "3 C# files have a namespace that does not match their new folder" with Update All / Review Each / Skip; Update All changes all three (the language server's rename, references in other files follow); Review Each asks per file; a single cut file asks "Update namespace in 'X.cs'?"; Copy/Paste asks nothing; renaming a folder asks the same way, and not at all when the namespaces already match
```

- [ ] **Step 7: Typecheck, test and commit**

```bash
npm run typecheck && npm test
git add src/services/namespaceAfterMove.ts src/services/solutionActionService.ts src/test/unit/services/namespaceAfterMove.test.ts docs/templates.md docs/manual-testing.md
git commit -m "Namespaces after a move: one question per Paste or folder rename, also for moved folders

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `Solution.moveToSolutionFolder` for `.sln`

**Files:**
- Modify: `src/core/Solution.ts`, `src/__fixtures__/solution-hierarchy/TestHierarchy.sln`
- Create: `src/__fixtures__/solution-hierarchy/README.md`
- Test: `src/test/unit/core/Solution.moveToSolutionFolder.test.ts`

The fixture is used by no test yet; it gets a nested solution folder (`Libraries/Shared` with `Utils`), an empty `Tools` folder, a solution item (`README.md` in `Web Projects`) and a second folder named `Shared` (in `Web Projects`, for the duplicate-name refusal).

- [ ] **Step 1: The fixture**

`src/__fixtures__/solution-hierarchy/README.md`: `# Test hierarchy` and a newline.

`src/__fixtures__/solution-hierarchy/TestHierarchy.sln` (LF line endings, tabs as in Visual Studio; replace the whole file):

```
Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
VisualStudioVersion = 17.8.34330.188
MinimumVisualStudioVersion = 10.0.40219.1
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Web Projects", "Web Projects", "{11111111-1111-1111-1111-111111111111}"
	ProjectSection(SolutionItems) = preProject
		README.md = README.md
	EndProjectSection
EndProject
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Libraries", "Libraries", "{22222222-2222-2222-2222-222222222222}"
EndProject
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Shared", "Shared", "{88888888-8888-8888-8888-888888888888}"
EndProject
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Tools", "Tools", "{99999999-9999-9999-9999-999999999999}"
EndProject
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Shared", "Shared", "{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "WebApp", "src\WebApp\WebApp.csproj", "{33333333-3333-3333-3333-333333333333}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "WebApi", "src\WebApi\WebApi.csproj", "{44444444-4444-4444-4444-444444444444}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "CoreLibrary", "lib\CoreLibrary\CoreLibrary.csproj", "{55555555-5555-5555-5555-555555555555}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Utils", "lib\Utils\Utils.csproj", "{66666666-6666-6666-6666-666666666666}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "StandaloneProject", "standalone\StandaloneProject.csproj", "{77777777-7777-7777-7777-777777777777}"
EndProject
Global
```
followed by the existing `Global` body unchanged except the `NestedProjects` section, which becomes

```
	GlobalSection(NestedProjects) = preSolution
		{33333333-3333-3333-3333-333333333333} = {11111111-1111-1111-1111-111111111111}
		{44444444-4444-4444-4444-444444444444} = {11111111-1111-1111-1111-111111111111}
		{55555555-5555-5555-5555-555555555555} = {22222222-2222-2222-2222-222222222222}
		{66666666-6666-6666-6666-666666666666} = {88888888-8888-8888-8888-888888888888}
		{88888888-8888-8888-8888-888888888888} = {22222222-2222-2222-2222-222222222222}
		{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA} = {11111111-1111-1111-1111-111111111111}
	EndGlobalSection
```

- [ ] **Step 2: Write the failing tests**

```ts
// Solution.moveToSolutionFolder: drag & drop of projects, solution folders and solution items, on a copy of
// src/__fixtures__/solution-hierarchy
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => {
    const disposable = { dispose: () => { } };
    const watcher = { onDidChange: () => disposable, onDidCreate: () => disposable, onDidDelete: () => disposable, dispose: () => { } };
    class EventEmitter { event = () => disposable; fire() { } dispose() { } }
    return {
        EventEmitter,
        RelativePattern: class { constructor(public base: string, public pattern: string) { } },
        Uri: { file: (p: string) => ({ fsPath: p }) },
        workspace: {
            createFileSystemWatcher: () => watcher,
            workspaceFolders: undefined,
            getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
        },
        window: { showInformationMessage: async () => undefined, showWarningMessage: async () => undefined, showErrorMessage: async () => undefined },
        commands: { executeCommand: async () => undefined },
    };
}, { virtual: true });

// The parsers refuse paths under /tmp (and /var, where macOS keeps its temp dir)
jest.mock('../../../core/constants', () => ({
    ...jest.requireActual('../../../core/constants'),
    isSystemPath: () => false,
}));

import { Solution, SolutionNodeMove } from '../../../core/Solution';
import { ProjectItemsService } from '../../../services/projectItems/projectItemsService';

beforeEach(() => { jest.spyOn(ProjectItemsService.instance, 'evaluate').mockResolvedValue(undefined); });

const fixture = path.join(__dirname, '../../../__fixtures__/solution-hierarchy');

const openSolution = async (file: string) => {
    const solution = new Solution(file);
    for (let i = 0; i < 100 && !solution.isInitialized; i++) await new Promise(r => setTimeout(r, 10));
    return solution;
};

const variants: [string, string, (text: string) => string][] = [
    ['.sln', 'TestHierarchy.sln', text => text],
    ['.sln with CRLF line endings', 'TestHierarchy.sln', text => text.replace(/\n/g, '\r\n')],
];

describe.each(variants)('Solution.moveToSolutionFolder (%s)', (_, fileName, transform) => {
    let dir: string;
    let file: string;
    let solution: Solution;
    const isSln = fileName.endsWith('.sln');

    beforeEach(async () => {
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-move-')));
        fs.cpSync(fixture, dir, { recursive: true });
        file = path.join(dir, fileName);
        fs.writeFileSync(file, transform(fs.readFileSync(file, 'utf8')));
        solution = await openSolution(file);
    });

    afterEach(() => {
        solution.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    // Folders and projects by name, nested by indentation; solution items as "- path"
    const outline = (): string[] => {
        const model = solution.solutionFile!;
        const parentOf = (guid: string) => model.nestedProjects.find(n => n.childGuid === guid)?.parentGuid;
        const print = (parent: string | undefined, indent: string): string[] => model.projects
            .filter(p => parentOf(p.guid) === parent)
            .sort((a, b) => a.name.localeCompare(b.name))
            .flatMap(p => [
                `${indent}${p.name}`,
                ...solution.getSolutionItems(p).map(item => `${indent}  - ${item.replace(/\\/g, '/')}`),
                ...(solution.isSolutionFolder(p) ? print(p.guid, `${indent}  `) : []),
            ]);
        return print(undefined, '');
    };
    const folder = (...names: string[]) => solution.solutionFile!.projects
        .find(p => solution.isSolutionFolder(p) && solution.getSolutionFolderPath(p.guid) === names.join('/'))!.guid;
    const project = (...parts: string[]): SolutionNodeMove => ({ kind: 'project', projectPath: path.join(dir, ...parts) });
    const text = () => fs.readFileSync(file, 'utf8');
    /** Lines only in `before`, and lines only in `after` */
    const diff = (before: string, after: string) => {
        const a = before.split(/\r?\n/);
        const b = after.split(/\r?\n/);
        return { removed: a.filter(line => !b.includes(line)), added: b.filter(line => !a.includes(line)) };
    };
    const webProjects = ['Web Projects', '  - README.md', '  Shared', '  WebApi', '  WebApp'];

    test('the fixture', () => {
        expect(outline()).toEqual(['Libraries', '  CoreLibrary', '  Shared', '    Utils', 'StandaloneProject', 'Tools', ...webProjects]);
    });

    test('moves a project into a solution folder', async () => {
        const before = text();
        await solution.moveToSolutionFolder(project('src', 'WebApp', 'WebApp.csproj'), folder('Tools'));

        expect(outline()).toEqual(['Libraries', '  CoreLibrary', '  Shared', '    Utils', 'StandaloneProject', 'Tools', '  WebApp',
            'Web Projects', '  - README.md', '  Shared', '  WebApi']);
        if (isSln) {
            expect(diff(before, text())).toEqual({
                removed: ['\t\t{33333333-3333-3333-3333-333333333333} = {11111111-1111-1111-1111-111111111111}'],
                added: ['\t\t{33333333-3333-3333-3333-333333333333} = {99999999-9999-9999-9999-999999999999}'],
            });
        }
    });

    test('moves a project to the solution root', async () => {
        const before = text();
        await solution.moveToSolutionFolder(project('lib', 'CoreLibrary', 'CoreLibrary.csproj'), undefined);

        expect(outline()).toEqual(['CoreLibrary', 'Libraries', '  Shared', '    Utils', 'StandaloneProject', 'Tools', ...webProjects]);
        if (isSln) {
            expect(diff(before, text())).toEqual({
                removed: ['\t\t{55555555-5555-5555-5555-555555555555} = {22222222-2222-2222-2222-222222222222}'],
                added: [],
            });
        }
    });

    test('moves a solution folder with what is in it', async () => {
        await solution.moveToSolutionFolder({ kind: 'solutionFolder', folderGuid: folder('Libraries', 'Shared') }, folder('Tools'));

        expect(outline()).toEqual(['Libraries', '  CoreLibrary', 'StandaloneProject', 'Tools', '  Shared', '    Utils', ...webProjects]);
    });

    test('moves a solution folder to the root', async () => {
        await solution.moveToSolutionFolder({ kind: 'solutionFolder', folderGuid: folder('Libraries', 'Shared') }, undefined);

        expect(outline()).toEqual(['Libraries', '  CoreLibrary', 'Shared', '  Utils', 'StandaloneProject', 'Tools', ...webProjects]);
    });

    test('moves a solution item to another solution folder', async () => {
        await solution.moveToSolutionFolder(
            { kind: 'solutionItem', filePath: path.join(dir, 'README.md'), folderGuid: folder('Web Projects') }, folder('Tools'));

        expect(outline()).toEqual(['Libraries', '  CoreLibrary', '  Shared', '    Utils', 'StandaloneProject', 'Tools', '  - README.md',
            'Web Projects', '  Shared', '  WebApi', '  WebApp']);
        if (isSln) {
            const lines = text().split(/\r?\n/);
            const block = (name: string) => {
                const start = lines.findIndex(line => line.includes(`= "${name}", "${name}"`));
                return lines.slice(start + 1, lines.indexOf('EndProject', start));
            };
            expect(block('Web Projects')).toEqual([]);
            expect(block('Tools')).toEqual(['\tProjectSection(SolutionItems) = preProject', '\t\tREADME.md = README.md', '\tEndProjectSection']);
        }
    });

    test('refuses a name the target already has, and leaves the file alone', async () => {
        const before = text();
        await expect(solution.moveToSolutionFolder({ kind: 'solutionFolder', folderGuid: folder('Libraries', 'Shared') }, folder('Web Projects')))
            .rejects.toThrow('already contains "Shared"');
        expect(text()).toBe(before);

        // The same file in two solution folders: moving one copy onto the other is refused
        await solution.addSolutionItem(folder('Tools'), path.join(dir, 'README.md'));
        const withItem = text();
        await expect(solution.moveToSolutionFolder(
            { kind: 'solutionItem', filePath: path.join(dir, 'README.md'), folderGuid: folder('Web Projects') }, folder('Tools')))
            .rejects.toThrow('already contains README.md');
        expect(text()).toBe(withItem);
    });

    test('refuses a solution folder into itself or a folder inside it', async () => {
        const before = text();
        await expect(solution.moveToSolutionFolder({ kind: 'solutionFolder', folderGuid: folder('Libraries') }, folder('Libraries', 'Shared')))
            .rejects.toThrow('cannot be moved into itself');
        await expect(solution.moveToSolutionFolder({ kind: 'solutionFolder', folderGuid: folder('Libraries') }, folder('Libraries')))
            .rejects.toThrow('cannot be moved into itself');
        expect(text()).toBe(before);
    });

    test('solution items stay in solution folders', async () => {
        await expect(solution.moveToSolutionFolder(
            { kind: 'solutionItem', filePath: path.join(dir, 'README.md'), folderGuid: folder('Web Projects') }, undefined))
            .rejects.toThrow('Solution items belong in a solution folder');
    });

    test('a node dropped where it already is changes nothing', async () => {
        const before = text();
        await solution.moveToSolutionFolder(project('src', 'WebApp', 'WebApp.csproj'), folder('Web Projects'));
        await solution.moveToSolutionFolder(project('standalone', 'StandaloneProject.csproj'), undefined);
        await solution.moveToSolutionFolder(
            { kind: 'solutionItem', filePath: path.join(dir, 'README.md'), folderGuid: folder('Web Projects') }, folder('Web Projects'));
        expect(text()).toBe(before);
    });
});

test('.sln: a NestedProjects section left empty goes, as Visual Studio writes none', async () => {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-move-')));
    const projectPath = path.join(dir, 'src', 'Lib', 'Lib.csproj');
    fs.mkdirSync(path.dirname(projectPath), { recursive: true });
    fs.writeFileSync(projectPath, '<Project Sdk="Microsoft.NET.Sdk" />');
    const file = path.join(dir, 'App.sln');
    fs.writeFileSync(file, [
        'Microsoft Visual Studio Solution File, Format Version 12.00',
        'Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Libs", "Libs", "{6C4D298B-81FB-2B6B-5AB6-46205EDDC72C}"',
        'EndProject',
        'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Lib", "src\\Lib\\Lib.csproj", "{142F4FE7-2814-4E67-A7EF-97A50F8A2890}"',
        'EndProject',
        'Global',
        '\tGlobalSection(SolutionProperties) = preSolution',
        '\t\tHideSolutionNode = FALSE',
        '\tEndGlobalSection',
        '\tGlobalSection(NestedProjects) = preSolution',
        '\t\t{142F4FE7-2814-4E67-A7EF-97A50F8A2890} = {6C4D298B-81FB-2B6B-5AB6-46205EDDC72C}',
        '\tEndGlobalSection',
        'EndGlobal',
        '',
    ].join('\n'));
    const solution = await openSolution(file);
    try {
        await solution.moveToSolutionFolder({ kind: 'project', projectPath }, undefined);

        expect(fs.readFileSync(file, 'utf8')).toBe([
            'Microsoft Visual Studio Solution File, Format Version 12.00',
            'Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Libs", "Libs", "{6C4D298B-81FB-2B6B-5AB6-46205EDDC72C}"',
            'EndProject',
            'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Lib", "src\\Lib\\Lib.csproj", "{142F4FE7-2814-4E67-A7EF-97A50F8A2890}"',
            'EndProject',
            'Global',
            '\tGlobalSection(SolutionProperties) = preSolution',
            '\t\tHideSolutionNode = FALSE',
            '\tEndGlobalSection',
            'EndGlobal',
            '',
        ].join('\n'));
    } finally {
        solution.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx jest src/test/unit/core/Solution.moveToSolutionFolder.test.ts`
Expected: FAIL (ts-jest: `SolutionNodeMove` is not exported, `moveToSolutionFolder` does not exist).

- [ ] **Step 4: Implement in `src/core/Solution.ts`**

Next to the `SolutionFileItem` interface (top of the file):

```ts
/** A node of the solution file that drag & drop moves to another solution folder */
export type SolutionNodeMove =
    | { readonly kind: 'project'; readonly projectPath: string }
    | { readonly kind: 'solutionFolder'; readonly folderGuid: string }
    | { readonly kind: 'solutionItem'; readonly filePath: string; readonly folderGuid: string };
```

In `class Solution`, after `removeSolutionItem`. The `SolutionXFileEditor` methods of the two `if (this.isSlnx)` branches come in Task 4: in this task write each of those two branches as `throw new Error('Moving is not supported for .slnx files yet');` so every commit builds, and Task 4 puts in the calls shown here.

```ts
    /**
     * Moves a project, solution folder or solution item into another solution folder (`undefined`: the solution root,
     * not for solution items), like Visual Studio's drag & drop. Refuses a folder into itself or a folder inside it and
     * a name the target already has; a node already there is left alone.
     */
    async moveToSolutionFolder(node: SolutionNodeMove, targetFolderGuid: string | undefined): Promise<void> {
        const solutionFile = this._solutionFile;
        if (!solutionFile) {
            throw new Error('The solution is not loaded');
        }
        const same = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toUpperCase() === b.toUpperCase();
        const parentOf = (guid: string) => solutionFile.nestedProjects.find(n => same(n.childGuid, guid))?.parentGuid;
        const folderOf = (guid: string) => solutionFile.projects.find(p => same(p.guid, guid) && SolutionFileParser.isSolutionFolder(p));
        const target = targetFolderGuid === undefined ? undefined : folderOf(targetFolderGuid);
        if (targetFolderGuid !== undefined && !target) {
            throw new Error(`Solution folder "${targetFolderGuid}" not found`);
        }
        const targetName = target ? `"${target.name}"` : 'The solution';
        const solutionDir = path.dirname(this._solutionPath);
        const relative = (file: string) => path.relative(solutionDir, file).split(path.sep).join('/');

        if (node.kind === 'solutionItem') {
            const from = folderOf(node.folderGuid);
            if (!target) {
                throw new Error('Solution items belong in a solution folder');
            }
            if (!from) {
                throw new Error(`Solution folder "${node.folderGuid}" not found`);
            }
            if (same(from.guid, target.guid)) {
                return;
            }
            const itemPath = relative(node.filePath);
            const key = (item: string) => item.replace(/\\/g, '/').toLowerCase();
            if (this.getSolutionItems(target).some(item => key(item) === key(itemPath))) {
                throw new Error(`${targetName} already contains ${path.basename(node.filePath)}`);
            }
            if (this.isSlnx) {
                await this.editSlnx(content => SolutionXFileEditor.moveFile(
                    content, this.getSolutionFolderSegments(from.guid), itemPath, this.getSolutionFolderSegments(target.guid)));
            } else {
                await this.editSlnLines(lines => this.moveSolutionItemLines(lines, from.guid, target.guid, itemPath));
            }
            log.info(`Moved solution item ${itemPath} to ${targetName}`);
            return;
        }

        const moving = node.kind === 'project'
            ? solutionFile.projects.find(p => !SolutionFileParser.isSolutionFolder(p)
                && path.resolve(solutionDir, p.path) === path.resolve(node.projectPath))
            : folderOf(node.folderGuid);
        if (!moving) {
            throw new Error(`${node.kind === 'project' ? path.basename(node.projectPath) : 'The solution folder'} is not in the solution`);
        }
        const currentParent = parentOf(moving.guid);
        if (target ? same(currentParent, target.guid) : !currentParent) {
            return;
        }
        for (let guid = target?.guid, depth = 0; guid && depth < 64; guid = parentOf(guid), depth++) {
            if (same(guid, moving.guid)) {
                throw new Error(`"${moving.name}" cannot be moved into itself or a folder inside it`);
            }
        }
        const siblings = solutionFile.projects.filter(p => target ? same(parentOf(p.guid), target.guid) : !parentOf(p.guid));
        if (siblings.some(p => p.name.toLowerCase() === moving.name.toLowerCase())) {
            throw new Error(`${targetName} already contains "${moving.name}"`);
        }

        if (this.isSlnx) {
            const targetSegments = target ? this.getSolutionFolderSegments(target.guid) : [];
            await this.editSlnx(content => node.kind === 'project'
                ? SolutionXFileEditor.moveProject(content, relative(node.projectPath), targetSegments)
                : SolutionXFileEditor.moveFolder(content, this.getSolutionFolderSegments(moving.guid), targetSegments));
        } else {
            await this.editSlnLines(lines => this.setNestedParent(lines, moving.guid, target?.guid));
        }
        log.info(`Moved "${moving.name}" to ${targetName}`);
    }

    /** Reads the .sln, applies a line edit, writes it with the file's line endings and re-parses */
    private async editSlnLines(edit: (lines: string[]) => string[]): Promise<void> {
        const content = await this._handler.read();
        await this._handler.write(edit(content.split(/\r?\n/)).join(eolOf(content)));
        await this.parseSolutionFile();
    }

    /**
     * Points the child's `NestedProjects` entry at `parentGuid`, or removes it (the solution root); a section left
     * empty goes too, as Visual Studio writes none
     */
    private setNestedParent(lines: string[], childGuid: string, parentGuid: string | undefined): string[] {
        const start = lines.findIndex(line => line.trim() === 'GlobalSection(NestedProjects) = preSolution');
        const end = start === -1 ? -1 : lines.findIndex((line, i) => i > start && line.trim() === 'EndGlobalSection');
        const entry = end === -1 ? -1 : lines.findIndex((line, i) => i > start && i < end
            && line.split('=')[0].trim().toUpperCase() === childGuid.toUpperCase());
        if (entry === -1) {
            return parentGuid ? this.addNestedProjectEntry(lines, childGuid, parentGuid) : lines;
        }
        if (parentGuid) {
            return lines.map((line, i) => i === entry ? line.replace(/=\s*\{[^}]*\}\s*$/, `= ${parentGuid}`) : line);
        }
        const without = lines.filter((_, i) => i !== entry);
        // Only the section's first and last line are left
        return end - start === 2 ? without.filter((_, i) => i !== start && i !== start + 1) : without;
    }

    /** The `Project(...)` line and the `EndProject` line of a solution folder */
    private solutionFolderBlock(lines: string[], folderGuid: string): { start: number; end: number } {
        const start = lines.findIndex(line => line.trim().startsWith(`Project("${PROJECT_TYPE_GUIDS.SOLUTION_FOLDER}")`)
            && line.toUpperCase().includes(folderGuid.toUpperCase()));
        const end = start === -1 ? -1 : lines.findIndex((line, i) => i > start && line.trim() === 'EndProject');
        if (end === -1) {
            throw new Error(`Could not find the block of solution folder "${folderGuid}"`);
        }
        return { start, end };
    }

    /**
     * Moves a solution item's line from one solution folder's `ProjectSection(SolutionItems)` to another's, keeping its
     * text (Visual Studio writes `\`); a section left empty goes
     */
    private moveSolutionItemLines(lines: string[], fromGuid: string, toGuid: string, itemPath: string): string[] {
        const block = this.solutionFolderBlock(lines, fromGuid);
        const key = (text: string) => text.replace(/\\/g, '/').toLowerCase();
        const index = lines.findIndex((line, i) => i > block.start && i < block.end && line.includes('=')
            && key(line.split('=')[0].trim()) === key(itemPath));
        if (index === -1) {
            throw new Error(`Solution item "${itemPath}" not found in its solution folder`);
        }
        const item = lines[index].split('=')[0].trim();
        let without = lines.filter((_, i) => i !== index);
        if (without[index - 1]?.trim() === 'ProjectSection(SolutionItems) = preProject' && without[index]?.trim() === 'EndProjectSection') {
            without = without.filter((_, i) => i !== index - 1 && i !== index);
        }
        return this.addSolutionItemToFolder(without, toGuid, item);
    }
```

(`addNestedProjectEntry` and `addSolutionItemToFolder` exist already: the first appends `\t\t{child} = {parent}` to the section or creates it before `EndGlobal`, the second adds `\t\t{item} = {item}` to the folder's `ProjectSection(SolutionItems)` or creates the section before `EndProject`.)

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest src/test/unit/core/Solution.moveToSolutionFolder.test.ts src/test/unit/core/Solution.solutionFolders.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck && npx jest src/test/unit/core src/parsers
git add src/core/Solution.ts src/__fixtures__/solution-hierarchy/TestHierarchy.sln src/__fixtures__/solution-hierarchy/README.md src/test/unit/core/Solution.moveToSolutionFolder.test.ts
git commit -m "Drag & drop: move projects, solution folders and solution items in .sln files

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The same moves in `.slnx`

**Files:**
- Modify: `src/parsers/solutionXFileEditor.ts`, `src/core/Solution.ts` (swap the `.slnx` placeholders of Task 3), `src/test/unit/core/Solution.moveToSolutionFolder.test.ts`
- Create: `src/__fixtures__/solution-hierarchy/TestHierarchy.slnx`
- Test: `src/test/unit/parsers/solutionXFileEditor.test.ts`

`.slnx` folders are flat (`Name="/a/b/"`), projects and files sit inside `<Folder>` elements or (projects) at the root. Moving a folder renames it and every folder below it; a project or file moves as an element. Text edits keep everything else as it is.

- [ ] **Step 1: Write the failing editor tests**

Add to `src/test/unit/parsers/solutionXFileEditor.test.ts`, inside `describe('SolutionXFileEditor', …)` after `describe('removeFile', …)` (they use the file's `sample` and `structure`):

```ts
    describe('moveProject', () => {
        test('moves a root project to the end of a folder', () => {
            expect(SolutionXFileEditor.moveProject(sample, 'App/App.csproj', ['src'])).toBe(`<Solution>
  <Folder Name="/Deep/" />
  <Folder Name="/Deep/Deeper/">
    <Project Path="src/nested/Inner/Inner.csproj" />
  </Folder>
  <Folder Name="/src/">
    <File Path="src/README.md" />
    <Project Path="src/Lib/Lib.csproj" />
    <Project Path="App/App.csproj" />
  </Folder>
</Solution>
`);
        });

        test('moves a project to the root, after the root projects', () => {
            expect(SolutionXFileEditor.moveProject(sample, 'src/Lib/Lib.csproj', [])).toBe(`<Solution>
  <Folder Name="/Deep/" />
  <Folder Name="/Deep/Deeper/">
    <Project Path="src/nested/Inner/Inner.csproj" />
  </Folder>
  <Folder Name="/src/">
    <File Path="src/README.md" />
  </Folder>
  <Project Path="App/App.csproj" />
  <Project Path="src/Lib/Lib.csproj" />
</Solution>
`);
        });

        test('a folder left empty becomes self-closing; a self-closing target opens', async () => {
            const result = SolutionXFileEditor.moveProject(sample, 'src/nested/Inner/Inner.csproj', ['Deep']);

            expect(result).toContain('  <Folder Name="/Deep/">\n    <Project Path="src/nested/Inner/Inner.csproj" />\n  </Folder>\n  <Folder Name="/Deep/Deeper/" />\n');
            expect(await structure(result)).toContain('project src/nested/Inner/Inner.csproj <- Deep');
        });

        test('to the root when there is no root project: before </Solution>', () => {
            const noRoot = sample.replace('  <Project Path="App/App.csproj" />\n', '');
            expect(SolutionXFileEditor.moveProject(noRoot, 'src/Lib/Lib.csproj', [])).toMatch(/  <Project Path="src\/Lib\/Lib.csproj" \/>\n<\/Solution>\n$/);
        });

        test('moves child elements along, re-indented, and matches paths regardless of separator', () => {
            const withChild = sample.replace('  <Project Path="App/App.csproj" />',
                '  <Project Path="App/App.csproj">\n    <BuildType Project="Release" />\n  </Project>');
            expect(SolutionXFileEditor.moveProject(withChild, 'App\\App.csproj', ['src'])).toContain(
                '    <Project Path="src/Lib/Lib.csproj" />\n    <Project Path="App/App.csproj">\n      <BuildType Project="Release" />\n    </Project>\n  </Folder>');
        });

        test('throws for a project that is not there', () => {
            expect(() => SolutionXFileEditor.moveProject(sample, 'Nope/Nope.csproj', [])).toThrow('not found');
        });
    });

    describe('moveFolder', () => {
        test('renames the folder and its descendants under the target; elements stay in place', async () => {
            const result = SolutionXFileEditor.moveFolder(sample, ['Deep'], ['src']);

            expect(result).toBe(sample.replace('"/Deep/"', '"/src/Deep/"').replace('"/Deep/Deeper/"', '"/src/Deep/Deeper/"'));
            expect(await structure(result)).toEqual(expect.arrayContaining([
                'folder src/Deep',
                'folder src/Deep/Deeper',
                'project src/nested/Inner/Inner.csproj <- src/Deep/Deeper',
            ]));
        });

        test('moves a nested folder to the root', () => {
            expect(SolutionXFileEditor.moveFolder(sample, ['Deep', 'Deeper'], [])).toContain('<Folder Name="/Deeper/">');
        });

        test('refuses itself, its descendants and a name the target has', () => {
            expect(() => SolutionXFileEditor.moveFolder(sample, ['Deep'], ['Deep', 'Deeper'])).toThrow('into itself');
            expect(() => SolutionXFileEditor.moveFolder(sample, ['Deep'], ['Deep'])).toThrow('into itself');
            const withDuplicate = sample.replace('  <Project Path="App/App.csproj" />', '  <Folder Name="/src/Deeper/" />\n  <Project Path="App/App.csproj" />');
            expect(() => SolutionXFileEditor.moveFolder(withDuplicate, ['Deep', 'Deeper'], ['src'])).toThrow('already exists');
        });
    });

    describe('moveFile', () => {
        test('moves a solution item from one folder to another', async () => {
            const result = SolutionXFileEditor.moveFile(sample, ['src'], 'src/README.md', ['Deep']);

            expect(result).toContain('  <Folder Name="/Deep/">\n    <File Path="src/README.md" />\n  </Folder>\n');
            expect(result).toContain('  <Folder Name="/src/">\n    <Project Path="src/Lib/Lib.csproj" />\n  </Folder>\n');
            expect(await structure(result)).toContain('file src/README.md <- Deep');
        });

        test('throws when the file is not in that folder', () => {
            expect(() => SolutionXFileEditor.moveFile(sample, ['Deep'], 'src/README.md', ['src'])).toThrow('not found');
        });
    });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/test/unit/parsers/solutionXFileEditor.test.ts`
Expected: FAIL (`moveProject is not a function`); the existing tests pass.

- [ ] **Step 3: Implement in `src/parsers/solutionXFileEditor.ts`**

Under `FILE_RE`:

```ts
const PROJECT_RE = () => new RegExp(`<Project\\b${ATTRS}\\s*(?:\\/>|>[\\s\\S]*?<\\/Project\\s*>)`, 'g');
```

Public methods, after `removeFile`:

```ts
    /**
     * Moves a project into the folder (`[]`: the solution root) as one element, child elements included; a folder it
     * leaves empty becomes self-closing
     */
    static moveProject(content: string, projectPath: string, targetSegments: string[]): string {
        const normalized = this.normalizePath(projectPath).toLowerCase();
        const project = this.findProjects(content).find(p => this.normalizePath(p.path).toLowerCase() === normalized);
        if (!project) {
            throw new Error(`Project "${projectPath}" not found in solution`);
        }
        const element = content.slice(project.start, project.end);
        const fromIndent = this.lineIndent(content, project.start);
        content = this.removeLines(content, project.start, project.end);
        if (project.folder) {
            content = this.collapseIfEmpty(content, project.folder.start);
        }
        return targetSegments.length > 0
            ? this.appendToFolder(content, targetSegments, element, fromIndent)
            : this.appendToRoot(content, element, fromIndent);
    }

    /** Moves a folder and the folders below it into the target folder (`[]`: the solution root): their Names change */
    static moveFolder(content: string, segments: string[], targetSegments: string[]): string {
        const name = segments[segments.length - 1];
        const key = segments.join('/');
        const newKey = [...targetSegments, name].join('/');
        if (`${targetSegments.join('/')}/`.toLowerCase().startsWith(`${key}/`.toLowerCase())) {
            throw new Error(`Solution folder "${name}" cannot be moved into itself`);
        }
        if (newKey.toLowerCase() === key.toLowerCase()) {
            return content;
        }
        const taken = newKey.toLowerCase();
        if (this.findFolders(content).some(f => f.key.toLowerCase() === taken || f.key.toLowerCase().startsWith(`${taken}/`))) {
            throw new Error(`Solution folder "${name}" already exists there`);
        }
        return this.rekeyFolders(this.ensureFolderElements(content, targetSegments), key, newKey);
    }

    /** Moves a solution item from one folder to another */
    static moveFile(content: string, fromSegments: string[], filePath: string, toSegments: string[]): string {
        const normalized = this.normalizePath(filePath).toLowerCase();
        const from = this.findFolders(content).find(f => f.key === fromSegments.join('/'));
        const file = from && this.findFiles(content, from).find(f => this.normalizePath(f.path).toLowerCase() === normalized);
        if (!from || !file) {
            throw new Error(`Solution item "${filePath}" not found in solution folder "${fromSegments[fromSegments.length - 1]}"`);
        }
        content = this.collapseIfEmpty(this.removeLines(content, file.start, file.end), from.start);
        return this.addFile(content, toSegments, file.path);
    }
```

Refactor `renameFolder`: keep its validation and duplicate check, and replace its loop (from `const targets = …` to `return content;`) with `return this.rekeyFolders(content, key, newKey);`. In `removeFile` replace the inline "Collapse `<Folder ...>   </Folder>`" block with `content = this.collapseIfEmpty(content, folder.start);`. The existing tests of both must stay green.

Private helpers, after `findFiles`:

```ts
    /** Gives the folder `key` and the folders below it their Name under `newKey` */
    private static rekeyFolders(content: string, key: string, newKey: string): string {
        const targets = this.findFolderAndDescendants(content, key.split('/'));
        for (const folder of targets.reverse()) {
            const renamedKey = newKey + folder.key.slice(key.length);
            const element = content.slice(folder.start, folder.end);
            const updated = element.replace(
                /(\sName\s*=\s*)("[^"]*"|'[^']*')/,
                (_, prefix) => `${prefix}"${this.escape(`/${renamedKey}/`)}"`
            );
            content = content.slice(0, folder.start) + updated + content.slice(folder.end);
        }
        return content;
    }

    /** `<Folder ...>` with only whitespace inside becomes `<Folder ... />` */
    private static collapseIfEmpty(content: string, folderStart: number): string {
        const folder = this.findFolders(content).find(f => f.start === folderStart);
        if (!folder || folder.selfClosing || /\S/.test(content.slice(folder.bodyStart, folder.bodyEnd))) {
            return content;
        }
        return content.slice(0, folder.start) + `<Folder${folder.attrs} />` + content.slice(folder.end);
    }

    /** `<Project>` elements, with the folder whose body holds them (none: at the root) */
    private static findProjects(content: string): { start: number; end: number; path: string; folder?: FolderElement }[] {
        const folders = this.findFolders(content);
        const projects: { start: number; end: number; path: string; folder?: FolderElement }[] = [];
        const re = PROJECT_RE();
        let match: RegExpExecArray | null;
        while ((match = re.exec(content)) !== null) {
            const projectPath = this.getAttribute(match[1], 'Path');
            if (projectPath) {
                const start = match.index;
                const end = start + match[0].length;
                projects.push({ start, end, path: projectPath, folder: folders.find(f => !f.selfClosing && start >= f.bodyStart && end <= f.bodyEnd) });
            }
        }
        return projects;
    }

    /** Adds an element as the last child of the folder (its element created when missing), indented for its new depth */
    private static appendToFolder(content: string, segments: string[], element: string, fromIndent: string): string {
        content = this.ensureFolderElements(content, segments);
        const folder = this.findFolders(content).find(f => f.key === segments.join('/'))!;
        const nl = this.newline(content);
        const indent = this.lineIndent(content, folder.start);
        const childIndent = indent + this.indentUnit(content);
        const moved = this.reindent(element, fromIndent, childIndent);
        const body = folder.selfClosing ? '' : content.slice(folder.bodyStart, folder.bodyEnd);
        if (!/\S/.test(body)) {
            return content.slice(0, folder.start) + `<Folder${folder.attrs}>${nl}${childIndent}${moved}${nl}${indent}</Folder>` + content.slice(folder.end);
        }
        const insertAt = this.lineEnd(content, folder.bodyStart + body.trimEnd().length);
        return content.slice(0, insertAt) + `${childIndent}${moved}${nl}` + content.slice(insertAt);
    }

    /** Adds an element after the last project at the solution root, or at the end of the solution */
    private static appendToRoot(content: string, element: string, fromIndent: string): string {
        const nl = this.newline(content);
        const rootProjects = this.findProjects(content).filter(p => !p.folder);
        const last = rootProjects[rootProjects.length - 1];
        if (last) {
            const indent = this.lineIndent(content, last.start);
            const insertAt = this.lineEnd(content, last.end);
            return content.slice(0, insertAt) + `${indent}${this.reindent(element, fromIndent, indent)}${nl}` + content.slice(insertAt);
        }
        const close = content.lastIndexOf('</Solution');
        if (close === -1) {
            throw new Error('Invalid .slnx file: missing <Solution> root element');
        }
        const unit = this.indentUnit(content);
        const lineStart = this.lineStart(content, close);
        return content.slice(0, lineStart) + `${unit}${this.reindent(element, fromIndent, unit)}${nl}` + content.slice(lineStart);
    }

    /** Moves the continuation lines of a multi-line element from one indentation to another */
    private static reindent(element: string, fromIndent: string, toIndent: string): string {
        return element.replace(/(\r?\n)([ \t]*)/g, (_, nl: string, indent: string) =>
            nl + (indent.startsWith(fromIndent) ? toIndent + indent.slice(fromIndent.length) : indent));
    }
```

- [ ] **Step 4: Run the editor tests**

Run: `npx jest src/test/unit/parsers/solutionXFileEditor.test.ts`
Expected: PASS. Where an exact-text test differs only in a blank line or indentation, fix the editor: the expected text is what `dotnet sln` would leave.

- [ ] **Step 5: `.slnx` in `Solution` and the fixture**

In `Solution.moveToSolutionFolder` replace the Task 3 placeholders with the `SolutionXFileEditor.moveFile` / `moveProject` / `moveFolder` calls shown in Task 3, Step 4.

`src/__fixtures__/solution-hierarchy/TestHierarchy.slnx` (the same solution):

```xml
<Solution>
  <Configurations>
    <BuildType Name="Debug" />
    <BuildType Name="Release" />
  </Configurations>
  <Folder Name="/Libraries/">
    <Project Path="lib/CoreLibrary/CoreLibrary.csproj" />
  </Folder>
  <Folder Name="/Libraries/Shared/">
    <Project Path="lib/Utils/Utils.csproj" />
  </Folder>
  <Folder Name="/Tools/" />
  <Folder Name="/Web Projects/">
    <File Path="README.md" />
    <Project Path="src/WebApi/WebApi.csproj" />
    <Project Path="src/WebApp/WebApp.csproj" />
  </Folder>
  <Folder Name="/Web Projects/Shared/" />
  <Project Path="standalone/StandaloneProject.csproj" />
</Solution>
```

In `Solution.moveToSolutionFolder.test.ts` add the variant `['.slnx', 'TestHierarchy.slnx', text => text]` to `variants`, and an `else` to the `if (isSln)` blocks:
- project into a folder: `expect(text()).toContain('  <Folder Name="/Tools/">\n    <Project Path="src/WebApp/WebApp.csproj" />\n  </Folder>\n');`
- project to the root: `expect(text()).toContain('  <Folder Name="/Libraries/" />\n');` and `expect(text()).toContain('  <Project Path="standalone/StandaloneProject.csproj" />\n  <Project Path="lib/CoreLibrary/CoreLibrary.csproj" />\n</Solution>');`
- solution item: `expect(text()).toContain('  <Folder Name="/Tools/">\n    <File Path="README.md" />\n  </Folder>\n');`
and in the two solution-folder tests (no format block there yet) add `if (!isSln) expect(text()).toContain('<Folder Name="/Tools/Shared/">');` and `… '<Folder Name="/Shared/">'` respectively.

- [ ] **Step 6: Run to verify it passes**

Run: `npx jest src/test/unit/core/Solution.moveToSolutionFolder.test.ts src/test/unit/parsers src/test/unit/core/Solution.solutionFolders.test.ts`
Expected: PASS for all three variants.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck && npx jest src/test/unit/core src/test/unit/parsers src/parsers
git add src/parsers/solutionXFileEditor.ts src/core/Solution.ts src/__fixtures__/solution-hierarchy/TestHierarchy.slnx src/test/unit/parsers/solutionXFileEditor.test.ts src/test/unit/core/Solution.moveToSolutionFolder.test.ts
git commit -m "Drag & drop: move projects, solution folders and solution items in .slnx files

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `moveNodes` in the extension host

**Files:**
- Create: `src/services/solutionDropNodes.ts`
- Modify: `src/services/solutionActionService.ts`, `src/types/commands/backend.ts`, `src/webview/providers/SolutionWebviewProvider.ts`
- Test: `src/test/unit/services/moveNodes.test.ts`

The extension never trusts the webview's verdict: it makes the rule nodes from the solution (paths, solution folders, `NestedProjects`), runs `canDrop` again and only then moves.

- [ ] **Step 1: Write the failing tests**

```ts
// Drag & drop in the extension host: SolutionActionService.moveNodes on a copy of src/__fixtures__/solution-hierarchy
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ui = {
    answers: [] as (string | undefined)[],
    questions: [] as string[],
    warnings: [] as string[],
    errors: [] as string[],
};

jest.mock('vscode', () => {
    // As in namespaceAfterMove.test.ts, plus the warnings
    const disposable = { dispose: () => { } };
    const watcher = { onDidChange: () => disposable, onDidCreate: () => disposable, onDidDelete: () => disposable, dispose: () => { } };
    class EventEmitter { event = () => disposable; fire() { } dispose() { } }
    const nodeFs = require('fs');
    const ask = async (message: string, ...rest: unknown[]) => {
        if (!rest.some(item => typeof item === 'string')) {
            return undefined;
        }
        ui.questions.push(message);
        return ui.answers.shift();
    };
    return {
        EventEmitter,
        Position: class { constructor(public line: number, public character: number) { } },
        RelativePattern: class { constructor(public base: string, public pattern: string) { } },
        Uri: { file: (p: string) => ({ fsPath: p }) },
        FileType: { File: 1, Directory: 2 },
        workspace: {
            createFileSystemWatcher: () => watcher,
            workspaceFolders: undefined,
            getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
            openTextDocument: async () => { throw new Error('no editor in unit tests'); },
            fs: {
                stat: async (uri: any) => ({ type: nodeFs.statSync(uri.fsPath).isDirectory() ? 2 : 1 }),
                rename: async (from: any, to: any) => nodeFs.renameSync(from.fsPath, to.fsPath),
                copy: async (from: any, to: any) => nodeFs.cpSync(from.fsPath, to.fsPath, { recursive: true }),
            },
        },
        window: {
            showInformationMessage: ask,
            showWarningMessage: async (message: string, ...rest: unknown[]) => { ui.warnings.push(message); return ask(message, ...rest); },
            showErrorMessage: async (message: string) => { ui.errors.push(message); },
        },
        commands: { executeCommand: async () => undefined },
    };
}, { virtual: true });

jest.mock('../../../core/constants', () => ({
    ...jest.requireActual('../../../core/constants'),
    isSystemPath: () => false,
}));

import { Solution } from '../../../core/Solution';
import { SolutionService } from '../../../services/solutionService';
import { SolutionActionService } from '../../../services/solutionActionService';
import { NodeIdService } from '../../../services/nodeIdService';
import { solutionDropNode } from '../../../services/solutionDropNodes';
import { ProjectItemsService } from '../../../services/projectItems/projectItemsService';

const fixture = path.join(__dirname, '../../../__fixtures__/solution-hierarchy');

describe('SolutionActionService.moveNodes (drag & drop)', () => {
    let dir: string;
    let solution: Solution;
    const at = (...parts: string[]) => path.join(dir, ...parts);
    const write = (content: string, ...parts: string[]) => {
        fs.mkdirSync(path.dirname(at(...parts)), { recursive: true });
        fs.writeFileSync(at(...parts), content);
        return at(...parts);
    };
    const guid = (...names: string[]) => solution.solutionFile!.projects
        .find(p => solution.isSolutionFolder(p) && solution.getSolutionFolderPath(p.guid) === names.join('/'))!.guid;
    const folderNode = (...names: string[]) => NodeIdService.generateSolutionFolderId(names[names.length - 1], solution.solutionPath, guid(...names), undefined);
    const projectNode = (...parts: string[]) => NodeIdService.generateProjectId(at(...parts));
    const fileNode = (...parts: string[]) => NodeIdService.generateFileId(at(...parts));
    const dirNode = (...parts: string[]) => NodeIdService.generateFolderId(at(...parts));
    const parentName = (name: string) => {
        const model = solution.solutionFile!;
        const child = model.projects.find(p => p.name === name)!;
        const parent = model.nestedProjects.find(n => n.childGuid === child.guid)?.parentGuid;
        return parent ? model.projects.find(p => p.guid === parent)!.name : 'root';
    };

    beforeEach(async () => {
        ui.answers = [];
        ui.questions = [];
        ui.warnings = [];
        ui.errors = [];
        jest.spyOn(ProjectItemsService.instance, 'evaluate').mockResolvedValue(undefined);
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-dnd-')));
        fs.cpSync(fixture, dir, { recursive: true });
        solution = new Solution(at('TestHierarchy.sln'));
        for (let i = 0; i < 100 && !solution.isInitialized; i++) await new Promise(r => setTimeout(r, 10));
        (SolutionService as any).activeSolution = solution;
    });

    afterEach(() => {
        (SolutionService as any).activeSolution = undefined;
        solution.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('the rule nodes come from the solution: a file has its folders, project, solution folders and the solution above it', () => {
        write('namespace Utils.Text;\n', 'lib', 'Utils', 'Text', 'Words.cs');

        expect(solutionDropNode(solution, fileNode('lib', 'Utils', 'Text', 'Words.cs'))!.ancestors.map(a => a.type))
            .toEqual(['folder', 'project', 'solutionFolder', 'solutionFolder', 'solution']);
    });

    test('moves a file into a folder of another project and asks once about its namespace', async () => {
        write('namespace CoreLibrary;\n\npublic class Helper { }\n', 'lib', 'CoreLibrary', 'Helper.cs');
        fs.mkdirSync(at('lib', 'Utils', 'Text'));
        ui.answers = ['Update Namespace'];

        await SolutionActionService.moveNodes([fileNode('lib', 'CoreLibrary', 'Helper.cs')], dirNode('lib', 'Utils', 'Text'), false);

        expect(fs.existsSync(at('lib', 'CoreLibrary', 'Helper.cs'))).toBe(false);
        expect(fs.readFileSync(at('lib', 'Utils', 'Text', 'Helper.cs'), 'utf8')).toContain('namespace Utils.Text;');
        expect(ui.questions).toHaveLength(1);
        expect(ui.errors).toEqual([]);
    });

    test('Ctrl copies: the file stays, and nothing is asked', async () => {
        write('namespace CoreLibrary;\n', 'lib', 'CoreLibrary', 'Helper.cs');

        await SolutionActionService.moveNodes([fileNode('lib', 'CoreLibrary', 'Helper.cs')], projectNode('lib', 'Utils', 'Utils.csproj'), true);

        expect(fs.existsSync(at('lib', 'CoreLibrary', 'Helper.cs'))).toBe(true);
        expect(fs.readFileSync(at('lib', 'Utils', 'Helper.cs'), 'utf8')).toBe('namespace CoreLibrary;\n');
        expect(ui.questions).toEqual([]);
    });

    test('a folder of C# files: one question for all of them', async () => {
        write('namespace CoreLibrary.Models;\n\npublic class A { }\n', 'lib', 'CoreLibrary', 'Models', 'A.cs');
        write('namespace CoreLibrary.Models;\n\npublic class B { }\n', 'lib', 'CoreLibrary', 'Models', 'B.cs');
        ui.answers = ['Update All'];

        await SolutionActionService.moveNodes([dirNode('lib', 'CoreLibrary', 'Models')], projectNode('lib', 'Utils', 'Utils.csproj'), false);

        expect(ui.questions).toHaveLength(1);
        for (const file of ['A.cs', 'B.cs']) {
            expect(fs.readFileSync(at('lib', 'Utils', 'Models', file), 'utf8')).toContain('namespace Utils.Models;');
        }
    });

    test('a file dropped on a file goes into that file\'s folder', async () => {
        write('namespace CoreLibrary;\n', 'lib', 'CoreLibrary', 'Helper.cs');
        write('namespace Utils.Text;\n', 'lib', 'Utils', 'Text', 'Words.cs');
        ui.answers = ['Skip'];

        await SolutionActionService.moveNodes([fileNode('lib', 'CoreLibrary', 'Helper.cs')], fileNode('lib', 'Utils', 'Text', 'Words.cs'), false);

        expect(fs.existsSync(at('lib', 'Utils', 'Text', 'Helper.cs'))).toBe(true);
    });

    test('refuses what the rules refuse, whatever the webview sent', async () => {
        write('namespace CoreLibrary.Models;\n', 'lib', 'CoreLibrary', 'Models', 'Sub', 'A.cs');

        await SolutionActionService.moveNodes([dirNode('lib', 'CoreLibrary', 'Models')], dirNode('lib', 'CoreLibrary', 'Models', 'Sub'), false);
        await SolutionActionService.moveNodes([NodeIdService.generateDependenciesId(at('lib', 'Utils', 'Utils.csproj'))], folderNode('Tools'), false);

        expect(fs.existsSync(at('lib', 'CoreLibrary', 'Models', 'Sub', 'A.cs'))).toBe(true);
        expect(ui.warnings).toEqual([expect.stringContaining('cannot be dropped there'), expect.stringContaining('cannot be dropped there')]);
    });

    test('several nodes: the project and the solution item go into the solution folder, the file stays', async () => {
        write('namespace CoreLibrary;\n', 'lib', 'CoreLibrary', 'Helper.cs');
        const readme = NodeIdService.generateSolutionItemId('README.md', guid('Web Projects'), at('README.md'));

        await SolutionActionService.moveNodes(
            [projectNode('src', 'WebApp', 'WebApp.csproj'), readme, fileNode('lib', 'CoreLibrary', 'Helper.cs')], folderNode('Tools'), false);

        expect(parentName('WebApp')).toBe('Tools');
        expect(solution.getSolutionItems(solution.solutionFile!.projects.find(p => p.name === 'Tools')!)).toEqual(['README.md']);
        expect(fs.existsSync(at('lib', 'CoreLibrary', 'Helper.cs'))).toBe(true);
        expect(ui.errors).toEqual([]);
    });

    test('a solution folder to the root, and a refused duplicate name shows the error', async () => {
        const folderPaths = () => solution.solutionFile!.projects.filter(p => solution.isSolutionFolder(p)).map(p => solution.getSolutionFolderPath(p.guid));
        await SolutionActionService.moveNodes([folderNode('Libraries', 'Shared')], NodeIdService.generateSolutionId(solution.solutionPath), false);
        expect(folderPaths()).toEqual(expect.arrayContaining(['Shared']));
        expect(folderPaths()).not.toContain('Libraries/Shared');

        await SolutionActionService.moveNodes([folderNode('Shared')], folderNode('Web Projects'), false);
        expect(ui.errors).toEqual([expect.stringContaining('already contains "Shared"')]);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/test/unit/services/moveNodes.test.ts`
Expected: FAIL (`Cannot find module '../../../services/solutionDropNodes'`).

- [ ] **Step 3: Implement `src/services/solutionDropNodes.ts`**

```ts
import * as path from 'path';
import { Solution } from '../core/Solution';
import { DropAncestor, DropNode } from '../core/dropRules';
import { SolutionFileParser } from '../parsers/solutionFileParser';
import { NodeId, NodeIdService } from './nodeIdService';
import { projectForPath } from './templates/templateService';
import { UnloadedProjects } from './unloadedProjects';
import { NodeIdString } from '../types/nodeId';

const sameGuid = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toUpperCase() === b.toUpperCase();
const samePath = (a: string, b: string) => process.platform === 'win32'
    ? path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase()
    : path.normalize(a) === path.normalize(b);

/**
 * The drop rules' view of a node, made from the solution itself (paths, solution folders, NestedProjects) rather
 * than from the webview's tree, so a drop is checked against what is there. Ids are generated here for every node
 * alike (the rules only compare them; GUIDs upper-cased). Undefined for ids that do not parse and for nodes outside
 * the solution, such as linked files, which lie outside every project folder.
 */
export function solutionDropNode(solution: Solution, nodeIdString: NodeIdString): DropNode | undefined {
    const model = solution.solutionFile;
    let node: NodeId;
    try {
        node = NodeIdService.parse(nodeIdString);
    } catch {
        return undefined;
    }
    if (!model) {
        return undefined;
    }
    const solutionDir = path.dirname(solution.solutionPath);
    const parentGuidOf = (guid: string | undefined) => guid ? model.nestedProjects.find(n => sameGuid(n.childGuid, guid))?.parentGuid : undefined;
    const solutionFolder = (guid: string): DropAncestor | undefined => {
        const folder = model.projects.find(p => sameGuid(p.guid, guid) && SolutionFileParser.isSolutionFolder(p));
        return folder && {
            nodeId: NodeIdService.generateSolutionFolderId(folder.name, solution.solutionPath, folder.guid.toUpperCase(), parentGuidOf(folder.guid)?.toUpperCase()),
            type: 'solutionFolder',
        };
    };
    const solutionNode: DropAncestor = { nodeId: NodeIdService.generateSolutionId(solution.solutionPath), type: 'solution' };
    /** The solution folders from `guid` up, then the solution */
    const chainFrom = (guid: string | undefined): DropAncestor[] => {
        const chain: DropAncestor[] = [];
        for (let current = guid, depth = 0; current && depth < 64; current = parentGuidOf(current), depth++) {
            const folder = solutionFolder(current);
            if (folder) {
                chain.push(folder);
            }
        }
        return [...chain, solutionNode];
    };
    const projectEntry = (projectPath: string) => model.projects.find(p =>
        !SolutionFileParser.isSolutionFolder(p) && samePath(path.resolve(solutionDir, p.path), projectPath));
    const projectId = (projectPath: string) => NodeIdService.generateProjectId(path.normalize(projectPath));

    switch (node.type) {
        case 'solution':
            return { ...solutionNode, ancestors: [] };
        case 'solutionFolder': {
            const self = solutionFolder(node.guid);
            return self && { ...self, ancestors: chainFrom(parentGuidOf(node.guid)) };
        }
        case 'solutionItem':
            return {
                nodeId: NodeIdService.generateSolutionItemId(node.name, node.guid.toUpperCase(), path.normalize(node.path)),
                type: 'solutionItem',
                ancestors: chainFrom(node.guid),
            };
        case 'project': {
            const entry = projectEntry(node.path);
            return entry && {
                nodeId: projectId(node.path),
                type: 'project',
                isUnloaded: UnloadedProjects.isUnloaded(solution.solutionPath, node.path),
                ancestors: chainFrom(parentGuidOf(entry.guid)),
            };
        }
        case 'file':
        case 'folder': {
            const projectPath = projectForPath(node.path);
            if (!projectPath) {
                return undefined;
            }
            const projectDir = path.dirname(projectPath);
            const folders: DropAncestor[] = [];
            for (let dir = path.dirname(path.normalize(node.path)); dir.length > projectDir.length && dir !== path.dirname(dir); dir = path.dirname(dir)) {
                folders.push({ nodeId: NodeIdService.generateFolderId(dir), type: 'folder' });
            }
            return {
                nodeId: node.type === 'file' ? NodeIdService.generateFileId(path.normalize(node.path)) : NodeIdService.generateFolderId(path.normalize(node.path)),
                type: node.type,
                ancestors: [...folders, { nodeId: projectId(projectPath), type: 'project' }, ...chainFrom(parentGuidOf(projectEntry(projectPath)?.guid))],
            };
        }
        default:
            // Dependencies, analyzers, generated files and the like: no move and no target
            return { nodeId: nodeIdString, type: node.type, ancestors: [] };
    }
}
```

- [ ] **Step 4: `SolutionActionService.moveNodes`**

In `src/services/solutionActionService.ts` add the imports

```ts
import { canDrop, DropNode } from '../core/dropRules';
import { solutionDropNode } from './solutionDropNodes';
```
and, after `handleMultiAction`:

```ts
    /**
     * Drag & drop in the tree. Checks the drop again (the webview is not trusted), then moves or copies files and
     * folders through the paste path, with one namespace question for what was moved, and moves projects, solution
     * folders and solution items in the solution file.
     */
    static async moveNodes(nodeIdStrings: readonly NodeIdString[], targetNodeIdString: NodeIdString, copy: boolean): Promise<void> {
        const solution = SolutionService.getActiveSolution();
        if (!solution) {
            return;
        }
        const target = solutionDropNode(solution, targetNodeIdString);
        const dragged = nodeIdStrings.map(id => solutionDropNode(solution, id)).filter((node): node is DropNode => !!node);
        const verdict = target ? canDrop(dragged, target, copy) : undefined;
        if (!verdict?.container || verdict.nodes.length === 0) {
            vscode.window.showWarningMessage('The items cannot be dropped there.');
            return;
        }
        try {
            const container = NodeIdService.parse(verdict.container.nodeId);
            const files = verdict.nodes.filter(node => node.type === 'file' || node.type === 'folder');
            if (files.length > 0) {
                const directory = container.type === 'project' ? path.dirname(container.path) : container.path;
                const operation = verdict.effect === 'copy' ? 'copy' : 'cut';
                const moved: string[] = [];
                for (const node of files) {
                    const destination = await this._pasteOne(NodeIdService.parse(node.nodeId).path, directory, operation);
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
                } else if (id.type === 'solutionFolder') {
                    await solution.moveToSolutionFolder({ kind: 'solutionFolder', folderGuid: id.guid }, targetFolderGuid);
                } else if (id.type === 'solutionItem') {
                    await solution.moveToSolutionFolder({ kind: 'solutionItem', filePath: id.path, folderGuid: id.guid }, targetFolderGuid);
                }
            }
        } catch (error) {
            log.error('Drop failed:', error);
            vscode.window.showErrorMessage(`Could not move: ${error instanceof Error ? error.message : error}`);
        }
    }
```
(A verdict never mixes files with solution nodes: they fit different targets. Both loops stay simple anyway.)

- [ ] **Step 5: The message and its routing**

`src/types/commands/backend.ts`, after `TreeSelectionChangedCmd`:

```ts
/** Drag & drop in the tree: the dragged nodes that fit the target; the extension checks the drop again */
export declare type MoveNodesCmd = {
    readonly type: 'moveNodes',
    readonly payload: {
        readonly nodeIds: NodeIdString[],
        readonly targetNodeId: NodeIdString,
        /** Ctrl (Cmd on macOS) was held over files and folders */
        readonly copy: boolean
    }
}
```
and `| MoveNodesCmd` at the end of the `BackendCmd` union.

`src/webview/providers/SolutionWebviewProvider.ts`, in `_handleMessage` after `case 'treeFocusChanged': … break;`:

```ts
            case 'moveNodes': {
                const { nodeIds, targetNodeId, copy } = message.payload;
                await SolutionActionService.moveNodes(nodeIds, targetNodeId, copy);
                // Solution nodes change the solution file, files and folders the disk: refresh both ways, like the other operations
                const solution = SolutionService.getActiveSolution();
                if (solution) {
                    this.handleFileChange(solution.solutionPath, 'changed');
                }
                await this._triggerImmediateTreeRefresh(`drop of ${nodeIds.length} node(s)`);
                break;
            }
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx jest src/test/unit/services/moveNodes.test.ts src/test/unit/services/namespaceAfterMove.test.ts src/test/unit/core`
Expected: PASS. The provider routing has no unit test (no test builds `SolutionWebviewProvider`); it is covered by the manual checks of Task 6.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck && npm test
git add src/services/solutionDropNodes.ts src/services/solutionActionService.ts src/types/commands/backend.ts src/webview/providers/SolutionWebviewProvider.ts src/test/unit/services/moveNodes.test.ts
git commit -m "Drag & drop: moveNodes checks the drop again and moves files, folders and solution nodes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Dragging in the tree, docs, GIF and manual checks

**Files:**
- Modify: `src/webview/solution-view/components/SolutionTree.tsx`, `src/webview/solution-view/components/TreeNode/TreeNode.tsx`, `src/webview/solution-view/types/index.ts`, `src/webview/providers/views/SolutionWebview.ts`
- Modify: `docs/solution-explorer.md`, `docs/manual-testing.md`, `scripts/screenshots/capture.sh`, `README.md`
- Create: `docs/images/drag-and-drop.gif`
- Test: `src/test/unit/webview/solution-view/components/SolutionTreeDragDrop.test.tsx`

`SolutionTree` owns the drag (what is dragged, the highlighted row, the auto-expand timer); `TreeNode` only reports its row's events. jsdom has no `DragEvent`, so the test creates the events with `createEvent` and sets `ctrlKey` by hand; `dataTransfer` is a plain object (Testing Library assigns it to the event).

- [ ] **Step 1: Write the failing tests**

```tsx
import { act, createEvent, fireEvent, render } from '@testing-library/react';

const sent: any[] = [];
jest.mock('../../../../../webview/nuget-view/shared', () => ({
    ...jest.requireActual('../../../../../webview/nuget-view/shared'),
    sendToBackend: (message: unknown) => sent.push(message),
}));

import { DRAG_DATA_TYPE, SolutionTree } from '../../../../../webview/solution-view/components/SolutionTree';
import { NodeIdString } from '../../../../../types/nodeId';
import { ProjectNode } from '../../../../../types';

const node = (type: ProjectNode['type'], name: string, children?: ProjectNode[], extra: Partial<ProjectNode> = {}): ProjectNode =>
    ({ type, name, nodeId: name as NodeIdString, children, ...extra });

const projects: ProjectNode[] = [node('solution', 'App', [
    node('solutionFolder', 'Tools', []),
    node('project', 'Api', [
        node('dependencies', 'Dependencies', undefined, { hasChildren: true }),
        node('folder', 'Controllers', [node('file', 'C.cs')], { expanded: true }),
        node('folder', 'Models', undefined, { hasChildren: true }),
        node('file', 'A.cs'),
        node('file', 'B.cs'),
    ], { expanded: true }),
], { expanded: true })];

describe('SolutionTree drag & drop', () => {
    beforeEach(() => { sent.length = 0; });

    const setup = () => {
        const onExpandNode = jest.fn();
        const { container } = render(<SolutionTree projects={projects} onProjectAction={() => { }} onExpandNode={onExpandNode} />);
        const row = (name: string) => [...container.querySelectorAll('.tree-node')].find(el => el.textContent === name)!;
        const data: Record<string, string> = {};
        const transfer = {
            data,
            setData: (type: string, value: string) => { data[type] = value; },
            getData: (type: string) => data[type] ?? '',
            effectAllowed: 'uninitialized',
            dropEffect: 'none',
            types: [] as string[],
        };
        const drag = (type: 'dragStart' | 'dragOver' | 'drop' | 'dragEnd', name: string, ctrlKey = false) => {
            const target = row(name);
            const event = createEvent[type](target, { dataTransfer: transfer });
            // jsdom has no DragEvent: the modifier keys are set by hand
            Object.defineProperty(event, 'ctrlKey', { value: ctrlKey });
            fireEvent(target, event);
            return event;
        };
        const moves = () => sent.filter(m => m.type === 'moveNodes').map(m => m.payload);
        const highlighted = () => [...container.querySelectorAll('.tree-node.drop-target')].map(el => el.textContent);
        return { row, drag, transfer, moves, highlighted, onExpandNode };
    };

    it('rows with a move are draggable, the others are not', () => {
        const { row } = setup();
        expect(row('A.cs').getAttribute('draggable')).toBe('true');
        expect(row('Api').getAttribute('draggable')).toBe('true');
        expect(row('Dependencies').getAttribute('draggable')).toBe('false');
        expect(row('App').getAttribute('draggable')).toBe('false');
    });

    it('drags the selected nodes, or only the row when it is not selected', () => {
        const { row, drag, transfer, moves } = setup();
        fireEvent.click(row('A.cs'), { ctrlKey: true });
        fireEvent.click(row('B.cs'), { ctrlKey: true });

        drag('dragStart', 'A.cs');
        expect(transfer.effectAllowed).toBe('copyMove');
        expect(JSON.parse(transfer.data[DRAG_DATA_TYPE])).toEqual(['A.cs', 'B.cs']);
        drag('dragOver', 'Controllers');
        drag('drop', 'Controllers');
        expect(moves()).toEqual([{ nodeIds: ['A.cs', 'B.cs'], targetNodeId: 'Controllers', copy: false }]);

        drag('dragStart', 'C.cs');
        drag('drop', 'Api');
        expect(moves()[1]).toEqual({ nodeIds: ['C.cs'], targetNodeId: 'Api', copy: false });
    });

    it('highlights a valid target and takes the drop; an invalid one keeps the not-allowed cursor', () => {
        const { drag, transfer, highlighted, moves } = setup();
        drag('dragStart', 'A.cs');
        const valid = drag('dragOver', 'Controllers');
        expect(valid.defaultPrevented).toBe(true);
        expect(transfer.dropEffect).toBe('move');
        expect(highlighted()).toEqual(['Controllers']);

        const invalid = drag('dragOver', 'Tools');
        expect(invalid.defaultPrevented).toBe(false);
        expect(highlighted()).toEqual([]);
        drag('drop', 'Tools');
        expect(moves()).toEqual([]);
    });

    it('Ctrl copies files and folders; projects are moved anyway', () => {
        const { drag, transfer, moves } = setup();
        drag('dragStart', 'A.cs');
        drag('dragOver', 'Controllers', true);
        expect(transfer.dropEffect).toBe('copy');
        drag('drop', 'Controllers', true);
        expect(moves()).toEqual([{ nodeIds: ['A.cs'], targetNodeId: 'Controllers', copy: true }]);

        drag('dragStart', 'Api');
        drag('dragOver', 'Tools', true);
        expect(transfer.dropEffect).toBe('move');
    });

    it('hovering a collapsed folder for a moment expands it', () => {
        jest.useFakeTimers();
        try {
            const { drag, onExpandNode } = setup();
            drag('dragStart', 'A.cs');
            drag('dragOver', 'Models');
            act(() => { jest.advanceTimersByTime(400); });
            // dragover repeats while the pointer rests: the timer keeps running
            drag('dragOver', 'Models');
            act(() => { jest.advanceTimersByTime(200); });
            expect(onExpandNode).not.toHaveBeenCalled();
            act(() => { jest.advanceTimersByTime(200); });
            expect(onExpandNode).toHaveBeenCalledWith('Models');
        } finally {
            jest.useRealTimers();
        }
    });

    it('leaving the folder earlier does not expand it', () => {
        jest.useFakeTimers();
        try {
            const { drag, onExpandNode } = setup();
            drag('dragStart', 'A.cs');
            drag('dragOver', 'Models');
            act(() => { jest.advanceTimersByTime(300); });
            drag('dragOver', 'A.cs');
            act(() => { jest.advanceTimersByTime(1000); });
            expect(onExpandNode).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    it('nothing can be dragged while a name is being edited', () => {
        const { row } = setup();
        act(() => { window.dispatchEvent(new MessageEvent('message', { data: { type: 'startRename', payload: { nodeId: 'B.cs' } } })); });
        expect(row('A.cs').getAttribute('draggable')).toBe('false');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/test/unit/webview/solution-view/components/SolutionTreeDragDrop.test.tsx`
Expected: FAIL (`DRAG_DATA_TYPE` is not exported, rows have no `draggable`).

- [ ] **Step 3: Props for the row events**

`src/webview/solution-view/types/index.ts`: add `import type { DragEvent } from 'react';` at the top and, at the end of `TreeNodeProps`:

```ts
    /** Drag & drop (the tree decides what may go where): the row a drop would go into, and the row's drag events */
    dropTargetId?: NodeIdString;
    onNodeDragStart?: (nodeId: NodeIdString, e: DragEvent) => void;
    onNodeDragOver?: (nodeId: NodeIdString, e: DragEvent) => void;
    onNodeDrop?: (nodeId: NodeIdString, e: DragEvent) => void;
    onNodeDragEnd?: () => void;
```

- [ ] **Step 4: `TreeNode`**

In `TreeNode.tsx`: `import { isDraggable } from '../../../../core/dropRules';`; add `dropTargetId, onNodeDragStart, onNodeDragOver, onNodeDrop, onNodeDragEnd` to the destructured props; after `const isRenaming = …`:

```tsx
    // Nodes with a move can be dragged, not while a name is being edited (the input needs the mouse)
    const canDrag = isDraggable(node) && !renamingNodeId && !node.isLoading;
```
On the row `<div className={`tree-node …`}`: append `${dropTargetId === nodeIdentifier ? 'drop-target' : ''}` to the class template (keep the `itemState` part the project-items work added) and add

```tsx
                draggable={canDrag}
                onDragStart={e => onNodeDragStart?.(nodeIdentifier, e)}
                onDragOver={e => onNodeDragOver?.(nodeIdentifier, e)}
                onDrop={e => onNodeDrop?.(nodeIdentifier, e)}
                onDragEnd={() => onNodeDragEnd?.()}
```
(`onDragStart` stays on rows that cannot be dragged: an icon `<img>` inside starts a native image drag, which the tree cancels.) Pass `dropTargetId`, `onNodeDragStart`, `onNodeDragOver`, `onNodeDrop` and `onNodeDragEnd` on to the child `<TreeNode … />` with the other props.

- [ ] **Step 5: `SolutionTree`**

`SolutionTree.tsx`: `import { canDrop, dropNodeIndex, DropNode, isDraggable } from '../../../core/dropRules';` and, after `const log = logger('SolutionTree');`:

```tsx
/** The drag's data type; the tree keeps the dragged ids itself (a drag's data cannot be read during dragover) */
export const DRAG_DATA_TYPE = 'application/vnd.shinobi.solution-nodes';
/** Hovering a collapsed folder this long while dragging expands it, as in Visual Studio */
const AUTO_EXPAND_DELAY_MS = 700;
```
After `const flatNodes = …` (the hooks need `treeNodes`):

```tsx
    // Drag & drop
    const draggedIds = useRef<NodeIdString[]>([]);
    const [dropTargetId, setDropTargetId] = useState<NodeIdString | undefined>();
    const expandTimer = useRef<{ nodeId: NodeIdString; timer: ReturnType<typeof setTimeout> } | undefined>(undefined);
    const dropNodes = React.useMemo(() => dropNodeIndex(treeNodes), [treeNodes]);

    const clearExpandTimer = () => {
        if (expandTimer.current) {
            clearTimeout(expandTimer.current.timer);
            expandTimer.current = undefined;
        }
    };
    useEffect(() => () => clearExpandTimer(), []);

    /** The rules' answer for what is dragged over `targetId`; undefined when nothing is dragged */
    const dropVerdict = (targetId: NodeIdString, copyKey: boolean) => {
        const target = dropNodes.get(targetId);
        const dragged = draggedIds.current.map(id => dropNodes.get(id)).filter((node): node is DropNode => !!node);
        return target && dragged.length > 0 ? canDrop(dragged, target, copyKey) : undefined;
    };

    const handleNodeDragStart = (nodeId: NodeIdString, e: React.DragEvent) => {
        // As for the context menu: a row outside the selection is dragged alone and becomes the selection
        const ids = (selectedNodeIds.has(nodeId) ? selection : [nodeId]).filter(id => {
            const node = dropNodes.get(id);
            return !!node && isDraggable(node);
        });
        if (renamingNodeId || ids.length === 0) {
            e.preventDefault();
            return;
        }
        if (!selectedNodeIds.has(nodeId)) {
            setSelectedNodeId(nodeId);
        }
        draggedIds.current = ids;
        e.dataTransfer.setData(DRAG_DATA_TYPE, JSON.stringify(ids));
        e.dataTransfer.effectAllowed = 'copyMove';
    };

    const handleNodeDragOver = (nodeId: NodeIdString, e: React.DragEvent) => {
        const verdict = dropVerdict(nodeId, e.ctrlKey || e.metaKey);
        if (!verdict || verdict.nodes.length === 0) {
            // No preventDefault: the pointer shows that the drop is not allowed
            setDropTargetId(undefined);
            clearExpandTimer();
            return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = verdict.effect;
        setDropTargetId(nodeId);
        const node = findNodeById(nodeId, treeNodes);
        if (!node || node.expanded || !(node.children?.length || node.hasChildren)) {
            clearExpandTimer();
        } else if (expandTimer.current?.nodeId !== nodeId) {
            clearExpandTimer();
            expandTimer.current = {
                nodeId,
                timer: setTimeout(() => {
                    expandTimer.current = undefined;
                    onExpandNode?.(nodeId);
                }, AUTO_EXPAND_DELAY_MS),
            };
        }
    };

    const endDrag = () => {
        draggedIds.current = [];
        setDropTargetId(undefined);
        clearExpandTimer();
    };

    const handleNodeDrop = (nodeId: NodeIdString, e: React.DragEvent) => {
        const verdict = dropVerdict(nodeId, e.ctrlKey || e.metaKey);
        if (verdict && verdict.nodes.length > 0) {
            e.preventDefault();
            sendToBackend({
                type: 'moveNodes',
                payload: { nodeIds: verdict.nodes.map(node => node.nodeId), targetNodeId: nodeId, copy: verdict.effect === 'copy' },
            });
        }
        endDrag();
    };
```
On the tree's root `<div ref={treeRef} className="solution-tree" …>` add

```tsx
            onDragLeave={e => {
                // Leaving the tree, not just moving from one row to the next
                if (!treeRef.current?.contains(e.relatedTarget as Node | null)) {
                    setDropTargetId(undefined);
                    clearExpandTimer();
                }
            }}
```
and pass to the root `<TreeNode … />`:

```tsx
                    dropTargetId={dropTargetId}
                    onNodeDragStart={handleNodeDragStart}
                    onNodeDragOver={handleNodeDragOver}
                    onNodeDrop={handleNodeDrop}
                    onNodeDragEnd={endDrag}
```

- [ ] **Step 6: The highlight style**

`src/webview/providers/views/SolutionWebview.ts`, after the `.tree-node.focused.selected` rule:

```css
                        /* Drag & drop: the row a drop goes into (VS Code's list drop colour) */
                        .tree-node.drop-target {
                            background-color: var(--vscode-list-dropBackground);
                        }
```

- [ ] **Step 7: Run the webview tests**

Run: `npx jest src/test/unit/webview src/test/unit/core/dropRules.test.ts`
Expected: PASS, including `opaqueNodeIds.test.ts` (no id is decoded) and the existing `TreeNode*`/`SolutionTree*` tests.

- [ ] **Step 8: Docs**

`docs/solution-explorer.md`: a new section after "## Keyboard" (before "## Dependencies"):

```markdown
## Drag and drop

Drag nodes to move them, as in Visual Studio. The row a drop would go into is highlighted; where a drop is not possible the pointer says so. Hovering a collapsed folder or solution folder for a moment opens it.

| Drag | Onto | Does | With Ctrl (macOS: Cmd) |
|---|---|---|---|
| Files, folders | A folder or a project; a file means the folder it is in | Moves them on disk, also to another project | Copies them |
| Projects | A solution folder, or the solution | Moves them in the solution file; the project stays where it is on disk | Moves |
| Solution folders | Another solution folder, or the solution; not into themselves | Moves them with everything in them | Moves |
| Solution items | Another solution folder | Moves the entry; the file stays where it is | Moves |

- With several nodes selected, all of them are dragged; those that cannot go onto the target stay where they are.
- Dependencies, packages, analyzers, generated files, linked files, unloaded projects and the solution itself cannot be dragged, and nothing can be dragged while a name is being edited.
- A file or folder whose name is taken in the target asks before replacing it, as Paste does. A project or solution folder whose name is taken in the target solution folder is not moved; a message says why.
- After moving C# files, one question offers to update their namespaces to the new folder: Update All, Review Each or Skip (a single file gets a question of its own). Files whose namespace already fits are not counted, and copies keep their namespaces. Cut and Paste and renaming a folder ask the same way.
- In a `.sln` file a move changes the `NestedProjects` lines (and the `SolutionItems` sections); in a `.slnx` file the `Name` of the moved solution folders and where the `<Project>` and `<File>` elements are. The rest of the file stays as it is.
- Files dropped from outside the tree (VS Code's Explorer, the file manager) are not taken, and dropping a project onto Dependencies adds no reference: use Add Project Reference...

![Dragging a file into a folder and a project into a solution folder](images/drag-and-drop.gif)
```
In the same file, the multi-select paragraph under "## Keyboard": after "Cut (Paste puts them all into the target)" add ", dragging moves them together".

`README.md` (store page), Solution Explorer paragraph: "Set the startup project, rename, cut/copy/paste, multi-select, …" becomes "Set the startup project, rename, cut/copy/paste, drag and drop, multi-select, …".

`docs/manual-testing.md`, before `## Bug fixes to confirm`:

```markdown
- [ ] Drag & drop of files (BasicsTestProject): drag a C# file onto a folder of another project: the pointer shows a move, the folder row is highlighted, the file moves and one question offers the new namespace; drop onto a file: it goes into that file's folder; hold Ctrl (macOS: Cmd) while dropping: the pointer shows a copy and the file is copied without a question; a folder with several C# files: one question (Update All / Review Each / Skip)
- [ ] Drag & drop refusals: a file over a solution folder, a folder over its own subfolder, anything over Dependencies show the not-allowed pointer and do nothing when dropped; Dependencies, a package, a generated file, a linked file and an unloaded project cannot be dragged at all; while renaming (F2) the mouse selects text in the name instead of dragging
- [ ] Drag & drop details: hovering a collapsed folder for about a second while dragging opens it; with three files selected (Ctrl+click) dragging one moves all three; dragging an unselected row moves only that row; the highlight is visible in Default Dark Modern and Default Light Modern
- [ ] Drag & drop of solution nodes on a `.sln` (copy of BasicsTestProject): a project into a solution folder, a solution folder with projects to the solution root, a solution item into another solution folder; `git diff` shows only the `NestedProjects` lines and the `SolutionItems` lines changed; the solution opens in Visual Studio 2022 with the same tree; a name taken in the target is refused with a message
- [ ] Drag & drop of solution nodes on a `.slnx` (the screenshot sample or a converted BasicsTestProject): the same moves; `git diff` keeps the rest of the file's formatting; `dotnet build` of the solution still works and Visual Studio 2022 17.13+ opens it with the same tree (moved `<Folder>` elements are not re-sorted: check that Visual Studio does not mind)
```

- [ ] **Step 9: The GIF scene**

In `scripts/screenshots/capture.sh`: add `gif-drag-and-drop` to the default `SCENES` list (keep every name already there, also ones the project-items work added), two helpers after `tree_select`:

```bash
# Rows of the tree are 20.6 px apart from y=81 (see project_y): the y of the row with the given index
row_y() { echo $(( 81 + $1 * 206 / 10 )); }
# Drags with the mouse in small steps (HTML5 drag & drop needs moves between press and release), resting on the target
drag() {
    xdotool mousemove "$1" "$2" mousedown 1; sleep 0.3
    local i; for i in 1 2 3 4 5 6 7 8; do xdotool mousemove $(( $1 + ($3 - $1) * i / 8 )) $(( $2 + ($4 - $2) * i / 8 )); sleep 0.1; done
    sleep "${5:-0.8}"; xdotool mouseup 1; sleep 1
}
```
and the scene before `echo "Done: $OUT"`:

```bash
if wants gif-drag-and-drop; then
    echo "Scene: gif-drag-and-drop"
    reset
    # In the work copy only (put back afterwards): a C# file at the top of Shop.Core to drag into Pricing, and a
    # solution folder "tools" to drag Shop.Generators into
    cat > "$SOLUTION/src/Shop.Core/Coupon.cs" <<'CS'
namespace Shop.Core;

public record Coupon(string Code, decimal Percent);
CS
    cp "$SOLUTION/Contoso.slnx" "$WORK/Contoso.slnx.orig"
    sed -i 's|^</Solution>|  <Folder Name="/tools/" />\n</Solution>|' "$SOLUTION/Contoso.slnx"
    sleep 3
    tree_focus; tree_open Contoso src Shop.Core
    # Rows now: 0 Contoso, 1 Solution Items, 2 src, 3 Shop.Core, 4 Dependencies, 5 Catalog, 6 Orders, 7 Pricing,
    # 8 Coupon.cs, 9 Shop.Generators, 10 Shop.Web, 11 Shop.Worker, 12 tests, 13 tools
    record_start
    pause 1
    # Coupon.cs onto Pricing; the namespace question's default button is Update Namespace
    drag 150 "$(row_y 8)" 150 "$(row_y 7)"; pause 2
    key Return; pause 3
    # Shop.Generators (now row 8: Coupon.cs left Shop.Core's top level) onto the tools solution folder (now row 12)
    drag 150 "$(row_y 8)" 150 "$(row_y 12)"; pause 3
    record_stop drag-and-drop
    command "File: Save All" 1
    cp "$WORK/Contoso.slnx.orig" "$SOLUTION/Contoso.slnx"
    rm -f "$SOLUTION/src/Shop.Core/Coupon.cs" "$SOLUTION/src/Shop.Core/Pricing/Coupon.cs"
    command "View: Close All Editors" 1
fi
```
Check the row indexes first with a still (`shot` after `tree_open`, e.g. temporarily `shot drag-check` and delete the PNG) and adjust the numbers; then record:

```bash
npm run build:dev; echo "exit $?"
SCENES=gif-drag-and-drop scripts/screenshots/capture.sh
```
The scene needs Xvfb, xdotool, ImageMagick and ffmpeg. If the environment cannot record, or Chromium does not start an HTML5 drag from xdotool's synthetic events, say so plainly in the final report so the user can record it, and leave the scene committed; the docs keep the image line.

- [ ] **Step 10: Verify**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
```
Expected: all tests pass (`webviewBundle.test.ts` builds the webview with `dropRules`), build exit code 0.

- [ ] **Step 11: Commit**

```bash
git add src/webview/solution-view/components/SolutionTree.tsx src/webview/solution-view/components/TreeNode/TreeNode.tsx src/webview/solution-view/types/index.ts src/webview/providers/views/SolutionWebview.ts src/test/unit/webview/solution-view/components/SolutionTreeDragDrop.test.tsx docs/solution-explorer.md docs/manual-testing.md README.md scripts/screenshots/capture.sh docs/images/drag-and-drop.gif
git commit -m "Solution Explorer: drag & drop of files, folders, projects, solution folders and solution items

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
(Leave `docs/images/drag-and-drop.gif` out of `git add` if it could not be recorded.)

---

### Task 7: Roadmap, history, final verification and push

**Files:**
- Modify: `docs/roadmap.md`, `docs/history.md`

- [ ] **Step 1: Is the rest of Phase 19 done?**

```bash
grep -n "Phase 19" -A9 docs/roadmap.md
ls docs/images/show-all-files.gif; git log --oneline --grep "Project items" | head -3
```
The two project-items entries ("The tree follows the project's items …", "Exclude From Project / Include In Project …") belong to the other agent's plan (`2026-10-21-project-items-model.md`, its Task 9 ticks them). If they are still unticked and that work is still going on (no `show-all-files.gif`, its plan tasks open), do Step 2 and Step 3 only for this plan's items, and leave Phase 19 in the roadmap: the move to the history then comes with the last project-items commit, using the text of Step 4. If that work is finished, tick its items too and do Step 4.

- [ ] **Step 2: Roadmap items**

In `docs/roadmap.md`, Phase 19: tick `- [x] Drag & drop of files, folders and projects`. Delete these four items from Phase 19:
- `Search in the Solution Explorer (Visual Studio's Ctrl+;)`
- `The diagnostic rules of each analyzer under Dependencies > Analyzers, like Visual Studio`
- `Project Properties: target framework, …`
- `Launch Profiles editor: …`

and add them to "## Not Planned" with their reasons:

```markdown
- Search in the Solution Explorer (Visual Studio's Ctrl+;): Ctrl+P and Sync with Active Document cover it; to be built if someone opens an issue for it
- The diagnostic rules of each analyzer under Dependencies > Analyzers: `.editorconfig` sets their severities
- Project Properties as a form and Visual Studio's Launch Profiles editor: Edit Project File covers the properties, and Open Launch Settings creates `launchSettings.json`, whose JSON schema helps with editing the profiles
```

- [ ] **Step 3: Known limitations**

Under "## Known limitations" add:

```markdown
- [ ] Drag & drop works within the Solution Explorer only: files dropped from VS Code's Explorer or the file manager are not taken (a webview gets no file paths from such drops)
- [ ] Dropping a project onto another project's Dependencies does not add a project reference; use Add Project Reference...
```

- [ ] **Step 4: Phase 19 to the history (only when all of it is done, see Step 1)**

Remove "## Phase 19: Solution Explorer, Part 2" from `docs/roadmap.md` and append to `docs/history.md` after Phase 18, in the form of the other finished phases (ticked items with a note on how, then plain lines for decisions):

```markdown
## Phase 19: Solution Explorer, Part 2
**Goal**: The second round for the Solution Explorer: the tree shows what the projects contain, and nodes move by dragging.

- [x] The tree follows the project's items like Visual Studio: `dotnet msbuild -getItem` per project (cached, evaluated again when the project or a `Directory.Build.*` file changes) is laid over the disk listing; `<Compile Remove>` / `DefaultItemExcludes` hide files, linked files appear under their link path with a link badge; Show All Files (title bar, remembered per solution) shows the excluded files and `bin`/`obj` greyed out. Without the .NET SDK the tree shows the disk
- [x] Exclude From Project / Include In Project on files and folders of SDK-style projects: writes or deletes `Remove` items (`Dir\**` for folders, per item type) and `Include` items for files left out by the defaults; warns when other items still decide it
- [x] Drag & drop like Visual Studio: files and folders into folders and projects (Ctrl/Cmd copies), projects and solution folders into solution folders or to the root, solution items between solution folders, several selected nodes at once; the webview and the extension check the same rules (`core/dropRules.ts`: node types and parent chains of opaque ids; the extension builds them again from the solution). `.sln` moves change `NestedProjects` and `SolutionItems` lines, `.slnx` moves rename folder `Name`s and move `<Project>`/`<File>` elements, keeping the formatting. Moved C# files get one namespace question per drop (Update All / Review Each / Skip), and Cut/Paste and folder renames now ask the same way. Drops from outside the tree and project-reference drops are not supported (Known limitations)
- Decided against: search in the Solution Explorer, the analyzers' rule lists, a Project Properties form and a Launch Profiles editor (see Not Planned in the roadmap)
```
Check the first two items against `docs/solution-explorer.md` ("Show All Files and linked files") and correct them where the shipped behaviour differs.

Then the roadmap's intro paragraph: "Phases 1–18 are done (see [History](history.md)): …, code cleanup and refactoring, and the second round for run & debug. Phases 19–21 are the second round for the Solution Explorer, NuGet and connected services, …" becomes

```markdown
Ordered by what is needed to drop Visual Studio for daily work. Phases 1–19 are done (see [History](history.md)): web apps, SOAP clients, templates, tests, private feeds, the Visual Studio basics, publishing, readiness for others, solutions, projects and configurations, code cleanup and refactoring, and the second rounds for run & debug and for the Solution Explorer. Phases 20–21 are the second round for NuGet and connected services, phase 30 what may come later, phase 31 the other publish targets.
```

- [ ] **Step 5: Final verification and push**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git status --short
git add docs/roadmap.md docs/history.md
git commit -m "Phase 19: drag & drop done; search, analyzer rules, Project Properties and Launch Profiles editor not planned

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push origin master
```
Expected: exit 0 and a clean tree (apart from the older untracked plan files and the other agent's work in progress, which this plan does not add). After the push check that the GitHub pipeline is green, Windows included: `gh run list --limit 1`, then `gh run watch` while it runs. Windows watch-outs: test paths are built with `path.join`; `solutionDropNode` compares paths case-insensitively on `win32`; the `.sln` fixture is LF in the working tree (`.gitattributes`), and the CRLF variant is made by the test.

---

## Self-review (done while writing)

- **Spec coverage:** the rules table, multi-select filtering, self/descendant cycles and same-place no-ops (Task 1); `dropRules` shared, browser-safe and re-run by the extension with its own nodes (Tasks 1, 5); webview: draggable rows, selection drag, `copyMove`, highlight and not-allowed, Ctrl/Cmd copy for files and folders only, ~700 ms auto-expand, `moveNodes` message, no drag while renaming (Task 6); extension: `moveNodes`, decode and re-validate, `_pasteOne` for files and folders (file target = its folder, project target = its folder), `Solution.moveToSolutionFolder` for solution nodes, errors as messages, refresh through the provider (Tasks 3–5); namespaces: moves only, files of moved folders, one question with Update All / Review Each / Skip, single-file question, matching files not counted, shared with Cut/Paste (Task 2); `.sln` `NestedProjects` and `SolutionItems`, `.slnx` folder renames and element moves keeping formatting, duplicate names refused (Tasks 3–4); tests on the `solution-hierarchy` fixture, temp-folder file moves, webview drag tests, bundle test (every task); docs page with the table, GIF scene, manual checks, roadmap tick and Known limitations (Tasks 6–7). Not doing (outside drops, reference drops, reordering, undo): nothing planned, the first two are recorded as limitations.
- **Placeholders:** none in code. Things that depend on the running app are named as checks, not guessed: the GIF's row indexes (checked with a still first), whether xdotool's synthetic drag starts an HTML5 drag in Chromium, whether Visual Studio accepts unsorted `.slnx` folder elements (manual check). Task 7 Step 1 decides between finishing Phase 19 and leaving it for the project-items work, from the repository's state at that time.
- **Type consistency:** `DropNode`/`DropAncestor`/`DropVerdict`/`canDrop(dragged, target, copyKey)`/`isDraggable`/`dropNodeIndex` (Task 1) are used unchanged in Tasks 5–6; `SolutionNodeMove` and `moveToSolutionFolder(node, targetFolderGuid)` (Task 3) are what `moveNodes` calls (Task 5); `SolutionXFileEditor.moveProject(content, projectPath, targetSegments)`, `moveFolder(content, segments, targetSegments)`, `moveFile(content, fromSegments, filePath, toSegments)` (Task 4) match the calls written in Task 3; `_pasteOne` returns `Promise<string | undefined>` from Task 2 on, which Task 5 relies on; `updateNamespacesAfterMove(movedPaths, operation)` (Task 2) is used by Paste, rename and `moveNodes`; `MoveNodesCmd` payload `{ nodeIds, targetNodeId, copy }` is what `SolutionTree` sends and the provider reads; `DRAG_DATA_TYPE` is exported for the test.
