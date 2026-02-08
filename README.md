# .NET Extension for VS Code

A comprehensive Visual Studio Code extension for .NET development with Solution Explorer, NuGet management, and productivity tools.

## Current Features

### Solution Explorer
- Full hierarchical solution (.sln) and project tree view
- Solution folders and solution items support
- Intelligent file nesting (Visual Studio-style)
- Dependencies view (PackageReferences, ProjectReferences, Framework assemblies)
- Startup project management
- Real-time file watchers

### Solution & Project Operations
- Build/Rebuild/Clean for solutions and projects
- Create new projects from templates
- Add/remove projects and manage references
- Target framework selection and debug configuration
- Standard keyboard shortcuts (Ctrl+B, F2, Delete)

### File Operations
- Complete file management (copy, paste, rename, delete)
- Add new files and folders with inline editing
- Context actions (Reveal in Explorer, Open in Terminal, Copy Path)

### NuGet Package Manager
- Browse and search packages from nuget.org
- Install packages to multiple projects
- Azure DevOps private feed support
- Package details, versions, and dependencies

## Development Roadmap

### Phase 1: Test Integration
**Goal**: Native test discovery and execution through VS Code Test Explorer

- [ ] Integrate with VS Code Test Explorer API
- [ ] Auto-discover MSTest, xUnit, and NUnit tests
- [ ] Hierarchical test organization (solution → project → namespace → class → test)
- [ ] Run/Debug individual tests or entire projects
- [ ] Real-time test results display
- [ ] Test output integration
- [ ] Code lens for running tests from editor
- [ ] Test filtering and search

**Implementation Notes**:
- Use `vscode.TestController` API
- Parse `dotnet test --list-tests` output for discovery
- Execute tests via `dotnet test --filter`
- Parse test results (TRX format) for status updates

### Phase 2: File Templates & Quick File Creation
**Goal**: Rapid file creation with intelligent defaults

**Quick Add (Shift+F2)**:
- [ ] Keyboard shortcut to quick-add files to current location
- [ ] Template selection dialog with search/filter
- [ ] Inline file naming with Enter to confirm

**Templates**:
- [ ] C# class with namespace generation
- [ ] C# interface
- [ ] C# enum
- [ ] C# record
- [ ] ASP.NET Core controller
- [ ] Razor page
- [ ] Razor component (Blazor)
- [ ] JSON/XML configuration files
- [ ] xUnit/NUnit/MSTest test class

**Namespace Intelligence**:
- [ ] Auto-generate namespace based on folder structure
- [ ] Respect project root namespace from .csproj
- [ ] Handle nested folders correctly

**Implementation Notes**:
- Store templates in `src/templates/` directory
- Use placeholder variables: `{{NAMESPACE}}`, `{{CLASS_NAME}}`, `{{FILE_NAME}}`
- Parse .csproj for `<RootNamespace>` property
- Calculate namespace from relative path

### Phase 3: Code Navigation & IntelliSense
**Goal**: Enhanced code navigation within Solution Explorer

- [ ] "Go to Definition" from Solution Explorer
- [ ] "Find All References" context menu
- [ ] Symbol search across solution
- [ ] Quick file search (Ctrl+P-style within solution)
- [ ] Recent files list
- [ ] Code outline/document symbols in sidebar
- [ ] Navigate to related files (e.g., .cs ↔ .cshtml)

**Implementation Notes**:
- Leverage existing C# language server for symbol resolution
- Use `vscode.executeDefinitionProvider`
- Use `vscode.executeReferenceProvider`
- Create custom quick pick for solution-scoped file search

## Installation

### Prerequisites
- VS Code 1.74.0 or higher
- .NET SDK 6.0 or higher
- C# extension (muhammad-sammy.csharp)

### Build from Source
```bash
npm install
npm run build
```

## Project Structure
```
src/
├── extension.ts              # Entry point
├── core/                     # Solution & Project models
├── parsers/                  # .sln and .csproj parsers
├── services/                 # Business logic
│   ├── solutionService.ts
│   ├── nuget/
│   └── testing/              # [NEW] Test discovery & execution
├── templates/                # [NEW] File templates
└── webview/                  # React UI components
```

## Contributing

This project welcomes contributions! Key areas:
- Test integration implementation
- New file templates
- Bug fixes and performance improvements

## License

[License information to be determined]
