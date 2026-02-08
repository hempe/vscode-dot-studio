# .NET Extension for VS Code

A comprehensive Visual Studio Code extension that brings full .NET Solution Explorer capabilities to VS Code, providing near-complete parity with Visual Studio's solution management experience.

## Overview

This extension transforms VS Code into a powerful .NET development environment by adding a complete Solution Explorer, integrated NuGet package manager, and robust project management capabilities. It aims to provide .NET developers with a familiar and efficient workflow directly in VS Code.

## Features

### Solution Explorer

- **Complete Solution (.sln) Support**: Full hierarchical project tree view with real-time updates
- **Solution Folders**: Virtual folders with unlimited nesting for organizing projects
- **Solution Items**: Support for solution-level files (README, LICENSE, etc.)
- **Intelligent File Nesting**: Automatic nesting similar to Visual Studio (e.g., `User.cs` under `User.cshtml`)
- **Dependencies View**: Displays PackageReferences, ProjectReferences, and Framework assemblies
- **File Watchers**: Automatic tree refresh when solution or project files change
- **Startup Project Management**: Set and manage startup projects with visual indicators (bold text)

### Solution & Project Operations

- **Build System**: Build/Rebuild/Clean for solutions and individual projects
- **Project Creation**: New projects from templates (Console, Web API, MVC, Blazor, WPF, etc.)
- **Project Management**: Add existing projects, remove projects, manage references
- **Framework Management**: Target framework selection and debug configuration
- **Keyboard Shortcuts**: Standard shortcuts (Ctrl+B for build, F2 for rename, Delete, etc.)

### File Operations

- **Complete File Management**: Copy, paste, rename, delete with keyboard shortcuts
- **File Creation**: Add new files and folders with inline editing
- **Context Actions**: Reveal in Explorer, Open in Terminal, Copy Path/Relative Path
- **Split Editor**: Open to side support

### NuGet Package Manager

Modern web-based UI with comprehensive package management:

- **Browse Tab**: Search and discover packages from nuget.org with real-time API integration
- **Package Installation**: Install packages to multiple projects with version selection
- **Azure DevOps Support**: Private feed authentication with credential management
- **Package Details**: View package metadata, versions, dependencies, and descriptions

### Developer Experience

- **Context-Aware Menus**: Different right-click options for solutions, projects, folders, and files
- **Type Safety**: Written in TypeScript with strict mode for reliability
- **Service Architecture**: Clean, maintainable codebase with proper separation of concerns
- **Comprehensive Testing**: Jest and React Testing Library coverage
- **Performance Optimized**: Debounced updates and efficient tree rendering

## Tech Stack

**Extension Backend**:
- TypeScript with strict mode
- VS Code Extension API
- Node.js for CLI operations
- xml2js for .sln and project file parsing

**Webview UI**:
- React 18 with TypeScript
- VS Code Codicons
- Webpack 5 bundling
- Modern ES6+ JavaScript

**Testing**:
- Jest 30
- @testing-library/react
- VS Code test framework

## Installation & Setup

### Prerequisites

- Node.js 16 or higher
- VS Code 1.74.0 or higher
- .NET SDK 6.0 or higher

### Build from Source

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Build for development (with source maps)
npm run build:dev

# Watch mode for development
npm run watch

# Run tests
npm test

# Type checking
npm run typecheck
```

### Usage

1. Open a folder containing `.sln` files in VS Code
2. The extension activates automatically
3. Solution Explorer appears in the sidebar with folder-library icon
4. Right-click any node for context menu actions
5. Use Ctrl+B to build, F2 to rename, Delete to remove items

## Project Structure

```
src/
├── extension.ts              # Extension entry point & activation
├── core/                     # Core domain models
│   ├── Solution.ts           # Solution file representation (~1,156 lines)
│   ├── Project.ts            # Project model with file trees
│   └── utils.ts              # Shared utilities
├── parsers/                  # File format parsers
│   ├── solutionFileParser.ts # .sln parser with JSON output
│   └── projectFileParser.ts  # .csproj/.vbproj/.fsproj parser
├── services/                 # Business logic services
│   ├── solutionService.ts    # Solution operations
│   ├── solutionTreeService.ts # Tree data provider
│   ├── debugConfigService.ts # launch.json management
│   ├── fileNesting.ts        # File nesting logic
│   └── nuget/                # NuGet-specific services
│       ├── nugetManagerService.ts
│       ├── nugetV3Service.ts
│       └── packageBrowseService.ts
├── webview/                  # React UI components
│   ├── providers/            # Webview providers
│   ├── solution-view/        # Solution Explorer UI
│   ├── nuget-view/           # NuGet Manager UI
│   └── shared/               # Shared components
└── types/                    # TypeScript type definitions
```

## Architecture

**Layered Design**:

1. **Extension Host Layer**: VS Code API integration, command registration, file watchers
2. **Service Layer**: Business logic for solution operations, tree rendering, package management
3. **Core Domain Layer**: Solution and Project models with file system operations
4. **Webview Layer**: React-based UI with message passing to extension host
5. **Parsers**: XML parsing for .sln and project files

**Communication Flow**:
- Extension → Webview: Solution data via postMessage
- Webview → Extension: User actions via VS Code API
- Services ↔ File System: Read/write operations with debouncing

## Configuration

### File Watching

Automatically monitors:
- `*.sln` files
- `*.csproj`, `*.vbproj`, `*.fsproj` files
- Project structure changes

Excluded directories:
- `bin`, `obj`, `node_modules`, `.git`, `.vs`, `.vscode`

### Azure DevOps Private Feeds

For Azure DevOps Artifacts private NuGet packages:

```bash
# Install credential provider
dotnet tool install --global Microsoft.Artifacts.CredentialProvider.NuGet.Tool

# Configure with Personal Access Token (PAT)
dotnet nuget update source YOUR_FEED_NAME \
  --username anything \
  --password YOUR_PAT_HERE \
  --store-password-in-clear-text
```

Create PAT in Azure DevOps with **Packaging (Read)** scope. The extension automatically detects all configured NuGet sources.

## Current Status

**~90% Visual Studio Solution Explorer Parity**

The extension provides comprehensive solution and project management with stable core features. Recent improvements include:

- Refactored NodeId system with type safety and compression
- Fixed Dependencies node expansion and display
- Improved context menu positioning and keyboard navigation
- Enhanced loading performance with better timing
- Comprehensive bug fixes and stability improvements

## Future Roadmap

### Near Term (Q1-Q2 2025)

**NuGet Enhancements**:
- Installed Packages tab with removal and update functionality
- Updates tab with version checking and upgrade workflows
- Consolidate tab for resolving version conflicts across projects

**Project Management**:
- Multi-project selection with batch operations (Ctrl+Click, Shift+Click)
- Solution configuration and platform management (Debug/Release, x86/x64/AnyCPU)
- Enhanced project template system with custom parameters

**Build System**:
- Parsed build errors and warnings with clickable navigation
- Problems panel integration
- Build progress indicators with cancellation support

### Medium Term (Q3-Q4 2025)

**Development Tools**:
- Test framework integration with VS Code Test Explorer API
- Solution-wide find and replace with project filtering
- Project properties management UI (graphical .csproj editor)

**Performance & Polish**:
- Virtual scrolling for large trees
- Enhanced caching strategies
- Source control status indicators
- Active file highlighting in tree

### Long Term (2026+)

**Advanced Features**:
- Dependency graph visualization with circular dependency detection
- Package Manager Console (PowerShell-like interface)
- Scaffolding system for MVC, Entity Framework
- Advanced project types (.shproj, .sqlproj, Docker projects)

### Target Milestones

| Quarter | Goal | VS Parity |
|---------|------|-----------|
| Q1 2025 | Working NuGet management, References tree | 95% |
| Q2 2025 | Multi-selection, configurations, templates | 98% |
| Q3 2025 | Build integration, testing, console | 100%+ |
| Q4 2025 | Search, properties, polish features | 105%+ |

The goal is to achieve **full Visual Studio Solution Explorer parity by Q2 2025**, with advanced features and productivity enhancements continuing through 2025-2026.

## Contributing

This project welcomes contributions! The codebase is well-structured with:

- Strict TypeScript typing for safety
- Service-layer architecture for maintainability
- Comprehensive test coverage
- Clear separation of concerns

Key areas for contribution:
- Feature implementation from the roadmap
- Bug fixes and performance improvements
- Test coverage expansion
- Documentation improvements

## License

[License information to be determined]

## Acknowledgments

Built with TypeScript, React, and the VS Code Extension API to provide .NET developers with a powerful and familiar solution management experience in Visual Studio Code.
