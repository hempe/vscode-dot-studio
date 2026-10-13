# Phase 4: Service References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add, update and remove WCF/SOAP service references from the Solution Explorer, compatible with references Visual Studio created (`ConnectedService.json`).

**Architecture:** Pure helpers (`connectedService.ts`) model the metadata files, folder kinds, names and packages. A Node-only generator (`serviceReferenceGenerator.ts`) runs `dotnet-svcutil --update` on a params file in a temporary folder under `obj/`, restores the project file, copies the result into `Connected Services/<Name>/` and writes the metadata back. `svcutil.ts` finds, installs and runs the tool. `serviceReferenceService.ts` is the VS Code UI glue that `SolutionActionService` calls for three new context-menu actions.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`), VS Code API, Jest (jsdom, per-file `jest.mock('vscode')`), `dotnet-svcutil` 8.0.0 run with `DOTNET_ROLL_FORWARD=Major`.

Spec: `docs/superpowers/specs/2026-10-13-phase4-service-references-design.md`. Fixtures: `src/__fixtures__/service-references/PayLoop/`.

Verified svcutil behaviour this plan relies on:
- `dotnet-svcutil --update <folder relative to the project dir> --noLogo`, run with the project directory as cwd, regenerates from `<folder>/dotnet-svcutil.params.json`; the folder may be under `obj/`; `version` may be omitted from the params file; exit code ≠ 0 on failure.
- It always adds `System.ServiceModel.*` `4.10.*` package references to the project file, so the text is restored afterwards.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/parsers/projectFileEditor.ts` (modify) | `ensureWcfMetadata` / `removeWcfMetadata`; shared `appendItemGroup` |
| `src/services/serviceReferences/connectedService.ts` (create) | Metadata model, read/serialize, params, folder kinds, names, required packages |
| `src/services/serviceReferences/svcutil.ts` (create) | Find (local manifest / global), install and run `dotnet-svcutil` |
| `src/services/serviceReferences/serviceReferenceGenerator.ts` (create) | Generate/update (temp folder, restore project file, copy, metadata, WCFMetadata, packages) and remove |
| `src/services/serviceReferences/serviceReferenceService.ts` (create) | VS Code UI: input boxes, progress, output channel, confirmations, tool install prompt |
| `src/core/Project.ts` (modify) | `contextValue` for `Connected Services` and reference folders |
| `src/core/contextMenus.ts`, `src/types/commands/project-action.ts`, `package.json` (modify) | Three actions and their menus |
| `src/services/solutionActionService.ts` (modify) | Route the actions |
| Tests under `src/test/unit/...` (create) | One per unit above, plus an svcutil integration test |

---

### Task 1: WCFMetadata item in the project file

**Files:**
- Modify: `src/parsers/projectFileEditor.ts`
- Test: `src/test/unit/parsers/projectFileEditor.wcf.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { ProjectFileEditor } from '../../../parsers/projectFileEditor';

const fixture = path.join(__dirname, '../../../__fixtures__/service-references/PayLoop/PayLoop.csproj');

const sdkProject = `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
  </PropertyGroup>

</Project>
`;

describe('ProjectFileEditor WCFMetadata', () => {
    it('adds the item in its own ItemGroup, SDK template style', () => {
        expect(ProjectFileEditor.ensureWcfMetadata(sdkProject)).toBe(`<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <WCFMetadata Include="Connected Services" />
  </ItemGroup>

</Project>
`);
    });

    it('leaves a project that has it unchanged', () => {
        const content = fs.readFileSync(fixture, 'utf8');
        expect(ProjectFileEditor.ensureWcfMetadata(content)).toBe(content);
    });

    it('removes the item and its then empty ItemGroup', () => {
        const content = fs.readFileSync(fixture, 'utf8');
        const removed = ProjectFileEditor.removeWcfMetadata(content);
        expect(removed).not.toContain('WCFMetadata');
        expect(removed).not.toMatch(/<ItemGroup>\s*<\/ItemGroup>/);
        expect(removed).toContain('<Reference Include="System.ServiceModel" />');
        expect(ProjectFileEditor.ensureWcfMetadata(sdkProject)).not.toBe(sdkProject);
        expect(ProjectFileEditor.removeWcfMetadata(ProjectFileEditor.ensureWcfMetadata(sdkProject))).toBe(sdkProject);
    });
});
```

- [ ] **Step 2: Run it, expect FAIL** (`ensureWcfMetadata is not a function`)

Run: `npx jest src/test/unit/parsers/projectFileEditor.wcf.test.ts`

- [ ] **Step 3: Implement.** In `projectFileEditor.ts`, move the "new ItemGroup before `</Project>`" part of `addAssemblyReference` into `private static appendItemGroup(content: string, items: (indent: string) => string[]): string` (same code: `projectEnd`, `lineStart`, `group`, the empty-line handling) and call it from `addAssemblyReference` as `return this.appendItemGroup(content, element);`. Then add:

```ts
    private static readonly WCF_METADATA_RE = /<WCFMetadata\s+Include\s*=\s*"Connected Services"\s*\/>/;

    /** Adds `<WCFMetadata Include="Connected Services" />` (Visual Studio's marker for service references) */
    static ensureWcfMetadata(content: string): string {
        if (this.WCF_METADATA_RE.test(content)) {
            return content;
        }
        return this.appendItemGroup(content, indent => [`${indent}<WCFMetadata Include="Connected Services" />`]);
    }

    /** Removes the WCFMetadata item, and its ItemGroup when nothing else is in it */
    static removeWcfMetadata(content: string): string {
        const match = this.WCF_METADATA_RE.exec(content);
        if (!match) {
            return content;
        }
        const lineStart = content.lastIndexOf('\n', match.index - 1) + 1;
        const lineEnd = content.indexOf('\n', match.index + match[0].length) + 1 || content.length;
        let result = content.slice(0, lineStart) + content.slice(lineEnd);

        // An ItemGroup left empty goes too, with one empty line above it
        result = result.replace(/(\r?\n)?[ \t]*\r?\n?[ \t]*<ItemGroup>\s*<\/ItemGroup>[ \t]*(\r?\n)/, (_all, _a, nl) => nl);
        return result;
    }
```

Adjust the empty-ItemGroup regex until both removal expectations pass (the round trip must give back `sdkProject` exactly).

- [ ] **Step 4: Run** `npx jest src/test/unit/parsers` — all pass, including the existing assembly reference tests.

- [ ] **Step 5: Commit** `git add -A && git commit -m "add and remove the WCFMetadata item in project files"`

---

### Task 2: Connected service metadata helpers

**Files:**
- Create: `src/services/serviceReferences/connectedService.ts`
- Test: `src/test/unit/services/serviceReferences/connectedService.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    CONNECTED_SERVICES, isNetFrameworkTarget, isValidReferenceName, newServiceReference, readServiceReference,
    requiredPackages, serializeServiceReference, serviceFolderKind, suggestReferenceName, toSvcutilParams,
} from '../../../../services/serviceReferences/connectedService';

const payLoop = path.join(__dirname, '../../../../__fixtures__/service-references/PayLoop');
const cardOperations = path.join(payLoop, CONNECTED_SERVICES, 'CardOperations');

describe('connected service metadata', () => {
    it('reads Visual Studio references', () => {
        const ref = readServiceReference(cardOperations);
        expect(ref).toMatchObject({
            name: 'CardOperations',
            format: 'visualStudio',
            providerId: 'Microsoft.VisualStudio.ConnectedService.Wcf',
            version: '15.0.40203.910',
        });
        expect(ref.options).toEqual({
            inputs: ['CardOperations.wsdl'],
            collectionTypes: ['System.Array', 'System.Collections.Generic.Dictionary`2'],
            messageContract: true,
            namespaceMappings: ['*, CardOperations'],
            targetFramework: 'net471',
            typeReuseMode: 'None',
        });
    });

    it('writes Visual Studio references back unchanged', () => {
        const text = fs.readFileSync(path.join(cardOperations, 'ConnectedService.json'), 'utf8');
        expect(serializeServiceReference(readServiceReference(cardOperations))).toBe(text);
    });

    it('reads and writes references created with the svcutil CLI in their own format', () => {
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'svcref-'));
        const params = { providerId: 'Microsoft.Tools.ServiceModel.Svcutil', version: '8.0.0', options: { inputs: ['a.wsdl'], outputFile: 'Reference.cs' } };
        fs.writeFileSync(path.join(folder, 'dotnet-svcutil.params.json'), JSON.stringify(params, null, 2) + '\n');

        const ref = readServiceReference(folder);
        expect(ref.format).toBe('svcutil');
        expect(JSON.parse(serializeServiceReference(ref))).toEqual(params);
        fs.rmSync(folder, { recursive: true });
    });

    it('names the file in the error for malformed metadata', () => {
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'svcref-'));
        fs.writeFileSync(path.join(folder, 'ConnectedService.json'), '{ "ExtendedData": ');
        expect(() => readServiceReference(folder)).toThrow(/ConnectedService\.json/);
        fs.rmSync(folder, { recursive: true });
    });

    it('creates new references in Visual Studio format with its defaults', () => {
        const ref = newServiceReference('/p/Connected Services/Calc', 'http://x/calc.asmx?WSDL', 'Calc', 'net10.0');
        expect(JSON.parse(serializeServiceReference(ref))).toEqual({
            ProviderId: 'Microsoft.VisualStudio.ConnectedService.Wcf',
            Version: '15.0.40203.910',
            ExtendedData: {
                inputs: ['http://x/calc.asmx?WSDL'],
                collectionTypes: ['System.Array', 'System.Collections.Generic.Dictionary`2'],
                namespaceMappings: ['*, Calc'],
                outputFile: 'Reference.cs',
                targetFramework: 'net10.0',
                typeReuseMode: 'None',
            },
        });
    });

    it('turns options into an svcutil params file for the current framework', () => {
        const params = JSON.parse(toSvcutilParams(readServiceReference(cardOperations).options, 'net10.0'));
        expect(params.providerId).toBe('Microsoft.Tools.ServiceModel.Svcutil');
        expect(params.options.targetFramework).toBe('net10.0');
        expect(params.options.messageContract).toBe(true);
    });
});

describe('service folders', () => {
    it('recognizes Connected Services and the reference folders in it', () => {
        expect(serviceFolderKind(payLoop, path.join(payLoop, CONNECTED_SERVICES))).toBe('connectedServices');
        expect(serviceFolderKind(payLoop, cardOperations)).toBe('serviceReference');
        expect(serviceFolderKind(payLoop, path.join(payLoop, 'Properties'))).toBeUndefined();
        expect(serviceFolderKind(payLoop, path.join(payLoop, CONNECTED_SERVICES, 'Nothing'))).toBeUndefined();
    });
});

describe('reference names', () => {
    it('suggests a name from URLs and files', () => {
        expect(suggestReferenceName('http://test.payloop.com/CardsWebFront/Services/CardOperations.asmx?WSDL', [])).toBe('CardOperations');
        expect(suggestReferenceName('https://x/Service.svc?singleWsdl', [])).toBe('Service');
        expect(suggestReferenceName('/home/me/My Service-v2.wsdl', [])).toBe('My_Service_v2');
        expect(suggestReferenceName('https://x/', [])).toBe('ServiceReference');
        expect(suggestReferenceName('https://x/2024.wsdl', [])).toBe('_2024');
    });

    it('avoids existing names', () => {
        expect(suggestReferenceName('a/Calc.wsdl', ['Calc', 'Calc1'])).toBe('Calc2');
    });

    it('validates names', () => {
        expect(isValidReferenceName('CardOperations')).toBe(true);
        expect(isValidReferenceName('Card.Operations')).toBe(true);
        expect(isValidReferenceName('')).toBe(false);
        expect(isValidReferenceName('a/b')).toBe(false);
        expect(isValidReferenceName('..')).toBe(false);
    });
});

describe('required packages', () => {
    const http = 'new System.ServiceModel.BasicHttpBinding()';

    it('Http and Primitives for HTTP clients, NetTcp only when needed', () => {
        expect(requiredPackages(http, '<Project />', 'net10.0')).toEqual(['System.ServiceModel.Http', 'System.ServiceModel.Primitives']);
        expect(requiredPackages(http + ' new System.ServiceModel.NetTcpBinding()', '<Project />', 'net10.0'))
            .toEqual(['System.ServiceModel.Http', 'System.ServiceModel.Primitives', 'System.ServiceModel.NetTcp']);
    });

    it('skips packages the project references', () => {
        expect(requiredPackages(http, '<PackageReference Include="System.ServiceModel.Http" Version="10.0.652802" />', 'net10.0'))
            .toEqual(['System.ServiceModel.Primitives']);
    });

    it('none for .NET Framework, which has System.ServiceModel built in', () => {
        expect(requiredPackages(http, '<Project />', 'net471')).toEqual([]);
        expect(isNetFrameworkTarget('net48')).toBe(true);
        expect(isNetFrameworkTarget('net10.0')).toBe(false);
        expect(isNetFrameworkTarget('netstandard2.0')).toBe(false);
    });
});
```

- [ ] **Step 2: Run it, expect FAIL** (module not found)

Run: `npx jest src/test/unit/services/serviceReferences/connectedService.test.ts`

- [ ] **Step 3: Implement `connectedService.ts`**

```ts
import * as fs from 'fs';
import * as path from 'path';

export const CONNECTED_SERVICES = 'Connected Services';
export const VS_METADATA_FILE = 'ConnectedService.json';
export const SVCUTIL_PARAMS_FILE = 'dotnet-svcutil.params.json';
const VS_PROVIDER_ID = 'Microsoft.VisualStudio.ConnectedService.Wcf';
const VS_PROVIDER_VERSION = '15.0.40203.910';
const SVCUTIL_PROVIDER_ID = 'Microsoft.Tools.ServiceModel.Svcutil';

/** svcutil options; Visual Studio stores the same keys as `ExtendedData` */
export interface SvcutilOptions {
    inputs: string[];
    outputFile?: string;
    targetFramework?: string;
    [key: string]: unknown;
}

/** A service reference folder and its metadata file */
export interface ServiceReference {
    readonly folder: string;
    readonly name: string;
    /** `ConnectedService.json` (Visual Studio) or `dotnet-svcutil.params.json` (svcutil CLI) */
    readonly format: 'visualStudio' | 'svcutil';
    readonly providerId: string;
    readonly version?: string;
    readonly options: SvcutilOptions;
    readonly eol: string;
}

export function metadataFileName(format: ServiceReference['format']): string {
    return format === 'visualStudio' ? VS_METADATA_FILE : SVCUTIL_PARAMS_FILE;
}

/** Reads the reference in `folder`; throws an Error naming the file when it is missing or malformed */
export function readServiceReference(folder: string): ServiceReference {
    const format = fs.existsSync(path.join(folder, VS_METADATA_FILE)) ? 'visualStudio' : 'svcutil';
    const file = path.join(folder, metadataFileName(format));
    let text: string;
    let json: any;
    try {
        text = fs.readFileSync(file, 'utf8');
        json = JSON.parse(text.replace(/^﻿/, ''));
    } catch (error) {
        throw new Error(`${file} could not be read: ${error instanceof Error ? error.message : error}`);
    }
    const options = format === 'visualStudio' ? json?.ExtendedData : json?.options;
    if (!options || !Array.isArray(options.inputs) || options.inputs.length === 0) {
        throw new Error(`${file} has no inputs`);
    }
    return {
        folder,
        name: path.basename(folder),
        format,
        providerId: format === 'visualStudio' ? json.ProviderId : json.providerId,
        version: format === 'visualStudio' ? json.Version : json.version,
        options,
        eol: text.includes('\r\n') ? '\r\n' : '\n',
    };
}

/** The metadata file's text, with the keys in the order Visual Studio / svcutil write them */
export function serializeServiceReference(ref: ServiceReference): string {
    const json = ref.format === 'visualStudio'
        ? { ProviderId: ref.providerId, Version: ref.version, ExtendedData: ref.options }
        : { providerId: ref.providerId, ...(ref.version ? { version: ref.version } : {}), options: ref.options };
    return JSON.stringify(json, null, 2).replace(/\n/g, ref.eol) + ref.eol;
}

/** A new reference in Visual Studio's format with its defaults (type reuse off, see the spec) */
export function newServiceReference(folder: string, input: string, namespace: string, targetFramework: string): ServiceReference {
    return {
        folder,
        name: path.basename(folder),
        format: 'visualStudio',
        providerId: VS_PROVIDER_ID,
        version: VS_PROVIDER_VERSION,
        options: {
            inputs: [input],
            collectionTypes: ['System.Array', 'System.Collections.Generic.Dictionary`2'],
            namespaceMappings: [`*, ${namespace}`],
            outputFile: 'Reference.cs',
            targetFramework,
            typeReuseMode: 'None',
        },
        eol: '\n',
    };
}

/** `dotnet-svcutil.params.json` for `--update`, generating for the project's current framework */
export function toSvcutilParams(options: SvcutilOptions, targetFramework: string): string {
    return JSON.stringify({ providerId: SVCUTIL_PROVIDER_ID, options: { ...options, targetFramework } }, null, 2) + '\n';
}

export type ServiceFolderKind = 'connectedServices' | 'serviceReference';

/** `Connected Services` itself, or a reference folder directly in it (one with a metadata file) */
export function serviceFolderKind(projectDir: string, folderPath: string): ServiceFolderKind | undefined {
    const connectedServices = path.join(projectDir, CONNECTED_SERVICES);
    if (folderPath === connectedServices) {
        return 'connectedServices';
    }
    if (path.dirname(folderPath) === connectedServices
        && (fs.existsSync(path.join(folderPath, VS_METADATA_FILE)) || fs.existsSync(path.join(folderPath, SVCUTIL_PARAMS_FILE)))) {
        return 'serviceReference';
    }
    return undefined;
}

export function isUrl(input: string): boolean {
    return /^https?:\/\//i.test(input);
}

/** A folder name and C# namespace: letters, digits, `_` and `.` */
export function isValidReferenceName(name: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(name);
}

/** From the WSDL's file name or last URL path segment, e.g. `.../CardOperations.asmx?WSDL` → `CardOperations` */
export function suggestReferenceName(input: string, existing: readonly string[]): string {
    const withoutQuery = input.replace(/[?#].*$/, '').replace(/[\\/]+$/, '');
    const segment = isUrl(input) && !/^https?:\/\/[^/]+$/i.test(withoutQuery)
        ? withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1)
        : isUrl(input) ? '' : path.basename(withoutQuery);
    let base = segment.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_]/g, '_');
    if (!base) {
        base = 'ServiceReference';
    } else if (/^[0-9]/.test(base)) {
        base = `_${base}`;
    }
    let name = base;
    for (let i = 1; existing.includes(name); i++) {
        name = `${base}${i}`;
    }
    return name;
}

/** .NET Framework TFMs (net471, net48) come with System.ServiceModel; modern ones need the WCF client packages */
export function isNetFrameworkTarget(targetFramework: string): boolean {
    return /^net\d{2,3}$/.test(targetFramework);
}

/** WCF client packages the generated code needs and the project doesn't reference yet */
export function requiredPackages(referenceCode: string, projectXml: string, targetFramework: string): string[] {
    if (isNetFrameworkTarget(targetFramework)) {
        return [];
    }
    const packages = ['System.ServiceModel.Http', 'System.ServiceModel.Primitives'];
    if (referenceCode.includes('NetTcpBinding')) {
        packages.push('System.ServiceModel.NetTcp');
    }
    return packages.filter(id => !new RegExp(`<PackageReference\\b[^>]*\\bInclude\\s*=\\s*"${id.replace(/\./g, '\\.')}"`, 'i').test(projectXml));
}
```

- [ ] **Step 4: Run the test, expect PASS.** If `writes Visual Studio references back unchanged` fails on line endings or a trailing newline, adjust `serializeServiceReference` (not the fixture).

- [ ] **Step 5: Commit** `git add -A && git commit -m "model connected service metadata"`

---

### Task 3: Find, install and run dotnet-svcutil

**Files:**
- Create: `src/services/serviceReferences/svcutil.ts`
- Test: `src/test/unit/services/serviceReferences/svcutil.test.ts`

- [ ] **Step 1: Write the failing test** (pure parts: parsing `dotnet tool list` and building the command)

```ts
import * as os from 'os';
import * as path from 'path';
import { listsSvcutil, svcutilCommand, SVCUTIL_ENV } from '../../../../services/serviceReferences/svcutil';

describe('dotnet-svcutil', () => {
    it('finds it in `dotnet tool list` output', () => {
        const output = `Package Id          Version      Commands          Manifest
--------------------------------------------------------------------------
dotnet-svcutil      8.0.0        dotnet-svcutil    /repo/.config/dotnet-tools.json`;
        expect(listsSvcutil(output)).toBe(true);
        expect(listsSvcutil('Package Id      Version      Commands\n-----------')).toBe(false);
    });

    it('runs local tools through dotnet and global ones from the tools folder', () => {
        expect(svcutilCommand('local', ['--update', 'x'])).toEqual({ file: 'dotnet', args: ['tool', 'run', 'dotnet-svcutil', '--', '--update', 'x'] });
        const global = svcutilCommand('global', ['-h']);
        expect(global.file).toBe(path.join(os.homedir(), '.dotnet', 'tools', process.platform === 'win32' ? 'dotnet-svcutil.exe' : 'dotnet-svcutil'));
        expect(global.args).toEqual(['-h']);
    });

    it('rolls forward to the installed runtime and opts out of telemetry', () => {
        expect(SVCUTIL_ENV).toEqual({ DOTNET_ROLL_FORWARD: 'Major', DOTNET_SVCUTIL_TELEMETRY_OPTOUT: '1' });
    });
});
```

- [ ] **Step 2: Run it, expect FAIL** (module not found)

- [ ] **Step 3: Implement `svcutil.ts`**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';

/** dotnet-svcutil 8 targets .NET 9; roll forward so it runs on newer runtimes */
export const SVCUTIL_ENV = { DOTNET_ROLL_FORWARD: 'Major', DOTNET_SVCUTIL_TELEMETRY_OPTOUT: '1' };

export type SvcutilInstall = 'local' | 'global';

export interface ProcessResult {
    readonly code: number;
    readonly output: string;
}

/** Runs a process, collecting stdout and stderr; never rejects */
export function run(file: string, args: string[], cwd: string, env: Record<string, string> = {}): Promise<ProcessResult> {
    return new Promise(resolve => {
        execFile(file, args, { cwd, env: { ...process.env, ...env }, timeout: 300000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
            const code = error ? (typeof (error as any).code === 'number' ? (error as any).code : 1) : 0;
            resolve({ code, output: `${stdout}${stderr}${error && !stdout && !stderr ? error.message : ''}` });
        });
    });
}

export function listsSvcutil(toolListOutput: string): boolean {
    return /^dotnet-svcutil\s/im.test(toolListOutput);
}

function globalToolPath(): string {
    return path.join(os.homedir(), '.dotnet', 'tools', process.platform === 'win32' ? 'dotnet-svcutil.exe' : 'dotnet-svcutil');
}

/** The local tool manifest (found from `cwd` upwards) wins over a global install */
export async function findSvcutil(cwd: string): Promise<SvcutilInstall | undefined> {
    if (listsSvcutil((await run('dotnet', ['tool', 'list'], cwd)).output)) {
        return 'local';
    }
    return fs.existsSync(globalToolPath()) ? 'global' : undefined;
}

export function svcutilCommand(install: SvcutilInstall, args: string[]): { file: string; args: string[] } {
    return install === 'local'
        ? { file: 'dotnet', args: ['tool', 'run', 'dotnet-svcutil', '--', ...args] }
        : { file: globalToolPath(), args };
}

export function runSvcutil(install: SvcutilInstall, args: string[], cwd: string): Promise<ProcessResult> {
    const command = svcutilCommand(install, args);
    return run(command.file, command.args, cwd, SVCUTIL_ENV);
}

/** Installs into the repository's tool manifest (created when missing) or globally */
export async function installSvcutil(install: SvcutilInstall, workspaceDir: string): Promise<ProcessResult> {
    if (install === 'global') {
        return run('dotnet', ['tool', 'install', '--global', 'dotnet-svcutil'], workspaceDir);
    }
    if (!fs.existsSync(path.join(workspaceDir, '.config', 'dotnet-tools.json')) && !fs.existsSync(path.join(workspaceDir, 'dotnet-tools.json'))) {
        const created = await run('dotnet', ['new', 'tool-manifest'], workspaceDir);
        if (created.code !== 0) {
            return created;
        }
    }
    return run('dotnet', ['tool', 'install', 'dotnet-svcutil'], workspaceDir);
}
```

- [ ] **Step 4: Run, expect PASS.** Also check by hand that `dotnet tool run dotnet-svcutil -- -h` works from a folder with a manifest (`cd /tmp/x && dotnet new tool-manifest && dotnet tool install dotnet-svcutil && DOTNET_ROLL_FORWARD=Major dotnet tool run dotnet-svcutil -- -h | head -3`). If `tool run` needs the args without `--`, change `svcutilCommand` and the test.

- [ ] **Step 5: Commit** `git add -A && git commit -m "find, install and run dotnet-svcutil"`

---

### Task 4: Generate, update and remove

**Files:**
- Create: `src/services/serviceReferences/serviceReferenceGenerator.ts`
- Test: `src/test/unit/services/serviceReferences/serviceReferenceGenerator.test.ts` (fake svcutil)
- Test: `src/test/unit/services/serviceReferences/serviceReferenceGenerator.svcutil.test.ts` (real tool, skipped without it)

- [ ] **Step 1: Write the failing unit test with a fake svcutil**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateServiceReference, removeServiceReference, Svcutil } from '../../../../services/serviceReferences/serviceReferenceGenerator';
import { newServiceReference, readServiceReference } from '../../../../services/serviceReferences/connectedService';

const fixtureProject = path.join(__dirname, '../../../../__fixtures__/service-references/PayLoop');

/** Writes Reference.cs like svcutil and, like svcutil, adds 4.10.* packages to the project */
const fakeSvcutil = (calls: string[][], fail = false): Svcutil => async (args, cwd) => {
    calls.push(args);
    const folder = path.join(cwd, args[1]);
    const params = JSON.parse(fs.readFileSync(path.join(folder, 'dotnet-svcutil.params.json'), 'utf8'));
    const csproj = fs.readdirSync(cwd).find(f => f.endsWith('.csproj'))!;
    fs.writeFileSync(path.join(cwd, csproj), fs.readFileSync(path.join(cwd, csproj), 'utf8').replace('</Project>', '<ItemGroup><PackageReference Include="System.ServiceModel.Duplex" Version="4.10.*" /></ItemGroup></Project>'));
    if (fail) {
        return { code: 1, output: 'Error: cannot load metadata' };
    }
    fs.writeFileSync(path.join(folder, params.options.outputFile ?? 'Reference.cs'), `// ${params.options.targetFramework}\nnew System.ServiceModel.BasicHttpBinding();\n`);
    return { code: 0, output: 'Generating files...' };
};

describe('generateServiceReference', () => {
    let project: string;
    let projectPath: string;
    let added: string[];

    beforeEach(() => {
        project = fs.mkdtempSync(path.join(os.tmpdir(), 'svcgen-'));
        fs.cpSync(fixtureProject, project, { recursive: true });
        projectPath = path.join(project, 'PayLoop.csproj');
        fs.writeFileSync(projectPath, fs.readFileSync(projectPath, 'utf8').replace('net471', 'net10.0'));
        added = [];
    });
    afterEach(() => fs.rmSync(project, { recursive: true, force: true }));

    const addPackage = async (_project: string, id: string) => { added.push(id); };

    it('updates a Visual Studio reference for the current framework and keeps its metadata format', async () => {
        const calls: string[][] = [];
        const folder = path.join(project, 'Connected Services', 'CardOperations');
        const before = fs.readFileSync(projectPath, 'utf8');

        const result = await generateServiceReference({
            projectPath, reference: readServiceReference(folder), targetFramework: 'net10.0', svcutil: fakeSvcutil(calls), addPackage,
        });

        expect(result.success).toBe(true);
        expect(calls[0][0]).toBe('--update');
        expect(calls[0][1]).toMatch(/^obj[\\/]shinobi-svcutil-/);
        expect(fs.readFileSync(path.join(folder, 'Reference.cs'), 'utf8')).toContain('// net10.0');
        expect(fs.existsSync(path.join(folder, 'dotnet-svcutil.params.json'))).toBe(false);
        const metadata = JSON.parse(fs.readFileSync(path.join(folder, 'ConnectedService.json'), 'utf8'));
        expect(metadata.ProviderId).toBe('Microsoft.VisualStudio.ConnectedService.Wcf');
        expect(metadata.ExtendedData.targetFramework).toBe('net10.0');
        expect(metadata.ExtendedData.inputs).toEqual(['CardOperations.wsdl']);
        // svcutil's package edits are undone; WCFMetadata was already there
        expect(fs.readFileSync(projectPath, 'utf8')).toBe(before);
        expect(added).toEqual(['System.ServiceModel.Http', 'System.ServiceModel.Primitives']);
        expect(fs.readdirSync(path.join(project, 'obj')).filter(f => f.startsWith('shinobi-svcutil-'))).toEqual([]);
    });

    it('adds a new reference from a local WSDL file', async () => {
        const wsdl = path.join(project, 'Connected Services', 'CardOperations', 'CardOperations.wsdl');
        const folder = path.join(project, 'Connected Services', 'Cards');
        fs.writeFileSync(projectPath, fs.readFileSync(projectPath, 'utf8').replace(/\s*<ItemGroup>\s*<WCFMetadata[^>]*>\s*<\/ItemGroup>/, ''));

        const result = await generateServiceReference({
            projectPath, reference: newServiceReference(folder, wsdl, 'Cards', 'net10.0'), targetFramework: 'net10.0', svcutil: fakeSvcutil([]), addPackage,
        });

        expect(result.success).toBe(true);
        expect(fs.readdirSync(folder).sort()).toEqual(['CardOperations.wsdl', 'ConnectedService.json', 'Reference.cs']);
        expect(JSON.parse(fs.readFileSync(path.join(folder, 'ConnectedService.json'), 'utf8')).ExtendedData.inputs).toEqual(['CardOperations.wsdl']);
        expect(fs.readFileSync(projectPath, 'utf8')).toContain('<WCFMetadata Include="Connected Services" />');
    });

    it('a failing run leaves the reference and the project file as they were', async () => {
        const folder = path.join(project, 'Connected Services', 'CardOperations');
        fs.writeFileSync(path.join(folder, 'Reference.cs'), '// old');
        const before = fs.readFileSync(projectPath, 'utf8');

        const result = await generateServiceReference({
            projectPath, reference: readServiceReference(folder), targetFramework: 'net10.0', svcutil: fakeSvcutil([], true), addPackage,
        });

        expect(result).toEqual({ success: false, output: 'Error: cannot load metadata' });
        expect(fs.readFileSync(path.join(folder, 'Reference.cs'), 'utf8')).toBe('// old');
        expect(fs.readFileSync(projectPath, 'utf8')).toBe(before);
        expect(added).toEqual([]);
    });
});

describe('removeServiceReference', () => {
    it('deletes the folder, and Connected Services with WCFMetadata when it was the last one', async () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'svcrm-'));
        fs.cpSync(fixtureProject, project, { recursive: true });
        const projectPath = path.join(project, 'PayLoop.csproj');

        await removeServiceReference(projectPath, path.join(project, 'Connected Services', 'CardOperations'));

        expect(fs.existsSync(path.join(project, 'Connected Services'))).toBe(false);
        expect(fs.readFileSync(projectPath, 'utf8')).not.toContain('WCFMetadata');
        fs.rmSync(project, { recursive: true });
    });
});
```

- [ ] **Step 2: Run it, expect FAIL** (module not found)

Run: `npx jest src/test/unit/services/serviceReferences/serviceReferenceGenerator.test.ts`

- [ ] **Step 3: Implement `serviceReferenceGenerator.ts`**

```ts
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ProjectFileEditor } from '../../parsers/projectFileEditor';
import {
    CONNECTED_SERVICES, isUrl, metadataFileName, requiredPackages, serializeServiceReference, ServiceReference,
    SVCUTIL_PARAMS_FILE, toSvcutilParams,
} from './connectedService';
import { ProcessResult } from './svcutil';

/** Runs dotnet-svcutil with `args` in `cwd` (the project directory) */
export type Svcutil = (args: string[], cwd: string) => Promise<ProcessResult>;

export interface GenerateOptions {
    readonly projectPath: string;
    /** Existing reference, or a new one from `newServiceReference` */
    readonly reference: ServiceReference;
    /** The project's target framework the client is generated for */
    readonly targetFramework: string;
    readonly svcutil: Svcutil;
    /** Adds the latest stable version of a package (`dotnet add package`) */
    readonly addPackage: (projectPath: string, packageId: string) => Promise<void>;
}

export type GenerateResult = { success: true; output: string } | { success: false; output: string };

/**
 * Generates the client in a temporary folder under obj/ and only on success replaces the reference's files.
 * svcutil's own project file edits (old 4.10.* packages) are undone; current packages are added instead.
 */
export async function generateServiceReference(options: GenerateOptions): Promise<GenerateResult> {
    const { projectPath, reference, targetFramework } = options;
    const projectDir = path.dirname(projectPath);
    const tempDir = path.join(projectDir, 'obj', `shinobi-svcutil-${crypto.randomBytes(4).toString('hex')}`);
    const projectXml = fs.readFileSync(projectPath, 'utf8');

    try {
        fs.mkdirSync(tempDir, { recursive: true });

        // Local inputs are copied next to the params file, as svcutil resolves them relative to it
        const localInputs = new Map<string, string>();
        const inputs = reference.options.inputs.map(input => {
            if (isUrl(input)) {
                return input;
            }
            const source = path.resolve(reference.folder, input);
            const name = path.basename(source);
            fs.copyFileSync(source, path.join(tempDir, name));
            localInputs.set(name, source);
            return name;
        });
        fs.writeFileSync(path.join(tempDir, SVCUTIL_PARAMS_FILE), toSvcutilParams({ ...reference.options, inputs }, targetFramework));

        const result = await options.svcutil(['--update', path.relative(projectDir, tempDir), '--noLogo'], projectDir);
        fs.writeFileSync(projectPath, projectXml);

        const outputFile = reference.options.outputFile ?? 'Reference.cs';
        if (result.code !== 0 || !fs.existsSync(path.join(tempDir, outputFile))) {
            return { success: false, output: result.output };
        }

        fs.mkdirSync(reference.folder, { recursive: true });
        fs.copyFileSync(path.join(tempDir, outputFile), path.join(reference.folder, outputFile));
        for (const [name, source] of localInputs) {
            const target = path.join(reference.folder, name);
            if (path.resolve(source) !== path.resolve(target)) {
                fs.copyFileSync(source, target);
            }
        }

        // Inputs as the reference had them; everything else as svcutil used it
        const used = JSON.parse(fs.readFileSync(path.join(tempDir, SVCUTIL_PARAMS_FILE), 'utf8')).options;
        const updated: ServiceReference = {
            ...reference,
            options: { ...used, inputs: reference.options.inputs.map(input => isUrl(input) ? input : path.basename(input)) },
        };
        fs.writeFileSync(path.join(reference.folder, metadataFileName(updated.format)), serializeServiceReference(updated));
        if (updated.format === 'visualStudio') {
            fs.rmSync(path.join(reference.folder, SVCUTIL_PARAMS_FILE), { force: true });
        }

        fs.writeFileSync(projectPath, ProjectFileEditor.ensureWcfMetadata(projectXml));
        const code = fs.readFileSync(path.join(reference.folder, outputFile), 'utf8');
        for (const id of requiredPackages(code, projectXml, targetFramework)) {
            await options.addPackage(projectPath, id);
        }
        return { success: true, output: result.output };
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

/** Deletes the reference folder; the last one also takes `Connected Services` and the WCFMetadata item */
export async function removeServiceReference(projectPath: string, folder: string): Promise<void> {
    fs.rmSync(folder, { recursive: true, force: true });
    const connectedServices = path.join(path.dirname(projectPath), CONNECTED_SERVICES);
    if (fs.existsSync(connectedServices) && fs.readdirSync(connectedServices).length === 0) {
        fs.rmdirSync(connectedServices);
        fs.writeFileSync(projectPath, ProjectFileEditor.removeWcfMetadata(fs.readFileSync(projectPath, 'utf8')));
    }
}
```

Note the new-reference case: `newServiceReference` stores the absolute WSDL path in `inputs`; the metadata written back contains only the file name (`path.basename`) because the file is copied into the folder.

- [ ] **Step 4: Run the unit test, expect PASS.**

- [ ] **Step 5: Write the integration test with the real tool**

```ts
// Runs the real dotnet-svcutil on the CardOperations WSDL; skipped when it isn't installed
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { generateServiceReference } from '../../../../services/serviceReferences/serviceReferenceGenerator';
import { readServiceReference } from '../../../../services/serviceReferences/connectedService';
import { findSvcutil, runSvcutil } from '../../../../services/serviceReferences/svcutil';

const fixtureProject = path.join(__dirname, '../../../../__fixtures__/service-references/PayLoop');
const hasDotnet = spawnSync('dotnet', ['--version']).status === 0;

describe('dotnet-svcutil integration', () => {
    jest.setTimeout(120000);

    it('regenerates the PayLoop reference for net10.0 like Visual Studio would', async () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'svcint-'));
        fs.cpSync(fixtureProject, project, { recursive: true });
        const install = hasDotnet ? await findSvcutil(project) : undefined;
        if (!install) {
            console.warn('dotnet-svcutil not installed, skipping');
            return;
        }
        const projectPath = path.join(project, 'PayLoop.csproj');
        fs.writeFileSync(projectPath, fs.readFileSync(projectPath, 'utf8').replace('net471', 'net10.0'));
        const folder = path.join(project, 'Connected Services', 'CardOperations');

        const result = await generateServiceReference({
            projectPath, reference: readServiceReference(folder), targetFramework: 'net10.0',
            svcutil: (args, cwd) => runSvcutil(install, args, cwd), addPackage: async () => { },
        });

        expect(result).toMatchObject({ success: true });
        const code = fs.readFileSync(path.join(folder, 'Reference.cs'), 'utf8');
        expect(code).toContain('namespace CardOperations');
        expect(code).toContain('public partial class CardOperationsSoapClient');
        expect(code).toContain('[System.ServiceModel.MessageContractAttribute(IsWrapped=false)]');
        expect(code).toContain('CardOperationsSoap12,');
        expect(fs.readFileSync(projectPath, 'utf8')).not.toContain('4.10');
        fs.rmSync(project, { recursive: true });
    });
});
```

- [ ] **Step 6: Run it.** With svcutil not installed it passes with a warning. To exercise it: `dotnet tool install --global dotnet-svcutil`, run `npx jest serviceReferenceGenerator.svcutil`, expect PASS.

- [ ] **Step 7: Commit** `git add -A && git commit -m "generate, update and remove service references with dotnet-svcutil"`

---

### Task 5: Context menus and folder context values

**Files:**
- Modify: `src/core/Project.ts` (`getRootChildren`, `getFolderChildren`)
- Modify: `src/core/contextMenus.ts`, `src/types/commands/project-action.ts`
- Test: `src/test/unit/core/contextMenus.test.ts` (add a case), `npm run generate:menus`

- [ ] **Step 1: Add the failing menu test** to `contextMenus.test.ts`:

```ts
    it('offers service reference actions on projects, Connected Services and reference folders', () => {
        const { webviewContext } = buildMenuContributions();
        const when = (command: string) => webviewContext.filter(e => e.command === `shinobi.solutionExplorer.${command}`).map(e => e.when);
        expect(when('addServiceReference')).toEqual(expect.arrayContaining([
            expect.stringContaining("nodeType == 'project'"),
            expect.stringContaining("contextValue == 'connectedServices'"),
        ]));
        expect(when('updateServiceReference')).toEqual([expect.stringContaining("nodeType == 'folder' && contextValue == 'serviceReference'")]);
        expect(when('removeServiceReference')).toEqual([expect.stringContaining("contextValue == 'serviceReference'")]);
    });
```

(Import `buildMenuContributions` if the file doesn't yet.)

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement.**

`project-action.ts`, next to the other action types, and add all three to the `ProjectActionCmd` union:

```ts
export declare type AddServiceReferenceActionCmd = {
    readonly action: 'addServiceReference';
    readonly nodeId: NodeIdString;
}

export declare type UpdateServiceReferenceActionCmd = {
    readonly action: 'updateServiceReference';
    readonly nodeId: NodeIdString;
}

export declare type RemoveServiceReferenceActionCmd = {
    readonly action: 'removeServiceReference';
    readonly nodeId: NodeIdString;
}
```

`contextMenus.ts` `menuCommands`:

```ts
    addServiceReference: { title: 'Add Service Reference...' },
    updateServiceReference: { title: 'Update Service Reference' },
    removeServiceReference: { title: 'Remove Service Reference' },
```

`contextMenus` — project: `['addFile', 'addFolder', 'addServiceReference'],`; new entries:

```ts
    'folder.connectedServices': [
        ['addServiceReference'],
    ],
    'folder.serviceReference': [
        ['updateServiceReference', 'removeServiceReference'],
    ],
```

`Project.ts`: in `getRootChildren` and `getFolderChildren`, set `contextValue: child.type === 'folder' ? serviceFolderKind(path.dirname(this._projectPath), child.path) : undefined` on folder items (both the Properties special case and the loop). Import `serviceFolderKind` from `../services/serviceReferences/connectedService`.

Run `npm run generate:menus`.

- [ ] **Step 4: Run** `npx jest src/test/unit/core && npm run typecheck` — PASS (typecheck fails until Task 6 handles the new actions only if the action switch is exhaustive; if so, continue with Task 6 before committing).

- [ ] **Step 5: Commit** `git add -A && git commit -m "context menu entries for service references"`

---

### Task 6: UI glue and action routing

**Files:**
- Create: `src/services/serviceReferences/serviceReferenceService.ts`
- Modify: `src/services/solutionActionService.ts`

- [ ] **Step 1: Implement `serviceReferenceService.ts`**

```ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../core/logger';
import { SolutionService } from '../solutionService';
import { DebugConfigService } from '../debugConfigService';
import { PackageOperationsService } from '../nuget/packageOperationsService';
import {
    CONNECTED_SERVICES, isValidReferenceName, newServiceReference, readServiceReference, ServiceReference, suggestReferenceName,
} from './connectedService';
import { findSvcutil, installSvcutil, runSvcutil, SvcutilInstall } from './svcutil';
import { generateServiceReference, removeServiceReference } from './serviceReferenceGenerator';

const log = logger('ServiceReferences');

let output: vscode.OutputChannel | undefined;
function outputChannel(): vscode.OutputChannel {
    return output ??= vscode.window.createOutputChannel('Shinobi .NET: Service References');
}

/** The project a node path belongs to: the project itself, its Connected Services folder or a reference folder */
function projectFor(nodePath: string): string | undefined {
    const projects = [...(SolutionService.getActiveSolution()?.projects.keys() ?? [])];
    if (projects.includes(nodePath)) {
        return nodePath;
    }
    const dir = path.basename(nodePath) === CONNECTED_SERVICES ? path.dirname(nodePath) : path.dirname(path.dirname(nodePath));
    return projects.find(project => path.dirname(project) === dir);
}

async function targetFramework(projectPath: string): Promise<string | undefined> {
    return (await DebugConfigService.extractTargetFrameworks(projectPath))[0];
}

/** The installed tool, or the user's choice to install it */
async function ensureSvcutil(projectDir: string): Promise<SvcutilInstall | undefined> {
    const found = await findSvcutil(projectDir);
    if (found) {
        return found;
    }
    const local = 'Install for this Repository';
    const global = 'Install Globally';
    const choice = await vscode.window.showWarningMessage(
        'Service references need dotnet-svcutil. Installing it for the repository adds it to .config/dotnet-tools.json, so the whole team gets the same version.',
        { modal: true }, local, global);
    if (!choice) {
        return undefined;
    }
    const install: SvcutilInstall = choice === local ? 'local' : 'global';
    const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? projectDir;
    const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Installing dotnet-svcutil...' },
        () => installSvcutil(install, workspaceDir));
    outputChannel().appendLine(result.output);
    if (result.code !== 0) {
        void showFailure('Installing dotnet-svcutil failed.');
        return undefined;
    }
    return install;
}

async function showFailure(message: string): Promise<void> {
    if (await vscode.window.showErrorMessage(message, 'Show Output') === 'Show Output') {
        outputChannel().show();
    }
}

async function generate(projectPath: string, reference: ServiceReference, verb: 'Adding' | 'Updating'): Promise<void> {
    const framework = await targetFramework(projectPath);
    if (!framework) {
        vscode.window.showErrorMessage(`Could not determine the target framework of ${path.basename(projectPath)}.`);
        return;
    }
    const install = await ensureSvcutil(path.dirname(projectPath));
    if (!install) {
        return;
    }
    outputChannel().appendLine(`${verb} ${reference.name} for ${framework}...`);
    const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `${verb} service reference ${reference.name}...` },
        () => generateServiceReference({
            projectPath, reference, targetFramework: framework,
            svcutil: (args, cwd) => runSvcutil(install, args, cwd),
            addPackage: async (project, packageId) => {
                const added = await PackageOperationsService.installPackage({ projectPath: project, packageId });
                outputChannel().appendLine(added.message);
            },
        }));
    outputChannel().appendLine(result.output);
    if (!result.success) {
        void showFailure(`${verb} service reference ${reference.name} failed.`);
        return;
    }
    vscode.window.showInformationMessage(`Service reference ${reference.name} ${verb === 'Adding' ? 'added' : 'updated'}.`);
}

export async function addServiceReference(nodePath: string): Promise<void> {
    const projectPath = projectFor(nodePath);
    if (!projectPath) {
        return;
    }
    const url = 'Enter URL...';
    const file = 'Browse for WSDL File...';
    const source = await vscode.window.showQuickPick([url, file], { placeHolder: 'Where is the service description (WSDL)?' });
    let input: string | undefined;
    if (source === url) {
        input = await vscode.window.showInputBox({
            prompt: 'Address of the WSDL, e.g. https://example.com/Service.svc?wsdl', ignoreFocusOut: true,
            validateInput: value => /^https?:\/\/\S+$/i.test(value.trim()) ? undefined : 'Enter an http(s) URL',
        });
    } else if (source === file) {
        const picked = await vscode.window.showOpenDialog({
            canSelectMany: false, openLabel: 'Add Service Reference',
            filters: { 'Service descriptions': ['wsdl', 'xml'], 'All files': ['*'] },
        });
        input = picked?.[0]?.fsPath;
    }
    if (!input) {
        return;
    }
    input = input.trim();

    const connectedServices = path.join(path.dirname(projectPath), CONNECTED_SERVICES);
    const existing = fs.existsSync(connectedServices) ? fs.readdirSync(connectedServices) : [];
    const name = await vscode.window.showInputBox({
        prompt: 'Service reference name (folder under Connected Services)', value: suggestReferenceName(input, existing), ignoreFocusOut: true,
        validateInput: value => !isValidReferenceName(value) ? 'Use letters, digits, _ and .' : existing.includes(value) ? `${value} already exists` : undefined,
    });
    if (!name) {
        return;
    }
    const namespace = await vscode.window.showInputBox({
        prompt: 'Namespace for the generated code', value: name, ignoreFocusOut: true,
        validateInput: value => isValidReferenceName(value) ? undefined : 'Not a valid namespace',
    });
    if (!namespace) {
        return;
    }
    const framework = await targetFramework(projectPath) ?? 'net10.0';
    await generate(projectPath, newServiceReference(path.join(connectedServices, name), input, namespace, framework), 'Adding');
}

export async function updateServiceReference(folder: string): Promise<void> {
    const projectPath = projectFor(folder);
    if (!projectPath) {
        return;
    }
    let reference: ServiceReference;
    try {
        reference = readServiceReference(folder);
    } catch (error) {
        log.error('Cannot read service reference:', error);
        vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        return;
    }
    await generate(projectPath, reference, 'Updating');
}

export async function removeServiceReferenceWithConfirmation(folder: string): Promise<void> {
    const projectPath = projectFor(folder);
    if (!projectPath) {
        return;
    }
    const answer = await vscode.window.showWarningMessage(
        `Remove the service reference '${path.basename(folder)}'? Its folder is deleted; packages stay.`, { modal: true }, 'Remove');
    if (answer === 'Remove') {
        await removeServiceReference(projectPath, folder);
    }
}
```

- [ ] **Step 2: Route the actions** in `SolutionActionService`'s switch (next to `setStartupProject`), importing the three functions:

```ts
            case 'addServiceReference':
                await addServiceReference(nodeId.path);
                break;

            case 'updateServiceReference':
                await updateServiceReference(nodeId.path);
                break;

            case 'removeServiceReference':
                await removeServiceReferenceWithConfirmation(nodeId.path);
                break;
```

- [ ] **Step 3: Verify** `npm run typecheck && npx jest && npm run build:dev` — all green.

- [ ] **Step 4: Commit** `git add -A && git commit -m "add, update and remove service references from the Solution Explorer"`

---

### Task 7: Reference project and README

**Files:**
- Create (outside the repo, not committed): `/home/hempe/git/ApiDotNetTestProject/SoapClient/` console project
- Modify: `README.md`

- [ ] **Step 1: Create the manual test project**

```bash
cd /home/hempe/git/ApiDotNetTestProject
dotnet new console -n SoapClient -f net10.0 -o SoapClient
mkdir -p SoapClient/wsdl
cp "/home/hempe/git/vscode-dot-studio/src/__fixtures__/service-references/PayLoop/Connected Services/CardOperations/CardOperations.wsdl" SoapClient/wsdl/
dotnet sln ApiDotNetTestProject.slnx add SoapClient/SoapClient.csproj
```

`SoapClient/Program.cs`:

```csharp
// Add the service reference first: right-click SoapClient > Add Service Reference... > Browse for WSDL File... > wsdl/CardOperations.wsdl
var client = new CardOperations.CardOperationsSoapClient(CardOperations.CardOperationsSoapClient.EndpointConfiguration.CardOperationsSoap);
Console.WriteLine($"Client for {client.Endpoint.Address}");
```

- [ ] **Step 2: README** — Phase 4: tick the four items, rewording to what was built:

```markdown
- [x] "Add Service Reference…" on a project or its Connected Services folder: WSDL URL or file, name, namespace
- [x] Generate the client into `Connected Services/<Name>/` (Visual Studio's `ConnectedService.json`, `WCFMetadata` item) and add the current `System.ServiceModel.Http`/`Primitives` packages
- [x] "Update Service Reference" and "Remove Service Reference" on the reference folder, also for references Visual Studio created; updating regenerates for the project's current target framework
- [x] Detect a missing `dotnet-svcutil` and offer to install it for the repository (tool manifest) or globally
```

Add under Current Features a "Connected Services (SOAP)" section with the same three bullets, and to Known Issues: `- [ ] Updating a reference Visual Studio created changes the generator version in every generated type of Reference.cs (svcutil 8.0.0 instead of Visual Studio's 2.0.2)`.

- [ ] **Step 3: Commit and push** `git add README.md && git commit -m "README: service references" && git push`

---

## Self-Review

- Spec §1 (menus, folder kinds) → Tasks 2, 5. §2 (Add inputs, defaults) → Tasks 2, 6. §3 (one code path: temp folder, restore, copy, metadata format, WCFMetadata, packages, cleanup) → Tasks 1, 4. §4 (Remove) → Task 4/6. §5 (tool detection/install) → Tasks 3, 6. §6 (errors: failing run keeps files, malformed metadata) → Tasks 2, 4, 6. §7 (tests: mapping, folders, packages, names, integration, manual) → Tasks 2–4, 7.
- Names used consistently: `serviceFolderKind`, `readServiceReference`, `serializeServiceReference`, `newServiceReference`, `toSvcutilParams`, `requiredPackages`, `generateServiceReference`, `removeServiceReference`, `Svcutil`, `runSvcutil`, `findSvcutil`, `installSvcutil`, `svcutilCommand`, `listsSvcutil`, `SVCUTIL_ENV`.
