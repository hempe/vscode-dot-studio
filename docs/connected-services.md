# Connected Services

WCF/SOAP service references, like Visual Studio's "Add Service Reference" (WCF Web Service Reference provider), and gRPC references, like Visual Studio's "Add Connected Service > gRPC". Visual Studio's WCF provider is a front end for `dotnet-svcutil`, and so is this one; gRPC references are `<Protobuf>` items, which the Grpc.Tools package turns into C# code when the project builds.

## WCF: add

Right-click a project or its **Connected Services** folder > **Add Service Reference...**:
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

### In the tree

Every `<Protobuf>` item of a project is a gRPC reference: Connected Services lists one node per `.proto` file with what it generates, e.g. `greet.proto (Client)` (`Both` when the item does not say: that is Grpc.Tools' default). A project without a `Connected Services` folder gets the node anyway, at the top as in Visual Studio. References made by Visual Studio or `dotnet-grpc`, and those written by hand, show the same way. Double-click (or Enter) opens the `.proto` file.
