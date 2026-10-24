/**
 * What may be dropped where in the Solution Explorer, like Visual Studio. Pure and browser-safe (type imports only):
 * the webview uses it for the drop highlight, the extension host checks every drop again with nodes it makes from the
 * solution itself. Nodes are compared by id only; ids are opaque here.
 */
import type { NodeType, ProjectNode } from '../types';
import type { NodeIdString } from '../types/nodeId';

export interface DropAncestor {
    readonly nodeId: NodeIdString;
    readonly type: NodeType;
}

export interface DropNode extends DropAncestor {
    /** The nodes above it, nearest first, up to the solution node */
    readonly ancestors: readonly DropAncestor[];
    readonly isUnloaded?: boolean;
    readonly isTemporary?: boolean;
    readonly itemState?: 'excluded' | 'linked';
    /** The node's `contextValue`: tells the Projects category under Dependencies from the others */
    readonly contextValue?: string;
}

/** `link`: projects dropped onto Dependencies get a project reference */
export type DropEffect = 'move' | 'copy' | 'link';

export interface DropVerdict {
    /** The dragged nodes that go to the target, in drag order; none: the drop is not allowed */
    readonly nodes: readonly DropNode[];
    /** Where they go: the target, or for a file target the folder or project it is in */
    readonly container?: DropAncestor;
    /** `copy` only for files and folders with Ctrl (Cmd on macOS) held; `link` for projects onto Dependencies */
    readonly effect: DropEffect;
}

const FILE_LIKE: readonly NodeType[] = ['file', 'folder'];
const SOLUTION_LEVEL: readonly NodeType[] = ['project', 'solutionFolder', 'solutionItem'];
const isContainer = (node: DropAncestor) => node.type === 'folder' || node.type === 'project';
/** Dependencies, or Projects under it: a project dropped there becomes a project reference, as in Visual Studio */
const isReferenceTarget = (node: DropNode) => node.type === 'dependencies' || (node.type === 'dependencyCategory' && node.contextValue === 'projects');

/**
 * Files, folders, projects, solution folders and solution items have a move; not linked files, unloaded projects,
 * nodes being created, nor Dependencies, packages, analyzers, generated files and the solution
 */
export function isDraggable(node: Pick<DropNode, 'type' | 'isUnloaded' | 'isTemporary' | 'itemState'>): boolean {
    if (node.isTemporary || node.itemState === 'linked') {
        return false;
    }
    if (node.type === 'project') {
        return !node.isUnloaded;
    }
    return FILE_LIKE.includes(node.type) || SOLUTION_LEVEL.includes(node.type);
}

/** Where a node is now: for files and folders the folder or project they are in, otherwise their parent */
function currentContainer(node: DropNode): DropAncestor | undefined {
    return FILE_LIKE.includes(node.type) ? node.ancestors.find(isContainer) : node.ancestors[0];
}

/** Where `node` would go when dropped on `target`; undefined: not there */
function containerFor(node: DropNode, target: DropNode): DropAncestor | undefined {
    switch (node.type) {
        case 'file':
        case 'folder':
            if (target.isTemporary || target.isUnloaded || target.itemState === 'linked') {
                return undefined;
            }
            if (isContainer(target)) {
                return target;
            }
            return target.type === 'file' ? target.ancestors.find(isContainer) : undefined;
        case 'project':
            // Onto another project's Dependencies: its own project is in the target's ancestors, so canDrop refuses that
            return target.type === 'solution' || target.type === 'solutionFolder' || isReferenceTarget(target) ? target : undefined;
        case 'solutionFolder':
            return target.type === 'solution' || target.type === 'solutionFolder' ? target : undefined;
        case 'solutionItem':
            return target.type === 'solutionFolder' ? target : undefined;
        default:
            return undefined;
    }
}

export function canDrop(dragged: readonly DropNode[], target: DropNode, copyKey = false): DropVerdict {
    const draggedIds = new Set(dragged.map(node => node.nodeId));
    // The target and everything above it: a node dropped there would land inside itself
    const targetChain = new Set([target.nodeId, ...target.ancestors.map(ancestor => ancestor.nodeId)]);
    let container: DropAncestor | undefined;
    const nodes = dragged.filter(node => {
        if (!isDraggable(node) || targetChain.has(node.nodeId)) {
            return false;
        }
        // It goes along with a dragged node above it
        if (node.ancestors.some(ancestor => draggedIds.has(ancestor.nodeId))) {
            return false;
        }
        const into = containerFor(node, target);
        if (!into || into.nodeId === currentContainer(node)?.nodeId) {
            return false;
        }
        container = into;
        return true;
    });
    const copy = copyKey && nodes.length > 0 && nodes.every(node => FILE_LIKE.includes(node.type));
    const effect: DropEffect = nodes.length > 0 && isReferenceTarget(target) ? 'link' : copy ? 'copy' : 'move';
    return { nodes, container: nodes.length > 0 ? container : undefined, effect };
}

/** The rule nodes of a tree the webview shows, by id (only what is loaded: collapsed folders have no children yet) */
export function dropNodeIndex(roots: readonly ProjectNode[]): Map<NodeIdString, DropNode> {
    const index = new Map<NodeIdString, DropNode>();
    const walk = (nodes: readonly ProjectNode[], ancestors: readonly DropAncestor[]) => {
        for (const node of nodes) {
            index.set(node.nodeId, {
                nodeId: node.nodeId,
                type: node.type,
                ancestors,
                isUnloaded: node.isUnloaded,
                isTemporary: node.isTemporary,
                itemState: node.itemState,
                contextValue: node.contextValue,
            });
            if (node.children) {
                walk(node.children, [{ nodeId: node.nodeId, type: node.type }, ...ancestors]);
            }
        }
    };
    walk(roots, []);
    return index;
}
