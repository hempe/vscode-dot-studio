# Changelog

## 0.1.0

Initial release. Visual Studio's tools for .NET in VS Code and VSCodium:

- **Solution Explorer** for `.sln` and `.slnx`: solution folders and items, Visual Studio's file nesting (Off / Default / Web), your file icon theme, error markers, Dependencies with transitive packages, analyzers and source-generated code, Sync with Active Document, Collapse All, Visual Studio's context menus and keys; offers to convert `.sln` to `.slnx`; Unload / Reload Project, Pack on class libraries
- **Run & Debug:** Set as Startup Project with launch profiles, Open Launch Settings, Debug/Release, F5, Ctrl+F5, Debug > Start New Instance; SDK-style projects that target .NET Framework run and debug with Mono on Linux and macOS; several startup projects with Visual Studio's `.slnLaunch` profiles; Attach to Process with a picker of the running .NET programs (project, ports)
- **Configuration Manager:** solution configurations and platforms, and which configuration, platform and Build setting each project uses, written to `.sln` and `.slnx`
- **Code Cleanup** on the solution, a project, a folder or a file (`dotnet format`: whitespace, unused usings, code style fixes)
- **Sync Namespaces** on a project or a folder: the C# language server's "Change namespace" for every file whose namespace does not match its folders, references in other files updated
- **Error List** as a sortable, filterable table of errors, warnings and messages
- **Tests:** Test Explorer for Microsoft.Testing.Platform and VSTest projects; Run/Debug Tests from the Solution Explorer
- **NuGet Package Manager:** Browse, Installed with transitive packages, Updates, Consolidate; private feeds and expired tokens
- **Templates:** Add New Project and Add New Item wizards for every `dotnet new` template
- **Publish:** Visual Studio's Publish tab for Folder profiles
- **Connected Services:** WCF/SOAP service references, compatible with Visual Studio's
- Manage User Secrets, Add Existing Item, Open in Terminal, Copy Full Path, and more
