# Solution Tree Context Menu & Functionality TODO

**FIXED**: ✅ Expansion state collapse issue - Solution folders and dependency categories now properly maintain expansion state during all operations. Root cause was in getExpandedNodePaths() not traversing children of expanded nodes, so expansion states were never saved to workspace storage.

**CURRENT PRIORITY**: Solution folder add/remove operations don't immediately update the tree - file change detection appears to be missing some .sln file modifications. Adding one folder shows nothing, adding a second folder shows the first one.

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

## ✅ Architectural Refactoring - COMPLETED!

### ✅ Major Services Successfully Extracted

**Result**: SolutionWebviewProvider reduced from ~1600 lines to ~1100 lines (30% reduction achieved)

**Services Created**:

- ✅ **SolutionTreeService** (~378 lines) - Tree building and hierarchy management

  - ✅ `buildSolutionTree()` - Build complete tree from Solution data
  - ✅ `mergeTreeStates()` - Merge fresh data with cached expansion states
  - ✅ `updateNodeInTree()` - Update specific nodes in tree structure
  - ✅ `findNodeByPath()` - Tree traversal utilities
  - ✅ `getAllValidPathsFromTree()` - Path validation utilities
  - ✅ `convertProjectChildrenToProjectNodes()` - Type conversion utilities

- ✅ **SolutionActionService** (~350+ lines) - Handle all project/solution operations

  - ✅ Project operations (build, clean, rebuild, restore)
  - ✅ Solution folder operations (add, remove with GUID-based safety)
  - ✅ File operations (delete, reveal, open with binary file handling)
  - ✅ Solution item operations (add, remove)
  - ✅ Project management (add existing, remove, delete)

- ✅ **SolutionExpansionService** (~350+ lines) - Expansion logic and state management
  - ✅ `handleExpandNode()` - Node expansion with lazy loading
  - ✅ `handleCollapseNode()` - Node collapse with cleanup
  - ✅ `restoreExpansionStates()` - State restoration on startup
  - ✅ `saveExpansionState()` / `getExpansionState()` - Workspace persistence
  - ✅ `getExpandedNodePaths()` - Path collection utilities

### ✅ Critical Fixes Included

- ✅ **Fixed folder expansion bug** - Folders now show expand arrows and children properly
- ✅ **GUID-based solution folder operations** - Much safer than name-based parsing
- ✅ **Improved error handling** - Better error messages and fallback behavior
- ✅ **Enhanced logging** - Better debugging information throughout

### ✅ Benefits Achieved

- **Separation of Concerns**: Each service has single responsibility
- **Maintainability**: Much easier to understand, test, and modify individual services
- **Reusability**: Services can be used by other extension components
- **Performance**: Fixed critical folder expansion issue
- **Robustness**: GUID-based operations for solution folders

**Ready for Priority 2 Features**: The codebase is now well-structured to handle Dependencies, NuGet, Add Reference, etc.

## 📋 Missing Context Menu Actions (Priority 2)

### Solution Node Context Menu

- [x] Add Existing Project (file dialog to select .csproj) [can we just use the file picker thingy?]
- [x] Add New Project (project template selection) [QuickPick for now]
- [x] Add Solution Folder
- [x] Restore Nugets
- [x] Build commands (Clean, Build, Rebuild) like on project node.
- [ ] Double click on solution node should open the solution file, doesn nothing right now.

### Solution Folder Context Menu

- [ ] Add Solution Folder (sub-folder)
      --> Regression this does not work anymore.
      --> all solution folders collapse.
      --> They get added at root so it seems we don't update (GlobalSection(NestedProjects))
- [x] Remove
- [ ] Add Existing Item...
      --> Regression this does not work anymore gets added but in the right place but tree does not update.
      --> all solution folders collapse.
- [x] Rename

### Solution Folder Item Context Menu

- [x] Remove (from solution folder, don't delete the file) - Current "Remove from Solution" implementation handles this correctly

Note: Solution folders in Visual Studio are virtual organizational containers. They typically don't have "Add New Project" or "Add Existing Project" - those operations happen at the solution level. Solution folders can contain sub-folders and can have projects moved into them.

- [] Get rid of add framework reference
- [] Get rid of add assembly reference.

### Project Node Context Menu

- [x] **Dependencies node functionality** (PRIORITY - COMPLETED!)
  - [x] Restore Dependencies container node display ✅
  - [x] Fix collapse bug when clicking dependencies node ✅
  - [x] Implement dependencies expansion to show individual packages ✅
  - [x] Add context menu for dependencies (Manage NuGet Packages, Add Reference, Restore Dependencies)

### Project Depencency Node Context Menu

- [ ] Add Project Reference should open file selection. (also on "Projects" child node)
- [x] Manage NuGet Packages (also on "Packges" child node)
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
