# Phase 5: New Project & New Item Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Add New Item...", a working "Add New Project...", valid namespaces from folders, and renaming nested files with their parent.

**Architecture:** Pure helpers under `src/services/templates/` parse `dotnet new list`, build built-in C# items, fix namespaces, compute project defaults and dependent renames. `templateService.ts` holds the VS Code UI (quick picks, input boxes, progress, output channel). The provider reuses the inline temporary node for item names: it remembers the chosen template per temporary node id and creates from it when the name is confirmed. Rename runs the dependent renames after the main file.

**Tech Stack:** TypeScript, VS Code API, Jest, `dotnet new` (SDK 10).

Spec: `docs/superpowers/specs/2026-10-13-phase5-templates-design.md`. Fixtures: `src/__fixtures__/dotnet-new/list-{item,project}.txt`.

---

### Task 1: Parse `dotnet new list`

**Files:** Create `src/services/templates/dotnetNewList.ts`; Test `src/test/unit/services/templates/dotnetNewList.test.ts`

- [ ] Test: parsing both fixtures gives e.g. `{ name: 'ASP.NET Core Web API', shortNames: ['webapi'], languages: ['C#', 'F#'], defaultLanguage: 'C#', tags: ['Web', 'Web API', 'API', 'Service'] }`, `{ name: 'ASP.NET Core Web App (Razor Pages)', shortNames: ['webapp', 'razor'], ... }`, `{ name: 'EditorConfig file', shortNames: ['editorconfig', '.editorconfig'], languages: [], tags: ['Config'] }`; the counts equal the table rows (header and dashes excluded); `supportsLanguage(t, 'C#')` is true for language-less templates.
- [ ] Implement: column boundaries from the dashed line (`/-+/g` match indices), slice each following non-empty line by them, trim; short names and languages split on `,`, brackets mark `defaultLanguage`; tags split on `/`.

```ts
export interface DotnetTemplate {
    readonly name: string;
    readonly shortNames: string[];
    readonly languages: string[];
    readonly defaultLanguage?: string;
    readonly tags: string[];
}
export function parseTemplateList(output: string): DotnetTemplate[];
export function supportsLanguage(template: DotnetTemplate, language: string): boolean;
/** `dotnet new list --type <type>`, cached per session */
export function listTemplates(type: 'project' | 'item'): Promise<DotnetTemplate[]>;
```

- [ ] Commit "parse dotnet new list".

### Task 2: Item helpers

**Files:** Create `src/services/templates/itemTemplates.ts`; Test `src/test/unit/services/templates/itemTemplates.test.ts`

```ts
export type BuiltinItemKind = 'class' | 'interface' | 'record' | 'enum' | 'struct';
export const BUILTIN_ITEMS: readonly { kind: BuiltinItemKind; label: string; defaultName: string }[];
// Class1.cs, IInterface1.cs? -> Visual Studio uses Class1.cs, Interface1.cs, Record1.cs, Enum1.cs, Struct1.cs
export function builtinItemContent(kind: BuiltinItemKind, name: string, namespace: string, eol?: string): string;
// namespace X;\n\npublic class Name\n{\n}\n
export function defaultTemplateItemName(template: DotnetTemplate): string;   // 'API Controller' -> 'APIController1'
export function itemBaseName(name: string): string;                          // 'Counter.razor' -> 'Counter', 'Foo' -> 'Foo'
export function replaceNamespace(content: string, namespace: string): string; // first `namespace X` (file-scoped or block)
export function namespaceSegment(folderName: string): string;                // 'Connected Services' -> 'Connected_Services', '2024' -> '_2024'
export function projectLanguage(projectPath: string): 'C#' | 'F#' | 'VB';
```

- [ ] Tests for each (`builtinItemContent('record', 'Customer', 'Demo.Models')` = `namespace Demo.Models;\n\npublic record Customer\n{\n}\n`; `replaceNamespace` on `namespace MyApp.Namespace;` and on `namespace MyApp.Namespace\n{` blocks; a file without namespace unchanged).
- [ ] Use `namespaceSegment` in `NamespaceService.calculateExpectedNamespace` for the folder parts; its existing tests keep passing.
- [ ] Commit "item template helpers".

### Task 3: Project helpers

**Files:** Create `src/services/templates/newProject.ts`; Test `src/test/unit/services/templates/newProject.test.ts`

```ts
/** Relative to the solution dir: <most common parent of the project folders>/<name> */
export function defaultProjectLocation(solutionDir: string, projectPaths: string[], name: string): string;
export function mostCommonFramework(frameworksPerProject: string[][]): string | undefined; // ties: newest (sort desc)
export function isValidProjectName(name: string): boolean;
/** Choices of `--framework` in `dotnet new <t> -h` output */
export function frameworkChoices(helpOutput: string): string[];
export function findProjectFile(dir: string): string | undefined;           // *.csproj|*.fsproj|*.vbproj
```

- [ ] Tests: `src/A/A.csproj`, `src/B/B.csproj`, `tests/T/T.csproj` → `src/New`; projects next to the solution (`A/A.csproj`) → `New`; none → `New`. `frameworkChoices` on the classlib help text above → `['net10.0', 'netstandard2.1', 'netstandard2.0', 'net8.0']`.
- [ ] Commit "new project helpers".

### Task 4: Dependent renames

**Files:** Create `src/services/templates/dependentRenames.ts`; Test `src/test/unit/services/templates/dependentRenames.test.ts`

```ts
/** [from, to] for files nested (recursively) under `oldPath` in its directory, per FileNestingService */
export function dependentRenames(directoryFiles: string[], oldPath: string, newName: string): [string, string][];
```

- [ ] Tests: `Form1.cs` → `Main.cs` with `Form1.Designer.cs`, `Form1.resx` → both renamed; `Index.cshtml` → `Home.cshtml` with `Index.cshtml.cs`, `Index.cshtml.css` → renamed; unrelated `Form1Helper.cs` untouched; file without dependents → `[]`.
- [ ] Wire into `SolutionActionService._handleRename` for `nodeId.type === 'file'`: compute before renaming (read the directory), then after `renameFileAndType` rename each with `vscode.workspace.fs.rename` unless the target exists.
- [ ] Commit "rename nested files with their parent".

### Task 5: UI — Add New Item and Add New Project

**Files:** Create `src/services/templates/templateService.ts`; Modify `src/core/contextMenus.ts` (`addNewItem` on project and folder after `addFile`; `addNewProject` on solutionFolder), `src/types/commands/project-action.ts` (`addNewItem`), `src/types/commands/ui.ts` (`AddTemporaryNodeCmd.payload.name?`), `src/webview/solution-view/hooks/useVsCodeApi.ts` (temp node uses `name`), `src/webview/providers/SolutionWebviewProvider.ts`, `src/services/solutionActionService.ts`; run `npm run generate:menus`.

- [ ] `templateService.ts`:
  - `pickItemTemplate(projectPath): Promise<ItemChoice | undefined>` — built-ins, separator, `dotnet new` item templates for the project language grouped by first tag.
  - `createItem(choice, folder, name, projectPath): Promise<string | undefined>` — returns the file to open; built-in: write content (error when it exists); template: snapshot folder files, `dotnet new <short> -n <base> -o <folder> [--language]`, fix namespaces in new `.cs` files.
  - `addNewProject(solutionFolderPath?: string): Promise<void>` — the flow of spec §2 with `listTemplates('project')`, `context.globalState` recent list (`shinobi.recentProjectTemplates`), `defaultProjectLocation`, `frameworkChoices`, then `solution.addProject(projectFile, solutionFolderPath)`.
  - Output channel "Shinobi .NET: Templates"; failures show "Show Output".
- [ ] Provider: `addNewItem` → `pickItemTemplate`; language-less template → `createItem` directly; otherwise remember the choice in `_pendingItems` under the temporary node id and send `addTemporaryNode` with the default name. In the confirmed `addFile` branch, a pending choice for that node id goes to `createItem` instead of `createFile`; cancel and a plain `addFile` clear the entry. Open the returned file with `vscode.window.showTextDocument`.
- [ ] `_handleAddNewProject(nodeId)` → `addNewProject(nodeId.type === 'solutionFolder' ? this._solutionFolderPathOf(nodeId) : undefined)`.
- [ ] `npm run typecheck && npx jest && npm run build:dev`; commit "add new items and projects from dotnet new templates".

### Task 6: Integration test, README

- [ ] `src/test/unit/services/templates/templates.dotnet.test.ts` (skipped without dotnet): `dotnet new classlib` through the same command builder into a temporary .slnx solution and `Solution`-free `dotnet sln add`; `apicontroller` item gets the expected namespace after `replaceNamespace`.
- [ ] README: tick Phase 5 items (wording per what was built), drop the "Add New Project is a stub" known issue, Current Features entries. Commit and push.
