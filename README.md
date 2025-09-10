# .NET Extension for VS Code

A comprehensive .NET development extension for Visual Studio Code that brings Visual Studio's Solution Explorer experience to VS Code, with complete solution/project management capabilities.

## Features

### ✅ Solution Explorer
- **Complete solution (.sln) support** with hierarchical project tree view
- **Solution folder support** with unlimited nesting (just like Visual Studio)
- **Solution Items support** - Files in solution folders (README.md, LICENSE, etc.)
- **Robust .sln parser** - JSON-structured parsing with full format support
- **Project file parsing** with dependencies, references, and file organization
- **Smart file nesting** (e.g., `User.cs` under `User.cshtml`)
- **Dependencies tree** showing PackageReferences, ProjectReferences, and Framework assemblies
- **Real-time tree updates** when files change

### ✅ Solution Management
- **New Solution Folder...** - Create virtual folders to organize projects
- **New Project...** - Create new projects from templates (Console, Web API, MVC, Blazor, etc.)
- **Add Existing Project...** - Add existing projects to solution
- **Project context menus** with full Visual Studio-like functionality

### ✅ Project Management
- **Add Project Reference...** - Reference other projects in the solution
- **Add NuGet Package...** - Install NuGet packages via dotnet CLI
- **Build/Rebuild/Clean** - Project build operations
- **New File/Folder** - Create files and folders within projects
- **File operations** - Copy, paste, rename, delete with keyboard shortcuts

### ✅ Advanced Features
- **External project support** - Handle projects outside workspace folder
- **Performance optimized** - Fast folder expansion and file scanning
- **Proper icons** - Distinctive icons for solutions, projects, solution folders, and dependencies
- **Context-aware menus** - Different options for solutions, projects, folders, and files
- **Keyboard shortcuts** - Standard shortcuts (Ctrl+C, Ctrl+V, F2, Delete, etc.)
- **Clean codebase** - Refactored with utilities for maintainability and reduced duplication

## Development

### Prerequisites
- Node.js (14 or higher)
- VS Code

### Setup
1. Install dependencies:
   ```bash
   npm install
   ```

2. Compile TypeScript:
   ```bash
   npm run compile
   ```

### Testing the Extension

1. **Open in VS Code**: Open this project folder in VS Code
2. **Start Debugging**: Press `F5` or go to Run > Start Debugging
3. **Extension Host Window**: A new VS Code window will open with the extension loaded
4. **Test Commands**: 
   - Open a folder with .NET projects (.csproj files)
   - Right-click on a .csproj file in the explorer
   - You should see ".NET" menu items: "Manage NuGet Packages" and "Set as Startup Project"

### Development Workflow
1. Make changes to the code in `src/`
2. Compile: `npm run compile` (or use `npm run watch` for auto-compilation)
3. Reload the Extension Host window (`Ctrl+R` or `Cmd+R`)
4. Test your changes

### Directory Structure
```
.
├── package.json              # Extension manifest and command definitions
├── tsconfig.json             # TypeScript configuration
├── src/
│   ├── extension.ts          # Main extension entry point and command handlers
│   ├── solutionProvider.ts  # Solution Explorer tree data provider
│   ├── solutionManager.ts   # Solution file operations (dotnet CLI)
│   ├── solutionFileParser.ts # Robust .sln file parser (JSON output)
│   ├── projectFileParser.ts # .csproj file parsing logic
│   ├── solutionItem.ts      # Tree view item representation
│   ├── fileNesting.ts       # Smart file nesting logic
│   ├── constants.ts         # Shared constants and utilities
│   └── utils.ts            # Utility functions (path, validation, terminal, etc.)
├── out/                     # Compiled JavaScript (generated)
└── .vscode/
    └── launch.json          # Debug configuration
```

## Usage

1. **Open a .NET solution**: Open a folder containing `.sln` files in VS Code
2. **View Solution Explorer**: The extension automatically activates and shows the Solution Explorer in the sidebar
3. **Manage projects**: Right-click on solutions and projects to access context menus
4. **Work with files**: Navigate the project structure, create files, and manage dependencies

## Context Menus

### Solution (.sln) Context Menu:
- New Project...
- Add Existing Project...
- New Solution Folder...
- Open In Integrated Terminal

### Project (.csproj) Context Menu:
- New File...
- New Folder...
- Open In Integrated Terminal
- Add Project Reference...
- Add NuGet Package...
- Build / Rebuild / Clean
- Set as Startup Project
- Open Containing Folder
- Remove (Delete)
- Rename... (F2)

### Solution Folder Context Menu:
- New Solution Folder...
- Add Existing File...
- New File...
- Rename... (F2)
- Delete

## Architecture

The extension uses a modular architecture with separate concerns:

### Core Components:
- **SolutionProvider**: VS Code TreeDataProvider for the Solution Explorer view
- **SolutionManager**: Handles dotnet CLI operations (sln add/remove)
- **SolutionFileParser**: Robust .sln file parser that outputs structured JSON
- **ProjectFileParser**: Parses .csproj files and builds file structure
- **SolutionItem**: Tree view item representation with icons and context
- **FileNesting**: Implements intelligent file nesting similar to Visual Studio

### Utilities & Support:
- **Utils**: Centralized utility functions for common operations
  - PathUtils: File path manipulation and validation
  - ValidationUtils: Input validation patterns
  - TerminalUtils: Terminal creation and command execution
  - ErrorUtils: Consistent error handling and logging
  - FileSystemUtils: File and directory operations
  - InputUtils: VS Code input box and quick pick helpers
- **Constants**: Centralized configuration for file types and skip directories

### Key Features:
- **Hierarchical parsing**: Full support for nested solution folders and projects
- **Solution Items support**: Files attached to solution folders (like README.md)
- **Performance optimized**: Efficient caching and minimal file system operations  
- **Type safety**: Full TypeScript interfaces throughout
- **Maintainability**: Utility functions reduce code duplication by ~20%