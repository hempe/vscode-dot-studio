# Solution Tree Context Menu & Functionality TODO

This document tracks the missing functionality and improvements needed for the Solution Tree context menus and interactions to match Visual Studio behavior.

```
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
!!!!!!!!!!!!!!!!!!!!! IMPORTANT !!!!!!!!!!!!!!!!!!!!!!!!!!!!
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
!!! Always check if some services already implement      !!!
!!! things we want to add, as we removed the ui code,    !!!
!!! but still have some of the servies from our first    !!!
!!! attempt building this project.                       !!!
!!! and make sure to properly structure the code         !!!
!!! use the exsting small services as a reference        !!!
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
```

## 🚨 Critical Issues (Priority 1)

### Tree

- [x] **File watcher architecture** - Fixed! Now uses lazy folder watchers created only when folders are expanded
  - [x] Solution/project files watched globally with flat watchers (`**/*.sln`, `**/*.{csproj,vbproj,fsproj}`)
  - [x] Individual project files watched per project
  - [x] Folder watchers created lazily when folders are expanded, removed when collapsed
- [x] **Dependencies node re-enabled** - Collapse bug was due to other issues, now fixed

### Context Menu Fixes

- [x] **Dependencies node** should NOT have Rename, Delete, or Reveal in Explorer options
- [x] **Solution folders** should NOT have "Open" action (they're virtual folders)
- [x] **Solution node** should have Rename option
- [x] **Project nodes** (.csproj) should have Delete/Remove options
- [x] **Enter key on solution folders** should trigger expand/collapse (not try to open)
- [x] **Solution node** rename functionality implemented
- [x] **Dependencies node** "Reveal in Explorer" option removed

### Node Type Detection Issues

- [x] **Distinguish solution folders from regular folders** - currently both are type 'folder'
- [x] **Add 'solution' node type** handling in context menus
- [x] **Fix Dependencies node** to be properly identified (currently shows regular folder menu)

### Tree Navigation Issues

- [x] **Solution folders** cannot expand/collapse properly
- [x] **Left clicking on files** should collapse the tree node (currently doesn't work)
- [x] **Left arrow key on files** should collapse the tree node (currently doesn't work)
- [x] **Context menu focus** - opening context menu should focus it for keyboard navigation (up/down arrows)

## 🏗️ Critical Architectural Refactoring (Priority 1.5)

### Immediate Refactoring Needs

**Why Now**: Priority 2 features (Dependencies, NuGet, Add Reference, etc.) will require significant changes to tree building and action handling. We need clean, maintainable services before adding complexity.

**Current Problem**: SolutionWebviewProvider is 1900+ lines handling too many responsibilities

### Services to Extract Immediately

- [ ] **SolutionTreeService** - Tree building and hierarchy management (~600 lines)
  - [ ] `buildSolutionTree()` - Build complete tree from Solution data
  - [ ] `mergeTreeStates()` - Merge fresh data with cached expansion states
  - [ ] `updateNodeInTree()` - Update specific nodes in tree structure
  - [ ] `findNodeByPath()` - Tree traversal utilities
  - [ ] Tree caching and invalidation logic
  - **Why urgent**: Dependencies node, NuGet packages, and project references will require tree modifications

- [ ] **SolutionActionService** - Handle all project/solution operations (~500 lines)
  - [ ] Project operations (add, remove, build, clean, rebuild, restore)
  - [ ] Solution folder operations (add, remove, rename)
  - [ ] File operations (delete, reveal, open)
  - [ ] Solution item operations (add, remove)
  - [ ] Build system integration
  - **Why urgent**: Most Priority 2 features are new actions (Add Reference, Manage NuGet, Add Class, etc.)

**Target**: Reduce SolutionWebviewProvider from 1900+ lines to ~800 lines (60% reduction)

### Implementation Strategy
1. Extract SolutionTreeService first (biggest impact, needed for Dependencies)
2. Extract SolutionActionService second (needed for all new actions)
3. Test thoroughly before proceeding to Priority 2 features

## 📋 Missing Context Menu Actions (Priority 2)

### Solution Node Context Menu

- [x] Add Existing Project (file dialog to select .csproj) [can we just use the file picker thingy?]
- [x] Add New Project (project template selection) [QuickPick for now]
- [x] Add Solution Folder
- [x] Restore Nugets
- [x] Build commands (Clean, Build, Rebuild) like on project node.

### Solution Folder Context Menu

- [x] Add Solution Folder (sub-folder)
- [x] Remove
- [x] Add Existing Item...
- [x] Rename

### Solution Folder Item Context Menu

- [x] Remove (from solution folder, don't delete the file) - Current "Remove from Solution" implementation handles this correctly

Note: Solution folders in Visual Studio are virtual organizational containers. They typically don't have "Add New Project" or "Add Existing Project" - those operations happen at the solution level. Solution folders can contain sub-folders and can have projects moved into them.

### Project Node Context Menu

- [x] **Dependencies node functionality** (PRIORITY - re-enabled and working)
  - [ ] Restore Dependencies container node display (maybe already there but needs to be checked)
  - [ ] Fix collapse bug when clicking dependencies node (maybe already there but needs to be checked)
  - [ ] Implement dependencies expansion to show individual packages (maybe already there but needs to be checked)
  - [ ] Add context menu for dependencies (Manage NuGet Packages, Add Reference, etc.)
- [ ] Add Reference
- [ ] Add Project Reference
- [ ] Manage NuGet Packages
- [ ] Add Class/Item (with templates)
- [ ] Add Folder
- [ ] Set as Startup project [startup project should be "bold" in the tree ]
- [ ] Properties (Properties are a folder so I think this part can wait until we do the ui for it)
- [ ] Remove from Solution (different from Delete)
- [ ] Delete (filesystem deletion)

### File Context Menu

- [ ] Copy/Cut/Paste

### Folder Context Menu

- [ ] Add Class/Item
- [ ] Add Folder
- [ ] Copy/Cut/Paste


## 🔧 Functionality Gaps (Priority 3)

### Drag & Drop Support

- [ ] Drag files between folders
- [ ] Drag projects between solution folders
- [ ] Drag references between projects
- [ ] Visual drop indicators

### Copy/Cut/Paste Operations

- [ ] Copy file/folder paths to clipboard
- [ ] Cut/Copy files and folders
- [ ] Paste files into folders
- [ ] Duplicate files

### Multi-Selection Support

- [ ] Ctrl+Click for multi-select
- [ ] Shift+Click for range select
- [ ] Multi-select context menus
- [ ] Bulk operations (delete, move, etc.)

### Project Templates & Wizards

- [ ] New Project dialog with templates
- [ ] New Item dialog with templates (Class, Interface, etc.)
- [ ] Project template discovery and rendering

### File System Integration

- [ ] Watch for external file changes
- [ ] Auto-include newly created files
- [ ] Handle file renames from filesystem
- [ ] Exclude patterns (.gitignore, etc.)

## 🎯 Behavioral Improvements (Priority 4)

### Keyboard Navigation Enhancements

- [ ] Delete key for deletion
- [ ] Ctrl+X/C/V for cut/copy/paste
- [ ] Escape to cancel operations

### Visual Enhancements

- [ ] Loading indicators for long operations
- [ ] Error states for failed operations
- [ ] Dirty indicators for unsaved files
- [ ] Build status indicators
- [ ] Source control status indicators
- [ ] Highlight currently active file in the tree.
- [ ] Error visualizer, indicate files with errors / warnings

### Performance Optimizations

- [ ] Virtual scrolling for large trees
- [ ] Lazy loading of deep folder structures
- [ ] Debounced file system operations
- [ ] Memoization of expensive tree operations

## 🔄 Integration Points (Priority 5)

### VS Code Integration

- [ ] Integrate with VS Code source control
- [ ] Respect VS Code file associations
- [ ] Use VS Code file icons
- [ ] Integrate with VS Code search

### Build System Integration

- [ ] Real-time build status
- [ ] Error/warning indicators
- [ ] Build output integration
- [ ] Test runner integration

### NuGet Integration

- [ ] Package reference management
- [ ] Package updates notifications
- [ ] Package vulnerability warnings
- [ ] Package search and install

## 🧪 Testing Requirements

### Missing Test Coverage

- [ ] Context menu actions for each node type
- [ ] Enter key behavior for different node types
- [ ] Project operations (add, remove, build)
- [ ] File operations (include, exclude, delete)
- [ ] Solution operations (add project, add folder)
- [ ] Error handling and edge cases

### Integration Testing

- [ ] File system operation tests
- [ ] Build operation tests
- [ ] NuGet operation tests
- [ ] VS Code API integration tests

## 📝 Implementation Notes

### Current Context Menu Logic Issues

The current implementation in `ContextMenu.tsx` is too simplistic:

- Uses basic node types (file, folder, project, dependency)
- Doesn't distinguish between solution folders and filesystem folders
- Missing solution node handling
- Dependencies node treated as regular folder

### Node Type Improvements Needed

Need to enhance the type system to distinguish:

- `solution` - .sln file node
- `solutionFolder` - Virtual folder in solution
- `project` - .csproj file node
- `folder` - Filesystem folder
- `file` - Regular file
- `dependencies` - Dependencies virtual folder
- `dependency` - Individual package reference

### Action Handler Extensions

The `SolutionWebviewProvider` needs new handlers for:

- Project management (add, remove, unload)
- Solution structure operations (add folder, add project)
- File operations (include, exclude, templates)
- Build and test operations
- NuGet operations

---

**Next Steps**: Address Priority 1 issues first to fix the immediate UX problems, then work through the remaining priorities systematically.
