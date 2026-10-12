# Phase 2: Build Tasks and Diagnostics Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Build, Rebuild, Clean and Restore as VS Code tasks with the `$msCompile` problem matcher, and mark files, folders, projects, solution folders and the solution in the Solution Explorer with their errors and warnings (infos opt-in).

**Architecture:**
- A `shinobi-dotnet` task provider builds `vscode.Task`s; the context-menu actions run those same tasks.
- `DiagnosticsService` turns `vscode.languages.getDiagnostics()` into per-file counts.
- A pure `computeMarkers` function rolls those counts up the `ProjectNode` tree the provider has already sent: path prefix for folders and projects, sum of children for solution folders, the solution and nested files.
- The provider sends the result as a separate `diagnostics` message, and the React webview only renders it.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`), VS Code extension API (`tasks`, `languages`), React, Jest (jsdom) with `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-10-12-phase2-diagnostics-design.md`

**Workflow:** Commit straight to `master` (no branches). End every commit message with:
```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

## File Structure

| File | Responsibility |
|---|---|
| `src/types/index.ts` (modify) | `DiagnosticCounts`, `NodeMarker`, `DiagnosticMarkers` types, shared by the extension and the webview |
| `src/types/commands/ui.ts` (modify) | `DiagnosticsCmd` UI message |
| `src/services/diagnosticsRollup.ts` (create) | Pure: `normalizePath`, `computeMarkers(nodes, fileCounts)` |
| `src/services/diagnosticsService.ts` (create) | `countDiagnostics(...)` (dedup, severity filter) and the `DiagnosticsService` class (listener, debounce, setting) |
| `src/services/dotnetTaskProvider.ts` (create) | `DOTNET_TASK_TYPE`, `dotnetTaskArgs`, `createDotnetTask`, `DotnetTaskProvider` |
| `src/services/solutionActionService.ts` (modify) | Build/Rebuild/Clean/Restore and Restore Dependencies run tasks instead of terminals |
| `src/webview/providers/SolutionWebviewProvider.ts` (modify) | Receives `DiagnosticsService`, sends `diagnostics` after `solutionData` and on change |
| `src/extension.ts` (modify) | Creates `DiagnosticsService`, registers the task provider |
| `package.json` (modify) | `taskDefinitions`, setting `shinobi.solutionExplorer.diagnostics.showInfos` |
| `src/webview/solution-view/components/TreeNode/diagnosticMarker.ts` (create) | Browser-safe helpers `markerCount`, `describeMarker` |
| `src/webview/solution-view/hooks/useVsCodeApi.ts`, `App.tsx`, `components/SolutionTree.tsx`, `components/TreeNode/TreeNode.tsx`, `types/index.ts` (modify) | Keep markers in state, pass them down, render them |
| `src/webview/providers/views/SolutionWebview.ts` (modify) | CSS for marker colours, badge and dot |
| `README.md` (modify) | Tick off Phase 2, document the behaviour |

Tests:
- `src/test/unit/services/diagnosticsRollup.test.ts`
- `src/test/unit/services/diagnosticsService.test.ts`
- `src/test/unit/services/dotnetTaskProvider.test.ts`
- `src/test/unit/webview/solution-view/components/TreeNodeDiagnostics.test.tsx`

---

### Task 1: Shared marker types

**Files:**
- Modify: `src/types/index.ts` (append after `SolutionData`)
- Modify: `src/types/commands/ui.ts` (new command type and `UICmd` union)

- [ ] **Step 1: Add the types to `src/types/index.ts`**

Append after the `SolutionData` interface:

```ts
/** Diagnostic counts of a file, or rolled up for a tree node */
export interface DiagnosticCounts {
    readonly errors: number;
    readonly warnings: number;
    readonly infos: number;
}

/** Error/warning/info marker of a Solution Explorer node; `severity` is the most severe non-zero count */
export interface NodeMarker extends DiagnosticCounts {
    readonly severity: 'error' | 'warning' | 'info';
}

/** Markers keyed by node ID; nodes without diagnostics are absent */
export type DiagnosticMarkers = Readonly<Record<NodeIdString, NodeMarker>>;
```

`NodeIdString` is already imported in that file (`import { NodeIdString } from "./nodeId";`).

- [ ] **Step 2: Add the UI message to `src/types/commands/ui.ts`**

Add after `StartRenameCmd`:

```ts
export declare type DiagnosticsCmd = {
    readonly type: 'diagnostics',
    readonly payload: {
        readonly markers: DiagnosticMarkers,
    }
}
```

Append ` |\n    DiagnosticsCmd` to the end of the `UICmd` union (after `StartRenameCmd`), and extend the first import of the file to `import { DiagnosticMarkers, NodeType, ProjectNode } from ".."`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/types/commands/ui.ts
git commit -m "types: diagnostic markers and the diagnostics UI message"
```

---

### Task 2: Rollup (`computeMarkers`)

**Files:**
- Create: `src/services/diagnosticsRollup.ts`
- Test: `src/test/unit/services/diagnosticsRollup.test.ts`

Node IDs are gzip-encoded JSON objects (`NodeIdService.generate*`). The rollup decodes them with `NodeIdService.parse`:
- `project` ids carry the `.csproj` path; its directory is the project directory.
- `folder` and `file` ids carry absolute paths.
- `solutionItem` ids carry the absolute item path.
- `solutionFolder` and `solution` nodes are always fully present in the tree (built eagerly in `solutionTreeService.ts`), so summing their children is complete.
- Folders and projects may be collapsed or not yet loaded, so they use a path-prefix sum over the file counts instead.

- [ ] **Step 1: Write the failing test**

Create `src/test/unit/services/diagnosticsRollup.test.ts`:

```ts
import * as path from 'path';
import { computeMarkers, normalizePath } from '../../../services/diagnosticsRollup';
import { NodeIdService } from '../../../services/nodeIdService';
import { DiagnosticCounts, ProjectNode } from '../../../types';

const root = path.resolve('/repo');
const p = (...parts: string[]) => path.join(root, ...parts);

const counts = (errors: number, warnings: number, infos = 0): DiagnosticCounts => ({ errors, warnings, infos });
const fileCounts = (entries: Record<string, DiagnosticCounts>) =>
    new Map(Object.entries(entries).map(([file, c]) => [normalizePath(file), c]));

const file = (filePath: string, children?: ProjectNode[]): ProjectNode => ({
    type: 'file', name: path.basename(filePath), nodeId: NodeIdService.generateFileId(filePath), children,
});
const folder = (folderPath: string, children?: ProjectNode[]): ProjectNode => ({
    type: 'folder', name: path.basename(folderPath), nodeId: NodeIdService.generateFolderId(folderPath), children,
});
const project = (projectPath: string, children?: ProjectNode[]): ProjectNode => ({
    type: 'project', name: path.basename(projectPath), nodeId: NodeIdService.generateProjectId(projectPath), children,
});
const solutionFolder = (name: string, children: ProjectNode[]): ProjectNode => ({
    type: 'solutionFolder', name,
    nodeId: NodeIdService.generateSolutionFolderId(name, p('All.sln'), `guid-${name}`), children,
});
const solutionItem = (itemPath: string): ProjectNode => ({
    type: 'solutionItem', name: path.basename(itemPath),
    nodeId: NodeIdService.generateSolutionItemId(path.basename(itemPath), 'guid-items', itemPath),
});
const solution = (children: ProjectNode[]): ProjectNode => ({
    type: 'solution', name: 'All', nodeId: NodeIdService.generateSolutionId(p('All.sln')), children,
});

describe('computeMarkers', () => {
    test('marks a file with its own counts and picks the most severe state', () => {
        const program = file(p('Api', 'Program.cs'));
        const markers = computeMarkers([program], fileCounts({ [p('Api', 'Program.cs')]: counts(2, 3) }));
        expect(markers[program.nodeId]).toEqual({ severity: 'error', errors: 2, warnings: 3, infos: 0 });
    });

    test('leaves out nodes without diagnostics', () => {
        const program = file(p('Api', 'Program.cs'));
        expect(computeMarkers([program], fileCounts({}))).toEqual({});
    });

    test('uses warning and info severities when there are no errors', () => {
        const a = file(p('a.cs'));
        const b = file(p('b.cs'));
        const markers = computeMarkers([a, b], fileCounts({ [p('a.cs')]: counts(0, 1), [p('b.cs')]: counts(0, 0, 4) }));
        expect(markers[a.nodeId].severity).toBe('warning');
        expect(markers[b.nodeId]).toEqual({ severity: 'info', errors: 0, warnings: 0, infos: 4 });
    });

    test('a file includes its nested child files', () => {
        const designer = file(p('Api', 'Form1.Designer.cs'));
        const form = file(p('Api', 'Form1.cs'), [designer]);
        const markers = computeMarkers([form], fileCounts({ [p('Api', 'Form1.Designer.cs')]: counts(1, 0) }));
        expect(markers[form.nodeId]).toEqual({ severity: 'error', errors: 1, warnings: 0, infos: 0 });
        expect(markers[designer.nodeId].errors).toBe(1);
    });

    test('folders and projects sum every file below them, even when not loaded', () => {
        const controllers = folder(p('Api', 'Controllers')); // children never loaded
        const api = project(p('Api', 'Api.csproj'), [controllers]);
        const markers = computeMarkers([api], fileCounts({
            [p('Api', 'Controllers', 'Deep', 'UserController.cs')]: counts(1, 0),
            [p('Api', 'Program.cs')]: counts(0, 2),
        }));
        expect(markers[controllers.nodeId]).toEqual({ severity: 'error', errors: 1, warnings: 0, infos: 0 });
        expect(markers[api.nodeId]).toEqual({ severity: 'error', errors: 1, warnings: 2, infos: 0 });
    });

    test('a folder does not match a sibling that shares its name prefix', () => {
        const foo = folder(p('Api', 'Foo'));
        const markers = computeMarkers([foo], fileCounts({ [p('Api', 'FooBar', 'x.cs')]: counts(1, 0) }));
        expect(markers[foo.nodeId]).toBeUndefined();
    });

    test('solution folders and the solution sum their children', () => {
        const api = project(p('Api', 'Api.csproj'));
        const domain = project(p('Domain', 'Domain.csproj'));
        const readme = solutionItem(p('README.md'));
        const src = solutionFolder('src', [api, readme]);
        const sln = solution([src, domain]);
        const markers = computeMarkers([sln], fileCounts({
            [p('Api', 'Program.cs')]: counts(1, 0),
            [p('Domain', 'Order.cs')]: counts(0, 2),
            [p('README.md')]: counts(0, 1),
        }));
        expect(markers[readme.nodeId]).toEqual({ severity: 'warning', errors: 0, warnings: 1, infos: 0 });
        expect(markers[src.nodeId]).toEqual({ severity: 'error', errors: 1, warnings: 1, infos: 0 });
        expect(markers[sln.nodeId]).toEqual({ severity: 'error', errors: 1, warnings: 3, infos: 0 });
    });

    test('ignores node ids that cannot be decoded', () => {
        const broken: ProjectNode = { type: 'file', name: 'x', nodeId: 'not-a-node-id' as ProjectNode['nodeId'] };
        expect(computeMarkers([broken], fileCounts({}))).toEqual({});
    });
});

describe('normalizePath', () => {
    test('lower-cases on Windows only', () => {
        expect(normalizePath('C:\\Repo\\A.cs', 'win32')).toBe(path.normalize('C:\\Repo\\A.cs').toLowerCase());
        expect(normalizePath('/Repo/A.cs', 'linux')).toBe(path.normalize('/Repo/A.cs'));
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/test/unit/services/diagnosticsRollup.test.ts`
Expected: FAIL, `Cannot find module '../../../services/diagnosticsRollup'`.

- [ ] **Step 3: Implement `src/services/diagnosticsRollup.ts`**

```ts
import * as path from 'path';
import { NodeId, NodeIdService } from './nodeIdService';
import { DiagnosticCounts, DiagnosticMarkers, NodeMarker, ProjectNode } from '../types';
import { NodeIdString } from '../types/nodeId';

/** Per-file diagnostic counts, keyed by `normalizePath(filePath)` */
export type FileCounts = ReadonlyMap<string, DiagnosticCounts>;

const ZERO: DiagnosticCounts = { errors: 0, warnings: 0, infos: 0 };

/** Normalises a file path for use as a `FileCounts` key; Windows paths are case-insensitive */
export function normalizePath(filePath: string, platform: NodeJS.Platform = process.platform): string {
    const normalized = path.normalize(filePath);
    return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Rolls per-file diagnostic counts up the Solution Explorer tree.
 * Files include their nested child files, folders and projects sum every file below their
 * directory (so collapsed, unloaded nodes are covered), solution folders and the solution
 * sum their children.
 */
export function computeMarkers(nodes: readonly ProjectNode[], fileCounts: FileCounts): DiagnosticMarkers {
    const markers: Record<NodeIdString, NodeMarker> = {};
    for (const node of nodes) {
        visit(node, fileCounts, markers);
    }
    return markers;
}

function visit(node: ProjectNode, fileCounts: FileCounts, markers: Record<NodeIdString, NodeMarker>): DiagnosticCounts {
    const childSum = (node.children ?? [])
        .map(child => visit(child, fileCounts, markers))
        .reduce(add, ZERO);

    const counts = countsFor(parseNodeId(node.nodeId), childSum, fileCounts);
    const marker = toMarker(counts);
    if (marker) {
        markers[node.nodeId] = marker;
    }
    return counts;
}

function countsFor(nodeId: NodeId | undefined, childSum: DiagnosticCounts, fileCounts: FileCounts): DiagnosticCounts {
    switch (nodeId?.type) {
        case 'file':
        case 'solutionItem':
            return add(fileCounts.get(normalizePath(nodeId.path)) ?? ZERO, childSum);
        case 'folder':
            return sumUnder(nodeId.path, fileCounts);
        case 'project':
            return sumUnder(path.dirname(nodeId.path), fileCounts);
        case 'solutionFolder':
        case 'solution':
            return childSum;
        default:
            return ZERO;
    }
}

function parseNodeId(nodeId: NodeIdString): NodeId | undefined {
    try {
        return NodeIdService.parse(nodeId);
    } catch {
        return undefined;
    }
}

function sumUnder(directory: string, fileCounts: FileCounts): DiagnosticCounts {
    const prefix = normalizePath(directory + path.sep);
    let sum = ZERO;
    for (const [file, counts] of fileCounts) {
        if (file.startsWith(prefix)) {
            sum = add(sum, counts);
        }
    }
    return sum;
}

function add(a: DiagnosticCounts, b: DiagnosticCounts): DiagnosticCounts {
    return { errors: a.errors + b.errors, warnings: a.warnings + b.warnings, infos: a.infos + b.infos };
}

function toMarker(counts: DiagnosticCounts): NodeMarker | undefined {
    const severity = counts.errors ? 'error' : counts.warnings ? 'warning' : counts.infos ? 'info' : undefined;
    return severity && { severity, ...counts };
}
```

Note: `normalizePath(directory + path.sep)` keeps the trailing separator, because `path.normalize` preserves it. That's what makes `/Api/Foo/` not match `/Api/FooBar/x.cs`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/test/unit/services/diagnosticsRollup.test.ts`
Expected: PASS (all tests).

If `NodeIdService.parse` doesn't throw on `'not-a-node-id'` but returns garbage, the "cannot be decoded" test still passes, because `countsFor` hits `default`. Leave the try/catch in either way.

- [ ] **Step 5: Commit**

```bash
git add src/services/diagnosticsRollup.ts src/test/unit/services/diagnosticsRollup.test.ts
git commit -m "roll diagnostic counts up the solution tree"
```

---

### Task 3: Counting diagnostics (`countDiagnostics`, `DiagnosticsService`)

**Files:**
- Create: `src/services/diagnosticsService.ts`
- Test: `src/test/unit/services/diagnosticsService.test.ts`

Build output (`$msCompile`) and the C# language server report the same error with the same code and line. The `$msCompile` message, however, ends with the project in brackets: `The name 'x' does not exist in the current context [/repo/Api/Api.csproj]`. Strip that suffix before deduplicating.

- [ ] **Step 1: Write the failing test**

Create `src/test/unit/services/diagnosticsService.test.ts`:

```ts
jest.mock('vscode', () => ({
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
}), { virtual: true });

import { countDiagnostics } from '../../../services/diagnosticsService';
import { normalizePath } from '../../../services/diagnosticsRollup';

const Error = 0, Warning = 1, Information = 2, Hint = 3;

const uri = (fsPath: string, scheme = 'file') => ({ fsPath, scheme }) as any;
const diag = (severity: number, line: number, message: string, code?: string | { value: string }) =>
    ({ severity, message, code, range: { start: { line } } }) as any;

describe('countDiagnostics', () => {
    test('counts errors and warnings per file', () => {
        const result = countDiagnostics([
            [uri('/repo/A.cs'), [diag(Error, 1, 'e1', 'CS1'), diag(Warning, 2, 'w1', 'CS2'), diag(Warning, 3, 'w2', 'CS3')]],
        ], false);
        expect(result.get(normalizePath('/repo/A.cs'))).toEqual({ errors: 1, warnings: 2, infos: 0 });
    });

    test('deduplicates the same error from build output and the language server', () => {
        const result = countDiagnostics([
            [uri('/repo/A.cs'), [
                diag(Error, 4, "The name 'x' does not exist in the current context [/repo/Api/Api.csproj]", 'CS0103'),
                diag(Error, 4, "The name 'x' does not exist in the current context", { value: 'CS0103' }),
                diag(Error, 4, "The name 'x' does not exist in the current context [/repo/Api/Api.csproj]", 'CS0103'),
            ]],
        ], false);
        expect(result.get(normalizePath('/repo/A.cs'))).toEqual({ errors: 1, warnings: 0, infos: 0 });
    });

    test('keeps distinct diagnostics on the same line', () => {
        const result = countDiagnostics([
            [uri('/repo/A.cs'), [diag(Error, 4, 'first', 'CS1'), diag(Error, 4, 'second', 'CS2')]],
        ], false);
        expect(result.get(normalizePath('/repo/A.cs'))?.errors).toBe(2);
    });

    test('counts infos only when enabled and never counts hints', () => {
        const entries = [[uri('/repo/A.cs'), [diag(Information, 1, 'i', 'IDE1'), diag(Hint, 2, 'h', 'IDE2')]]] as const;
        expect(countDiagnostics(entries, false).size).toBe(0);
        expect(countDiagnostics(entries, true).get(normalizePath('/repo/A.cs'))).toEqual({ errors: 0, warnings: 0, infos: 1 });
    });

    test('ignores non-file URIs and files without counted diagnostics', () => {
        const result = countDiagnostics([
            [uri('/repo/A.cs', 'untitled'), [diag(Error, 1, 'e', 'CS1')]],
            [uri('/repo/B.cs'), []],
        ], false);
        expect(result.size).toBe(0);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/test/unit/services/diagnosticsService.test.ts`
Expected: FAIL, `Cannot find module '../../../services/diagnosticsService'`.

- [ ] **Step 3: Implement `src/services/diagnosticsService.ts`**

```ts
import * as vscode from 'vscode';
import { DiagnosticCounts } from '../types';
import { FileCounts, normalizePath } from './diagnosticsRollup';
import { SimpleDebounceManager } from './debounceManager';

const CONFIG_SECTION = 'shinobi.solutionExplorer';
const SHOW_INFOS_KEY = 'diagnostics.showInfos';

/** `$msCompile` appends the project to the message: `... [/repo/Api/Api.csproj]` */
const PROJECT_SUFFIX = /\s+\[[^\]]+\]$/;

/**
 * Counts errors, warnings and (optionally) infos per file. Duplicates — the same diagnostic
 * from build output and the language server, or from several target frameworks — count once.
 */
export function countDiagnostics(
    entries: ReadonlyArray<readonly [vscode.Uri, readonly vscode.Diagnostic[]]>,
    showInfos: boolean
): Map<string, DiagnosticCounts> {
    const result = new Map<string, DiagnosticCounts>();
    for (const [uri, diagnostics] of entries) {
        if (uri.scheme !== 'file') {
            continue;
        }

        const seen = new Set<string>();
        let errors = 0, warnings = 0, infos = 0;
        for (const diagnostic of diagnostics) {
            const code = typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code;
            const key = [diagnostic.severity, diagnostic.range.start.line, code ?? '', diagnostic.message.replace(PROJECT_SUFFIX, '')].join('|');
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);

            switch (diagnostic.severity) {
                case vscode.DiagnosticSeverity.Error: errors++; break;
                case vscode.DiagnosticSeverity.Warning: warnings++; break;
                case vscode.DiagnosticSeverity.Information: if (showInfos) infos++; break;
            }
        }

        if (errors || warnings || infos) {
            const file = normalizePath(uri.fsPath);
            const existing = result.get(file);
            result.set(file, existing
                ? { errors: existing.errors + errors, warnings: existing.warnings + warnings, infos: existing.infos + infos }
                : { errors, warnings, infos });
        }
    }
    return result;
}

/** Keeps per-file diagnostic counts up to date and fires `onDidChange` after each recompute */
export class DiagnosticsService implements vscode.Disposable {
    private _counts: Map<string, DiagnosticCounts> = new Map();
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    private readonly _debouncer = new SimpleDebounceManager(() => this.recompute(), 300);
    private readonly _disposables: vscode.Disposable[] = [];

    readonly onDidChange = this._onDidChange.event;

    constructor() {
        this._disposables.push(
            this._onDidChange,
            vscode.languages.onDidChangeDiagnostics(() => this._debouncer.trigger()),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration(`${CONFIG_SECTION}.${SHOW_INFOS_KEY}`)) {
                    this._debouncer.trigger();
                }
            })
        );
        this.recompute();
    }

    get counts(): FileCounts {
        return this._counts;
    }

    recompute(): void {
        const showInfos = vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>(SHOW_INFOS_KEY, false);
        this._counts = countDiagnostics(vscode.languages.getDiagnostics(), showInfos);
        this._onDidChange.fire();
    }

    dispose(): void {
        this._debouncer.cancel();
        this._disposables.forEach(d => d.dispose());
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/test/unit/services/diagnosticsService.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/diagnosticsService.ts src/test/unit/services/diagnosticsService.test.ts
git commit -m "count diagnostics per file, deduplicating build and language server reports"
```

---

### Task 4: Task provider (`shinobi-dotnet`)

**Files:**
- Create: `src/services/dotnetTaskProvider.ts`
- Test: `src/test/unit/services/dotnetTaskProvider.test.ts`
- Modify: `package.json` (`contributes.taskDefinitions`)

- [ ] **Step 1: Write the failing test**

Create `src/test/unit/services/dotnetTaskProvider.test.ts`:

```ts
const env = {
    solution: undefined as undefined | { solutionPath: string; projects: Map<string, unknown> },
};

jest.mock('vscode', () => {
    class Task {
        group: unknown;
        constructor(
            public definition: any,
            public scope: any,
            public name: string,
            public source: string,
            public execution: any,
            public problemMatchers: string[]
        ) { }
    }
    class ShellExecution {
        constructor(public command: string, public args: string[], public options: any) { }
    }
    return {
        Task,
        ShellExecution,
        TaskGroup: { Build: { id: 'build' } },
        TaskScope: { Workspace: 2 },
        workspace: { workspaceFolders: [{ name: 'repo', uri: { fsPath: '/repo' } }] },
    };
}, { virtual: true });

jest.mock('../../../services/solutionService', () => ({
    SolutionService: { getActiveSolution: () => env.solution },
}));

import { createDotnetTask, dotnetTaskArgs, DotnetTaskProvider, DOTNET_TASK_TYPE } from '../../../services/dotnetTaskProvider';

describe('dotnetTaskArgs', () => {
    test('build, rebuild, clean and restore', () => {
        expect(dotnetTaskArgs('build', '/repo/All.sln')).toEqual(
            ['build', '/repo/All.sln', '-nologo', '-consoleLoggerParameters:NoSummary', '-property:GenerateFullPaths=true']);
        expect(dotnetTaskArgs('rebuild', '/repo/All.sln')).toEqual(
            ['build', '/repo/All.sln', '--no-incremental', '-nologo', '-consoleLoggerParameters:NoSummary', '-property:GenerateFullPaths=true']);
        expect(dotnetTaskArgs('clean', '/repo/All.sln')).toEqual(
            ['clean', '/repo/All.sln', '-nologo', '-consoleLoggerParameters:NoSummary']);
        expect(dotnetTaskArgs('restore', '/repo/All.sln')).toEqual(['restore', '/repo/All.sln']);
    });
});

describe('createDotnetTask', () => {
    test('builds a shell task with the $msCompile matcher in the build group', () => {
        const task = createDotnetTask({ type: DOTNET_TASK_TYPE, action: 'build', target: '/repo/Api/Api.csproj' }) as any;
        expect(task.name).toBe('build Api');
        expect(task.source).toBe(DOTNET_TASK_TYPE);
        expect(task.execution.command).toBe('dotnet');
        expect(task.execution.options).toEqual({ cwd: '/repo/Api' });
        expect(task.problemMatchers).toEqual(['$msCompile']);
        expect(task.group).toEqual({ id: 'build' });
        expect(task.scope).toEqual({ name: 'repo', uri: { fsPath: '/repo' } });
    });

    test('the solution build is the default build task', () => {
        const task = createDotnetTask({ type: DOTNET_TASK_TYPE, action: 'build', target: '/repo/All.slnx' }) as any;
        expect(task.name).toBe('build All');
        expect(task.group).toEqual({ id: 'build', isDefault: true });
    });

    test('restore has no problem matcher', () => {
        const task = createDotnetTask({ type: DOTNET_TASK_TYPE, action: 'restore', target: '/repo/All.sln' }) as any;
        expect(task.problemMatchers).toEqual([]);
    });

    test('keeps the given definition object', () => {
        const definition = { type: DOTNET_TASK_TYPE, action: 'clean' as const, target: '/repo/All.sln' };
        expect((createDotnetTask(definition) as any).definition).toBe(definition);
    });
});

describe('DotnetTaskProvider', () => {
    const provider = new DotnetTaskProvider();

    test('provides no tasks without a solution', () => {
        env.solution = undefined;
        expect(provider.provideTasks()).toEqual([]);
    });

    test('provides every action for the solution and each project', () => {
        env.solution = {
            solutionPath: '/repo/All.sln',
            projects: new Map([['/repo/Domain/Domain.csproj', {}], ['/repo/Api/Api.csproj', {}]]),
        };
        const names = provider.provideTasks().map(t => t.name);
        expect(names).toEqual([
            'build All', 'rebuild All', 'clean All', 'restore All',
            'build Api', 'rebuild Api', 'clean Api', 'restore Api',
            'build Domain', 'rebuild Domain', 'clean Domain', 'restore Domain',
        ]);
    });

    test('resolves a tasks.json task and rejects invalid definitions', () => {
        const definition = { type: DOTNET_TASK_TYPE, action: 'build', target: '/repo/All.sln' };
        const resolved = provider.resolveTask({ definition, scope: { name: 'repo' } } as any) as any;
        expect(resolved.definition).toBe(definition);
        expect(resolved.scope).toEqual({ name: 'repo' });
        expect(provider.resolveTask({ definition: { type: DOTNET_TASK_TYPE, action: 'publish', target: '/x' } } as any)).toBeUndefined();
        expect(provider.resolveTask({ definition: { type: DOTNET_TASK_TYPE, action: 'build' } } as any)).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/test/unit/services/dotnetTaskProvider.test.ts`
Expected: FAIL, `Cannot find module '../../../services/dotnetTaskProvider'`.

- [ ] **Step 3: Implement `src/services/dotnetTaskProvider.ts`**

```ts
import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionService } from './solutionService';
import { sln } from '../core/utils';

export const DOTNET_TASK_TYPE = 'shinobi-dotnet';

export type DotnetTaskAction = 'build' | 'rebuild' | 'clean' | 'restore';
export const DOTNET_TASK_ACTIONS: readonly DotnetTaskAction[] = ['build', 'rebuild', 'clean', 'restore'];

export interface DotnetTaskDefinition extends vscode.TaskDefinition {
    readonly type: typeof DOTNET_TASK_TYPE;
    readonly action: DotnetTaskAction;
    /** Absolute path of the solution or project file */
    readonly target: string;
}

const QUIET = ['-nologo', '-consoleLoggerParameters:NoSummary'];

/** `dotnet` arguments for an action; build output uses full paths so `$msCompile` links resolve */
export function dotnetTaskArgs(action: DotnetTaskAction, target: string): string[] {
    switch (action) {
        case 'build': return ['build', target, ...QUIET, '-property:GenerateFullPaths=true'];
        case 'rebuild': return ['build', target, '--no-incremental', ...QUIET, '-property:GenerateFullPaths=true'];
        case 'clean': return ['clean', target, ...QUIET];
        case 'restore': return ['restore', target];
    }
}

/** Creates the task for a definition; the solution build is the default build task (Ctrl+Shift+B) */
export function createDotnetTask(
    definition: DotnetTaskDefinition,
    scope: vscode.WorkspaceFolder | vscode.TaskScope = vscode.workspace.workspaceFolders?.[0] ?? vscode.TaskScope.Workspace
): vscode.Task {
    const { action, target } = definition;
    const targetName = path.basename(target, sln(target) ?? path.extname(target));
    const task = new vscode.Task(
        definition,
        scope,
        `${action} ${targetName}`,
        DOTNET_TASK_TYPE,
        new vscode.ShellExecution('dotnet', dotnetTaskArgs(action, target), { cwd: path.dirname(target) }),
        action === 'restore' ? [] : ['$msCompile']
    );
    task.group = action === 'build' && sln(target)
        ? { id: vscode.TaskGroup.Build.id, isDefault: true } as vscode.TaskGroup
        : vscode.TaskGroup.Build;
    return task;
}

function isDotnetTaskDefinition(definition: vscode.TaskDefinition): definition is DotnetTaskDefinition {
    return DOTNET_TASK_ACTIONS.includes(definition.action) && typeof definition.target === 'string';
}

/** Build, rebuild, clean and restore for the active solution and each of its projects */
export class DotnetTaskProvider implements vscode.TaskProvider {
    provideTasks(): vscode.Task[] {
        const solution = SolutionService.getActiveSolution();
        if (!solution) {
            return [];
        }
        const targets = [solution.solutionPath, ...[...solution.projects.keys()].sort()];
        return targets.flatMap(target =>
            DOTNET_TASK_ACTIONS.map(action => createDotnetTask({ type: DOTNET_TASK_TYPE, action, target })));
    }

    resolveTask(task: vscode.Task): vscode.Task | undefined {
        // VS Code requires the resolved task to keep the original definition object
        return isDotnetTaskDefinition(task.definition)
            ? createDotnetTask(task.definition, task.scope as vscode.WorkspaceFolder | vscode.TaskScope | undefined)
            : undefined;
    }
}
```

`task.scope` can be `undefined` for tasks from older configs. Passing `undefined` triggers the default parameter, which is what we want.

Sorting: the test expects `Api` before `Domain`. `[...keys()].sort()` sorts `/repo/Api/...` before `/repo/Domain/...`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/test/unit/services/dotnetTaskProvider.test.ts`
Expected: PASS.

- [ ] **Step 5: Declare the task type in `package.json`**

Inside `"contributes"` (next to `"configuration"`), add:

```json
"taskDefinitions": [
  {
    "type": "shinobi-dotnet",
    "required": ["action", "target"],
    "properties": {
      "action": {
        "type": "string",
        "enum": ["build", "rebuild", "clean", "restore"],
        "description": "The dotnet action to run"
      },
      "target": {
        "type": "string",
        "description": "Absolute path of the solution or project file"
      }
    }
  }
],
```

- [ ] **Step 6: Typecheck and run the full suite**

Run: `npm run typecheck && npm test`
Expected: no type errors, all tests pass (including the `contextMenus` package.json sync test).

- [ ] **Step 7: Commit**

```bash
git add src/services/dotnetTaskProvider.ts src/test/unit/services/dotnetTaskProvider.test.ts package.json
git commit -m "add shinobi-dotnet build tasks with the \$msCompile problem matcher"
```

---

### Task 5: Context-menu actions run tasks

**Files:**
- Modify: `src/services/solutionActionService.ts` (`_handleBuild` at about line 255, `_handleRestoreDependencies` at about line 766)

- [ ] **Step 1: Replace `_handleBuild`**

Replace the whole `_handleBuild` method with:

```ts
    private static async _handleBuild(nodeId: NodeId, action: DotnetTaskAction): Promise<void> {
        try {
            if (!SolutionService.getActiveSolution()) {
                vscode.window.showErrorMessage('No active solution found');
                return;
            }

            const targetPath = nodeId.path;
            if (!targetPath) {
                log.error('Cannot extract solution or project path from nodeId:', nodeId);
                vscode.window.showErrorMessage('Error: Cannot determine solution or project path for build action');
                return;
            }

            await vscode.tasks.executeTask(createDotnetTask({ type: DOTNET_TASK_TYPE, action, target: targetPath }));
            log.info(`Started ${action} task for ${targetPath}`);
        } catch (error) {
            log.error(`Error during ${action}:`, error);
            vscode.window.showErrorMessage(`Error during ${action}: ${error}`);
        }
    }
```

- [ ] **Step 2: Replace the terminal in `_handleRestoreDependencies`**

Replace everything from `const projectName = require('path')...` through `vscode.window.showInformationMessage(\`Restoring dependencies for ${projectName}...\`);` with:

```ts
            await vscode.tasks.executeTask(createDotnetTask({ type: DOTNET_TASK_TYPE, action: 'restore', target: projectPath }));
            log.info(`Started restore task for ${projectPath}`);
```

- [ ] **Step 3: Add the import**

At the top of `src/services/solutionActionService.ts`:

```ts
import { createDotnetTask, DotnetTaskAction, DOTNET_TASK_TYPE } from './dotnetTaskProvider';
```

`sln` was used in `_handleBuild`. Run `grep -n "sln(" src/services/solutionActionService.ts`. If there are no other uses, remove `sln` from the `import { sln } from '../core/utils';` line (delete the line if it was the only import). Otherwise `noUnusedLocals` fails the build.

- [ ] **Step 4: Typecheck and test**

Run: `npm run typecheck && npm test`
Expected: no errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/solutionActionService.ts
git commit -m "run build, rebuild, clean and restore as tasks instead of terminal text"
```

---

### Task 6: Wire up the extension host

**Files:**
- Modify: `src/webview/providers/SolutionWebviewProvider.ts`
- Modify: `src/extension.ts`
- Modify: `package.json` (`contributes.configuration.properties`)

- [ ] **Step 1: Provider: accept the service and send markers**

In `src/webview/providers/SolutionWebviewProvider.ts`:

Add imports:

```ts
import { DiagnosticsService } from '../../services/diagnosticsService';
import { computeMarkers } from '../../services/diagnosticsRollup';
```

Add a field next to `_activeEditorListener`:

```ts
    private readonly _diagnosticsListener: vscode.Disposable;
```

Extend the constructor parameters and subscribe at the end of the constructor body (after `this._updateViewDebouncer = ...`):

```ts
    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext,
        private readonly _frameworkService: FrameworkDropdownService,
        private readonly _diagnostics: DiagnosticsService
    ) {
        // ...existing body unchanged...
        this._diagnosticsListener = _diagnostics.onDidChange(() => this._sendDiagnostics());
    }
```

At the end of `_sendSolutionData`, after the `sendToUi(this.webview, { type: 'solutionData', ... })` call, add:

```ts
        this._sendDiagnostics(projects);
```

Add the method below `_sendSolutionData`:

```ts
    /** Sends the error/warning markers for the given (or last sent) tree */
    private _sendDiagnostics(projects: ProjectNode[] | undefined = this._cachedSolutionData): void {
        if (!this._view || !projects) {
            return;
        }
        sendToUi(this.webview, {
            type: 'diagnostics',
            payload: { markers: computeMarkers(projects, this._diagnostics.counts) }
        });
    }
```

In `dispose()`, add:

```ts
        this._diagnosticsListener.dispose();
```

Expansion re-sends the tree via `_sendCachedData` → `_sendSolutionData`, so newly visible nodes get markers without extra wiring.

- [ ] **Step 2: `extension.ts`: create the service and register the provider**

In `src/extension.ts`, add imports:

```ts
import { DiagnosticsService } from './services/diagnosticsService';
import { DotnetTaskProvider, DOTNET_TASK_TYPE } from './services/dotnetTaskProvider';
```

Before `const solutionWebviewProvider = new SolutionWebviewProvider(`, add:

```ts
    const diagnosticsService = new DiagnosticsService();
    context.subscriptions.push(
        diagnosticsService,
        vscode.tasks.registerTaskProvider(DOTNET_TASK_TYPE, new DotnetTaskProvider())
    );
```

and pass it as the 4th constructor argument:

```ts
    const solutionWebviewProvider = new SolutionWebviewProvider(
        context.extensionUri,
        context,
        frameworkDropdownService,
        diagnosticsService
    );
```

`extension.ts` is the only place that constructs the provider.

- [ ] **Step 3: Add the setting to `package.json`**

In `contributes.configuration.properties`, after `shinobi.solutionExplorer.location`:

```json
"shinobi.solutionExplorer.diagnostics.showInfos": {
  "type": "boolean",
  "default": false,
  "description": "Also mark files with info diagnostics in the Solution Explorer (errors and warnings are always marked)"
}
```

- [ ] **Step 4: Typecheck, test, build**

Run: `npm run typecheck && npm test && npm run build:dev`
Expected: no errors, all tests pass, webpack compiles both bundles.

- [ ] **Step 5: Commit**

```bash
git add src/webview/providers/SolutionWebviewProvider.ts src/extension.ts package.json
git commit -m "send diagnostics markers to the solution explorer"
```

---

### Task 7: Render markers in the tree

**Files:**
- Create: `src/webview/solution-view/components/TreeNode/diagnosticMarker.ts`
- Modify: `src/webview/solution-view/types/index.ts`, `hooks/useVsCodeApi.ts`, `App.tsx`, `components/SolutionTree.tsx`, `components/TreeNode/TreeNode.tsx`
- Modify: `src/webview/providers/views/SolutionWebview.ts` (CSS)
- Test: `src/test/unit/webview/solution-view/components/TreeNodeDiagnostics.test.tsx`

Webview code must not import `vscode` or Node modules. `src/types/index.ts` is imported by the webview already (types only), so importing `NodeMarker` / `DiagnosticMarkers` from it is fine.

- [ ] **Step 1: Write the failing test**

Create `src/test/unit/webview/solution-view/components/TreeNodeDiagnostics.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { TreeNode } from '../../../../../webview/solution-view/components/TreeNode/TreeNode';
import { describeMarker } from '../../../../../webview/solution-view/components/TreeNode/diagnosticMarker';
import { NodeIdString } from '../../../../../types/nodeId';
import { DiagnosticMarkers, ProjectNode } from '../../../../../types';

const fileNode: ProjectNode = { type: 'file', name: 'Program.cs', nodeId: 'file-1' as NodeIdString };
const folderNode: ProjectNode = { type: 'folder', name: 'Controllers', nodeId: 'folder-1' as NodeIdString };

const props = {
    level: 0,
    onProjectAction: jest.fn(),
    onToggleExpand: jest.fn(),
    onNodeClick: jest.fn(),
    onNodeFocus: jest.fn(),
    onRenameConfirm: jest.fn(),
    onRenameCancel: jest.fn(),
};

const markers = {
    ['file-1']: { severity: 'error', errors: 3, warnings: 2, infos: 0 },
    ['folder-1']: { severity: 'warning', errors: 0, warnings: 1, infos: 0 },
} as unknown as DiagnosticMarkers;

describe('TreeNode diagnostics markers', () => {
    test('a file shows its colour and a count badge for the most severe state', () => {
        const { container } = render(<TreeNode {...props} node={fileNode} markers={markers} />);
        expect(screen.getByText('Program.cs')).toHaveClass('diagnostic-error');
        const badge = container.querySelector('.diagnostic-badge');
        expect(badge).toHaveTextContent('3');
        expect(badge).toHaveAttribute('title', '3 errors, 2 warnings');
        expect(container.querySelector('.diagnostic-dot')).toBeNull();
    });

    test('a folder shows a dot instead of a count', () => {
        const { container } = render(<TreeNode {...props} node={folderNode} markers={markers} />);
        expect(screen.getByText('Controllers')).toHaveClass('diagnostic-warning');
        expect(container.querySelector('.diagnostic-dot')).toHaveAttribute('title', '1 warning');
        expect(container.querySelector('.diagnostic-badge')).toBeNull();
    });

    test('nodes without a marker render as before', () => {
        const { container } = render(<TreeNode {...props} node={fileNode} markers={{} as DiagnosticMarkers} />);
        expect(screen.getByText('Program.cs').className).not.toMatch(/diagnostic-/);
        expect(container.querySelector('.diagnostic-badge, .diagnostic-dot')).toBeNull();
    });

    test('children receive their markers', () => {
        const parent: ProjectNode = { ...folderNode, expanded: true, children: [fileNode] };
        render(<TreeNode {...props} node={parent} markers={markers} />);
        expect(screen.getByText('Program.cs')).toHaveClass('diagnostic-error');
    });
});

describe('describeMarker', () => {
    test('lists the non-zero counts with plurals', () => {
        expect(describeMarker({ severity: 'error', errors: 1, warnings: 0, infos: 2 })).toBe('1 error, 2 infos');
        expect(describeMarker({ severity: 'warning', errors: 0, warnings: 2, infos: 0 })).toBe('2 warnings');
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/test/unit/webview/solution-view/components/TreeNodeDiagnostics.test.tsx`
Expected: FAIL, `Cannot find module '.../TreeNode/diagnosticMarker'`.

- [ ] **Step 3: Create `src/webview/solution-view/components/TreeNode/diagnosticMarker.ts`**

```ts
import { NodeMarker } from '../../../../types';

/** The count shown in a file's badge: the count at the marker's severity */
export function markerCount(marker: NodeMarker): number {
    switch (marker.severity) {
        case 'error': return marker.errors;
        case 'warning': return marker.warnings;
        case 'info': return marker.infos;
    }
}

/** Tooltip text, e.g. "2 errors, 5 warnings" */
export function describeMarker(marker: NodeMarker): string {
    const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
    return [
        marker.errors ? plural(marker.errors, 'error') : undefined,
        marker.warnings ? plural(marker.warnings, 'warning') : undefined,
        marker.infos ? plural(marker.infos, 'info') : undefined,
    ].filter(Boolean).join(', ');
}
```

- [ ] **Step 4: Add `markers` to the props types**

In `src/webview/solution-view/types/index.ts`, change the first import to:

```ts
import { DiagnosticMarkers, NodeType, ProjectNode } from "../../../types";
```

Add to `TreeNodeProps`:

```ts
    markers?: DiagnosticMarkers; // Error/warning markers by node ID
```

Add to `SolutionTreeProps`:

```ts
    markers?: DiagnosticMarkers;
```

- [ ] **Step 5: Render in `TreeNode.tsx`**

Add the import:

```ts
import { describeMarker, markerCount } from './diagnosticMarker';
```

Add `markers` to the destructured props (after `renamingNodeId`):

```ts
    renamingNodeId,
    markers
}) => {
```

After `const isFocused = ...`, add:

```ts
    const marker = markers?.[nodeIdentifier];
    const markerTitle = marker ? describeMarker(marker) : undefined;
```

Replace the name `<span>` (the `else` branch of `isRenaming`) with:

```tsx
                    <>
                        <span
                            className={`node-name ${node.isStartupProject ? 'startup-project' : ''} ${marker ? `diagnostic-${marker.severity}` : ''}`}
                            title={markerTitle}
                        >{node.name}</span>
                        {marker && (node.type === 'file' || node.type === 'solutionItem'
                            ? <span className={`diagnostic-badge diagnostic-${marker.severity}`} title={markerTitle}>{markerCount(marker)}</span>
                            : <span className={`diagnostic-dot diagnostic-${marker.severity}`} title={markerTitle} />)}
                    </>
```

In the recursive `<TreeNode ... />` for children, add the prop:

```tsx
                            markers={markers}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx jest src/test/unit/webview/solution-view/components/`
Expected: PASS for `TreeNodeDiagnostics.test.tsx` and the existing `TreeNode.test.tsx`.

- [ ] **Step 7: Thread markers through the hook, App and SolutionTree**

`src/webview/solution-view/hooks/useVsCodeApi.ts`:
- Change line 5 to `import { DiagnosticMarkers, NodeType, ProjectNode, SolutionData } from '../../../types';`
- Add the state after `activeFilePath`:

```ts
    const [markers, setMarkers] = useState<DiagnosticMarkers>({} as DiagnosticMarkers);
```

- Add a case to the `switch (message.type)` before `default`:

```ts
                case 'diagnostics':
                    setMarkers(message.payload.markers);
                    break;
```

- Add `markers,` to the returned object (after `activeFilePath,`).

`src/webview/solution-view/App.tsx`:
- Destructure `markers` from `useVsCodeApi()`.
- Pass `markers={markers}` to `<SolutionTree ... />`.

`src/webview/solution-view/components/SolutionTree.tsx`:
- Add `markers` to the destructured props: `({ projects, activeFilePath, onProjectAction, onExpandNode, onCollapseNode, markers })`.
- Pass `markers={markers}` to the root `<TreeNode ... />`.

- [ ] **Step 8: CSS in `src/webview/providers/views/SolutionWebview.ts`**

After the `.node-name.startup-project { ... }` rule, add:

```css
                        .node-name.diagnostic-error {
                            color: var(--vscode-list-errorForeground);
                        }

                        .node-name.diagnostic-warning {
                            color: var(--vscode-list-warningForeground);
                        }

                        .diagnostic-badge,
                        .diagnostic-dot {
                            margin-left: auto;
                            padding-left: 8px;
                            margin-right: 8px;
                            flex-shrink: 0;
                        }

                        .diagnostic-badge {
                            font-size: 11px;
                        }

                        .diagnostic-dot {
                            width: 6px;
                            height: 6px;
                            padding-left: 0;
                            border-radius: 50%;
                            background-color: currentColor;
                        }

                        .diagnostic-badge.diagnostic-error,
                        .diagnostic-dot.diagnostic-error {
                            color: var(--vscode-list-errorForeground);
                        }

                        .diagnostic-badge.diagnostic-warning,
                        .diagnostic-dot.diagnostic-warning {
                            color: var(--vscode-list-warningForeground);
                        }

                        .diagnostic-badge.diagnostic-info,
                        .diagnostic-dot.diagnostic-info {
                            color: var(--vscode-editorInfo-foreground);
                        }
```

`.tree-node` is already `display: flex`, so `margin-left: auto` pushes the badge or dot to the right edge.

- [ ] **Step 9: Typecheck, test, build**

Run: `npm run typecheck && npm test && npm run build:dev`
Expected: no errors, all tests pass, both bundles compile.

- [ ] **Step 10: Commit**

```bash
git add src/webview src/test/unit/webview/solution-view/components/TreeNodeDiagnostics.test.tsx
git commit -m "show error and warning markers in the solution explorer"
```

---

### Task 8: README and manual check

**Files:**
- Modify: `README.md` (feature list and Phase 2 section at about lines 51-67)

- [ ] **Step 1: Update the Phase 2 section**

Tick off these items (`- [ ]` → `- [x]`):
- Mark files with errors, warnings and infos
- Roll the most severe state up to …
- Update live as diagnostics change
- Build output (`$msCompile`) is the primary source …
- Run Build/Rebuild/Clean/Restore as VS Code tasks …
- Errors and warnings link to file and line
- Build solution from the command palette / a key binding (Ctrl+Shift+B)

In the features part of the README (where Build/Rebuild/Clean are described), add:

```markdown
- **Errors in the tree**: files with errors or warnings are coloured and show a count; folders, projects, solution folders and the solution show a dot when anything below them has problems. Build markers are reliable after a (re)build, as in Visual Studio. Live language-server errors for open files come on top; for live errors in all files set `"dotnet.backgroundAnalysis.compilerDiagnosticsScope": "fullSolution"`. Infos are hidden unless `shinobi.solutionExplorer.diagnostics.showInfos` is on.
- **Build tasks**: Build, Rebuild, Clean and Restore run as `shinobi-dotnet` tasks with the `$msCompile` problem matcher, so errors land in the Problems panel. Ctrl+Shift+B (Run Build Task) offers them; the solution build is the default unless your `tasks.json` defines one.
```

Under "Known Issues", add:

```markdown
- Building a single project does not clear stale build errors that an earlier solution build reported for other projects
- Files a project links from outside its own directory are not rolled up into the project's marker
```

- [ ] **Step 2: Manual check in the Extension Development Host**

Run `npm run build:dev`, press F5 in VS Code, and open a solution from `src/__fixtures__/` or a real one. Introduce a compile error in a `.cs` file, then:
1. Right-click the solution → Build. The task terminal opens, and the error shows in the Problems panel and links to the line.
2. The file name turns red with a count, and its folder, project, solution folder and the solution show red dots, including while collapsed.
3. Fix the error and build again. The markers disappear.
4. Ctrl+Shift+B. The picker offers the `shinobi-dotnet` tasks, or runs `build <Solution>` directly if VS Code honours the provided default. Note which one happens and put it in the README sentence above.
5. Toggle `shinobi.solutionExplorer.diagnostics.showInfos` and check that info markers appear and disappear.

- [ ] **Step 3: Commit and push**

```bash
git add README.md
git commit -m "readme: phase 2 build tasks and error markers"
git push
```
