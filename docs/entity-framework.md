# Entity Framework

Projects that reference Entity Framework Core (any `Microsoft.EntityFrameworkCore*` package, also through a `Directory.Build.props`) have an **Entity Framework** submenu in their context menu with the migration commands. They run the `dotnet ef` tool in a task, so the output is in the terminal panel and build errors link to the code. Visual Studio's route is the Package Manager Console (`Add-Migration`, `Update-Database`); this is the same with the CLI the team uses anyway.

| Command | Runs |
|---|---|
| **Add Migration...** | `dotnet ef migrations add <name>` after asking for a name (letters, digits and underscores: it becomes a class name) |
| **Update Database** | `dotnet ef database update`, after asking: it changes the database the startup project is configured for |
| **Remove Last Migration** | `dotnet ef migrations remove`, after asking; fails when the migration is already applied to the database |

**Startup project:** EF reads the connection string and services from a project that can start. A web or console project is its own startup project; for a library with the DbContext (the usual layout) the solution's [startup project](run-and-debug.md) is used, passed as `--startup-project`. When there is none, the extension asks you to set one.

**DbContext:** found with `dotnet ef dbcontext list`; with more than one you pick which (`--context`).

**The `dotnet-ef` tool** has to be installed, as a global tool or in a tool manifest (`dotnet-tools.json`). When it is missing, the extension offers to run `dotnet tool install --global dotnet-ef`.
