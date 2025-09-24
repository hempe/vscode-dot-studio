import { Dependency } from "../../../parsers/projectFileParser";

export type NodeType = 'solution' | 'solutionFolder' | 'project' | 'folder' | 'file' | 'dependencies' | 'dependency';

// Context menu actions only
export type MenuActionType = 'openFile' | 'rename' | 'deleteFile' | 'revealInExplorer' | 'removeProject' | 'deleteProject' | 'build' | 'rebuild' | 'clean' | 'addExistingProject' | 'addNewProject';

// All project actions (includes menu actions + internal actions)
export type ProjectActionType = MenuActionType | 'contextMenu' | 'startRename' | 'collapseParent';

export interface ProjectNode {
    type: NodeType;
    name: string;
    path: string;
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
    onToggleExpand: (path: string, nodeType: string) => void;
    onNodeClick: (path: string) => void;
    onNodeFocus: (path: string) => void;
    onContextMenu: (x: number, y: number, node: ProjectNode) => void;
    onRenameConfirm: (newName: string, nodePath: string, nodeType: NodeType, oldName: string) => void;
    onRenameCancel: () => void;
    selectedNodePath?: string;
    focusedNodePath?: string;
    renamingNodePath?: string;
}

export interface SolutionTreeProps {
    projects: any[];
    onProjectAction: (action: ProjectActionType, projectPath: string, data?: any) => void;
    onExpandNode?: (nodePath: string, nodeType: string) => void;
    onCollapseNode?: (nodePath: string) => void;
}

export interface FrameworkSelectorProps {
    frameworks: string[];
    activeFramework?: string;
    onFrameworkChange: (framework: string) => void;
}