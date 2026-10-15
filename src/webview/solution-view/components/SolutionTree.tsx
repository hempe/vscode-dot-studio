import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SolutionTreeProps } from '../types';
import { TreeNode } from './TreeNode/TreeNode';
import { LoadingBar } from '../../shared/LoadingBar';
import { logger } from '../../shared/logger';
import { nodeIdToKey, keyToNodeId } from '../../shared/nodeIdUtils';
import { NodeIdString } from '../../../types/nodeId';
import { NodeType, ProjectNode } from '../../../types';
import { ProjectActionCmd } from '../../../types/commands/project-action';
import { UICmd } from '../../../types/commands/ui';
import { sendToBackend } from '../../nuget-view/shared';

const log = logger('SolutionTree');
export const SolutionTree: React.FC<SolutionTreeProps> = ({ projects, activeFilePath, onProjectAction, onExpandNode, onCollapseNode, markers }) => {
    const treeRef = useRef<HTMLDivElement>(null);
    // Backend controls all expansion state - no local expansion management
    const [selectedNodeId, setSelectedNodeId] = useState<NodeIdString | undefined>();
    const [focusedNodeId, setFocusedNodeId] = useState<NodeIdString | undefined>();
    const [renamingNodeId, setRenamingNodeId] = useState<NodeIdString | undefined>();
    const [localLoadingNodes, setLocalLoadingNodes] = useState<Set<string>>(new Set());


    // Helper function to find node in tree by node ID
    const findNodeById = useCallback((nodeId: NodeIdString, nodes: ProjectNode[]): ProjectNode | null => {
        for (const node of nodes) {
            if (node.nodeId === nodeId) {
                return node;
            }
            if (node.children) {
                const found = findNodeById(nodeId, node.children);
                if (found) return found;
            }
        }
        return null;
    }, []);

    const handleToggleExpand = (nodeId: NodeIdString, nodeType: NodeType) => {
        log.info(`Toggle expand request for nodeId: ${nodeId}, type: ${nodeType}`);

        // Find the node to check its current state
        const node = findNodeById(nodeId, treeNodes);
        if (!node) {
            log.warn(`Node not found: ${nodeId}`);
            return;
        }

        if (node.expanded) {
            log.info(`Requesting collapse: ${nodeId}`);
            onCollapseNode?.(nodeId);
        } else {
            log.info(`Requesting expand: ${nodeId}`);
            onExpandNode?.(nodeId);
        }
    };

    const handleNodeClick = (nodeId: NodeIdString) => {
        log.info(`Node clicked: ${nodeId}`);
        setSelectedNodeId(nodeId);
        setFocusedNodeId(nodeId);
    };

    const handleNodeFocus = (nodeId: NodeIdString) => {
        log.info(`Setting focus to: ${nodeId}`);
        setFocusedNodeId(nodeId);
    };

    // Node to scroll to once it is rendered (Sync with Active Document)
    const [revealNodeId, setRevealNodeId] = useState<NodeIdString | undefined>();
    const [revealFocus, setRevealFocus] = useState(false);

    // Rename (menu or F2 key binding) and Sync with Active Document are routed back here by the extension
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data as UICmd;
            if (message.type === 'startRename') {
                setFocusedNodeId(message.payload.nodeId);
                setRenamingNodeId(message.payload.nodeId);
            } else if (message.type === 'selectNode') {
                setSelectedNodeId(message.payload.nodeId);
                setFocusedNodeId(message.payload.nodeId);
                setRevealNodeId(message.payload.nodeId);
                setRevealFocus(message.payload.focus !== false);
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const handleRenameConfirm = (newName: string, nodeId: NodeIdString, nodeType: NodeType, oldName: string) => {
        log.info(`Rename confirmed: ${oldName} -> ${newName}`);
        setRenamingNodeId(undefined);
        onProjectAction({
            nodeId,
            action: 'rename',
            data: {
                newName: newName,
                oldName: oldName,
                type: nodeType,
            }
        });
    };

    const handleRenameCancel = () => {
        log.info(`Rename cancelled`);
        setRenamingNodeId(undefined);
    };


    // Convert the projects data into tree structure - backend controls expansion state
    const buildTreeNodes = useCallback((projects: any[]): ProjectNode[] => {
        const result = projects.map(project => ({
            ...project, // Preserve all properties from original data including expanded state
            children: project.children ? buildTreeNodes(project.children) : undefined
        }));

        return result;
    }, []);

    // Flatten tree nodes for keyboard navigation
    const flattenNodes = useCallback((nodes: ProjectNode[], level: number = 0): Array<{ node: ProjectNode, level: number }> => {
        const result: Array<{ node: ProjectNode, level: number }> = [];
        for (const node of nodes) {
            result.push({ node, level });
            if (node.children && node.expanded) {
                result.push(...flattenNodes(node.children, level + 1));
            }
        }
        return result;
    }, []);

    const treeNodes = React.useMemo(() => buildTreeNodes(projects), [buildTreeNodes, projects]);
    const flatNodes = React.useMemo(() => flattenNodes(treeNodes), [flattenNodes, treeNodes]);

    useEffect(() => {
        if (!revealNodeId || !flatNodes.some(item => item.node.nodeId === revealNodeId)) {
            return;
        }
        if (revealFocus) {
            treeRef.current?.focus({ preventScroll: true });
        }
        treeRef.current?.querySelector('.tree-node.selected')?.scrollIntoView({ block: 'nearest' });
        setRevealNodeId(undefined);
    }, [revealNodeId, revealFocus, flatNodes]);

    // Auto-focus the first node for keyboard navigation if no node is focused
    useEffect(() => {
        if (!focusedNodeId && flatNodes.length > 0) {
            setFocusedNodeId(flatNodes[0].node.nodeId);
        }
    }, [focusedNodeId, flatNodes]);

    // Auto-focus newly created temporary nodes
    useEffect(() => {
        const tempNode = flatNodes.find(item => item.node.isTemporary && item.node.isEditing);
        if (tempNode) {
            setFocusedNodeId(tempNode.node.nodeId);
            setRenamingNodeId(tempNode.node.nodeId);
        }
    }, [flatNodes, setFocusedNodeId]);

    const handleProjectActionWrapper = useCallback((cmd: ProjectActionCmd) => {
        if (cmd.action === 'startRename') {
            setRenamingNodeId(cmd.nodeId);
        } else if (cmd.action === 'collapseParent') {
            // Find the parent of the clicked file and collapse it
            const allNodes = flattenNodes(treeNodes);
            const nodeIndex = allNodes.findIndex(item => item.node.nodeId === cmd.nodeId);
            if (nodeIndex >= 0) {
                const currentLevel = allNodes[nodeIndex].level;
                if (currentLevel > 0) {
                    // Find parent node (previous node with level - 1)
                    for (let i = nodeIndex - 1; i >= 0; i--) {
                        if (allNodes[i].level === currentLevel - 1) {
                            const parentNode = allNodes[i].node;
                            if (parentNode.children && parentNode.expanded) {
                                log.info(`Collapsing parent: ${parentNode.name}`);
                                handleToggleExpand(parentNode.nodeId, parentNode.type);
                            }
                            break;
                        }
                    }
                }
            }
        } else {
            onProjectAction(cmd);
        }
    }, [treeNodes, flattenNodes, handleToggleExpand, onProjectAction]);


    // Type-to-find: what was typed within a second, like Visual Studio's tree
    const typed = useRef({ text: '', at: 0 });

    // Keep the focused node in view while moving with the keyboard
    useEffect(() => {
        treeRef.current?.querySelector('.tree-node.focused')?.scrollIntoView?.({ block: 'nearest' });
    }, [focusedNodeId]);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!focusedNodeId) {
                return;
            }

            // Don't handle tree navigation if user is editing text (rename input is focused)
            if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
                return;
            }

            const currentIndex = flatNodes.findIndex(item => item.node.nodeId === focusedNodeId);
            if (currentIndex === -1) return;

            const focusAt = (index: number) => setFocusedNodeId(flatNodes[Math.max(0, Math.min(flatNodes.length - 1, index))].node.nodeId);

            switch (e.key) {
                case 'Home':
                    e.preventDefault();
                    focusAt(0);
                    return;
                case 'End':
                    e.preventDefault();
                    focusAt(flatNodes.length - 1);
                    return;
                case 'PageDown':
                    e.preventDefault();
                    focusAt(currentIndex + 10);
                    return;
                case 'PageUp':
                    e.preventDefault();
                    focusAt(currentIndex - 10);
                    return;
                case 'ArrowDown':
                    e.preventDefault();
                    if (currentIndex < flatNodes.length - 1) {
                        setFocusedNodeId(flatNodes[currentIndex + 1].node.nodeId);
                    }
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    if (currentIndex > 0) {
                        setFocusedNodeId(flatNodes[currentIndex - 1].node.nodeId);
                    }
                    break;
                case 'Enter':
                    e.preventDefault();
                    const focusedNode = flatNodes[currentIndex].node;
                    if (focusedNode.type === 'file' || focusedNode.type === 'generatedFile') {
                        // Open file like double-click
                        onProjectAction({
                            action: 'openFile',
                            nodeId: focusedNode.nodeId
                        });
                    } else if (focusedNode.type === 'solutionFolder') {
                        // Solution folders should only expand/collapse, never open
                        if (focusedNode.children) {
                            handleToggleExpand(focusedNode.nodeId, focusedNode.type);
                        }
                        setSelectedNodeId(focusedNodeId);
                    } else if (focusedNode.type === 'dependencies') {
                        // Dependencies folder should only expand/collapse
                        if (focusedNode.children) {
                            handleToggleExpand(focusedNode.nodeId, focusedNode.type);
                        }
                        setSelectedNodeId(focusedNodeId);
                    } else {
                        // For other node types (projects, regular folders), toggle expansion and select
                        if (focusedNode.children) {
                            handleToggleExpand(focusedNode.nodeId, focusedNode.type);
                        }
                        setSelectedNodeId(focusedNodeId);
                    }
                    break;
                case ' ':
                    e.preventDefault();
                    setSelectedNodeId(focusedNodeId);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    const currentNode = flatNodes[currentIndex].node;
                    if ((currentNode.children || currentNode.hasChildren) && !currentNode.expanded) {
                        handleToggleExpand(currentNode.nodeId, currentNode.type);
                    }
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    const currentNodeLeft = flatNodes[currentIndex].node;
                    if ((currentNodeLeft.children || currentNodeLeft.hasChildren) && currentNodeLeft.expanded) {
                        // If current node has expanded children, collapse it
                        handleToggleExpand(currentNodeLeft.nodeId, currentNodeLeft.type);
                    } else {
                        // If current node has no children or is not expanded, move focus to parent
                        const currentLevel = flatNodes[currentIndex].level;
                        if (currentLevel > 0) {
                            // Find parent node (previous node with level - 1)
                            for (let i = currentIndex - 1; i >= 0; i--) {
                                if (flatNodes[i].level === currentLevel - 1) {
                                    setFocusedNodeId(flatNodes[i].node.nodeId);
                                    break;
                                }
                            }
                        }
                    }
                    break;
                default:
                    if (e.key.length !== 1 || e.key === ' ' || e.ctrlKey || e.metaKey || e.altKey) {
                        break;
                    }
                    findTyped(e.key.toLowerCase(), currentIndex);
                    break;
            }
        };

        /** Moves the focus to the next visible node whose name starts with what was typed */
        const findTyped = (key: string, currentIndex: number) => {
            const now = Date.now();
            const previous = now - typed.current.at < 1000 ? typed.current.text : '';
            // The same letter again cycles through the matches; more letters narrow the current one
            const cycling = previous.length > 0 && [...previous].every(c => c === key);
            const text = cycling ? key : previous + key;
            typed.current = { text: cycling ? previous + key : text, at: now };
            const start = text.length === 1 ? currentIndex + 1 : currentIndex;
            for (let i = 0; i < flatNodes.length; i++) {
                const candidate = flatNodes[(start + i) % flatNodes.length].node;
                if (candidate.name.toLowerCase().startsWith(text)) {
                    setFocusedNodeId(candidate.nodeId);
                    return;
                }
            }
        };

        // Only listen for keyboard events when the tree has focus
        if (treeRef.current) {
            treeRef.current.addEventListener('keydown', handleKeyDown);
        }

        return () => {
            if (treeRef.current) {
                treeRef.current.removeEventListener('keydown', handleKeyDown);
            }
        };
    }, [focusedNodeId, flatNodes, handleToggleExpand]);

    // Tell the extension which node keyboard shortcuts (VS Code key bindings) apply to.
    // Nothing while the view is unfocused or a name is being edited, so keys like Delete reach the input.
    const [windowFocused, setWindowFocused] = useState(() => document.hasFocus());
    useEffect(() => {
        const onFocus = () => setWindowFocused(true);
        const onBlur = () => setWindowFocused(false);
        window.addEventListener('focus', onFocus);
        window.addEventListener('blur', onBlur);
        return () => {
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('blur', onBlur);
        };
    }, []);

    const focusedNode = focusedNodeId ? flatNodes.find(item => item.node.nodeId === focusedNodeId)?.node : undefined;
    const shortcutNode = windowFocused && !renamingNodeId && focusedNode && !focusedNode.isTemporary ? focusedNode : undefined;
    useEffect(() => {
        sendToBackend({
            type: 'treeFocusChanged',
            payload: shortcutNode ? { nodeId: shortcutNode.nodeId, nodeType: shortcutNode.type } : {}
        });
    }, [shortcutNode?.nodeId, shortcutNode?.type]);

    // Check if any node in the tree is loading (backend state or local frontend state)
    const hasLoadingNode = useCallback((nodes: ProjectNode[]): boolean => {
        for (const node of nodes) {
            if (node.isLoading || localLoadingNodes.has(nodeIdToKey(node.nodeId))) {
                return true;
            }
            if (node.children && hasLoadingNode(node.children)) {
                return true;
            }
        }
        return false;
    }, [localLoadingNodes]);

    // Delay showing the loading bar to avoid flashing for quick operations
    const [showLoadingBar, setShowLoadingBar] = useState(false);
    const isLoading = hasLoadingNode(treeNodes);

    useEffect(() => {
        let timeout: NodeJS.Timeout;

        if (isLoading) {
            // Show loading bar after 100ms
            timeout = setTimeout(() => {
                setShowLoadingBar(true);
            }, 100);
        } else {
            // Hide loading bar immediately when done
            setShowLoadingBar(false);
        }

        return () => {
            if (timeout) {
                clearTimeout(timeout);
            }
        };
    }, [isLoading]);

    // Clear local loading states when nodes become expanded or backend loading states change
    useEffect(() => {
        // Debounce this effect to prevent rapid state updates
        const timeoutId = setTimeout(() => {
            setLocalLoadingNodes(prev => {
                const newSet = new Set(prev);
                let hasChanges = false;

                // Remove nodes that are now expanded or have backend loading state
                for (const path of prev) {
                    const node = findNodeById(keyToNodeId(path), treeNodes);
                    if (node && (node.expanded || node.isLoading === false)) {
                        newSet.delete(path);
                        hasChanges = true;
                        log.info(`Clearing local loading state for: ${path}`);
                    }
                }

                return hasChanges ? newSet : prev;
            });
        }, 100); // Debounce to prevent rapid updates

        return () => clearTimeout(timeoutId);
    }, [treeNodes, findNodeById]);

    return (
        <div
            ref={treeRef}
            className="solution-tree"
            tabIndex={0}
            data-vscode-context={JSON.stringify({ preventDefaultContextMenuItems: true })}
        >
            <LoadingBar visible={showLoadingBar} />
            {treeNodes.map((node) => (
                <TreeNode
                    key={nodeIdToKey(node.nodeId)}
                    node={node}
                    level={0}
                    activeFilePath={activeFilePath}
                    onProjectAction={handleProjectActionWrapper}
                    onToggleExpand={handleToggleExpand}
                    onNodeClick={handleNodeClick}
                    onNodeFocus={handleNodeFocus}
                    onRenameConfirm={handleRenameConfirm}
                    onRenameCancel={handleRenameCancel}
                    selectedNodeId={selectedNodeId}
                    focusedNodeId={focusedNodeId}
                    renamingNodeId={renamingNodeId}
                    markers={markers}
                />
            ))}
        </div>
    );
};