import { Dependency } from "../../../parsers/projectFileParser";

export type NodeType = 'solution' | 'solutionFolder' | 'project' | 'folder' | 'file' | 'dependencies' | 'dependency' | 'dependencyCategory' | 'packageDependencies' | 'projectDependencies' | 'assemblyDependencies' | 'solutionItem';

// Context menu actions only
export type MenuActionType = 'openFile' | 'rename' | 'deleteFile' | 'revealInExplorer' | 'removeProject' | 'deleteProject' | 'build' | 'rebuild' | 'clean' | 'restoreNugets' | 'addExistingProject' | 'addNewProject' | 'addSolutionFolder' | 'removeSolutionFolder' | 'addSolutionItem' | 'removeSolutionItem' | 'manageNuGetPackages' | 'manageNuGetPackagesForSolution' | 'addProjectReference' | 'restoreDependencies' | 'removeDependency' | 'setStartupProject' | 'addFile' | 'addFolder';

// All project actions (includes menu actions + internal actions)
export type ProjectActionType = MenuActionType | 'contextMenu' | 'startRename' | 'collapseParent';

export interface ProjectNode {
    type: NodeType;
    name: string;
    path: string; // Keep for display and legacy compatibility - but use expansionId for operations
    children?: ProjectNode[];
    expanded?: boolean;
    isSolutionFolder?: boolean; // Flag to help distinguish virtual vs filesystem folders
    projectDependencies?: Dependency[];
    frameworks?: string[];
    typeGuid?: string;
    guid?: string;
    isLoaded?: boolean; // For lazy loading - indicates if children have been loaded
    hasChildren?: boolean; // Indicates if the node has children that can be loaded
    isLoading?: boolean; // Show loading state while backend processes expand/collapse
    isStartupProject?: boolean; // Indicates if this project is the startup project
    nodeId: string; // Unique node identifier for all operations
}

export interface SolutionData {
    projects: any[];
    frameworks: string[];
    activeFramework?: string;
}

export interface TreeNodeProps {
    node: ProjectNode;
    level: number;
    onProjectAction: (action: ProjectActionType, projectPath: string, data?: any) => void;
    onToggleExpand: (nodeId: string, nodeType: string) => void;
    onNodeClick: (nodeId: string) => void;
    onNodeFocus: (nodeId: string) => void;
    onContextMenu: (x: number, y: number, node: ProjectNode) => void;
    onRenameConfirm: (newName: string, filePath: string, nodeType: NodeType, oldName: string) => void;
    onRenameCancel: () => void;
    selectedNodeId?: string; // Node ID for selection
    focusedNodeId?: string; // Node ID for focus
    renamingNodeId?: string; // Node ID for renaming
}

export interface SolutionTreeProps {
    projects: any[];
    onProjectAction: (action: ProjectActionType, projectPath: string, data?: any) => void;
    onExpandNode?: (nodeId: string, nodeType: string) => void;
    onCollapseNode?: (nodeId: string) => void;
}

export interface FrameworkSelectorProps {
    frameworks: string[];
    activeFramework?: string;
    onFrameworkChange: (framework: string) => void;
}