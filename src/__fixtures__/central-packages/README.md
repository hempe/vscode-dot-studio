# Central Package Management fixtures

- `cpm/`: `Directory.Packages.props` turns CPM on, has `PackageVersion`s for Newtonsoft.Json and Serilog, imports
  `Packages.Extra.props` (Polly) and adds the global reference Microsoft.SourceLink.GitHub.
  - `App`: Newtonsoft.Json, Serilog, Polly from the central versions (and the global one)
  - `Override`: Newtonsoft.Json with `VersionOverride="13.0.2"`
  - `GlobalOnly`: no references of its own, only the global one
  - `OptOut`: Serilog, and `<GlobalPackageReference Remove=...>`: no global package
  - `Legacy`: `ManagePackageVersionsCentrally` false, its own `Version` (a mixed solution)
- `plain/`: no CPM at all

Nothing here is restored or built: the tests only evaluate the projects with MSBuild (no network).
