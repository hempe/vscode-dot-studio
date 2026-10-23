# Connected Services

WCF/SOAP service references, like Visual Studio's "Add Service Reference" (WCF Web Service Reference provider), and gRPC references, like Visual Studio's "Add Connected Service > gRPC". Visual Studio's WCF provider is a front end for `dotnet-svcutil`, and so is this one; gRPC references are `<Protobuf>` items, which the Grpc.Tools package turns into C# code when the project builds.

## WCF: add

Right-click a project or its **Connected Services** folder > **Add Service Reference...** > **WCF Web Service**:
1. The WSDL: a URL, or **Browse for WSDL File...**
2. The reference's name (its folder) and the namespace of the generated client.

The client is generated into `Connected Services/<Name>/` with Visual Studio's `ConnectedService.json`, the project gets the `WCFMetadata` item and the current `System.ServiceModel.Http` and `System.ServiceModel.Primitives` packages.

## WCF: update and remove

Right-click the reference's folder (in Connected Services):
- **Update Service Reference** generates the client again from its WSDL, for the project's current target framework. References Visual Studio made work too; options such as `messageContract` are kept in `ConnectedService.json`, where Visual Studio keeps them.
- **Remove Service Reference** deletes the reference's folder after asking; the WCF packages stay.

## WCF: dotnet-svcutil

If `dotnet-svcutil` is missing, you are offered to install it **for the repository** (a tool manifest, `.config/dotnet-tools.json`, so the team gets the same version) or **globally**. svcutil 8 needs .NET 9 or later.

## WCF: known issues

- Updating a reference Visual Studio made changes the generator version written into `Reference.cs` (svcutil 8.0.0 instead of Visual Studio's 2.0.2).
- svcutil can't read .NET Framework assembly references (`<Reference Include="System.ServiceModel" />`); remove them from projects ported from .NET Framework before updating a reference.

## gRPC

### Add

Right-click a project or its **Connected Services** node > **Add Service Reference...** > **gRPC**:
1. The service description: **Browse for .proto File...**, or **Enter URL...** (the file is downloaded into the project's `Protos` folder; a file there with other content is replaced only after you confirm). The download can be cancelled from its notification and gives up after 30 seconds; an answer that is a web page (a sign-in page, say), empty or larger than 5 MB is refused and nothing changes, and so is a redirect from https to http. Credentials in the URL (`https://user:password@...` or a token in the query) are sent but not shown in messages or the output; the project file keeps the URL as you entered it, as `dotnet-grpc` does.
2. What to generate: **Client**, **Server** or **Both**. Both comes first in web projects (`Microsoft.NET.Sdk.Web`), Client in the others, as with `dotnet-grpc`.

The project file gets the item `dotnet-grpc` writes, formatting kept:
- a file in the project: `<Protobuf Include="Protos\greet.proto" GrpcServices="Client" />`
- a file outside it: `<Protobuf Include="..\shared\greet.proto" GrpcServices="Client" Link="Protos\greet.proto" />` (the tree shows it in Protos)
- from a URL: the item with a `<SourceUrl>` child, which Update uses
- it goes after the last `<Protobuf>` item that is in an ItemGroup without a Condition (and not in a Choose), so it counts for every target framework and configuration
- Both leaves `GrpcServices` out (Grpc.Tools' default)

A file the project references already is refused, and so is a second file with the same name from outside the project, or a download to `Protos\greet.proto` while a linked file is shown there (both would be shown as `Protos\greet.proto`).

If adding the packages fails (no network, say), the item stays in the project file and the error says so: add the same reference again once the package sources can be reached, and only the missing packages are added.

### Packages

Client: `Google.Protobuf`, `Grpc.Net.ClientFactory` (in web projects `Grpc.AspNetCore.Server.ClientFactory`) and `Grpc.Tools` as a private development dependency; Server and Both: `Grpc.AspNetCore`, which brings the rest. Each in its newest stable version on your package sources. Packages the project already references, or gets from one it references, are left alone. With Central Package Management the versions go into `Directory.Packages.props` (see [NuGet](nuget.md#central-package-management)). The C# code is not written by the extension: Grpc.Tools generates it into `obj/` when the project builds.

### In the tree

Every `<Protobuf>` item of a project is a gRPC reference: Connected Services lists one node per `.proto` file with what it generates, e.g. `greet.proto (Client)` (`Both` when the item does not say: that is Grpc.Tools' default). A project without a `Connected Services` folder gets the node anyway, at the top as in Visual Studio. References made by Visual Studio or `dotnet-grpc`, and those written by hand, show the same way. Double-click (or Enter) opens the `.proto` file.

### Update and remove

Right-click the reference in Connected Services:
- **Update gRPC Reference** (references added from a URL) downloads the file again from its `SourceUrl`, exactly as written in the project file (escapes such as `%2B` in a signed URL stay), and replaces the local copy only when the content changed; the code follows with the next build. The download is checked as for Add: a web page or an empty answer leaves the local file as it was.
- **Remove gRPC Reference** takes the `<Protobuf>` item out of the project file after asking. The `.proto` file and the packages stay, as with `dotnet-grpc remove`. A file that a wildcard (`Protos\*.proto`), an Include built from MSBuild properties (`$(ProtoDir)\greet.proto`) or a props file includes cannot be removed this way: the message says where it comes from.

![Adding a gRPC reference from a URL, then updating and removing it](images/grpc.gif)
