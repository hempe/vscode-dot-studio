# Phase 4: Service References (SOAP) — Design

Visual Studio's "Add Service Reference / Connected Service" workflow for WCF/SOAP clients, on top of `dotnet-svcutil`, compatible in both directions with references created in Visual Studio.

## Findings (dotnet-svcutil 8.0.0, verified)

- Needs the .NET 9 runtime; with `DOTNET_ROLL_FORWARD=Major` it runs on .NET 10. Always set it (and `DOTNET_SVCUTIL_TELEMETRY_OPTOUT=1`) for the spawned process.
- Generating from a WSDL takes about 1 s.
- `dotnet-svcutil.params.json` (`{ providerId, version, options }`) has the same keys in `options` as Visual Studio's `ConnectedService.json` `ExtendedData` (`inputs`, `collectionTypes`, `messageContract`, `namespaceMappings`, `outputFile`, `targetFramework`, `typeReuseMode`, `references`, ...). `inputs` are relative to the reference folder.
- `dotnet-svcutil --update "Connected Services/<Name>"` (run in the project directory) regenerates from the params file in that folder and respects edited options. `--update <Name>` alone looks directly under the project directory and fails.
- svcutil always finds the project (also when run inside the folder) and adds `System.ServiceModel.Duplex/Http/NetTcp/Security/Federation` `4.10.*`, which pull a vulnerable `System.Security.Cryptography.Pkcs` and are partly deprecated. The generated client builds with `System.ServiceModel.Http` and `System.ServiceModel.Primitives` 10.x alone (for `BasicHttpBinding`).

Visual Studio reference (from a real project):

```json
{
  "ProviderId": "Microsoft.VisualStudio.ConnectedService.Wcf",
  "Version": "15.0.40203.910",
  "ExtendedData": {
    "inputs": ["CardOperations.wsdl"],
    "collectionTypes": ["System.Array", "System.Collections.Generic.Dictionary`2"],
    "messageContract": true,
    "namespaceMappings": ["*, CardOperations"],
    "targetFramework": "net471",
    "typeReuseMode": "None"
  }
}
```

The project file has `<WCFMetadata Include="Connected Services" />`. The same project ported to net10.0 by hand keeps it and references exactly `System.ServiceModel.Primitives` and `System.ServiceModel.Http` `10.0.652802` (fixed versions), which is what step 7 below adds.

Fixtures: `src/__fixtures__/service-references/PayLoop/` (the net471 project, its `ConnectedService.json` and the CardOperations WSDL with SOAP 1.1 and 1.2 bindings).

Generated code compared with Visual Studio's `Reference.cs` for the same WSDL and options: identical structure (message contracts, `ArrayOfString : List<string>`, `Package[]`, both endpoint configurations). Differences:
- `GeneratedCodeAttribute("Microsoft.Tools.ServiceModel.Svcutil", ...)` says `8.0.0` instead of Visual Studio's `2.0.2`, on every type.
- svcutil 8.0.0 wraps the generated `CloseAsync()` in `#if !NET6_0_OR_GREATER`; with the 2.0.2 output it hides `ClientBase<T>.CloseAsync()` on modern .NET (CS0108, which the real project had to suppress with `NoWarn`).
- svcutil 8.0.0 writes a UTF-8 BOM.

## 1. Solution Explorer

- "Add Service Reference..." on SDK-style project nodes and on a project's `Connected Services` folder.
- A folder directly under `<project>/Connected Services/` that contains `ConnectedService.json` or `dotnet-svcutil.params.json` is a service reference: folder nodes get `contextValue: 'serviceReference'` and the menu entries "Update Service Reference" and "Remove Service Reference". Otherwise it stays a normal folder; `Reference.cs` and the `.wsdl` show as files.
- The `Connected Services` folder itself gets `contextValue: 'connectedServices'` for its "Add Service Reference..." entry.

## 2. Add

Native inputs only (no webview):

1. Quick pick: "Enter URL..." (input box) or "Browse for WSDL file..." (open dialog, `*.wsdl`, `*.xml`, all files). A local file is copied into the reference folder and used as a relative input.
2. Name: input box, suggested from the WSDL file name or the last URL path segment without extension/query (`CardOperations.asmx?WSDL` → `CardOperations`); must be a valid folder name and not exist yet under `Connected Services/`.
3. Namespace: input box, default = name.

Options: `collectionTypes` `System.Array` and ``System.Collections.Generic.Dictionary`2`` (Visual Studio's defaults), `typeReuseMode: None` (`All` makes svcutil build the project first: slower, fails when the project doesn't build), `outputFile: Reference.cs`, `targetFramework` = the project's (first) target framework. Further options are edited in `ConnectedService.json` followed by Update, as in Visual Studio.

The new reference is written in Visual Studio's format (`ConnectedService.json`).

## 3. Generate / Update (one code path)

1. Create a temporary folder, write `dotnet-svcutil.params.json` from the metadata (Visual Studio's `ExtendedData` → `options`; `targetFramework` set to the project's current framework, so updating a ported `net471` reference regenerates it for the new framework) and copy local inputs into it.
2. Remember the project file's text.
3. Run `dotnet-svcutil --update "<temp folder relative to the project>" --noLogo` in the project directory, behind a progress notification; output goes to the "Shinobi .NET: Service References" output channel.
4. Restore the project file's text exactly.
5. On success, copy the generated files into `Connected Services/<Name>/` and write the metadata back: `ConnectedService.json` keeps its `ProviderId` and `Version` (new ones get Visual Studio's) with `ExtendedData` = svcutil's resulting `options`. A reference that only had `dotnet-svcutil.params.json` (created with the CLI) keeps that format. The params file is not left next to a `ConnectedService.json`.
6. Add `<WCFMetadata Include="Connected Services" />` when missing.
7. Modern target frameworks only: add the latest stable `System.ServiceModel.Http` and `System.ServiceModel.Primitives`, and `System.ServiceModel.NetTcp` when `Reference.cs` uses `NetTcpBinding`, through the existing NuGet code, skipping packages the project already references. .NET Framework targets get no packages.
8. Remove the temporary folder.

The temporary folder lives inside the project directory (svcutil resolves the project from the working directory) and is named so it is skipped by the tree and watchers, e.g. `obj/shinobi-svcutil-<random>/`.

## 4. Remove

Confirmation dialog, then delete the reference folder (and `Connected Services/` when it becomes empty, together with its `WCFMetadata` item). Packages stay, because other code may use them; Visual Studio doesn't remove them either.

## 5. Missing dotnet-svcutil

Looked up in the local tool manifest (`dotnet tool list` in the project directory, run as `dotnet dotnet-svcutil`) and then the global tools (`dotnet tool list -g`, run as `dotnet-svcutil`). When missing, offer:

- "Install for this Repository" (recommended; the team gets the same version through `.config/dotnet-tools.json`): `dotnet new tool-manifest` in the workspace folder when none exists, then `dotnet tool install dotnet-svcutil`
- "Install Globally": `dotnet tool install -g dotnet-svcutil`

## 6. Errors

- svcutil fails (bad WSDL, unreachable URL, exit code ≠ 0 or no `Reference.cs`): the project file is restored, the existing reference stays untouched (generation happens in the temporary folder), and an error message offers "Show Output".
- Malformed `ConnectedService.json`: error naming the file; nothing runs.

## 7. Tests

- Unit: `ConnectedService.json` ⇄ params mapping (the real file above as fixture), service reference folder detection, package selection, name suggestion from URLs and file names.
- Integration (skipped when `dotnet-svcutil` isn't installed): add a reference from a reduced CardOperations WSDL to a temporary project and check `Reference.cs`, `ConnectedService.json`, the restored project file plus `WCFMetadata` and packages; update after editing `messageContract`; a failing update keeps the old files.
- Manual: a `SoapClient` console project in ApiDotNetTestProject that references the CardOperations WSDL.

## Out of scope

- A dialog for svcutil's advanced options (edit `ConnectedService.json` instead)
- Service references for .NET Framework projects beyond keeping their files intact
- OpenAPI / gRPC connected services
