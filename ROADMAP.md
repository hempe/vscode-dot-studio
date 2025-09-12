# 🗺️ .NET Extension Roadmap

This roadmap outlines the development priorities for bringing full Visual Studio Solution Explorer parity to VS Code, organized by implementation priority and user impact.

## 🚨 Phase 1: Critical Placeholders (Q1 2025)

### 1.1 NuGet Package Manager - Installed Packages Tab
**Priority: CRITICAL** | **Effort: Medium** | **Impact: High**

**Current State**: Shows placeholder "No packages installed"
**Target State**: 
- Parse all `.csproj` files in solution to discover installed packages
- Show package name, version, and target projects
- Enable package removal and version updates
- Support bulk operations across multiple projects

**Implementation Plan**:
- Create `PackageDiscoveryService` to parse PackageReference nodes
- Build installed packages data model with project mapping
- Implement package removal via `dotnet remove package`
- Add update functionality with version conflict detection

---

### 1.2 NuGet Package Manager - Updates Tab
**Priority: HIGH** | **Effort: Medium** | **Impact: High**

**Current State**: Shows placeholder "All packages are up to date"
**Target State**:
- Check for package updates using NuGet API
- Show available versions with release notes
- Enable selective or bulk updates
- Handle dependency conflicts and breaking changes

**Implementation Plan**:
- Integrate with NuGet API to check for newer versions
- Compare installed vs. available versions
- Implement update workflow with dependency resolution
- Add pre-release/stable filtering options

---

### 1.3 Project References Node in Tree View
**Priority: CRITICAL** | **Effort: Medium** | **Impact: High**

**Current State**: References are hidden in Dependencies node
**Target State**:
- Dedicated "References" node under each project
- Separate subnodes for Project References, Package References, Framework References
- Context menus for adding/removing references
- Visual indicators for missing or broken references

**Implementation Plan**:
- Extend `ProjectFileParser` to extract reference information
- Create new tree node types for different reference categories
- Implement reference management commands
- Add reference validation and error indicators

---

## 🔧 Phase 2: Core Functionality Enhancement (Q2 2025)

### 2.1 Multi-Project Selection and Batch Operations
**Priority: HIGH** | **Effort: High** | **Impact: High**

**Current State**: Single project operations only
**Target State**:
- Ctrl+Click and Shift+Click multi-selection
- Batch build, clean, rebuild operations
- Bulk NuGet package installation across projects
- Consistent multi-project context menus

**Implementation Plan**:
- Extend TreeView to support multi-selection
- Modify command handlers to accept project arrays
- Implement batch operation queuing and progress tracking
- Add cancellation support for long-running operations

---

### 2.2 Solution Configurations and Platform Management
**Priority: HIGH** | **Effort: High** | **Impact: Medium**

**Current State**: No configuration management
**Target State**:
- Debug/Release configuration switching
- Platform targeting (AnyCPU, x86, x64)
- Configuration-specific build operations
- Visual indicators in status bar

**Implementation Plan**:
- Parse solution configuration sections
- Create configuration management UI components
- Integrate with MSBuild for configuration-aware builds
- Add status bar configuration selector

---

### 2.3 Enhanced Project Template System
**Priority: MEDIUM** | **Effort: Medium** | **Impact: Medium**

**Current State**: Basic dotnet CLI templates
**Target State**:
- Custom template parameters (namespace, framework version)
- Project location selection dialog
- Template preview and description
- Integration with community template packages

**Implementation Plan**:
- Create template metadata parsing system
- Build template parameter input UI
- Add project location picker with validation
- Implement template package discovery and installation

---

## 🏗️ Phase 3: Advanced Development Features (Q3 2025)

### 3.1 Build System Integration
**Priority: HIGH** | **Effort: High** | **Impact: High**

**Current State**: Basic terminal output
**Target State**:
- Parsed build errors and warnings with clickable navigation
- Problems panel integration
- Build progress indicators
- MSBuild diagnostic output parsing

**Implementation Plan**:
- Implement MSBuild output parser
- Create diagnostic problem provider
- Add build progress tracking with cancellation
- Integrate with VS Code Problems panel

---

### 3.2 Testing Framework Integration
**Priority: MEDIUM** | **Effort: High** | **Impact: Medium**

**Current State**: No test integration
**Target State**:
- Test project detection and special icons
- Test discovery and execution from Solution Explorer
- Integration with VS Code Test Explorer API
- Test result indicators in project tree

**Implementation Plan**:
- Create test project detection logic
- Implement VS Code Test Provider interface
- Add test execution and result tracking
- Build test-specific context menus

---

### 3.3 Package Manager Console
**Priority: MEDIUM** | **Effort: High** | **Impact: Low**

**Current State**: GUI-only package management
**Target State**:
- PowerShell-like console for package operations
- Command history and auto-completion
- Scripting support for complex operations
- Integration with existing package management UI

**Implementation Plan**:
- Create embedded terminal with PowerShell-like interface
- Implement package management command set
- Add auto-completion for package names and versions
- Build command history and scripting capabilities

---

## 📊 Phase 4: Productivity and Polish (Q4 2025)

### 4.1 Solution-wide Find and Replace
**Priority: MEDIUM** | **Effort: Medium** | **Impact: Medium**

**Current State**: Standard VS Code search only
**Target State**:
- Solution-scoped search with project filtering
- Advanced replace operations across multiple files
- Search result grouping by project
- Integration with VS Code search UI

**Implementation Plan**:
- Extend VS Code search provider for solution scope
- Create solution-aware search and replace logic
- Add project-based result filtering
- Implement batch replace operations

---

### 4.2 Project Properties Management
**Priority: MEDIUM** | **Effort: Medium** | **Impact: Medium**

**Current State**: Manual .csproj editing only
**Target State**:
- Graphical project properties dialog
- Common settings: target framework, output type, etc.
- Build and debug configuration management
- Package metadata editing

**Implementation Plan**:
- Create webview-based properties editor
- Parse and modify .csproj XML programmatically
- Add form validation and error handling
- Implement property change tracking

---

### 4.3 NuGet Package Manager - Consolidate Tab
**Priority: LOW** | **Effort: Medium** | **Impact: Low**

**Current State**: Shows placeholder "No version conflicts"
**Target State**:
- Detect version conflicts across projects
- Suggest consolidation actions
- Bulk version alignment operations
- Dependency impact analysis

**Implementation Plan**:
- Create cross-project package version analyzer
- Build conflict detection and resolution logic
- Implement bulk consolidation operations
- Add dependency impact visualization

---

## 🚀 Phase 5: Advanced Features (2026)

### 5.1 Dependency Graph Visualization
**Priority: LOW** | **Effort: High** | **Impact: Medium**

**Target State**:
- Interactive visual dependency graph
- Circular dependency detection
- Impact analysis for changes
- Export capabilities for documentation

---

### 5.2 Scaffolding System
**Priority: LOW** | **Effort: High** | **Impact: Low**

**Target State**:
- MVC controller and view generation
- Entity Framework scaffolding
- Custom scaffolding templates
- Integration with existing project structure

---

### 5.3 Advanced Project Types Support
**Priority: LOW** | **Effort: High** | **Impact: Low**

**Target State**:
- Shared Projects (.shproj) support
- Database Projects (.sqlproj) support
- Docker and container project integration
- Custom SDK-style project support

---

## 📋 Implementation Notes

### Development Principles
1. **Maintain VS Code Integration**: Follow VS Code extension patterns and APIs
2. **Preserve Performance**: Ensure fast loading and responsive UI
3. **User Experience First**: Prioritize intuitive workflows over feature completeness
4. **Incremental Delivery**: Each phase should deliver working, testable features
5. **Backward Compatibility**: Don't break existing functionality

### Technical Considerations
- **Service Architecture**: Continue expanding service layer for maintainability
- **Error Handling**: Robust error handling and user feedback for all operations
- **Testing Strategy**: Maintain high test coverage with each new feature
- **API Stability**: Design APIs that can evolve without breaking changes

### Success Metrics
- **Feature Completeness**: % of Visual Studio Solution Explorer features implemented
- **User Adoption**: Usage metrics and community feedback
- **Performance**: Solution loading time and operation responsiveness  
- **Reliability**: Error rates and crash frequency
- **Developer Experience**: Time to complete common development tasks

---

## 🎯 Milestone Targets

| Phase | Completion Target | Key Deliverables | VS Parity % |
|-------|------------------|------------------|-------------|
| **Phase 1** | Q1 2025 | Working NuGet management, References tree | 95% |
| **Phase 2** | Q2 2025 | Multi-selection, configurations, templates | 98% |
| **Phase 3** | Q3 2025 | Build integration, testing, console | 100%+ |
| **Phase 4** | Q4 2025 | Search, properties, polish features | 105%+ |
| **Phase 5** | 2026+ | Advanced visualizations and tools | 110%+ |

**Current Status: 90% Visual Studio Parity** ✅

This roadmap aims to achieve **full Visual Studio Solution Explorer parity by Q2 2025**, with advanced features and productivity enhancements following through 2025-2026.