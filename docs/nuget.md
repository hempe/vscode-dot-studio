# NuGet

Visual Studio's NuGet Package Manager, in an editor tab.

- Right-click a **project** (or its Dependencies / Packages node) > **Manage NuGet Packages...**: packages of that project.
- Right-click the **solution** > **Manage NuGet Packages...**: packages of all projects, with the Consolidate tab.

## Tabs

| Tab | |
|---|---|
| **Browse** | Search the package feeds; pick a version and the projects, then Install |
| **Installed** | **Top-level packages** the projects reference, and a collapsible **Transitive packages** section: packages they only get through other packages, each with what brings it in ("Transitively referenced by ...") |
| **Updates** | Packages with newer versions; update one, or check several and **Update Selected** |
| **Consolidate** | (solution only) Packages used in different versions across projects, to bring them to one version |

**Include prerelease** adds prerelease versions. The details pane shows the description, versions, dependencies and the package's README.

**Transitive packages:** Install makes one a direct reference, e.g. to pin a newer version with a security fix; they have no Uninstall, since only the package that brings them in can be removed. Solution Explorer: [Dependencies > Packages](solution-explorer.md#dependencies) shows the same tree under each package.

## Central Package Management

Solutions that keep their package versions in `Directory.Packages.props` (`ManagePackageVersionsCentrally`) work like the others: Installed, Updates and the Dependencies tree show the version MSBuild uses for each project, and where it comes from:

| Shown | Where the version is |
|---|---|
| `v3.1.1` | the `PackageVersion` in `Directory.Packages.props` (or a props file it imports) |
| `v13.0.2 (override)` | the project's own `VersionOverride` |
| `global` | a `GlobalPackageReference`: every project gets the package |

![Central Package Management: an override, a global package, Set for This Project Only and Consolidate](images/central-packages.gif)

Packages from a `GlobalPackageReference` carry a **global** badge in the lists. The details pane says where the selected package's version is set: the props file, and in the solution's manager which projects use that central version and which override it. **Set for This Project Only** (under Install, when the selected projects take the version from `Directory.Packages.props`) writes a `VersionOverride` with the chosen version instead of changing the central one, without asking.

A project that turns CPM off (`<ManagePackageVersionsCentrally>false</ManagePackageVersionsCentrally>`) keeps the versions in its project file, as before. When the .NET SDK cannot evaluate a project, its versions show as not known and are never offered as updates.

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

### Consolidate

Under CPM the versions of a package differ only through `VersionOverride`s (or through two props files with different versions). Consolidate sets the central version (or the global one) to the chosen version and removes the overrides; a confirmation lists each change first. Projects in the same solution that do not use CPM are updated in their project files, as before.

After Consolidate or Update Selected, the Installed and Updates tabs show the new versions.

### Edits made outside the extension

Edits to `Directory.Packages.props`, or to a props file it imports, made by hand or by `git checkout`, show in the tree and in open NuGet managers after a moment (the projects are evaluated again). A props file outside the opened folder is checked when you switch to the NuGet manager.

## Private feeds

Feeds and credentials come from `NuGet.Config`, found like NuGet finds them: every `NuGet.Config` from the solution folder up, then your user configuration. Credentials go in `<packageSourceCredentials>` with `Username` and `ClearTextPassword`; this works for Azure DevOps, GitHub Packages, GitLab, Artifactory, MyGet and others.

**When a feed rejects its credentials** (an expired token), a message says which feed, where its credentials are (file and line), what to do for that kind of feed, and offers **Enter New Token...**, which stores the new token as `ClearTextPassword`. It works without restarting.

**Not supported:** encrypted `Password` values. Visual Studio encrypts them with Windows DPAPI, which nothing outside Windows can read. Use `ClearTextPassword`, or the Azure Artifacts Credential Provider, which covers restore and build.

**Vulnerable packages:** restore reports packages with known vulnerabilities (NuGet Audit, NU1901-NU1904) as warnings in the [Error List](error-list.md).
