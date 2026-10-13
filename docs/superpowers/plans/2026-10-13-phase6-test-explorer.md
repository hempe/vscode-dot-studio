# Phase 6: Test Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover, run and debug Microsoft.Testing.Platform tests in VS Code's Test Explorer.

**Architecture:** `testingPlatformClient.ts` is a Node-only JSON-RPC client for MTP's server mode (TCP listener, `Content-Length` framing, requests, notifications). `testTree.ts` turns protocol nodes into a pure tree model (project → namespace → class → method → cases). `testProjects.ts` finds MTP test projects via MSBuild. `testExplorer.ts` is the VS Code glue: the `TestController`, run/debug profiles, discovery triggers.

**Tech Stack:** TypeScript, `net`, `child_process`, VS Code Testing API, Jest.

Spec: `docs/superpowers/specs/2026-10-13-phase6-test-explorer-design.md`. Fixtures: `src/__fixtures__/testing-platform/{X3,MR}.jsonl`.

---

### Task 1: Protocol client

**Files:** Create `src/services/testing/testingPlatformClient.ts`; Test `src/test/unit/services/testing/testingPlatformClient.test.ts`

```ts
export interface TestNode { uid: string; 'display-name': string; 'node-type'?: string; 'execution-state'?: string;
  'location.file'?: string; 'location.line-start'?: number; 'location.type'?: string; 'location.method'?: string;
  'time.duration-ms'?: number; 'error.message'?: string; 'error.stacktrace'?: string; 'assert.expected'?: string; 'assert.actual'?: string;
  standardOutput?: string; standardError?: string; }
export class MessageReader { push(chunk: Buffer): object[] }               // Content-Length framing, partial and joined chunks
export function frame(message: object): Buffer;
export interface TestSession {
  discover(): Promise<void>; run(tests?: { uid: string; 'display-name': string }[]): Promise<void>;
  onUpdate(listener: (nodes: TestNode[]) => void): void; onLog(listener: (level: string, message: string) => void): void;
  close(): Promise<void>;   // exit notification, then kill after 2 s
}
/** Listens on 127.0.0.1:0, calls `start(args)` with the server arguments, resolves once the app connected and answered initialize */
export function connectTestApp(start: (args: string[]) => Promise<{ kill(): void; output(): string }>, timeoutMs = 30000): Promise<TestSession>;
```

- [ ] Tests: `MessageReader` with a message split over three chunks and two messages in one chunk; replaying `X3.jsonl` through a fake socket gives 4 discovered and 4 result updates; requests resolve on the matching `id`; server requests (`id` + `method`) get a `null` result.
- [ ] Implement; commit "Microsoft.Testing.Platform protocol client".

### Task 2: Tree model and results

**Files:** Create `src/services/testing/testTree.ts`; Test `src/test/unit/services/testing/testTree.test.ts`

```ts
export interface TreeEntry { id: string; label: string; kind: 'namespace' | 'class' | 'method' | 'case'; file?: string; line?: number; children: TreeEntry[]; node?: TestNode }
/** Discovered nodes of one project as namespace → class → method → case */
export function buildTestTree(nodes: TestNode[]): TreeEntry[];
export type Outcome = { state: 'started' } | { state: 'passed'; duration?: number } | { state: 'failed' | 'errored'; duration?: number; message: string; expected?: string; actual?: string; stackTrace?: string } | { state: 'skipped' };
export function outcomeOf(node: TestNode): Outcome | undefined;   // undefined for 'discovered'
export function methodName(locationMethod: string): string;        // 'Positive(System.Int32)' -> 'Positive'
```

- [ ] Tests from both fixtures: X3 → `X3.Math` → `MathTests` → `Adds`, `Fails`, `Positive` (cases `x: 1`, `x: 2`); MR → `MR` → `MathTests` → `Adds`, `Positive` (cases `1`, `2`); single-node methods have the node uid as id and no children; outcomes of the run updates (Fails failed with message `Assert.Equal() Failure: Values differ…`, expected `3`, actual `2`).
- [ ] Implement; commit "test tree model".

### Task 3: Test projects

**Files:** Create `src/services/testing/testProjects.ts`; Test `src/test/unit/services/testing/testProjects.test.ts`

```ts
export function isTestProjectCandidate(projectXml: string): boolean;
export interface TestProject { projectPath: string; targetPath: string; testingPlatform: boolean }
export function parseTestProperties(msbuildJson: string): { testingPlatform: boolean; targetPath?: string };
export async function evaluateTestProject(projectPath: string, configuration: string): Promise<TestProject | undefined>;
```

- [ ] Tests: candidates for xunit.v3 / MSTest / TUnit / Microsoft.NET.Test.Sdk / `IsTestProject`; not for a classlib; `parseTestProperties` on `{"Properties":{"IsTestingPlatformApplication":"true","TargetPath":"/r/X3.dll"}}`.
- [ ] Implement (`dotnet msbuild <project> -getProperty:IsTestingPlatformApplication -getProperty:TargetPath -property:Configuration=<c>`); commit "find Microsoft.Testing.Platform test projects".

### Task 4: Test Explorer

**Files:** Create `src/services/testing/testExplorer.ts`; Modify `src/extension.ts`; Test `src/test/unit/services/testing/testExplorer.test.ts` (vscode mock with a fake TestController)

- [ ] `TestExplorer` (Disposable): controller `shinobi-dotnet-tests` / `.NET Tests`; `refreshHandler` = build all + discover; run and debug profiles; `discoverProjects(projects, { build })`; listens to `vscode.tasks.onDidEndTaskProcess` (exit 0 of `shinobi-dotnet` build/rebuild or `StartupPreBuild`) and re-discovers projects whose `TargetPath` mtime changed; reacts to solution changes and `BuildConfiguration.onDidChange`.
- [ ] Project items: `controller.createTestItem(projectPath, name, uri)`; tree entries → items (`range` = line), discovery replaces children.
- [ ] Run: collect leaves per project from `request.include` (or all), `exclude` respected; build each project with `execFile('dotnet', ['build', project, '--configuration', c, '-nologo'])` (output appended to the run); `connectTestApp(args => spawn('dotnet', [targetPath, ...args]))`; `run(leaf nodes)`; map `outcomeOf` to `run.started/passed/failed/errored/skipped` (`TestMessage.diff` when expected/actual); unknown uids get items created under their class; logs and std output → `run.appendOutput`.
- [ ] Debug: `start` = `vscode.debug.startDebugging(folder, { type: 'coreclr', request: 'launch', name: 'Debug tests', program: targetPath, args, cwd: projectDir, console: 'internalConsole' })`; after the run `vscode.debug.stopDebugging(session)`.
- [ ] Unit test with a fake controller and a fake app (replaying the X3 fixture over a real socket): discovery creates the expected items; a run marks Fails as failed with the message and Adds as passed.
- [ ] Register in `extension.ts`; commit "Test Explorer for Microsoft.Testing.Platform tests".

### Task 5: Integration test, README

- [ ] `src/test/unit/services/testing/testingPlatform.dotnet.test.ts` (skipped without dotnet; skipped with a warning when restore fails): create xunit.v3 and MSTest-runner projects in a temp dir, build, `evaluateTestProject` → testingPlatform true, discover + run through `connectTestApp`, outcomes as expected.
- [ ] README: tick Phase 6 items (VSTest noted as not yet supported, plus a new open item for VSTest), Current Features "Tests" section, code lens hint. Commit and push.
