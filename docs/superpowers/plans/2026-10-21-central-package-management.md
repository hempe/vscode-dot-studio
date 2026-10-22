# Central Package Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The NuGet manager, the Dependencies tree and the Updates/Consolidate tabs work in solutions that use Central Package Management (CPM): versions come from where MSBuild takes them (`PackageVersion`, `VersionOverride`, `GlobalPackageReference`), changes are written where they belong (the extension edits `Directory.Packages.props` itself, formatting kept), and a change that reaches other projects is confirmed first, with "Set for this project only" as the alternative.

**Architecture:** The MSBuild evaluation `ProjectItemsService` already runs once per project (single-flight per project, one global `ConcurrencyLimit`, stale-while-revalidate) also asks for `PackageReference`, `PackageVersion`, `GlobalPackageReference` and the CPM properties; a pure `centralPackages.ts` turns that output into `ProjectPackages` (per reference: version and source `project | central | override | global`, plus the file the version is written in). `Project.dependencies` and the NuGet data read versions from it, so "Unknown" disappears and unknown versions are never "outdated". Changes are planned by a pure `centralPackagePlan.ts` (which files change, which other projects a change reaches), written by pure text edits in `centralPackageEdits.ts` (in the style of `ProjectFileEditor`), and run by `centralPackageOperations.ts` (confirmation modals, restore, re-evaluation). A watcher on `Directory.Packages.props` and on the props files it imports re-evaluates; props files outside the workspace are re-checked when the NuGet editor gets focus.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`/`noUnusedParameters`), VS Code extension API, React webview, Jest (`jsdom`, `@testing-library/react`), `dotnet msbuild -getItem/-getProperty`.

Spec: `docs/superpowers/specs/2026-10-21-central-package-management-design.md`.

**Verified with the .NET SDK 10.0.111 while planning** (scratch projects under `/tmp/cpmfix`, the same layout as the fixture of Task 2):
- `dotnet msbuild <proj> -nologo -getProperty:ManagePackageVersionsCentrally,DirectoryPackagesPropsPath,CentralPackageVersionOverrideEnabled -getItem:PackageReference,PackageVersion,GlobalPackageReference` prints, per item, `Identity`, `Version` (absent on a CPM reference, not empty), `VersionOverride` and `DefiningProjectFullPath`. A `PackageVersion` from a file imported by `Directory.Packages.props` reports that file.
- Asking for the item type `GlobalPackageReference` directly gives the props file that defines it (`DefiningProjectFullPath`) and its `Version`; the matching `PackageReference` and an extra `PackageVersion` are reported as defined in the SDK's `NuGet.targets` (the latter is ignored).
- `<GlobalPackageReference Remove="X" />` in a `.csproj` removes both the `GlobalPackageReference` and the `PackageReference` from that project's evaluation.
- A project with `<ManagePackageVersionsCentrally>false</ManagePackageVersionsCentrally>` under a `Directory.Packages.props` reports `false`, keeps its `Version` attributes, and still sees the `PackageVersion`/`GlobalPackageReference` items (they must be ignored then).
- `PackageReference` items carry a `FullPath` (project folder + package id): `parseMsbuildItems` must skip item types outside `ITEM_TYPES`, or packages would count as files.
- `IsImplicitlyDefined="true"` marks SDK references (`NETStandard.Library` on netstandard2.0): left out, like `dotnet list package` leaves out auto-referenced packages.
- The combined query (items + packages) takes about 0.55 s per project, the same as the items query alone.
- `dotnet list package --format json` reports the effective version of central, override and global references as `requestedVersion`.

**Deviations from the spec (decided while planning):**
- No second MSBuild query and no second queue: `ProjectItemsService` (the committed single-flight guard with its global limit) runs one evaluation that answers both the item overlay and the packages. `centralPackages.ts` has no runner of its own; tests inject the runner into `new ProjectItemsService(run)`.
- No XML reader for the import chain: MSBuild reports the file that defines each `PackageVersion` and `GlobalPackageReference` (verified above), and the edits find the element by its `Include` in that file. The watched files are `DirectoryPackagesPropsPath` plus every defining file. Limitation: an imported props file without any entry yet is not watched until it has one (Known limitations, Task 9).
- The confirmation is a native modal shown by the extension host (like Delete, Sync Namespaces and the namespace question), not a dialog in the webview: the host has the evaluation of every project. The webview shows where a version comes from (in the solution's manager also which projects share it; the project context only has its own project) and gets a "Set for this project only" button that sends `installPackage` with `versionScope: 'project'` (an extended message, no new one).
- `csproj` removals still go through `dotnet remove package` (it works under CPM, spec "Works already"); every other edit (props files, `VersionOverride`, global opt-outs, a `PackageReference` without `Version`) is ours.
- In the tree the source goes after the version with a comma: `Newtonsoft.Json (13.0.2, override)`, `Microsoft.SourceLink.GitHub (8.0.0, global)`; the NuGet manager shows `v13.0.2 (override)` and a `global` badge.
- Updating an override to the central version removes the `VersionOverride` (the project then follows the central version again).
- The confirmation only appears when a central or global edit reaches projects that were not selected for the change: in the solution context, updating a package for all projects that use it asks nothing.
- `Project.dependencies` takes all package references from the evaluation when there is one (also without CPM), so references added by a `Directory.Build.props` show as well; the parser's list stays the fallback.

**Conventions to follow (from CLAUDE.md and the memory notes):**
- Tests: `npx jest <path>`; the full suite is `npm test`; `npm run typecheck` before each commit. `noUnusedLocals`/`noUnusedParameters` break the build, also for private members left unused after a refactor.
- `npm run build:dev` builds two configurations: judge it by its exit code (`; echo "exit $?"`), not by its output.
- Extension-host tests mock `vscode` per file with `jest.mock('vscode', () => ({ … }), { virtual: true })` (copy the shape from `src/test/unit/core/Project.items.test.ts` where a `Project` is created); tests with a real `Project` stub `ProjectItemsService.instance.evaluate`.
- Real-MSBuild tests are skipped without `dotnet` (`spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip`, as in `src/test/unit/services/projectItems/projectItemEdits.msbuild.test.ts`), with a 150 s timeout.
- Windows is a CI gate: build every path in tests with `path.join`/`path.resolve`, never with `/` literals (file contents are text and stay as they are); compare paths from MSBuild after `path.normalize`.
- Webview code must not import `vscode`, Node modules or `nodeIdService`, and must not decode node ids (`src/test/unit/webview/shared/opaqueNodeIds.test.ts`); `src/test/unit/build/webviewBundle.test.ts` builds the bundle. Types the webview needs go in `src/services/nuget/types.ts` (no Node imports), never in `centralPackages.ts` (it imports `path`).
- No change to `src/core/contextMenus.ts`, so no `npm run generate:menus`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Commit to `master`, push after the last task (the user's workflow: no branches). `git add` only the files of the task, by path: other agents may have uncommitted work in the tree.
- Every task that changes what a user sees has its own docs step (docs page, manual-testing entries, GIF scene where it shows), in the same commit.

---

## File structure

| File | Responsibility |
|---|---|
| `src/parsers/projectFileEditor.ts` (modify) | its text helpers (`appendItemGroup`, `ignoredRanges`, `inRanges`, `deleteElement`, `lineIndent`, `escape`, `unescape`) become usable by the package edits |
| `src/services/nuget/centralPackageEdits.ts` (create) | pure text edits: `setPackageVersion`, `addPackageVersion`, `removePackageVersion`, `setGlobalPackageVersion`, `removeGlobalPackageReference`, `addPackageReference`, `setVersionOverride`, `removeVersionOverride`, `addGlobalOptOut`, `removeGlobalOptOut`, `applyEdit` |
| `src/services/nuget/centralPackages.ts` (create) | `ProjectPackages` model, `PACKAGE_PROPERTIES`/`PACKAGE_ITEM_TYPES`, `parseMsbuildPackages`, `packagesEqual`, `centralFiles`, `packageVersionFileFor` (pure) |
| `src/services/projectItems/projectItems.ts` (modify) | exports `parseMsbuildJson`; `parseMsbuildItems` keeps only `ITEM_TYPES` |
| `src/services/projectItems/projectItemsService.ts` (modify) | the one MSBuild run also asks for packages; `packages()`, `packagesVersion()` |
| `src/services/nuget/types.ts` (modify) | `PackageVersionSource`; `versionSource`/`versionFile` on `BasicInstalledPackage` |
| `src/core/Project.ts` (modify) | `dependencies` from the evaluation, tree labels, change event when only the packages changed |
| `src/services/nuget/packageInstalledService.ts`, `nugetManagerService.ts` (modify) | versions and sources from the evaluation (`withVersionSources` for the project context), no "Unknown", Updates/Consolidate ignore unknown versions |
| `src/services/versionUtils.ts` (modify) | `isOutdated(current, latest)` |
| `src/services/nuget/centralPackagePlan.ts` (create) | `planVersionChange`, `planUninstall`, `globalUninstallEdits`, `confirmationText`, `planConsolidate`, `consolidationText` (pure) |
| `src/services/nuget/centralPackageFiles.ts` (create) | `applyPackageEdits` (reads, edits, writes files; no `vscode`) |
| `src/services/nuget/centralPackageOperations.ts` (create) | host side: project states, confirmations, edits, restore, re-evaluation, orphan question, consolidation |
| `src/services/nuget/packageConsolidationService.ts`, `packageUpdateService.ts` (delete) | replaced by `consolidatePackages` and `changePackageVersions` |
| `src/types/commands/backend.ts` (modify) | `versionScope` on `installPackage` |
| `src/webview/providers/NuGetCustomEditorProvider.ts` (modify) | routes install/update/uninstall/consolidate through the operations, refreshes open editors after evaluations, re-checks props files on focus |
| `src/webview/nuget-view/versionLabels.ts` (create) | `versionLabel`, `isGlobal`, `centralNote`, `canSetForProjectOnly` (pure, browser-safe) |
| `src/webview/nuget-view/components/PackageList.tsx`, `ProjectList.tsx`, `PackageActions.tsx`, `App.tsx` (modify) | labels, "global" badge, where the version comes from, "Set for this project only" |
| `src/services/nuget/centralPackageWatch.ts` (create) | `stampOf`, `changedFiles`, `watchPlan` (pure) |
| `src/services/nuget/centralPackageWatchers.ts` (create) | watchers for imported props files, `recheck` for files outside the workspace |
| `src/extension.ts` (modify) | `Directory.Packages.props` in the props watcher, watchers for imported props files |
| `src/__fixtures__/central-packages/` (create) | `cpm/` (props + imported props, `App`, `Override`, `GlobalOnly`, `OptOut`, `Legacy`) and `plain/` (no CPM) |
| `docs/nuget.md`, `docs/solution-explorer.md`, `docs/manual-testing.md`, `docs/roadmap.md`, `docs/history.md`, `README.md`, `scripts/screenshots/capture.sh`, `docs/images/central-packages.gif` (modify/create) | docs, checks, GIF scene, roadmap and history |

Tests (create): `src/test/unit/services/nuget/centralPackageEdits.test.ts`, `centralPackages.test.ts`, `centralPackages.msbuild.test.ts`, `packageVersions.test.ts`, `centralPackagePlan.test.ts`, `centralPackageFiles.msbuild.test.ts`, `centralPackageOperations.test.ts`, `centralPackageWatch.test.ts` (also covers `CentralPackageWatchers`), `src/test/unit/core/Project.packages.test.ts`, `src/test/unit/webview/nuget-view/versionLabels.test.ts`, `src/test/unit/webview/nuget-view/CentralPackages.test.tsx`; `src/test/unit/services/projectItems/projectItemsService.test.ts` and `src/test/unit/services/projectItems/projectItems.test.ts` (extend).

---

### Task 1: Text edits for props and project files

**Files:**
- Modify: `src/parsers/projectFileEditor.ts`
- Create: `src/services/nuget/centralPackageEdits.ts`
- Test: `src/test/unit/services/nuget/centralPackageEdits.test.ts`

The edits reuse `ProjectFileEditor`'s helpers (comments and targets skipped, empty ItemGroups removed, CRLF kept), so those stop being private.

- [ ] **Step 1: Write the failing tests**

`src/test/unit/services/nuget/centralPackageEdits.test.ts`:
```ts
import {
    addGlobalOptOut, addPackageReference, addPackageVersion, applyEdit, removeGlobalOptOut, removeGlobalPackageReference,
    removePackageVersion, removeVersionOverride, setGlobalPackageVersion, setPackageVersion, setVersionOverride,
} from '../../../../services/nuget/centralPackageEdits';

const props = `<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Newtonsoft.Json" Version="13.0.1" />
    <!-- <PackageVersion Include="Serilog" Version="2.0.0" /> -->
    <PackageVersion Include="Serilog" Version="3.1.1" />
  </ItemGroup>
  <ItemGroup>
    <GlobalPackageReference Include="Microsoft.SourceLink.GitHub" Version="8.0.0" />
  </ItemGroup>
</Project>
`;

const project = `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" />
    <PackageReference Include="Serilog">
      <PrivateAssets>all</PrivateAssets>
    </PackageReference>
  </ItemGroup>

</Project>
`;

const lf = (text: string) => text.replace(/\r\n/g, '').includes('\n');

describe('central package edits: the props file', () => {
    test('setPackageVersion changes only the version of that package (ids ignore case, comments are skipped)', () => {
        expect(setPackageVersion(props, 'serilog', '4.0.0')).toBe(props.replace('Version="3.1.1"', 'Version="4.0.0"'));
    });

    test('setPackageVersion also sets a Version child element', () => {
        const child = props.replace('<PackageVersion Include="Serilog" Version="3.1.1" />',
            '<PackageVersion Include="Serilog">\n      <Version>3.1.1</Version>\n    </PackageVersion>');
        expect(setPackageVersion(child, 'Serilog', '4.0.0')).toBe(child.replace('<Version>3.1.1</Version>', '<Version>4.0.0</Version>'));
    });

    test('setPackageVersion refuses a package the file has no PackageVersion for', () => {
        expect(() => setPackageVersion(props, 'Polly', '8.1.0')).toThrow('No <PackageVersion Include="Polly">');
    });

    test('addPackageVersion goes after the last PackageVersion, with its indentation', () => {
        expect(addPackageVersion(props, 'Polly', '8.1.0')).toBe(props.replace(
            '    <PackageVersion Include="Serilog" Version="3.1.1" />\n',
            '    <PackageVersion Include="Serilog" Version="3.1.1" />\n    <PackageVersion Include="Polly" Version="8.1.0" />\n'));
    });

    test('addPackageVersion is a no-op when the package has one, and opens an ItemGroup in a file without any', () => {
        expect(addPackageVersion(props, 'newtonsoft.json', '1.0.0')).toBe(props);
        const empty = '<Project>\n  <PropertyGroup>\n    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>\n  </PropertyGroup>\n</Project>\n';
        expect(addPackageVersion(empty, 'Polly', '8.1.0')).toContain('  <ItemGroup>\n    <PackageVersion Include="Polly" Version="8.1.0" />\n  </ItemGroup>\n</Project>');
    });

    test('removePackageVersion deletes the line and leaves the commented one', () => {
        const removed = removePackageVersion(props, 'Serilog');
        expect(removed).toBe(props.replace('    <PackageVersion Include="Serilog" Version="3.1.1" />\n', ''));
    });

    test('global references: set the version, remove it with the ItemGroup it leaves empty', () => {
        expect(setGlobalPackageVersion(props, 'Microsoft.SourceLink.GitHub', '8.0.1')).toBe(props.replace('Version="8.0.0"', 'Version="8.0.1"'));
        expect(removeGlobalPackageReference(props, 'Microsoft.SourceLink.GitHub')).toBe(props.replace(
            '  <ItemGroup>\n    <GlobalPackageReference Include="Microsoft.SourceLink.GitHub" Version="8.0.0" />\n  </ItemGroup>\n', ''));
    });

    test('keeps CRLF line endings', () => {
        const crlf = props.replace(/\n/g, '\r\n');
        const added = addPackageVersion(crlf, 'Polly', '8.1.0');
        expect(added).toContain('<PackageVersion Include="Polly" Version="8.1.0" />');
        expect(lf(added)).toBe(false);
        expect(removeGlobalPackageReference(crlf, 'Microsoft.SourceLink.GitHub')).toBe(props.replace(
            '  <ItemGroup>\n    <GlobalPackageReference Include="Microsoft.SourceLink.GitHub" Version="8.0.0" />\n  </ItemGroup>\n', '').replace(/\n/g, '\r\n'));
    });
});

describe('central package edits: the project file', () => {
    test('setVersionOverride adds the attribute after Include, then changes it; removeVersionOverride takes it out again', () => {
        const set = setVersionOverride(project, 'Newtonsoft.Json', '13.0.2');
        expect(set).toBe(project.replace('<PackageReference Include="Newtonsoft.Json" />', '<PackageReference Include="Newtonsoft.Json" VersionOverride="13.0.2" />'));
        expect(setVersionOverride(set, 'Newtonsoft.Json', '13.0.3')).toContain('VersionOverride="13.0.3"');
        expect(removeVersionOverride(set, 'Newtonsoft.Json')).toBe(project);
    });

    test('setVersionOverride works on a PackageReference with children', () => {
        expect(setVersionOverride(project, 'Serilog', '4.0.0')).toContain('<PackageReference Include="Serilog" VersionOverride="4.0.0">');
    });

    test('addPackageReference goes after the last PackageReference, without a Version', () => {
        expect(addPackageReference(project, 'Polly')).toBe(project.replace('    </PackageReference>\n',
            '    </PackageReference>\n    <PackageReference Include="Polly" />\n'));
        expect(addPackageReference(project, 'polly'.toUpperCase())).not.toContain('Version=');
        expect(addPackageReference(project, 'serilog')).toBe(project);
    });

    test('global opt-out: added after the package references, removed again', () => {
        const optedOut = addGlobalOptOut(project, 'Microsoft.SourceLink.GitHub');
        expect(optedOut).toContain('    </PackageReference>\n    <GlobalPackageReference Remove="Microsoft.SourceLink.GitHub" />\n  </ItemGroup>');
        expect(addGlobalOptOut(optedOut, 'microsoft.sourcelink.github')).toBe(optedOut);
        expect(removeGlobalOptOut(optedOut, 'Microsoft.SourceLink.GitHub')).toBe(project);
    });

    test('applyEdit dispatches by kind', () => {
        expect(applyEdit(props, { kind: 'setPackageVersion', file: 'p', id: 'Serilog', version: '4.0.0' })).toContain('Include="Serilog" Version="4.0.0"');
        expect(applyEdit(project, { kind: 'addPackageReference', file: 'p', id: 'Polly' })).toContain('<PackageReference Include="Polly" />');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/test/unit/services/nuget/centralPackageEdits.test.ts`
Expected: FAIL (`Cannot find module '../../../../services/nuget/centralPackageEdits'`)

- [ ] **Step 3: Open up the helpers of `ProjectFileEditor`**

In `src/parsers/projectFileEditor.ts` change `private static` to `static` on exactly these seven methods (no other change; their bodies stay): `appendItemGroup`, `ignoredRanges`, `inRanges`, `deleteElement`, `lineIndent`, `escape`, `unescape`. Add one line to the class comment at the top: ` * Its text helpers are shared with the package edits (services/nuget/centralPackageEdits.ts).`

```bash
sed -i -E 's/^    private static (appendItemGroup|ignoredRanges|inRanges|deleteElement|lineIndent|escape|unescape)\(/    static \1(/' src/parsers/projectFileEditor.ts
grep -c "^    static \(appendItemGroup\|ignoredRanges\|inRanges\|deleteElement\|lineIndent\|escape\|unescape\)(" src/parsers/projectFileEditor.ts
```
Expected: `7`.

- [ ] **Step 4: Implement `src/services/nuget/centralPackageEdits.ts`**

```ts
import { ProjectFileEditor as Xml } from '../../parsers/projectFileEditor';

/**
 * Text edits of `Directory.Packages.props` (and the props files it imports) and of project files for Central
 * Package Management. Like `ProjectFileEditor` they keep formatting, comments and line endings; elements in
 * comments and targets are not touched. Package ids compare case-insensitively, as NuGet does.
 */

/** One change to one file; `file` is the props file or the project file it is applied to */
export type PackageEdit =
    | { readonly kind: 'setPackageVersion' | 'addPackageVersion' | 'setGlobalPackageVersion' | 'setVersionOverride'; readonly file: string; readonly id: string; readonly version: string }
    | { readonly kind: 'removePackageVersion' | 'removeGlobalPackageReference' | 'addPackageReference' | 'removeVersionOverride' | 'addGlobalOptOut' | 'removeGlobalOptOut'; readonly file: string; readonly id: string };

interface Element {
    readonly id: string;
    readonly start: number;
    readonly end: number;
}

/** `<Tag Attribute="id" .../>` or `<Tag Attribute="id">...</Tag>`, outside comments and targets, in document order */
function findElements(content: string, tag: string, attribute: 'Include' | 'Remove' = 'Include'): Element[] {
    const elementRe = new RegExp(`<${tag}\\b((?:[^>"']|"[^"]*"|'[^']*')*?)(?:\\/>|>[\\s\\S]*?<\\/${tag}\\s*>)`, 'g');
    const attributeRe = new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
    const ignored = Xml.ignoredRanges(content);
    const result: Element[] = [];
    for (const match of content.matchAll(elementRe)) {
        const found = attributeRe.exec(match[1]);
        if (found && !Xml.inRanges(ignored, match.index!)) {
            result.push({ id: Xml.unescape(found[1] ?? found[2]).trim(), start: match.index!, end: match.index! + match[0].length });
        }
    }
    return result;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function find(content: string, tag: string, id: string, attribute: 'Include' | 'Remove' = 'Include'): Element | undefined {
    return findElements(content, tag, attribute).find(element => same(element.id, id));
}

function existing(content: string, tag: string, id: string): Element {
    const element = find(content, tag, id);
    if (!element) {
        throw new Error(`No <${tag} Include="${id}"> in the file`);
    }
    return element;
}

const newline = (content: string) => content.includes('\r\n') ? '\r\n' : '\n';

/** Sets `name` on the element: the attribute, or a child element of that name; else a new attribute after Include */
function setMetadata(content: string, element: Element, name: string, value: string): string {
    const text = content.slice(element.start, element.end);
    const attribute = new RegExp(`(\\s${name}\\s*=\\s*)(?:"[^"]*"|'[^']*')`);
    const child = new RegExp(`(<${name}\\s*>)[^<]*(<\\/${name}\\s*>)`);
    const edited = attribute.test(text)
        ? text.replace(attribute, (_all, prefix: string) => `${prefix}"${Xml.escape(value)}"`)
        : child.test(text)
            ? text.replace(child, (_all, open: string, close: string) => `${open}${Xml.escape(value)}${close}`)
            : text.replace(/(\bInclude\s*=\s*(?:"[^"]*"|'[^']*'))/, `$1 ${name}="${Xml.escape(value)}"`);
    return content.slice(0, element.start) + edited + content.slice(element.end);
}

/** Removes the attribute or the child element `name` from the element */
function removeMetadata(content: string, element: Element, name: string): string {
    const text = content.slice(element.start, element.end);
    const edited = text
        .replace(new RegExp(`\\s+${name}\\s*=\\s*(?:"[^"]*"|'[^']*')`), '')
        .replace(new RegExp(`\\r?\\n[ \\t]*<${name}\\s*>[^<]*<\\/${name}\\s*>|<${name}\\s*>[^<]*<\\/${name}\\s*>`), '');
    return content.slice(0, element.start) + edited + content.slice(element.end);
}

/** A new element after the last `after` element (same indentation), else in a new ItemGroup at the end */
function insert(content: string, after: readonly Element[], element: string): string {
    const last = after[after.length - 1];
    if (last) {
        const indent = Xml.lineIndent(content, last.start);
        return content.slice(0, last.end) + newline(content) + indent + element + content.slice(last.end);
    }
    return Xml.appendItemGroup(content, indent => [indent + element]);
}

const versionElement = (tag: string, id: string, version: string) =>
    `<${tag} Include="${Xml.escape(id)}" Version="${Xml.escape(version)}" />`;

/** The central version of a package (`<PackageVersion Include="id" Version="..." />`) */
export function setPackageVersion(content: string, id: string, version: string): string {
    return setMetadata(content, existing(content, 'PackageVersion', id), 'Version', version);
}

/** Adds a `PackageVersion` after the last one of the file; nothing when the package has one already */
export function addPackageVersion(content: string, id: string, version: string): string {
    if (find(content, 'PackageVersion', id)) {
        return content;
    }
    return insert(content, findElements(content, 'PackageVersion'), versionElement('PackageVersion', id, version));
}

export function removePackageVersion(content: string, id: string): string {
    const element = find(content, 'PackageVersion', id);
    return element ? Xml.deleteElement(content, element.start, element.end) : content;
}

/** The version of a `<GlobalPackageReference Include="id" Version="..." />` */
export function setGlobalPackageVersion(content: string, id: string, version: string): string {
    return setMetadata(content, existing(content, 'GlobalPackageReference', id), 'Version', version);
}

export function removeGlobalPackageReference(content: string, id: string): string {
    const element = find(content, 'GlobalPackageReference', id);
    return element ? Xml.deleteElement(content, element.start, element.end) : content;
}

/** A `PackageReference` without a version (CPM), after the last one of the project file */
export function addPackageReference(content: string, id: string): string {
    if (find(content, 'PackageReference', id)) {
        return content;
    }
    return insert(content, findElements(content, 'PackageReference'), `<PackageReference Include="${Xml.escape(id)}" />`);
}

/** "Set for this project only": the project's own version of a centrally managed package */
export function setVersionOverride(content: string, id: string, version: string): string {
    return setMetadata(content, existing(content, 'PackageReference', id), 'VersionOverride', version);
}

export function removeVersionOverride(content: string, id: string): string {
    const element = find(content, 'PackageReference', id);
    return element ? removeMetadata(content, element, 'VersionOverride') : content;
}

/** `<GlobalPackageReference Remove="id" />`: the project does without a global package */
export function addGlobalOptOut(content: string, id: string): string {
    if (find(content, 'GlobalPackageReference', id, 'Remove')) {
        return content;
    }
    const optOuts = findElements(content, 'GlobalPackageReference', 'Remove');
    return insert(content, optOuts.length > 0 ? optOuts : findElements(content, 'PackageReference'), `<GlobalPackageReference Remove="${Xml.escape(id)}" />`);
}

export function removeGlobalOptOut(content: string, id: string): string {
    const element = find(content, 'GlobalPackageReference', id, 'Remove');
    return element ? Xml.deleteElement(content, element.start, element.end) : content;
}

/** Applies one planned edit to the text of its file */
export function applyEdit(content: string, edit: PackageEdit): string {
    switch (edit.kind) {
        case 'setPackageVersion': return setPackageVersion(content, edit.id, edit.version);
        case 'addPackageVersion': return addPackageVersion(content, edit.id, edit.version);
        case 'setGlobalPackageVersion': return setGlobalPackageVersion(content, edit.id, edit.version);
        case 'setVersionOverride': return setVersionOverride(content, edit.id, edit.version);
        case 'removePackageVersion': return removePackageVersion(content, edit.id);
        case 'removeGlobalPackageReference': return removeGlobalPackageReference(content, edit.id);
        case 'addPackageReference': return addPackageReference(content, edit.id);
        case 'removeVersionOverride': return removeVersionOverride(content, edit.id);
        case 'addGlobalOptOut': return addGlobalOptOut(content, edit.id);
        case 'removeGlobalOptOut': return removeGlobalOptOut(content, edit.id);
    }
}
```
(The helper that throws is called `existing`, not `require`: TypeScript reserves `require` at module level.)

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest src/test/unit/services/nuget/centralPackageEdits.test.ts src/test/unit/parsers`
Expected: PASS (13 new tests; the `ProjectFileEditor` tests unchanged). If an expectation differs only in blank lines, fix the edit, not the test: keeping the file exactly as it was apart from the one element is the contract.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/parsers/projectFileEditor.ts src/services/nuget/centralPackageEdits.ts src/test/unit/services/nuget/centralPackageEdits.test.ts
git commit -m "Central packages: text edits for Directory.Packages.props and project files

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Packages from the one MSBuild evaluation per project

**Files:**
- Create: `src/services/nuget/centralPackages.ts`
- Modify: `src/services/nuget/types.ts`, `src/services/projectItems/projectItems.ts`, `src/services/projectItems/projectItemsService.ts`
- Create: `src/__fixtures__/central-packages/` (see Step 1)
- Test: `src/test/unit/services/nuget/centralPackages.test.ts`, `src/test/unit/services/nuget/centralPackages.msbuild.test.ts` (create); `src/test/unit/services/projectItems/projectItemsService.test.ts`, `src/test/unit/services/projectItems/projectItems.test.ts` (extend)

`ProjectItemsService` is the guard every MSBuild evaluation goes through (one run per project at a time, a change during a run gives one re-run, at most `maxConcurrent` processes across projects, the last result kept while a new one runs). Its run asks for the package items and CPM properties too; a second service with its own queue would double the processes when a solution opens.

- [ ] **Step 1: Create the fixture**

`src/__fixtures__/central-packages/cpm/App/App.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" />
    <PackageReference Include="Serilog" />
    <PackageReference Include="Polly" />
  </ItemGroup>

</Project>
```

`src/__fixtures__/central-packages/cpm/Central.slnx`:
```xml
<Solution>
  <Project Path="App/App.csproj" />
  <Project Path="GlobalOnly/GlobalOnly.csproj" />
  <Project Path="Legacy/Legacy.csproj" />
  <Project Path="OptOut/OptOut.csproj" />
  <Project Path="Override/Override.csproj" />
</Solution>
```

`src/__fixtures__/central-packages/cpm/Directory.Packages.props`:
```xml
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
  <Import Project="Packages.Extra.props" />
  <ItemGroup>
    <PackageVersion Include="Newtonsoft.Json" Version="13.0.1" />
    <PackageVersion Include="Serilog" Version="3.1.1" />
  </ItemGroup>
  <ItemGroup>
    <GlobalPackageReference Include="Microsoft.SourceLink.GitHub" Version="8.0.0" />
  </ItemGroup>
</Project>
```

`src/__fixtures__/central-packages/cpm/GlobalOnly/GlobalOnly.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>

</Project>
```

`src/__fixtures__/central-packages/cpm/Legacy/Legacy.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <ManagePackageVersionsCentrally>false</ManagePackageVersionsCentrally>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Polly" Version="8.0.0" />
  </ItemGroup>

</Project>
```

`src/__fixtures__/central-packages/cpm/OptOut/OptOut.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Serilog" />
    <GlobalPackageReference Remove="Microsoft.SourceLink.GitHub" />
  </ItemGroup>

</Project>
```

`src/__fixtures__/central-packages/cpm/Override/Override.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" VersionOverride="13.0.2" />
  </ItemGroup>

</Project>
```

`src/__fixtures__/central-packages/cpm/Packages.Extra.props`:
```xml
<Project>
  <ItemGroup>
    <PackageVersion Include="Polly" Version="8.1.0" />
  </ItemGroup>
</Project>
```

`src/__fixtures__/central-packages/plain/Plain/Plain.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
  </ItemGroup>

</Project>
```

`src/__fixtures__/central-packages/README.md`:
```markdown
# Central Package Management fixtures

- `cpm/`: `Directory.Packages.props` turns CPM on, has `PackageVersion`s for Newtonsoft.Json and Serilog, imports
  `Packages.Extra.props` (Polly) and adds the global reference Microsoft.SourceLink.GitHub.
  - `App`: Newtonsoft.Json, Serilog, Polly from the central versions (and the global one)
  - `Override`: Newtonsoft.Json with `VersionOverride="13.0.2"`
  - `GlobalOnly`: no references of its own, only the global one
  - `OptOut`: Serilog, and `<GlobalPackageReference Remove=...>`: no global package
  - `Legacy`: `ManagePackageVersionsCentrally` false, its own `Version` (a mixed solution)
- `plain/`: no CPM at all

Nothing here is restored or built: the tests only evaluate the projects with MSBuild (no network).
```

- [ ] **Step 2: Write the failing tests**

`src/test/unit/services/nuget/centralPackages.test.ts`:
```ts
import * as path from 'path';
import { centralFiles, packageVersionFileFor, packagesEqual, parseMsbuildPackages } from '../../../../services/nuget/centralPackages';

const root = path.resolve('/work/repo');
const at = (...parts: string[]) => path.join(root, ...parts);
const props = at('Directory.Packages.props');
const extra = at('Packages.Extra.props');
const project = at('App', 'App.csproj');
const nugetTargets = path.resolve('/sdk/NuGet.targets');

/** The JSON `dotnet msbuild -getProperty:... -getItem:...` prints (only the fields the parser reads) */
const output = (properties: Record<string, string>, items: Record<string, object[]>) =>
    `MSBuild version 18\n${JSON.stringify({ Properties: properties, Items: items }, null, 2)}`;

const cpm = { ManagePackageVersionsCentrally: 'true', DirectoryPackagesPropsPath: props, CentralPackageVersionOverrideEnabled: '' };
const versions = [
    { Identity: 'Newtonsoft.Json', Version: '13.0.1', DefiningProjectFullPath: props },
    { Identity: 'Serilog', Version: '3.1.1', DefiningProjectFullPath: props },
    { Identity: 'Polly', Version: '8.1.0', DefiningProjectFullPath: extra },
    { Identity: 'Microsoft.SourceLink.GitHub', Version: '8.0.0', DefiningProjectFullPath: nugetTargets },
];
const globals = [{ Identity: 'Microsoft.SourceLink.GitHub', Version: '8.0.0', DefiningProjectFullPath: props }];

describe('parseMsbuildPackages', () => {
    const packages = parseMsbuildPackages(output(cpm, {
        PackageReference: [
            { Identity: 'Serilog', DefiningProjectFullPath: project },
            { Identity: 'Polly', DefiningProjectFullPath: project },
            { Identity: 'Newtonsoft.Json', VersionOverride: '13.0.2', DefiningProjectFullPath: project },
            { Identity: 'Microsoft.SourceLink.GitHub', Version: '', DefiningProjectFullPath: nugetTargets },
            { Identity: 'NETStandard.Library', Version: '2.0.3', IsImplicitlyDefined: 'true', DefiningProjectFullPath: nugetTargets },
        ],
        PackageVersion: versions,
        GlobalPackageReference: globals,
    }), project)!;

    test('knows that the project uses CPM, and which Directory.Packages.props', () => {
        expect(packages.centrallyManaged).toBe(true);
        expect(packages.propsPath).toBe(props);
        expect(packages.overridesEnabled).toBe(true);
    });

    test('every reference gets its version and where it comes from, sorted by id, SDK references left out', () => {
        expect(packages.references).toEqual([
            { id: 'Microsoft.SourceLink.GitHub', version: '8.0.0', source: 'global', versionFile: props },
            { id: 'Newtonsoft.Json', version: '13.0.2', source: 'override', versionFile: project },
            { id: 'Polly', version: '8.1.0', source: 'central', versionFile: extra },
            { id: 'Serilog', version: '3.1.1', source: 'central', versionFile: props },
        ]);
    });

    test('central versions without the global one (its PackageVersion comes from NuGet.targets), and the globals', () => {
        expect([...packages.centralVersions.keys()]).toEqual(['newtonsoft.json', 'serilog', 'polly']);
        expect(packages.globals).toEqual([{ id: 'Microsoft.SourceLink.GitHub', version: '8.0.0', file: props }]);
    });

    test('a CPM reference without a PackageVersion has no version (never "Unknown")', () => {
        const missing = parseMsbuildPackages(output(cpm, { PackageReference: [{ Identity: 'Nope', DefiningProjectFullPath: project }] }), project)!;
        expect(missing.references).toEqual([{ id: 'Nope', version: '', source: 'central', versionFile: undefined }]);
    });

    test('a project that turned CPM off keeps its own versions and ignores the central and global entries', () => {
        const legacy = parseMsbuildPackages(output({ ...cpm, ManagePackageVersionsCentrally: 'false' }, {
            PackageReference: [{ Identity: 'Polly', Version: '8.0.0', DefiningProjectFullPath: project }],
            PackageVersion: versions,
            GlobalPackageReference: globals,
        }), project)!;
        expect(legacy.centrallyManaged).toBe(false);
        expect(legacy.references).toEqual([{ id: 'Polly', version: '8.0.0', source: 'project', versionFile: project }]);
        expect(legacy.centralVersions.size).toBe(0);
        expect(legacy.globals).toEqual([]);
    });

    test('CentralPackageVersionOverrideEnabled false turns "Set for this project only" off', () => {
        expect(parseMsbuildPackages(output({ ...cpm, CentralPackageVersionOverrideEnabled: 'false' }, {}), project)!.overridesEnabled).toBe(false);
    });

    test('undefined without the CPM properties (an items-only output) or without JSON', () => {
        expect(parseMsbuildPackages(JSON.stringify({ Items: { Compile: [] } }), project)).toBeUndefined();
        expect(parseMsbuildPackages('error MSB1009', project)).toBeUndefined();
    });

    test('centralFiles lists Directory.Packages.props and every file defining an entry, once', () => {
        expect(centralFiles(packages).sort()).toEqual([props, extra].sort());
    });

    test('packagesEqual compares the content', () => {
        const again = parseMsbuildPackages(output(cpm, { PackageVersion: versions, GlobalPackageReference: globals }), project)!;
        const changed = parseMsbuildPackages(output(cpm, { PackageVersion: [{ ...versions[0], Version: '13.0.3' }], GlobalPackageReference: globals }), project)!;
        expect(packagesEqual(again, parseMsbuildPackages(output(cpm, { PackageVersion: versions, GlobalPackageReference: globals }), project)!)).toBe(true);
        expect(packagesEqual(again, changed)).toBe(false);
    });

    test('a new PackageVersion goes into Directory.Packages.props, or into the imported file that holds the versions', () => {
        expect(packageVersionFileFor(packages)).toBe(props);
        const onlyImported = parseMsbuildPackages(output(cpm, { PackageVersion: [versions[2]] }), project)!;
        expect(packageVersionFileFor(onlyImported)).toBe(extra);
        const none = parseMsbuildPackages(output(cpm, {}), project)!;
        expect(packageVersionFileFor(none)).toBe(props);
    });
});
```

`src/test/unit/services/nuget/centralPackages.msbuild.test.ts`:
```ts
import { spawnSync } from 'child_process';
import * as path from 'path';
import { ProjectItemsService } from '../../../../services/projectItems/projectItemsService';

/** The packages of the fixture as real MSBuild evaluates them (no restore, no network) */
const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip;
const TIMEOUT = 150000;

const fixture = path.resolve(__dirname, '../../../../__fixtures__/central-packages');
const cpm = (...parts: string[]) => path.join(fixture, 'cpm', ...parts);
const props = cpm('Directory.Packages.props');
const sources = async (project: string) => {
    const packages = await new ProjectItemsService().evaluatePackages(project);
    if (!packages) {
        throw new Error(`MSBuild could not evaluate ${project}`);
    }
    return packages.references.map(reference => `${reference.id} ${reference.version} ${reference.source} ${path.basename(reference.versionFile ?? '-')}`);
};

describe('Central Package Management against real MSBuild', () => {
    withDotnet('central versions, an imported props file and the global reference', async () => {
        expect(await sources(cpm('App', 'App.csproj'))).toEqual([
            'Microsoft.SourceLink.GitHub 8.0.0 global Directory.Packages.props',
            'Newtonsoft.Json 13.0.1 central Directory.Packages.props',
            'Polly 8.1.0 central Packages.Extra.props',
            'Serilog 3.1.1 central Directory.Packages.props',
        ]);
    }, TIMEOUT);

    withDotnet('a VersionOverride, a project with only the global reference, and an opt-out', async () => {
        expect(await sources(cpm('Override', 'Override.csproj'))).toEqual([
            'Microsoft.SourceLink.GitHub 8.0.0 global Directory.Packages.props',
            'Newtonsoft.Json 13.0.2 override Override.csproj',
        ]);
        expect(await sources(cpm('GlobalOnly', 'GlobalOnly.csproj'))).toEqual(['Microsoft.SourceLink.GitHub 8.0.0 global Directory.Packages.props']);
        expect(await sources(cpm('OptOut', 'OptOut.csproj'))).toEqual(['Serilog 3.1.1 central Directory.Packages.props']);
    }, TIMEOUT);

    withDotnet('a project that turned CPM off, and a solution without CPM', async () => {
        const legacy = await new ProjectItemsService().evaluatePackages(cpm('Legacy', 'Legacy.csproj'));
        expect(legacy?.centrallyManaged).toBe(false);
        expect(legacy?.propsPath).toBe(props);
        expect(await sources(cpm('Legacy', 'Legacy.csproj'))).toEqual(['Polly 8.0.0 project Legacy.csproj']);
        expect(await sources(path.join(fixture, 'plain', 'Plain', 'Plain.csproj'))).toEqual(['Newtonsoft.Json 13.0.3 project Plain.csproj']);
    }, TIMEOUT);

    withDotnet('the item list of the same evaluation has no package entries', async () => {
        const service = new ProjectItemsService();
        const items = await service.evaluate(cpm('App', 'App.csproj'));
        expect(items?.isIncluded(cpm('App', 'Serilog'))).toBe(false);
        expect(service.packages(cpm('App', 'App.csproj'))?.centrallyManaged).toBe(true);
    }, TIMEOUT);
});
```

Extend the two items tests (the new `describe` goes before the last `});` of `projectItemsService.test.ts`; it uses that file's `fixture` and `dir`):
```diff
--- a/src/test/unit/services/projectItems/projectItemsService.test.ts
+++ b/src/test/unit/services/projectItems/projectItemsService.test.ts
@@ -220,43 +220,6 @@
         expect(run).toHaveBeenCalledTimes(2);
     });
 
-    test('evaluatedAt is when the MSBuild run of the published list started: the re-run after a change, not the outdated run', async () => {
-        const runs = deferredRuns();
-        let clock = 1000;
-        const service = new ProjectItemsService(runs.run, 2, () => clock);
-        expect(service.evaluatedAt(fixture)).toBeUndefined();
-        const result = service.evaluate(fixture);
-        await settle();
-        clock = 2000;
-        service.invalidate(fixture);
-        runs.finish(output('Stale.cs'));
-        await settle();
-        clock = 3000;
-        runs.finish(output('Fresh.cs'));
-        await result;
-        expect(service.evaluatedAt(fixture)).toBe(2000);
-    });
-
-    test('evaluatedAt moves on when an evaluation confirms the same list, and stays when one fails', async () => {
-        let clock = 1000;
-        const run = jest.fn()
-            .mockResolvedValueOnce(output('A.cs'))
-            .mockResolvedValueOnce(output('A.cs'))
-            .mockRejectedValueOnce(new Error('broken csproj'));
-        const service = new ProjectItemsService(run, 2, () => clock);
-        await service.evaluate(fixture);
-        const version = service.version(fixture);
-        clock = 5000;
-        service.invalidate(fixture);
-        await service.evaluate(fixture);
-        expect(service.evaluatedAt(fixture)).toBe(5000);
-        expect(service.version(fixture)).toBe(version);
-        clock = 9000;
-        service.invalidate(fixture);
-        await service.evaluate(fixture);
-        expect(service.evaluatedAt(fixture)).toBe(5000);
-    });
-
     test('tells listeners when a project was evaluated', async () => {
         const service = new ProjectItemsService(jest.fn().mockResolvedValue(output('A.cs')));
         const listener = jest.fn();
@@ -324,4 +287,49 @@
         expect(items!.isIncluded(path.join(dir, 'Excluded', 'Skip.cs'))).toBe(false);
         expect(items!.linkedFilesIn(path.join(dir, 'Linked')).map(item => path.basename(item.fullPath))).toEqual(['Shared.cs']);
     }, 150000);
+    describe('packages from the same evaluation', () => {
+        const withPackages = (version: string) => JSON.stringify({
+            Properties: { ManagePackageVersionsCentrally: 'true', DirectoryPackagesPropsPath: path.join(dir, 'Directory.Packages.props') },
+            Items: {
+                Compile: [{ Identity: 'A.cs', FullPath: path.join(dir, 'A.cs') }],
+                PackageReference: [{ Identity: 'Serilog', FullPath: path.join(dir, 'Serilog'), DefiningProjectFullPath: fixture }],
+                PackageVersion: [{ Identity: 'Serilog', Version: version, DefiningProjectFullPath: path.join(dir, 'Directory.Packages.props') }],
+            },
+        });
+
+        test('one MSBuild run gives the items and the packages', async () => {
+            const run = jest.fn().mockResolvedValue(withPackages('3.1.1'));
+            const service = new ProjectItemsService(run);
+            expect((await service.evaluatePackages(fixture))?.references).toEqual([
+                { id: 'Serilog', version: '3.1.1', source: 'central', versionFile: path.join(dir, 'Directory.Packages.props') },
+            ]);
+            expect(service.get(fixture)?.isIncluded(path.join(dir, 'A.cs'))).toBe(true);
+            expect(run).toHaveBeenCalledTimes(1);
+        });
+
+        test('packagesVersion changes when only the packages changed (a Directory.Packages.props edit), not otherwise', async () => {
+            const run = jest.fn().mockResolvedValueOnce(withPackages('3.1.1')).mockResolvedValueOnce(withPackages('3.1.1')).mockResolvedValueOnce(withPackages('4.0.0'));
+            const service = new ProjectItemsService(run);
+            await service.evaluate(fixture);
+            const first = service.packagesVersion(fixture);
+            const items = service.version(fixture);
+            service.invalidate(fixture);
+            await service.evaluate(fixture);
+            expect(service.packagesVersion(fixture)).toBe(first);
+            service.invalidate(fixture);
+            await service.evaluate(fixture);
+            expect(service.packagesVersion(fixture)).toBe(first + 1);
+            expect(service.version(fixture)).toBe(items);
+            expect(service.packages(fixture)?.references[0].version).toBe('4.0.0');
+        });
+
+        test('a failing run keeps the last packages', async () => {
+            const run = jest.fn().mockResolvedValueOnce(withPackages('3.1.1')).mockRejectedValueOnce(new Error('timeout'));
+            const service = new ProjectItemsService(run);
+            await service.evaluate(fixture);
+            service.invalidate(fixture);
+            await service.evaluate(fixture);
+            expect(service.packages(fixture)?.references[0].version).toBe('3.1.1');
+        });
+    });
 });
--- a/src/test/unit/services/projectItems/projectItems.test.ts
+++ b/src/test/unit/services/projectItems/projectItems.test.ts
@@ -18,6 +18,11 @@
 describe('parseMsbuildItems', () => {
     const items = parseMsbuildItems(json, dir)!;
 
+    test('packages of the same evaluation are not files (PackageReference has a FullPath too)', () => {
+        const withPackages = JSON.stringify({ Items: { ...JSON.parse(json).Items, PackageReference: [{ Identity: 'Serilog', FullPath: at('Serilog') }] } });
+        expect(parseMsbuildItems(withPackages, dir)!.isIncluded(at('Serilog'))).toBe(false);
+    });
+
     test('knows what is included and with which item type', () => {
         expect(items.isIncluded(at('Program.cs'))).toBe(true);
         expect(items.itemTypeOf(at('notes.txt'))).toBe('None');
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx jest src/test/unit/services/nuget/centralPackages src/test/unit/services/projectItems`
Expected: FAIL (`Cannot find module '../../../../services/nuget/centralPackages'`, `evaluatePackages is not a function`, and the `PackageReference` item counted as a file)

- [ ] **Step 4: Implement `src/services/nuget/centralPackages.ts`**

```ts
import * as path from 'path';
import { parseMsbuildJson } from '../projectItems/projectItems';
import { PackageVersionSource } from './types';

/** Asked of MSBuild together with the project items: one evaluation per project answers both */
export const PACKAGE_PROPERTIES = ['ManagePackageVersionsCentrally', 'DirectoryPackagesPropsPath', 'CentralPackageVersionOverrideEnabled'] as const;
export const PACKAGE_ITEM_TYPES = ['PackageReference', 'PackageVersion', 'GlobalPackageReference'] as const;

/** A package the project references, with the version MSBuild gives it and where that version is written */
export interface PackageReferenceInfo {
    readonly id: string;
    /** The effective version; '' when there is none (CPM without a PackageVersion for it) */
    readonly version: string;
    readonly source: PackageVersionSource;
    /** The file the version is written in: the project file (project, override) or a props file (central, global) */
    readonly versionFile?: string;
}

/** A `PackageVersion` or `GlobalPackageReference` entry and the props file it is in */
export interface CentralEntry {
    readonly id: string;
    readonly version: string;
    readonly file: string;
}

/** What MSBuild says about a project's packages */
export interface ProjectPackages {
    readonly projectPath: string;
    /** `ManagePackageVersionsCentrally` is true for the project */
    readonly centrallyManaged: boolean;
    /** The `Directory.Packages.props` MSBuild picked (also set when the project turned CPM off) */
    readonly propsPath?: string;
    /** `CentralPackageVersionOverrideEnabled` is not false: "Set for this project only" may write a VersionOverride */
    readonly overridesEnabled: boolean;
    /** Sorted by id; SDK references (`IsImplicitlyDefined`) left out */
    readonly references: readonly PackageReferenceInfo[];
    /** The `PackageVersion` entries the project sees, by lower-case id (CPM only; global ones not included) */
    readonly centralVersions: ReadonlyMap<string, CentralEntry>;
    /** The `GlobalPackageReference` entries the project gets (CPM only; opted-out ones are missing) */
    readonly globals: readonly CentralEntry[];
}

interface MsbuildPackageItem {
    readonly Identity?: string;
    readonly Version?: string;
    readonly VersionOverride?: string;
    readonly DefiningProjectFullPath?: string;
    readonly IsImplicitlyDefined?: string;
}

const isTrue = (value: string | undefined) => (value ?? '').trim().toLowerCase() === 'true';
const isFalse = (value: string | undefined) => (value ?? '').trim().toLowerCase() === 'false';
const definedIn = (item: MsbuildPackageItem) => item.DefiningProjectFullPath ? path.normalize(item.DefiningProjectFullPath) : '';

/**
 * Reads the packages from the output of the evaluation (`-getProperty` with PACKAGE_PROPERTIES, `-getItem` with
 * PACKAGE_ITEM_TYPES); undefined when the output has no properties (not asked, or not the JSON result).
 */
export function parseMsbuildPackages(output: string, projectPath: string): ProjectPackages | undefined {
    const parsed = parseMsbuildJson(output);
    const properties = parsed?.Properties;
    if (!properties || !('ManagePackageVersionsCentrally' in properties)) {
        return undefined;
    }
    const items = (parsed.Items ?? {}) as unknown as Record<string, MsbuildPackageItem[] | undefined>;
    const centrallyManaged = isTrue(properties.ManagePackageVersionsCentrally);
    const entry = (item: MsbuildPackageItem): CentralEntry => ({ id: item.Identity!, version: item.Version ?? '', file: definedIn(item) });

    const globals = centrallyManaged ? (items.GlobalPackageReference ?? []).filter(item => item.Identity).map(entry) : [];
    const globalById = new Map(globals.map(global => [global.id.toLowerCase(), global]));
    const centralVersions = new Map<string, CentralEntry>();
    if (centrallyManaged) {
        for (const item of items.PackageVersion ?? []) {
            // A global reference also makes a PackageVersion, defined in the SDK's NuGet.targets: not an entry of ours
            if (item.Identity && !globalById.has(item.Identity.toLowerCase())) {
                centralVersions.set(item.Identity.toLowerCase(), entry(item));
            }
        }
    }

    const references: PackageReferenceInfo[] = [];
    for (const item of items.PackageReference ?? []) {
        if (!item.Identity || isTrue(item.IsImplicitlyDefined)) {
            continue;
        }
        const key = item.Identity.toLowerCase();
        const global = globalById.get(key);
        const central = centralVersions.get(key);
        if (global) {
            references.push({ id: global.id, version: global.version, source: 'global', versionFile: global.file });
        } else if (centrallyManaged && item.VersionOverride) {
            references.push({ id: item.Identity, version: item.VersionOverride, source: 'override', versionFile: definedIn(item) });
        } else if (centrallyManaged && !item.Version) {
            references.push({ id: item.Identity, version: central?.version ?? '', source: 'central', versionFile: central?.file });
        } else {
            references.push({ id: item.Identity, version: item.Version ?? '', source: 'project', versionFile: definedIn(item) });
        }
    }
    references.sort((a, b) => a.id.localeCompare(b.id, undefined, { sensitivity: 'base' }));

    return {
        projectPath,
        centrallyManaged,
        propsPath: properties.DirectoryPackagesPropsPath ? path.normalize(properties.DirectoryPackagesPropsPath) : undefined,
        overridesEnabled: !isFalse(properties.CentralPackageVersionOverrideEnabled),
        references,
        centralVersions,
        globals,
    };
}

const comparable = (packages: ProjectPackages) => JSON.stringify({
    ...packages,
    centralVersions: [...packages.centralVersions.entries()].sort(([a], [b]) => a.localeCompare(b)),
});

/** Whether two evaluations say the same about the packages (a new one that does not changes nothing on screen) */
export function packagesEqual(a: ProjectPackages, b: ProjectPackages): boolean {
    return comparable(a) === comparable(b);
}

/** The props files the project's central versions come from: `Directory.Packages.props` and every file defining an entry */
export function centralFiles(packages: ProjectPackages): string[] {
    if (!packages.centrallyManaged) {
        return [];
    }
    const files = [packages.propsPath, ...[...packages.centralVersions.values()].map(entry => entry.file), ...packages.globals.map(entry => entry.file)];
    return [...new Set(files.filter((file): file is string => !!file))];
}

/**
 * Where a new `PackageVersion` goes: the `Directory.Packages.props` MSBuild picked when it holds entries (or no file
 * does), else the props file that holds the most of them (an imported one that keeps the versions).
 */
export function packageVersionFileFor(packages: ProjectPackages): string | undefined {
    const counts = new Map<string, number>();
    for (const entry of packages.centralVersions.values()) {
        counts.set(entry.file, (counts.get(entry.file) ?? 0) + 1);
    }
    if (packages.propsPath && (counts.size === 0 || counts.has(packages.propsPath))) {
        return packages.propsPath;
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? packages.propsPath;
}
```

- [ ] **Step 5: The type, the JSON reader, and the evaluation**

`PackageVersionSource` goes into `types.ts` (no Node imports) because the webview uses it in Task 7. `parseMsbuildJson` becomes exported, `parseMsbuildItems` skips the package item types, and `ProjectItemsService` asks for packages in the same run, publishes them with their own version counter, and keeps the last ones when a run fails:
```diff
--- a/src/services/projectItems/projectItemsService.ts
+++ b/src/services/projectItems/projectItemsService.ts
@@ -5,16 +5,21 @@
 import { logger } from '../../core/logger';
 import { ConcurrencyLimit, SingleFlight } from '../singleFlight';
 import { ITEM_TYPES, ProjectItems, crossTargetingFramework, parseMsbuildItems } from './projectItems';
+import { PACKAGE_ITEM_TYPES, PACKAGE_PROPERTIES, ProjectPackages, packagesEqual, parseMsbuildPackages } from '../nuget/centralPackages';
 
 const execFileAsync = promisify(execFile);
 const log = logger('ProjectItems');
 
 export type RunMsbuild = (projectPath: string) => Promise<string>;
 
-/** Starts `dotnet msbuild` (twice for a multi-targeted project: the items exist per target framework) */
+/**
+ * Starts `dotnet msbuild` (twice for a multi-targeted project: the items exist per target framework). The same run
+ * answers what the project contains and its packages (Central Package Management), so a project is evaluated once.
+ */
 export const runMsbuild: RunMsbuild = async projectPath => {
     const run = async (...extra: string[]) => (await execFileAsync('dotnet',
-        ['msbuild', projectPath, '-nologo', `-getItem:${ITEM_TYPES.join(',')}`, '-getProperty:TargetFramework,TargetFrameworks', ...extra],
+        ['msbuild', projectPath, '-nologo', `-getItem:${[...ITEM_TYPES, ...PACKAGE_ITEM_TYPES].join(',')}`,
+            `-getProperty:${['TargetFramework', 'TargetFrameworks', ...PACKAGE_PROPERTIES].join(',')}`, ...extra],
         { cwd: path.dirname(projectPath), timeout: 120000, maxBuffer: 64 * 1024 * 1024 })).stdout;
     const stdout = await run();
     // A multi-targeted project has its items only per target framework
@@ -22,6 +27,12 @@
     return framework ? run(`-p:TargetFramework=${framework}`) : stdout;
 };
 
+/** What one MSBuild run gave: undefined parts were not in the output (or MSBuild failed) */
+interface Evaluation {
+    readonly items?: ProjectItems;
+    readonly packages?: ProjectPackages;
+}
+
 /**
  * What each project contains according to MSBuild (globs, `Remove`, `DefaultItemExcludes`, `Link`, props files).
  * Evaluating starts a process, so results are cached until the project file or a props file changes. After a
@@ -39,16 +50,16 @@
     // Projects whose cached result is outdated: still returned by `get`, but `evaluate` runs MSBuild again
     private readonly stale = new Set<string>();
     private readonly versions = new Map<string, number>();
-    // When the MSBuild run behind the cached list started (a later run giving the same list moves it on)
-    private readonly evaluated = new Map<string, number>();
     private readonly listeners = new Set<(projectPath: string) => void>();
+    // The packages of the same evaluation; an evaluation without them keeps the last ones
+    private readonly packageCache = new Map<string, ProjectPackages>();
+    private readonly packageVersions = new Map<string, number>();
     // Opening a solution evaluates every project: start at most `maxConcurrent` processes at once
     private readonly flights: SingleFlight<ProjectItems | undefined>;
 
     constructor(
         private readonly run: RunMsbuild = runMsbuild,
         maxConcurrent = Math.max(2, Math.floor(os.cpus().length / 2)),
-        private readonly now: () => number = Date.now,
     ) {
         this.flights = new SingleFlight(new ConcurrencyLimit(maxConcurrent));
     }
@@ -63,12 +74,20 @@
         return this.versions.get(projectPath) ?? 0;
     }
 
-    /**
-     * When the MSBuild run behind the cached list started (ms since the epoch): a file created later may be missing
-     * from the list. Undefined while there is no list.
-     */
-    evaluatedAt(projectPath: string): number | undefined {
-        return this.evaluated.get(projectPath);
+    /** The packages of the last evaluation (possibly outdated while a new one runs), without starting one */
+    packages(projectPath: string): ProjectPackages | undefined {
+        return this.packageCache.get(projectPath);
+    }
+
+    /** Changes whenever the result `packages` returns changes */
+    packagesVersion(projectPath: string): number {
+        return this.packageVersions.get(projectPath) ?? 0;
+    }
+
+    /** The packages, after the evaluation running (or started now) for the project */
+    async evaluatePackages(projectPath: string): Promise<ProjectPackages | undefined> {
+        await this.evaluate(projectPath);
+        return this.packages(projectPath);
     }
 
     /** The cached result, or the result of the evaluation running (or started now) for the project */
@@ -76,28 +95,32 @@
         if (this.cache.has(projectPath) && !this.stale.has(projectPath)) {
             return Promise.resolve(this.get(projectPath));
         }
-        return this.flights.run(projectPath, () => this.evaluateNow(projectPath), items => this.publish(projectPath, items));
+        return this.flights.run(projectPath, () => this.evaluateNow(projectPath), evaluation => this.publish(projectPath, evaluation));
     }
 
-    private async evaluateNow(projectPath: string): Promise<{ items: ProjectItems | undefined; startedAt: number }> {
-        const startedAt = this.now();
+    private async evaluateNow(projectPath: string): Promise<Evaluation> {
         try {
-            const items = parseMsbuildItems(await this.run(projectPath), path.dirname(projectPath));
+            const output = await this.run(projectPath);
+            const items = parseMsbuildItems(output, path.dirname(projectPath));
             if (!items) {
                 log.warn(`MSBuild gave no item list for ${projectPath}`);
             }
-            return { items, startedAt };
+            return { items, packages: parseMsbuildPackages(output, projectPath) };
         } catch (error) {
             log.warn(`Could not evaluate the items of ${projectPath}:`, error);
-            return { items: undefined, startedAt };
+            return {};
         }
     }
 
-    private publish(projectPath: string, { items, startedAt }: { items: ProjectItems | undefined; startedAt: number }): ProjectItems | undefined {
+    private publish(projectPath: string, { items, packages }: Evaluation): ProjectItems | undefined {
         this.stale.delete(projectPath);
+        const previousPackages = this.packageCache.get(projectPath);
+        if (packages && (!previousPackages || !packagesEqual(previousPackages, packages))) {
+            this.packageCache.set(projectPath, packages);
+            this.packageVersions.set(projectPath, this.packagesVersion(projectPath) + 1);
+        }
         const previous = this.get(projectPath);
         if (items) {
-            this.evaluated.set(projectPath, startedAt);
             if (!previous || !previous.equals(items)) {
                 this.cache.set(projectPath, items);
                 this.versions.set(projectPath, this.version(projectPath) + 1);
--- a/src/services/projectItems/projectItems.ts
+++ b/src/services/projectItems/projectItems.ts
@@ -150,10 +150,10 @@
 
 interface MsbuildItem { FullPath?: string; Identity?: string; Link?: string }
 
-interface MsbuildResult { Items?: Record<string, MsbuildItem[]>; Properties?: Record<string, string> }
+export interface MsbuildResult { Items?: Record<string, MsbuildItem[]>; Properties?: Record<string, string> }
 
 /** The JSON MSBuild prints for `-getItem`/`-getProperty`, after any banner lines; undefined when there is none */
-function parseMsbuildJson(output: string): MsbuildResult | undefined {
+export function parseMsbuildJson(output: string): MsbuildResult | undefined {
     const match = /^[ \t]*\{/m.exec(output);
     if (!match) {
         return undefined;
@@ -186,6 +186,10 @@
     }
     const entries: Entry[] = [];
     for (const [itemType, items] of Object.entries(parsed.Items ?? {})) {
+        // The same evaluation lists packages (PackageReference has a FullPath too): only files count
+        if (!(ITEM_TYPES as readonly string[]).includes(itemType)) {
+            continue;
+        }
         for (const item of items) {
             const fullPath = item.FullPath ?? (item.Identity ? path.resolve(projectDir, item.Identity) : undefined);
             if (!fullPath) {
--- a/src/services/nuget/types.ts
+++ b/src/services/nuget/types.ts
@@ -2,6 +2,12 @@
  * Types for NuGet Package Manager services using dotnet CLI
  */
 
+/**
+ * Where the version of a package reference comes from: the project file (`Version`), the central
+ * `PackageVersion` of Central Package Management, the project's `VersionOverride`, or a `GlobalPackageReference`
+ */
+export type PackageVersionSource = 'project' | 'central' | 'override' | 'global';
+
 // ============ BASIC TYPES (Internal Use Only) ============
 // These are intermediate types from dotnet CLI commands, before NuGet API enrichment
 
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx jest src/test/unit/services/nuget/centralPackages src/test/unit/services/projectItems src/test/unit/core/Project.items.test.ts`
Expected: PASS; with `dotnet` installed the four real-MSBuild tests run (about 5 s each) and pass. The existing items tests are unchanged: their outputs have no `Properties`, so `parseMsbuildPackages` gives undefined and nothing is published for packages.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/services/nuget/centralPackages.ts src/services/nuget/types.ts src/services/projectItems/projectItems.ts src/services/projectItems/projectItemsService.ts src/__fixtures__/central-packages src/test/unit/services/nuget/centralPackages.test.ts src/test/unit/services/nuget/centralPackages.msbuild.test.ts src/test/unit/services/projectItems/projectItemsService.test.ts src/test/unit/services/projectItems/projectItems.test.ts
git commit -m "Central packages: the project evaluation also reads package versions and their sources

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Versions and sources in the tree and the NuGet data; "Unknown" and the false updates go

**Files:**
- Modify: `src/services/nuget/types.ts`, `src/core/Project.ts`, `src/services/versionUtils.ts`, `src/services/nuget/packageInstalledService.ts`, `src/services/nuget/nugetManagerService.ts`
- Test: `src/test/unit/core/Project.packages.test.ts`, `src/test/unit/services/nuget/packageVersions.test.ts` (create)
- Docs: `docs/solution-explorer.md`, `docs/nuget.md`, `docs/manual-testing.md`

What the spike found broken: every CPM package showed "Unknown" (installed list) or no version (tree), overrides were ignored, global packages were missing, and the Updates tab listed every CPM package (`VersionUtils.compare(x, 'Unknown')`). The Updates filter also listed a package whose installed version is *newer* than the latest one shown (a prerelease with "Include prerelease" off): it pushed any package whose version string differed. `isOutdated` fixes both.

- [ ] **Step 1: Write the failing tests**

`src/test/unit/core/Project.packages.test.ts`:
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
import { Project, dependencyLabel } from '../../../core/Project';
import { parseMsbuildPackages } from '../../../services/nuget/centralPackages';
import { ProjectItemsService } from '../../../services/projectItems/projectItemsService';
import { NodeIdService } from '../../../services/nodeIdService';

describe('Project dependencies with Central Package Management', () => {
    let dir: string;
    let projectPath: string;
    let props: string;

    beforeEach(() => {
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-project-')));
        projectPath = path.join(dir, 'App.csproj');
        props = path.join(dir, 'Directory.Packages.props');
        // What the parser sees: no versions
        fs.writeFileSync(projectPath, '<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup>\n    <PackageReference Include="Serilog" />\n'
            + '    <PackageReference Include="Newtonsoft.Json" VersionOverride="13.0.2" />\n    <ProjectReference Include="..\\Lib\\Lib.csproj" />\n  </ItemGroup>\n</Project>\n');
        jest.spyOn(ProjectItemsService.instance, 'evaluate').mockResolvedValue(undefined);
    });
    afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); jest.restoreAllMocks(); });

    const evaluated = () => parseMsbuildPackages(JSON.stringify({
        Properties: { ManagePackageVersionsCentrally: 'true', DirectoryPackagesPropsPath: props },
        Items: {
            PackageReference: [
                { Identity: 'Serilog', DefiningProjectFullPath: projectPath },
                { Identity: 'Newtonsoft.Json', VersionOverride: '13.0.2', DefiningProjectFullPath: projectPath },
                { Identity: 'Microsoft.SourceLink.GitHub', Version: '', DefiningProjectFullPath: path.join(dir, 'NuGet.targets') },
            ],
            PackageVersion: [{ Identity: 'Serilog', Version: '3.1.1', DefiningProjectFullPath: props }],
            GlobalPackageReference: [{ Identity: 'Microsoft.SourceLink.GitHub', Version: '8.0.0', DefiningProjectFullPath: props }],
        },
    }), projectPath);

    const newProject = async () => {
        const project = new Project(projectPath, { name: 'App', path: 'App.csproj', guid: 'g', typeGuid: 't' } as never);
        while (!project.isInitialized) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        return project;
    };
    const packageNames = (project: Project) => project.getDependenciesByCategory(NodeIdService.parse(NodeIdService.generateDependencyCategoryId(projectPath, 'packages')))
        .map(child => child.name);

    test('before MSBuild has evaluated the project, the tree shows what the project file says', async () => {
        jest.spyOn(ProjectItemsService.instance, 'packages').mockReturnValue(undefined);
        expect(packageNames(await newProject())).toEqual(['Newtonsoft.Json', 'Serilog']);
    });

    test('then the central versions, the override and the global package', async () => {
        jest.spyOn(ProjectItemsService.instance, 'packages').mockReturnValue(evaluated());
        const project = await newProject();
        expect(packageNames(project)).toEqual(['Microsoft.SourceLink.GitHub (8.0.0, global)', 'Newtonsoft.Json (13.0.2, override)', 'Serilog (3.1.1)']);
        expect(project.dependencies.filter(dependency => dependency.type === 'ProjectReference').map(dependency => dependency.name)).toEqual(['Lib']);
        expect(project.dependencies.find(dependency => dependency.name === 'Serilog')).toEqual(
            { name: 'Serilog', version: '3.1.1', type: 'PackageReference', versionSource: 'central', versionFile: props });
    });

    test('the dependency node ids keep the plain version', async () => {
        jest.spyOn(ProjectItemsService.instance, 'packages').mockReturnValue(evaluated());
        const project = await newProject();
        const node = project.getDependenciesByCategory(NodeIdService.parse(NodeIdService.generateDependencyCategoryId(projectPath, 'packages')))
            .find(child => child.name.startsWith('Newtonsoft.Json'))!;
        expect(node.nodeId).toBe(NodeIdService.generateDependencyId(projectPath, 'packages', 'Newtonsoft.Json', '13.0.2'));
    });

    test('dependencyLabel', () => {
        expect(dependencyLabel({ name: 'A', version: '1.0.0', versionSource: 'central' })).toBe('A (1.0.0)');
        expect(dependencyLabel({ name: 'A', versionSource: 'global' })).toBe('A (global)');
        expect(dependencyLabel({ name: 'A' })).toBe('A');
    });
});
```

`src/test/unit/services/nuget/packageVersions.test.ts` (the second `describe` holds the regression test of the spec: the Updates list of a CPM solution is empty when everything is current):
```ts
import * as path from 'path';

jest.mock('vscode', () => ({}), { virtual: true });

const env = { projects: [] as any[] };
jest.mock('../../../../services/solutionService', () => ({
    SolutionService: {
        getActiveSolution: () => ({ isInitialized: true, solutionPath: 'Central.slnx', projects: new Map(env.projects.map(project => [project.projectPath, project])) }),
    },
}));

import { VersionUtils } from '../../../../services/versionUtils';
import { NuGetManagerService } from '../../../../services/nuget/nugetManagerService';
import { PackageInstalledService, withVersionSources } from '../../../../services/nuget/packageInstalledService';
import { ProjectPackages } from '../../../../services/nuget/centralPackages';

const props = path.resolve('/repo/Directory.Packages.props');
const appPath = path.resolve('/repo/App/App.csproj');
const project = (name: string, dependencies: object[]) => ({
    name,
    projectPath: path.resolve(`/repo/${name}/${name}.csproj`),
    frameworks: ['net8.0'],
    dependencies,
    evaluateItems: jest.fn().mockResolvedValue(undefined),
});

describe('VersionUtils.isOutdated', () => {
    test('an older known version is outdated, the same or a newer one is not', () => {
        expect(VersionUtils.isOutdated('13.0.1', '13.0.3')).toBe(true);
        expect(VersionUtils.isOutdated('13.0.3', '13.0.3')).toBe(false);
        expect(VersionUtils.isOutdated('14.0.0-beta', '13.0.3')).toBe(false);
        expect(VersionUtils.isOutdated('1.2.3.4', '1.2.3.10')).toBe(true);
    });

    test('an unknown version is never outdated', () => {
        expect(VersionUtils.isOutdated('', '13.0.3')).toBe(false);
        expect(VersionUtils.isOutdated('Unknown', '13.0.3')).toBe(false);
        expect(VersionUtils.isOutdated('13.0.1', undefined)).toBe(false);
    });

    test('a range counts as its lower bound', () => {
        expect(VersionUtils.isOutdated('[2.0.3, )', '2.0.4')).toBe(true);
        expect(VersionUtils.isOutdated('[2.0.3, )', '2.0.3')).toBe(false);
    });
});

describe('NuGet data of a solution with Central Package Management', () => {
    afterEach(() => jest.restoreAllMocks());

    test('versions and sources come from the evaluated dependencies, never "Unknown"', async () => {
        env.projects = [project('App', [
            { name: 'Serilog', version: '3.1.1', type: 'PackageReference', versionSource: 'central', versionFile: props },
            { name: 'Missing', type: 'PackageReference' },
            { name: 'Lib', type: 'ProjectReference' },
        ])];
        const [app] = await PackageInstalledService.getAllProjectsInfoFromActiveSolution();
        expect(env.projects[0].evaluateItems).toHaveBeenCalled();
        expect(app.packages).toEqual([
            { id: 'Serilog', currentVersion: '3.1.1', projectPath: env.projects[0].projectPath, projectName: 'App', versionSource: 'central', versionFile: props },
            { id: 'Missing', currentVersion: '', projectPath: env.projects[0].projectPath, projectName: 'App' },
        ]);
    });

    test('regression: the Updates list is empty when every package is current (it listed all CPM packages)', async () => {
        jest.spyOn(PackageInstalledService, 'getInstalledPackagesWithMetadata').mockResolvedValue([
            { id: 'Serilog', currentVersion: '3.1.1', projectPath: appPath, projectName: 'App', versionSource: 'central', versions: ['3.1.1', '3.0.0'] },
            { id: 'Unknown.Version', currentVersion: '', projectPath: appPath, projectName: 'App', versions: ['2.0.0'] },
            { id: 'Newer.Than.Stable', currentVersion: '2.0.0-rc.1', projectPath: appPath, projectName: 'App', versions: ['2.0.0-rc.1', '1.0.0'] },
        ]);
        expect(await NuGetManagerService.getGroupedOutdatedPackages(false, 'Central.slnx', false, [])).toEqual([]);
    });

    test('a central package with a newer version is listed once', async () => {
        jest.spyOn(PackageInstalledService, 'getInstalledPackagesWithMetadata').mockResolvedValue([
            { id: 'Serilog', currentVersion: '3.1.1', projectPath: appPath, projectName: 'App', versionSource: 'central', versions: ['4.0.0', '3.1.1'] },
            { id: 'Serilog', currentVersion: '3.1.1', projectPath: path.resolve('/repo/Web/Web.csproj'), projectName: 'Web', versionSource: 'central', versions: ['4.0.0', '3.1.1'] },
        ]);
        expect((await NuGetManagerService.getGroupedOutdatedPackages(false, 'Central.slnx', false, [])).map(pkg => pkg.id)).toEqual(['Serilog']);
    });

    test('Consolidate ignores unknown versions', () => {
        const info = { name: 'App', path: appPath, framework: 'net8.0', packages: [] };
        const flat = [
            { id: 'Serilog', currentVersion: '3.1.1', projectPath: appPath, projectName: 'App', projectInfo: info },
            { id: 'Serilog', currentVersion: '', projectPath: appPath, projectName: 'Web', projectInfo: { ...info, name: 'Web' } },
        ];
        expect(NuGetManagerService.getConsolidationDataFromFlatPackages(flat, false).consolidatePackages).toEqual([]);
    });
});

describe('withVersionSources (project context: dotnet list, marked from the evaluation)', () => {
    test('marks overrides and global packages by id, case-insensitively', () => {
        const evaluated = {
            references: [
                { id: 'Newtonsoft.Json', version: '13.0.2', source: 'override', versionFile: appPath },
                { id: 'Microsoft.SourceLink.GitHub', version: '8.0.0', source: 'global', versionFile: props },
            ],
        } as unknown as ProjectPackages;
        const listed = [
            { id: 'newtonsoft.json', currentVersion: '13.0.2', projectPath: appPath, projectName: 'App' },
            { id: 'Microsoft.SourceLink.GitHub', currentVersion: '8.0.0', projectPath: appPath, projectName: 'App' },
            { id: 'Other', currentVersion: '1.0.0', projectPath: appPath, projectName: 'App' },
        ];
        expect(withVersionSources(listed, evaluated).map(pkg => pkg.versionSource)).toEqual(['override', 'global', undefined]);
        expect(withVersionSources(listed, undefined)).toBe(listed);
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/test/unit/core/Project.packages.test.ts src/test/unit/services/nuget/packageVersions.test.ts`
Expected: FAIL (`dependencyLabel` and `withVersionSources` not exported, `isOutdated is not a function`, `currentVersion: 'Unknown'`, the regression test lists three packages)

- [ ] **Step 3: The source on the package types**

```diff
--- a/src/services/nuget/types.ts
+++ b/src/services/nuget/types.ts
@@ -30,6 +30,10 @@
     readonly autoReferenced?: boolean;
     /** Whether this is a transitive dependency (not directly referenced) */
     readonly transitivePackage?: boolean;
+    /** Where the version comes from (Central Package Management); undefined while MSBuild has not evaluated the project */
+    readonly versionSource?: PackageVersionSource;
+    /** The file the version is written in: the project file, or the props file of a central or global version */
+    readonly versionFile?: string;
 }
 
 /**
```

- [ ] **Step 4: `Project` takes the packages from the evaluation**

`dependencies` merges the evaluated packages into the parser's list (without an evaluation it is the parser's list, as today); every reader inside `Project` goes through the getter, so a project with only a global package gets a Dependencies node; the tree label shows the override/global source; `evaluateItems` fires the change event when only the packages changed (a `Directory.Packages.props` edit changes no files):
```diff
--- a/src/core/Project.ts
+++ b/src/core/Project.ts
@@ -18,9 +18,9 @@
 import { layoutFolder, ItemState, BUILD_OUTPUT_FOLDERS } from '../services/projectItems/folderLayout';
 import { ShowAllFiles } from '../services/showAllFiles';
 import { holdsProject } from '../services/projectItems/projectItemEdits';
-import { ProjectItems } from '../services/projectItems/projectItems';
-import { changedSince, unlistedEntries } from '../services/projectItems/unseenFiles';
 import { INCLUDED_ITEM, EXCLUDED_ITEM } from './contextMenus';
+import { ProjectPackages } from '../services/nuget/centralPackages';
+import { PackageVersionSource } from '../services/nuget/types';
 
 export interface ProjectFileNode {
     name: string;
@@ -36,6 +36,37 @@
     name: string;
     version?: string;
     type?: 'PackageReference' | 'ProjectReference' | 'Reference' | 'FrameworkReference' | undefined;
+    /** Packages: where the version comes from; undefined until MSBuild has evaluated the project */
+    versionSource?: PackageVersionSource;
+    /** Packages: the file the version is written in */
+    versionFile?: string;
+}
+
+/**
+ * The project file's references with the packages as MSBuild evaluated them: versions from Directory.Packages.props
+ * and VersionOverride, global packages, references from props files. Without an evaluation, the parser's list.
+ */
+function withEvaluatedPackages(parsed: readonly ProjectDependency[], packages: ProjectPackages | undefined): ProjectDependency[] {
+    if (!packages) {
+        return [...parsed];
+    }
+    return [
+        ...packages.references.map(reference => ({
+            name: reference.id,
+            ...(reference.version ? { version: reference.version } : {}),
+            type: 'PackageReference' as const,
+            versionSource: reference.source,
+            ...(reference.versionFile ? { versionFile: reference.versionFile } : {}),
+        })),
+        ...parsed.filter(dependency => dependency.type !== 'PackageReference'),
+    ];
+}
+
+/** The tree's name of a reference: `Serilog (3.1.1)`, `Newtonsoft.Json (13.0.2, override)`, `X (8.0.0, global)` */
+export function dependencyLabel(dependency: ProjectDependency): string {
+    const source = dependency.versionSource === 'override' || dependency.versionSource === 'global' ? dependency.versionSource : undefined;
+    const details = [dependency.version, source].filter(Boolean).join(', ');
+    return details ? `${dependency.name} (${details})` : dependency.name;
 }
 
 const log = logger('Project');
@@ -57,7 +88,6 @@
     private _folderWatchers: Map<string, vscode.FileSystemWatcher> = new Map(); // Lazy folder watchers
     private _reevaluateTimer?: ReturnType<typeof setTimeout>; // New files: evaluate once a burst is over
     private _evaluatedProjectFile?: string; // Stamp of the project file the last evaluation was asked for
-    private _reevaluatedFor = new Set<string>(); // Unlisted entries (path and change time) that already asked for an evaluation
 
     public readonly onDidChange = this._changeEmitter.event;
 
@@ -86,8 +116,9 @@
         return this._solutionProject.name || path.basename(this._projectPath, path.extname(this._projectPath));
     }
 
+    /** The references; packages as MSBuild evaluated them once it has (Central Package Management versions, global packages) */
     get dependencies(): ProjectDependency[] {
-        return this._dependencies;
+        return withEvaluatedPackages(this._dependencies, ProjectItemsService.instance.packages(this._projectPath));
     }
 
     /** Whether the project can be started, i.e. can be the startup project */
@@ -331,9 +362,6 @@
             }
             const items = ProjectItemsService.instance.get(this._projectPath);
             const laidOut = layoutFolder(folderPath, disk, items, showAll, nonEmptyFolders);
-            if (items) {
-                void nonEmptyFolders; void this.reevaluateIfNewerThanItems;
-            }
 
             const children: ProjectFileNode[] = [];
             const folders = laidOut.filter(entry => entry.isDirectory).sort((a, b) => a.name.localeCompare(b.name));
@@ -497,7 +525,7 @@
     async hasAnyChildren(): Promise<boolean> {
         try {
             // Quick check for dependencies
-            if (this._dependencies && this._dependencies.length > 0) {
+            if (this.dependencies.length > 0) {
                 return true;
             }
 
@@ -563,7 +591,7 @@
 
         try {
             // Add Dependencies container if there are dependencies
-            if (this._dependencies && this._dependencies.length > 0) {
+            if (this.dependencies.length > 0) {
                 items.push({
                     type: 'dependencies',
                     name: 'Dependencies',
@@ -632,12 +660,13 @@
      * Gets dependency categories for this project (used when Dependencies node is expanded)
      */
     getDependencies(): ProjectChild[] {
-        log.info(`getDependencies called for ${this.name}, found ${this._dependencies?.length || 0} dependencies`);
+        const all = this.dependencies;
+        log.info(`getDependencies called for ${this.name}, found ${all.length} dependencies`);
 
         // Count dependencies by type
-        const packageCount = this._dependencies?.filter(dep => dep.type === 'PackageReference').length || 0;
-        const projectCount = this._dependencies?.filter(dep => dep.type === 'ProjectReference').length || 0;
-        const assemblyCount = this._dependencies?.filter(dep => dep.type === 'Reference').length || 0;
+        const packageCount = all.filter(dep => dep.type === 'PackageReference').length;
+        const projectCount = all.filter(dep => dep.type === 'ProjectReference').length;
+        const assemblyCount = all.filter(dep => dep.type === 'Reference').length;
 
         // Always return the 3 main dependency categories - even if empty (so users can add dependencies via context menu)
         const items: ProjectChild[] = [
@@ -681,10 +710,7 @@
      */
     getDependenciesByCategory(nodeId: NodeId): ProjectChild[] {
         const items: ProjectChild[] = [];
-
-        if (!this._dependencies) {
-            return items;
-        }
+        const all = this.dependencies;
 
         let dependencies: ProjectDependency[] = [];
         let categoryName: string = '';
@@ -693,18 +719,18 @@
         if (nodeId.type == 'dependencyCategory') {
             if (nodeId.name == 'packages') {
                 // Packages: NuGet package references
-                dependencies = this._dependencies.filter(dep => dep.type === 'PackageReference');
+                dependencies = all.filter(dep => dep.type === 'PackageReference');
                 categoryName = 'packages';
             } else if (nodeId.name == 'projects') {
                 // Projects: project-to-project references
-                dependencies = this._dependencies.filter(dep => dep.type === 'ProjectReference');
+                dependencies = all.filter(dep => dep.type === 'ProjectReference');
                 categoryName = 'projects';
             } else if (nodeId.name == 'assemblies') {
                 // Assemblies: binary/assembly references
-                dependencies = this._dependencies.filter(dep => dep.type === 'Reference');
+                dependencies = all.filter(dep => dep.type === 'Reference');
                 categoryName = 'assemblies';
             } else if (nodeId.name == 'frameworks') {            // Frameworks: framework references
-                dependencies = this._dependencies.filter(dep => dep.type === 'FrameworkReference');
+                dependencies = all.filter(dep => dep.type === 'FrameworkReference');
                 categoryName = 'frameworks';
             }
         }
@@ -726,7 +752,7 @@
 
             items.push({
                 type: 'dependency',
-                name: dep.version ? `${dep.name} (${dep.version})` : dep.name,
+                name: dependencyLabel(dep),
                 nodeId: nodeId,
                 hasChildren: false
             });
@@ -800,14 +826,23 @@
         }
         const service = ProjectItemsService.instance;
         const before = service.version(this._projectPath);
+        const packagesBefore = service.packagesVersion(this._projectPath);
         await service.evaluate(this._projectPath);
+        // New package versions (Directory.Packages.props changed): Dependencies > Packages shows them
+        const packagesChanged = service.packagesVersion(this._projectPath) !== packagesBefore;
         // Same list, or a failure that keeps the last one (or still none): the tree shows what it showed
         if (service.version(this._projectPath) === before) {
+            if (packagesChanged) {
+                this._changeEmitter.fire();
+            }
             return;
         }
         // Nothing of the tree is shown yet (collapsed project): it reads the list when it is first expanded
         const anyExpanded = Array.from(this._collapsedState.values()).some(isCollapsed => !isCollapsed);
         if (!this._fileTree?.isLoaded && !anyExpanded) {
+            if (packagesChanged) {
+                this._changeEmitter.fire();
+            }
             return;
         }
         await this.reloadLoadedFolders();
@@ -853,32 +888,6 @@
         }, REEVALUATE_AFTER_CREATE_MS);
     }
 
-    /**
-     * Folders not shown are not watched, so files created there meanwhile (a pull, a generator, while the extension
-     * was not running) are missing from an item list evaluated before. When a folder is read from disk, entries the
-     * list does not include but that changed after its evaluation may be such files: evaluate again (once per entry
-     * and change), showing the cached list meanwhile. Genuinely excluded files are older and cost nothing.
-     */
-    private async reevaluateIfNewerThanItems(folderPath: string, disk: readonly { name: string; isDirectory: boolean }[],
-        items: ProjectItems, nonEmptyFolders: ReadonlySet<string>): Promise<void> {
-        const evaluatedAt = ProjectItemsService.instance.evaluatedAt(this._projectPath);
-        if (evaluatedAt === undefined || this._isUnloaded()) {
-            return;
-        }
-        const unlisted = unlistedEntries(folderPath, disk, items, nonEmptyFolders);
-        if (unlisted.length === 0) {
-            return;
-        }
-        const unseen = (await changedSince(unlisted, evaluatedAt))
-            .map(entry => `${entry.path}|${entry.changedAt}`)
-            .filter(key => !this._reevaluatedFor.has(key));
-        if (unseen.length > 0) {
-            log.debug(`Possibly new in ${folderPath}, evaluating again: ${unseen.join(', ')}`);
-            unseen.forEach(key => this._reevaluatedFor.add(key));
-            this.scheduleReevaluation();
-        }
-    }
-
     private async reloadLoadedFolders(): Promise<void> {
         const loaded = Array.from(this._collapsedState.entries()).filter(([, isCollapsed]) => !isCollapsed).map(([folderPath]) => folderPath);
         const projectDir = path.dirname(this._projectPath);
```

- [ ] **Step 5: NuGet data: versions from the evaluation, `isOutdated`, Consolidate without unknown versions**

`getAllProjectsInfoFromActiveSolution` waits for each project's evaluation (`Project.evaluateItems`, which skips unloaded projects and answers from the cache when the tree evaluated already); the project context keeps `dotnet list` and marks its packages with `withVersionSources`:
```diff
--- a/src/services/versionUtils.ts
+++ b/src/services/versionUtils.ts
@@ -54,6 +54,19 @@
         return parts[0] || 0;
     }
 
+    /**
+     * Whether `latest` is newer than the installed `current` version. A version that is not known ('' when MSBuild
+     * could not tell, or anything not starting with a number) is never outdated; a range like `[2.0.3, )` counts as
+     * its lower bound.
+     */
+    static isOutdated(current: string, latest: string | undefined): boolean {
+        const installed = (current ?? '').trim().replace(/^\[\s*/, '').split(/[\s,\]]/)[0];
+        if (!latest || !/^\d/.test(installed)) {
+            return false;
+        }
+        return comp(latest, installed) > 0;
+    }
+
     static includePrerelease(includePrerelease: boolean): (versions: string) => boolean {
         if (includePrerelease)
             return (version) => !!version;
--- a/src/services/nuget/packageInstalledService.ts
+++ b/src/services/nuget/packageInstalledService.ts
@@ -6,10 +6,24 @@
 import { BasicInstalledPackage, InstalledPackage, ProjectInfo, NuGetPackage } from './types';
 import { PackageSharedService } from './packageSharedService';
 import { SolutionService } from '../solutionService';
+import { ProjectItemsService } from '../projectItems/projectItemsService';
+import { ProjectPackages } from './centralPackages';
 
 const execAsync = promisify(exec);
 const log = logger('PackageInstalledService');
 
+/** Marks the packages `dotnet list` reports with where their versions come from (central, override, global) */
+export function withVersionSources(packages: BasicInstalledPackage[], evaluated: ProjectPackages | undefined): BasicInstalledPackage[] {
+    if (!evaluated) {
+        return packages;
+    }
+    const byId = new Map(evaluated.references.map(reference => [reference.id.toLowerCase(), reference]));
+    return packages.map(pkg => {
+        const reference = byId.get(pkg.id.toLowerCase());
+        return reference ? { ...pkg, versionSource: reference.source, ...(reference.versionFile ? { versionFile: reference.versionFile } : {}) } : pkg;
+    });
+}
+
 /**
  * Service for managing installed NuGet packages using dotnet CLI
  * Handles listing, analyzing, and getting details about installed packages
@@ -138,6 +152,9 @@
 
             const projectInfos: ProjectInfo[] = [];
             const projects = Array.from(activeSolution.projects.values());
+            // Versions come from MSBuild (Directory.Packages.props, VersionOverride, global packages): one evaluation
+            // per project, usually done already for the tree (unloaded projects are skipped)
+            await Promise.all(projects.map(project => project.evaluateItems()));
 
             log.info(`Processing ${projects.length} projects from active solution...`);
 
@@ -149,9 +166,12 @@
                         .filter(dep => dep.type === 'PackageReference') // Only include NuGet packages, not project references
                         .map(dep => ({
                             id: dep.name,
-                            currentVersion: dep.version || 'Unknown',
+                            // '' when no version is known (no evaluation and none in the project file): never outdated
+                            currentVersion: dep.version ?? '',
                             projectPath: project.projectPath,
-                            projectName: project.name
+                            projectName: project.name,
+                            ...(dep.versionSource ? { versionSource: dep.versionSource } : {}),
+                            ...(dep.versionFile ? { versionFile: dep.versionFile } : {}),
                         }));
 
                     const projectInfo: ProjectInfo = {
@@ -186,7 +206,11 @@
     static async getProjectInfo(projectPath: string): Promise<ProjectInfo | null> {
         try {
             const projectName = path.basename(projectPath, path.extname(projectPath));
-            const packages = await this.getProjectPackages(projectPath);
+            const [listed, evaluated] = await Promise.all([
+                this.getProjectPackages(projectPath),
+                ProjectItemsService.instance.evaluatePackages(projectPath),
+            ]);
+            const packages = withVersionSources(listed, evaluated);
 
             // Get target framework info
             const framework = await this.getProjectFramework(projectPath);
--- a/src/services/nuget/nugetManagerService.ts
+++ b/src/services/nuget/nugetManagerService.ts
@@ -51,8 +51,8 @@
 
             // Find packages with multiple versions across projects
             for (const [packageId, packages] of packageGroups.entries()) {
-                // Check if there are different versions
-                const versions = new Set(packages.map(p => p.currentVersion));
+                // Check if there are different versions (an unknown version, '', differs from nothing)
+                const versions = new Set(packages.map(p => p.currentVersion).filter(Boolean));
 
                 log.debug(`Package ${packageId}: ${packages.length} instances with versions [${Array.from(versions).join(', ')}]`);
 
@@ -63,7 +63,7 @@
                     const versionGroups = new Map<string, ProjectInfo[]>();
 
                     // Group by version to get projects per version
-                    for (const pkg of packages) {
+                    for (const pkg of packages.filter(p => p.currentVersion)) {
                         const version = pkg.currentVersion;
                         const existingProjects = versionGroups.get(version) || [];
                         if (!existingProjects.find(p => p.path === pkg.projectInfo.path)) {
@@ -258,29 +258,9 @@
 
                 log.debug(`Package ${pkg.id}: current=${currentVersion}, latest=${latestVersion}, hasLatest=${!!latestVersion}`);
 
-                if (latestVersion && currentVersion !== latestVersion) {
-                    try {
-                        // Use version utilities to compare versions
-                        if (VersionUtils.compare(latestVersion, currentVersion) > 0) {
-                            // Convert InstalledPackage to UpdateablePackage format
-                            const updateablePackage: UpdateablePackage & { projects: ProjectInfo[] } = pkg as any;
-                            outdatedPackages.push(updateablePackage);
-                        } else {
-                            // Fallback to simple string comparison if versions are the same
-                            if (currentVersion !== latestVersion) {
-                                const updateablePackage: UpdateablePackage & { projects: ProjectInfo[] } = pkg as any;
-                                outdatedPackages.push(updateablePackage);
-                            }
-                        }
-                    } catch (error) {
-                        // If semver comparison fails, fallback to string comparison
-                        if (currentVersion !== latestVersion) {
-                            const updateablePackage: UpdateablePackage & { projects: ProjectInfo[] } = {
-                                ...pkg,
-                            } as any;
-                            outdatedPackages.push(updateablePackage);
-                        }
-                    }
+                // Only a known version older than the latest: an unknown one ('') is not outdated, nor a newer one
+                if (VersionUtils.isOutdated(currentVersion, latestVersion)) {
+                    outdatedPackages.push(pkg as UpdateablePackage & { projects: ProjectInfo[] });
                 }
             }
 
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx jest src/test/unit/core src/test/unit/services/nuget src/test/unit/services/projectItems`
Expected: PASS

- [ ] **Step 7: Docs**

`docs/solution-explorer.md`, the **Packages** row of the Dependencies table becomes:
```markdown
| **Packages** | The NuGet packages the project references, with their versions. With [Central Package Management](nuget.md#central-package-management) the version is the one MSBuild uses: from `Directory.Packages.props`, marked `override` when the project sets its own (`VersionOverride`), and packages every project gets (`GlobalPackageReference`) are listed too, marked `global`. Each package expands to the packages it depends on, as many levels deep as they go, with the versions the last restore resolved |
```
and the paragraph below the table gets one sentence: `Versions under Central Package Management show once MSBuild has evaluated the project (a moment after the solution opens; needs the .NET SDK).`

`docs/nuget.md`: a new section before "## Private feeds" (Task 5 adds what each action edits, Task 6 Consolidate, Task 8 watching):
```markdown
## Central Package Management

Solutions that keep their package versions in `Directory.Packages.props` (`ManagePackageVersionsCentrally`) work like the others: Installed, Updates and the Dependencies tree show the version MSBuild uses for each project, and where it comes from:

| Shown | Where the version is |
|---|---|
| `v3.1.1` | the `PackageVersion` in `Directory.Packages.props` (or a props file it imports) |
| `v13.0.2 (override)` | the project's own `VersionOverride` |
| `global` | a `GlobalPackageReference`: every project gets the package |

A project that turns CPM off (`<ManagePackageVersionsCentrally>false</ManagePackageVersionsCentrally>`) keeps the versions in its project file, as before. When the .NET SDK cannot evaluate a project, its versions show as not known and are never offered as updates.
```

`docs/manual-testing.md`, append unticked:
```markdown
- [ ] Central Package Management, what is shown (a copy of `src/__fixtures__/central-packages/cpm` opened as a folder, restored once with `dotnet restore Central.slnx`): Dependencies > Packages of App show `Newtonsoft.Json (13.0.1)`, `Polly (8.1.0)`, `Serilog (3.1.1)` and `Microsoft.SourceLink.GitHub (8.0.0, global)`; Override shows `Newtonsoft.Json (13.0.2, override)`; GlobalOnly has a Dependencies node with only the global package; OptOut has no global package; the solution's NuGet manager shows no "Unknown" anywhere and the Updates tab lists only packages that really have newer versions
```

- [ ] **Step 8: Verify and commit**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git add src/services/nuget/types.ts src/core/Project.ts src/services/versionUtils.ts src/services/nuget/packageInstalledService.ts src/services/nuget/nugetManagerService.ts src/test/unit/core/Project.packages.test.ts src/test/unit/services/nuget/packageVersions.test.ts docs/solution-explorer.md docs/nuget.md docs/manual-testing.md
git commit -m "Central packages: real versions in the tree and the NuGet manager, no false updates

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: exit 0.

---

### Task 4: Plans for install, update and uninstall, and writing them

**Files:**
- Create: `src/services/nuget/centralPackagePlan.ts`, `src/services/nuget/centralPackageFiles.ts`
- Test: `src/test/unit/services/nuget/centralPackagePlan.test.ts`, `src/test/unit/services/nuget/centralPackageFiles.msbuild.test.ts`

The rules of the spec, as pure functions over the evaluated projects (`ProjectState`):
- a version change edits the central `PackageVersion` once (in the file that defines it, also an imported one), and names the projects it also reaches; "Set for this project only" (`scope: 'project'`) writes a `VersionOverride` instead;
- an override is changed in its project (removed when set to the central version);
- install adds a `PackageReference` without `Version` and, when there is no central version, a `PackageVersion` in `packageVersionFileFor` (Task 2);
- a global package's version is edited in its props file; installing it into a project that opted out removes the opt-out;
- projects without CPM (or that MSBuild could not evaluate) go through the CLI, as today;
- uninstall: the CLI removes the `PackageReference`; a global package is removed for all (with stale opt-outs) or opted out per project; central versions no project uses any more are reported (Task 5 asks before removing them).

- [ ] **Step 1: Write the failing tests**

`src/test/unit/services/nuget/centralPackagePlan.test.ts` (projects built like the fixture: App, Override, GlobalOnly, OptOut, Legacy):
```ts
import * as path from 'path';
import { ProjectPackages, parseMsbuildPackages } from '../../../../services/nuget/centralPackages';
import { ProjectState, confirmationText, globalUninstallEdits, planUninstall, planVersionChange } from '../../../../services/nuget/centralPackagePlan';

const root = path.resolve('/repo');
const props = path.join(root, 'Directory.Packages.props');
const extra = path.join(root, 'Packages.Extra.props');
const csproj = (name: string) => path.join(root, name, `${name}.csproj`);
const versions = [
    { Identity: 'Newtonsoft.Json', Version: '13.0.1', DefiningProjectFullPath: props },
    { Identity: 'Serilog', Version: '3.1.1', DefiningProjectFullPath: props },
    { Identity: 'Polly', Version: '8.1.0', DefiningProjectFullPath: extra },
];
const global = { Identity: 'Microsoft.SourceLink.GitHub', Version: '8.0.0', DefiningProjectFullPath: props };

/** A project as MSBuild evaluates it in the fixture layout (`src/__fixtures__/central-packages/cpm`) */
const state = (name: string, references: object[], options: { cpm?: boolean; globals?: boolean; overrides?: boolean } = {}): ProjectState => {
    const { cpm = true, globals = true, overrides = true } = options;
    const globalReference = cpm && globals ? [{ Identity: global.Identity, Version: '', DefiningProjectFullPath: path.join(root, 'NuGet.targets') }] : [];
    const packages = parseMsbuildPackages(JSON.stringify({
        Properties: { ManagePackageVersionsCentrally: String(cpm), DirectoryPackagesPropsPath: props, CentralPackageVersionOverrideEnabled: overrides ? '' : 'false' },
        Items: {
            PackageReference: [...references.map(reference => ({ DefiningProjectFullPath: csproj(name), ...reference })), ...globalReference],
            PackageVersion: versions,
            GlobalPackageReference: globals ? [global] : [],
        },
    }), csproj(name)) as ProjectPackages;
    return { name, path: csproj(name), packages };
};

const app = state('App', [{ Identity: 'Newtonsoft.Json' }, { Identity: 'Serilog' }, { Identity: 'Polly' }]);
const override = state('Override', [{ Identity: 'Newtonsoft.Json', VersionOverride: '13.0.2' }]);
const globalOnly = state('GlobalOnly', []);
const optOut = state('OptOut', [{ Identity: 'Serilog' }], { globals: false });
const legacy = state('Legacy', [{ Identity: 'Polly', Version: '8.0.0' }], { cpm: false });
const states = [app, override, globalOnly, optOut, legacy];

describe('planVersionChange', () => {
    test('a new central version for one project: one edit in the props file, the other users named', () => {
        const plan = planVersionChange('Serilog', '4.0.0', [app.path], states);
        expect(plan.edits).toEqual([{ kind: 'setPackageVersion', file: props, id: 'Serilog', version: '4.0.0' }]);
        expect(plan.alsoChanges).toEqual(['OptOut']);
        expect(plan.canOverride).toBe(true);
        expect(plan.cliProjects).toEqual([]);
    });

    test('all users selected (solution context): one edit, nobody else to name', () => {
        const plan = planVersionChange('Serilog', '4.0.0', [app.path, optOut.path], states);
        expect(plan.edits).toHaveLength(1);
        expect(plan.alsoChanges).toEqual([]);
        expect(confirmationText([plan])).toBeUndefined();
    });

    test('the version is edited in the imported props file that defines it', () => {
        expect(planVersionChange('Polly', '8.2.0', [app.path], states).edits).toEqual([{ kind: 'setPackageVersion', file: extra, id: 'Polly', version: '8.2.0' }]);
    });

    test('"Set for this project only" writes a VersionOverride instead', () => {
        const plan = planVersionChange('Serilog', '4.0.0', [app.path], states, 'project');
        expect(plan.edits).toEqual([{ kind: 'setVersionOverride', file: app.path, id: 'Serilog', version: '4.0.0' }]);
        expect(plan.alsoChanges).toEqual([]);
    });

    test('an override is changed in its project; set to the central version it goes away', () => {
        expect(planVersionChange('Newtonsoft.Json', '13.0.3', [override.path], states).edits)
            .toEqual([{ kind: 'setVersionOverride', file: override.path, id: 'Newtonsoft.Json', version: '13.0.3' }]);
        expect(planVersionChange('Newtonsoft.Json', '13.0.1', [override.path], states).edits)
            .toEqual([{ kind: 'removeVersionOverride', file: override.path, id: 'Newtonsoft.Json' }]);
    });

    test('install of a package without a central version: PackageReference without Version plus a PackageVersion', () => {
        expect(planVersionChange('Humanizer.Core', '2.14.1', [globalOnly.path, optOut.path], states).edits).toEqual([
            { kind: 'addPackageReference', file: globalOnly.path, id: 'Humanizer.Core' },
            { kind: 'addPackageVersion', file: props, id: 'Humanizer.Core', version: '2.14.1' },
            { kind: 'addPackageReference', file: optOut.path, id: 'Humanizer.Core' },
        ]);
    });

    test('install of a package that has a central version in another version: the version-change rule', () => {
        const plan = planVersionChange('Polly', '8.2.0', [globalOnly.path], states);
        expect(plan.edits).toEqual([
            { kind: 'addPackageReference', file: globalOnly.path, id: 'Polly' },
            { kind: 'setPackageVersion', file: extra, id: 'Polly', version: '8.2.0' },
        ]);
        expect(plan.alsoChanges).toEqual(['App']);
    });

    test('a global package: its version in the props file, every project that gets it is named, no override', () => {
        const plan = planVersionChange('Microsoft.SourceLink.GitHub', '8.0.1', [app.path], states);
        expect(plan.edits).toEqual([{ kind: 'setGlobalPackageVersion', file: props, id: 'Microsoft.SourceLink.GitHub', version: '8.0.1' }]);
        expect(plan.alsoChanges).toEqual(['GlobalOnly', 'Override']);
        expect(plan.canOverride).toBe(false);
    });

    test('installing a global package into a project that opted out takes the opt-out back', () => {
        expect(planVersionChange('Microsoft.SourceLink.GitHub', '8.0.0', [optOut.path], states).edits)
            .toEqual([{ kind: 'removeGlobalOptOut', file: optOut.path, id: 'Microsoft.SourceLink.GitHub' }]);
    });

    test('projects without CPM, or not evaluated, go through the CLI', () => {
        const unknown: ProjectState = { name: 'Unknown', path: csproj('Unknown') };
        expect(planVersionChange('Polly', '8.2.0', [legacy.path, unknown.path], [...states, unknown]).cliProjects).toEqual([legacy.path, unknown.path]);
    });

    test('with CentralPackageVersionOverrideEnabled false there is no "Set for this project only"', () => {
        const strict = state('Strict', [{ Identity: 'Serilog' }], { overrides: false });
        expect(planVersionChange('Serilog', '4.0.0', [strict.path], [...states, strict]).canOverride).toBe(false);
        expect(planVersionChange('Serilog', '4.0.0', [strict.path], [...states, strict], 'project').edits[0].kind).toBe('setPackageVersion');
    });
});

describe('confirmationText', () => {
    test('one package', () => {
        expect(confirmationText([planVersionChange('Serilog', '4.0.0', [app.path], states)])).toEqual({
            message: 'Change Serilog to 4.0.0 for every project that uses it?',
            detail: 'The version is set centrally in Directory.Packages.props, so it also changes for OptOut.',
        });
    });

    test('a bulk update: one confirmation listing each package that reaches other projects', () => {
        const text = confirmationText([
            planVersionChange('Serilog', '4.0.0', [app.path], states),
            planVersionChange('Microsoft.SourceLink.GitHub', '8.0.1', [app.path], states),
            planVersionChange('Newtonsoft.Json', '13.0.3', [override.path], states),
        ])!;
        expect(text.message).toBe('Change the central versions of 2 packages?');
        expect(text.detail.split('\n')).toEqual([
            'They are set centrally, so other projects change too:',
            'Serilog 4.0.0 (Directory.Packages.props): also OptOut',
            'Microsoft.SourceLink.GitHub 8.0.1 (Directory.Packages.props): also GlobalOnly, Override',
        ]);
    });
});

describe('planUninstall', () => {
    test('a normal reference goes through the CLI; a central version nobody uses any more is reported', () => {
        expect(planUninstall('Polly', [app.path], states)).toEqual({
            id: 'Polly', cliProjects: [app.path], orphanedVersions: [{ file: extra, id: 'Polly' }],
        });
        expect(planUninstall('Serilog', [app.path], states).orphanedVersions).toEqual([]);
        expect(planUninstall('Serilog', [app.path, optOut.path], states).orphanedVersions).toEqual([{ file: props, id: 'Serilog' }]);
    });

    test('an override still uses the central version', () => {
        expect(planUninstall('Newtonsoft.Json', [app.path], states).orphanedVersions).toEqual([]);
    });

    test('a global package names every project that gets it; "all" removes it and stale opt-outs, "selected" opts out', () => {
        const plan = planUninstall('Microsoft.SourceLink.GitHub', [app.path], states);
        expect(plan.cliProjects).toEqual([]);
        expect(plan.global).toEqual({ file: props, selected: [app.path], appliesTo: ['App', 'GlobalOnly', 'Override'] });
        expect(globalUninstallEdits(plan, 'selected', states)).toEqual([{ kind: 'addGlobalOptOut', file: app.path, id: 'Microsoft.SourceLink.GitHub' }]);
        expect(globalUninstallEdits(plan, 'all', states)).toEqual([
            { kind: 'removeGlobalPackageReference', file: props, id: 'Microsoft.SourceLink.GitHub' },
            ...[app, override, globalOnly, optOut].map(project => ({ kind: 'removeGlobalOptOut', file: project.path, id: 'Microsoft.SourceLink.GitHub' })),
        ]);
    });
});
```

`src/test/unit/services/nuget/centralPackageFiles.msbuild.test.ts` (evaluate, plan, write, evaluate again, on a copy of the fixture):
```ts
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyPackageEdits } from '../../../../services/nuget/centralPackageFiles';
import { ProjectState, globalUninstallEdits, planUninstall, planVersionChange } from '../../../../services/nuget/centralPackagePlan';
import { ProjectItemsService } from '../../../../services/projectItems/projectItemsService';

/** The plans and edits checked against real MSBuild: what each project uses afterwards, not just the text written */
const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip;
const TIMEOUT = 150000;
const fixture = path.resolve(__dirname, '../../../../__fixtures__/central-packages/cpm');
const NAMES = ['App', 'GlobalOnly', 'Legacy', 'OptOut', 'Override'];

describe('central package edits against real MSBuild', () => {
    let root: string;
    const csproj = (name: string) => path.join(root, name, `${name}.csproj`);

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-edits-')));
        fs.cpSync(fixture, root, { recursive: true });
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    /** Every project evaluated afresh (a new service: no cache) */
    const evaluate = async (): Promise<ProjectState[]> => {
        const service = new ProjectItemsService();
        return Promise.all(NAMES.map(async name => ({ name, path: csproj(name), packages: await service.evaluatePackages(csproj(name)) })));
    };
    const versionOf = (states: ProjectState[], name: string, id: string) => {
        const reference = states.find(state => state.name === name)?.packages?.references.find(candidate => candidate.id === id);
        return reference && `${reference.version} ${reference.source}`;
    };

    withDotnet('a central update changes every project that uses the version; "this project only" just one', async () => {
        let states = await evaluate();
        await applyPackageEdits(planVersionChange('Serilog', '4.0.0', [csproj('App')], states).edits);
        states = await evaluate();
        expect(versionOf(states, 'App', 'Serilog')).toBe('4.0.0 central');
        expect(versionOf(states, 'OptOut', 'Serilog')).toBe('4.0.0 central');

        await applyPackageEdits(planVersionChange('Serilog', '4.1.0', [csproj('App')], states, 'project').edits);
        states = await evaluate();
        expect(versionOf(states, 'App', 'Serilog')).toBe('4.1.0 override');
        expect(versionOf(states, 'OptOut', 'Serilog')).toBe('4.0.0 central');
    }, TIMEOUT);

    withDotnet('an override set back to the central version follows the central version again', async () => {
        let states = await evaluate();
        await applyPackageEdits(planVersionChange('Newtonsoft.Json', '13.0.1', [csproj('Override')], states).edits);
        states = await evaluate();
        expect(versionOf(states, 'Override', 'Newtonsoft.Json')).toBe('13.0.1 central');
        expect(fs.readFileSync(csproj('Override'), 'utf8')).not.toContain('VersionOverride');
    }, TIMEOUT);

    withDotnet('install: a new package gets a PackageVersion; one defined in the imported file is changed there', async () => {
        let states = await evaluate();
        await applyPackageEdits(planVersionChange('Humanizer.Core', '2.14.1', [csproj('GlobalOnly')], states).edits);
        await applyPackageEdits(planVersionChange('Polly', '8.2.0', [csproj('OptOut')], states).edits);
        states = await evaluate();
        expect(versionOf(states, 'GlobalOnly', 'Humanizer.Core')).toBe('2.14.1 central');
        expect(versionOf(states, 'OptOut', 'Polly')).toBe('8.2.0 central');
        expect(versionOf(states, 'App', 'Polly')).toBe('8.2.0 central');
        expect(fs.readFileSync(path.join(root, 'Packages.Extra.props'), 'utf8')).toContain('<PackageVersion Include="Polly" Version="8.2.0" />');
        expect(versionOf(states, 'Legacy', 'Polly')).toBe('8.0.0 project');
    }, TIMEOUT);

    withDotnet('a global package: update, opt out one project, then remove it for all', async () => {
        let states = await evaluate();
        await applyPackageEdits(planVersionChange('Microsoft.SourceLink.GitHub', '8.0.1', [csproj('App')], states).edits);
        states = await evaluate();
        expect(versionOf(states, 'GlobalOnly', 'Microsoft.SourceLink.GitHub')).toBe('8.0.1 global');

        await applyPackageEdits(globalUninstallEdits(planUninstall('Microsoft.SourceLink.GitHub', [csproj('App')], states), 'selected', states));
        states = await evaluate();
        expect(versionOf(states, 'App', 'Microsoft.SourceLink.GitHub')).toBeUndefined();
        expect(versionOf(states, 'Override', 'Microsoft.SourceLink.GitHub')).toBe('8.0.1 global');

        await applyPackageEdits(globalUninstallEdits(planUninstall('Microsoft.SourceLink.GitHub', [csproj('Override')], states), 'all', states));
        states = await evaluate();
        expect(states.every(state => !versionOf(states, state.name, 'Microsoft.SourceLink.GitHub'))).toBe(true);
        expect(fs.readFileSync(csproj('App'), 'utf8')).not.toContain('GlobalPackageReference');
        expect(fs.readFileSync(csproj('OptOut'), 'utf8')).not.toContain('GlobalPackageReference');
    }, TIMEOUT);

    withDotnet('installing the global package into the project that opted out brings it back', async () => {
        let states = await evaluate();
        await applyPackageEdits(planVersionChange('Microsoft.SourceLink.GitHub', '8.0.0', [csproj('OptOut')], states).edits);
        states = await evaluate();
        expect(versionOf(states, 'OptOut', 'Microsoft.SourceLink.GitHub')).toBe('8.0.0 global');
    }, TIMEOUT);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/test/unit/services/nuget/centralPackagePlan.test.ts src/test/unit/services/nuget/centralPackageFiles.msbuild.test.ts`
Expected: FAIL (modules not found)

- [ ] **Step 3: Implement `src/services/nuget/centralPackagePlan.ts`**

```ts
import * as path from 'path';
import { PackageEdit } from './centralPackageEdits';
import { ProjectPackages, centralFiles, packageVersionFileFor } from './centralPackages';

/**
 * Plans what a package change writes under Central Package Management, without touching anything: which files get
 * which edits, which projects still go through the dotnet CLI (no CPM, or not evaluated), and which other projects a
 * shared change reaches (they are named in the confirmation). Pure: the host runs the plan (centralPackageOperations).
 */

/** A project of the solution as the plans see it */
export interface ProjectState {
    readonly name: string;
    readonly path: string;
    /** undefined: MSBuild could not evaluate it; handled like a project without CPM (the CLI) */
    readonly packages?: ProjectPackages;
}

/** Install or update one package to one version in the selected projects */
export interface VersionChangePlan {
    readonly id: string;
    readonly version: string;
    /** Projects without CPM: `dotnet add package --version`, as before */
    readonly cliProjects: readonly string[];
    readonly edits: readonly PackageEdit[];
    /** Names of projects that were not selected but whose version changes with a central or global edit */
    readonly alsoChanges: readonly string[];
    /** The props files of those shared edits */
    readonly sharedFiles: readonly string[];
    /** The shared change can be replaced by "Set for this project only" (central versions, overrides allowed) */
    readonly canOverride: boolean;
}

/** `shared`: change the central version (what CPM is for); `project`: a VersionOverride in each selected project */
export type VersionScope = 'shared' | 'project';

const lower = (id: string) => id.toLowerCase();
const same = (a: string | undefined, b: string | undefined) => !!a && !!b && path.normalize(a) === path.normalize(b);
const referenceOf = (packages: ProjectPackages | undefined, id: string) => packages?.references.find(reference => lower(reference.id) === lower(id));

/** Projects (not in `except`) whose version of `id` is written in `file` as a central or global entry */
function usersOf(states: readonly ProjectState[], id: string, file: string, except: ReadonlySet<string>): string[] {
    return states
        .filter(state => !except.has(state.path))
        .filter(state => {
            const reference = referenceOf(state.packages, id);
            return (reference?.source === 'central' || reference?.source === 'global') && same(reference.versionFile, file);
        })
        .map(state => state.name);
}

export function planVersionChange(
    id: string, version: string, selected: readonly string[], states: readonly ProjectState[], scope: VersionScope = 'shared',
): VersionChangePlan {
    const selectedSet = new Set(selected);
    const cliProjects: string[] = [];
    const edits: PackageEdit[] = [];
    const shared = new Map<string, PackageEdit>();
    let overridable = true;
    const share = (edit: PackageEdit) => {
        const key = `${edit.kind}|${path.normalize(edit.file)}|${lower(edit.id)}`;
        if (!shared.has(key)) {
            shared.set(key, edit);
            edits.push(edit);
        }
    };

    for (const projectPath of selected) {
        const packages = states.find(state => state.path === projectPath)?.packages;
        const reference = referenceOf(packages, id);
        if (!packages?.centrallyManaged || reference?.source === 'project') {
            cliProjects.push(projectPath);
            continue;
        }
        if (reference?.source === 'global') {
            if (reference.version !== version) {
                share({ kind: 'setGlobalPackageVersion', file: reference.versionFile!, id, version });
            }
            overridable = false;
            continue;
        }
        const central = packages.centralVersions.get(lower(id));
        if (reference?.source === 'override') {
            edits.push(central?.version === version
                ? { kind: 'removeVersionOverride', file: projectPath, id }
                : { kind: 'setVersionOverride', file: projectPath, id, version });
            continue;
        }
        // A global package the project opted out of: installing it takes the opt-out back
        const global = states.map(state => state.packages?.globals.find(entry => lower(entry.id) === lower(id)))
            .find(entry => entry && centralFiles(packages).some(file => same(file, entry.file)));
        if (global) {
            edits.push({ kind: 'removeGlobalOptOut', file: projectPath, id });
            if (global.version !== version) {
                share({ kind: 'setGlobalPackageVersion', file: global.file, id, version });
            }
            overridable = false;
            continue;
        }
        if (!reference) {
            edits.push({ kind: 'addPackageReference', file: projectPath, id });
        }
        if (!central) {
            share({ kind: 'addPackageVersion', file: packageVersionFileFor(packages)!, id, version });
        } else if (central.version !== version) {
            if (scope === 'project' && packages.overridesEnabled) {
                edits.push({ kind: 'setVersionOverride', file: projectPath, id, version });
            } else {
                overridable &&= packages.overridesEnabled;
                share({ kind: 'setPackageVersion', file: central.file, id, version });
            }
        }
    }

    const sharedEdits = [...shared.values()].filter(edit => edit.kind === 'setPackageVersion' || edit.kind === 'setGlobalPackageVersion');
    const sharedFiles = [...new Set(sharedEdits.map(edit => edit.file))];
    const alsoChanges = [...new Set(sharedFiles.flatMap(file => usersOf(states, id, file, selectedSet)))].sort();
    return {
        id, version, cliProjects, edits, alsoChanges, sharedFiles,
        canOverride: overridable && sharedEdits.some(edit => edit.kind === 'setPackageVersion'),
    };
}

/** Uninstall one package from the selected projects */
export interface UninstallPlan {
    readonly id: string;
    /** `dotnet remove package` (a PackageReference in the project file, with or without CPM) */
    readonly cliProjects: readonly string[];
    /** The global package, when a selected project gets it through a GlobalPackageReference */
    readonly global?: {
        readonly file: string;
        /** The selected projects that get it */
        readonly selected: readonly string[];
        /** Names of all projects that get it */
        readonly appliesTo: readonly string[];
    };
    /** Central versions no project of the solution uses after the removal (the UI asks before removing them) */
    readonly orphanedVersions: readonly { readonly file: string; readonly id: string }[];
}

export function planUninstall(id: string, selected: readonly string[], states: readonly ProjectState[]): UninstallPlan {
    const cliProjects: string[] = [];
    const globalSelected: string[] = [];
    let globalFile: string | undefined;
    for (const projectPath of selected) {
        const reference = referenceOf(states.find(state => state.path === projectPath)?.packages, id);
        if (reference?.source === 'global') {
            globalSelected.push(projectPath);
            globalFile ??= reference.versionFile;
        } else {
            cliProjects.push(projectPath);
        }
    }

    const removed = new Set(cliProjects);
    const orphanedVersions: { file: string; id: string }[] = [];
    for (const projectPath of cliProjects) {
        const packages = states.find(state => state.path === projectPath)?.packages;
        const central = packages?.centrallyManaged ? packages.centralVersions.get(lower(id)) : undefined;
        if (!central || orphanedVersions.some(orphan => same(orphan.file, central.file))) {
            continue;
        }
        const stillUsed = states.some(state => !removed.has(state.path) && state.packages?.centrallyManaged
            && !!referenceOf(state.packages, id) && same(state.packages.centralVersions.get(lower(id))?.file, central.file));
        if (!stillUsed) {
            orphanedVersions.push({ file: central.file, id: central.id });
        }
    }

    return {
        id,
        cliProjects,
        orphanedVersions,
        ...(globalFile ? { global: { file: globalFile, selected: globalSelected, appliesTo: usersOf(states, id, globalFile, new Set()).sort() } } : {}),
    };
}

/**
 * The edits of a global uninstall: `all` removes the GlobalPackageReference (and opt-outs left in the projects that
 * share the props file); `selected` adds an opt-out to each selected project
 */
export function globalUninstallEdits(plan: UninstallPlan, choice: 'all' | 'selected', states: readonly ProjectState[]): PackageEdit[] {
    const global = plan.global;
    if (!global) {
        return [];
    }
    if (choice === 'selected') {
        return global.selected.map(file => ({ kind: 'addGlobalOptOut' as const, file, id: plan.id }));
    }
    const sharing = states.filter(state => state.packages?.centrallyManaged && centralFiles(state.packages).some(file => same(file, global.file)));
    return [
        { kind: 'removeGlobalPackageReference', file: global.file, id: plan.id },
        ...sharing.map(state => ({ kind: 'removeGlobalOptOut' as const, file: state.path, id: plan.id })),
    ];
}

/** The confirmation of shared changes; undefined when no plan reaches projects beyond the selected ones */
export function confirmationText(plans: readonly VersionChangePlan[]): { message: string; detail: string } | undefined {
    const reaching = plans.filter(plan => plan.alsoChanges.length > 0);
    if (reaching.length === 0) {
        return undefined;
    }
    const line = (plan: VersionChangePlan) =>
        `${plan.id} ${plan.version} (${plan.sharedFiles.map(file => path.basename(file)).join(', ')}): also ${plan.alsoChanges.join(', ')}`;
    if (reaching.length === 1) {
        const [plan] = reaching;
        return {
            message: `Change ${plan.id} to ${plan.version} for every project that uses it?`,
            detail: `The version is set centrally in ${plan.sharedFiles.map(file => path.basename(file)).join(', ')}, so it also changes for ${plan.alsoChanges.join(', ')}.`,
        };
    }
    return {
        message: `Change the central versions of ${reaching.length} packages?`,
        detail: `They are set centrally, so other projects change too:\n${reaching.map(line).join('\n')}`,
    };
}
```

- [ ] **Step 4: Implement `src/services/nuget/centralPackageFiles.ts`**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { PackageEdit, applyEdit } from './centralPackageEdits';

/**
 * Writes planned edits: each file is read once, gets its edits in order, and is written only when it changed.
 * All files are edited in memory first, so an edit that fails (an entry not found) leaves every file untouched.
 * Returns the files that changed.
 */
export async function applyPackageEdits(edits: readonly PackageEdit[]): Promise<string[]> {
    const byFile = new Map<string, PackageEdit[]>();
    for (const edit of edits) {
        const file = path.normalize(edit.file);
        byFile.set(file, [...(byFile.get(file) ?? []), edit]);
    }
    const results: { file: string; content: string; edited: string }[] = [];
    for (const [file, fileEdits] of byFile) {
        const content = await fs.promises.readFile(file, 'utf8');
        results.push({ file, content, edited: fileEdits.reduce(applyEdit, content) });
    }
    const changed = results.filter(result => result.edited !== result.content);
    for (const result of changed) {
        await fs.promises.writeFile(result.file, result.edited, 'utf8');
    }
    return changed.map(result => result.file);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest src/test/unit/services/nuget/centralPackagePlan.test.ts src/test/unit/services/nuget/centralPackageFiles.msbuild.test.ts`
Expected: PASS (16 + 5 tests; the five MSBuild tests take about a minute together and are skipped without `dotnet`)

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/services/nuget/centralPackagePlan.ts src/services/nuget/centralPackageFiles.ts src/test/unit/services/nuget/centralPackagePlan.test.ts src/test/unit/services/nuget/centralPackageFiles.msbuild.test.ts
git commit -m "Central packages: plan install, update and uninstall, and write the edits

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Install, update, bulk update and uninstall through the plans

**Files:**
- Create: `src/services/nuget/centralPackageOperations.ts`
- Modify: `src/types/commands/backend.ts`, `src/webview/providers/NuGetCustomEditorProvider.ts`
- Test: `src/test/unit/services/nuget/centralPackageOperations.test.ts`
- Docs: `docs/nuget.md`, `docs/manual-testing.md`

The host side: evaluate the solution's projects (`solutionProjectStates`, from the cache when the tree evaluated them), plan, ask (native modal, like the other confirmations of the extension), write, run the CLI for projects without CPM, restore (the solution when a props file changed, else the changed projects), evaluate the affected projects again. The `OperationsHost` interface keeps VS Code, the CLI and the solution out of the tests.

The provider's three handlers stop calling `dotnet add/remove package` directly: install and the panel's update go through `changePackageVersions`, the Updates tab's "Update Selected" makes one change per package and calls it once (one confirmation for the bulk update), uninstall goes through `uninstallPackages`. A cancelled confirmation sends the completion message with `success: false` (the webview clears its loading state and keeps its data). `installPackage` gets the optional `versionScope` the webview sends for "Set for this project only" (Task 7).

- [ ] **Step 1: Write the failing tests**

`src/test/unit/services/nuget/centralPackageOperations.test.ts` (a copy of the fixture in a temp folder; the evaluated states are built from MSBuild-shaped JSON, so no MSBuild runs):
```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('vscode', () => ({ window: { showWarningMessage: jest.fn() } }), { virtual: true });
jest.mock('../../../../services/solutionService', () => ({ SolutionService: { getActiveSolution: () => undefined } }));

import { OperationsHost, changePackageVersions, uninstallPackages } from '../../../../services/nuget/centralPackageOperations';
import { ProjectState } from '../../../../services/nuget/centralPackagePlan';
import { ProjectPackages, parseMsbuildPackages } from '../../../../services/nuget/centralPackages';

const fixture = path.resolve(__dirname, '../../../../__fixtures__/central-packages/cpm');

describe('central package operations (confirmations, edits, CLI, restore)', () => {
    let root: string;
    const csproj = (name: string) => path.join(root, name, `${name}.csproj`);
    const props = () => path.join(root, 'Directory.Packages.props');
    const extra = () => path.join(root, 'Packages.Extra.props');
    const read = (file: string) => fs.readFileSync(file, 'utf8');

    /** The fixture's projects as MSBuild evaluates them (see centralPackages.msbuild.test.ts), without running MSBuild */
    const states = (): ProjectState[] => {
        const versions = [
            { Identity: 'Newtonsoft.Json', Version: '13.0.1', DefiningProjectFullPath: props() },
            { Identity: 'Serilog', Version: '3.1.1', DefiningProjectFullPath: props() },
            { Identity: 'Polly', Version: '8.1.0', DefiningProjectFullPath: extra() },
        ];
        const global = { Identity: 'Microsoft.SourceLink.GitHub', Version: '8.0.0', DefiningProjectFullPath: props() };
        const state = (name: string, references: object[], cpm = true, globals = true): ProjectState => ({
            name, path: csproj(name), packages: parseMsbuildPackages(JSON.stringify({
                Properties: { ManagePackageVersionsCentrally: String(cpm), DirectoryPackagesPropsPath: props() },
                Items: {
                    PackageReference: [...references.map(reference => ({ DefiningProjectFullPath: csproj(name), ...reference })),
                        ...(cpm && globals ? [{ Identity: global.Identity }] : [])],
                    PackageVersion: versions,
                    GlobalPackageReference: globals ? [global] : [],
                },
            }), csproj(name)) as ProjectPackages,
        });
        return [
            state('App', [{ Identity: 'Newtonsoft.Json' }, { Identity: 'Serilog' }, { Identity: 'Polly' }]),
            state('Override', [{ Identity: 'Newtonsoft.Json', VersionOverride: '13.0.2' }]),
            state('GlobalOnly', []),
            state('OptOut', [{ Identity: 'Serilog' }], true, false),
            state('Legacy', [{ Identity: 'Polly', Version: '8.0.0' }], false),
        ];
    };

    let host: jest.Mocked<OperationsHost>;
    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-operations-')));
        fs.cpSync(fixture, root, { recursive: true });
        host = {
            ask: jest.fn(),
            states: jest.fn().mockImplementation(async () => states()),
            install: jest.fn().mockResolvedValue({ success: true, message: 'installed' }),
            uninstall: jest.fn().mockResolvedValue({ success: true, message: 'uninstalled' }),
            restore: jest.fn().mockResolvedValue({ success: true, message: 'restored' }),
            solutionPath: jest.fn().mockReturnValue(path.join(root, 'Central.slnx')),
            reevaluate: jest.fn().mockResolvedValue(undefined),
        };
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    test('a central update that reaches other projects asks first; "Update All Projects" edits the props file once', async () => {
        host.ask.mockResolvedValue('Update All Projects');
        const outcome = await changePackageVersions([{ id: 'Serilog', version: '4.0.0', projects: [csproj('App')] }], 'shared', host);
        expect(host.ask).toHaveBeenCalledWith('Change Serilog to 4.0.0 for every project that uses it?',
            'The version is set centrally in Directory.Packages.props, so it also changes for OptOut.', 'Update All Projects', 'Set for This Project Only');
        expect(outcome.cancelled).toBe(false);
        expect(read(props())).toContain('<PackageVersion Include="Serilog" Version="4.0.0" />');
        expect(host.install).not.toHaveBeenCalled();
        expect(host.restore).toHaveBeenCalledWith(path.join(root, 'Central.slnx'));
        expect((host.reevaluate.mock.calls[0][0] as string[]).map(file => path.basename(file)).sort())
            .toEqual(['App.csproj', 'GlobalOnly.csproj', 'Override.csproj', 'OptOut.csproj'].sort());
    });

    test('"Set for This Project Only" writes a VersionOverride and leaves the props file alone', async () => {
        host.ask.mockResolvedValue('Set for This Project Only');
        const before = read(props());
        await changePackageVersions([{ id: 'Serilog', version: '4.0.0', projects: [csproj('App')] }], 'shared', host);
        expect(read(props())).toBe(before);
        expect(read(csproj('App'))).toContain('<PackageReference Include="Serilog" VersionOverride="4.0.0" />');
        expect(host.restore).toHaveBeenCalledWith(csproj('App'));
    });

    test('Cancel changes nothing', async () => {
        host.ask.mockResolvedValue(undefined);
        const before = read(props());
        expect(await changePackageVersions([{ id: 'Serilog', version: '4.0.0', projects: [csproj('App')] }], 'shared', host)).toEqual({ cancelled: true, results: [] });
        expect(read(props())).toBe(before);
        expect(host.restore).not.toHaveBeenCalled();
    });

    test('no question when every project that uses the version was selected; a bulk update asks once', async () => {
        await changePackageVersions([{ id: 'Serilog', version: '4.0.0', projects: [csproj('App'), csproj('OptOut')] }], 'shared', host);
        expect(host.ask).not.toHaveBeenCalled();
        host.ask.mockResolvedValue('Update All Projects');
        await changePackageVersions([
            { id: 'Polly', version: '8.2.0', projects: [csproj('GlobalOnly')] },
            { id: 'Microsoft.SourceLink.GitHub', version: '8.0.1', projects: [csproj('App')] },
        ], 'shared', host);
        expect(host.ask).toHaveBeenCalledTimes(1);
        // a global package cannot be set for one project: only "Update All Projects"
        expect(host.ask.mock.calls[0].slice(2)).toEqual(['Update All Projects']);
    });

    test('a project without CPM is updated with the CLI, as before', async () => {
        await changePackageVersions([{ id: 'Polly', version: '8.2.0', projects: [csproj('Legacy')] }], 'shared', host);
        expect(host.install).toHaveBeenCalledWith(csproj('Legacy'), 'Polly', '8.2.0');
        expect(read(extra())).toContain('Version="8.1.0"');
    });

    test('an edit that fails leaves every file as it was and reports the error', async () => {
        fs.writeFileSync(extra(), '<Project>\n</Project>\n');
        const before = read(props());
        host.ask.mockResolvedValue('Update All Projects');
        const outcome = await changePackageVersions([
            { id: 'Serilog', version: '4.0.0', projects: [csproj('App'), csproj('OptOut')] },
            { id: 'Polly', version: '8.2.0', projects: [csproj('App')] },
        ], 'shared', host);
        expect(outcome.results).toEqual([expect.objectContaining({ success: false, message: expect.stringContaining('No <PackageVersion Include="Polly">') })]);
        expect(read(props())).toBe(before);
    });

    test('uninstall: the CLI removes the reference, then a now unused central version is removed only when the user says so', async () => {
        host.ask.mockResolvedValueOnce('Remove');
        await uninstallPackages('Polly', [csproj('App')], host);
        expect(host.uninstall).toHaveBeenCalledWith(csproj('App'), 'Polly');
        expect(host.ask).toHaveBeenCalledWith('No project uses Polly any more. Remove its version from Packages.Extra.props?', expect.any(String), 'Remove');
        expect(read(extra())).not.toContain('Polly');

        host.ask.mockReset().mockResolvedValue(undefined);
        await uninstallPackages('Serilog', [csproj('App'), csproj('OptOut')], host);
        expect(read(props())).toContain('Include="Serilog"');
    });

    test('uninstall of a global package names every project; "only this project" adds an opt-out', async () => {
        host.ask.mockResolvedValue('Remove from This Project Only');
        await uninstallPackages('Microsoft.SourceLink.GitHub', [csproj('App')], host);
        expect(host.ask).toHaveBeenCalledWith('Microsoft.SourceLink.GitHub is a global package: every project gets it from Directory.Packages.props.',
            expect.stringContaining('It applies to App, GlobalOnly, Override.'), 'Remove for All Projects', 'Remove from This Project Only');
        expect(read(csproj('App'))).toContain('<GlobalPackageReference Remove="Microsoft.SourceLink.GitHub" />');
        expect(host.uninstall).not.toHaveBeenCalled();
        expect(read(props())).toContain('GlobalPackageReference Include');
    });

    test('uninstall of a global package for all projects removes it from the props file', async () => {
        host.ask.mockResolvedValue('Remove for All Projects');
        await uninstallPackages('Microsoft.SourceLink.GitHub', [csproj('App')], host);
        expect(read(props())).not.toContain('GlobalPackageReference');
        expect(read(csproj('OptOut'))).not.toContain('GlobalPackageReference');
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/test/unit/services/nuget/centralPackageOperations.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `src/services/nuget/centralPackageOperations.ts`**

```ts
import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from '../../core/logger';
import { SolutionService } from '../solutionService';
import { ProjectItemsService } from '../projectItems/projectItemsService';
import { PackageOperationsService } from './packageOperationsService';
import { PackageOperationResult } from './types';
import { centralFiles } from './centralPackages';
import { applyPackageEdits } from './centralPackageFiles';
import {
    ProjectState, VersionChangePlan, VersionScope, confirmationText, globalUninstallEdits, planUninstall, planVersionChange,
} from './centralPackagePlan';

const log = logger('CentralPackages');

/** What the operations need from VS Code, the CLI and the solution; replaced in tests */
export interface OperationsHost {
    /** A modal question; the chosen button, or undefined for Cancel */
    ask(message: string, detail: string, ...buttons: string[]): Promise<string | undefined>;
    /** The projects of the solution (and the given ones) with their evaluated packages */
    states(include: readonly string[]): Promise<ProjectState[]>;
    install(projectPath: string, id: string, version: string): Promise<PackageOperationResult>;
    uninstall(projectPath: string, id: string): Promise<PackageOperationResult>;
    restore(target: string): Promise<PackageOperationResult>;
    solutionPath(): string | undefined;
    /** Evaluates the projects again after their files or props files changed (the tree and the NuGet editor follow) */
    reevaluate(projectPaths: readonly string[]): Promise<void>;
}

export interface OperationOutcome {
    /** The user cancelled the confirmation: nothing was changed */
    readonly cancelled: boolean;
    readonly results: PackageOperationResult[];
}

/** The open solution's projects, each evaluated once (from the cache when the tree did it already) */
export async function solutionProjectStates(include: readonly string[] = []): Promise<ProjectState[]> {
    const projects = [...(SolutionService.getActiveSolution()?.projects.values() ?? [])];
    await Promise.all(projects.map(project => project.evaluateItems()));
    const states: ProjectState[] = projects.map(project => ({
        name: project.name, path: project.projectPath, packages: ProjectItemsService.instance.packages(project.projectPath),
    }));
    // A project the NuGet editor was opened for that is not in the solution
    for (const projectPath of include.filter(candidate => !states.some(state => state.path === candidate))) {
        states.push({
            name: path.basename(projectPath, path.extname(projectPath)), path: projectPath,
            packages: await ProjectItemsService.instance.evaluatePackages(projectPath),
        });
    }
    return states;
}

export const vscodeHost: OperationsHost = {
    ask: (message, detail, ...buttons) => Promise.resolve(vscode.window.showWarningMessage(message, { modal: true, detail }, ...buttons)),
    states: solutionProjectStates,
    install: (projectPath, id, version) => PackageOperationsService.installPackage({ packageId: id, version, projectPath }),
    uninstall: (projectPath, id) => PackageOperationsService.uninstallPackage(projectPath, id),
    restore: target => PackageOperationsService.restorePackages(target),
    solutionPath: () => SolutionService.getActiveSolution()?.solutionPath,
    reevaluate: async projectPaths => {
        const solution = SolutionService.getActiveSolution();
        await Promise.all(projectPaths.map(async projectPath => {
            const project = solution?.getProject(projectPath);
            if (project) {
                await project.reevaluateItems();
            } else {
                ProjectItemsService.instance.invalidate(projectPath);
                await ProjectItemsService.instance.evaluate(projectPath);
            }
        }));
    },
};

const isProjectFile = (file: string) => /\.(cs|vb|fs)proj$/i.test(file);
const same = (a: string, b: string) => path.normalize(a) === path.normalize(b);

/**
 * After edits: restore (the whole solution when a props file changed, it reaches every project below it) and
 * evaluate the projects whose files or props files changed
 */
async function afterEdits(changed: readonly string[], states: readonly ProjectState[], host: OperationsHost): Promise<PackageOperationResult[]> {
    if (changed.length === 0) {
        return [];
    }
    const propsChanged = changed.filter(file => !isProjectFile(file));
    const affected = states.filter(state => changed.some(file => same(file, state.path))
        || (!!state.packages && centralFiles(state.packages).some(file => propsChanged.some(changedFile => same(file, changedFile)))));
    const solutionPath = host.solutionPath();
    const targets = propsChanged.length > 0 && solutionPath ? [solutionPath] : affected.map(state => state.path);
    const results: PackageOperationResult[] = [];
    for (const target of targets) {
        results.push(await host.restore(target));
    }
    await host.reevaluate(affected.map(state => state.path));
    return results;
}

async function apply(edits: Parameters<typeof applyPackageEdits>[0]): Promise<{ changed: string[]; result?: PackageOperationResult }> {
    try {
        return { changed: await applyPackageEdits(edits) };
    } catch (error) {
        log.error('Could not edit the package versions:', error);
        return { changed: [], result: { success: false, message: `Could not edit the package versions: ${error instanceof Error ? error.message : error}` } };
    }
}

/**
 * Install or update packages (one entry per package, with the projects it is for). Central versions are edited once
 * per package; when that reaches projects that were not selected, one confirmation lists them, with "Set for this
 * project only" as the alternative. Projects without CPM go through `dotnet add package` as before.
 */
export async function changePackageVersions(
    changes: readonly { id: string; version: string; projects: readonly string[] }[], scope: VersionScope = 'shared', host: OperationsHost = vscodeHost,
): Promise<OperationOutcome> {
    const states = await host.states([...new Set(changes.flatMap(change => change.projects))]);
    const plan = (chosen: VersionScope) => changes.map(change => planVersionChange(change.id, change.version, change.projects, states, chosen));
    let plans: VersionChangePlan[] = plan(scope);

    const question = confirmationText(plans);
    if (question) {
        const selectedCount = new Set(changes.flatMap(change => change.projects)).size;
        const onlyThese = selectedCount === 1 ? 'Set for This Project Only' : 'Set for the Selected Projects Only';
        const canOverride = scope === 'shared' && plans.every(candidate => candidate.alsoChanges.length === 0 || candidate.canOverride);
        const choice = await host.ask(question.message, question.detail, 'Update All Projects', ...(canOverride ? [onlyThese] : []));
        if (!choice) {
            return { cancelled: true, results: [] };
        }
        if (choice === onlyThese) {
            plans = plan('project');
        }
    }

    const results: PackageOperationResult[] = [];
    const { changed, result } = await apply(plans.flatMap(candidate => candidate.edits));
    if (result) {
        return { cancelled: false, results: [result] };
    }
    for (const candidate of plans) {
        if (candidate.edits.length > 0) {
            results.push({ success: true, message: `${candidate.id} ${candidate.version}`, packageId: candidate.id, version: candidate.version });
        }
        for (const projectPath of candidate.cliProjects) {
            results.push(await host.install(projectPath, candidate.id, candidate.version));
        }
    }
    results.push(...(await afterEdits(changed, states, host)).filter(restore => !restore.success));
    return { cancelled: false, results };
}

/**
 * Uninstall a package from the selected projects. A global package is removed for all projects or opted out for the
 * selected ones (the question names every project it applies to); a central version no project uses afterwards is
 * removed only when the user says so.
 */
export async function uninstallPackages(id: string, projects: readonly string[], host: OperationsHost = vscodeHost): Promise<OperationOutcome> {
    const states = await host.states(projects);
    const plan = planUninstall(id, projects, states);
    const results: PackageOperationResult[] = [];
    const changed: string[] = [];

    if (plan.global) {
        const onlyThese = plan.global.selected.length === 1 ? 'Remove from This Project Only' : 'Remove from the Selected Projects Only';
        const choice = await host.ask(
            `${id} is a global package: every project gets it from ${path.basename(plan.global.file)}.`,
            `It applies to ${plan.global.appliesTo.join(', ')}. Remove it for all of them, or only for the selected project${plan.global.selected.length === 1 ? '' : 's'} (a GlobalPackageReference Remove in the project file)?`,
            'Remove for All Projects', onlyThese);
        if (!choice && plan.cliProjects.length === 0) {
            return { cancelled: true, results: [] };
        }
        if (choice) {
            const applied = await apply(globalUninstallEdits(plan, choice === onlyThese ? 'selected' : 'all', states));
            changed.push(...applied.changed);
            results.push(applied.result ?? { success: true, message: `Removed ${id}`, packageId: id });
        }
    }

    const removed: string[] = [];
    for (const projectPath of plan.cliProjects) {
        const result = await host.uninstall(projectPath, id);
        results.push(result);
        if (result.success) {
            removed.push(projectPath);
        }
    }

    // Only when every removal worked: otherwise a project still uses the version
    if (removed.length === plan.cliProjects.length) {
        for (const orphan of plan.orphanedVersions) {
            const choice = await host.ask(`No project uses ${orphan.id} any more. Remove its version from ${path.basename(orphan.file)}?`,
                `The PackageVersion entry is unused now; keep it if a project outside this solution uses it.`, 'Remove');
            if (choice === 'Remove') {
                const applied = await apply([{ kind: 'removePackageVersion', file: orphan.file, id: orphan.id }]);
                changed.push(...applied.changed);
                if (applied.result) {
                    results.push(applied.result);
                }
            }
        }
    }

    results.push(...(await afterEdits(changed, states, host)).filter(restore => !restore.success));
    await host.reevaluate(removed.filter(projectPath => !changed.includes(projectPath)));
    return { cancelled: false, results };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/test/unit/services/nuget/centralPackageOperations.test.ts`
Expected: PASS (9 tests; the failing-edit test logs one `CentralPackages` error on purpose)

- [ ] **Step 5: The message and the provider**

```diff
--- a/src/types/commands/backend.ts
+++ b/src/types/commands/backend.ts
@@ -40,6 +40,11 @@
         readonly projects: string[],
         readonly version: string
         readonly includePrerelease: boolean
+        /**
+         * Central Package Management: `shared` (default) changes the central version (asking first when that reaches
+         * other projects), `project` writes a VersionOverride ("Set for this project only"); see centralPackagePlan
+         */
+        readonly versionScope?: 'shared' | 'project'
     }
 }
 
--- a/src/webview/providers/NuGetCustomEditorProvider.ts
+++ b/src/webview/providers/NuGetCustomEditorProvider.ts
@@ -6,8 +6,7 @@
 import { logger } from '../../core/logger';
 import { NuGetWebview } from './views/NuGetWebview';
 import { LocalNuGetPackage, sendToUi } from '../nuget-view/shared';
-import { PackageUpdateService } from '../../services/nuget/packageUpdateService';
-import { PackageOperationsService } from '../../services/nuget/packageOperationsService';
+import { changePackageVersions, uninstallPackages } from '../../services/nuget/centralPackageOperations';
 import { PackageConsolidationService } from '../../services/nuget/packageConsolidationService';
 import { BackendCmd, BulkConsolidatePackagesCmd, BulkUpdatePackagesCmd, InstallPackageCmd, SearchPackagesCmd, UnInstallPackageCmd } from '../../types/commands/backend';
 import { NuGetViewData } from '../../types/commands/ui';
@@ -415,12 +414,16 @@
 
             log.info(`Installing package ${installPackage.id} version ${installVersion} to projects:`, installProjects);
 
-            // Use NuGetManagerService to install the package in multiple projects
-            const results = await NuGetManagerService.installPackageInMultipleProjects(
-                installPackage.id,
-                installVersion,
-                installProjects
+            // Central Package Management edits Directory.Packages.props (asking when that reaches other projects);
+            // projects without it go through dotnet add package
+            const { cancelled, results } = await changePackageVersions(
+                [{ id: installPackage.id, version: installVersion, projects: installProjects }],
+                installData.versionScope ?? 'shared'
             );
+            if (cancelled) {
+                sendToUi(webview, { type: 'installComplete', payload: { success: false, packageId: installPackage.id } });
+                return;
+            }
 
             // Process results and show appropriate messages
             const successful = results.filter(r => r.success);
@@ -477,11 +480,11 @@
 
             log.info(`Uninstalling package ${uninstallPackage.id} from projects:`, uninstallProjects);
 
-            // Use NuGetManagerService to uninstall the package from multiple projects
-            const results = [];
-            for (const projectPath of uninstallProjects) {
-                const result = await PackageOperationsService.uninstallPackage(projectPath, uninstallPackage.id);
-                results.push(result);
+            // dotnet remove package per project; a global package is removed or opted out in the props/project files
+            const { cancelled, results } = await uninstallPackages(uninstallPackage.id, uninstallProjects);
+            if (cancelled) {
+                sendToUi(webview, { type: 'uninstallComplete', payload: { success: false, packageId: uninstallPackage.id } });
+                return;
             }
 
             // Process results and show appropriate messages
@@ -538,60 +541,22 @@
 
             log.info(`Bulk updating ${packages.length} packages`);
 
+            // One change per package (central versions are edited once, not once per project), one confirmation for all
+            const changes = packages.flatMap(pkg => {
+                const version = pkg.versions?.filter(VersionUtils.includePrerelease(message.payload.includePrerelease)).sort(VersionUtils.compare)[0];
+                const projects = context.type === 'project' ? [context.target] : (pkg.projects ?? []).map(project => project.path);
+                return version && projects.length > 0 ? [{ id: pkg.id, version, projects }] : [];
+            });
+
             // Show progress notification
-            await vscode.window.withProgress({
+            const cancelled = await vscode.window.withProgress({
                 location: vscode.ProgressLocation.Notification,
-                title: `Updating`,
+                title: `Updating ${changes.length} package(s)`,
                 cancellable: false
-            }, async (progress) => {
-                const results = [];
-
-                for (const pkg of packages) {
-                    progress.report({
-                        increment: (100 / packages.length),
-                        message: `: ${pkg.id}`
-                    });
-
-                    try {
-                        if (context.type === 'project') {
-                            const result = await PackageUpdateService.updatePackage(
-                                context.target,
-                                pkg.id,
-                                pkg.versions?.filter(VersionUtils.includePrerelease(message.payload.includePrerelease))
-                                    .sort(VersionUtils.compare)[0]
-                            );
-                            results.push(result);
-
-                        } else {
-                            for (const project of pkg.projects || []) {
-                                try {
-                                    // For solution context, update in the specific project
-                                    const result = await PackageUpdateService.updatePackage(
-                                        project.path,
-                                        pkg.id,
-                                        pkg.versions?.filter(VersionUtils.includePrerelease(message.payload.includePrerelease))
-                                            .sort(VersionUtils.compare)[0]
-                                    );
-                                    results.push(result);
-                                } catch (error) {
-                                    log.error(`Error updating ${pkg.id}:`, error);
-                                    results.push({
-                                        success: false,
-                                        message: `Failed to update ${pkg.id} in ${project.name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
-                                        packageId: pkg.id
-                                    });
-                                }
-
-                            }
-                        }
-                    } catch (error) {
-                        log.error(`Error updating ${pkg.id}:`, error);
-                        results.push({
-                            success: false,
-                            message: `Failed to update ${pkg.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
-                            packageId: pkg.id
-                        });
-                    }
+            }, async () => {
+                const { cancelled, results } = await changePackageVersions(changes);
+                if (cancelled) {
+                    return true;
                 }
 
                 const successful = results.filter(r => r.success).length;
@@ -604,13 +569,14 @@
                 } else {
                     vscode.window.showWarningMessage(`Updated ${successful} packages, ${failed} failed`);
                 }
+                return false;
             });
 
             // Send completion message to frontend
             sendToUi(webview, {
                 type: 'bulkUpdateComplete',
                 payload: {
-                    success: true
+                    success: !cancelled
                 }
             });
 
```
`NuGetManagerService.installPackageInMultipleProjects` has no caller afterwards; delete it, and with it the imports `typecheck` then reports as unused in `nugetManagerService.ts` (`PackageOperationsService`, and `PackageOperationResult` from `./types`). `PackageUpdateService` stays: Consolidate uses it until Task 6.

- [ ] **Step 6: Docs**

`docs/nuget.md`, append to the "Central Package Management" section from Task 3:
```markdown
### What Install, Update and Uninstall change

The extension edits `Directory.Packages.props` itself (the `dotnet` CLI refuses imported props files and global packages), as text edits that keep your formatting and comments, in the file that defines the entry.

| Action | What is written |
|---|---|
| **Install** a package the props file has no version for | `<PackageReference Include="X" />` in the project, `<PackageVersion Include="X" Version="..." />` in `Directory.Packages.props` |
| **Install** or **Update** to another version than the central one | the central `PackageVersion` (once, for every project that uses it) |
| **Set for this project only** | `VersionOverride="..."` on the project's `PackageReference`; the other projects keep the central version |
| **Update** a package the project overrides | its `VersionOverride`; set to the central version it is removed again |
| **Update** a global package | the `Version` of its `GlobalPackageReference` |
| **Uninstall** | the project's `PackageReference`; when no project of the solution uses the package any more you are asked whether to remove its `PackageVersion` too |
| **Uninstall** a global package | the `GlobalPackageReference` (for every project), or, for the selected projects only, `<GlobalPackageReference Remove="X" />` in each project file |

**Before a change reaches other projects** (a central or global version used by projects you did not select), a confirmation lists them: **Update All Projects** changes the central version, **Set for This Project Only** writes a `VersionOverride` instead (not offered for global packages, or when `CentralPackageVersionOverrideEnabled` is `false`). Update Selected on the Updates tab asks once for all packages. Afterwards the solution is restored.

Projects that do not use CPM in the same solution are changed with `dotnet add package` / `dotnet remove package`, as before.
```

`docs/manual-testing.md`, append unticked:
```markdown
- [ ] Central Package Management, install and update (copy of `src/__fixtures__/central-packages/cpm`): NuGet manager on App > Installed > Serilog > another version > Install: the confirmation names OptOut; Update All Projects changes the `PackageVersion` in `Directory.Packages.props` (formatting and comments kept) and both trees show the new version after the restore; again with Set for This Project Only: App's `.csproj` gets `VersionOverride`, OptOut keeps the central version; Polly (in the imported `Packages.Extra.props`) is changed in that file; Browse > Humanizer.Core > Install on GlobalOnly adds a `PackageReference` without `Version` and a `PackageVersion`; Legacy (CPM off) still gets a `Version` attribute
- [ ] Central Package Management, global packages and uninstall: Uninstall Microsoft.SourceLink.GitHub on App names App, GlobalOnly, Override; Remove from This Project Only adds `<GlobalPackageReference Remove=... />` to App only; Remove for All Projects deletes the `GlobalPackageReference`; Install on OptOut takes its opt-out back; Uninstall Polly from App asks whether to remove its now unused `PackageVersion` (Remove / Cancel both behave); Update Selected on the solution's Updates tab with two central packages asks once
```

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git add src/services/nuget/centralPackageOperations.ts src/services/nuget/nugetManagerService.ts src/types/commands/backend.ts src/webview/providers/NuGetCustomEditorProvider.ts src/test/unit/services/nuget/centralPackageOperations.test.ts docs/nuget.md docs/manual-testing.md
git commit -m "Central packages: install, update and uninstall edit Directory.Packages.props, with a confirmation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: exit 0.

---

### Task 6: Consolidate under CPM

**Files:**
- Modify: `src/services/nuget/centralPackagePlan.ts`, `src/services/nuget/centralPackageOperations.ts`, `src/webview/providers/NuGetCustomEditorProvider.ts`
- Delete: `src/services/nuget/packageConsolidationService.ts`, `src/services/nuget/packageUpdateService.ts` (their only caller is replaced; both ran `dotnet add package --version` per project, which `OperationsHost.install` does)
- Test: `src/test/unit/services/nuget/centralPackagePlan.test.ts`, `src/test/unit/services/nuget/centralPackageOperations.test.ts` (extend)
- Docs: `docs/nuget.md`, `docs/manual-testing.md`

The Consolidate tab already finds CPM packages once the versions are real (Task 3: an override differs from the central version; unknown versions are ignored). Consolidating one under CPM sets the central (or global) version to the chosen one and removes the overrides, after one confirmation that lists what changes; projects without CPM in the same solution keep today's per-project `dotnet add package --version`.

- [ ] **Step 1: Write the failing tests**

Append to `src/test/unit/services/nuget/centralPackagePlan.test.ts` (and add `consolidationText, planConsolidate` to its import from `centralPackagePlan`):
```ts

describe('planConsolidate', () => {
    test('under CPM: the central version set once, the overrides removed', () => {
        const plan = planConsolidate('Newtonsoft.Json', '13.0.3', states);
        expect(plan.edits).toEqual([
            { kind: 'setPackageVersion', file: props, id: 'Newtonsoft.Json', version: '13.0.3' },
            { kind: 'removeVersionOverride', file: override.path, id: 'Newtonsoft.Json' },
        ]);
        expect(plan.changes).toEqual(['Directory.Packages.props: 13.0.1 → 13.0.3', 'Override: VersionOverride 13.0.2 removed']);
        expect(plan.cliProjects).toEqual([]);
    });

    test('to the central version: only the overrides go', () => {
        expect(planConsolidate('Newtonsoft.Json', '13.0.1', states).edits).toEqual([{ kind: 'removeVersionOverride', file: override.path, id: 'Newtonsoft.Json' }]);
    });

    test('a mixed solution: projects without CPM through the CLI, the central version in its imported file', () => {
        const plan = planConsolidate('Polly', '8.1.0', states);
        expect(plan.cliProjects).toEqual([legacy.path]);
        expect(plan.edits).toEqual([]);
        expect(planConsolidate('Polly', '8.2.0', states).edits).toEqual([{ kind: 'setPackageVersion', file: extra, id: 'Polly', version: '8.2.0' }]);
    });

    test('consolidationText lists what changes; nothing to confirm without CPM edits', () => {
        expect(consolidationText([planConsolidate('Newtonsoft.Json', '13.0.3', states)])).toEqual({
            message: 'Consolidate Newtonsoft.Json to 13.0.3?',
            detail: 'Newtonsoft.Json 13.0.3:\n  Directory.Packages.props: 13.0.1 → 13.0.3\n  Override: VersionOverride 13.0.2 removed',
        });
        expect(consolidationText([planConsolidate('Polly', '8.1.0', states)])).toBeUndefined();
    });
});
```

In `src/test/unit/services/nuget/centralPackageOperations.test.ts` replace the last line (the `});` that closes its `describe`) with the following, and add `consolidatePackages` to its import from `centralPackageOperations`:
```ts

    test('consolidate under CPM: one confirmation, the central version set, the override removed', async () => {
        host.ask.mockResolvedValue('Consolidate');
        const outcome = await consolidatePackages([{ id: 'Newtonsoft.Json', version: '13.0.3' }], host);
        expect(host.ask).toHaveBeenCalledWith('Consolidate Newtonsoft.Json to 13.0.3?', expect.stringContaining('Override: VersionOverride 13.0.2 removed'), 'Consolidate');
        expect(outcome.results).toEqual([expect.objectContaining({ success: true, packageId: 'Newtonsoft.Json' })]);
        expect(read(props())).toContain('<PackageVersion Include="Newtonsoft.Json" Version="13.0.3" />');
        expect(read(csproj('Override'))).not.toContain('VersionOverride');
        expect(host.restore).toHaveBeenCalledWith(path.join(root, 'Central.slnx'));
    });

    test('consolidate: Cancel changes nothing; projects without CPM use the CLI', async () => {
        host.ask.mockResolvedValue(undefined);
        expect((await consolidatePackages([{ id: 'Newtonsoft.Json', version: '13.0.3' }], host)).cancelled).toBe(true);
        expect(read(csproj('Override'))).toContain('VersionOverride="13.0.2"');
        await consolidatePackages([{ id: 'Polly', version: '8.1.0' }], host);
        expect(host.install).toHaveBeenCalledWith(csproj('Legacy'), 'Polly', '8.1.0');
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/test/unit/services/nuget/centralPackagePlan.test.ts src/test/unit/services/nuget/centralPackageOperations.test.ts`
Expected: FAIL (`planConsolidate`, `consolidationText`, `consolidatePackages` not exported)

- [ ] **Step 3: Implement**

Append to `src/services/nuget/centralPackagePlan.ts`:
```ts
/** Consolidate one package to one version in every project of the solution that uses it */
export interface ConsolidatePlan {
    readonly id: string;
    readonly version: string;
    /** Projects without CPM whose version differs: `dotnet add package --version`, as before */
    readonly cliProjects: readonly string[];
    readonly edits: readonly PackageEdit[];
    /** What the edits do, one line each, for the confirmation */
    readonly changes: readonly string[];
}

/**
 * Under CPM the versions differ through VersionOverrides (or central versions of different props files): the central
 * and global versions are set to the chosen one and the overrides removed. Projects without CPM keep today's way.
 */
export function planConsolidate(id: string, version: string, states: readonly ProjectState[]): ConsolidatePlan {
    const cliProjects: string[] = [];
    const edits: PackageEdit[] = [];
    const changes: string[] = [];
    const seen = new Set<string>();
    for (const state of states) {
        const reference = referenceOf(state.packages, id);
        if (!reference) {
            continue;
        }
        if (!state.packages?.centrallyManaged || reference.source === 'project') {
            if (reference.version !== version) {
                cliProjects.push(state.path);
            }
        } else if (reference.source === 'override') {
            edits.push({ kind: 'removeVersionOverride', file: state.path, id });
            changes.push(`${state.name}: VersionOverride ${reference.version} removed`);
        }
        const central = reference.source === 'global' ? { version: reference.version, file: reference.versionFile }
            : state.packages?.centrallyManaged ? state.packages.centralVersions.get(lower(id)) : undefined;
        if (central?.file && central.version !== version && !seen.has(path.normalize(central.file))) {
            seen.add(path.normalize(central.file));
            edits.push(reference.source === 'global'
                ? { kind: 'setGlobalPackageVersion', file: central.file, id, version }
                : { kind: 'setPackageVersion', file: central.file, id, version });
            changes.push(`${path.basename(central.file)}: ${central.version} → ${version}`);
        }
    }
    return { id, version, cliProjects, edits, changes };
}

/** The confirmation of a consolidation under CPM; undefined when it edits no CPM file */
export function consolidationText(plans: readonly ConsolidatePlan[]): { message: string; detail: string } | undefined {
    const central = plans.filter(plan => plan.changes.length > 0);
    if (central.length === 0) {
        return undefined;
    }
    return {
        message: central.length === 1
            ? `Consolidate ${central[0].id} to ${central[0].version}?`
            : `Consolidate ${central.length} packages?`,
        detail: central.map(plan => [`${plan.id} ${plan.version}:`, ...plan.changes.map(change => `  ${change}`)].join('\n')).join('\n'),
    };
}
```

In `src/services/nuget/centralPackageOperations.ts` add `consolidationText` and `planConsolidate` to the import from `./centralPackagePlan`, and append:
```ts
/**
 * Consolidate packages to one version each across the solution. Under CPM that sets the central (or global) version
 * and removes the VersionOverrides, after one confirmation listing what changes; projects without CPM are updated
 * with `dotnet add package --version`.
 */
export async function consolidatePackages(changes: readonly { id: string; version: string }[], host: OperationsHost = vscodeHost): Promise<OperationOutcome> {
    const states = await host.states([]);
    const plans = changes.map(change => planConsolidate(change.id, change.version, states));
    const question = consolidationText(plans);
    if (question && await host.ask(question.message, question.detail, 'Consolidate') !== 'Consolidate') {
        return { cancelled: true, results: [] };
    }
    const { changed, result } = await apply(plans.flatMap(plan => plan.edits));
    if (result) {
        return { cancelled: false, results: [result] };
    }
    const results: PackageOperationResult[] = [];
    for (const plan of plans) {
        if (plan.edits.length > 0) {
            results.push({ success: true, message: `${plan.id} ${plan.version}`, packageId: plan.id, version: plan.version });
        }
        for (const projectPath of plan.cliProjects) {
            results.push(await host.install(projectPath, plan.id, plan.version));
        }
        if (plan.edits.length === 0 && plan.cliProjects.length === 0) {
            results.push({ success: true, message: `${plan.id} is already at ${plan.version} in all projects`, packageId: plan.id });
        }
    }
    results.push(...(await afterEdits(changed, states, host)).filter(restore => !restore.success));
    return { cancelled: false, results };
}
```

- [ ] **Step 4: The provider**

```diff
--- a/src/webview/providers/NuGetCustomEditorProvider.ts
+++ b/src/webview/providers/NuGetCustomEditorProvider.ts
@@ -6,8 +6,7 @@
 import { logger } from '../../core/logger';
 import { NuGetWebview } from './views/NuGetWebview';
 import { LocalNuGetPackage, sendToUi } from '../nuget-view/shared';
-import { changePackageVersions, uninstallPackages } from '../../services/nuget/centralPackageOperations';
-import { PackageConsolidationService } from '../../services/nuget/packageConsolidationService';
+import { changePackageVersions, consolidatePackages, uninstallPackages } from '../../services/nuget/centralPackageOperations';
 import { BackendCmd, BulkConsolidatePackagesCmd, BulkUpdatePackagesCmd, InstallPackageCmd, SearchPackagesCmd, UnInstallPackageCmd } from '../../types/commands/backend';
 import { NuGetViewData } from '../../types/commands/ui';
 import { VersionUtils } from '../../services/versionUtils';
@@ -607,51 +606,28 @@
 
             log.info(`Bulk consolidating ${packages.length} packages`);
 
+            if (context.type !== 'solution') {
+                vscode.window.showWarningMessage('Consolidation needs the solution, not a single project');
+                sendToUi(webview, { type: 'bulkConsolidateComplete', payload: { success: false } });
+                return;
+            }
+            // The target of each package: its newest version (prerelease as chosen), else the one it has
+            const changes = packages.map(pkg => ({
+                id: pkg.id,
+                version: pkg.versions?.filter(VersionUtils.includePrerelease(message.payload.includePrerelease)).sort(VersionUtils.compare)[0]
+                    || pkg.currentVersion,
+            }));
+
             // Show progress notification
-            await vscode.window.withProgress({
+            const cancelled = await vscode.window.withProgress({
                 location: vscode.ProgressLocation.Notification,
                 title: `Consolidating`,
                 cancellable: false
-            }, async (progress) => {
-                const results = [];
-
-                for (const pkg of packages) {
-                    progress.report({
-                        increment: (100 / packages.length),
-                        message: `: ${pkg.id}`
-                    });
-
-                    try {
-                        // For consolidation, we need to find the target version and affected projects
-                        const targetVersion = pkg.versions?.filter(VersionUtils.includePrerelease(message.payload.includePrerelease))
-                            .sort(VersionUtils.compare)[0]
-                            || pkg.currentVersion;
-
-                        if (context.type === 'solution') {
-                            // Use the consolidation service to consolidate this specific package
-                            const result = await PackageConsolidationService.consolidatePackageToVersion(
-                                context.target,
-                                pkg.id,
-                                targetVersion
-                            );
-                            results.push(...result);
-                        } else {
-                            // For project context, we can't really consolidate (need multiple projects)
-                            results.push({
-                                success: false,
-                                message: `Consolidation requires a solution context, not a single project`,
-                                packageId: pkg.id
-                            });
-                        }
-
-                    } catch (error) {
-                        log.error(`Error consolidating ${pkg.id}:`, error);
-                        results.push({
-                            success: false,
-                            message: `Failed to consolidate ${pkg.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
-                            packageId: pkg.id
-                        });
-                    }
+            }, async () => {
+                // Under CPM: one confirmation, the central version set, the overrides removed
+                const { cancelled, results } = await consolidatePackages(changes);
+                if (cancelled) {
+                    return true;
                 }
 
                 const successful = results.filter(r => r.success).length;
@@ -664,6 +640,7 @@
                 } else {
                     vscode.window.showWarningMessage(`Consolidated ${successful} packages, ${failed} failed`);
                 }
+                return false;
             });
 
             // Refresh the consolidate tab data
@@ -673,7 +650,7 @@
             sendToUi(webview, {
                 type: 'bulkConsolidateComplete',
                 payload: {
-                    success: true
+                    success: !cancelled
                 }
             });
 
```
Then delete the two services: `git rm src/services/nuget/packageConsolidationService.ts src/services/nuget/packageUpdateService.ts` (check first: `grep -rn "PackageConsolidationService\|PackageUpdateService" src` lists only the two files).

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest src/test/unit/services/nuget`
Expected: PASS

- [ ] **Step 6: Docs**

`docs/nuget.md`, append to the "Central Package Management" section:
```markdown
### Consolidate

Under CPM the versions of a package differ only through `VersionOverride`s (or through two props files with different versions). Consolidate sets the central version (or the global one) to the chosen version and removes the overrides; a confirmation lists each change first. Projects in the same solution that do not use CPM are updated in their project files, as before.
```

`docs/manual-testing.md`, append unticked:
```markdown
- [ ] Central Package Management, Consolidate (copy of `src/__fixtures__/central-packages/cpm`, solution NuGet manager): the Consolidate tab lists Newtonsoft.Json (13.0.1 in App, 13.0.2 in Override) and Polly (8.1.0 central, 8.0.0 in Legacy); consolidating Newtonsoft.Json asks once, then `Directory.Packages.props` has the chosen version and Override's `VersionOverride` is gone; consolidating Polly updates Legacy's `Version` attribute with `dotnet add package` and the central Polly version in `Packages.Extra.props` only when it differs; Cancel changes nothing
```

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git add src/services/nuget/centralPackagePlan.ts src/services/nuget/centralPackageOperations.ts src/webview/providers/NuGetCustomEditorProvider.ts src/test/unit/services/nuget/centralPackagePlan.test.ts src/test/unit/services/nuget/centralPackageOperations.test.ts docs/nuget.md docs/manual-testing.md
git commit -m "Central packages: Consolidate sets the central version and removes the overrides

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: exit 0; `git show --stat HEAD` lists the two deleted services.

---

### Task 7: The NuGet webview: labels, the "global" badge, where a version comes from, "Set for This Project Only"; GIF

**Files:**
- Create: `src/webview/nuget-view/versionLabels.ts`
- Modify: `src/webview/nuget-view/shared.ts`, `src/webview/nuget-view/components/ProjectList.tsx`, `src/webview/nuget-view/components/PackageList.tsx`, `src/webview/nuget-view/components/PackageActions.tsx`, `src/webview/nuget-view/App.tsx`
- Test: `src/test/unit/webview/nuget-view/versionLabels.test.ts`, `src/test/unit/webview/nuget-view/CentralPackages.test.tsx` (create)
- Docs: `docs/nuget.md`, `docs/manual-testing.md`, `scripts/screenshots/capture.sh`, `docs/images/central-packages.gif`

The data already carries `versionSource`/`versionFile` per project entry (Task 3). The webview shows `v13.0.2 (override)`, `v8.0.0 (global)` and `version not known` (`versionLabel`), a `global` badge next to global packages in the lists, a note in the details pane on where the version comes from (in the solution context with the projects that share it: the project context only has its own project, the confirmation of Task 5 names the others), and a **Set for This Project Only** button (Installed and Updates tabs) when every selected project takes the version from a central entry; it sends `installPackage` with `versionScope: 'project'`. `versionLabels.ts` imports types only (the webview bundle must not reach Node modules: `centralPackages.ts` imports `path`).

- [ ] **Step 1: Write the failing tests**

`src/test/unit/webview/nuget-view/versionLabels.test.ts`:
```ts
import { canSetForProjectOnly, centralNote, isGlobal, versionLabel } from '../../../../webview/nuget-view/versionLabels';

const entry = (project: string, id: string, currentVersion: string, versionSource?: string, versionFile = '/repo/Directory.Packages.props') =>
    ({ id, currentVersion, versionSource, versionFile, projectPath: `/repo/${project}.csproj`, projectName: project });
const project = (name: string, ...packages: object[]) => ({ name, path: `/repo/${name}.csproj`, framework: 'net8.0', packages });

const app = project('App', entry('App', 'Serilog', '3.1.1', 'central'), entry('App', 'SourceLink', '8.0.0', 'global'));
const web = project('Web', entry('Web', 'Serilog', '3.1.1', 'central'));
const override = project('Override', entry('Override', 'Serilog', '4.0.0', 'override', '/repo/Override.csproj'));
const legacy = project('Legacy', entry('Legacy', 'Polly', '8.0.0', 'project'));
const all = [app, web, override, legacy] as any[];

describe('versionLabel', () => {
    test('version with its source; unknown said plainly', () => {
        expect(versionLabel({ currentVersion: '3.1.1', versionSource: 'central' })).toBe('v3.1.1');
        expect(versionLabel({ currentVersion: '13.0.2', versionSource: 'override' })).toBe('v13.0.2 (override)');
        expect(versionLabel({ currentVersion: '8.0.0', versionSource: 'global' })).toBe('v8.0.0 (global)');
        expect(versionLabel({ currentVersion: '' })).toBe('version not known');
    });
});

describe('centralNote', () => {
    test('a central version names its file and, in the solution, the projects using it; overrides are named', () => {
        expect(centralNote({ id: 'Serilog', currentVersion: '3.1.1' }, all)).toBe(
            'Version set centrally in Directory.Packages.props, used by App, Web. A new version changes it for every project that uses it '
            + '(you are asked first); Set for This Project Only writes a VersionOverride instead. Override sets its own version (VersionOverride).');
    });

    test('a global package', () => {
        expect(centralNote({ id: 'SourceLink', currentVersion: '8.0.0' }, all)).toContain('Global package (GlobalPackageReference in Directory.Packages.props)');
        expect(isGlobal({ id: 'SourceLink', currentVersion: '8.0.0' }, all)).toBe(true);
        expect(isGlobal({ id: 'Serilog', currentVersion: '3.1.1' }, all)).toBe(false);
    });

    test('nothing without CPM; the project context does not claim to know the other projects', () => {
        expect(centralNote({ id: 'Polly', currentVersion: '8.0.0' }, all)).toBeUndefined();
        expect(centralNote({ id: 'Serilog', currentVersion: '3.1.1' }, [app] as any[])).toMatch(/^Version set centrally in Directory\.Packages\.props\. A new version/);
    });
});

describe('canSetForProjectOnly', () => {
    test('only when every selected project takes the version from a central entry (or overrides it)', () => {
        expect(canSetForProjectOnly({ id: 'Serilog', currentVersion: '3.1.1' }, all, new Set([app.path]))).toBe(true);
        expect(canSetForProjectOnly({ id: 'Serilog', currentVersion: '3.1.1' }, all, new Set([app.path, override.path]))).toBe(true);
        expect(canSetForProjectOnly({ id: 'Serilog', currentVersion: '3.1.1' }, all, new Set([app.path, legacy.path]))).toBe(false);
        expect(canSetForProjectOnly({ id: 'SourceLink', currentVersion: '8.0.0' }, all, new Set([app.path]))).toBe(false);
        expect(canSetForProjectOnly({ id: 'Polly', currentVersion: '8.0.0' }, all, new Set([legacy.path]))).toBe(false);
        expect(canSetForProjectOnly({ id: 'Serilog', currentVersion: '3.1.1' }, all, new Set())).toBe(false);
    });
});
```

`src/test/unit/webview/nuget-view/CentralPackages.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
// vscrui ships ES modules only: plain stand-ins for the controls these components use
jest.mock('vscrui', () => {
    const React = require('react');
    return {
        Checkbox: () => null,
        Dropdown: () => null,
        Button: (props: { onClick?: () => void; disabled?: boolean; children?: unknown }) =>
            React.createElement('button', { onClick: props.onClick, disabled: props.disabled }, props.children),
    };
});

import { PackageList } from '../../../../webview/nuget-view/components/PackageList';
import ProjectList from '../../../../webview/nuget-view/components/ProjectList';
import { PackageActions } from '../../../../webview/nuget-view/components/PackageActions';

const props = 'Directory.Packages.props';
const entry = (project: string, id: string, currentVersion: string, versionSource?: string) =>
    ({ id, currentVersion, versionSource, versionFile: versionSource === 'override' ? `${project}.csproj` : props, projectPath: `${project}.csproj`, projectName: project });
const projects = [
    { name: 'App', path: 'App.csproj', framework: 'net8.0', packages: [entry('App', 'Newtonsoft.Json', '13.0.1', 'central'), entry('App', 'Microsoft.SourceLink.GitHub', '8.0.0', 'global')] },
    { name: 'Override', path: 'Override.csproj', framework: 'net8.0', packages: [entry('Override', 'Newtonsoft.Json', '13.0.2', 'override'), entry('Override', 'Microsoft.SourceLink.GitHub', '8.0.0', 'global')] },
    { name: 'Legacy', path: 'Legacy.csproj', framework: 'net8.0', packages: [entry('Legacy', 'Polly', '', 'project')] },
] as any[];
const newtonsoft = { id: 'Newtonsoft.Json', currentVersion: '13.0.1', projects } as any;
const sourceLink = { id: 'Microsoft.SourceLink.GitHub', currentVersion: '8.0.0', versionSource: 'global', projects } as any;

describe('NuGet manager under Central Package Management', () => {
    test('the project list shows each project\'s version with its source, an unknown one as not known', () => {
        render(<ProjectList selectedPackage={newtonsoft} projects={projects} selectedProjects={new Set(['App.csproj'])} setSelectedProjects={jest.fn()} />);
        expect(screen.getByText('v13.0.1')).toBeTruthy();
        expect(screen.getByText('v13.0.2 (override)')).toBeTruthy();
        expect(screen.getByText('Not installed')).toBeTruthy();
    });

    test('global packages carry a "global" badge in the list; others do not', () => {
        render(<PackageList packages={[sourceLink, newtonsoft]} includePrerelease={false} emptyMessage="" selectedIndex={-1} selectedPackage={null}
            selectedItemRef={createRef<HTMLDivElement>()} onPackageSelect={jest.fn()} getPackageIconUrl={() => ''} title="Top-level packages" />);
        expect(screen.getAllByText('global')).toHaveLength(1);
        expect(screen.getByText('global').title).toBe('GlobalPackageReference: every project gets it');
        expect(screen.getByText('v13.0.2 (override)')).toBeTruthy();
    });

    test('"Set for This Project Only" shows when offered and sends the chosen version for the selected projects', () => {
        const setOnly = jest.fn();
        const actions = (onSetForProjectOnly?: jest.Mock) => (
            <PackageActions selectedPackage={newtonsoft} selectedVersion="13.0.3" selectedProjects={new Set(['App.csproj'])} initializing={false}
                onVersionChange={jest.fn()} onInstallUpdate={jest.fn()} onUninstall={jest.fn()} getVersionOptions={() => []} onSetForProjectOnly={onSetForProjectOnly} />
        );
        const { rerender } = render(actions());
        expect(screen.queryByText('Set for This Project Only')).toBeNull();
        rerender(actions(setOnly));
        fireEvent.click(screen.getByText('Set for This Project Only'));
        expect(setOnly).toHaveBeenCalledWith(newtonsoft, ['App.csproj'], '13.0.3');
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/test/unit/webview/nuget-view`
Expected: FAIL (`versionLabels` not found; the project list shows `v13.0.2` without `(override)`; no badge; no button)

- [ ] **Step 3: Implement `src/webview/nuget-view/versionLabels.ts`**

```ts
import { InstalledPackage, PackageVersionSource, ProjectInfo } from '../../services/nuget/types';
import { LocalNuGetPackage } from './shared';

/**
 * How the NuGet manager shows versions under Central Package Management. Browser-safe: types only, no Node modules
 * (the extension host works out the sources, see services/nuget/centralPackages.ts).
 */

interface Versioned {
    readonly currentVersion: string;
    readonly versionSource?: PackageVersionSource;
}

/** `v3.1.1`, `v13.0.2 (override)`, `v8.0.0 (global)`; an unknown version (no evaluation) is said to be unknown */
export function versionLabel(pkg: Versioned): string {
    if (!pkg.currentVersion) {
        return 'version not known';
    }
    const source = pkg.versionSource === 'override' || pkg.versionSource === 'global' ? ` (${pkg.versionSource})` : '';
    return `v${pkg.currentVersion}${source}`;
}

/** The package's entry in each project that has it */
function entries(pkg: LocalNuGetPackage, projects: readonly ProjectInfo[] | null | undefined): { project: ProjectInfo; entry: InstalledPackage }[] {
    return (projects ?? []).flatMap(project => {
        const entry = project.packages?.find(candidate => candidate.id.toLowerCase() === pkg.id.toLowerCase());
        return entry ? [{ project, entry }] : [];
    });
}

/** A GlobalPackageReference: every project gets it (the list shows a "global" badge) */
export function isGlobal(pkg: LocalNuGetPackage, projects?: readonly ProjectInfo[] | null): boolean {
    return pkg.versionSource === 'global' || entries(pkg, projects).some(({ entry }) => entry.versionSource === 'global');
}

const fileName = (file: string | undefined) => file?.split(/[\\/]/).pop() ?? 'Directory.Packages.props';

/**
 * The details pane's note on where the version comes from, or undefined without CPM. The solution context names the
 * projects that share a central version; the project context only knows its own project.
 */
export function centralNote(pkg: LocalNuGetPackage, projects: readonly ProjectInfo[] | null | undefined): string | undefined {
    const found = entries(pkg, projects);
    const global = found.find(({ entry }) => entry.versionSource === 'global');
    if (global) {
        return `Global package (GlobalPackageReference in ${fileName(global.entry.versionFile)}): every project gets it. Uninstall removes it for all projects or for the selected ones only.`;
    }
    const central = found.filter(({ entry }) => entry.versionSource === 'central');
    const overrides = found.filter(({ entry }) => entry.versionSource === 'override');
    if (central.length === 0 && overrides.length === 0) {
        return undefined;
    }
    const parts: string[] = [];
    if (central.length > 0) {
        const shared = found.length > 1 || (projects?.length ?? 0) > 1;
        parts.push(`Version set centrally in ${fileName(central[0].entry.versionFile)}${shared ? `, used by ${central.map(({ project }) => project.name).join(', ')}` : ''}.`
            + ' A new version changes it for every project that uses it (you are asked first); Set for This Project Only writes a VersionOverride instead.');
    }
    if (overrides.length > 0) {
        parts.push(`${overrides.map(({ project }) => project.name).join(', ')} ${overrides.length === 1 ? 'sets its' : 'set their'} own version (VersionOverride).`);
    }
    return parts.join(' ');
}

/** "Set for this project only" fits when every selected project takes the package's version from a central entry */
export function canSetForProjectOnly(pkg: LocalNuGetPackage, projects: readonly ProjectInfo[] | null | undefined, selected: ReadonlySet<string>): boolean {
    const found = entries(pkg, projects).filter(({ project }) => selected.has(project.path));
    return selected.size > 0 && found.length === selected.size
        && found.every(({ entry }) => entry.versionSource === 'central' || entry.versionSource === 'override');
}
```

- [ ] **Step 4: The components and the App**

Ids compare case-insensitively now in the lists (NuGet ids are case-insensitive; `dotnet list` and the project file can differ in case):
```diff
--- a/src/webview/nuget-view/shared.ts
+++ b/src/webview/nuget-view/shared.ts
@@ -1,4 +1,4 @@
-import { NuGetPackage, InstalledPackage } from "../../services/nuget/types";
+import { NuGetPackage, InstalledPackage, PackageVersionSource } from "../../services/nuget/types";
 import { logger } from "../shared/logger";
 import { BackendCmd } from "../../types/commands/backend";
 import { UICmd } from "../../types/commands/ui";
@@ -13,6 +13,10 @@
     projectName?: string;
     /** Transitive packages: the top-level packages that bring it in */
     transitiveReferencedBy?: string[];
+    /** Installed packages: where the version comes from (Central Package Management) */
+    versionSource?: PackageVersionSource;
+    /** Installed packages: the file the version is written in */
+    versionFile?: string;
     projects?: {
         name: string;
         path: string;
--- a/src/webview/nuget-view/components/ProjectList.tsx
+++ b/src/webview/nuget-view/components/ProjectList.tsx
@@ -3,6 +3,7 @@
 import { Checkbox } from "vscrui";
 import { logger } from "../../shared/logger";
 import { ProjectInfo as BackendProjectInfo } from "../../../services/nuget/types";
+import { versionLabel } from "../versionLabels";
 
 const log = logger('ProjectList');
 
@@ -99,8 +100,8 @@
                                 flexShrink: 0
                             }}>
                                 {(() => {
-                                    const installedPackage = project.packages?.find(pkg => pkg.id === selectedPackage.id);
-                                    return installedPackage ? `v${installedPackage.currentVersion}` : 'Not installed';
+                                    const installedPackage = project.packages?.find(pkg => pkg.id.toLowerCase() === selectedPackage.id.toLowerCase());
+                                    return installedPackage ? versionLabel(installedPackage) : 'Not installed';
                                 })()}
                             </div>
                         </div>
--- a/src/webview/nuget-view/components/PackageList.tsx
+++ b/src/webview/nuget-view/components/PackageList.tsx
@@ -3,6 +3,7 @@
 import { LocalNuGetPackage, ensureArray, formatAuthors } from '../shared';
 import { Checkbox } from 'vscrui';
 import { VersionUtils } from '../../../services/versionUtils';
+import { isGlobal, versionLabel } from '../versionLabels';
 
 
 
@@ -174,6 +175,21 @@
                                             }}>
                                                 {pkg.id}
                                             </span>
+                                            {isGlobal(pkg, pkg.projects) && (
+                                                <span
+                                                    title="GlobalPackageReference: every project gets it"
+                                                    style={{
+                                                        marginLeft: '6px',
+                                                        padding: '0 4px',
+                                                        borderRadius: '2px',
+                                                        fontSize: '10px',
+                                                        background: 'var(--vscode-badge-background)',
+                                                        color: 'var(--vscode-badge-foreground)'
+                                                    }}
+                                                >
+                                                    global
+                                                </span>
+                                            )}
                                             {!!pkg.authors?.length && (
                                                 <span style={{
                                                     fontWeight: 'normal',
@@ -241,15 +257,13 @@
                                     </div>
                                     {/* Max installed version - only show if different from current and package has projects */}
                                     {pkg.projects && pkg.projects.length > 0 && (() => {
-                                        // Find the highest installed version across all projects
-                                        const installedVersions = pkg.projects.map(p => {
-                                            const installedPkg = p.packages?.find(installedPkg => installedPkg.id === pkg.id);
-                                            return installedPkg?.currentVersion;
-                                        }).filter(Boolean);
-                                        if (installedVersions.length > 0) {
-                                            const maxInstalledVersion = installedVersions.sort((a, b) => {
-                                                return compare(a!, b!); // rcompare for descending order
-                                            })[0];
+                                        // The highest installed version across all projects, with its source (override, global)
+                                        const installed = pkg.projects
+                                            .map(p => p.packages?.find(installedPkg => installedPkg.id.toLowerCase() === pkg.id.toLowerCase()))
+                                            .filter((installedPkg): installedPkg is NonNullable<typeof installedPkg> => !!installedPkg);
+                                        if (installed.length > 0) {
+                                            const known = installed.filter(installedPkg => installedPkg.currentVersion);
+                                            const maxInstalled = known.sort((a, b) => compare(a.currentVersion, b.currentVersion))[0] ?? installed[0];
 
                                             // Always show the max installed version when package is installed
                                             return (
@@ -258,7 +272,7 @@
                                                     color: 'var(--vscode-descriptionForeground)',
                                                     marginTop: '1px'
                                                 }}>
-                                                    v{maxInstalledVersion}
+                                                    {versionLabel(maxInstalled)}
                                                 </div>
                                             );
                                         }
--- a/src/webview/nuget-view/components/PackageActions.tsx
+++ b/src/webview/nuget-view/components/PackageActions.tsx
@@ -19,6 +19,8 @@
     totalProjects?: number; // To determine if we should show "from selected projects" text
     /** False for transitive packages: only the package that brings them in can be removed */
     canUninstall?: boolean;
+    /** Central Package Management: a VersionOverride in the selected projects instead of a new central version */
+    onSetForProjectOnly?: (packageData: LocalNuGetPackage, projects: string[], version: string) => void;
 }
 
 export const PackageActions: React.FC<PackageActionsProps> = ({
@@ -33,7 +35,8 @@
     getVersionOptions,
     installButtonText = "Install",
     totalProjects = 1,
-    canUninstall = true
+    canUninstall = true,
+    onSetForProjectOnly
 }) => {
     return (
         <div style={{
@@ -88,6 +91,27 @@
                 </Button>
             </div>
 
+            {/* Central Package Management: the version for the selected projects only (VersionOverride) */}
+            {onSetForProjectOnly && <div style={{
+                display: 'flex',
+                justifyContent: 'flex-end',
+                alignItems: 'center',
+                gap: '8px',
+            }}>
+                <Button
+                    style={{ justifyContent: 'center' }}
+                    appearance="secondary"
+                    disabled={selectedProjects.size === 0 || initializing || loading}
+                    onClick={() => {
+                        if (!initializing && !loading) {
+                            onSetForProjectOnly(selectedPackage, Array.from(selectedProjects), selectedVersion || selectedPackage.currentVersion);
+                        }
+                    }}
+                >
+                    {selectedProjects.size > 1 ? 'Set for Selected Projects Only' : 'Set for This Project Only'}
+                </Button>
+            </div>}
+
             {/* Uninstall Section */}
             {canUninstall && <div style={{
                 display: 'flex',
--- a/src/webview/nuget-view/App.tsx
+++ b/src/webview/nuget-view/App.tsx
@@ -11,6 +11,7 @@
 import { ProjectInfo } from '../../services/nuget/types';
 import { VersionUtils } from '../../services/versionUtils';
 import { NuGetViewData, UICmd } from '../../types/commands/ui';
+import { canSetForProjectOnly, centralNote } from './versionLabels';
 
 const log = logger('NuGetReact');
 
@@ -318,6 +319,21 @@
         });
     };
 
+    // Central Package Management: a VersionOverride in the selected projects instead of a new central version
+    const handleSetForProjectOnly = (pkg: LocalNuGetPackage, projects: string[], version: string) => {
+        setLoading(true);
+        sendToBackend({
+            type: 'installPackage',
+            payload: {
+                package: pkg,
+                projects,
+                version,
+                includePrerelease,
+                versionScope: 'project'
+            }
+        });
+    };
+
     const handleUninstallPackage = (pkg: LocalNuGetPackage, projects: string[]) => {
         setLoading(true);
         sendToBackend({
@@ -862,6 +878,11 @@
                                     Install it to reference it directly, e.g. to use a newer version.
                                 </div>
                             )}
+                            {centralNote(selectedPackage, data.projects) && (
+                                <div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginBottom: '12px' }}>
+                                    {centralNote(selectedPackage, data.projects)}
+                                </div>
+                            )}
                             <ProjectList
                                 selectedPackage={selectedPackage}
                                 projects={data.projects || []}
@@ -881,6 +902,7 @@
                                 onUninstall={handleUninstallPackage}
                                 getVersionOptions={getVersionOptions}
                                 canUninstall={!selectedPackage.transitiveReferencedBy}
+                                onSetForProjectOnly={canSetForProjectOnly(selectedPackage, data.projects, selectedProjects) ? handleSetForProjectOnly : undefined}
                             />
                             <NugetDetails
                                 selectedPackage={selectedPackage}
@@ -1011,6 +1033,11 @@
                     {selectedPackage ? (
                         <div>
                             <NugetHeader selectedPackage={selectedPackage} />
+                            {centralNote(selectedPackage, data.projects) && (
+                                <div style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground)', marginBottom: '12px' }}>
+                                    {centralNote(selectedPackage, data.projects)}
+                                </div>
+                            )}
                             <ProjectList
                                 selectedPackage={selectedPackage}
                                 projects={data.projects || []}
@@ -1031,6 +1058,7 @@
                                 onUninstall={handleUninstallPackage}
                                 getVersionOptions={getVersionOptions}
                                 installButtonText="Install"
+                                onSetForProjectOnly={canSetForProjectOnly(selectedPackage, data.projects, selectedProjects) ? handleSetForProjectOnly : undefined}
                             />
 
                             {selectedProjects.size === 0 && (
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest src/test/unit/webview src/test/unit/build`
Expected: PASS (the bundle test builds the webview: `versionLabels.ts` pulls no Node module in)

- [ ] **Step 6: GIF scene**

Add `gif-central-packages` to the end of the default `SCENES` list in `scripts/screenshots/capture.sh` and this scene after `gif-show-all-files` (before `echo "Done: $OUT"`). It turns the work copy into a CPM solution (the sample's versions in `Directory.Packages.props`, an override in Shop.Core.NUnitTests: the sample has Microsoft.NET.Test.Sdk 17.14.1 and 17.14.0, and a global package), records the tree, the solution's Installed tab and a Consolidate with its confirmation, then puts the sample back. The click positions come from `docs/images/nuget.png` (screen y = image y + 35: the tabs at y 88, the filter at y 126, the Select all checkbox at y 156); check them on a first run with `KEEP=1` and a `shot central-packages-check` after the Consolidate click, and adjust:
```bash
if wants gif-central-packages; then
    echo "Scene: gif-central-packages"
    # The work copy moves to Central Package Management: the versions into Directory.Packages.props (an override in
    # Shop.Core.NUnitTests, a global package), the Version attributes out of the projects. Put back and restored
    # afterwards: the other scenes don't know it
    find "$SOLUTION/src" "$SOLUTION/tests" -name '*.csproj' -exec cp {} {}.orig \;
    cat > "$SOLUTION/Directory.Packages.props" <<'XML'
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="coverlet.collector" Version="6.0.4" />
    <PackageVersion Include="Microsoft.CodeAnalysis.CSharp" Version="4.14.0" />
    <PackageVersion Include="Microsoft.EntityFrameworkCore.Sqlite" Version="10.0.13" />
    <PackageVersion Include="Microsoft.Extensions.Hosting" Version="10.0.11" />
    <PackageVersion Include="Microsoft.NET.Test.Sdk" Version="17.14.1" />
    <PackageVersion Include="NUnit" Version="4.3.2" />
    <PackageVersion Include="NUnit.Analyzers" Version="4.7.0" />
    <PackageVersion Include="NUnit3TestAdapter" Version="5.0.0" />
    <PackageVersion Include="Riok.Mapperly" Version="4.3.1" />
    <PackageVersion Include="xunit" Version="2.9.3" />
    <PackageVersion Include="xunit.runner.visualstudio" Version="3.1.4" />
    <PackageVersion Include="xunit.v3" Version="3.2.2" />
  </ItemGroup>
  <ItemGroup>
    <GlobalPackageReference Include="Microsoft.SourceLink.GitHub" Version="8.0.0" />
  </ItemGroup>
</Project>
XML
    find "$SOLUTION/src" "$SOLUTION/tests" -name '*.csproj' -exec sed -i -E '/<PackageReference /s/ Version="[^"]*"//' {} \;
    sed -i 's|<PackageReference Include="Microsoft.NET.Test.Sdk"|& VersionOverride="17.14.0"|' "$SOLUTION/tests/Shop.Core.NUnitTests/Shop.Core.NUnitTests.csproj"
    (cd "$SOLUTION" && dotnet restore Contoso.slnx -v q -nologo >/dev/null)
    # The props watcher re-evaluates the projects
    sleep 8
    reset
    tree_focus
    record_start
    # Dependencies > Packages: the override and the global package
    tree_open Contoso tests Shop.Core.NUnitTests Dependencies Packages
    pause 2
    command "Open NuGet Package Manager for Solution" 15
    # Installed: filtering selects Microsoft.NET.Test.Sdk; its details name Directory.Packages.props and the override
    click 1000 126; type_text "Test.Sdk"; pause 3
    # Consolidate (the fourth tab), Select all, the Consolidate button; Return takes the confirmation's Consolidate
    click 775 88; pause 4
    click 650 156; pause 1
    click 1515 126; pause 2
    key Return; pause 15
    record_stop central-packages
    rm -f "$SOLUTION/Directory.Packages.props"
    find "$SOLUTION/src" "$SOLUTION/tests" -name '*.csproj.orig' -exec sh -c 'mv "$1" "${1%.orig}"' _ {} \;
    (cd "$SOLUTION" && dotnet restore Contoso.slnx -v q -nologo >/dev/null)
    sleep 5
    command "View: Close All Editors" 1
fi
```
Run it: `SCENES=gif-central-packages scripts/screenshots/capture.sh` (needs Xvfb, xdotool, ffmpeg, network for the restore). If this environment cannot record, say so plainly in the report so the user can record it, leave the scene committed, and add to `docs/roadmap.md` Known bugs: `- [ ] The Central Package Management GIF is not recorded: run the scene gif-central-packages of scripts/screenshots/capture.sh (docs/nuget.md has a placeholder)`; in that case put `<!-- GIF: central-packages.gif (record with scripts/screenshots/capture.sh, scene gif-central-packages) -->` in `docs/nuget.md` instead of the image (as `docs/solution-explorer.md` does for drag & drop).

- [ ] **Step 7: Docs**

`docs/nuget.md`, in the "Central Package Management" section, after the table of what is shown:
```markdown
![Central Package Management: an override, a global package and Consolidate](images/central-packages.gif)

Packages from a `GlobalPackageReference` carry a **global** badge in the lists. The details pane says where the selected package's version is set: the props file, and in the solution's manager which projects use that central version and which override it. **Set for This Project Only** (next to Install, when the selected projects take the version from `Directory.Packages.props`) writes a `VersionOverride` with the chosen version instead of changing the central one.
```

`docs/manual-testing.md`, append unticked:
```markdown
- [ ] Central Package Management in the NuGet webview (copy of `src/__fixtures__/central-packages/cpm`, restored): Installed shows the `global` badge on Microsoft.SourceLink.GitHub (project and solution manager); the project list shows `v13.0.1` for App and `v13.0.2 (override)` for Override; the details note names `Directory.Packages.props`, in the solution manager with "used by App" and "Override sets its own version"; Set for This Project Only appears for Serilog on App, not for the global package nor for Polly on Legacy, and writes a `VersionOverride` without a confirmation; a project the SDK cannot evaluate shows "version not known" and nothing in Updates; the GIF `docs/images/central-packages.gif` matches what the extension shows
```

- [ ] **Step 8: Verify and commit**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git add src/webview/nuget-view/versionLabels.ts src/webview/nuget-view/shared.ts src/webview/nuget-view/components/ProjectList.tsx src/webview/nuget-view/components/PackageList.tsx src/webview/nuget-view/components/PackageActions.tsx src/webview/nuget-view/App.tsx src/test/unit/webview/nuget-view/versionLabels.test.ts src/test/unit/webview/nuget-view/CentralPackages.test.tsx scripts/screenshots/capture.sh docs/nuget.md docs/manual-testing.md
git add docs/images/central-packages.gif 2>/dev/null || git add docs/roadmap.md
git commit -m "NuGet manager: override and global labels, where a version comes from, Set for This Project Only

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: exit 0.

---

### Task 8: Watching `Directory.Packages.props` and the files it imports

**Files:**
- Create: `src/services/nuget/centralPackageWatch.ts` (pure: stamps, which files need which watching), `src/services/nuget/centralPackageWatchers.ts` (the VS Code watchers)
- Modify: `src/extension.ts`, `src/webview/providers/NuGetCustomEditorProvider.ts`
- Test: `src/test/unit/services/nuget/centralPackageWatch.test.ts`
- Docs: `docs/nuget.md`, `docs/manual-testing.md`

Today nothing watches `Directory.Packages.props`. The props watcher of `extension.ts` (`Directory.Build.{props,targets}`, which re-evaluates every project) also takes `Directory.Packages.props`; props files it imports under another name get a watcher each from `CentralPackageWatchers`, re-registered after every evaluation (the set comes from `centralFiles`); props files outside the workspace folders cannot be watched and are compared by `mtime|size` when a NuGet editor comes to the front. The open NuGet editors refresh (debounced) when an evaluation brings new package versions (`packagesVersion`), and the tree follows through `Project.evaluateItems` (Task 3).

- [ ] **Step 1: Write the failing tests**

`src/test/unit/services/nuget/centralPackageWatch.test.ts`:
```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const watcher = () => ({ onDidChange: jest.fn(), onDidCreate: jest.fn(), onDidDelete: jest.fn(), dispose: jest.fn() });
const env = { roots: [] as string[], projects: [] as { projectPath: string }[] };
jest.mock('vscode', () => ({
    workspace: {
        createFileSystemWatcher: jest.fn(() => watcher()),
        get workspaceFolders() { return env.roots.map(fsPath => ({ uri: { fsPath } })); },
    },
    RelativePattern: class { constructor(public base: string, public pattern: string) { } },
}), { virtual: true });
jest.mock('../../../../services/solutionService', () => ({
    SolutionService: { getActiveSolution: () => ({ projects: new Map(env.projects.map(project => [project.projectPath, project])) }) },
}));

import * as vscode from 'vscode';
import { changedFiles, Stamp, watchPlan } from '../../../../services/nuget/centralPackageWatch';
import { CentralPackageWatchers } from '../../../../services/nuget/centralPackageWatchers';
import { ProjectItemsService } from '../../../../services/projectItems/projectItemsService';
import { parseMsbuildPackages } from '../../../../services/nuget/centralPackages';

describe('watchPlan', () => {
    const root = path.resolve('/work/repo');
    test('imported props files inside the workspace get a watcher; Directory.Packages.props has one already; outside ones are re-checked', () => {
        const files = [
            path.join(root, 'Directory.Packages.props'),
            path.join(root, 'build', 'Versions.props'),
            path.join(root, 'build', 'Versions.props'),
            path.resolve('/shared/Company.Packages.props'),
        ];
        expect(watchPlan(files, [root])).toEqual({
            watch: [path.join(root, 'build', 'Versions.props')],
            outside: [path.resolve('/shared/Company.Packages.props')],
        });
    });
});

describe('changedFiles', () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-watch-')); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    test('a file seen the first time is no change; an edit and a deletion are', () => {
        const file = path.join(dir, 'Company.Packages.props');
        fs.writeFileSync(file, '<Project />');
        const stamps = new Map<string, Stamp>();
        expect(changedFiles([file], stamps)).toEqual([]);
        expect(changedFiles([file], stamps)).toEqual([]);
        fs.writeFileSync(file, '<Project>\n</Project>\n');
        expect(changedFiles([file], stamps)).toEqual([file]);
        fs.rmSync(file);
        expect(changedFiles([file], stamps)).toEqual([file]);
    });
});

describe('CentralPackageWatchers', () => {
    let dir: string;
    let outside: string;
    let listener: () => void;
    let packages: Map<string, ReturnType<typeof parseMsbuildPackages>>;

    beforeEach(() => {
        dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-watchers-')));
        outside = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'cpm-outside-')));
        env.roots = [dir];
        env.projects = [{ projectPath: path.join(dir, 'App', 'App.csproj') }];
        packages = new Map();
        jest.spyOn(ProjectItemsService.instance, 'onDidEvaluate').mockImplementation(callback => { listener = () => callback(''); return { dispose: jest.fn() }; });
        jest.spyOn(ProjectItemsService.instance, 'packages').mockImplementation(projectPath => packages.get(projectPath));
        (vscode.workspace.createFileSystemWatcher as jest.Mock).mockClear();
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
        jest.restoreAllMocks();
    });

    const evaluated = (...files: string[]) => {
        packages.set(env.projects[0].projectPath, parseMsbuildPackages(JSON.stringify({
            Properties: { ManagePackageVersionsCentrally: 'true', DirectoryPackagesPropsPath: path.join(dir, 'Directory.Packages.props') },
            Items: { PackageVersion: files.map((file, index) => ({ Identity: `P${index}`, Version: '1.0.0', DefiningProjectFullPath: file })) },
        }), env.projects[0].projectPath));
        listener();
    };

    test('an imported props file gets a watcher, which goes when no project uses the file any more', () => {
        const watchers = new CentralPackageWatchers(jest.fn());
        evaluated(path.join(dir, 'Directory.Packages.props'), path.join(dir, 'build', 'Versions.props'));
        const created = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results;
        expect(created).toHaveLength(1);
        expect((vscode.workspace.createFileSystemWatcher as jest.Mock).mock.calls[0][0]).toEqual({ base: path.join(dir, 'build'), pattern: 'Versions.props' });
        evaluated(path.join(dir, 'Directory.Packages.props'));
        expect(created[0].value.dispose).toHaveBeenCalled();
        watchers.dispose();
    });

    test('a props file outside the workspace: recheck evaluates again only after it changed', async () => {
        const file = path.join(outside, 'Company.Packages.props');
        fs.writeFileSync(file, '<Project />');
        const reevaluate = jest.fn().mockResolvedValue(undefined);
        const watchers = new CentralPackageWatchers(reevaluate);
        evaluated(file);
        await watchers.recheck();
        expect(reevaluate).not.toHaveBeenCalled();
        fs.writeFileSync(file, '<Project>\n  <ItemGroup />\n</Project>\n');
        await watchers.recheck();
        expect(reevaluate).toHaveBeenCalledTimes(1);
        watchers.dispose();
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/test/unit/services/nuget/centralPackageWatch.test.ts`
Expected: FAIL (modules not found)

- [ ] **Step 3: Implement `src/services/nuget/centralPackageWatch.ts`**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { pathKey } from '../projectItems/projectItems';

/** `mtime|size` of a file; undefined when it does not exist */
export type Stamp = string | undefined;

export function stampOf(file: string): Stamp {
    try {
        const stat = fs.statSync(file);
        return `${stat.mtimeMs}|${stat.size}`;
    } catch {
        return undefined;
    }
}

/** The files whose stamp differs from the remembered one (a file seen for the first time is not a change); remembers the new stamps */
export function changedFiles(files: readonly string[], stamps: Map<string, Stamp>): string[] {
    const changed: string[] = [];
    for (const file of files) {
        const stamp = stampOf(file);
        if (stamps.has(file) && stamps.get(file) !== stamp) {
            changed.push(file);
        }
        stamps.set(file, stamp);
    }
    return changed;
}

/** What the extension's `**\/Directory.{Build.props,Build.targets,Packages.props}` watcher already covers */
const COVERED = /^Directory\.(Packages\.props|Build\.props|Build\.targets)$/i;

const isInside = (file: string, root: string) => {
    const relative = path.relative(root, file);
    return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/**
 * Splits the props files the central versions come from: `watch` needs a watcher of its own (an imported file with
 * another name inside the workspace), `outside` cannot be watched (outside every workspace folder) and is re-checked
 * when the NuGet editor gets focus
 */
export function watchPlan(files: readonly string[], workspaceRoots: readonly string[]): { watch: string[]; outside: string[] } {
    const unique = [...new Map(files.map(file => [pathKey(path.normalize(file)), path.normalize(file)])).values()];
    const inside = (file: string) => workspaceRoots.some(root => isInside(file, root));
    return {
        watch: unique.filter(file => inside(file) && !COVERED.test(path.basename(file))),
        outside: unique.filter(file => !inside(file)),
    };
}
```

- [ ] **Step 4: Implement `src/services/nuget/centralPackageWatchers.ts`**

```ts
import * as vscode from 'vscode';
import * as path from 'path';
import { SolutionService } from '../solutionService';
import { ProjectItemsService } from '../projectItems/projectItemsService';
import { centralFiles } from './centralPackages';
import { Stamp, changedFiles, watchPlan } from './centralPackageWatch';

/**
 * Watches the props files the solution's central package versions come from, beyond `Directory.Packages.props`
 * (which the extension's props watcher covers): files it imports get a watcher each, re-registered whenever an
 * evaluation changes the set. Files outside the workspace cannot be watched; `recheck` compares their stamps (the
 * NuGet editor calls it when it gets focus).
 */
export class CentralPackageWatchers implements vscode.Disposable {
    private readonly watchers = new Map<string, vscode.FileSystemWatcher>();
    private readonly stamps = new Map<string, Stamp>();
    private readonly subscription: { dispose(): void };

    /** @param reevaluate evaluates every project of the solution again (what a props change needs) */
    constructor(private readonly reevaluate: () => Promise<void>) {
        this.subscription = ProjectItemsService.instance.onDidEvaluate(() => this.update());
    }

    private plan() {
        const projects = [...(SolutionService.getActiveSolution()?.projects.values() ?? [])];
        const files = projects.flatMap(project => {
            const packages = ProjectItemsService.instance.packages(project.projectPath);
            return packages ? centralFiles(packages) : [];
        });
        return watchPlan(files, (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath));
    }

    private update(): void {
        const { watch, outside } = this.plan();
        for (const [file, watcher] of [...this.watchers]) {
            if (!watch.includes(file)) {
                watcher.dispose();
                this.watchers.delete(file);
            }
        }
        for (const file of watch.filter(candidate => !this.watchers.has(candidate))) {
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path.dirname(file), path.basename(file)));
            const changed = () => { void this.reevaluate(); };
            watcher.onDidChange(changed);
            watcher.onDidCreate(changed);
            watcher.onDidDelete(changed);
            this.watchers.set(file, watcher);
        }
        // Remember the stamps of files outside the workspace, so the first focus has something to compare with
        changedFiles(outside.filter(file => !this.stamps.has(file)), this.stamps);
    }

    /** Props files outside the workspace: evaluates again when one changed since the last look */
    async recheck(): Promise<void> {
        if (changedFiles(this.plan().outside, this.stamps).length > 0) {
            await this.reevaluate();
        }
    }

    dispose(): void {
        this.subscription.dispose();
        for (const watcher of this.watchers.values()) {
            watcher.dispose();
        }
        this.watchers.clear();
    }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest src/test/unit/services/nuget/centralPackageWatch.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Wire it up**

`src/extension.ts`: one `reevaluateAllProjects` for the props watcher and the new watchers, `Directory.Packages.props` in the props watcher's glob, the watchers created before the NuGet provider, which gets their `recheck`:
```diff
--- a/src/extension.ts
+++ b/src/extension.ts
@@ -9,6 +9,7 @@
 import { ErrorListViewProvider, ERROR_LIST_VIEW } from './webview/providers/ErrorListViewProvider';
 import { registerNativeContextMenuCommands } from './webview/providers/nativeContextMenu';
 import { NuGetCustomEditorProvider } from './webview/providers/NuGetCustomEditorProvider';
+import { CentralPackageWatchers } from './services/nuget/centralPackageWatchers';
 import { isExcluded } from './core/constants';
 import { logger as loggerFn, setLogSink } from './core/logger';
 import { checkCSharpExtension } from './services/csharpExtensionCheck';
@@ -133,10 +134,20 @@
         iconThemeService
     );
 
+    // Props files change what projects contain and their package versions: every project is evaluated again
+    const reevaluateAllProjects = async () => {
+        const solution = SolutionService.getActiveSolution();
+        await Promise.all([...(solution?.projects.values() ?? [])].map(project => project.reevaluateItems()));
+    };
+    // Files Directory.Packages.props imports (and props outside the workspace, re-checked when the NuGet editor gets focus)
+    const centralPackageWatchers = new CentralPackageWatchers(reevaluateAllProjects);
+    context.subscriptions.push(centralPackageWatchers);
+
     // Create NuGet custom editor provider
     const nugetCustomEditorProvider = new NuGetCustomEditorProvider(
         context.extensionUri,
-        context
+        context,
+        () => centralPackageWatchers.recheck()
     );
 
     // Register webview providers for both sidebar and secondary-sidebar locations
@@ -333,14 +344,13 @@
     launchSettingsWatcher.onDidChange(handleLaunchSettingsChange);
     launchSettingsWatcher.onDidDelete(handleLaunchSettingsChange);
 
-    // Directory.Build.props/targets change what every project below contains
-    const buildPropsWatcher = vscode.workspace.createFileSystemWatcher('**/Directory.Build.{props,targets}');
+    // Directory.Build.props/targets change what every project below contains, Directory.Packages.props its package versions
+    const buildPropsWatcher = vscode.workspace.createFileSystemWatcher('**/Directory.{Build.props,Build.targets,Packages.props}');
     const handleBuildPropsChange = async (uri: vscode.Uri) => {
         if (isExcluded(uri.fsPath, rootOf(uri.fsPath))) {
             return;
         }
-        const solution = SolutionService.getActiveSolution();
-        await Promise.all([...(solution?.projects.values() ?? [])].map(project => project.reevaluateItems()));
+        await reevaluateAllProjects();
     };
     buildPropsWatcher.onDidCreate(handleBuildPropsChange);
     buildPropsWatcher.onDidChange(handleBuildPropsChange);
```

`src/webview/providers/NuGetCustomEditorProvider.ts`: the panels remember their context and the last "Include prerelease" choice, refresh after evaluations with new package versions, and call `_onFocus` when they come to the front:
```diff
--- a/src/webview/providers/NuGetCustomEditorProvider.ts
+++ b/src/webview/providers/NuGetCustomEditorProvider.ts
@@ -11,6 +11,7 @@
 import { NuGetViewData } from '../../types/commands/ui';
 import { VersionUtils } from '../../services/versionUtils';
 import { solutionWorkspaceFolder } from '../../services/workspaceFolders';
+import { ProjectItemsService } from '../../services/projectItems/projectItemsService';
 
 const log = logger('NuGetCustomEditorProvider');
 
@@ -19,12 +20,39 @@
  */
 export class NuGetCustomEditorProvider implements vscode.CustomTextEditorProvider {
     public static readonly viewType = 'shinobi.nugetPackageManager';
-    private readonly _webviewPanels = new Map<string, vscode.WebviewPanel>();
+    private readonly _webviewPanels = new Map<string, { panel: vscode.WebviewPanel; context: { type: 'project' | 'solution', target: string }; includePrerelease: boolean }>();
+    // The packages version of each project last seen: a new one (Directory.Packages.props changed) refreshes the open editors
+    private readonly _packageVersions = new Map<string, number>();
+    private _refreshTimer?: ReturnType<typeof setTimeout>;
 
+    /** @param _onFocus re-checks props files no watcher sees (outside the workspace) when an editor gets focus */
     constructor(
         private readonly _extensionUri: vscode.Uri,
-        private readonly _extensionContext: vscode.ExtensionContext
+        private readonly _extensionContext: vscode.ExtensionContext,
+        private readonly _onFocus: () => Promise<void> = async () => { }
     ) {
+        ProjectItemsService.instance.onDidEvaluate(projectPath => this._packagesEvaluated(projectPath));
+    }
+
+    /** New package versions of a project: the open editors show them (once per burst of evaluations) */
+    private _packagesEvaluated(projectPath: string): void {
+        const version = ProjectItemsService.instance.packagesVersion(projectPath);
+        if (this._packageVersions.get(projectPath) === version) {
+            return;
+        }
+        this._packageVersions.set(projectPath, version);
+        if (this._webviewPanels.size === 0) {
+            return;
+        }
+        if (this._refreshTimer) {
+            clearTimeout(this._refreshTimer);
+        }
+        this._refreshTimer = setTimeout(() => {
+            this._refreshTimer = undefined;
+            for (const { panel, context, includePrerelease } of this._webviewPanels.values()) {
+                void this._updateWebview(panel.webview, context, includePrerelease);
+            }
+        }, 500);
     }
 
     /**
@@ -38,14 +66,22 @@
         // Parse context and target from the document URI
         const context = this._getContextFromUri(document.uri);
 
-        // Store the webview panel for message handling
-        this._webviewPanels.set(document.uri.toString(), webviewPanel);
+        // Store the webview panel for message handling and refreshes
+        const entry = { panel: webviewPanel, context, includePrerelease: Settings.nugetIncludePrerelease() };
+        this._webviewPanels.set(document.uri.toString(), entry);
 
         // Clean up on dispose
         webviewPanel.onDidDispose(() => {
             this._webviewPanels.delete(document.uri.toString());
         });
 
+        // Props files outside the workspace have no watcher: look at them when the editor comes to the front
+        webviewPanel.onDidChangeViewState(event => {
+            if (event.webviewPanel.active) {
+                void this._onFocus();
+            }
+        });
+
         // Setup initial content for the webview
         webviewPanel.webview.options = {
             enableScripts: true,
@@ -59,7 +95,12 @@
 
         // Handle messages from the webview
         webviewPanel.webview.onDidReceiveMessage(
-            message => this._handleMessage(message, context, webviewPanel.webview),
+            message => {
+                if (message.type === 'getNuGetData') {
+                    entry.includePrerelease = message.payload.includePrerelease;
+                }
+                return this._handleMessage(message, context, webviewPanel.webview);
+            },
             undefined,
             []
         );
```

- [ ] **Step 7: Docs**

`docs/nuget.md`, append to the "Central Package Management" section:
```markdown
Edits to `Directory.Packages.props`, or to a props file it imports, made by hand or by `git checkout`, show in the tree and in open NuGet managers after a moment (the projects are evaluated again). A props file outside the opened folder is checked when you switch to the NuGet manager.
```

`docs/manual-testing.md`, append unticked:
```markdown
- [ ] Central Package Management, watching (copy of `src/__fixtures__/central-packages/cpm`): change Serilog's version in `Directory.Packages.props` by hand and save: App's Dependencies > Packages and an open NuGet manager show the new version without reopening; the same for Polly in the imported `Packages.Extra.props`; with the `Import` pointing to a props file outside the opened folder, editing that file shows up when the NuGet manager tab is clicked
```

- [ ] **Step 8: Verify and commit**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git add src/services/nuget/centralPackageWatch.ts src/services/nuget/centralPackageWatchers.ts src/extension.ts src/webview/providers/NuGetCustomEditorProvider.ts src/test/unit/services/nuget/centralPackageWatch.test.ts docs/nuget.md docs/manual-testing.md
git commit -m "Central packages: watch Directory.Packages.props and its imports, refresh the tree and NuGet editors

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: exit 0.

---

### Task 9: Roadmap, history, README, limitations; final verification and push

**Files:**
- Modify: `docs/roadmap.md`, `docs/history.md`, `README.md`, `docs/nuget.md` (check only)

- [ ] **Step 1: Roadmap and history**

Phase 20 has only this item, so the phase is done: move it from `docs/roadmap.md` to the end of `docs/history.md` (after Phase 19), ticked and with what was built, in the style of the Phase 19 entries:
```markdown
## Phase 20: NuGet, Part 2
**Goal**: The NuGet manager, the Dependencies tree and the Updates/Consolidate tabs work with Central Package Management.

- [x] Central Package Management (`Directory.Packages.props`): the project evaluation that already runs per project (`ProjectItemsService`) also reads `PackageReference`, `PackageVersion`, `GlobalPackageReference` and the CPM properties, so the tree and the NuGet manager show the version MSBuild uses and where it comes from (`override`, `global`); unknown versions are never offered as updates. Install, update, bulk update and uninstall edit `Directory.Packages.props` (or the props file it imports that defines the entry) and the project files as text edits that keep the formatting; a change that reaches projects that were not selected is confirmed first, with Set for This Project Only (`VersionOverride`) as the alternative; global packages are updated, removed for all projects or opted out per project (`GlobalPackageReference Remove`); a `PackageVersion` left unused is removed only when the user says so; Consolidate sets the central version and removes the overrides. `Directory.Packages.props` and its imports are watched (props files outside the workspace are checked when the NuGet manager gets focus); projects without CPM keep using the `dotnet` CLI
```
In `docs/roadmap.md`: remove the "## Phase 20: NuGet, Part 2" section; the intro becomes "Phases 1–20 are done (see [History](history.md)): web apps, SOAP clients, templates, tests, private feeds, the Visual Studio basics, publishing, readiness for others, solutions, projects and configurations, code cleanup and refactoring, and the second rounds for run & debug, for the Solution Explorer and for NuGet. Phase 21 is the second round for connected services, phase 22 quality and documentation, phase 30 what may come later, phase 31 the other publish targets." Under "Known limitations" add:
```markdown
- [ ] Central Package Management: an imported props file that defines no `PackageVersion` or `GlobalPackageReference` yet is not watched until it has one (the watched files come from what MSBuild reports as defining the entries)
- [ ] Central Package Management: props files outside the opened folder are only re-checked when the NuGet manager gets focus; the tree shows their changes after that, or after a project file changes
- [ ] Central Package Management: the Updates tab does not offer updates of pinned transitive packages (`CentralPackageTransitivePinningEnabled`); update them in `Directory.Packages.props`
- [ ] Central Package Management: a `PackageReference` that comes from a props file (not from the project file) cannot be uninstalled from the NuGet manager (`dotnet remove package` reports that the project has no such reference); edit the props file
```

- [ ] **Step 2: README**

`README.md` (the store page), the NuGet Package Manager paragraph becomes:
```markdown
Browse, Installed (with transitive packages), Updates and Consolidate, per project or for the whole solution, also with Central Package Management (`Directory.Packages.props`, overrides and global packages). Private feeds work; when a token expires, it says which feed and where its credentials are, and takes a new one.
```
Nothing else: the README stays a store page (no phases, no limitations). `CHANGELOG.md` is not touched (the recent phases did not add to it either).

- [ ] **Step 3: Read the CPM docs once more**

Read `docs/nuget.md` "Central Package Management" from top to bottom: Tasks 3, 5, 6, 7 and 8 each added a part; check the order (what is shown, the GIF and the badge, what each action changes, Consolidate, watching) and that no sentence says something Task 3–8 did not build. `docs/solution-explorer.md` links to `nuget.md#central-package-management`: check the anchor exists.

- [ ] **Step 4: Final verification and push**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git status --short
git add docs/roadmap.md docs/history.md README.md docs/nuget.md
git commit -m "Phase 20: Central Package Management done

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push origin master
```
Expected: exit 0; `git status --short` shows nothing of this work (other agents' untracked files may remain). After the push check that the GitHub pipeline is green (Windows included): `gh run list --limit 1`, then `gh run watch` if it is still running. Windows watch-outs: the tests build paths with `path.join`/`path.resolve`; `parseMsbuildPackages` normalises `DefiningProjectFullPath`; `planVersionChange`/`planUninstall` compare files after `path.normalize`; the real-MSBuild tests are skipped where `dotnet` is missing.

---

## Self-review (done while writing)

- **Spec coverage:** "What is broken today": "Unknown" in Installed and the tree, ignored overrides, missing globals (Tasks 2–3); every CPM package outdated, with the regression test (Task 3); `dotnet add package` rewriting the shared version and failing on imported props (Tasks 4–5: no version edit goes through the CLI any more); global uninstall (Tasks 4–5); Consolidate never offering anything (Tasks 3, 6); nothing watching `Directory.Packages.props` (Task 8). Behaviour: the version-change rule with the confirmation and Set for this project only (Tasks 4, 5, 7), globals shown, labelled, updated, removed and opted out (Tasks 2–5, 7), the extension editing the props files itself with formatting kept (Tasks 1, 4), uninstall asking before removing an unused `PackageVersion` (Tasks 4–5), Consolidate under CPM and mixed solutions (Task 6), left out: pinned transitive packages (Known limitations, Task 9). Design: the service (Task 2, as an extension of `ProjectItemsService`, see Deviations), the edits named in the spec (Task 1: `setPackageVersion`, `addPackageVersion`, `removePackageVersion`, `setGlobalPackageVersion`, `removeGlobalPackageReference`, `setVersionOverride`, `removeVersionOverride`, `addPackageReference`, `addGlobalOptOut`, `removeGlobalOptOut`), the MSBuild failure fallback (unknown versions shown as not known, never outdated: Tasks 3, 7), the project context keeping `dotnet list` marked from the evaluation (Task 3), watching with the focus re-check (Task 8), messages (Task 5: `versionScope`; the confirmation data stays in the host, see Deviations). Testing: fixtures with every case the spec lists (Task 2), pure edit tests incl. CRLF, comments and the defining file (Tasks 1, 4), runner-injected service tests and real-MSBuild tests for sources, opt-out and edits before/after (Tasks 2, 4), webview tests for labels, override marker and the button (Task 7; the confirmation is a host modal, tested in Task 5). Docs: `nuget.md` section, GIF scene, manual checks, roadmap, Known limitations (Tasks 3, 5–9).
- **Verified, not assumed:** every code block of Tasks 1–8 was written into a scratch copy of the repository (`git archive HEAD`) and run there: `npm run typecheck` clean, the full Jest suite green (145 suites, 1228 tests, the real-MSBuild tests included with SDK 10.0.111), `npm run build:dev` exit 0. The GIF scene was not run (no display in the planning session); its click positions come from `docs/images/nuget.png` and are to be checked on the first run (Task 7, Step 6).
- **Placeholders:** none in code. The only values to tune at implementation time are the scene's click positions (Task 7), as in earlier scenes.
- **Type consistency:** `PackageVersionSource` (Task 2, `types.ts`) is used by `PackageReferenceInfo`, `BasicInstalledPackage`, `ProjectDependency`, `LocalNuGetPackage` and `versionLabels`; `ProjectPackages`/`centralFiles`/`packageVersionFileFor` (Task 2) by the plans (Task 4), `Project` (Task 3) and the watchers (Task 8); `PackageEdit`/`applyEdit` (Task 1) by `centralPackagePlan` and `applyPackageEdits` (Task 4); `ProjectState`, `VersionScope`, `planVersionChange`, `planUninstall`, `globalUninstallEdits`, `confirmationText` (Task 4) and `planConsolidate`, `consolidationText` (Task 6) by `centralPackageOperations` (Tasks 5–6); `evaluatePackages`, `packages`, `packagesVersion` (Task 2) by `Project`, `packageInstalledService`, the operations, the provider and the watchers; the `installPackage` payload's `versionScope` (`'shared' | 'project'`, Task 5) matches `VersionScope`.
- **Order:** each task leaves the build green: Task 3 changes what is shown before Task 5 changes what is written, Task 6 deletes `PackageUpdateService`/`PackageConsolidationService` only after Task 5 removed the other callers.

