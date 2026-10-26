# Changelog

## 0.1.2

Fixes, security hardening and the first results of the code review.

- **Data safety:** Delete Project no longer trashes the whole solution folder when the project sits next to the `.sln` (or another project, or a git repository): only the project file goes, and the question says so. Add File and Add Folder refuse an existing name instead of emptying the file. Names with `/`, `\`, `..`, `:`, `*` and the like are refused when creating or renaming. Dependencies > Remove edits the project file as text (comments and formatting stay) and removes only the exact reference (`Core` no longer removes `MyCore`), strong-named assemblies included; packages are removed the way the NuGet manager does it.
- **No shell:** `dotnet` commands for solution edits, NuGet install/uninstall/restore, builds, tests and Add Project Reference run without a shell, so paths with `&`, `;`, `$(`, `(` or `'` work and cannot run anything. Add Project Reference checks for circles like the drop onto Dependencies. A successful command whose output says "error" is no longer reported as failed.
- **NuGet:** the cache of feed responses lives in the extension's storage with hashed file names (credentials were in the file names in `/tmp`), is private to the user, and does not serve old entries; a token with `&`, `<` or `"` is read back as typed; commented-out credentials in `NuGet.Config` are ignored. The package rows no longer get wider than the list for long descriptions, and the package lists scroll with the mouse wheel again.
- **Package READMEs** can no longer show forms or cover the NuGet manager; the webviews forbid form submissions and `<base>`.
- **Solution Explorer:** the folders of `Foo.Tests` expand again when a project `Foo` exists (they were looked up in `Foo`).
- **Keys:** `Ctrl+[`, `S` (Sync with Active Document) no longer swallows `Ctrl+[` (Outdent Line) in editors and `Escape` in the terminal.
- **Packaging and release:** the bundles carry their third-party licence notices; the extension declares that it needs a trusted, real-disk workspace; the release workflow builds without secrets and publishes from a separate job; runner and temp files of the Test Explorer and unloaded projects live in private folders.
- **Docs:** corrected claims about .NET Framework tests, Hot Reload, Attach to Process, privacy and keys.

## 0.1.1

Initial release. A Visual Studio-style workflow for .NET in VS Code and VSCodium:

- **Solution Explorer** for `.sln` and `.slnx`: solution folders and items, Visual Studio's file nesting (Off / Default / Web), your file icon theme, error markers, Dependencies with transitive packages, analyzers and source-generated code, Sync with Active Document, Collapse All, Visual Studio-style context menus and keys; offers to convert `.sln` to `.slnx`; Unload / Reload Project, Pack on class libraries; Show All Files with Exclude From Project / Include In Project and linked files; drag and drop of projects, solution folders and files (with the namespace update after a move)
- **Run & Debug:** Set as Startup Project with launch profiles, Open Launch Settings, Debug/Release, F5, Ctrl+F5, Debug > Start New Instance; SDK-style projects that target .NET Framework run and debug with Mono on Linux and macOS; several startup projects with Visual Studio's `.slnLaunch` profiles; Attach to Process with a picker of the running .NET programs (project, ports); offers to trust the HTTPS development certificate when an `https://` launch profile starts; Start with Hot Reload (`dotnet watch`, without the debugger)
- **Configuration Manager:** solution configurations and platforms, and which configuration, platform and Build setting each project uses, written to `.sln` and `.slnx`
- **Code Cleanup** on the solution, a project, a folder or a file (`dotnet format`: whitespace, unused usings, code style fixes)
- **Sync Namespaces** on a project or a folder: the C# language server's "Change namespace" for every file whose namespace does not match its folders, references in other files updated
- **Error List** as a sortable, filterable table of errors, warnings and messages
- **Tests:** Test Explorer for Microsoft.Testing.Platform and VSTest projects; Run/Debug Tests from the Solution Explorer
- **NuGet Package Manager:** Browse, Installed with transitive packages, Updates, Consolidate; Central Package Management (`Directory.Packages.props`: versions and overrides shown, changes confirmed, global packages); private feeds and expired tokens
- **Templates:** Add New Project and Add New Item wizards for every `dotnet new` template
- **Publish:** Visual Studio's Publish tab for Folder profiles
- **Connected Services:** WCF/SOAP service references, compatible with Visual Studio's, and gRPC references from `.proto` files or URLs
- Manage User Secrets, Add Existing Item, Open in Terminal, Copy Full Path, and more
