# Configuration Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Working file, do NOT commit it (commit 67d346b removed `docs/superpowers/` from the repo). Delete it when the feature is done.

**Goal:** Visual Studio's Configuration Manager: add, rename and remove solution configurations and platforms, map each project to a configuration/platform and a Build flag, pick the active platform; written to .sln and .slnx and honoured by builds.

**Architecture:** A pure `ConfigurationModel` (src/services/configurationManager/) is read from and rendered back to the raw solution text, one module per format (`slnConfigurations.ts`, `slnxConfigurations.ts`) so formatting survives. `BuildConfiguration` gains an active platform. Build args take the mapped configuration/platform per project; projects with Build unchecked are skipped through the existing solution filter (`UnloadedProjects.buildTarget`). The UI is a `ConfigurationManagerPanel` webview tab with a React bundle `configuration-view`, modelled on `PublishPanel` / `publish-view`.

**Tech Stack:** TypeScript (strict, no unused locals), xml2js, React webview, Jest (jsdom).

**Project rules to respect** (from CLAUDE.md): webview code must not import `vscode`, Node modules or `core/logger.ts`; after editing `src/core/contextMenus.ts` run `npm run generate:menus`; `docs/settings.md` and `docs/keyboard-shortcuts.md` are tested against `package.json`; judge `npm run build:dev` by exit code; commit straight to master, no branches; every user-visible change updates its docs page in the same commit; `docs/manual-testing.md` entries are ticked only when the user confirms.

---

## File structure

| File | Responsibility |
|---|---|
| `src/services/configurationManager/model.ts` (new) | `ConfigurationModel` types, defaults, `msbuildPlatform`, `resolveMapping`, list/mapping mutators (pure) |
| `src/services/configurationManager/slnConfigurations.ts` (new) | read model from / render model into .sln text |
| `src/services/configurationManager/slnxConfigurations.ts` (new) | read model from / render model into .slnx text |
| `src/services/configurationManager/configurationManager.ts` (new) | `readModel(solution)` / `writeModel(solution, model)` dispatching on file type |
| `src/services/buildConfiguration.ts` | active platform, `solutionPlatforms()` |
| `src/services/dotnetTaskProvider.ts` | `-p:Platform`, per-project mapping, skip projects with Build off |
| `src/types/configurationManager.ts` (new) | webview ⇄ host messages (browser-safe, no imports of vscode) |
| `src/webview/providers/ConfigurationManagerPanel.ts` (new) | the editor tab |
| `src/webview/configuration-view/` (new) | React UI |
| `webpack.config.js`, `src/test/unit/build/webviewBundle.test.ts` | add the entry |
| `src/core/contextMenus.ts`, `package.json`, `docs/context-menus.md` | command + menu entries |
| `docs/configuration-manager.md` (new), `docs/README.md`, `docs/solution-explorer.md`, `README.md`, `docs/roadmap.md`, `docs/manual-testing.md` | docs |
| `scripts/screenshots/capture.sh` | scene `gif-configuration-manager` |
| `src/__fixtures__/configurations/` (new) | `.sln` and `.slnx` with x64 and a custom configuration |

---

### Task 1: Model and platform helpers

**Files:**
- Create: `src/services/configurationManager/model.ts`
- Test: `src/test/unit/services/configurationManager/model.test.ts`

The model stores only **explicit** project mappings; a missing mapping resolves to the default (same configuration, same platform, Build on).

- [ ] **Step 1: Write the failing test**

```ts
import {
    msbuildPlatform, emptyModel, resolveMapping, setMapping, addConfiguration, renameConfiguration, removeConfiguration,
    addPlatform, renamePlatform, removePlatform,
} from '../../../../services/configurationManager/model';

const project = 'src/App/App.csproj';

describe('msbuildPlatform', () => {
    it('drops the space of "Any CPU"', () => {
        expect(msbuildPlatform('Any CPU')).toBe('AnyCPU');
        expect(msbuildPlatform('x64')).toBe('x64');
    });
});

describe('resolveMapping', () => {
    it('defaults to the same configuration and platform with Build on', () => {
        const model = emptyModel();
        expect(resolveMapping(model, project, 'Debug', 'Any CPU')).toEqual({ configuration: 'Debug', platform: 'Any CPU', build: true });
    });

    it('returns an explicit mapping', () => {
        const model = setMapping(emptyModel(), project, 'Debug', 'Any CPU', { configuration: 'Release', platform: 'x64', build: false });
        expect(resolveMapping(model, project, 'Debug', 'Any CPU')).toEqual({ configuration: 'Release', platform: 'x64', build: false });
    });
});

describe('configuration and platform lists', () => {
    it('adds a configuration copying the mappings of another', () => {
        let model = setMapping(emptyModel(), project, 'Debug', 'Any CPU', { configuration: 'Debug', platform: 'x64', build: false });
        model = addConfiguration(model, 'Staging', 'Debug');
        expect(model.configurations).toEqual(['Debug', 'Release', 'Staging']);
        expect(resolveMapping(model, project, 'Staging', 'Any CPU')).toEqual({ configuration: 'Debug', platform: 'x64', build: false });
    });

    it('refuses a duplicate name, ignoring case', () => {
        expect(() => addConfiguration(emptyModel(), 'debug')).toThrow('already exists');
    });

    it('renames a configuration in the list and in the mappings', () => {
        let model = setMapping(emptyModel(), project, 'Release', 'Any CPU', { configuration: 'Release', platform: 'x64', build: true });
        model = renameConfiguration(model, 'Release', 'Prod');
        expect(model.configurations).toEqual(['Debug', 'Prod']);
        expect(resolveMapping(model, project, 'Prod', 'Any CPU').platform).toBe('x64');
    });

    it('removes a configuration and its mappings, but never the last one', () => {
        let model = removeConfiguration(emptyModel(), 'Release');
        expect(model.configurations).toEqual(['Debug']);
        expect(() => removeConfiguration(model, 'Debug')).toThrow('last');
    });

    it('adds, renames and removes platforms like configurations', () => {
        let model = addPlatform(emptyModel(), 'x64');
        expect(model.platforms).toEqual(['Any CPU', 'x64']);
        model = renamePlatform(model, 'x64', 'x86');
        expect(model.platforms).toEqual(['Any CPU', 'x86']);
        model = removePlatform(model, 'x86');
        expect(model.platforms).toEqual(['Any CPU']);
        expect(() => removePlatform(model, 'Any CPU')).toThrow('last');
    });

    it('rejects names with characters the solution file cannot hold', () => {
        expect(() => addConfiguration(emptyModel(), 'a|b')).toThrow('invalid');
        expect(() => addPlatform(emptyModel(), '')).toThrow('invalid');
    });
});
```

- [ ] **Step 2: Run it, expect FAIL** (`Cannot find module`)

Run: `npx jest src/test/unit/services/configurationManager/model.test.ts`

- [ ] **Step 3: Implement `model.ts`**

```ts
/** A project's setting for one solution configuration|platform pair */
export interface ProjectMapping {
    configuration: string;
    platform: string;
    build: boolean;
}

/**
 * The solution's configurations and platforms and the projects' deviations from the default mapping.
 * `mappings` is keyed by the project's path as the solution file spells it, then by "configuration|platform".
 */
export interface ConfigurationModel {
    configurations: string[];
    platforms: string[];
    mappings: Record<string, Record<string, ProjectMapping>>;
}

export const DEFAULT_PLATFORM = 'Any CPU';

export function emptyModel(): ConfigurationModel {
    return { configurations: ['Debug', 'Release'], platforms: [DEFAULT_PLATFORM], mappings: {} };
}

/** The solution spells it "Any CPU", MSBuild's Platform property "AnyCPU" */
export function msbuildPlatform(platform: string): string {
    return platform.replace(/\s+/g, '');
}

const pairKey = (configuration: string, platform: string) => `${configuration}|${platform}`;

export function resolveMapping(model: ConfigurationModel, project: string, configuration: string, platform: string): ProjectMapping {
    return model.mappings[project]?.[pairKey(configuration, platform)] ?? { configuration, platform, build: true };
}

export function setMapping(model: ConfigurationModel, project: string, configuration: string, platform: string, mapping: ProjectMapping): ConfigurationModel {
    const isDefault = mapping.configuration === configuration && mapping.platform === platform && mapping.build;
    const forProject = { ...model.mappings[project] };
    if (isDefault) {
        delete forProject[pairKey(configuration, platform)];
    } else {
        forProject[pairKey(configuration, platform)] = mapping;
    }
    const mappings = { ...model.mappings };
    if (Object.keys(forProject).length > 0) {
        mappings[project] = forProject;
    } else {
        delete mappings[project];
    }
    return { ...model, mappings };
}

function validName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed || /[|"<>&]/.test(trimmed)) {
        throw new Error(`"${name}" is an invalid name: it must not be empty or contain | " < > &`);
    }
    return trimmed;
}

function ensureNew(list: string[], name: string, kind: string): void {
    if (list.some(existing => existing.toLowerCase() === name.toLowerCase())) {
        throw new Error(`The ${kind} "${name}" already exists`);
    }
}

/** Rewrites every mapping key and mapping value for `transform` of one half of the pair */
function mapPairs(model: ConfigurationModel, part: 'configuration' | 'platform', transform: (name: string) => string | undefined): ConfigurationModel {
    const mappings: ConfigurationModel['mappings'] = {};
    for (const [project, pairs] of Object.entries(model.mappings)) {
        const next: Record<string, ProjectMapping> = {};
        for (const [key, mapping] of Object.entries(pairs)) {
            const [configuration, platform] = key.split('|');
            const renamed = transform(part === 'configuration' ? configuration : platform);
            if (renamed === undefined) {
                continue;
            }
            const targetName = transform(mapping[part]) ?? mapping[part];
            next[part === 'configuration' ? pairKey(renamed, platform) : pairKey(configuration, renamed)] = { ...mapping, [part]: targetName };
        }
        if (Object.keys(next).length > 0) {
            mappings[project] = next;
        }
    }
    return { ...model, mappings };
}

/** `copyFrom`: the existing configuration whose project mappings the new one starts with, like Visual Studio's "Copy settings from" */
export function addConfiguration(model: ConfigurationModel, name: string, copyFrom?: string): ConfigurationModel {
    name = validName(name);
    ensureNew(model.configurations, name, 'configuration');
    const mappings = { ...model.mappings };
    if (copyFrom) {
        for (const [project, pairs] of Object.entries(model.mappings)) {
            const added: Record<string, ProjectMapping> = {};
            for (const [key, mapping] of Object.entries(pairs)) {
                const [configuration, platform] = key.split('|');
                if (configuration === copyFrom) {
                    added[pairKey(name, platform)] = { ...mapping };
                }
            }
            mappings[project] = { ...pairs, ...added };
        }
    }
    return { ...model, configurations: [...model.configurations, name], mappings };
}

export function addPlatform(model: ConfigurationModel, name: string, copyFrom?: string): ConfigurationModel {
    name = validName(name);
    ensureNew(model.platforms, name, 'platform');
    const mappings = { ...model.mappings };
    if (copyFrom) {
        for (const [project, pairs] of Object.entries(model.mappings)) {
            const added: Record<string, ProjectMapping> = {};
            for (const [key, mapping] of Object.entries(pairs)) {
                const [configuration, platform] = key.split('|');
                if (platform === copyFrom) {
                    added[pairKey(configuration, name)] = { ...mapping };
                }
            }
            mappings[project] = { ...pairs, ...added };
        }
    }
    return { ...model, platforms: [...model.platforms, name], mappings };
}

export function renameConfiguration(model: ConfigurationModel, from: string, to: string): ConfigurationModel {
    to = validName(to);
    if (from.toLowerCase() !== to.toLowerCase()) {
        ensureNew(model.configurations, to, 'configuration');
    }
    const renamed = mapPairs(model, 'configuration', name => name === from ? to : name);
    return { ...renamed, configurations: model.configurations.map(name => name === from ? to : name) };
}

export function renamePlatform(model: ConfigurationModel, from: string, to: string): ConfigurationModel {
    to = validName(to);
    if (from.toLowerCase() !== to.toLowerCase()) {
        ensureNew(model.platforms, to, 'platform');
    }
    const renamed = mapPairs(model, 'platform', name => name === from ? to : name);
    return { ...renamed, platforms: model.platforms.map(name => name === from ? to : name) };
}

export function removeConfiguration(model: ConfigurationModel, name: string): ConfigurationModel {
    if (model.configurations.length <= 1) {
        throw new Error('The last configuration cannot be removed');
    }
    const kept = mapPairs(model, 'configuration', existing => existing === name ? undefined : existing);
    return { ...kept, configurations: model.configurations.filter(existing => existing !== name) };
}

export function removePlatform(model: ConfigurationModel, name: string): ConfigurationModel {
    if (model.platforms.length <= 1) {
        throw new Error('The last platform cannot be removed');
    }
    const kept = mapPairs(model, 'platform', existing => existing === name ? undefined : existing);
    return { ...kept, platforms: model.platforms.filter(existing => existing !== name) };
}
```

Known simplification: when a mapping's *target* is removed (project mapped to a configuration that is deleted) `mapPairs` keeps the old target name; `resolveMapping` callers must treat a target that no longer exists in the project as "unknown" (the UI shows the project's own list, which comes from the project file, so this is harmless).

- [ ] **Step 4: Run it, expect PASS**

Run: `npx jest src/test/unit/services/configurationManager/model.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/services/configurationManager/model.ts src/test/unit/services/configurationManager/model.test.ts
git commit -m "Configuration Manager: model of configurations, platforms and project mappings"
```

---

### Task 2: .sln read and render

**Files:**
- Create: `src/services/configurationManager/slnConfigurations.ts`
- Create fixture: `src/__fixtures__/configurations/Sample.sln`
- Test: `src/test/unit/services/configurationManager/slnConfigurations.test.ts`

Format (VS 17): in `SolutionConfigurationPlatforms` each line is `Debug|Any CPU = Debug|Any CPU`; in `ProjectConfigurationPlatforms` each project has `{GUID}.Debug|Any CPU.ActiveCfg = Debug|Any CPU` and, when it builds, `{GUID}.Debug|Any CPU.Build.0 = Debug|Any CPU`. The solution file's platform column is spelled "Any CPU"; projects use their own platform names.

- [ ] **Step 1: Create the fixture** `src/__fixtures__/configurations/Sample.sln` (use CRLF, as Visual Studio writes it; create it with `printf` or an editor that keeps CRLF):

```
Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
VisualStudioVersion = 17.0.31903.59
MinimumVisualStudioVersion = 10.0.40219.1
Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "App", "src\App\App.csproj", "{11111111-1111-1111-1111-111111111111}"
EndProject
Project("{9A19103F-16F7-4668-BE54-9A1E7A4F7556}") = "Lib", "src\Lib\Lib.csproj", "{22222222-2222-2222-2222-222222222222}"
EndProject
Global
	GlobalSection(SolutionConfigurationPlatforms) = preSolution
		Debug|Any CPU = Debug|Any CPU
		Debug|x64 = Debug|x64
		Release|Any CPU = Release|Any CPU
		Release|x64 = Release|x64
	EndGlobalSection
	GlobalSection(ProjectConfigurationPlatforms) = postSolution
		{11111111-1111-1111-1111-111111111111}.Debug|Any CPU.ActiveCfg = Debug|Any CPU
		{11111111-1111-1111-1111-111111111111}.Debug|Any CPU.Build.0 = Debug|Any CPU
		{11111111-1111-1111-1111-111111111111}.Debug|x64.ActiveCfg = Debug|Any CPU
		{11111111-1111-1111-1111-111111111111}.Debug|x64.Build.0 = Debug|Any CPU
		{11111111-1111-1111-1111-111111111111}.Release|Any CPU.ActiveCfg = Release|Any CPU
		{11111111-1111-1111-1111-111111111111}.Release|Any CPU.Build.0 = Release|Any CPU
		{11111111-1111-1111-1111-111111111111}.Release|x64.ActiveCfg = Release|Any CPU
		{11111111-1111-1111-1111-111111111111}.Release|x64.Build.0 = Release|Any CPU
		{22222222-2222-2222-2222-222222222222}.Debug|Any CPU.ActiveCfg = Debug|Any CPU
		{22222222-2222-2222-2222-222222222222}.Debug|Any CPU.Build.0 = Debug|Any CPU
		{22222222-2222-2222-2222-222222222222}.Debug|x64.ActiveCfg = Debug|Any CPU
		{22222222-2222-2222-2222-222222222222}.Release|Any CPU.ActiveCfg = Release|Any CPU
		{22222222-2222-2222-2222-222222222222}.Release|Any CPU.Build.0 = Release|Any CPU
		{22222222-2222-2222-2222-222222222222}.Release|x64.ActiveCfg = Release|Any CPU
	EndGlobalSection
	GlobalSection(SolutionProperties) = preSolution
		HideSolutionNode = FALSE
	EndGlobalSection
EndGlobal
```

Reading this: in the x64 solution platform, `App` maps to project platform "Any CPU" and builds; `Lib` builds in Debug|Any CPU, Release|Any CPU and Release|x64... no: `Lib` has **no** `Build.0` for `Debug|x64` and `Release|x64`, so Build is off there. That is the case the tests below assert.

- [ ] **Step 2: Write the failing test**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { readSlnModel, renderSlnModel } from '../../../../services/configurationManager/slnConfigurations';
import { resolveMapping, addPlatform, setMapping, removeConfiguration } from '../../../../services/configurationManager/model';

const content = fs.readFileSync(path.join(__dirname, '../../../../__fixtures__/configurations/Sample.sln'), 'utf8');
const projects = [
    { path: 'src/App/App.csproj', guid: '{11111111-1111-1111-1111-111111111111}' },
    { path: 'src/Lib/Lib.csproj', guid: '{22222222-2222-2222-2222-222222222222}' },
];

describe('readSlnModel', () => {
    it('reads the lists', () => {
        const model = readSlnModel(content, projects);
        expect(model.configurations).toEqual(['Debug', 'Release']);
        expect(model.platforms).toEqual(['Any CPU', 'x64']);
    });

    it('reads the mappings, Build off when there is no Build.0 line', () => {
        const model = readSlnModel(content, projects);
        expect(resolveMapping(model, 'src/Lib/Lib.csproj', 'Release', 'x64')).toEqual({ configuration: 'Release', platform: 'Any CPU', build: false });
        expect(resolveMapping(model, 'src/App/App.csproj', 'Release', 'x64')).toEqual({ configuration: 'Release', platform: 'Any CPU', build: true });
    });
});

describe('renderSlnModel', () => {
    it('round-trips an unchanged model to the same text', () => {
        const model = readSlnModel(content, projects);
        expect(renderSlnModel(content, model, projects)).toBe(content);
    });

    it('keeps the other sections and the line endings', () => {
        const model = addPlatform(readSlnModel(content, projects), 'ARM64');
        const rendered = renderSlnModel(content, model, projects);
        expect(rendered).toContain('GlobalSection(SolutionProperties)');
        expect(rendered).toContain('Debug|ARM64 = Debug|ARM64\r\n');
        expect(rendered.split('\r\n').length).toBeGreaterThan(content.split('\r\n').length);
        expect(rendered).not.toMatch(/[^\r]\n/);
    });

    it('writes an explicit mapping and a missing Build.0', () => {
        let model = readSlnModel(content, projects);
        model = setMapping(model, 'src/App/App.csproj', 'Debug', 'x64', { configuration: 'Release', platform: 'x64', build: false });
        const rendered = renderSlnModel(content, model, projects);
        expect(rendered).toContain('{11111111-1111-1111-1111-111111111111}.Debug|x64.ActiveCfg = Release|x64');
        expect(rendered).not.toContain('{11111111-1111-1111-1111-111111111111}.Debug|x64.Build.0');
    });

    it('drops the lines of a removed configuration', () => {
        const model = removeConfiguration(readSlnModel(content, projects), 'Release');
        const rendered = renderSlnModel(content, model, projects);
        expect(rendered).not.toContain('Release|');
    });
});
```

- [ ] **Step 3: Run, expect FAIL** (module missing)

- [ ] **Step 4: Implement `slnConfigurations.ts`**

Approach: the model is the source of truth, so both sections are regenerated from it (project order follows `projects`, the line order is configuration-major like Visual Studio). The "unchanged model round-trips" test holds because the fixture is in Visual Studio's order. A solution whose sections are in another order is normalised on the first edit, which is acceptable.

```ts
import { ConfigurationModel, DEFAULT_PLATFORM, ProjectMapping, resolveMapping, setMapping, emptyModel } from './model';

export interface SolutionProjectRef {
    /** As the solution file spells it (relative path, forward slashes) */
    path: string;
    guid: string;
}

const SECTION = (name: string) => new RegExp(`([ \\t]*)GlobalSection\\(${name}\\) = (?:pre|post)Solution[\\r\\n]+([\\s\\S]*?)[ \\t]*EndGlobalSection`);

function sectionLines(content: string, name: string): string[] {
    const match = SECTION(name).exec(content);
    return match ? match[2].split(/\r?\n/).map(line => line.trim()).filter(Boolean) : [];
}

function splitPair(pair: string): [string, string] {
    const index = pair.indexOf('|');
    return [pair.slice(0, index).trim(), pair.slice(index + 1).trim()];
}

export function readSlnModel(content: string, projects: readonly SolutionProjectRef[]): ConfigurationModel {
    const model = emptyModel();
    const configurations: string[] = [];
    const platforms: string[] = [];
    for (const line of sectionLines(content, 'SolutionConfigurationPlatforms')) {
        const [configuration, platform] = splitPair(line.split('=')[0]);
        if (configuration && !configurations.includes(configuration)) { configurations.push(configuration); }
        if (platform && !platforms.includes(platform)) { platforms.push(platform); }
    }
    if (configurations.length === 0) {
        return model;
    }

    const byGuid = new Map(projects.map(project => [project.guid.toLowerCase(), project.path]));
    const active = new Map<string, string>();   // "{guid}.pair" -> project pair
    const built = new Set<string>();
    for (const line of sectionLines(content, 'ProjectConfigurationPlatforms')) {
        const match = /^(\{[0-9A-Fa-f-]+\})\.(.+?)\.(ActiveCfg|Build\.0)\s*=\s*(.+)$/.exec(line);
        if (!match) { continue; }
        const key = `${match[1].toLowerCase()}.${match[2]}`;
        if (match[3] === 'ActiveCfg') { active.set(key, match[4].trim()); } else { built.add(key); }
    }

    let result: ConfigurationModel = { configurations, platforms: platforms.length > 0 ? platforms : [DEFAULT_PLATFORM], mappings: {} };
    for (const [key, target] of active) {
        const dot = key.indexOf('.');
        const projectPath = byGuid.get(key.slice(0, dot));
        if (!projectPath) { continue; }
        const [configuration, platform] = splitPair(key.slice(dot + 1));
        const [targetConfiguration, targetPlatform] = splitPair(target);
        const mapping: ProjectMapping = { configuration: targetConfiguration, platform: targetPlatform, build: built.has(key) };
        result = setMapping(result, projectPath, configuration, platform, mapping);
    }
    // a pair without any ActiveCfg line means Build off (Visual Studio omits both lines)
    for (const project of projects) {
        for (const configuration of result.configurations) {
            for (const platform of result.platforms) {
                const key = `${project.guid.toLowerCase()}.${configuration}|${platform}`;
                if (!active.has(key) && sectionLines(content, 'ProjectConfigurationPlatforms').length > 0) {
                    result = setMapping(result, project.path, configuration, platform, { configuration, platform, build: false });
                }
            }
        }
    }
    return result;
}

export function renderSlnModel(content: string, model: ConfigurationModel, projects: readonly SolutionProjectRef[]): string {
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const solutionLines: string[] = [];
    const projectLines: string[] = [];
    for (const configuration of model.configurations) {
        for (const platform of model.platforms) {
            solutionLines.push(`\t\t${configuration}|${platform} = ${configuration}|${platform}`);
        }
    }
    for (const project of projects) {
        for (const configuration of model.configurations) {
            for (const platform of model.platforms) {
                const mapping = resolveMapping(model, project.path, configuration, platform);
                const pair = `${configuration}|${platform}`;
                const target = `${mapping.configuration}|${mapping.platform}`;
                projectLines.push(`\t\t${project.guid}.${pair}.ActiveCfg = ${target}`);
                if (mapping.build) {
                    projectLines.push(`\t\t${project.guid}.${pair}.Build.0 = ${target}`);
                }
            }
        }
    }

    const withSolution = replaceSection(content, 'SolutionConfigurationPlatforms', 'preSolution', solutionLines, eol);
    return replaceSection(withSolution, 'ProjectConfigurationPlatforms', 'postSolution', projectLines, eol);
}

function replaceSection(content: string, name: string, kind: 'preSolution' | 'postSolution', lines: string[], eol: string): string {
    const block = [`\tGlobalSection(${name}) = ${kind}`, ...lines, '\tEndGlobalSection'].join(eol);
    const match = SECTION(name).exec(content);
    if (match) {
        return content.slice(0, match.index) + block + content.slice(match.index + match[0].length);
    }
    const end = content.lastIndexOf('EndGlobal');
    return end < 0 ? content : content.slice(0, end) + block + eol + content.slice(end);
}
```

Note: `block` replaces from the match start, which includes the leading indent captured by group 1, so `block` starts with its own `\t`; the regex's `([ \t]*)` prefix is part of `match[0]` and is replaced.

- [ ] **Step 5: Run, expect PASS.** If the round-trip test fails only on whitespace, fix `SECTION`/`replaceSection`, not the fixture.

Run: `npx jest src/test/unit/services/configurationManager/slnConfigurations.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/services/configurationManager/slnConfigurations.ts src/__fixtures__/configurations/Sample.sln src/test/unit/services/configurationManager/slnConfigurations.test.ts
git commit -m "Configuration Manager: read and write the configurations of a .sln"
```

---

### Task 3: .slnx read and render

**Files:**
- Create: `src/services/configurationManager/slnxConfigurations.ts`
- Create fixture: `src/__fixtures__/configurations/Sample.slnx`
- Test: `src/test/unit/services/configurationManager/slnxConfigurations.test.ts`

Format: `<Configurations><BuildType Name="Debug"/><Platform Name="x64"/></Configurations>`; per project `<BuildType Solution="Debug|*" Project="Release"/>`, `<Platform Solution="*|x64" Project="x86"/>`, `<Build Solution="Debug|*" Project="false"/>`. A `*` side matches anything; a mapping with both sides given (`Debug|x64`) is the most specific.

The model is keyed by pair, so on read each element is expanded over the lists (a `*` matches all, more specific elements win), and on write mappings are emitted per exact pair: `Solution="Debug|x64"`. That is valid slnx, only less compact than Visual Studio's wildcards; text edits keep everything else untouched.

- [ ] **Step 1: Create fixture** `src/__fixtures__/configurations/Sample.slnx`:

```xml
<Solution>
  <Configurations>
    <BuildType Name="Debug" />
    <BuildType Name="Release" />
    <Platform Name="Any CPU" />
    <Platform Name="x64" />
  </Configurations>
  <Project Path="src/App/App.csproj" />
  <Project Path="src/Lib/Lib.csproj">
    <BuildType Solution="Release|*" Project="Debug" />
    <Platform Solution="*|x64" Project="Any CPU" />
    <Build Solution="Debug|x64" Project="false" />
  </Project>
</Solution>
```

- [ ] **Step 2: Write the failing test**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { readSlnxModel, renderSlnxModel } from '../../../../services/configurationManager/slnxConfigurations';
import { resolveMapping, setMapping, addPlatform, renameConfiguration, removePlatform } from '../../../../services/configurationManager/model';

const content = fs.readFileSync(path.join(__dirname, '../../../../__fixtures__/configurations/Sample.slnx'), 'utf8');
const projects = [{ path: 'src/App/App.csproj', guid: 'a' }, { path: 'src/Lib/Lib.csproj', guid: 'b' }];

describe('readSlnxModel', () => {
    it('reads the lists', () => {
        const model = readSlnxModel(content, projects);
        expect(model.configurations).toEqual(['Debug', 'Release']);
        expect(model.platforms).toEqual(['Any CPU', 'x64']);
    });

    it('expands wildcards and lets the exact pair win', () => {
        const model = readSlnxModel(content, projects);
        expect(resolveMapping(model, 'src/Lib/Lib.csproj', 'Release', 'Any CPU')).toEqual({ configuration: 'Debug', platform: 'Any CPU', build: true });
        expect(resolveMapping(model, 'src/Lib/Lib.csproj', 'Debug', 'x64')).toEqual({ configuration: 'Debug', platform: 'Any CPU', build: false });
        expect(resolveMapping(model, 'src/App/App.csproj', 'Debug', 'x64')).toEqual({ configuration: 'Debug', platform: 'x64', build: true });
    });
});

describe('renderSlnxModel', () => {
    it('leaves an unchanged file alone', () => {
        expect(renderSlnxModel(content, readSlnxModel(content, projects), projects)).toBe(
            renderSlnxModel(content, readSlnxModel(content, projects), projects));
        const again = renderSlnxModel(content, readSlnxModel(content, projects), projects);
        expect(readSlnxModel(again, projects)).toEqual(readSlnxModel(content, projects));
    });

    it('adds a platform to the Configurations element', () => {
        const rendered = renderSlnxModel(content, addPlatform(readSlnxModel(content, projects), 'ARM64'), projects);
        expect(rendered).toContain('<Platform Name="ARM64" />');
    });

    it('writes only the deviations from the default, in the project element', () => {
        const model = setMapping(readSlnxModel(content, projects), 'src/App/App.csproj', 'Debug', 'Any CPU', { configuration: 'Release', platform: 'Any CPU', build: true });
        const rendered = renderSlnxModel(content, model, projects);
        expect(rendered).toContain('<Project Path="src/App/App.csproj">');
        expect(rendered).toContain('<BuildType Solution="Debug|Any CPU" Project="Release" />');
        expect(rendered).not.toContain('<Platform Solution="Debug|Any CPU"');
    });

    it('turns a project with only default mappings back into a self-closing element', () => {
        const model = setMapping(readSlnxModel(content, projects), 'src/App/App.csproj', 'Debug', 'Any CPU', { configuration: 'Release', platform: 'Any CPU', build: true });
        const reset = setMapping(model, 'src/App/App.csproj', 'Debug', 'Any CPU', { configuration: 'Debug', platform: 'Any CPU', build: true });
        expect(renderSlnxModel(content, reset, projects)).toContain('<Project Path="src/App/App.csproj" />');
    });

    it('follows a renamed configuration and a removed platform', () => {
        let model = renameConfiguration(readSlnxModel(content, projects), 'Release', 'Prod');
        model = removePlatform(model, 'x64');
        const rendered = renderSlnxModel(content, model, projects);
        expect(rendered).toContain('<BuildType Name="Prod" />');
        expect(rendered).not.toContain('x64');
    });
});
```

- [ ] **Step 3: Run, expect FAIL**

- [ ] **Step 4: Implement `slnxConfigurations.ts`**

```ts
import * as xml2js from 'xml2js';
import { ConfigurationModel, DEFAULT_PLATFORM, ProjectMapping, emptyModel, resolveMapping, setMapping } from './model';
import { SolutionProjectRef } from './slnConfigurations';

const ATTRS = `((?:\\s+[\\w:.-]+\\s*=\\s*(?:"[^"]*"|'[^']*'))*)`;
const PROJECT_RE = () => new RegExp(`([ \\t]*)<Project\\b${ATTRS}\\s*(?:\\/>|>([\\s\\S]*?)<\\/Project\\s*>)`, 'g');
const CONFIGURATIONS_RE = /([ \t]*)<Configurations\b[^>]*?(?:\/>|>[\s\S]*?<\/Configurations\s*>)/;

const attr = (attrs: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1];

/** "Debug|x64" -> ['Debug','x64'], "Debug|*" -> ['Debug','*'], "Debug" -> ['Debug','*'] */
function splitSolutionPair(value: string): [string, string] {
    const [configuration, platform] = value.split('|');
    return [configuration || '*', platform || '*'];
}

/** How specific a `Solution="…"` is: an exact pair beats a half wildcard beats `*|*` */
const specificity = ([configuration, platform]: [string, string]) => (configuration === '*' ? 0 : 1) + (platform === '*' ? 0 : 1);

function matches([configuration, platform]: [string, string], c: string, p: string): boolean {
    return (configuration === '*' || configuration === c) && (platform === '*' || platform === p);
}

export function readSlnxModel(content: string, projects: readonly SolutionProjectRef[]): ConfigurationModel {
    const configurations: string[] = [];
    const platforms: string[] = [];
    xml2js.parseString(content, { async: false }, (error: Error | null, result: any) => {
        if (error) { throw error; }
        const section = result?.Solution?.Configurations?.[0];
        for (const buildType of section?.BuildType ?? []) { if (buildType.$?.Name) { configurations.push(buildType.$.Name); } }
        for (const platform of section?.Platform ?? []) { if (platform.$?.Name) { platforms.push(platform.$.Name); } }
    });
    if (configurations.length === 0) {
        return emptyModel();
    }
    if (platforms.length === 0) {
        platforms.push(DEFAULT_PLATFORM);
    }

    let model: ConfigurationModel = { configurations, platforms, mappings: {} };
    const re = PROJECT_RE();
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
        const projectPath = attr(match[2], 'Path');
        const body = match[3];
        if (!projectPath || !body || !projects.some(project => project.path === projectPath)) { continue; }
        const rules: Array<{ kind: 'BuildType' | 'Platform' | 'Build'; solution: [string, string]; project: string }> = [];
        for (const element of body.matchAll(new RegExp(`<(BuildType|Platform|Build)\\b${ATTRS}\\s*\\/?>`, 'g'))) {
            const solution = attr(element[2], 'Solution');
            const project = attr(element[2], 'Project');
            if (solution !== undefined && project !== undefined) {
                rules.push({ kind: element[1] as 'BuildType' | 'Platform' | 'Build', solution: splitSolutionPair(solution), project });
            }
        }
        for (const configuration of configurations) {
            for (const platform of platforms) {
                const pick = (kind: string) => rules
                    .filter(rule => rule.kind === kind && matches(rule.solution, configuration, platform))
                    .sort((a, b) => specificity(b.solution) - specificity(a.solution))[0]?.project;
                const mapping: ProjectMapping = {
                    configuration: pick('BuildType') ?? configuration,
                    platform: pick('Platform') ?? platform,
                    build: pick('Build') !== 'false',
                };
                model = setMapping(model, projectPath, configuration, platform, mapping);
            }
        }
    }
    return model;
}

export function renderSlnxModel(content: string, model: ConfigurationModel, projects: readonly SolutionProjectRef[]): string {
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    let result = renderConfigurations(content, model, eol);
    result = result.replace(PROJECT_RE(), (whole, indent: string, attrs: string) => {
        const projectPath = attr(attrs, 'Path');
        if (!projectPath || !projects.some(project => project.path === projectPath)) { return whole; }
        const open = `${indent}<Project${attrs}`;
        const children: string[] = [];
        for (const configuration of model.configurations) {
            for (const platform of model.platforms) {
                const mapping = resolveMapping(model, projectPath, configuration, platform);
                const solution = `${configuration}|${platform}`;
                if (mapping.configuration !== configuration) { children.push(`<BuildType Solution="${solution}" Project="${mapping.configuration}" />`); }
                if (mapping.platform !== platform) { children.push(`<Platform Solution="${solution}" Project="${mapping.platform}" />`); }
                if (!mapping.build) { children.push(`<Build Solution="${solution}" Project="false" />`); }
            }
        }
        if (children.length === 0) {
            return `${open.trimEnd()} />`;
        }
        return `${open.trimEnd()}>${eol}${children.map(child => `${indent}  ${child}`).join(eol)}${eol}${indent}</Project>`;
    });
    return result;
}

function renderConfigurations(content: string, model: ConfigurationModel, eol: string): string {
    const match = CONFIGURATIONS_RE.exec(content);
    const indent = match?.[1] ?? '  ';
    const lines = [
        `${indent}<Configurations>`,
        ...model.configurations.map(name => `${indent}  <BuildType Name="${name}" />`),
        ...model.platforms.map(name => `${indent}  <Platform Name="${name}" />`),
        `${indent}</Configurations>`,
    ].join(eol);
    if (match) {
        return content.slice(0, match.index) + lines + content.slice(match.index + match[0].length);
    }
    const open = /<Solution\b[^>]*>/.exec(content);
    return open ? content.slice(0, open.index + open[0].length) + eol + lines + content.slice(open.index + open[0].length) : content;
}
```

Edge case to cover in the first test run: a project whose element is self-closing has `match[3] === undefined` in `readSlnxModel` (skipped, correct: no deviations). When the platform list is just "Any CPU" and Visual Studio omitted `<Platform>`, rendering writes `<Platform Name="Any CPU" />`; that is valid and explicit.

- [ ] **Step 5: Run, expect PASS**

Run: `npx jest src/test/unit/services/configurationManager/slnxConfigurations.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/services/configurationManager/slnxConfigurations.ts src/__fixtures__/configurations/Sample.slnx src/test/unit/services/configurationManager/slnxConfigurations.test.ts
git commit -m "Configuration Manager: read and write the configurations of a .slnx"
```

---

### Task 4: Reading and writing through the Solution

**Files:**
- Create: `src/services/configurationManager/configurationManager.ts`
- Modify: `src/core/Solution.ts` (a public `editSolutionText` wrapper; `editSlnx` at line 424 is private and slnx-only)
- Test: `src/test/unit/services/configurationManager/configurationManager.test.ts`

Read `Solution.ts:405-430`, `Solution.ts:1150-1165` and `Solution.isSlnx` before editing, to reuse how it reads/writes through `this._handler` and how it re-parses afterwards.

- [ ] **Step 1: Write the failing test** for the two pure dispatch functions (no VS Code needed):

```ts
import * as fs from 'fs';
import * as path from 'path';
import { readConfigurationModel, renderConfigurationModel } from '../../../../services/configurationManager/configurationManager';
import { addPlatform } from '../../../../services/configurationManager/model';

const sln = fs.readFileSync(path.join(__dirname, '../../../../__fixtures__/configurations/Sample.sln'), 'utf8');
const slnx = fs.readFileSync(path.join(__dirname, '../../../../__fixtures__/configurations/Sample.slnx'), 'utf8');
const projects = [
    { path: 'src/App/App.csproj', guid: '{11111111-1111-1111-1111-111111111111}' },
    { path: 'src/Lib/Lib.csproj', guid: '{22222222-2222-2222-2222-222222222222}' },
];

it.each([['sln', sln], ['slnx', slnx]])('reads and writes a .%s', (type, content) => {
    const model = readConfigurationModel(type as 'sln' | 'slnx', content, projects);
    expect(model.platforms).toContain('x64');
    const rendered = renderConfigurationModel(type as 'sln' | 'slnx', content, addPlatform(model, 'ARM64'), projects);
    expect(readConfigurationModel(type as 'sln' | 'slnx', rendered, projects).platforms).toContain('ARM64');
});
```

- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement**

```ts
import { ConfigurationModel } from './model';
import { readSlnModel, renderSlnModel, SolutionProjectRef } from './slnConfigurations';
import { readSlnxModel, renderSlnxModel } from './slnxConfigurations';

export type SolutionFileType = 'sln' | 'slnx';

export function readConfigurationModel(type: SolutionFileType, content: string, projects: readonly SolutionProjectRef[]): ConfigurationModel {
    return type === 'slnx' ? readSlnxModel(content, projects) : readSlnModel(content, projects);
}

export function renderConfigurationModel(type: SolutionFileType, content: string, model: ConfigurationModel, projects: readonly SolutionProjectRef[]): string {
    return type === 'slnx' ? renderSlnxModel(content, model, projects) : renderSlnModel(content, model, projects);
}
```

- [ ] **Step 4: Add to `Solution.ts`** a method that reads the text, lets a callback return new text, writes it (the file watcher then triggers `handleSolutionFileChanged`, as for the other mutations):

```ts
    /** Reads the solution file's text, writes what `edit` returns; the file watcher re-parses it */
    async editSolutionText(edit: (content: string, type: 'sln' | 'slnx') => string): Promise<void> {
        const content = await this._handler.read();
        await this._handler.write(edit(content, this.isSlnx ? 'slnx' : 'sln'));
    }
```

and a getter for the project refs of the solution file, excluding solution folders (type GUID `PROJECT_TYPE_GUIDS.SOLUTION_FOLDER`): path uses forward slashes, as in `SolutionProject.path`:

```ts
    /** The solution file's projects (not solution folders), as the configuration code identifies them */
    get configurationProjects(): Array<{ path: string; guid: string }> {
        return (this.solutionFile?.projects ?? [])
            .filter(project => project.typeGuid !== PROJECT_TYPE_GUIDS.SOLUTION_FOLDER)
            .map(project => ({ path: project.path.replace(/\\/g, '/'), guid: project.guid }));
    }
```

Check that `isSlnx` and `solutionFile` already exist under those names (`grep -n "isSlnx\|get solutionFile" src/core/Solution.ts`); adapt the names if not. Note for `.sln`, `SolutionProject.path` keeps backslashes; for `.slnx` it is the `Path` attribute as written. The model and file code above compare the forward-slash spelling, so the slnx reader must also receive forward-slash paths: if an slnx file uses backslashes, normalise in `readSlnxModel`/`renderSlnxModel` by comparing `attr(...).replace(/\\/g, '/')`. Add that to both `projects.some(...)` calls and add a test with a backslash path.

- [ ] **Step 5: Run the test + `npm run typecheck`, then commit**

```bash
git add src/services/configurationManager/configurationManager.ts src/core/Solution.ts src/test/unit/services/configurationManager/configurationManager.test.ts
git commit -m "Configuration Manager: read and write through the solution"
```

---

### Task 5: Active platform

**Files:**
- Modify: `src/services/buildConfiguration.ts`
- Modify: `src/test/unit/services/buildConfiguration.test.ts` (extend; read it first for the vscode mock)

`BuildConfiguration` keeps one memento key per kind. Add the platform next to the configuration, using the model's platform list. It lives here so `dotnetTaskProvider`, `debugConfigService`, `pack` and publish already import it.

- [ ] **Step 1: Failing test** (append to the existing file, using its mock setup): the available platforms default to `['Any CPU']`; `setAvailablePlatforms(['Any CPU','x64'])` then `setPlatform('x64')` makes `activePlatform` `'x64'` and fires the change listener once; removing x64 from the available platforms falls back to the first one; `solutionPlatforms()` reads them from a `SolutionFile`'s `SolutionConfigurationPlatforms` section.

```ts
describe('platform', () => {
    it('defaults to Any CPU and follows the solution', async () => {
        BuildConfiguration.initialize(memento());
        expect(BuildConfiguration.activePlatform).toBe('Any CPU');
        BuildConfiguration.setAvailablePlatforms(['Any CPU', 'x64']);
        await BuildConfiguration.setPlatform('x64');
        expect(BuildConfiguration.activePlatform).toBe('x64');
        BuildConfiguration.setAvailablePlatforms(['Any CPU']);
        expect(BuildConfiguration.activePlatform).toBe('Any CPU');
    });

    it('reads the platforms of a solution file', () => {
        const file = { globalSections: [{ name: 'SolutionConfigurationPlatforms', type: 'preSolution', items: { 'Debug|Any CPU': 'Debug|Any CPU', 'Debug|x64': 'Debug|x64' } }] } as any;
        expect(solutionPlatforms(file)).toEqual(['Any CPU', 'x64']);
    });
});
```

(`memento()` is the helper already in that test file; if it has another name use it.)

- [ ] **Step 2: Implement** mirroring the configuration members: constants `PLATFORM_STATE_KEY = 'shinobi.solution.platform'`, context keys `PLATFORM_CONTEXT = 'shinobi.solution.platform'` and `AVAILABLE_PLATFORMS_CONTEXT = 'shinobi.solution.availablePlatforms'`; `solutionPlatforms(file)` (second half of the `|` split, default `['Any CPU']`); static `_availablePlatforms`, getters `availablePlatforms`, `activePlatform` (stored if still available, else `Any CPU` if available, else the first), `setAvailablePlatforms`, `setPlatform` (updates state, context, fires `_fire()`; the existing listener type stays `(configuration: string) => void`, it is called with the active configuration, listeners read `activePlatform` themselves). `_updateContext` also sets the two new keys. Keep the existing `setAvailable` firing logic and make `setAvailablePlatforms` fire when the active platform changed.

- [ ] **Step 3: Wire** `SolutionWebviewProvider.ts:347`: next to `BuildConfiguration.setAvailable(solutionConfigurations(...))` add `BuildConfiguration.setAvailablePlatforms(solutionPlatforms(solution.solutionFile));`, and in the view-title description (line 384) show the platform only when more than one exists:

```ts
const platform = BuildConfiguration.availablePlatforms.length > 1 ? BuildConfiguration.activePlatform : undefined;
this._view.description = [[BuildConfiguration.active, platform].filter(Boolean).join(' | '), solution.getActiveFramework()].filter(Boolean).join(' · ');
```

- [ ] **Step 4:** `npx jest src/test/unit/services/buildConfiguration.test.ts && npm run typecheck`, commit `Configuration Manager: the active platform`.

---

### Task 6: Builds honour platform, mapping and Build flag

**Files:**
- Modify: `src/services/dotnetTaskProvider.ts` (`dotnetTaskArgs`, `createDotnetTask`)
- Modify: `src/services/unloadedProjects.ts` (`buildTarget` accepts extra excluded projects)
- Modify: `src/services/debugConfigService.ts:165,384`, `src/services/pack.ts:55`, `src/services/analyzerNodes.ts` (use the project's mapped configuration)
- Test: `src/test/unit/services/dotnetTaskProvider.test.ts`, `src/test/unit/services/unloadedProjects.test.ts`

Rules:
- Solution build: `dotnet build <sln> -c <active config> -p:Platform=<msbuildPlatform(active platform)>`; projects mapped to another configuration are NOT handled by the dotnet CLI with a plain `-c`; this is what the `.sln`'s `ProjectConfigurationPlatforms` is for, and MSBuild's solution build reads it itself when it builds the `.sln` (not a filter). For a `.slnx`, `dotnet build` reads the mapping too. So for solution builds only the two properties must be passed, and **Build off** is already honoured by MSBuild. The one gap is solution **filters** (unloaded projects): MSBuild reads the filter's solution, so the mapping is honoured there as well. Therefore: **no skipping logic is needed for the Build flag**; only pass `-c` and `-p:Platform`.
- Single-project build/pack/publish/debug: resolve the project's mapping for the active pair (`resolveMapping`) and pass its configuration and `msbuildPlatform(platform)`; Any CPU is not passed (`AnyCPU` is the default, passing it fails for some project types).

The earlier design's "skip through a solution filter" is therefore replaced by MSBuild's own handling; update the spec statement in the docs accordingly. Verify this assumption in Step 1 before relying on it.

- [ ] **Step 1: Verify** with the fixture: create a throwaway copy of `Sample.sln` with two real projects (or use `src/__fixtures__/test-solution`), set `Build.0` off for one project and run `dotnet build <sln> -c Debug -p:Platform="Any CPU" -v:n | grep -i "skipp\|Build started"`; confirm the project is skipped. If it is **not**, restore the filter approach: extend `UnloadedProjects.buildTarget(solutionPath, projectPaths, extraExcluded: string[])` with the paths whose mapping has `build: false` and add a test next to the existing `buildTarget` tests.

- [ ] **Step 2: Failing test** for `dotnetTaskArgs` (add a parameter `platform?: string`):

```ts
it('passes the platform unless it is Any CPU', () => {
    expect(dotnetTaskArgs('build', 'a.sln', 'Debug', undefined, false, 'x64')).toContain('-property:Platform=x64');
    expect(dotnetTaskArgs('build', 'a.sln', 'Debug', undefined, false, 'Any CPU').join(' ')).not.toContain('Platform=');
});
```

- [ ] **Step 3: Implement** in `dotnetTaskArgs`: `const platformArgs = platform && msbuildPlatform(platform) !== 'AnyCPU' ? [`-property:Platform=${msbuildPlatform(platform)}`] : [];` added to `build`, `rebuild`, `clean`, `pack`; `createDotnetTask` passes `BuildConfiguration.activePlatform` for solution targets and, for project targets, the mapped values via a helper `mappedBuild(projectPath)` in `configurationManager.ts`:

```ts
export function mappedBuild(model: ConfigurationModel, projectPath: string, configuration: string, platform: string): ProjectMapping {
    return resolveMapping(model, projectPath, configuration, platform);
}
```

The model is cached on the `Solution` (`Solution.configurationModel`, refreshed in `handleSolutionFileChanged`) so task creation stays synchronous: add `private _configurationModel?: ConfigurationModel; get configurationModel()` computed lazily from `readConfigurationModel(...)` and reset in `handleSolutionFileChanged`.

- [ ] **Step 4:** Update the call sites in `debugConfigService.ts` (build args at line 384), `pack.ts` (`packageOutputDirectory(projectPath, configuration)`) and `analyzerNodes.ts` to use `mappedBuild(...)`'s configuration and platform. Existing tests mock `BuildConfiguration`; add `activePlatform: 'Any CPU'` and `availablePlatforms` to those mocks (`grep -rn "BuildConfiguration" src/test` for each).

- [ ] **Step 5:** `npx jest && npm run typecheck`, commit `Configuration Manager: builds use the active platform and the project's mapping`.

---

### Task 7: Messages and the panel

**Files:**
- Create: `src/types/configurationManager.ts`
- Create: `src/webview/providers/ConfigurationManagerPanel.ts`
- Modify: `src/extension.ts` (set `ConfigurationManagerPanel.extensionUri`, register the command)
- Test: `src/test/unit/webview/providers/ConfigurationManagerPanel.test.ts` (only the pure message handler, see below)

`src/types/configurationManager.ts` (browser-safe, no imports besides types):

```ts
export interface ConfigurationManagerProject {
    path: string;
    name: string;
    /** Configurations and platforms the project file declares (<Configurations>, <Platforms>), for the dropdowns */
    configurations: string[];
    platforms: string[];
}

export interface ConfigurationManagerState {
    configurations: string[];
    platforms: string[];
    activeConfiguration: string;
    activePlatform: string;
    projects: ConfigurationManagerProject[];
    /** "projectPath|configuration|platform" -> mapping; explicit mappings only, the UI resolves defaults */
    mappings: Record<string, { configuration: string; platform: string; build: boolean }>;
}

export type ConfigurationManagerRequest =
    | { type: 'ready' }
    | { type: 'setActive'; configuration: string; platform: string }
    | { type: 'setMapping'; project: string; configuration: string; platform: string; mapping: { configuration: string; platform: string; build: boolean } }
    | { type: 'addConfiguration'; name: string; copyFrom?: string }
    | { type: 'renameConfiguration'; from: string; to: string }
    | { type: 'removeConfiguration'; name: string }
    | { type: 'addPlatform'; name: string; copyFrom?: string }
    | { type: 'renamePlatform'; from: string; to: string }
    | { type: 'removePlatform'; name: string };

export type ConfigurationManagerMessage =
    | { type: 'state'; state: ConfigurationManagerState }
    | { type: 'error'; message: string };
```

Panel (single instance, `show()` reveals), mirroring `PublishPanel`: `createWebviewPanel('shinobi.configurationManager', 'Configuration Manager', ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [out/webview] })`, HTML from `TemplateWizardWebview.getHtmlForWebview(extensionUri, webview, title, 'configuration-view')`. The handler is a pure function so it can be tested without VS Code:

```ts
/** Applies a request to the model; throws a user-readable Error for invalid input */
export function applyRequest(model: ConfigurationModel, request: ConfigurationManagerRequest): ConfigurationModel {
    switch (request.type) {
        case 'setMapping': return setMapping(model, request.project, request.configuration, request.platform, request.mapping);
        case 'addConfiguration': return addConfiguration(model, request.name, request.copyFrom);
        case 'renameConfiguration': return renameConfiguration(model, request.from, request.to);
        case 'removeConfiguration': return removeConfiguration(model, request.name);
        case 'addPlatform': return addPlatform(model, request.name, request.copyFrom);
        case 'renamePlatform': return renamePlatform(model, request.from, request.to);
        case 'removePlatform': return removePlatform(model, request.name);
        default: return model;
    }
}
```

Handler flow for list/mapping requests: `solution.editSolutionText((content, type) => renderConfigurationModel(type, content, applyRequest(readConfigurationModel(type, content, refs), request), refs))`; for `setActive`: `BuildConfiguration.set(configuration)` then `setPlatform(platform)`. After each request post a fresh `state`. Subscribe to `solution.onDidChange` and `BuildConfiguration.onDidChange` to re-post `state` (dispose on panel close). Errors from `applyRequest` post `{ type: 'error', message }`. Project dropdown lists: `Project` already exposes its target frameworks; for configurations/platforms use what the project file declares via `<Configurations>`/`<Platforms>` properties, defaulting to `['Debug', 'Release']` and `['Any CPU']` (read in `Project` via the existing project-file parser; add `configurations`/`platforms` there with a test in `projectFileParser.spec.ts` if absent).

Tests: `applyRequest` per request type (3-4 cases: add with duplicate throws, remove last throws, setMapping default drops the entry).

- [ ] **Step 1-5:** failing test for `applyRequest` → implement types + panel → typecheck → register command `shinobi.configurationManager.open` in `extension.ts` (`ConfigurationManagerPanel.show()`; shows a message when no solution is open) → run → commit `Configuration Manager: the editor tab`.

---

### Task 8: React UI

**Files:**
- Create: `src/webview/configuration-view/index.tsx`, `App.tsx`, `ConfigurationList.tsx` (the Add/Rename/Remove editor used for both lists), `ProjectGrid.tsx`
- Modify: `webpack.config.js` (entry `'configuration-view': './src/webview/configuration-view/index.tsx'`, next to `publish-view` at line 49)
- Modify: `src/test/unit/build/webviewBundle.test.ts` (add the entry)
- Test: `src/test/unit/webview/configuration-view/ProjectGrid.test.tsx`

Read `src/webview/publish-view/App.tsx` and `index.tsx` first and copy how it acquires the VS Code API (`acquireVsCodeApi` via the shared helper, not `vscode`), listens for messages and uses the VS Code CSS variables.

Behaviour:
- Header: two `<select>`s, "Active solution configuration" and "Active solution platform", bound to `state.activeConfiguration/activePlatform`; change posts `setActive`. Buttons "Edit Configurations..." and "Edit Platforms..." toggle `ConfigurationList` below the header.
- `ConfigurationList` (props: `kind`, `names`, `active`, `post`): a list with the names, an input + "Add" button (with a "Copy settings from" `<select>` defaulting to the active entry), per-row "Rename" (inline input, Enter commits, Escape cancels) and "Remove" buttons; Remove is disabled with one entry left. Errors from the host show in a banner at the top (`role="alert"`).
- `ProjectGrid`: a table, one row per `state.projects`, columns Project, Configuration (select of the project's configurations), Platform (select of the project's platforms), Build (checkbox). Cell values are the resolved mapping for the active pair: `state.mappings[`${project.path}|${activeConfiguration}|${activePlatform}`] ?? { configuration: activeConfiguration, platform: activePlatform, build: true }`. A change posts `setMapping` with the full new mapping. If a mapped value is not in the project's list it is shown as an extra `<option>` so nothing is silently rewritten.

Test `ProjectGrid` with React Testing Library (already used in `src/test/unit/webview`; mirror an existing test for imports): renders resolved defaults, shows the explicit mapping, calls `post` with a `setMapping` when the Build checkbox is toggled, keeps an unknown mapped value as an option.

- [ ] **Step 1:** failing `ProjectGrid` test. **Step 2:** run, FAIL. **Step 3:** implement the four files (plain functional components, no new dependencies). **Step 4:** add the webpack entry and the bundle-test entry. **Step 5:** `npx jest src/test/unit/webview/configuration-view src/test/unit/build/webviewBundle.test.ts && npm run build:dev; echo "exit $?"` expect exit 0. **Step 6:** commit `Configuration Manager: the UI`.

---

### Task 9: Menus, picker, commands

**Files:**
- Modify: `src/core/contextMenus.ts`, `package.json` (generated parts), `docs/context-menus.md` (generated), `src/extension.ts` (picker), `src/core/contextMenus` tests if they enumerate commands

- [ ] **Step 1:** Read `src/core/contextMenus.ts` around the `publish` command (line 73) and the solution-node menu (line 128 area). Add a `configurationManager` action `{ title: 'Configuration Manager...', description: 'Opens the Configuration Manager tab: solution configurations and platforms, and which configuration, platform and Build setting each project uses.' }` to the solution node's menu, and route it in `SolutionWebviewProvider.runNodeAction` / `nativeContextMenu.ts` to `ConfigurationManagerPanel.show()` (mirror how `publish` is routed).
- [ ] **Step 2:** `npm run generate:menus` then `npx jest src/test/unit/core/contextMenus.test.ts`.
- [ ] **Step 3:** In `package.json` add the view-title command `shinobi.solution.configurationManager` ("Configuration Manager...") in the `shinobi.solution.configurations` submenu (line 574 area, group `9_manager`), and extend the existing `shinobi.solution.selectConfiguration` quick pick (`extension.ts:173-190`) with a second `shinobi.solution.selectPlatform` command shown when `availablePlatforms` has more than one entry; both call `BuildConfiguration.set` / `setPlatform`.
- [ ] **Step 4:** `npm run typecheck && npx jest`; commit `Configuration Manager: menu entries and the platform picker`.

---

### Task 10: Docs, GIF, roadmap

**Files:**
- Create: `docs/configuration-manager.md`
- Modify: `docs/README.md` (index), `docs/solution-explorer.md` (mention of the active configuration), `README.md` (feature section + GIF), `docs/roadmap.md` (tick the item, remove the "Configuration Manager" note), `docs/manual-testing.md` (new entries, unticked), `scripts/screenshots/capture.sh` (new scene), `docs/images/configuration-manager.gif`

- [ ] **Step 1:** Write `docs/configuration-manager.md`: what it is (like Visual Studio's Build > Configuration Manager), opening it (solution context menu, view title picker), active configuration and platform, editing the lists (add with "copy settings from", rename, remove, last one cannot be removed), the project grid (Configuration, Platform, Build), what is written where (.sln sections, .slnx elements, only deviations), how builds use it (`-c`, `-p:Platform`; "Any CPU" is the MSBuild default), limits (no per-project platform creation, project dropdowns list what the project file declares). Follow the tone and structure of `docs/publish.md`.
- [ ] **Step 2:** `docs/README.md` index line; `docs/solution-explorer.md` sentence next to the configuration picker; `README.md`: a short feature section, with `![The Configuration Manager](docs/images/configuration-manager.gif)`, features and how to use them only, no roadmap talk.
- [ ] **Step 3:** `capture.sh`: read the `gif-new-project` scene (lines 272-281) and the helpers first; add `gif-configuration-manager` to `SCENES`, a scene that opens the sample solution, runs "Configuration Manager..." from the command palette, adds a platform `x64`, changes a project's Build checkbox and closes; `record_start` / `record_stop configuration-manager`. The sample solution lives in `scripts/screenshots/sample`; the scene may need an `.slnx` or `.sln` with two projects there (check what it has).
- [ ] **Step 4:** Run the scene: `SCENES=gif-configuration-manager scripts/screenshots/capture.sh` (needs X11 and ffmpeg; if the environment cannot, say so and leave the GIF for the user to record). View the GIF's frames to check them (ffmpeg `-vf fps=1` to PNGs, then Read) before committing.
- [ ] **Step 5:** `docs/roadmap.md`: tick the Configuration Manager item and describe what shipped in its line, like the other Phase 16 lines; the roadmap intro still says Phases 1-15 are done; Phase 16 then has all items done, so move it to `docs/history.md` following how earlier phases were moved, and update the intro. `docs/manual-testing.md`: add unticked entries (open the tab, add a platform, rename a configuration, project mapping builds in VS Code, .slnx formatting survives, F5 uses the mapped configuration).
- [ ] **Step 6:** `npx jest && npm run build:dev; echo "exit $?"`; commit `Configuration Manager: docs, GIF and roadmap`, then push to master (the user's workflow: commit and push straight to master, no branches).

---

## Amendments (found while executing; they override the task text above)

1. **Renaming keeps the project side.** A project's own configuration/platform names do not follow a solution-level rename (Visual Studio: renaming solution configuration Release to Prod leaves each project building in its own Release). So `renameConfiguration(model, from, to, projects)` and `renamePlatform(model, from, to, projects)` take the project paths: explicit mappings get their *key* renamed but keep their *values*; every project in `projects` that had no explicit mapping for `from|platform` (or `configuration|from`) gets an explicit one `{ configuration: from, platform: <same>, build: true }` under the new key, so it still builds in the project's original configuration. `removeConfiguration` / `removePlatform` only delete keys that use the removed solution-side name and leave values alone.
2. **Task 7:** `applyRequest(model, request, projects: readonly string[])` passes `projects` (the paths from `solution.configurationProjects`) to the two rename functions.

## Self-review

- **Spec coverage:** lists add/rename/remove with copy-from (T1), .sln and .slnx written (T2-T4), per-project grid and Build flag (T7-T8), platform picker next to Debug/Release (T5, T9), builds (T6), docs and GIF (T10), tests throughout. Not covered by design: creating new *project-level* platforms (the grid offers what the project file declares), stated in the docs.
- **Deviation from the approved design:** Task 6 replaces "skip through the solution filter" with MSBuild's own handling of `Build.0`/`<Build Project="false">`, to be verified in Task 6 Step 1 and falling back to the filter if MSBuild does not skip.
- **Type consistency:** `ConfigurationModel`, `ProjectMapping`, `SolutionProjectRef`, `resolveMapping`, `setMapping` and the `read…/render…Model` names are used identically in Tasks 1-7.
- **Known soft spots to watch while implementing:** the `.sln` round-trip test assumes Visual Studio's line order; `readSlnModel` marks a pair with no `ActiveCfg` line as Build off only when the section exists; slnx path spelling (backslashes) is normalised in Task 4.
