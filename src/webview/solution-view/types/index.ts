import { MenuActionType, ProjectNode } from "../../../types";
import { NodeIdString } from "../../../types/nodeId";

export type NodeType = 'solution' | 'solutionFolder' | 'project' | 'folder' | 'file' | 'dependencies' | 'dependency' | 'dependencyCategory' | 'packageDependencies' | 'projectDependencies' | 'assemblyDependencies' | 'solutionItem';

// All project actions (includes menu actions + internal actions)
export type ProjectActionType = MenuActionType | 'contextMenu' | 'startRename' | 'collapseParent' | 'cancelTemporaryNode';


export interface TreeNodeProps {
    node: ProjectNode;
    level: number;
    activeFilePath?: string | null;
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
    activeFilePath?: string | null;
    onProjectAction: (action: ProjectActionType, nodeId: NodeIdString, data: any | undefined) => void;
    onExpandNode?: (nodeId: NodeIdString, nodeType: string) => void;
    onCollapseNode?: (nodeId: NodeIdString) => void;
}

export interface FrameworkSelectorProps {
    frameworks: string[];
    activeFramework?: string;
    onFrameworkChange: (framework: string) => void;
}