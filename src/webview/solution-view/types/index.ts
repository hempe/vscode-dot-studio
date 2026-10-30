import type { DragEvent, MouseEvent } from 'react';
import { DiagnosticMarkers, NodeType, ProjectNode } from "../../../types";
import { NodeIdString } from "../../../types/nodeId";
import { ProjectActionCmd } from "../../../types/commands/project-action";


export interface TreeNodeProps {
    node: ProjectNode;
    level: number;
    /** The node is in a test project (set for the children of a test project node) */
    inTestProject?: boolean;
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
    /** Drag & drop (the tree decides what may go where): the row a drop would go into, and the row's drag events */
    dropTargetId?: NodeIdString;
    onNodeDragStart?: (nodeId: NodeIdString, e: DragEvent) => void;
    onNodeDragOver?: (nodeId: NodeIdString, e: DragEvent) => void;
    onNodeDrop?: (nodeId: NodeIdString, e: DragEvent) => void;
    onNodeDragEnd?: () => void;
    /** The row under the mouse: a class, not CSS :hover, which Chromium moves to a wrong row after a drop */
    /** A mouseover or mousemove on the row */
    onNodeHover?: (nodeId: NodeIdString, e: MouseEvent) => void;
    /** The mouse enters (with the name's box) or leaves the name of a node with problems: its hint opens and closes */
    onMarkerHover?: (nodeId: NodeIdString, anchor: DOMRect | undefined, name: string) => void;
}

export interface SolutionTreeProps {
    projects: any[];
    onProjectAction: (action: ProjectActionCmd) => void;
    onExpandNode?: (nodeId: NodeIdString) => void;
    onCollapseNode?: (nodeId: NodeIdString) => void;
    markers?: DiagnosticMarkers;
}
