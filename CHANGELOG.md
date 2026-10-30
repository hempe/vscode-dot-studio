# Changelog

## Unreleased

- **Fixed, Test Explorer:** a .NET Framework test app (`net472`, e.g. xUnit v3) is started as its own exe (with `mono` on Linux and macOS), not through `dotnet`, which failed with "hostpolicy.dll not found"; libraries below a `Directory.Build.props` that names test packages (even only under a `Condition`) are no longer listed as test projects: MSBuild's `IsTestProject` decides.
- **Fixed, Solution Explorer:** the wavy underline of nodes with warnings and errors was clipped to a dotted line by the name's `overflow: hidden`; messages (infos) get the wavy line too, not a dotted one.
- **Added, Solution Explorer:** click the count or dot next to a node to list its problems in the Error List, narrowed to that node (a chip clears the narrowing).
- **Changed, Test Explorer:** a multi-targeted test project is tested for every target framework (`MyTests (net8.0)`, `MyTests (net10.0)`), not only the one Select Framework or the automatic pick chose.
- **Changed:** the Output log no longer holds a line per expanded tree node.

## 0.2.0

The first stable release: the Solution Explorer toolbar, feed credential and solution file fixes, a NuGet manager that fills the editor, and a tidier code base.

- **Fixed, NuGet manager:** the tab content fills the editor's height instead of stopping a guessed 120 px short, which left a gap at the bottom and could push buttons out of view when the panel was open.
- **Fixed, solution and project files:** a `.sln` with a stray line between two project blocks, or a block without `EndProject`, no longer drops the projects after it; two quick edits of the solution (drag and drop, context actions) are applied one after the other instead of one overwriting the other; a project file edited from outside with the same size and timestamp is no longer taken for our own write; removing the last item of an `<ItemGroup Condition=...>` removes the group; item-like text inside `<![CDATA[`...`]]>` is ignored.
- **Fixed, feed credentials:** entering a token for a feed (`MyFeed`) no longer rewrites the credentials of a feed whose name starts the same (`MyFeed-Preview`) and removes the first feed's own password; a token is never written into a commented-out block; a user name containing `$&` is stored as typed. If the credentials sit in a NuGet.Config inside your workspace or a git checkout, you are asked before a new token is saved there, and can save it to your user NuGet.Config instead.
- **Solution Explorer toolbar:** one ▷ Start button (its arrow lists Start Without Debugging, Start with Hot Reload and Attach to Process...) instead of three start buttons; Sync with Active Document has a clearer icon and tooltip; The framework button (`net10.0 ▾`) is a menu of the startup project's target frameworks and Startup Profile... instead of a quick pick. Open Solution... and Create New Project... are in the toolbar's `...` menu. The view's title bar reads "Solution Explorer" and has no buttons.

## 0.1.3

New features, the rest of the code review and a Solution Explorer toolbar.

**New**
- **Entity Framework:** projects that reference Entity Framework Core have Add Migration, Update Database and Remove Last Migration in their context menu (`dotnet ef`, with startup project and DbContext choice, and an offer to install `dotnet-ef`).
- **NuGet manager:** installed versions with known vulnerabilities (severity, advisory links) or that are deprecated (with the replacement) are labelled, and the Installed tab can filter for them. Browse has a **Package source** dropdown (All, or one source) and every tab a **Refresh** button.
- **Package sources like Visual Studio (opt-in setting `shinobi.nuget.packageSources`):** a Sources tab to add, remove, enable and disable feeds, and Package Source Mapping in the package details and in Browse.
- **Solution Explorer toolbar** above the tree (configuration, framework or startup profile, Start, Sync, Show All Files, Collapse All) instead of title icons that VS Code hides in a narrow view. Built-in icons are VS Code's codicons (nothing is fetched from the internet any more); your file icon theme is still honored. New **Dependencies > Frameworks** node (`Microsoft.NETCore.App`, `Microsoft.AspNetCore.App`), and files a project links from outside its folder count in the error markers.
- **`.nuget/NuGet.Config`:** Visual Studio's solution-level config is read by the NuGet manager, and the extension offers to move or copy it to `nuget.config` (where `dotnet restore` reads it) when a solution opens or a restore fails.

**Fixes**
- **Solution files:** Add and Rename Solution Folder refuse a name a folder next to it has; Remove Solution Folder removes projects of every type and their configuration lines, also with lower-case GUIDs; `.slnx` edits ignore XML comments; a `.sln` with an absolute project path loads, and a project that cannot be read is skipped instead of failing the solution; a moved `.slnx` solution folder stays open.
- **NuGet:** `http://` feeds work; redirects are followed without passing credentials to another host; answers have a size and time limit; folder sources no longer slow package lookups down; icons and READMEs are looked up on nuget.org only when it is a source; Browse showed the lowest version of a package several sources have, now the highest; the cache refreshes stale answers after 5 seconds, replaces private feeds' entries and is not undone by Refresh; one `dotnet list package` per project; package rows no longer get wider than the list and the lists scroll.
- **Test Explorer:** a failed build shows its first errors in the test message and Cancel stops it; a test host that crashes on start is reported at once.
- **Startup project:** choosing a startup project, framework or profile in quick succession ends with the last choice.
- **Templates:** the wizards use the SDK that `global.json` picks, as `dotnet new` will.
- **Service references:** Add and Update Service Reference keep edits made to the project file meanwhile.
- **Solution Explorer:** a file moved into a collapsed folder shows; hovering and switching editors no longer render every row; version properties of a parent `Directory.Packages.props` imported with unquoted `GetPathOfFileAbove` are found; the Configuration Manager and startup tabs follow Open Solution; the webviews no longer allow `unsafe-eval`.

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
