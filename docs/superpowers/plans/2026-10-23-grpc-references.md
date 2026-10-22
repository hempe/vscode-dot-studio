# gRPC References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add, update and remove gRPC references (`.proto` files, `<Protobuf>` items) from the Solution Explorer, like Visual Studio's "Add Connected Service > gRPC" and `dotnet-grpc`, without that tool: Add Service Reference asks WCF or gRPC first, gRPC references show in Connected Services (one node per `.proto`), Update re-downloads references added from a URL, Remove takes the item out and keeps the file.

**Architecture:** The project evaluation that already runs once per project (`ProjectItemsService`, `Protobuf` is in `ITEM_TYPES` since Phase 19) also keeps each `Protobuf` item's `GrpcServices`, `Link`, `SourceUrl` and defining file (`ProjectItems.protobuf`). A pure `services/grpc/protobufReferences.ts` writes and removes the `<Protobuf>` element as text edits in the style of `ProjectFileEditor` (formatting, comments, CRLF kept), knows the package set per kind of reference and project (the `dotnet-grpc` rules, minus packages a referenced one already brings) and marks Grpc.Tools as a development dependency. The host side `services/grpc/grpcReferenceService.ts` (pickers, native modals, progress, output, download, packages through the CPM-aware `changePackageVersions` of Phase 20) is reached through a type picker at the start of `addServiceReference`, which leaves the WCF flow as it is. The tree gets two node types: `grpcReference` (one per item) and `connectedServices` (a Connected Services node for projects without that folder on disk); a `Connected Services` folder on disk lists the gRPC references after its own folders.

**Tech Stack:** TypeScript (strict, `noUnusedLocals`/`noUnusedParameters`), VS Code extension API, React webview (icons only), Jest (`jsdom`), `dotnet msbuild -getItem`, Node `http`/`https`.

Spec: `docs/superpowers/specs/2026-10-23-grpc-references-design.md`.

**Verified with the .NET SDK 10.0.111 and `dotnet-grpc` 2.84.0 while planning** (`dotnet tool install --tool-path /tmp/grpctool dotnet-grpc`, scratch projects under `/tmp/grpcplan`):
- `dotnet-grpc add-file ../shared/greet.proto` in a console project writes `<Protobuf Include="..\shared\greet.proto" GrpcServices="Client" Link="Protos\greet.proto" />` in an ItemGroup of its own; `Link` is an **attribute** (`Protos\<file name>`), only for files outside the project folder (`add-file Contracts/my greet.proto` writes `<Protobuf Include="Contracts\my greet.proto" GrpcServices="Client" />`). Include is relative with backslashes.
- In a web project (`Microsoft.NET.Sdk.Web`) the default is Both and the attribute is left out: `<Protobuf Include="..\shared\greet.proto" Link="Protos\greet.proto" />`; `-s Both` in a console project also leaves it out. `-s Server`/`-s None` write `GrpcServices="Server"`/`"None"`.
- `dotnet-grpc add-url <url> -o Protos/greet.proto` downloads the file and writes `SourceUrl` as a **child element**: `<Protobuf Include="Protos\greet.proto" GrpcServices="Client">` / `<SourceUrl>https://...</SourceUrl>` / `</Protobuf>`. Adding the same file twice is silently ignored by the tool (we refuse with a message).
- Packages `dotnet-grpc` adds: Client in a console project: `Google.Protobuf`, `Grpc.Net.ClientFactory`, `Grpc.Tools` (`PrivateAssets="All"`); Client in a web project: `Google.Protobuf`, `Grpc.AspNetCore.Server.ClientFactory`, `Grpc.Tools`; Server or Both (any project): `Grpc.AspNetCore`; None: `Google.Protobuf`, `Grpc.Tools`. It adds them even when `Grpc.AspNetCore` (which depends on `Google.Protobuf`, `Grpc.Tools` and `Grpc.AspNetCore.Server.ClientFactory`, see its nuspec) is already referenced, and it writes old versions (`Google.Protobuf 3.13.0`, `Grpc.Tools 2.32.0`); `Grpc.Net.ClientFactory` depends on `Grpc.Net.Client`.
- `dotnet add package Grpc.Tools` (a `developmentDependency` package) writes `<IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>` and `<PrivateAssets>all</PrivateAssets>` as child elements; the CPM edits of Phase 20 (`addPackageReference`) write a bare `<PackageReference Include="Grpc.Tools" />`, so the extension adds those two elements afterwards.
- `dotnet msbuild -getItem:Protobuf` before any restore reports `Identity`, `FullPath`, `Link`, `GrpcServices` and `SourceUrl` exactly as written (no `GrpcServices` when the item has none) and `DefiningProjectFullPath`; after the restore Grpc.Tools' item definitions add `GrpcServices: "Both"` (the default), `Access`, `ProtoRoot`, `CompileOutputs`. `Identity` and `Link` come back with `/` or `\` depending on the item (`../shared/greet.proto`, `Protos\remote.proto`).
- A console project with the `Protobuf` item (linked), `Google.Protobuf 3.30.2`, `Grpc.Net.ClientFactory 2.71.0` and `Grpc.Tools 2.71.0` builds (4 s with the NuGet cache) and Grpc.Tools writes `obj/Debug/<tfm>/Greet.cs` and `GreetGrpc.cs` with `Greeter.GreeterClient`; `new GrpcGreeter.Greeter.GreeterClient(GrpcChannel.ForAddress(...))` compiles.
- Every code block of Tasks 1–5 was written into a scratch copy of the repository (`git archive HEAD`, `node_modules` linked) and run there: `npm run typecheck` clean, the full Jest suite green (156 suites, 1325 tests, the real-MSBuild and real-build tests included), `npm run generate:menus` then the menu tests green, `npm run build:dev` exit 0. The GIF scene (Task 5) was not run (no display in the planning session).

**Decisions on the open points of the spec:**
- **Node types:** a new node type `grpcReference` (id `{ type, path: <the .proto>, project }`; `path` is the file, so Open and double-click reuse `openFile`), not the `folder.serviceReference` family: a reference is a file-like leaf, and a `folder`/`file` node would bring the folder or file menu (Rename, Delete, Copy...) which must not touch the `.proto`. A second new type `connectedServices` (id `{ type, path: <project> }`) is the Connected Services node of a project with gRPC references and no `Connected Services` folder shown from disk (Visual Studio shows the node without a folder; creating an empty folder would not survive git). Its menu is only Add Service Reference. A `Connected Services` folder on disk (WCF references) stays a `folder` node and lists the gRPC references after its folders. Children of `connectedServices` come through the same hook as analyzers and packages (`grpcChildren` next to `analyzerChildren ?? packageChildren`), so expanding, restoring the expansion and refreshing need no new branches.
- **SourceUrl:** written as a child element `<SourceUrl>` (what `dotnet-grpc add-url` writes, see above; the spec's "attribute" was wrong), read from the MSBuild evaluation (`ProtobufItem.sourceUrl`), which also reads an attribute form. Update only shows on references with a `SourceUrl` (context value `url`).
- **Web project detection:** `isWebProject` of `parsers/projectKind.ts` (the project file's `Sdk="Microsoft.NET.Sdk.Web"` or `<Sdk Name=...>`), already used for launch settings: it decides the preselected kind (Both / Client) and the client factory package.
- **Type picker:** `addServiceReference` (the existing command) asks "WCF Web Service" / "gRPC" first; gRPC calls `addGrpcReference(projectPath)`, WCF calls the old body, renamed `addWcfServiceReference` and otherwise unchanged. There is no `addGrpcReference` menu command (a command in no menu would fail the "every command is used by a menu" test).
- **Packages:** Client takes `Grpc.Net.ClientFactory` (what `dotnet-grpc` and Visual Studio add; it brings `Grpc.Net.Client` and `AddGrpcClient`), not `Grpc.Net.Client` as the spec said; Client in a web project takes `Grpc.AspNetCore.Server.ClientFactory`; Server or Both `Grpc.AspNetCore`. Packages already referenced, or brought by one that is (`Grpc.AspNetCore`), are left out. Versions: the newest stable version on the configured package sources (`PackageBrowseService.getPackageDetails` + `VersionUtils.findLatest`), installed with `changePackageVersions` (CPM: `PackageVersion` + bare `PackageReference`; otherwise `dotnet add package --version`).
- **The kinds offered:** Client, Server, Both (the spec); `None` (messages only) exists in the type and the package rules for references written by hand, not in the picker.
- **Add with a URL:** the file goes to `Protos/<last URL segment>` (`.proto` appended when missing); an existing file with other content is replaced only after a modal; with the same content it is just referenced.
- **Duplicates:** the same file again is refused ("greet.proto is already a gRPC reference of Client."), and so is a second outside file with the same name (both would be linked as `Protos\greet.proto`).
- **Remove:** only a `<Protobuf>` element of the project file that lists exactly that file is removed (block form with `SourceUrl` included, its ItemGroup when left empty); a file a wildcard includes (`Contracts\*.proto`) or an item from a props file is refused with a message naming where it comes from.
- **Output:** gRPC uses the existing "Service References" output channel; its two helpers move from `serviceReferenceService.ts` into `serviceReferences/output.ts` (no behaviour change), so the gRPC service does not import the WCF service (which imports it for the picker).

**Conventions to follow (from CLAUDE.md and the memory notes):**
- Tests: `npx jest <path>`; the full suite is `npm test`; `npm run typecheck` before each commit. `noUnusedLocals`/`noUnusedParameters` break the build.
- `npm run build:dev` builds two configurations: judge it by its exit code (`; echo "exit $?"`), not by its output.
- Extension-host tests mock `vscode` per file with `jest.mock('vscode', () => ({ … }), { virtual: true })`; tests with a real `Project` stub `ProjectItemsService.instance.evaluate` and `get` (as `src/test/unit/core/Project.items.test.ts`).
- Real-MSBuild tests are skipped without `dotnet` (`spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip`), with a 150 s timeout; the real build test also returns early (with a warning) when the restore fails because nuget.org is unreachable (`NU1301`). CI has the .NET 8 and 10 SDKs and network.
- Windows is a CI gate: build paths in tests with `path.join`/`path.resolve`; file contents (project XML) stay literal text with `\`.
- Webview code must not import `vscode`, Node modules or `nodeIdService`, and must not decode node ids: the webview only compares `node.type` (`'grpcReference'`, `'connectedServices'`) for icons, double-click and Enter.
- After editing `src/core/contextMenus.ts` run `npm run generate:menus` (package.json and `docs/context-menus.md`; tests fail when they are out of date).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Commit to `master`, push after the last task. `git add` only the files of the task, by path.
- Every task that changes what a user sees has its own docs step (docs page, manual-testing entries, GIF scene where it shows), in the same commit.

---

## File structure

| File | Responsibility |
|---|---|
| `src/__fixtures__/grpc/` (create, Task 1) | `Grpc.slnx`; `shared/greet.proto` (outside every project); `Client/` (console, no references); `Web/` (web SDK, no references); `Consumer/` (a linked reference, a URL reference with `SourceUrl`, a wildcard `Contracts\*.proto`) |
| `src/services/projectItems/projectItems.ts` (modify) | `ProtobufItem`; `ProjectItems.protobuf`; `parseMsbuildItems` keeps the metadata; `equals` compares it |
| `src/parsers/projectFileEditor.ts` (modify) | `indentUnit` becomes usable by the gRPC edits |
| `src/services/grpc/protobufReferences.ts` (create) | pure: `protobufReferenceFor`, `addProtobufReference`, `removeProtobufReference`, `duplicateRefusal`, `grpcPackages`, `ensureDevelopmentDependency`, `defaultGrpcServices`, `servicesOf`, `referenceLabel`, `protoFileName`, `contentHash`, `notListedMessage` |
| `src/services/nodeIdService.ts` (modify) | `ConnectedServicesNodeId`, `GrpcReferenceNodeId` and their generators |
| `src/services/grpc/grpcNodes.ts` (create) | `grpcReferenceNodes(projectPath)`, `grpcChildren(node)` |
| `src/core/Project.ts` (modify) | Connected Services node at the top when needed; the folder on disk lists the references |
| `src/services/solutionExpansionService.ts` (modify) | `grpcChildren` in the children hook; refresh of an expanded `connectedServices` node |
| `src/core/contextMenus.ts` (modify) | `GRPC_URL_REFERENCE`; menus of `connectedServices` and `grpcReference`; commands `updateGrpcReference`, `removeGrpcReference`; new Add Service Reference description |
| `src/webview/solution-view/components/TreeNode/TreeNode.tsx`, `SolutionTree.tsx` (modify) | icons; double-click and Enter open the `.proto` |
| `src/services/serviceReferences/output.ts` (create) | the Service References output channel and the error with Show Output (moved) |
| `src/services/serviceReferences/serviceReferenceService.ts` (modify) | the WCF / gRPC picker; the old body as `addWcfServiceReference` |
| `src/services/grpc/download.ts` (create) | `download(url)` over http(s) with redirects and a timeout |
| `src/services/grpc/grpcReferenceService.ts` (create) | `GrpcHost`, `addGrpcReference`, `updateGrpcReference`, `removeGrpcReference`, `vscodeGrpcHost` |
| `src/types/commands/project-action.ts`, `src/services/solutionActionService.ts` (modify) | the two actions and their routing |
| `package.json`, `docs/context-menus.md` (generated) | menus |
| `docs/connected-services.md`, `docs/manual-testing.md`, `scripts/screenshots/capture.sh`, `docs/images/grpc.gif`, `docs/roadmap.md`, `docs/history.md`, `README.md`, `docs/README.md` (modify/create) | docs |

Tests (create): `src/test/unit/services/grpc/protobufReferences.test.ts`, `protobufReferences.msbuild.test.ts`, `grpcNodes.test.ts`, `grpcReferenceService.test.ts`, `grpcReferenceUpdate.test.ts`, `download.test.ts`, `src/test/unit/services/serviceReferences/serviceReferenceService.test.ts`; extend `src/test/unit/services/projectItems/projectItems.test.ts`, `projectItems.msbuild.test.ts`, `src/test/unit/core/contextMenus.test.ts`.

---

### Task 1: Fixtures, and the Protobuf metadata in the project evaluation

**Files:**
- Create: `src/__fixtures__/grpc/Grpc.slnx`, `src/__fixtures__/grpc/shared/greet.proto`, `src/__fixtures__/grpc/Client/Client.csproj`, `src/__fixtures__/grpc/Client/Program.cs`, `src/__fixtures__/grpc/Web/Web.csproj`, `src/__fixtures__/grpc/Web/Program.cs`, `src/__fixtures__/grpc/Consumer/Consumer.csproj`, `src/__fixtures__/grpc/Consumer/Protos/remote.proto`, `src/__fixtures__/grpc/Consumer/Contracts/money.proto`
- Modify: `src/services/projectItems/projectItems.ts`
- Test: `src/test/unit/services/projectItems/projectItems.test.ts`, `src/test/unit/services/projectItems/projectItems.msbuild.test.ts` (extend)

**Fixtures needed** (used by Tasks 2–5 and the manual checks): `Client` (a console project without references: Add, the real build test), `Web` (web SDK: the Both default and `Grpc.AspNetCore`), `shared/greet.proto` outside every project (the `Link`), `Consumer` with one reference of each kind (linked file, URL with `SourceUrl`, wildcard) for the tree, Update and Remove. `Consumer/Protos/remote.proto` differs from the file at its `SourceUrl` on purpose (Update replaces it). The projects target `net8.0` (CI has the .NET 8 and 10 SDKs).

- [ ] **Step 1: Create the fixtures**

`src/__fixtures__/grpc/Grpc.slnx`:
```xml
<Solution>
  <Project Path="Client/Client.csproj" />
  <Project Path="Consumer/Consumer.csproj" />
  <Project Path="Web/Web.csproj" />
</Solution>
```

`src/__fixtures__/grpc/shared/greet.proto`:
```proto
syntax = "proto3";

option csharp_namespace = "GrpcGreeter";

package greet;

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply);
}

message HelloRequest {
  string name = 1;
}

message HelloReply {
  string message = 1;
}
```

`src/__fixtures__/grpc/Client/Client.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>

</Project>
```

`src/__fixtures__/grpc/Client/Program.cs`:
```csharp
Console.WriteLine("Client");
```

`src/__fixtures__/grpc/Web/Web.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>

</Project>
```

`src/__fixtures__/grpc/Web/Program.cs`:
```csharp
var app = WebApplication.CreateBuilder(args).Build();
app.MapGet("/", () => "Web");
app.Run();
```

`src/__fixtures__/grpc/Consumer/Consumer.csproj`:
```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>

  <ItemGroup>
    <Protobuf Include="..\shared\greet.proto" GrpcServices="Client" Link="Protos\greet.proto" />
    <Protobuf Include="Protos\remote.proto" GrpcServices="Client">
      <SourceUrl>https://raw.githubusercontent.com/grpc/grpc-dotnet/master/examples/Greeter/Proto/greet.proto</SourceUrl>
    </Protobuf>
    <Protobuf Include="Contracts\*.proto" GrpcServices="None" />
  </ItemGroup>

</Project>
```

`src/__fixtures__/grpc/Consumer/Protos/remote.proto` (the shared file with another package and namespace):
```bash
sed 's/package greet;/package remote;/; s/GrpcGreeter/GrpcRemote/' src/__fixtures__/grpc/shared/greet.proto > src/__fixtures__/grpc/Consumer/Protos/remote.proto
```

`src/__fixtures__/grpc/Consumer/Contracts/money.proto`:
```proto
syntax = "proto3";

option csharp_namespace = "Contracts";

package contracts;

message Money {
  string currency = 1;
  int64 units = 2;
}
```

Check: `dotnet msbuild src/__fixtures__/grpc/Consumer/Consumer.csproj -nologo -getItem:Protobuf | grep -E '"(Identity|GrpcServices|Link|SourceUrl)"'`
Expected: three items, `../shared/greet.proto` (Client, Link `Protos/greet.proto`), `Protos\remote.proto` (Client, the SourceUrl), `Contracts/money.proto` (None).

- [ ] **Step 2: Write the failing tests**

Append to `src/test/unit/services/projectItems/projectItems.test.ts`:
```ts

describe('Protobuf items (gRPC references)', () => {
    const proto = (item: object) => JSON.stringify({ Items: { Protobuf: [item] } });

    test('keep the metadata dotnet-grpc writes: GrpcServices, Link, SourceUrl, and where they are written', () => {
        const items = parseMsbuildItems(JSON.stringify({
            Items: {
                Protobuf: [
                    { Identity: '..\\shared\\greet.proto', FullPath: path.resolve('/work/shared/greet.proto'), GrpcServices: 'Client', Link: 'Protos\\greet.proto', DefiningProjectFullPath: at('App.csproj') },
                    { Identity: 'Protos/remote.proto', FullPath: at('Protos', 'remote.proto'), SourceUrl: 'https://example.com/remote.proto', GrpcServices: 'Both' },
                    { Identity: 'Protos/plain.proto', FullPath: at('Protos', 'plain.proto') },
                ],
            },
        }), dir)!;
        expect(items.protobuf).toEqual([
            { include: '..\\shared\\greet.proto', fullPath: path.resolve('/work/shared/greet.proto'), link: 'Protos\\greet.proto', grpcServices: 'Client', definedIn: at('App.csproj') },
            { include: 'Protos/remote.proto', fullPath: at('Protos', 'remote.proto'), grpcServices: 'Both', sourceUrl: 'https://example.com/remote.proto' },
            { include: 'Protos/plain.proto', fullPath: at('Protos', 'plain.proto') },
        ]);
        // Still files of the project: the linked one shows at its link path
        expect(items.linkedFilesIn(at('Protos')).map(item => item.fullPath)).toEqual([path.resolve('/work/shared/greet.proto')]);
    });

    test('other item types have no Protobuf entries; a project without any has an empty list', () => {
        expect(parseMsbuildItems(json, dir)!.protobuf).toEqual([]);
    });

    test('a change of the metadata alone makes a different list (the tree shows the new kind)', () => {
        const client = parseMsbuildItems(proto({ Identity: 'a.proto', FullPath: at('a.proto'), GrpcServices: 'Client' }), dir)!;
        const both = parseMsbuildItems(proto({ Identity: 'a.proto', FullPath: at('a.proto'), GrpcServices: 'Both' }), dir)!;
        const again = parseMsbuildItems(proto({ Identity: 'a.proto', FullPath: at('a.proto'), GrpcServices: 'Client' }), dir)!;
        expect(client.equals(both)).toBe(false);
        expect(client.equals(again)).toBe(true);
        const withUrl = parseMsbuildItems(proto({ Identity: 'a.proto', FullPath: at('a.proto'), GrpcServices: 'Client', SourceUrl: 'https://x/a.proto' }), dir)!;
        expect(client.equals(withUrl)).toBe(false);
    });
});
```

In `src/test/unit/services/projectItems/projectItems.msbuild.test.ts`, add this test as the last one of the `describe` (after the "100 changes while MSBuild runs" test, before the closing `});`):
```ts

    withDotnet('Protobuf items come with GrpcServices, Link and SourceUrl as written (before any restore)', async () => {
        fs.mkdirSync(path.join(root, 'shared'));
        fs.writeFileSync(path.join(root, 'shared', 'greet.proto'), '');
        const items = await evaluate(`<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <Protobuf Include="..\\shared\\greet.proto" GrpcServices="Client" Link="Protos\\greet.proto" />
    <Protobuf Include="Protos\\remote.proto">
      <SourceUrl>https://example.com/remote.proto</SourceUrl>
    </Protobuf>
  </ItemGroup>
</Project>
`, ['Protos/remote.proto']);
        expect(items.protobuf.map(item => ({ ...item, link: item.link?.replace(/[\\/]/g, '/') }))).toEqual([
            { include: expect.stringMatching(/^\.\.[\\/]shared[\\/]greet\.proto$/), fullPath: path.join(root, 'shared', 'greet.proto'), link: 'Protos/greet.proto', grpcServices: 'Client', definedIn: at('App.csproj') },
            // No Grpc.Tools restored: nothing defaults GrpcServices yet
            { include: expect.stringMatching(/^Protos[\\/]remote\.proto$/), fullPath: at('Protos', 'remote.proto'), sourceUrl: 'https://example.com/remote.proto', definedIn: at('App.csproj'), link: undefined },
        ]);
        expect(items.linkedFilesIn(at('Protos')).map(item => item.fullPath)).toEqual([path.join(root, 'shared', 'greet.proto')]);
    }, TIMEOUT);
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx jest src/test/unit/services/projectItems/projectItems.test.ts src/test/unit/services/projectItems/projectItems.msbuild.test.ts`
Expected: FAIL (TypeScript: `Property 'protobuf' does not exist on type 'ProjectItems'`).

- [ ] **Step 4: Implement in `src/services/projectItems/projectItems.ts`**

Before `interface Entry {` add:
```ts
/**
 * A `Protobuf` item (a gRPC reference, Connected Services) with the metadata `dotnet-grpc` writes. `grpcServices` is
 * what MSBuild evaluates: Grpc.Tools defaults it to `Both`, so it is undefined only before the package is restored
 * and when the item does not set it.
 */
export interface ProtobufItem {
    /** The `Include` as MSBuild reports it (slashes as written) */
    readonly include: string;
    readonly fullPath: string;
    readonly link?: string;
    readonly grpcServices?: string;
    readonly sourceUrl?: string;
    /** The file the item is written in (the project file, or a props file) */
    readonly definedIn?: string;
}

```

Replace the constructor's first lines
```ts
    constructor(readonly projectDir: string, entries: readonly Entry[]) {
        this.entries = entries;
```
with
```ts
    /** The project's `Protobuf` items in document order (the evaluation lists them once each) */
    readonly protobuf: readonly ProtobufItem[];

    constructor(readonly projectDir: string, entries: readonly Entry[], protobuf: readonly ProtobufItem[] = []) {
        this.entries = entries;
        this.protobuf = protobuf;
```

Replace `equals` with:
```ts
    /** Whether both list the same entries in the same order, and the same `Protobuf` items with the same metadata */
    equals(other: ProjectItems): boolean {
        return this.projectDir === other.projectDir && this.entries.length === other.entries.length
            && this.entries.every((entry, index) => {
                const theirs = other.entries[index];
                return entry.fullPath === theirs.fullPath && entry.virtualPath === theirs.virtualPath
                    && entry.itemType === theirs.itemType && entry.linked === theirs.linked;
            })
            && this.protobuf.length === other.protobuf.length
            && this.protobuf.every((item, index) => {
                const theirs = other.protobuf[index];
                return item.include === theirs.include && item.fullPath === theirs.fullPath && item.link === theirs.link
                    && item.grpcServices === theirs.grpcServices && item.sourceUrl === theirs.sourceUrl && item.definedIn === theirs.definedIn;
            });
    }
```

Replace `interface MsbuildItem { FullPath?: string; Identity?: string; Link?: string }` with:
```ts
interface MsbuildItem {
    FullPath?: string;
    Identity?: string;
    Link?: string;
    GrpcServices?: string;
    SourceUrl?: string;
    DefiningProjectFullPath?: string;
}
```

In `parseMsbuildItems`: after `const entries: Entry[] = [];` add `const protobuf: ProtobufItem[] = [];`; after the `entries.push({ ... });` call inside the inner loop add:
```ts
            if (itemType === 'Protobuf') {
                protobuf.push({
                    include: item.Identity ?? '',
                    fullPath: path.normalize(fullPath),
                    ...(item.Link?.trim() ? { link: item.Link.trim() } : {}),
                    ...(item.GrpcServices?.trim() ? { grpcServices: item.GrpcServices.trim() } : {}),
                    ...(item.SourceUrl?.trim() ? { sourceUrl: item.SourceUrl.trim() } : {}),
                    ...(item.DefiningProjectFullPath ? { definedIn: path.normalize(item.DefiningProjectFullPath) } : {}),
                });
            }
```
and change the final `return new ProjectItems(projectDir, entries);` to `return new ProjectItems(projectDir, entries, protobuf);`.

`runMsbuild` needs no change: `-getItem:` with `Protobuf` already prints every metadata of the item.

- [ ] **Step 5: Run to verify they pass**

Run: `npx jest src/test/unit/services/projectItems`
Expected: PASS (7 suites; with `dotnet` the new real-MSBuild test runs: `npx jest src/test/unit/services/projectItems/projectItems.msbuild.test.ts -t "Protobuf items come"` shows `1 passed`).

- [ ] **Step 6: Typecheck and commit**

No docs step: nothing a user sees changes yet.
```bash
npm run typecheck
git add src/__fixtures__/grpc src/services/projectItems/projectItems.ts src/test/unit/services/projectItems/projectItems.test.ts src/test/unit/services/projectItems/projectItems.msbuild.test.ts
git commit -m "gRPC references: Protobuf metadata in the project evaluation, fixtures

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Text edits of the project file and the package rules

**Files:**
- Modify: `src/parsers/projectFileEditor.ts`
- Create: `src/services/grpc/protobufReferences.ts`
- Test: `src/test/unit/services/grpc/protobufReferences.test.ts`, `src/test/unit/services/grpc/protobufReferences.msbuild.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/test/unit/services/grpc/protobufReferences.test.ts`:
```ts
import * as path from 'path';
import {
    addProtobufReference, contentHash, defaultGrpcServices, duplicateRefusal, ensureDevelopmentDependency, grpcPackages, notListedMessage,
    protobufReferenceFor, protoFileName, referenceLabel, removeProtobufReference,
} from '../../../../services/grpc/protobufReferences';

const root = path.resolve('/work');
const projectDir = path.join(root, 'Client');
const projectPath = path.join(projectDir, 'Client.csproj');

const project = `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>

</Project>
`;

const withReference = `<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>

  <ItemGroup>
    <Protobuf Include="..\\shared\\greet.proto" GrpcServices="Client" Link="Protos\\greet.proto" />
  </ItemGroup>

</Project>
`;

describe('protobufReferenceFor', () => {
    test('a file outside the project: relative Include with backslashes and a Link into Protos (as dotnet-grpc add-file)', () => {
        expect(protobufReferenceFor(projectDir, path.join(root, 'shared', 'greet.proto'), 'Client'))
            .toEqual({ include: '..\\shared\\greet.proto', link: 'Protos\\greet.proto', services: 'Client' });
    });

    test('a file inside the project: no Link', () => {
        expect(protobufReferenceFor(projectDir, path.join(projectDir, 'Contracts', 'orders.proto'), 'Server'))
            .toEqual({ include: 'Contracts\\orders.proto', services: 'Server' });
    });

    test('a downloaded file keeps its URL; MSBuild characters in names are escaped', () => {
        expect(protobufReferenceFor(projectDir, path.join(projectDir, 'Protos', 'a;b (1).proto'), 'Both', 'https://example.com/a.proto'))
            .toEqual({ include: 'Protos\\a%3Bb %281%29.proto', services: 'Both', sourceUrl: 'https://example.com/a.proto' });
    });
});

describe('addProtobufReference', () => {
    test('a first reference goes into a new ItemGroup at the end, formatting kept', () => {
        expect(addProtobufReference(project, { include: '..\\shared\\greet.proto', link: 'Protos\\greet.proto', services: 'Client' })).toBe(withReference);
    });

    test('Both leaves GrpcServices out (Grpc.Tools default), as dotnet-grpc does', () => {
        expect(addProtobufReference(project, { include: 'Protos\\greet.proto', services: 'Both' })).toContain('    <Protobuf Include="Protos\\greet.proto" />\n');
    });

    test('a URL reference gets SourceUrl as a child element; XML characters are escaped', () => {
        expect(addProtobufReference(project, { include: 'Protos\\greet.proto', services: 'Client', sourceUrl: 'https://example.com/greet.proto?a=1&b=2' }))
            .toContain('  <ItemGroup>\n    <Protobuf Include="Protos\\greet.proto" GrpcServices="Client">\n'
                + '      <SourceUrl>https://example.com/greet.proto?a=1&amp;b=2</SourceUrl>\n    </Protobuf>\n  </ItemGroup>\n');
    });

    test('a second reference goes after the last Protobuf item, with its indentation', () => {
        expect(addProtobufReference(withReference, { include: 'Protos\\orders.proto', services: 'Server' })).toBe(withReference.replace(
            'Link="Protos\\greet.proto" />\n', 'Link="Protos\\greet.proto" />\n    <Protobuf Include="Protos\\orders.proto" GrpcServices="Server" />\n'));
    });

    test('Protobuf items in comments do not count; CRLF is kept', () => {
        const commented = project.replace('</Project>', '<!-- <Protobuf Include="old.proto" /> -->\n</Project>').replace(/\n/g, '\r\n');
        const added = addProtobufReference(commented, { include: 'Protos\\greet.proto', services: 'Client' });
        expect(added).toContain('<!-- <Protobuf Include="old.proto" /> -->\r\n');
        expect(added).toContain('  <ItemGroup>\r\n    <Protobuf Include="Protos\\greet.proto" GrpcServices="Client" />\r\n  </ItemGroup>\r\n');
        expect(added.replace(/\r\n/g, '')).not.toContain('\n');
    });
});

describe('removeProtobufReference', () => {
    test('removes the element and the ItemGroup it leaves empty: the file is back as it was', () => {
        expect(removeProtobufReference(withReference, projectDir, path.join(root, 'shared', 'greet.proto'))).toBe(project);
    });

    test('a block element with SourceUrl goes as a whole; the others stay', () => {
        const remote = addProtobufReference(withReference, { include: 'Protos\\remote.proto', services: 'Client', sourceUrl: 'https://example.com/remote.proto' });
        expect(removeProtobufReference(remote, projectDir, path.join(projectDir, 'Protos', 'remote.proto'))).toBe(withReference);
    });

    test('matches Include with either slash and MSBuild escapes; CRLF kept', () => {
        const escaped = addProtobufReference(project, { include: 'Protos/a%3Bb.proto', services: 'Client' }).replace(/\n/g, '\r\n');
        expect(removeProtobufReference(escaped, projectDir, path.join(projectDir, 'Protos', 'a;b.proto'))).toBe(project.replace(/\n/g, '\r\n'));
    });

    test('a wildcard item, a commented one or another file: nothing changes', () => {
        const glob = project.replace('</Project>', '  <ItemGroup>\n    <Protobuf Include="Protos\\*.proto" />\n  </ItemGroup>\n  <!-- <Protobuf Include="Protos\\a.proto" /> -->\n</Project>');
        expect(removeProtobufReference(glob, projectDir, path.join(projectDir, 'Protos', 'a.proto'))).toBe(glob);
        expect(removeProtobufReference(withReference, projectDir, path.join(root, 'other.proto'))).toBe(withReference);
    });
});

describe('duplicateRefusal', () => {
    const greet = { include: '..\\shared\\greet.proto', fullPath: path.join(root, 'shared', 'greet.proto'), link: 'Protos\\greet.proto', grpcServices: 'Client' };

    test('the same file again is refused, from the evaluation or from the project file', () => {
        const again = protobufReferenceFor(projectDir, greet.fullPath, 'Server');
        expect(duplicateRefusal([greet], project, projectDir, greet.fullPath, again)).toBe('greet.proto is already a gRPC reference of Client.');
        expect(duplicateRefusal([], withReference, projectDir, greet.fullPath, again)).toBe('greet.proto is already a gRPC reference of Client.');
    });

    test('another file with the same name outside the project would get the same Link', () => {
        const other = path.join(root, 'other', 'greet.proto');
        expect(duplicateRefusal([greet], withReference, projectDir, other, protobufReferenceFor(projectDir, other, 'Client')))
            .toBe('Protos\\greet.proto is already taken by the gRPC reference ..\\shared\\greet.proto; rename one of the files.');
    });

    test('a new file is fine', () => {
        const orders = path.join(projectDir, 'Protos', 'orders.proto');
        expect(duplicateRefusal([greet], withReference, projectDir, orders, protobufReferenceFor(projectDir, orders, 'Client'))).toBeUndefined();
    });
});

describe('grpcPackages', () => {
    test('as dotnet-grpc: Client in a console app, Client in a web app, Server and Both, None', () => {
        expect(grpcPackages('Client', false, [])).toEqual(['Google.Protobuf', 'Grpc.Net.ClientFactory', 'Grpc.Tools']);
        expect(grpcPackages('Client', true, [])).toEqual(['Google.Protobuf', 'Grpc.AspNetCore.Server.ClientFactory', 'Grpc.Tools']);
        expect(grpcPackages('Server', false, [])).toEqual(['Grpc.AspNetCore']);
        expect(grpcPackages('Both', true, [])).toEqual(['Grpc.AspNetCore']);
        expect(grpcPackages('None', false, [])).toEqual(['Google.Protobuf', 'Grpc.Tools']);
    });

    test('packages referenced (in any casing) or brought by a referenced one are left alone', () => {
        expect(grpcPackages('Client', false, ['grpc.tools', 'Google.Protobuf'])).toEqual(['Grpc.Net.ClientFactory']);
        expect(grpcPackages('Client', true, ['Grpc.AspNetCore'])).toEqual([]);
        expect(grpcPackages('Server', false, ['Google.Protobuf', 'Grpc.Net.ClientFactory', 'Grpc.Tools'])).toEqual(['Grpc.AspNetCore']);
        expect(grpcPackages('Client', false, ['Grpc.AspNetCore.Server.ClientFactory'])).toEqual(['Google.Protobuf', 'Grpc.Tools']);
    });
});

describe('ensureDevelopmentDependency', () => {
    const bare = '<Project>\n  <ItemGroup>\n    <PackageReference Include="Google.Protobuf" />\n    <PackageReference Include="Grpc.Tools" />\n  </ItemGroup>\n</Project>\n';
    const marked = '<Project>\n  <ItemGroup>\n    <PackageReference Include="Google.Protobuf" />\n    <PackageReference Include="Grpc.Tools">\n'
        + '      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>\n      <PrivateAssets>all</PrivateAssets>\n'
        + '    </PackageReference>\n  </ItemGroup>\n</Project>\n';

    test('a bare reference (what the CPM edits write) gets what dotnet add package writes', () => {
        expect(ensureDevelopmentDependency(bare, 'Grpc.Tools')).toBe(marked);
        expect(ensureDevelopmentDependency(bare.replace(/\n/g, '\r\n'), 'grpc.tools')).toBe(marked.replace(/\n/g, '\r\n'));
    });

    test('nothing changes with PrivateAssets already there (attribute or element), or without the reference', () => {
        expect(ensureDevelopmentDependency(marked, 'Grpc.Tools')).toBe(marked);
        const attribute = bare.replace('Include="Grpc.Tools" />', 'Include="Grpc.Tools" Version="2.71.0" PrivateAssets="All" />');
        expect(ensureDevelopmentDependency(attribute, 'Grpc.Tools')).toBe(attribute);
        expect(ensureDevelopmentDependency(project, 'Grpc.Tools')).toBe(project);
    });

    test('a reference with children gets PrivateAssets as the last child', () => {
        const withChild = bare.replace('<PackageReference Include="Grpc.Tools" />', '<PackageReference Include="Grpc.Tools">\n      <IncludeAssets>build</IncludeAssets>\n    </PackageReference>');
        expect(ensureDevelopmentDependency(withChild, 'Grpc.Tools')).toBe(withChild.replace(
            '<IncludeAssets>build</IncludeAssets>\n', '<IncludeAssets>build</IncludeAssets>\n      <PrivateAssets>all</PrivateAssets>\n'));
    });
});

describe('helpers', () => {
    test('defaultGrpcServices: Both for the web SDK, Client otherwise', () => {
        expect(defaultGrpcServices('<Project Sdk="Microsoft.NET.Sdk.Web">')).toBe('Both');
        expect(defaultGrpcServices(project)).toBe('Client');
    });

    test('protoFileName: the last URL segment, decoded, with .proto', () => {
        expect(protoFileName('https://raw.githubusercontent.com/grpc/grpc-dotnet/master/examples/Greeter/Proto/greet.proto')).toBe('greet.proto');
        expect(protoFileName('https://example.com/api/orders%20v2.proto?ref=main')).toBe('orders v2.proto');
        expect(protoFileName('https://example.com/protos/greet')).toBe('greet.proto');
        expect(protoFileName('https://example.com/')).toBe('service.proto');
    });

    test('referenceLabel shows the file and what it generates, Both when the item does not say', () => {
        expect(referenceLabel({ include: 'x', fullPath: path.join(projectDir, 'Protos', 'greet.proto'), grpcServices: 'Client' })).toBe('greet.proto (Client)');
        expect(referenceLabel({ include: 'x', fullPath: path.join(projectDir, 'Protos', 'greet.proto') })).toBe('greet.proto (Both)');
    });

    test('contentHash tells different content apart, ignores where it comes from', () => {
        expect(contentHash('syntax = "proto3";')).toBe(contentHash(Buffer.from('syntax = "proto3";')));
        expect(contentHash('a')).not.toBe(contentHash('b'));
    });

    test('notListedMessage names the props file, or the wildcard case', () => {
        const proto = path.join(projectDir, 'Protos', 'a.proto');
        expect(notListedMessage({ include: 'Protos/a.proto', fullPath: proto, definedIn: path.join(root, 'Directory.Build.props') }, projectPath, proto))
            .toBe('a.proto comes from Directory.Build.props, not from Client.csproj: remove it there.');
        expect(notListedMessage({ include: 'Protos/a.proto', fullPath: proto, definedIn: projectPath }, projectPath, proto))
            .toBe('a.proto is not listed by itself in Client.csproj (a wildcard such as Protos\\*.proto includes it): edit the project file.');
    });
});
```

`src/test/unit/services/grpc/protobufReferences.msbuild.test.ts`:
```ts
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectFileEditor } from '../../../../parsers/projectFileEditor';
import { addProtobufReference, ensureDevelopmentDependency, grpcPackages, protobufReferenceFor, removeProtobufReference } from '../../../../services/grpc/protobufReferences';
import { ProjectItemsService } from '../../../../services/projectItems/projectItemsService';

/** The edits as real MSBuild and Grpc.Tools see them, on a copy of src/__fixtures__/grpc */
const withDotnet = spawnSync('dotnet', ['--version']).status === 0 ? test : test.skip;
const TIMEOUT = 150000;
const fixture = path.resolve(__dirname, '../../../../__fixtures__/grpc');
// Pinned, so the test does not depend on what is newest; restored from nuget.org (or the NuGet cache)
const VERSIONS: Record<string, string> = { 'Google.Protobuf': '3.30.2', 'Grpc.Net.ClientFactory': '2.71.0', 'Grpc.Tools': '2.71.0' };

describe('gRPC references with real MSBuild', () => {
    let root: string;
    let projectPath: string;
    const protoPath = () => path.join(root, 'shared', 'greet.proto');

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'grpc-refs-')));
        fs.cpSync(fixture, root, { recursive: true });
        projectPath = path.join(root, 'Client', 'Client.csproj');
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    const addReference = () => {
        const reference = protobufReferenceFor(path.dirname(projectPath), protoPath(), 'Client');
        fs.writeFileSync(projectPath, addProtobufReference(fs.readFileSync(projectPath, 'utf8'), reference));
    };

    withDotnet('after the edit the project evaluates the linked Protobuf item; after Remove it is gone', async () => {
        addReference();
        const items = await new ProjectItemsService().evaluate(projectPath);
        expect(items?.protobuf).toEqual([expect.objectContaining({ fullPath: protoPath(), grpcServices: 'Client' })]);
        expect(items?.protobuf[0].link?.replace(/[\\/]/g, '/')).toBe('Protos/greet.proto');
        expect(items?.linkedFilesIn(path.join(root, 'Client', 'Protos')).map(item => item.fullPath)).toEqual([protoPath()]);

        fs.writeFileSync(projectPath, removeProtobufReference(fs.readFileSync(projectPath, 'utf8'), path.dirname(projectPath), protoPath()));
        expect(fs.readFileSync(projectPath, 'utf8')).toBe(fs.readFileSync(path.join(fixture, 'Client', 'Client.csproj'), 'utf8'));
        expect((await new ProjectItemsService().evaluate(projectPath))?.protobuf).toEqual([]);
    }, TIMEOUT);

    withDotnet('a client project with the packages builds, and Grpc.Tools generates the client class', () => {
        addReference();
        const packages = grpcPackages('Client', false, []);
        let content = ProjectFileEditor.appendItemGroup(fs.readFileSync(projectPath, 'utf8'),
            indent => packages.map(id => `${indent}<PackageReference Include="${id}" Version="${VERSIONS[id]}" />`));
        content = ensureDevelopmentDependency(content, 'Grpc.Tools');
        fs.writeFileSync(projectPath, content);
        fs.writeFileSync(path.join(root, 'Client', 'Program.cs'),
            'var client = new GrpcGreeter.Greeter.GreeterClient(Grpc.Net.Client.GrpcChannel.ForAddress("http://localhost:5000"));\n'
            + 'Console.WriteLine(client.GetType().Name);\n');

        const restore = spawnSync('dotnet', ['restore', projectPath], { encoding: 'utf8' });
        if (restore.status !== 0 && /NU1301|Unable to load the service index/.test(restore.stdout + restore.stderr)) {
            console.warn('Skipped: nuget.org is not reachable and the packages are not in the NuGet cache');
            return;
        }
        expect(restore.status).toBe(0);
        const build = spawnSync('dotnet', ['build', projectPath, '--no-restore', '-nologo'], { encoding: 'utf8' });
        expect(build.stdout).toContain('Build succeeded');
        const generated = fs.readdirSync(path.join(root, 'Client', 'obj'), { recursive: true }).map(String);
        expect(generated.some(file => /GreetGrpc\.cs$/.test(file))).toBe(true);
    }, TIMEOUT);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/test/unit/services/grpc`
Expected: FAIL (`Cannot find module '../../../../services/grpc/protobufReferences'`).

- [ ] **Step 3: Open up `indentUnit` of `ProjectFileEditor`**

In `src/parsers/projectFileEditor.ts` change `private static indentUnit(` to `static indentUnit(` and extend the class comment:
```bash
sed -i 's/^    private static indentUnit(/    static indentUnit(/' src/parsers/projectFileEditor.ts
sed -i 's| \* Its text helpers are shared with the package edits (services/nuget/centralPackageEdits.ts).| * Its text helpers are shared with the package edits (services/nuget/centralPackageEdits.ts) and the gRPC references\n * (services/grpc/protobufReferences.ts).|' src/parsers/projectFileEditor.ts
grep -c "^    static indentUnit(" src/parsers/projectFileEditor.ts
```
Expected: `1`.

- [ ] **Step 4: Implement `src/services/grpc/protobufReferences.ts`**

```ts
import * as path from 'path';
import * as crypto from 'crypto';
import { ProjectFileEditor as Xml } from '../../parsers/projectFileEditor';
import { isWebProject } from '../../parsers/projectKind';
import { escapeMsbuild } from '../projectItems/projectItemEdits';
import { pathKey, ProtobufItem } from '../projectItems/projectItems';

/**
 * gRPC references (`<Protobuf>` items) as Visual Studio's "Add Connected Service > gRPC" and `dotnet-grpc` write them:
 * the text edits of the project file, the packages a reference needs, and the helpers of Update. No `vscode` here.
 */

export const GRPC_SERVICES = ['Client', 'Server', 'Both', 'None'] as const;
export type GrpcServices = typeof GRPC_SERVICES[number];

/** Where `dotnet-grpc` puts downloaded files and links files from outside the project */
export const PROTOS_FOLDER = 'Protos';

/** A reference to add: `include` and `link` as they go into the project file (backslashes, MSBuild-escaped) */
export interface NewProtobufReference {
    readonly include: string;
    readonly link?: string;
    readonly services: GrpcServices;
    readonly sourceUrl?: string;
}

/** `dotnet-grpc`'s Default: Both in web projects (`Microsoft.NET.Sdk.Web`), Client elsewhere */
export function defaultGrpcServices(projectXml: string): GrpcServices {
    return isWebProject(projectXml) ? 'Both' : 'Client';
}

/** What the reference generates; Grpc.Tools' default (Both) when the item does not say */
export function servicesOf(item: ProtobufItem): string {
    return item.grpcServices ?? 'Both';
}

/** The tree label of a reference: `greet.proto (Client)` */
export function referenceLabel(item: ProtobufItem): string {
    return `${path.basename(item.fullPath)} (${servicesOf(item)})`;
}

const isBelow = (relative: string) =>
    relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);

/**
 * The item for a `.proto` file: Include relative to the project folder; a file outside it also gets
 * `Link="Protos\<name>"`, so the tree shows it in Protos (what `dotnet-grpc add-file` writes)
 */
export function protobufReferenceFor(projectDir: string, protoPath: string, services: GrpcServices, sourceUrl?: string): NewProtobufReference {
    const relative = path.relative(projectDir, protoPath);
    const include = escapeMsbuild((path.isAbsolute(relative) ? protoPath : relative).replace(/\//g, '\\'));
    return {
        include,
        ...(isBelow(relative) ? {} : { link: escapeMsbuild(`${PROTOS_FOLDER}\\${path.basename(protoPath)}`) }),
        services,
        ...(sourceUrl ? { sourceUrl } : {}),
    };
}

const unescapeMsbuild = (value: string) => value.replace(/%([0-9A-Fa-f]{2})/g, (_all, hex: string) => String.fromCharCode(parseInt(hex, 16)));
/** The file an Include (or Link) written in the project file stands for */
const resolveItem = (projectDir: string, value: string) => path.resolve(projectDir, unescapeMsbuild(Xml.unescape(value)).trim().replace(/[\\/]/g, path.sep));
const sameFile = (a: string, b: string) => pathKey(path.normalize(a)) === pathKey(path.normalize(b));

interface Element {
    readonly include: string;
    readonly start: number;
    readonly end: number;
}

/** `<Protobuf Include="...">` elements, self-closing or with children, outside comments and targets */
function protobufElements(content: string): Element[] {
    const elementRe = /<Protobuf\b((?:[^>"']|"[^"]*"|'[^']*')*?)(?:\/>|>[\s\S]*?<\/Protobuf\s*>)/g;
    const ignored = Xml.ignoredRanges(content);
    const result: Element[] = [];
    for (const match of content.matchAll(elementRe)) {
        const include = /\bInclude\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(match[1]);
        if (include && !Xml.inRanges(ignored, match.index!)) {
            result.push({ include: include[1] ?? include[2], start: match.index!, end: match.index! + match[0].length });
        }
    }
    return result;
}

/** The element of the project file that lists exactly this file (not a wildcard, not a list) */
function findElement(content: string, projectDir: string, protoPath: string): Element | undefined {
    return protobufElements(content).find(element => !/[*?;]/.test(element.include) && sameFile(resolveItem(projectDir, element.include), protoPath));
}

/** The element's lines: self-closing, or with `<SourceUrl>` as a child element (as `dotnet-grpc add-url` writes it) */
function elementLines(reference: NewProtobufReference, indent: string, unit: string): string[] {
    // Both is Grpc.Tools' default: dotnet-grpc leaves the attribute out then
    const attributes = `Include="${Xml.escape(reference.include)}"`
        + (reference.services === 'Both' ? '' : ` GrpcServices="${reference.services}"`)
        + (reference.link ? ` Link="${Xml.escape(reference.link)}"` : '');
    if (!reference.sourceUrl) {
        return [`${indent}<Protobuf ${attributes} />`];
    }
    return [
        `${indent}<Protobuf ${attributes}>`,
        `${indent}${unit}<SourceUrl>${Xml.escape(reference.sourceUrl)}</SourceUrl>`,
        `${indent}</Protobuf>`,
    ];
}

/** Adds the item after the last `<Protobuf>` of the project file (same indentation), else in a new ItemGroup at the end */
export function addProtobufReference(content: string, reference: NewProtobufReference): string {
    const nl = content.includes('\r\n') ? '\r\n' : '\n';
    const unit = Xml.indentUnit(content);
    const last = protobufElements(content).pop();
    if (last) {
        const lines = elementLines(reference, Xml.lineIndent(content, last.start), unit);
        return content.slice(0, last.end) + nl + lines.join(nl) + content.slice(last.end);
    }
    return Xml.appendItemGroup(content, indent => elementLines(reference, indent, unit));
}

/**
 * Removes the `<Protobuf>` element that lists the file, with its ItemGroup when that is left empty. Returns the content
 * unchanged when no element lists exactly this file (a wildcard, or an item written in another file).
 */
export function removeProtobufReference(content: string, projectDir: string, protoPath: string): string {
    const element = findElement(content, projectDir, protoPath);
    return element ? Xml.deleteElement(content, element.start, element.end) : content;
}

/**
 * Why a reference to the file must not be added, or undefined: the project has one already (in its evaluation or,
 * when MSBuild could not tell, in the project file), or another reference is shown at the same Link
 */
export function duplicateRefusal(
    existing: readonly ProtobufItem[], projectXml: string, projectDir: string, protoPath: string, reference: NewProtobufReference,
): string | undefined {
    const name = path.basename(protoPath);
    if (existing.some(item => sameFile(item.fullPath, protoPath)) || findElement(projectXml, projectDir, protoPath)) {
        return `${name} is already a gRPC reference of ${path.basename(projectDir)}.`;
    }
    if (reference.link) {
        const shownAt = resolveItem(projectDir, reference.link);
        const other = existing.find(item => sameFile(item.link ? resolveItem(projectDir, item.link) : item.fullPath, shownAt));
        if (other) {
            return `${unescapeMsbuild(reference.link)} is already taken by the gRPC reference ${other.include}; rename one of the files.`;
        }
    }
    return undefined;
}

/** Brings Google.Protobuf, Grpc.Tools and the server and client factory packages */
const ASPNETCORE = 'Grpc.AspNetCore';

/**
 * The packages a reference needs that the project does not reference yet. As `dotnet-grpc`: Server and Both take
 * Grpc.AspNetCore; Client takes Google.Protobuf, Grpc.Tools and the client factory (in web projects the one that
 * forwards the server's call context); None only the code generator and its runtime. Unlike `dotnet-grpc`, packages
 * a referenced package brings already are left out.
 */
export function grpcPackages(services: GrpcServices, isWeb: boolean, referenced: readonly string[]): string[] {
    const has = (id: string) => referenced.some(candidate => candidate.toLowerCase() === id.toLowerCase());
    if (has(ASPNETCORE)) {
        return [];
    }
    const wanted = services === 'Server' || services === 'Both' ? [ASPNETCORE]
        : services === 'None' ? ['Google.Protobuf', 'Grpc.Tools']
        : ['Google.Protobuf', isWeb ? 'Grpc.AspNetCore.Server.ClientFactory' : 'Grpc.Net.ClientFactory', 'Grpc.Tools'];
    return wanted.filter(id => !has(id) && !(id === 'Grpc.Net.ClientFactory' && has('Grpc.AspNetCore.Server.ClientFactory')));
}

/**
 * Marks a development dependency (Grpc.Tools) as `dotnet add package` does, so it does not flow to the projects that
 * reference this one. Needed after the Central Package Management edits, which write a bare
 * `<PackageReference Include="Grpc.Tools" />`; nothing changes when the reference has `PrivateAssets` already or is
 * not in the project file.
 */
export function ensureDevelopmentDependency(content: string, id: string): string {
    const elementRe = /<PackageReference\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/>|>[\s\S]*?<\/PackageReference\s*>)/g;
    const ignored = Xml.ignoredRanges(content);
    for (const match of content.matchAll(elementRe)) {
        const include = /\bInclude\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(match[1]);
        if (!include || Xml.inRanges(ignored, match.index!) || Xml.unescape(include[1] ?? include[2]).trim().toLowerCase() !== id.toLowerCase()) {
            continue;
        }
        if (/\bPrivateAssets\s*=/.test(match[1]) || /<PrivateAssets\b/.test(match[2])) {
            return content;
        }
        const nl = content.includes('\r\n') ? '\r\n' : '\n';
        const indent = Xml.lineIndent(content, match.index!);
        const child = indent + Xml.indentUnit(content);
        const privateAssets = `${child}<PrivateAssets>all</PrivateAssets>`;
        const start = match.index!;
        const end = start + match[0].length;
        if (match[2] === '/>') {
            const element = [
                `<PackageReference${match[1].replace(/\s+$/, '')}>`,
                `${child}<IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>`,
                privateAssets,
                `${indent}</PackageReference>`,
            ].join(nl);
            return content.slice(0, start) + element + content.slice(end);
        }
        // With children: PrivateAssets goes last, on its own line above the closing tag
        const close = start + match[0].lastIndexOf('</PackageReference');
        const lineStart = content.lastIndexOf('\n', close - 1) + 1;
        return content.slice(lineStart, close).trim() === ''
            ? content.slice(0, lineStart) + privateAssets + nl + content.slice(lineStart)
            : content.slice(0, close) + nl + privateAssets + nl + indent + content.slice(close);
    }
    return content;
}

/** The file name a downloaded `.proto` gets: the URL's last path segment, with `.proto` added when missing */
export function protoFileName(url: string): string {
    let segment = '';
    try {
        const pathname = new URL(url).pathname;
        segment = decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1));
    } catch {
        segment = '';
    }
    const name = segment.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'service';
    return /\.proto$/i.test(name) ? name : `${name}.proto`;
}

/** Content hash, to tell whether a downloaded file differs from the local one */
export function contentHash(content: string | Uint8Array): string {
    return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Why Remove cannot take the reference out of the project file, for a file no element lists by itself: a wildcard
 * in the project file, or an item written in a props file
 */
export function notListedMessage(item: ProtobufItem | undefined, projectPath: string, protoPath: string): string {
    const name = path.basename(protoPath);
    if (item?.definedIn && !sameFile(item.definedIn, projectPath)) {
        return `${name} comes from ${path.basename(item.definedIn)}, not from ${path.basename(projectPath)}: remove it there.`;
    }
    return `${name} is not listed by itself in ${path.basename(projectPath)} (a wildcard such as Protos\\*.proto includes it): edit the project file.`;
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx jest src/test/unit/services/grpc src/test/unit/parsers`
Expected: PASS (25 pure tests; the 2 real tests run with `dotnet`, the build one in about 5 s with a warm NuGet cache; the `ProjectFileEditor` tests unchanged).

- [ ] **Step 6: Typecheck and commit**

No docs step: nothing a user sees yet.
```bash
npm run typecheck
git add src/parsers/projectFileEditor.ts src/services/grpc/protobufReferences.ts src/test/unit/services/grpc/protobufReferences.test.ts src/test/unit/services/grpc/protobufReferences.msbuild.test.ts
git commit -m "gRPC references: project file edits and package rules

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: gRPC references in the tree (Connected Services)

**Files:**
- Modify: `src/services/nodeIdService.ts`, `src/core/contextMenus.ts`, `src/core/Project.ts`, `src/services/solutionExpansionService.ts`, `src/webview/solution-view/components/TreeNode/TreeNode.tsx`, `src/webview/solution-view/components/SolutionTree.tsx`
- Create: `src/services/grpc/grpcNodes.ts`
- Generated: `package.json`, `docs/context-menus.md`
- Test: `src/test/unit/services/grpc/grpcNodes.test.ts`
- Docs: `docs/connected-services.md`, `docs/manual-testing.md`

- [ ] **Step 1: Write the failing test**

`src/test/unit/services/grpc/grpcNodes.test.ts`:
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
import { Project } from '../../../../core/Project';
import { grpcChildren } from '../../../../services/grpc/grpcNodes';
import { NodeIdService } from '../../../../services/nodeIdService';
import { parseMsbuildItems } from '../../../../services/projectItems/projectItems';
import { ProjectItemsService } from '../../../../services/projectItems/projectItemsService';
import { ShowAllFiles } from '../../../../services/showAllFiles';

describe('gRPC references in the tree', () => {
    let root: string;
    let dir: string;
    let projectPath: string;
    const shared = () => path.join(root, 'shared', 'greet.proto');

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'grpc-tree-')));
        dir = path.join(root, 'App');
        fs.mkdirSync(path.join(dir, 'Protos'), { recursive: true });
        projectPath = path.join(dir, 'App.csproj');
        fs.writeFileSync(projectPath, '<Project Sdk="Microsoft.NET.Sdk"></Project>');
        fs.writeFileSync(path.join(dir, 'Program.cs'), '');
        fs.writeFileSync(path.join(dir, 'Protos', 'remote.proto'), '');
        jest.spyOn(ShowAllFiles, 'isOn').mockReturnValue(false);
        jest.spyOn(ProjectItemsService.instance, 'evaluate').mockResolvedValue(undefined);
        jest.spyOn(ProjectItemsService.instance, 'get').mockReturnValue(parseMsbuildItems(JSON.stringify({
            Items: {
                Compile: [{ Identity: 'Program.cs', FullPath: path.join(dir, 'Program.cs') }],
                // What the default globs give a service reference folder
                None: [{ Identity: 'Connected Services\\Billing\\ConnectedService.json', FullPath: path.join(dir, 'Connected Services', 'Billing', 'ConnectedService.json') }],
                Protobuf: [
                    { Identity: 'Protos\\remote.proto', FullPath: path.join(dir, 'Protos', 'remote.proto'), GrpcServices: 'Client', SourceUrl: 'https://example.com/remote.proto' },
                    { Identity: '..\\shared\\greet.proto', FullPath: shared(), Link: 'Protos\\greet.proto' },
                ],
            },
        }), dir));
    });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); jest.restoreAllMocks(); });

    const newProject = async () => {
        const project = new Project(projectPath, { name: 'App', path: 'App.csproj', guid: 'g', typeGuid: 't' } as never);
        while (!project.isInitialized) {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        return project;
    };
    const expectedReferences = () => [
        { type: 'grpcReference', name: 'greet.proto (Both)', nodeId: NodeIdService.generateGrpcReferenceId(projectPath, shared()), hasChildren: false },
        { type: 'grpcReference', name: 'remote.proto (Client)', nodeId: NodeIdService.generateGrpcReferenceId(projectPath, path.join(dir, 'Protos', 'remote.proto')), hasChildren: false, contextValue: 'url' },
    ];

    test('without a Connected Services folder on disk, the project starts with a Connected Services node listing them', async () => {
        const children = await (await newProject()).getRootChildren();
        expect(children[0]).toEqual({ type: 'connectedServices', name: 'Connected Services', nodeId: NodeIdService.generateConnectedServicesId(projectPath), hasChildren: true });
        expect(children.filter(child => child.name === 'Connected Services')).toHaveLength(1);
        expect(grpcChildren(NodeIdService.parse(children[0].nodeId))).toEqual(expectedReferences());
    });

    test('with the folder (service references), the folder lists the gRPC references after its own folders', async () => {
        const folder = path.join(dir, 'Connected Services');
        fs.mkdirSync(path.join(folder, 'Billing'), { recursive: true });
        fs.writeFileSync(path.join(folder, 'Billing', 'ConnectedService.json'), '{}');
        const project = await newProject();
        const children = await project.getRootChildren();
        expect(children.some(child => child.type === 'connectedServices')).toBe(false);
        const connected = children.find(child => child.name === 'Connected Services')!;
        expect(connected).toEqual(expect.objectContaining({ type: 'folder', contextValue: 'connectedServices', hasChildren: true }));
        const inside = await project.getFolderChildren(folder);
        expect(inside.map(child => child.name)).toEqual(['Billing', 'greet.proto (Both)', 'remote.proto (Client)']);
        expect(inside.slice(1)).toEqual(expectedReferences());
    });

    test('an empty Connected Services folder still opens to the gRPC references', async () => {
        fs.mkdirSync(path.join(dir, 'Connected Services'));
        const children = await (await newProject()).getRootChildren();
        expect(children.find(child => child.name === 'Connected Services')).toEqual(expect.objectContaining({ type: 'folder', hasChildren: true }));
    });

    test('no gRPC references: no Connected Services node; other nodes have no gRPC children', async () => {
        (ProjectItemsService.instance.get as jest.Mock).mockReturnValue(parseMsbuildItems(JSON.stringify({
            Items: { Compile: [{ Identity: 'Program.cs', FullPath: path.join(dir, 'Program.cs') }] },
        }), dir));
        const children = await (await newProject()).getRootChildren();
        expect(children.some(child => child.name === 'Connected Services')).toBe(false);
        expect(grpcChildren(NodeIdService.parse(NodeIdService.generateFolderId(dir)))).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/test/unit/services/grpc/grpcNodes.test.ts`
Expected: FAIL (`Cannot find module '../../../../services/grpc/grpcNodes'`).

- [ ] **Step 3: Node ids**

In `src/services/nodeIdService.ts`, before `export declare type NodeId =` add:
```ts
/** Connected Services of a project that has gRPC references but no `Connected Services` folder on disk */
export declare type ConnectedServicesNodeId = {
    readonly type: 'connectedServices';
    /** The project */
    readonly path: string;
}

/** A gRPC reference (a `Protobuf` item) in Connected Services */
export declare type GrpcReferenceNodeId = {
    readonly type: 'grpcReference';
    /** The `.proto` file (Open opens it) */
    readonly path: string;
    readonly project: string;
}

```
In the `NodeId` union replace `    TransitivePackageNodeId;` with:
```ts
    TransitivePackageNodeId |
    ConnectedServicesNodeId |
    GrpcReferenceNodeId;
```
After `generateGeneratedFileId` add:
```ts

    static generateConnectedServicesId(projectPath: string): NodeIdString {
        return this.encode({ type: 'connectedServices', path: projectPath });
    }

    static generateGrpcReferenceId(projectPath: string, protoPath: string): NodeIdString {
        return this.encode({ type: 'grpcReference', path: protoPath, project: projectPath });
    }
```

- [ ] **Step 4: Menus of the two node types**

In `src/core/contextMenus.ts`:
- After the `EXCLUDED_ITEM` constant add:
```ts
/** `contextValue` of gRPC references added from a URL: they can be updated */
export const GRPC_URL_REFERENCE = 'url';
```
- In `contextMenus`, after the `'folder.serviceReference'` entry add:
```ts
    // Connected Services of a project with gRPC references and no such folder on disk
    connectedServices: [
        ['addServiceReference'],
    ],
    grpcReference: [
        ['openFile'],
    ],
```
- In `nodeTypeNames`, after `file: 'File',` add:
```ts
    connectedServices: 'Connected Services (of a project with gRPC references and no such folder on disk)',
    grpcReference: 'gRPC reference (in Connected Services)',
```

- [ ] **Step 5: Implement `src/services/grpc/grpcNodes.ts`**

```ts
import { NodeId, NodeIdService } from '../nodeIdService';
import { ProjectChild } from '../../types';
import { pathKey } from '../projectItems/projectItems';
import { ProjectItemsService } from '../projectItems/projectItemsService';
import { GRPC_URL_REFERENCE } from '../../core/contextMenus';
import { referenceLabel } from './protobufReferences';

/**
 * The project's gRPC references for Connected Services, one node per `.proto` (from the last evaluation), sorted by
 * label. References added from a URL carry a context value for their Update item.
 */
export function grpcReferenceNodes(projectPath: string): ProjectChild[] {
    const seen = new Set<string>();
    return [...(ProjectItemsService.instance.get(projectPath)?.protobuf ?? [])]
        .filter(item => !seen.has(pathKey(item.fullPath)) && !!seen.add(pathKey(item.fullPath)))
        .sort((a, b) => referenceLabel(a).localeCompare(referenceLabel(b)))
        .map(item => ({
            type: 'grpcReference',
            name: referenceLabel(item),
            nodeId: NodeIdService.generateGrpcReferenceId(projectPath, item.fullPath),
            hasChildren: false,
            ...(item.sourceUrl ? { contextValue: GRPC_URL_REFERENCE } : {}),
        }));
}

/** Children of the Connected Services node of a project without that folder on disk; undefined for other nodes */
export function grpcChildren(node: NodeId): ProjectChild[] | undefined {
    return node.type === 'connectedServices' ? grpcReferenceNodes(node.path) : undefined;
}
```

- [ ] **Step 6: The project's tree**

In `src/core/Project.ts`:
- Replace `import { serviceFolderKind } from '../services/serviceReferences/connectedService';` with:
```ts
import { CONNECTED_SERVICES, serviceFolderKind } from '../services/serviceReferences/connectedService';
import { grpcReferenceNodes } from '../services/grpc/grpcNodes';
```
- In `getRootChildren`, just before `log.info(\`getRootChildren for ${this.name}: ${items.length} items\`);` add:
```ts
            // gRPC references and no Connected Services folder shown from disk: Visual Studio's node, at the top
            const connectedServices = NodeIdService.generateFolderId(path.join(projectDir, CONNECTED_SERVICES));
            if (!items.some(item => item.nodeId === connectedServices) && grpcReferenceNodes(this._projectPath).length > 0) {
                items.unshift({
                    type: 'connectedServices',
                    name: CONNECTED_SERVICES,
                    nodeId: NodeIdService.generateConnectedServicesId(this._projectPath),
                    hasChildren: true
                });
            }

```
- In `toProjectChild`, replace
```ts
        return {
            type: node.type,
            name: node.name,
            hasChildren: node.hasChildren,
            nodeId: isFolder ? NodeIdService.generateFolderId(node.path) : NodeIdService.generateFileId(node.path),
            contextValue: isFolder ? this.folderContextValue(node.path) ?? itemValue : itemValue,
```
with
```ts
        const folderValue = isFolder ? this.folderContextValue(node.path) : undefined;
        return {
            type: node.type,
            name: node.name,
            // Connected Services also lists the gRPC references
            hasChildren: node.hasChildren || (folderValue === 'connectedServices' && grpcReferenceNodes(this._projectPath).length > 0),
            nodeId: isFolder ? NodeIdService.generateFolderId(node.path) : NodeIdService.generateFileId(node.path),
            contextValue: folderValue ?? itemValue,
```
- In `getFolderChildren`, after the `for (const child of children) { items.push(this.toProjectChild(child)); }` loop add:
```ts
            // The gRPC references, after the service reference folders
            if (this.folderContextValue(folderPath) === 'connectedServices') {
                items.push(...grpcReferenceNodes(this._projectPath));
            }
```

A project whose evaluation changes only in `Protobuf` metadata now gets a new item list (Task 1, `equals`), so `evaluateItems` redraws the tree as for any other item change.

- [ ] **Step 7: Expanding and refreshing**

In `src/services/solutionExpansionService.ts`:
- After `import { packageChildren } from './nuget/packageNodes';` add `import { grpcChildren } from './grpc/grpcNodes';`.
- Replace
```ts
            // Analyzers and packages expand to what MSBuild and the last restore report
            const dependencyNodes = await analyzerChildren(node) ?? packageChildren(node);
```
with
```ts
            // Analyzers, packages and gRPC references expand to what MSBuild and the last restore report
            const dependencyNodes = await analyzerChildren(node) ?? packageChildren(node) ?? grpcChildren(node);
```
- Replace `const dependencyNodes = await analyzerChildren(parsedNode) ?? packageChildren(parsedNode);` (in `_loadChildrenForNode`) with `const dependencyNodes = await analyzerChildren(parsedNode) ?? packageChildren(parsedNode) ?? grpcChildren(parsedNode);`.
- At the top of the loop in `_refreshExpandedFolders`, before `if (child.type === 'folder' && child.expanded && child.children) {`, add:
```ts
            const grpcNodes = child.expanded ? grpcChildren(NodeIdService.parse(child.nodeId)) : undefined;
            if (grpcNodes) {
                child.children = SolutionTreeService.convertProjectChildrenToProjectNodes(grpcNodes);
                continue;
            }
```

- [ ] **Step 8: The webview (types only, ids stay opaque)**

`src/webview/solution-view/components/TreeNode/TreeNode.tsx`:
- In `handleDoubleClick` replace the condition `if (node.type === 'file' || node.type === 'generatedFile' || node.type === 'solutionItem' || node.type === 'project' || node.type === 'solution') {` with `if (node.type === 'file' || node.type === 'generatedFile' || node.type === 'solutionItem' || node.type === 'project' || node.type === 'solution' || node.type === 'grpcReference') {`.
- In `getIconConfig`, `case 'folder':`, after the `Properties` line add `if (node.name === 'Connected Services') return { icon: 'mdi:connection', color: '#dcdcdc' };`.
- After `case 'sourceGenerator': return { icon: 'mdi:cog-outline', color: '#dcdcdc' };` add:
```tsx
            case 'connectedServices': return { icon: 'mdi:connection', color: '#dcdcdc' };
            case 'grpcReference': return { icon: 'mdi:api', color: '#dcdcdc' };
```

`src/webview/solution-view/components/SolutionTree.tsx`, the `Enter` key: replace `if (focusedNode.type === 'file' || focusedNode.type === 'generatedFile') {` with `if (focusedNode.type === 'file' || focusedNode.type === 'generatedFile' || focusedNode.type === 'grpcReference') {`.

`openFile` needs no change: `_handleOpenFile` opens `nodeId.path`, the `.proto` of a `grpcReference`.

- [ ] **Step 9: Generate the menus, run the tests**

```bash
npm run generate:menus
npx jest src/test/unit/services/grpc/grpcNodes.test.ts src/test/unit/core/contextMenus.test.ts src/test/unit/webview src/test/unit/services/solutionExpansionService.nested.test.ts
```
Expected: `package.json context menus and docs/context-menus.md updated`; PASS (4 new tests; the opaque-id and menu tests unchanged). `docs/context-menus.md` gets the sections "Connected Services (of a project with gRPC references and no such folder on disk)" (Add Service Reference...) and "gRPC reference (in Connected Services)" (Open).

- [ ] **Step 10: Docs**

`docs/connected-services.md`: the first paragraph becomes
```markdown
WCF/SOAP service references, like Visual Studio's "Add Service Reference" (WCF Web Service Reference provider), and gRPC references, like Visual Studio's "Add Connected Service > gRPC". Visual Studio's WCF provider is a front end for `dotnet-svcutil`, and so is this one; gRPC references are `<Protobuf>` items, which the Grpc.Tools package turns into C# code when the project builds.
```
Rename the headings `## Add`, `## Update and remove`, `## dotnet-svcutil` and `## Known issues` to `## WCF: add`, `## WCF: update and remove`, `## WCF: dotnet-svcutil` and `## WCF: known issues`, and append:
```markdown
## gRPC

### In the tree

Every `<Protobuf>` item of a project is a gRPC reference: Connected Services lists one node per `.proto` file with what it generates, e.g. `greet.proto (Client)` (`Both` when the item does not say: that is Grpc.Tools' default). A project without a `Connected Services` folder gets the node anyway, at the top as in Visual Studio. References made by Visual Studio or `dotnet-grpc`, and those written by hand, show the same way. Double-click (or Enter) opens the `.proto` file.
```

`docs/manual-testing.md`, append unticked:
```markdown
- [ ] gRPC references in the tree (a copy of `src/__fixtures__/grpc`, `Grpc.slnx` opened): Consumer starts with a Connected Services node (connection icon) above Dependencies, listing `greet.proto (Client)`, `money.proto (None)` and `remote.proto (Client)`; double-click and Enter open the file; Client and Web have no Connected Services node; adding a `<Protobuf Include="..\shared\greet.proto" GrpcServices="Server" />` to Client by hand and saving brings the node with `greet.proto (Server)`; changing `Server` to `Both` relabels it without a reload; with a `Connected Services` folder holding a WCF reference, the folder lists the WCF reference first, then the gRPC references
```

- [ ] **Step 11: Verify and commit**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git add src/services/nodeIdService.ts src/core/contextMenus.ts src/services/grpc/grpcNodes.ts src/core/Project.ts src/services/solutionExpansionService.ts src/webview/solution-view/components/TreeNode/TreeNode.tsx src/webview/solution-view/components/SolutionTree.tsx package.json docs/context-menus.md src/test/unit/services/grpc/grpcNodes.test.ts docs/connected-services.md docs/manual-testing.md
git commit -m "gRPC references: Connected Services lists them in the tree

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: exit 0.

---

### Task 4: Add Service Reference asks WCF or gRPC; adding a gRPC reference

**Files:**
- Create: `src/services/serviceReferences/output.ts`, `src/services/grpc/download.ts`, `src/services/grpc/grpcReferenceService.ts`
- Modify: `src/services/serviceReferences/serviceReferenceService.ts`, `src/core/contextMenus.ts`
- Generated: `package.json`, `docs/context-menus.md`
- Test: `src/test/unit/services/grpc/grpcReferenceService.test.ts`, `src/test/unit/services/grpc/download.test.ts`, `src/test/unit/services/serviceReferences/serviceReferenceService.test.ts`
- Docs: `docs/connected-services.md`, `docs/manual-testing.md`

- [ ] **Step 1: Write the failing tests**

`src/test/unit/services/grpc/grpcReferenceService.test.ts`:
```ts
jest.mock('vscode', () => ({
    window: { createOutputChannel: jest.fn(() => ({ appendLine: jest.fn(), show: jest.fn() })) },
    workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
    ProgressLocation: { Notification: 15 },
    EventEmitter: class { event = jest.fn(); fire = jest.fn(); dispose = jest.fn(); },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
}), { virtual: true });

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addGrpcReference, GrpcHost } from '../../../../services/grpc/grpcReferenceService';
import { parseMsbuildItems } from '../../../../services/projectItems/projectItems';

const fixture = path.resolve(__dirname, '../../../../__fixtures__/grpc');
const GREET_URL = 'https://example.com/protos/greet.proto';

describe('addGrpcReference', () => {
    let root: string;
    let client: string;
    let web: string;
    const shared = () => path.join(root, 'shared', 'greet.proto');

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'grpc-add-')));
        fs.cpSync(fixture, root, { recursive: true });
        client = path.join(root, 'Client', 'Client.csproj');
        web = path.join(root, 'Web', 'Web.csproj');
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    /** A host that answers like the user and NuGet would; installPackages writes bare references, as the CPM edits do */
    const host = (overrides: Partial<GrpcHost> = {}) => {
        const calls = { info: [] as string[], fail: [] as string[], asked: [] as string[], installed: [] as string[], reevaluated: [] as string[], preselected: [] as string[] };
        const fake: GrpcHost = {
            pickSource: async () => ({ kind: 'file', path: shared() }),
            pickServices: async preselected => { calls.preselected.push(preselected); return preselected; },
            ask: async message => { calls.asked.push(message); return false; },
            info: message => { calls.info.push(message); },
            fail: message => { calls.fail.push(message); },
            log: () => undefined,
            progress: (_title, task) => task(),
            download: async () => Buffer.from('syntax = "proto3";\n'),
            items: async () => parseMsbuildItems(JSON.stringify({ Items: {} }), root),
            referencedPackages: async () => [],
            latestVersion: async id => ({ 'Google.Protobuf': '3.30.2', 'Grpc.Net.ClientFactory': '2.71.0', 'Grpc.Tools': '2.71.0', 'Grpc.AspNetCore': '2.71.0' } as Record<string, string>)[id],
            installPackages: async (projectPath, packages) => {
                calls.installed.push(...packages.map(entry => `${entry.id} ${entry.version}`));
                const content = fs.readFileSync(projectPath, 'utf8');
                const references = packages.map(entry => `    <PackageReference Include="${entry.id}" />\n`).join('');
                fs.writeFileSync(projectPath, content.replace('</Project>', `  <ItemGroup>\n${references}  </ItemGroup>\n</Project>`));
                return packages.map(entry => ({ success: true, message: `${entry.id} ${entry.version}` }));
            },
            reevaluate: async projectPath => { calls.reevaluated.push(projectPath); },
            ...overrides,
        };
        return { fake, calls };
    };

    test('a .proto outside a console project: Client, a Link into Protos, the client packages with Grpc.Tools private', async () => {
        const { fake, calls } = host();
        expect(await addGrpcReference(client, fake)).toBe(true);
        const content = fs.readFileSync(client, 'utf8');
        expect(content).toContain('    <Protobuf Include="..\\shared\\greet.proto" GrpcServices="Client" Link="Protos\\greet.proto" />\n');
        expect(content).toContain('<PackageReference Include="Grpc.Tools">\n      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>\n      <PrivateAssets>all</PrivateAssets>\n');
        expect(calls.preselected).toEqual(['Client']);
        expect(calls.installed).toEqual(['Google.Protobuf 3.30.2', 'Grpc.Net.ClientFactory 2.71.0', 'Grpc.Tools 2.71.0']);
        expect(calls.reevaluated).toEqual([client]);
        expect(calls.info).toEqual(['gRPC reference greet.proto added (Client). The code is generated when the project builds.']);
        expect(calls.fail).toEqual([]);
    });

    test('a web project offers Both first and gets Grpc.AspNetCore', async () => {
        const { fake, calls } = host();
        await addGrpcReference(web, fake);
        expect(calls.preselected).toEqual(['Both']);
        expect(fs.readFileSync(web, 'utf8')).toContain('<Protobuf Include="..\\shared\\greet.proto" Link="Protos\\greet.proto" />');
        expect(calls.installed).toEqual(['Grpc.AspNetCore 2.71.0']);
    });

    test('packages the project has are left alone', async () => {
        const { fake, calls } = host({ referencedPackages: async () => ['Grpc.AspNetCore'] });
        await addGrpcReference(client, fake);
        expect(calls.installed).toEqual([]);
        expect(calls.info).toHaveLength(1);
    });

    test('a URL: downloaded into Protos (created), referenced with its SourceUrl', async () => {
        const { fake } = host({ pickSource: async () => ({ kind: 'url', url: GREET_URL }) });
        expect(await addGrpcReference(client, fake)).toBe(true);
        expect(fs.readFileSync(path.join(root, 'Client', 'Protos', 'greet.proto'), 'utf8')).toBe('syntax = "proto3";\n');
        expect(fs.readFileSync(client, 'utf8')).toContain(
            '    <Protobuf Include="Protos\\greet.proto" GrpcServices="Client">\n      <SourceUrl>https://example.com/protos/greet.proto</SourceUrl>\n    </Protobuf>\n');
    });

    test('a URL whose file exists with other content: asked first; No changes nothing', async () => {
        fs.mkdirSync(path.join(root, 'Client', 'Protos'));
        fs.writeFileSync(path.join(root, 'Client', 'Protos', 'greet.proto'), 'old');
        const before = fs.readFileSync(client, 'utf8');
        const { fake, calls } = host({ pickSource: async () => ({ kind: 'url', url: GREET_URL }) });
        expect(await addGrpcReference(client, fake)).toBe(false);
        expect(calls.asked).toEqual([`${path.join('Protos', 'greet.proto')} exists already.`]);
        expect(fs.readFileSync(path.join(root, 'Client', 'Protos', 'greet.proto'), 'utf8')).toBe('old');
        expect(fs.readFileSync(client, 'utf8')).toBe(before);
    });

    test('a failed download changes nothing and says so', async () => {
        const before = fs.readFileSync(client, 'utf8');
        const { fake, calls } = host({ pickSource: async () => ({ kind: 'url', url: GREET_URL }), download: async () => { throw new Error('404'); } });
        expect(await addGrpcReference(client, fake)).toBe(false);
        expect(calls.fail).toEqual([`Downloading ${GREET_URL} failed.`]);
        expect(fs.readFileSync(client, 'utf8')).toBe(before);
        expect(fs.existsSync(path.join(root, 'Client', 'Protos'))).toBe(false);
    });

    test('a file the project references already is refused', async () => {
        const items = parseMsbuildItems(JSON.stringify({ Items: { Protobuf: [{ Identity: '..\\shared\\greet.proto', FullPath: shared(), Link: 'Protos\\greet.proto' }] } }), root);
        const before = fs.readFileSync(client, 'utf8');
        const { fake, calls } = host({ items: async () => items });
        expect(await addGrpcReference(client, fake)).toBe(false);
        expect(calls.info).toEqual(['greet.proto is already a gRPC reference of Client.']);
        expect(fs.readFileSync(client, 'utf8')).toBe(before);
    });

    test('packages not found: the reference stays, the error says the packages failed', async () => {
        const { fake, calls } = host({ latestVersion: async () => undefined });
        expect(await addGrpcReference(client, fake)).toBe(true);
        expect(fs.readFileSync(client, 'utf8')).toContain('<Protobuf Include="..\\shared\\greet.proto"');
        expect(calls.fail).toEqual(['gRPC reference greet.proto added, but adding its packages failed.']);
    });

    test('cancelled at the source or at what to generate: nothing changes', async () => {
        const before = fs.readFileSync(client, 'utf8');
        expect(await addGrpcReference(client, host({ pickSource: async () => undefined }).fake)).toBe(false);
        expect(await addGrpcReference(client, host({ pickServices: async () => undefined }).fake)).toBe(false);
        expect(fs.readFileSync(client, 'utf8')).toBe(before);
    });
});
```

`src/test/unit/services/grpc/download.test.ts` (Node's `http` works in the `jsdom` environment; `jest.setup.js` needs `window`, so no `@jest-environment node`):
```ts
import * as http from 'http';
import { AddressInfo } from 'net';
import { download } from '../../../../services/grpc/download';

describe('download', () => {
    let server: http.Server;
    let base: string;

    beforeAll(async () => {
        server = http.createServer((request, response) => {
            if (request.url === '/moved') {
                response.writeHead(302, { Location: '/protos/greet.proto' }).end();
            } else if (request.url === '/protos/greet.proto') {
                response.writeHead(200, { 'Content-Type': 'text/plain' }).end('syntax = "proto3";\n');
            } else if (request.url === '/loop') {
                response.writeHead(301, { Location: '/loop' }).end();
            } else if (request.url === '/slow') {
                // never answers
            } else {
                response.writeHead(404, 'Not Found').end();
            }
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));

    test('gets the file, also after a redirect', async () => {
        expect((await download(`${base}/protos/greet.proto`)).toString()).toBe('syntax = "proto3";\n');
        expect((await download(`${base}/moved`)).toString()).toBe('syntax = "proto3";\n');
    });

    test('rejects other statuses, endless redirects and a server that does not answer', async () => {
        await expect(download(`${base}/missing.proto`)).rejects.toThrow(`${base}/missing.proto answered 404 Not Found`);
        await expect(download(`${base}/loop`)).rejects.toThrow('Too many redirects');
        await expect(download(`${base}/slow`, 200)).rejects.toThrow('did not answer within 0.2 s');
    });
});
```

`src/test/unit/services/serviceReferences/serviceReferenceService.test.ts`:
```ts
const showQuickPick = jest.fn();
jest.mock('vscode', () => ({
    window: { showQuickPick, createOutputChannel: jest.fn(() => ({ appendLine: jest.fn(), show: jest.fn() })) },
    workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
    ProgressLocation: { Notification: 15 },
    EventEmitter: class { event = jest.fn(); fire = jest.fn(); dispose = jest.fn(); },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
}), { virtual: true });
jest.mock('../../../../services/grpc/grpcReferenceService', () => ({ addGrpcReference: jest.fn() }));

import * as path from 'path';
import { addGrpcReference } from '../../../../services/grpc/grpcReferenceService';
import { addServiceReference } from '../../../../services/serviceReferences/serviceReferenceService';
import { SolutionService } from '../../../../services/solutionService';

describe('Add Service Reference: the kind of service first', () => {
    const projectPath = path.resolve('/work/App/App.csproj');

    beforeEach(() => {
        jest.spyOn(SolutionService, 'getActiveSolution').mockReturnValue({ projects: new Map([[projectPath, {}]]) } as never);
        showQuickPick.mockReset();
        (addGrpcReference as jest.Mock).mockReset();
    });
    afterEach(() => jest.restoreAllMocks());

    test('gRPC goes to the gRPC flow, from the project and from its Connected Services folder', async () => {
        showQuickPick.mockImplementation(async (items: { label: string }[]) => items.find(item => item.label === 'gRPC'));
        await addServiceReference(projectPath);
        await addServiceReference(path.join(path.dirname(projectPath), 'Connected Services'));
        expect(addGrpcReference).toHaveBeenNthCalledWith(1, projectPath);
        expect(addGrpcReference).toHaveBeenNthCalledWith(2, projectPath);
        expect(showQuickPick.mock.calls[0][0].map((item: { label: string }) => item.label)).toEqual(['WCF Web Service', 'gRPC']);
    });

    test('WCF Web Service goes on with the WSDL question, as before; Escape does nothing', async () => {
        showQuickPick.mockResolvedValueOnce({ label: 'WCF Web Service' }).mockResolvedValueOnce(undefined);
        await addServiceReference(projectPath);
        expect(showQuickPick).toHaveBeenCalledTimes(2);
        expect(showQuickPick.mock.calls[1][1]).toEqual({ placeHolder: 'Where is the service description (WSDL)?' });
        showQuickPick.mockReset().mockResolvedValueOnce(undefined);
        await addServiceReference(projectPath);
        expect(showQuickPick).toHaveBeenCalledTimes(1);
        expect(addGrpcReference).not.toHaveBeenCalled();
    });
});
```
(The Connected Services node without a folder has the project as its id's `path`; `projectFor` already maps a project path and the `Connected Services` folder to the project.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/test/unit/services/grpc src/test/unit/services/serviceReferences/serviceReferenceService.test.ts`
Expected: FAIL (`Cannot find module '../../../../services/grpc/grpcReferenceService'`, `.../download`).

- [ ] **Step 3: Move the output helpers: `src/services/serviceReferences/output.ts`**

```ts
import * as vscode from 'vscode';

let output: vscode.OutputChannel | undefined;

/** The output of service references, WCF and gRPC: svcutil, package installs, downloads */
export function serviceReferencesOutput(): vscode.OutputChannel {
    return output ??= vscode.window.createOutputChannel('Shinobi .NET Studio: Service References');
}

/** An error message with a button to the output */
export async function showServiceReferenceFailure(message: string): Promise<void> {
    if (await vscode.window.showErrorMessage(message, 'Show Output') === 'Show Output') {
        serviceReferencesOutput().show();
    }
}
```

- [ ] **Step 4: `src/services/grpc/download.ts`**

```ts
import * as http from 'http';
import * as https from 'https';

/**
 * Downloads a file (a `.proto` for a gRPC reference) over http(s), following up to five redirects (raw.githubusercontent
 * and similar hosts redirect). Rejects on any status but 200 and when the server does not answer within `timeoutMs`.
 */
export function download(url: string, timeoutMs = 30000, redirects = 5): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const client = /^https:/i.test(url) ? https : http;
        const request = client.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'shinobi-dotnet' } }, response => {
            const status = response.statusCode ?? 0;
            const location = response.headers.location;
            if (status >= 300 && status < 400 && location) {
                response.resume();
                if (redirects <= 0) {
                    reject(new Error(`Too many redirects from ${url}`));
                    return;
                }
                download(new URL(location, url).toString(), timeoutMs, redirects - 1).then(resolve, reject);
                return;
            }
            if (status !== 200) {
                response.resume();
                reject(new Error(`${url} answered ${status}${response.statusMessage ? ` ${response.statusMessage}` : ''}`));
                return;
            }
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        });
        request.on('timeout', () => request.destroy(new Error(`${url} did not answer within ${timeoutMs / 1000} s`)));
        request.on('error', reject);
    });
}
```
(Node's `http`/`https` rather than `fetch`: `engines.vscode` is `^1.74.0`, whose extension host has no global `fetch`.)

- [ ] **Step 5: `src/services/grpc/grpcReferenceService.ts`**

```ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { isWebProject } from '../../parsers/projectKind';
import { SolutionService } from '../solutionService';
import { ProjectItems } from '../projectItems/projectItems';
import { ProjectItemsService } from '../projectItems/projectItemsService';
import { changePackageVersions } from '../nuget/centralPackageOperations';
import { PackageBrowseService } from '../nuget/packageBrowseService';
import { PackageOperationResult } from '../nuget/types';
import { VersionUtils } from '../versionUtils';
import { serviceReferencesOutput, showServiceReferenceFailure } from '../serviceReferences/output';
import { download } from './download';
import {
    addProtobufReference, contentHash, defaultGrpcServices, duplicateRefusal, ensureDevelopmentDependency, GrpcServices, grpcPackages,
    protobufReferenceFor, protoFileName, PROTOS_FOLDER,
} from './protobufReferences';

export type GrpcSource = { readonly kind: 'file'; readonly path: string } | { readonly kind: 'url'; readonly url: string };

/** What adding a gRPC reference needs from VS Code, NuGet and MSBuild; replaced in tests */
export interface GrpcHost {
    pickSource(): Promise<GrpcSource | undefined>;
    /** Client, Server or Both, `preselected` first */
    pickServices(preselected: GrpcServices): Promise<GrpcServices | undefined>;
    /** A modal question with one button besides Cancel: true when it was chosen */
    ask(message: string, detail: string, button: string): Promise<boolean>;
    info(message: string): void;
    /** An error with Show Output */
    fail(message: string): void;
    log(line: string): void;
    progress<T>(title: string, task: () => Promise<T>): Promise<T>;
    download(url: string): Promise<Buffer>;
    /** The project's evaluation (its Protobuf items); undefined when MSBuild could not tell */
    items(projectPath: string): Promise<ProjectItems | undefined>;
    /** Ids of the packages the project references (evaluated, so also those from props files) */
    referencedPackages(projectPath: string): Promise<readonly string[]>;
    /** The newest stable version on the configured package sources */
    latestVersion(id: string): Promise<string | undefined>;
    /** Adds the packages, Central Package Management aware */
    installPackages(projectPath: string, packages: readonly { id: string; version: string }[]): Promise<PackageOperationResult[]>;
    /** Evaluates the project again after its file changed (the tree follows) */
    reevaluate(projectPath: string): Promise<void>;
}

const relative = (projectPath: string, file: string) => path.relative(path.dirname(projectPath), file);

/** Adds the packages the reference needs and the project lacks; false when that failed (see the output) */
async function addPackages(projectPath: string, ids: readonly string[], host: GrpcHost): Promise<boolean> {
    if (ids.length === 0) {
        return true;
    }
    const packages: { id: string; version: string }[] = [];
    for (const id of ids) {
        const version = await host.latestVersion(id);
        if (!version) {
            host.log(`${id} was not found on the package sources.`);
            return false;
        }
        packages.push({ id, version });
    }
    host.log(`Adding ${packages.map(entry => `${entry.id} ${entry.version}`).join(', ')} to ${path.basename(projectPath)}`);
    const results = await host.installPackages(projectPath, packages);
    results.forEach(result => host.log(result.message));
    if (results.some(result => !result.success)) {
        return false;
    }
    // Under Central Package Management the reference is written bare: mark Grpc.Tools as dotnet add package does
    if (ids.includes('Grpc.Tools')) {
        const content = fs.readFileSync(projectPath, 'utf8');
        const marked = ensureDevelopmentDependency(content, 'Grpc.Tools');
        if (marked !== content) {
            fs.writeFileSync(projectPath, marked);
        }
    }
    return true;
}

/**
 * Visual Studio's "Add Connected Service > gRPC" (`dotnet-grpc add-file` / `add-url`): a `.proto` file or a URL (the file
 * is downloaded into Protos/), what to generate, then the `<Protobuf>` item and the packages. Returns whether the
 * reference was added.
 */
export async function addGrpcReference(projectPath: string, host: GrpcHost = vscodeGrpcHost): Promise<boolean> {
    const projectDir = path.dirname(projectPath);
    const source = await host.pickSource();
    if (!source) {
        return false;
    }
    const projectXml = fs.readFileSync(projectPath, 'utf8');
    const services = await host.pickServices(defaultGrpcServices(projectXml));
    if (!services) {
        return false;
    }
    const protoPath = source.kind === 'file' ? path.resolve(source.path) : path.join(projectDir, PROTOS_FOLDER, protoFileName(source.url));
    const sourceUrl = source.kind === 'url' ? source.url : undefined;
    const reference = protobufReferenceFor(projectDir, protoPath, services, sourceUrl);
    const refusal = duplicateRefusal((await host.items(projectPath))?.protobuf ?? [], projectXml, projectDir, protoPath, reference);
    if (refusal) {
        host.info(refusal);
        return false;
    }

    let downloaded: Buffer | undefined;
    if (sourceUrl) {
        try {
            downloaded = await host.progress(`Downloading ${path.basename(protoPath)}...`, () => host.download(sourceUrl));
        } catch (error) {
            host.log(`Downloading ${sourceUrl} failed: ${error instanceof Error ? error.message : error}`);
            host.fail(`Downloading ${sourceUrl} failed.`);
            return false;
        }
        if (fs.existsSync(protoPath) && contentHash(fs.readFileSync(protoPath)) !== contentHash(downloaded)
            && !await host.ask(`${relative(projectPath, protoPath)} exists already.`, 'Replace it with the downloaded file?', 'Replace')) {
            return false;
        }
    }

    return host.progress(`Adding gRPC reference ${path.basename(protoPath)}...`, async () => {
        if (downloaded) {
            fs.mkdirSync(path.dirname(protoPath), { recursive: true });
            fs.writeFileSync(protoPath, downloaded);
        }
        fs.writeFileSync(projectPath, addProtobufReference(fs.readFileSync(projectPath, 'utf8'), reference));
        host.log(`Added ${relative(projectPath, protoPath)} (${services}) to ${path.basename(projectPath)}`);
        const ids = grpcPackages(services, isWebProject(projectXml), await host.referencedPackages(projectPath));
        const packagesAdded = await addPackages(projectPath, ids, host);
        await host.reevaluate(projectPath);
        if (packagesAdded) {
            host.info(`gRPC reference ${path.basename(protoPath)} added (${services}). The code is generated when the project builds.`);
        } else {
            host.fail(`gRPC reference ${path.basename(protoPath)} added, but adding its packages failed.`);
        }
        return true;
    });
}

const PICK_FILE = 'Browse for .proto File...';
const ENTER_URL = 'Enter URL...';

const SERVICE_DESCRIPTIONS: Record<GrpcServices, string> = {
    Client: 'Client classes to call the services',
    Server: 'Base classes to implement the services',
    Both: 'Client and server classes',
    None: 'Only the message types',
};

export const vscodeGrpcHost: GrpcHost = {
    pickSource: async () => {
        const choice = await vscode.window.showQuickPick([PICK_FILE, ENTER_URL], { placeHolder: 'Where is the service description (.proto)?' });
        if (choice === PICK_FILE) {
            const picked = await vscode.window.showOpenDialog({
                canSelectMany: false, openLabel: 'Add gRPC Reference', filters: { 'Protocol Buffers': ['proto'], 'All files': ['*'] },
            });
            return picked?.[0] ? { kind: 'file', path: picked[0].fsPath } : undefined;
        }
        if (choice === ENTER_URL) {
            const url = await vscode.window.showInputBox({
                prompt: 'Address of the .proto file, e.g. https://raw.githubusercontent.com/.../greet.proto', ignoreFocusOut: true,
                validateInput: value => /^https?:\/\/\S+$/i.test(value.trim()) ? undefined : 'Enter an http(s) URL',
            });
            return url ? { kind: 'url', url: url.trim() } : undefined;
        }
        return undefined;
    },
    pickServices: async preselected => {
        const order: GrpcServices[] = [preselected, ...(['Client', 'Server', 'Both'] as const).filter(services => services !== preselected)];
        const choice = await vscode.window.showQuickPick(
            order.map(services => ({ label: services, description: SERVICE_DESCRIPTIONS[services], services })),
            { placeHolder: 'What to generate?' });
        return choice?.services;
    },
    ask: async (message, detail, button) => await vscode.window.showWarningMessage(message, { modal: true, detail }, button) === button,
    info: message => void vscode.window.showInformationMessage(message),
    fail: message => void showServiceReferenceFailure(message),
    log: line => serviceReferencesOutput().appendLine(line),
    progress: (title, task) => Promise.resolve(vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, task)),
    download: url => download(url),
    items: projectPath => ProjectItemsService.instance.evaluate(projectPath),
    referencedPackages: async projectPath => {
        const packages = await ProjectItemsService.instance.evaluatePackages(projectPath);
        if (packages) {
            return packages.references.map(reference => reference.id);
        }
        // No evaluation: the project file's own references
        return [...fs.readFileSync(projectPath, 'utf8').matchAll(/<PackageReference\b[^>]*\bInclude\s*=\s*"([^"]+)"/gi)].map(match => match[1]);
    },
    latestVersion: async id => {
        const details = await PackageBrowseService.getPackageDetails(id);
        return details ? VersionUtils.findLatest([...(details.versions ?? []), details.currentVersion].filter(Boolean)) ?? undefined : undefined;
    },
    installPackages: async (projectPath, packages) => {
        const outcome = await changePackageVersions(packages.map(entry => ({ id: entry.id, version: entry.version, projects: [projectPath] })));
        return outcome.cancelled ? [{ success: false, message: 'Cancelled: the packages were not added.' }] : outcome.results;
    },
    reevaluate: async projectPath => {
        const project = SolutionService.getActiveSolution()?.getProject(projectPath);
        if (project) {
            await project.reevaluateItems();
        } else {
            ProjectItemsService.instance.invalidate(projectPath);
            await ProjectItemsService.instance.evaluate(projectPath);
        }
    },
};
```

- [ ] **Step 6: The type picker in `src/services/serviceReferences/serviceReferenceService.ts`**

- Replace
```ts
import { workspaceFolderOf } from '../workspaceFolders';

const log = logger('ServiceReferences');

let output: vscode.OutputChannel | undefined;
function outputChannel(): vscode.OutputChannel {
    return output ??= vscode.window.createOutputChannel('Shinobi .NET Studio: Service References');
}
```
with
```ts
import { workspaceFolderOf } from '../workspaceFolders';
import { serviceReferencesOutput as outputChannel, showServiceReferenceFailure as showFailure } from './output';
import { addGrpcReference } from '../grpc/grpcReferenceService';

const log = logger('ServiceReferences');
```
- Delete the local `async function showFailure(message: string): Promise<void> { ... }` (its four-line body moved to `output.ts`).
- Replace the start of `addServiceReference`
```ts
export async function addServiceReference(nodePath: string): Promise<void> {
    const projectPath = projectFor(nodePath);
    if (!projectPath) {
        return;
    }
    const url = 'Enter URL...';
```
with
```ts
const WCF = 'WCF Web Service';
const GRPC = 'gRPC';

/** Visual Studio's choice of service type first; WCF then goes on as before, gRPC to its own flow */
export async function addServiceReference(nodePath: string): Promise<void> {
    const projectPath = projectFor(nodePath);
    if (!projectPath) {
        return;
    }
    const kind = await vscode.window.showQuickPick([
        { label: WCF, description: 'SOAP client from a WSDL, generated with dotnet-svcutil' },
        { label: GRPC, description: 'Client or server code from a .proto file, generated by Grpc.Tools at build' },
    ], { placeHolder: 'Which kind of service?' });
    if (kind?.label === GRPC) {
        await addGrpcReference(projectPath);
    } else if (kind?.label === WCF) {
        await addWcfServiceReference(projectPath);
    }
}

async function addWcfServiceReference(projectPath: string): Promise<void> {
    const url = 'Enter URL...';
```
The rest of the old body stays as it is (it uses `projectPath`, now a parameter).

- [ ] **Step 7: The command's description**

In `src/core/contextMenus.ts` replace the `addServiceReference` entry with:
```ts
    addServiceReference: { title: 'Add Service Reference...', description: 'Asks for the kind of service. WCF Web Service: a SOAP client from a WSDL URL or file, generated with `dotnet-svcutil` into `Connected Services/<Name>/`. gRPC: a `.proto` file or URL becomes a `<Protobuf>` item with the gRPC packages; Grpc.Tools generates the code when the project builds.' },
```
Then `npm run generate:menus`.

- [ ] **Step 8: Run to verify they pass**

Run: `npx jest src/test/unit/services/grpc src/test/unit/services/serviceReferences src/test/unit/core/contextMenus.test.ts`
Expected: PASS (9 + 2 + 2 new tests; the svcutil tests unchanged).

- [ ] **Step 9: Docs**

`docs/connected-services.md`:
- In `## WCF: add`, the first line becomes "Right-click a project or its **Connected Services** folder > **Add Service Reference...** > **WCF Web Service**:".
- In `## gRPC`, before `### In the tree`, add:
```markdown
### Add

Right-click a project or its **Connected Services** node > **Add Service Reference...** > **gRPC**:
1. The service description: **Browse for .proto File...**, or **Enter URL...** (the file is downloaded into the project's `Protos` folder; a file there with other content is replaced only after you confirm).
2. What to generate: **Client**, **Server** or **Both**. Both comes first in web projects (`Microsoft.NET.Sdk.Web`), Client in the others, as with `dotnet-grpc`.

The project file gets the item `dotnet-grpc` writes, formatting kept:
- a file in the project: `<Protobuf Include="Protos\greet.proto" GrpcServices="Client" />`
- a file outside it: `<Protobuf Include="..\shared\greet.proto" GrpcServices="Client" Link="Protos\greet.proto" />` (the tree shows it in Protos)
- from a URL: the item with a `<SourceUrl>` child, which Update uses
- Both leaves `GrpcServices` out (Grpc.Tools' default)

A file the project references already is refused, and so is a second file with the same name from outside the project (both would be shown as `Protos\greet.proto`).

### Packages

Client: `Google.Protobuf`, `Grpc.Net.ClientFactory` (in web projects `Grpc.AspNetCore.Server.ClientFactory`) and `Grpc.Tools` as a private development dependency; Server and Both: `Grpc.AspNetCore`, which brings the rest. Each in its newest stable version on your package sources. Packages the project already references, or gets from one it references, are left alone. With Central Package Management the versions go into `Directory.Packages.props` (see [NuGet](nuget.md#central-package-management)). The C# code is not written by the extension: Grpc.Tools generates it into `obj/` when the project builds.

```

`docs/manual-testing.md`, append unticked:
```markdown
- [ ] Add gRPC reference (copy of `src/__fixtures__/grpc`): right-click Client > Add Service Reference... shows WCF Web Service and gRPC; WCF goes on to the WSDL question as before; gRPC > Browse for .proto File... > `shared/greet.proto` > Client (preselected): `Client.csproj` gets the `Protobuf` item with `Link="Protos\greet.proto"`, `Google.Protobuf`, `Grpc.Net.ClientFactory` and `Grpc.Tools` (with `PrivateAssets`), the tree shows Connected Services > `greet.proto (Client)` and Protos > `greet.proto` with the link badge; `dotnet build` generates `GreeterClient`; adding the same file again says it is already a reference
- [ ] Add gRPC reference from a URL and in a web project: Web > Add Service Reference... > gRPC > Enter URL... > `https://raw.githubusercontent.com/grpc/grpc-dotnet/master/examples/Greeter/Proto/greet.proto` > Both (preselected): `Web/Protos/greet.proto` is downloaded, the item has `<SourceUrl>`, only `Grpc.AspNetCore` is added; with a `Directory.Packages.props` (`ManagePackageVersionsCentrally`) next to `Grpc.slnx`, the versions go there and the projects get `PackageReference`s without `Version`; with no network the error offers Show Output and the project is unchanged
```

- [ ] **Step 10: Verify and commit**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git add src/services/serviceReferences/output.ts src/services/grpc/download.ts src/services/grpc/grpcReferenceService.ts src/services/serviceReferences/serviceReferenceService.ts src/core/contextMenus.ts package.json docs/context-menus.md src/test/unit/services/grpc/grpcReferenceService.test.ts src/test/unit/services/grpc/download.test.ts src/test/unit/services/serviceReferences/serviceReferenceService.test.ts docs/connected-services.md docs/manual-testing.md
git commit -m "gRPC references: Add Service Reference asks WCF or gRPC; add from a .proto file or URL

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: exit 0.

---

### Task 5: Update and Remove; GIF

**Files:**
- Modify: `src/services/grpc/grpcReferenceService.ts`, `src/core/contextMenus.ts`, `src/types/commands/project-action.ts`, `src/services/solutionActionService.ts`
- Generated: `package.json`, `docs/context-menus.md`
- Test: `src/test/unit/services/grpc/grpcReferenceUpdate.test.ts` (create), `src/test/unit/core/contextMenus.test.ts` (extend)
- Docs: `docs/connected-services.md`, `docs/manual-testing.md`, `scripts/screenshots/capture.sh`, `docs/images/grpc.gif`

- [ ] **Step 1: Write the failing tests**

`src/test/unit/services/grpc/grpcReferenceUpdate.test.ts`:
```ts
jest.mock('vscode', () => ({
    window: { createOutputChannel: jest.fn(() => ({ appendLine: jest.fn(), show: jest.fn() })) },
    workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
    ProgressLocation: { Notification: 15 },
    EventEmitter: class { event = jest.fn(); fire = jest.fn(); dispose = jest.fn(); },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
}), { virtual: true });

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GrpcHost, removeGrpcReference, updateGrpcReference } from '../../../../services/grpc/grpcReferenceService';
import { parseMsbuildItems } from '../../../../services/projectItems/projectItems';

const fixture = path.resolve(__dirname, '../../../../__fixtures__/grpc');
const REMOTE_URL = 'https://raw.githubusercontent.com/grpc/grpc-dotnet/master/examples/Greeter/Proto/greet.proto';

/** Update and Remove on the Consumer project of src/__fixtures__/grpc (a linked, a URL and a wildcard reference) */
describe('updateGrpcReference and removeGrpcReference', () => {
    let root: string;
    let consumer: string;
    let dir: string;
    const remote = () => path.join(dir, 'Protos', 'remote.proto');
    const shared = () => path.join(root, 'shared', 'greet.proto');
    const money = () => path.join(dir, 'Contracts', 'money.proto');

    beforeEach(() => {
        root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'grpc-update-')));
        fs.cpSync(fixture, root, { recursive: true });
        dir = path.join(root, 'Consumer');
        consumer = path.join(dir, 'Consumer.csproj');
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    // What MSBuild reports for Consumer.csproj
    const evaluation = () => parseMsbuildItems(JSON.stringify({
        Items: {
            Protobuf: [
                { Identity: '..\\shared\\greet.proto', FullPath: shared(), Link: 'Protos\\greet.proto', GrpcServices: 'Client', DefiningProjectFullPath: consumer },
                { Identity: 'Protos\\remote.proto', FullPath: remote(), GrpcServices: 'Client', SourceUrl: REMOTE_URL, DefiningProjectFullPath: consumer },
                { Identity: 'Contracts/money.proto', FullPath: money(), GrpcServices: 'None', DefiningProjectFullPath: consumer },
            ],
        },
    }), dir);

    const host = (overrides: Partial<GrpcHost> = {}) => {
        const calls = { info: [] as string[], fail: [] as string[], asked: [] as string[], downloaded: [] as string[], reevaluated: [] as string[] };
        const fake: GrpcHost = {
            pickSource: async () => undefined,
            pickServices: async () => undefined,
            ask: async message => { calls.asked.push(message); return true; },
            info: message => { calls.info.push(message); },
            fail: message => { calls.fail.push(message); },
            log: () => undefined,
            progress: (_title, task) => task(),
            download: async url => { calls.downloaded.push(url); return Buffer.from('syntax = "proto3"; // new\n'); },
            items: async () => evaluation(),
            referencedPackages: async () => [],
            latestVersion: async () => undefined,
            installPackages: async () => [],
            reevaluate: async projectPath => { calls.reevaluated.push(projectPath); },
            ...overrides,
        };
        return { fake, calls };
    };

    test('Update downloads from SourceUrl and replaces the file when it differs', async () => {
        const { fake, calls } = host();
        expect(await updateGrpcReference(consumer, remote(), fake)).toBe(true);
        expect(calls.downloaded).toEqual([REMOTE_URL]);
        expect(fs.readFileSync(remote(), 'utf8')).toBe('syntax = "proto3"; // new\n');
        expect(calls.info).toEqual([`remote.proto updated from ${REMOTE_URL}. The code is generated again when the project builds.`]);
    });

    test('Update with the same content leaves the file alone (its time stamp too)', async () => {
        const stamp = new Date(2020, 0, 1);
        fs.utimesSync(remote(), stamp, stamp);
        const same = fs.readFileSync(remote());
        const { fake, calls } = host({ download: async () => same });
        expect(await updateGrpcReference(consumer, remote(), fake)).toBe(false);
        expect(calls.info).toEqual(['remote.proto is up to date.']);
        expect(fs.statSync(remote()).mtimeMs).toBe(stamp.getTime());
    });

    test('Update of a reference without a URL, or a failed download, changes nothing', async () => {
        const before = fs.readFileSync(remote(), 'utf8');
        const local = host();
        expect(await updateGrpcReference(consumer, shared(), local.fake)).toBe(false);
        expect(local.calls.info).toEqual(['greet.proto was not added from a URL: there is nothing to update it from.']);
        const failing = host({ download: async () => { throw new Error('404'); } });
        expect(await updateGrpcReference(consumer, remote(), failing.fake)).toBe(false);
        expect(failing.calls.fail).toEqual([`Updating remote.proto failed: ${REMOTE_URL} could not be downloaded.`]);
        expect(fs.readFileSync(remote(), 'utf8')).toBe(before);
    });

    test('Remove asks, takes the item out (the block with SourceUrl too) and keeps the file', async () => {
        const { fake, calls } = host();
        expect(await removeGrpcReference(consumer, remote(), fake)).toBe(true);
        expect(calls.asked).toEqual(["Remove the gRPC reference 'remote.proto'?"]);
        const content = fs.readFileSync(consumer, 'utf8');
        expect(content).not.toContain('remote.proto');
        expect(content).not.toContain('SourceUrl');
        expect(content).toContain('<Protobuf Include="..\\shared\\greet.proto"');
        expect(fs.existsSync(remote())).toBe(true);
        expect(calls.reevaluated).toEqual([consumer]);
    });

    test('Remove answered with Cancel changes nothing', async () => {
        const before = fs.readFileSync(consumer, 'utf8');
        const { fake } = host({ ask: async () => false });
        expect(await removeGrpcReference(consumer, shared(), fake)).toBe(false);
        expect(fs.readFileSync(consumer, 'utf8')).toBe(before);
    });

    test('Remove of a file a wildcard includes is refused with what to do', async () => {
        const before = fs.readFileSync(consumer, 'utf8');
        const { fake, calls } = host();
        expect(await removeGrpcReference(consumer, money(), fake)).toBe(false);
        expect(calls.asked).toEqual([]);
        expect(calls.info).toEqual(['money.proto is not listed by itself in Consumer.csproj (a wildcard such as Protos\\*.proto includes it): edit the project file.']);
        expect(fs.readFileSync(consumer, 'utf8')).toBe(before);
    });
});
```

In `src/test/unit/core/contextMenus.test.ts`, before `it('offers the Debug submenu on projects that can be started` add:
```ts
    it('offers Open and Remove on gRPC references, Update only on those added from a URL, Add on the Connected Services node', () => {
        const { webviewContext } = buildMenuContributions();
        const when = (command: string) => webviewContext.filter(e => e.command === `shinobi.solutionExplorer.${command}`).map(e => e.when.replace(/^.*webviewSection == 'node' && /, ''));
        expect(when('updateGrpcReference')).toEqual(["nodeType == 'grpcReference' && contextValue == 'url'"]);
        expect(when('removeGrpcReference')).toEqual(["nodeType == 'grpcReference'"]);
        expect(when('openFile')).toContain("nodeType == 'grpcReference'");
        expect(when('addServiceReference')).toContain("nodeType == 'connectedServices'");
    });

```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/test/unit/services/grpc/grpcReferenceUpdate.test.ts src/test/unit/core/contextMenus.test.ts`
Expected: FAIL (`updateGrpcReference` / `removeGrpcReference` are not exported; no `updateGrpcReference` menu entries).

- [ ] **Step 3: Update and Remove in `src/services/grpc/grpcReferenceService.ts`**

- Replace `import { ProjectItems } from '../projectItems/projectItems';` with `import { pathKey, ProjectItems } from '../projectItems/projectItems';`.
- In the import from `./protobufReferences`, replace `    protobufReferenceFor, protoFileName, PROTOS_FOLDER,` with `    notListedMessage, protobufReferenceFor, protoFileName, PROTOS_FOLDER, removeProtobufReference,`.
- Before `const PICK_FILE = 'Browse for .proto File...';` add:
```ts
const sameFile = (a: string, b: string) => pathKey(path.normalize(a)) === pathKey(path.normalize(b));

/**
 * Update of a reference added from a URL (`dotnet-grpc refresh`): downloads it again from its `SourceUrl` and replaces
 * the local file only when the content differs. Returns whether the file changed.
 */
export async function updateGrpcReference(projectPath: string, protoPath: string, host: GrpcHost = vscodeGrpcHost): Promise<boolean> {
    const name = path.basename(protoPath);
    const item = (await host.items(projectPath))?.protobuf.find(candidate => sameFile(candidate.fullPath, protoPath));
    if (!item?.sourceUrl) {
        host.info(`${name} was not added from a URL: there is nothing to update it from.`);
        return false;
    }
    const sourceUrl = item.sourceUrl;
    let downloaded: Buffer;
    try {
        downloaded = await host.progress(`Updating ${name}...`, () => host.download(sourceUrl));
    } catch (error) {
        host.log(`Downloading ${sourceUrl} failed: ${error instanceof Error ? error.message : error}`);
        host.fail(`Updating ${name} failed: ${sourceUrl} could not be downloaded.`);
        return false;
    }
    if (fs.existsSync(protoPath) && contentHash(fs.readFileSync(protoPath)) === contentHash(downloaded)) {
        host.info(`${name} is up to date.`);
        return false;
    }
    fs.mkdirSync(path.dirname(protoPath), { recursive: true });
    fs.writeFileSync(protoPath, downloaded);
    host.log(`Updated ${relative(projectPath, protoPath)} from ${sourceUrl}`);
    host.info(`${name} updated from ${sourceUrl}. The code is generated again when the project builds.`);
    return true;
}

/**
 * Remove (`dotnet-grpc remove`): takes the `<Protobuf>` item out of the project file after asking. The `.proto` file and
 * the packages stay. Refused with a message when the project file does not list the file by itself.
 */
export async function removeGrpcReference(projectPath: string, protoPath: string, host: GrpcHost = vscodeGrpcHost): Promise<boolean> {
    const name = path.basename(protoPath);
    const projectDir = path.dirname(projectPath);
    const listed = (content: string) => removeProtobufReference(content, projectDir, protoPath) !== content;
    if (!listed(fs.readFileSync(projectPath, 'utf8'))) {
        const item = (await host.items(projectPath))?.protobuf.find(candidate => sameFile(candidate.fullPath, protoPath));
        host.info(notListedMessage(item, projectPath, protoPath));
        return false;
    }
    if (!await host.ask(`Remove the gRPC reference '${name}'?`, `The <Protobuf> item leaves ${path.basename(projectPath)}; ${name} and the gRPC packages stay.`, 'Remove')) {
        return false;
    }
    // Read again: the project file may have changed while the question was open
    const content = fs.readFileSync(projectPath, 'utf8');
    if (!listed(content)) {
        return false;
    }
    fs.writeFileSync(projectPath, removeProtobufReference(content, projectDir, protoPath));
    host.log(`Removed the gRPC reference ${relative(projectPath, protoPath)} from ${path.basename(projectPath)}`);
    await host.reevaluate(projectPath);
    return true;
}

```

- [ ] **Step 4: Commands, menus, actions, routing**

`src/core/contextMenus.ts`:
- After the `removeServiceReference` command add:
```ts
    updateGrpcReference: { title: 'Update gRPC Reference', description: 'Downloads the `.proto` file again from the URL it was added from (`SourceUrl`) and replaces the local file only when it changed.' },
    removeGrpcReference: { title: 'Remove gRPC Reference', description: 'Removes the `<Protobuf>` item from the project file after asking; the `.proto` file and the gRPC packages stay.' },
```
- Replace the `grpcReference` menu of Task 3 with:
```ts
    grpcReference: [
        ['openFile'],
        [], // updateGrpcReference on references added from a URL
        ['removeGrpcReference'],
    ],
    [`grpcReference.${GRPC_URL_REFERENCE}`]: [
        [], ['updateGrpcReference'],
    ],
```
- In `conditionNames`, after the `'folder.serviceReference'` entry add:
```ts
    [`grpcReference.${GRPC_URL_REFERENCE}`]: 'On a gRPC reference added from a URL',
```

`src/types/commands/project-action.ts`: before `export declare type ChooseLaunchProfileActionCmd = {` add
```ts
export declare type UpdateGrpcReferenceActionCmd = {
    readonly action: 'updateGrpcReference';
    readonly nodeId: NodeIdString;
}

export declare type RemoveGrpcReferenceActionCmd = {
    readonly action: 'removeGrpcReference';
    readonly nodeId: NodeIdString;
}

```
and in `ProjectActionCmd`, after `    | RemoveServiceReferenceActionCmd` add `    | UpdateGrpcReferenceActionCmd` and `    | RemoveGrpcReferenceActionCmd`.

`src/services/solutionActionService.ts`: after the `serviceReferenceService` import add `import { removeGrpcReference, updateGrpcReference } from './grpc/grpcReferenceService';`; after the `case 'removeServiceReference':` block add
```ts

            case 'updateGrpcReference':
                if (nodeId.type === 'grpcReference') {
                    await updateGrpcReference(nodeId.project, nodeId.path);
                }
                break;

            case 'removeGrpcReference':
                if (nodeId.type === 'grpcReference') {
                    await removeGrpcReference(nodeId.project, nodeId.path);
                }
                break;
```
`nativeContextMenu.ts` registers every `menuCommands` entry and `runNodeAction` forwards it as a `projectAction`: nothing to add there.

Then `npm run generate:menus`.

- [ ] **Step 5: Run to verify they pass**

Run: `npx jest src/test/unit/services/grpc src/test/unit/core/contextMenus.test.ts`
Expected: PASS (6 + 1 new tests; 48 in `src/test/unit/services/grpc`). `docs/context-menus.md` now shows Open and Remove gRPC Reference on gRPC references and, "On a gRPC reference added from a URL", Update gRPC Reference.

- [ ] **Step 6: Docs and GIF scene**

`docs/connected-services.md`, in `## gRPC` after `### In the tree` append:
```markdown

### Update and remove

Right-click the reference in Connected Services:
- **Update gRPC Reference** (references added from a URL) downloads the file again from its `SourceUrl` and replaces the local copy only when the content changed; the code follows with the next build.
- **Remove gRPC Reference** takes the `<Protobuf>` item out of the project file after asking. The `.proto` file and the packages stay, as with `dotnet-grpc remove`. A file that a wildcard (`Protos\*.proto`) or a props file includes cannot be removed this way: the message says where it comes from.

![Adding a gRPC reference from a URL, then updating it](images/grpc.gif)
```

`docs/manual-testing.md`, append unticked:
```markdown
- [ ] Update and Remove gRPC references (copy of `src/__fixtures__/grpc`, Consumer): `remote.proto (Client)` has Update gRPC Reference, `greet.proto` and `money.proto` do not; Update replaces `Protos/remote.proto` with the file from GitHub and says so, a second Update says it is up to date (the file's time stamp stays); Remove on `remote.proto` asks, then the whole `<Protobuf>` block with `<SourceUrl>` leaves `Consumer.csproj` (formatting kept) and the file stays on disk; Remove on `money.proto` says the wildcard `Contracts\*.proto` includes it and changes nothing; removing the last reference takes the Connected Services node away; the GIF `docs/images/grpc.gif` matches what the extension shows
```

`scripts/screenshots/capture.sh`: add `gif-grpc` to the end of the default `SCENES` list (after `gif-central-packages`), and before the final `echo "Done: $OUT"` add:
```bash
if wants gif-grpc; then
    echo "Scene: gif-grpc"
    # Shop.Web gets a gRPC reference from a URL in the work copy; the project file is put back and Protos deleted afterwards
    cp "$SOLUTION/src/Shop.Web/Shop.Web.csproj" "$WORK/Shop.Web.csproj.orig"
    reset
    command "Notifications: Clear All Notifications" 1
    record_start
    # Add Service Reference... is the fifth item of the second group, about 172 px below the click (check on the first run)
    shop_web_menu 172
    pause 1.5
    # The kind of service, the source, the URL, what to generate (Both comes first in a web project)
    type_text "gRPC"; key Return; pause 1.5
    type_text "Enter URL"; key Return; pause 1.5
    type_text "https://raw.githubusercontent.com/grpc/grpc-dotnet/master/examples/Greeter/Proto/greet.proto"; key Return; pause 1.5
    key Return
    # Download, Grpc.AspNetCore with its restore, the evaluation
    pause 25
    # Shop.Web is open now: Connected Services is its first row, greet.proto (Both) the first row in it
    y="$(shop_web_y)"
    click 200 $(( y + 20 )); key Right; pause 2
    click 200 $(( y + 40 )); pause 1
    # Update gRPC Reference: second item, below Open and a separator (about 48 px, check on the first run)
    click 200 $(( y + 40 )) 3; pause 1.5
    click 280 $(( y + 88 )); pause 4
    xdotool mousemove 1000 400; pause 1
    record_stop grpc
    command "Notifications: Clear All Notifications" 1
    cp "$WORK/Shop.Web.csproj.orig" "$SOLUTION/src/Shop.Web/Shop.Web.csproj"
    rm -rf "$SOLUTION/src/Shop.Web/Protos"
    (cd "$SOLUTION" && dotnet restore Contoso.slnx -v q -nologo >/dev/null)
    sleep 5
    command "View: Close All Editors" 1
fi
```
Run it (needs Xvfb, xdotool, ffmpeg, network): `npm run build:dev && SCENES=gif-grpc scripts/screenshots/capture.sh`, look at `docs/images/grpc.gif` and correct the two menu offsets (172 and 48) if a click missed (they are estimated from `docs/images/context-menu.png`: rows about 24.8 px, separators about 9.5 px, Manage NuGet Packages at 327 and Publish at 541 fit that). The GIF is part of this commit; if no display is available, leave the scene in, commit without the GIF and say so in the report (the manual-testing entry stays unticked either way).

- [ ] **Step 7: Verify and commit**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git add src/services/grpc/grpcReferenceService.ts src/core/contextMenus.ts src/types/commands/project-action.ts src/services/solutionActionService.ts package.json docs/context-menus.md src/test/unit/services/grpc/grpcReferenceUpdate.test.ts src/test/unit/core/contextMenus.test.ts docs/connected-services.md docs/manual-testing.md scripts/screenshots/capture.sh docs/images/grpc.gif
git commit -m "gRPC references: Update from the source URL, Remove; GIF

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: exit 0 (planning run: 156 suites, 1325 tests).

---

### Task 6: Roadmap, history, README; final verification and push

**Files:**
- Modify: `docs/roadmap.md`, `docs/history.md`, `README.md`, `docs/README.md`, `docs/connected-services.md` (check only)

- [ ] **Step 1: Roadmap and history**

Phase 21 has only this item, so the phase is done: move it from `docs/roadmap.md` to the end of `docs/history.md` (after Phase 20), ticked and with what was built:
```markdown
## Phase 21: Connected Services, Part 2
**Goal**: gRPC references next to the WCF ones, like Visual Studio's "Add Connected Service > gRPC".

- [x] gRPC references from `.proto` files without `dotnet-grpc`: Add Service Reference asks WCF Web Service or gRPC first (the WCF flow is unchanged), gRPC takes a `.proto` file or a URL (downloaded into `Protos/`) and Client, Server or Both (Both first in web projects), writes the `<Protobuf>` item `dotnet-grpc` writes (`Link` for files outside the project, `<SourceUrl>` for URLs, formatting kept) and adds the packages through the Central Package Management aware installs of Phase 20 (Grpc.Tools as a private development dependency; packages already there, or brought by `Grpc.AspNetCore`, left alone). The project evaluation keeps `GrpcServices`, `Link` and `SourceUrl`, so Connected Services lists every `Protobuf` item, also without a `Connected Services` folder on disk; Update downloads URL references again and replaces the file only when it changed, Remove takes the item out and keeps the file
- Dropped: OpenAPI clients (`<OpenApiReference>` and `dotnet openapi` are deprecated in .NET 10; see Not Planned in the roadmap)
```
In `docs/roadmap.md`: remove the "## Phase 21: Connected Services, Part 2" section; the intro becomes "Phases 1–21 are done (see [History](history.md)): web apps, SOAP clients, templates, tests, private feeds, the Visual Studio basics, publishing, readiness for others, solutions, projects and configurations, code cleanup and refactoring, and the second rounds for run & debug, for the Solution Explorer, for NuGet and for connected services. Phase 22 is quality and documentation, phase 30 what may come later, phase 31 the other publish targets." If "Not Planned" has no OpenAPI entry yet, add: "- OpenAPI clients: Microsoft deprecated `<OpenApiReference>` and `dotnet openapi` in .NET 10 and recommends the generators' own tools (NSwag, Kiota, OpenAPI Generator; Kiota has a VS Code extension). To be built if someone opens an issue". Under "Known limitations" add:
```markdown
- [ ] gRPC references: Update only works for references added from a URL (`SourceUrl`); a local `.proto` is the file itself
- [ ] gRPC references: the Connected Services node of a project without that folder becomes the folder once a WCF reference creates it (its expansion state is not carried over)
- [ ] gRPC references: the packages come in the newest stable version on the configured sources; a project that pins an older `Google.Protobuf` may need it raised by hand (NU1605 at restore)
```

- [ ] **Step 2: README and docs index**

`README.md`, the Connected Services paragraph becomes:
```markdown
Add, update and remove WCF/SOAP service references, compatible with the ones Visual Studio made, and gRPC references from `.proto` files or URLs (client, server or both, with the packages).
```
`docs/README.md`: the Connected Services row's description becomes `WCF/SOAP service references and gRPC references`. Nothing else: the README stays a store page.

- [ ] **Step 3: Read the gRPC docs once more**

Read `docs/connected-services.md` from top to bottom: Tasks 3, 4 and 5 each added a part; check the order (intro, WCF sections, gRPC: Add, Packages, In the tree, Update and remove with the GIF) and that no sentence says something Tasks 1–5 did not build. Check the anchor `nuget.md#central-package-management` exists.

- [ ] **Step 4: Final verification and push**

```bash
npm run typecheck && npm test && npm run build:dev; echo "exit $?"
git status --short
git add docs/roadmap.md docs/history.md README.md docs/README.md docs/connected-services.md
git commit -m "Phase 21: gRPC references done

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push origin master
```
Expected: exit 0; `git status --short` shows nothing of this work (other agents' files may remain). After the push check that the GitHub pipeline is green (Windows included): `gh run list --limit 1`, then `gh run watch` if it is still running. Windows watch-outs: the tests build paths with `path.join`/`path.resolve`; `ProtobufItem.fullPath` and `definedIn` are `path.normalize`d; the real build test needs nuget.org (CI has it) and the .NET 8 SDK (installed in CI).

---

## Self-review (done while writing)

- **Spec coverage:** Add through the type picker with source (file or URL) and Client/Server/Both, default Both for web projects (Task 4: `defaultGrpcServices`, `pickServices`); one node per `.proto` in Connected Services, also without the folder (Task 3); Update for URL references with hash compare, replacing only when different (Task 5, `contentHash`); Remove keeps the file (Task 5); the text edit through the `ProjectFileEditor` helpers, `Link` for outside files, refused duplicates (Task 2); the packages, CPM aware via `changePackageVersions`, existing ones left alone (Tasks 2 and 4); URL source into `Protos/` created if needed, `SourceUrl` remembered (Tasks 2, 4); no code generated by us (Grpc.Tools at build, real build test in Task 2). Design: `protobufReferences.ts` without `vscode`, reading the items from `ProjectItemsService` (Task 1 extends the parse, `ITEM_TYPES` already lists `Protobuf`), `grpcReferenceService.ts` with native modals, progress and errors, registered next to `serviceReferenceService.ts`; menus via `contextMenus.ts` + `generate:menus` (Tasks 3–5; `addGrpcReference` is not a menu command, as the spec says); tree nodes; ids opaque to the webview. Testing: pure edit tests incl. formatting, CRLF, `Link`, duplicates, escaping (Task 2); real MSBuild after the edit and a real `dotnet build` generating the client (Task 2, skipped without `dotnet` or network); host service with injected downloader, pickers and installer (Tasks 4–5); a tree test (Task 3). Docs: the gRPC section, the `gif-grpc` scene and `docs/images/grpc.gif`, unticked manual checks, roadmap to history (Tasks 3–6).
- **Spec corrections:** `SourceUrl` is a child element, not an attribute; `Link` is an attribute (the spec's "Link element"); Client takes `Grpc.Net.ClientFactory` (with `Grpc.Net.Client` through it), and web projects' Client takes `Grpc.AspNetCore.Server.ClientFactory`; `Grpc.AspNetCore` is not only for web projects but for every Server/Both reference (as `dotnet-grpc`).
- **Placeholders:** none in code. The only values to tune at implementation time are the two menu offsets of the GIF scene (Task 5, Step 6).
- **Type consistency:** `ProtobufItem` (Task 1) is used by `protobufReferences` (`servicesOf`, `referenceLabel`, `duplicateRefusal`, `notListedMessage`), `grpcNodes` and the host service; `GrpcServices`/`NewProtobufReference` (Task 2) by the host; `GRPC_URL_REFERENCE` (Task 3) by `grpcNodes` and the menus of Task 5; `ConnectedServicesNodeId`/`GrpcReferenceNodeId` (Task 3) by `grpcNodes`, `Project`, `solutionActionService` (`nodeId.project`, `nodeId.path`); `GrpcHost` (Task 4) by `updateGrpcReference`/`removeGrpcReference` (Task 5) and both test files; the action names `updateGrpcReference`/`removeGrpcReference` match in `menuCommands`, `ProjectActionCmd` and the routing.
- **Order:** each task leaves the build green: Task 3's menus only reference existing commands (`addServiceReference`, `openFile`); Task 4's service file has no Update/Remove yet (no unused imports); Task 5 adds them together with the commands that call them.
