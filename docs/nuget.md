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

## Private feeds

Feeds and credentials come from `NuGet.Config`, found like NuGet finds them: every `NuGet.Config` from the solution folder up, then your user configuration. Credentials go in `<packageSourceCredentials>` with `Username` and `ClearTextPassword`; this works for Azure DevOps, GitHub Packages, GitLab, Artifactory, MyGet and others.

**When a feed rejects its credentials** (an expired token), a message says which feed, where its credentials are (file and line), what to do for that kind of feed, and offers **Enter New Token...**, which stores the new token as `ClearTextPassword`. It works without restarting.

**Not supported:** encrypted `Password` values. Visual Studio encrypts them with Windows DPAPI, which nothing outside Windows can read. Use `ClearTextPassword`, or the Azure Artifacts Credential Provider, which covers restore and build.

**Vulnerable packages:** restore reports packages with known vulnerabilities (NuGet Audit, NU1901-NU1904) as warnings in the [Error List](error-list.md).
