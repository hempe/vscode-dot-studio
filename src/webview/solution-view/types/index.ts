export type NodeType = 'solution' | 'solutionFolder' | 'project' | 'folder' | 'file' | 'dependencies' | 'dependency';

export interface ProjectNode {
    type: NodeType;
    name: string;
    path: string;
    children?: ProjectNode[];
    expanded?: boolean;
    isSolutionFolder?: boolean; // Flag to help distinguish virtual vs filesystem folders
}

export interface SolutionData {
    projects: any[];
    frameworks: string[];
    activeFramework?: string;
}

export interface TreeNodeProps {
    node: ProjectNode;
    level: number;
    onProjectAction: (action: string, projectPath: string, data?: any) => void;
    onToggleExpand: (path: string) => void;
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
    onProjectAction: (action: string, projectPath: string, data?: any) => void;
}

export interface FrameworkSelectorProps {
    frameworks: string[];
    activeFramework?: string;
    onFrameworkChange: (framework: string) => void;
}