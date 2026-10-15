import { DiagnosticMarkers, NodeType, ProjectNode } from "../../../types";
import { NodeIdString } from "../../../types/nodeId";
import { ProjectActionCmd } from "../../../types/commands/project-action";


export interface TreeNodeProps {
    node: ProjectNode;
    level: number;
    /** The node is in a test project (set for the children of a test project node) */
    inTestProject?: boolean;
    activeFilePath?: string | null;
    onProjectAction: (action: ProjectActionCmd) => void;
    onToggleExpand: (nodeId: NodeIdString, nodeType: NodeType) => void;
    /** `toggle`: Ctrl/Cmd+click, `range`: Shift+click (multi-select) */
    onNodeClick: (nodeId: NodeIdString, modifiers?: { toggle?: boolean; range?: boolean }) => void;
    onNodeFocus: (nodeId: NodeIdString) => void;
    /** Right-click: a node outside the selection becomes the only selected one */
    onNodeContextMenu?: (nodeId: NodeIdString) => void;
    onRenameConfirm: (newName: string, nodeId: NodeIdString, nodeType: NodeType, oldName: string) => void;
    onRenameCancel: () => void;
    selectedNodeId?: NodeIdString; // Node ID for selection
    /** All selected nodes (multi-select) */
    selectedNodeIds?: ReadonlySet<NodeIdString>;
    focusedNodeId?: NodeIdString; // Node ID for focus
    renamingNodeId?: NodeIdString; // Node ID for renaming
    markers?: DiagnosticMarkers; // Error/warning markers by node ID
}

export interface SolutionTreeProps {
    projects: any[];
    activeFilePath?: string | null;
    onProjectAction: (action: ProjectActionCmd) => void;
    onExpandNode?: (nodeId: NodeIdString) => void;
    onCollapseNode?: (nodeId: NodeIdString) => void;
    markers?: DiagnosticMarkers;
}

export interface FrameworkSelectorProps {
    frameworks: string[];
    activeFramework?: string;
    onFrameworkChange: (framework: string) => void;
}