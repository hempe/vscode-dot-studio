import { NodeType, ProjectNode } from "../../../types";
import { NodeIdString } from "../../../types/nodeId";
import { ProjectActionCmd } from "../../../types/commands/project-action";


export interface TreeNodeProps {
    node: ProjectNode;
    level: number;
    activeFilePath?: string | null;
    onProjectAction: (action: ProjectActionCmd) => void;
    onToggleExpand: (nodeId: NodeIdString, nodeType: NodeType) => void;
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
    onProjectAction: (action: ProjectActionCmd) => void;
    onExpandNode?: (nodeId: NodeIdString) => void;
    onCollapseNode?: (nodeId: NodeIdString) => void;
}

export interface FrameworkSelectorProps {
    frameworks: string[];
    activeFramework?: string;
    onFrameworkChange: (framework: string) => void;
}