# .NET Extension for VS Code

Enhanced .NET development features for Visual Studio Code, adding missing functionality like NuGet package management UI and solution support.

## Planned Features

### ✅ Basic Extension Setup
- [x] Extension structure and activation
- [x] Basic commands registration

### 🚧 NuGet Package Management
- [ ] NuGet packages UI (similar to Visual Studio)
- [ ] Package installation/removal
- [ ] Package updates management
- [ ] Package sources configuration

### 🚧 Solution (.sln) Support
- [ ] Solution file parsing
- [ ] Project hierarchy display
- [ ] Set startup project functionality
- [ ] Build configuration management

### 🚧 Project Management
- [ ] Add/remove project references
- [ ] Manage project dependencies
- [ ] Project templates

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
├── package.json          # Extension manifest
├── tsconfig.json         # TypeScript configuration
├── src/
│   └── extension.ts      # Main extension code
├── out/                  # Compiled JavaScript (generated)
└── .vscode/
    └── launch.json       # Debug configuration
```

## Next Steps
- Implement NuGet package management UI
- Add solution file parsing
- Create project hierarchy tree view
- Add build and debug configurations