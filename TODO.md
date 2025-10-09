# Solution Tree Context Menu & Functionality TODO

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

## 📋 Missing Context Menu Actions (Priority 2)

### Solution Node Context Menu

- [x] Add Existing Project (file dialog to select .csproj) [can we just use the file picker thingy?]
- [x] Add New Project (project template selection) [QuickPick for now]
- [x] Add Solution Folder
- [x] Restore Nugets
- [x] Build commands (Clean, Build, Rebuild) like on project node.
- [x] Double click on solution node should open the solution file, doesn nothing right now.

### Solution Folder Context Menu

- [x] Add Solution Folder (sub-folder)
      --> Regression this does not work anymore.
      --> all solution folders collapse.
      --> They get added at root so it seems we don't update (GlobalSection(NestedProjects))
- [x] Remove
- [x] Add Existing Item...
      --> Regression this does not work anymore gets added but in the right place but tree does not update.
      --> all solution folders collapse.
- [x] Rename

### Solution Folder Item Context Menu

- [x] Remove (from solution folder, don't delete the file) - Current "Remove from Solution" implementation handles this correctly

Note: Solution folders in Visual Studio are virtual organizational containers. They typically don't have "Add New Project" or "Add Existing Project" - those operations happen at the solution level. Solution folders can contain sub-folders and can have projects moved into them.

- [x] Get rid of add framework reference
- [x] Get rid of add assembly reference.

### Project Node Context Menu

- [x] **Dependencies node functionality** (PRIORITY - COMPLETED!)
  - [x] Restore Dependencies container node display ✅
  - [x] Fix collapse bug when clicking dependencies node ✅
  - [x] Implement dependencies expansion to show individual packages ✅
  - [x] Add context menu for dependencies (Manage NuGet Packages, Add Reference, Restore Dependencies)

### Project Depencency Node Context Menu

- [x] Add Project Reference should open file selection. (also on "Projects" child node)
- [x] Manage NuGet Packages (also on "Packges" child node)
- [x] DEL should trigger the remove (on the child nodes where we already have the remove action)

### Project node context menu

- [x] Set as Startup project [startup project should be "bold" in the tree ] (setStartupProject)

### Project and File Node Context Menu

- [ ] Add File (can we add a temp node in the tree where the file name is in edit mode and when I finish the "rename" like action it creates an empty file)?
- [ ] Add Folder (same idea as above)

### File and Folder Context Menu

- [ ] Copy/Cut/Paste

## 🔧 Functionality Gaps (Priority 3)

### Project node context menu

- [ ] Properties (Properties are a folder so I think this part can wait until we do the ui for it)

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
