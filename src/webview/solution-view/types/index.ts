import { Dependency } from "../../../parsers/projectFileParser";
import { NodeIdString } from "../../shared/nodeIdUtils";

export type NodeType = 'solution' | 'solutionFolder' | 'project' | 'folder' | 'file' | 'dependencies' | 'dependency' | 'dependencyCategory' | 'packageDependencies' | 'projectDependencies' | 'assemblyDependencies' | 'solutionItem';

// Context menu actions only
export type MenuActionType = 'openFile' | 'rename' | 'deleteFile' | 'revealInExplorer' | 'removeProject' | 'deleteProject' | 'build' | 'rebuild' | 'clean' | 'restoreNugets' | 'addExistingProject' | 'addNewProject' | 'addSolutionFolder' | 'removeSolutionFolder' | 'addSolutionItem' | 'removeSolutionItem' | 'manageNuGetPackages' | 'manageNuGetPackagesForSolution' | 'addProjectReference' | 'restoreDependencies' | 'removeDependency' | 'setStartupProject' | 'addFile' | 'addFolder' | 'copy' | 'cut' | 'paste';

// All project actions (includes menu actions + internal actions)
export type ProjectActionType = MenuActionType | 'contextMenu' | 'startRename' | 'collapseParent' | 'cancelTemporaryNode';

export interface ProjectChild {
    type: NodeType;
    name: string;
    nodeId: NodeIdString;
    hasChildren?: boolean;
    expanded?: boolean;
    children?: ProjectChild[];
    isLoaded?: boolean;
}
export interface ProjectNode {
    type: NodeType;
    name: string;
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
    nodeId: NodeIdString; // Unique node identifier for all operations
    isTemporary?: boolean; // Indicates if this is a temporary node for creation
    isEditing?: boolean; // Indicates if this node should be in editing mode
}

export interface SolutionData {
    projects: any[];
    frameworks: string[];
    activeFramework?: string;
}

export interface TreeNodeProps {
    node: ProjectNode;
    level: number;
    onProjectAction: (action: ProjectActionType, nodeId: NodeIdString, data: any | undefined) => void;
    onToggleExpand: (nodeId: NodeIdString, nodeType: string) => void;
    onNodeClick: (nodeId: NodeIdString) => void;
    onNodeFocus: (nodeId: NodeIdString) => void;
    onContextMenu: (x: number, y: number, node: ProjectNode) => void;
    onRenameConfirm: (newName: string, nodeId: NodeIdString, nodeType: NodeType, oldName: string) => void;
    onRenameCancel: () => void;
    selectedNodeId?: NodeIdString; // Node ID for selection
    focusedNodeId?: NodeIdString; // Node ID for focus
    renamingNodeId?: NodeIdString; // Node ID for renaming
}

export interface SolutionTreeProps {
    projects: any[];
    onProjectAction: (action: ProjectActionType, nodeId: NodeIdString, data: any | undefined) => void;
    onExpandNode?: (nodeId: NodeIdString, nodeType: string) => void;
    onCollapseNode?: (nodeId: NodeIdString) => void;
}

export interface FrameworkSelectorProps {
    frameworks: string[];
    activeFramework?: string;
    onFrameworkChange: (framework: string) => void;
}