import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ProjectNode, SolutionTreeProps, ProjectActionType } from '../types';
import { TreeNode } from './TreeNode/TreeNode';
import { ContextMenu } from './ContextMenu/ContextMenu';
import { contextMenus, MenuAction } from './ContextMenu/menuActions';
import { LoadingBar } from '../../shared/LoadingBar';
import { logger } from '../../shared/logger';

const log = logger('SolutionTree');
export const SolutionTree: React.FC<SolutionTreeProps> = ({ projects, onProjectAction, onExpandNode, onCollapseNode }) => {
    const treeRef = useRef<HTMLDivElement>(null);
    // Backend controls all expansion state - no local expansion management
    const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
    const [focusedNodeId, setFocusedNodeId] = useState<string | undefined>();
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: ProjectNode } | null>(null);
    const [renamingNodeId, setRenamingNodeId] = useState<string | undefined>();
    const [localLoadingNodes, setLocalLoadingNodes] = useState<Set<string>>(new Set());


    // Helper function to find node in tree by node ID
    const findNodeById = useCallback((nodeId: string, nodes: ProjectNode[]): ProjectNode | null => {
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

    const handleToggleExpand = (nodeId: string, nodeType: string) => {
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
            onExpandNode?.(nodeId, nodeType);
        }
    };

    const handleNodeClick = (nodeId: string) => {
        log.info(`Node clicked: ${nodeId}`);
        setSelectedNodeId(nodeId);
        setFocusedNodeId(nodeId);
    };

    const handleNodeFocus = (nodeId: string) => {
        log.info(`Setting focus to: ${nodeId}`);
        setFocusedNodeId(nodeId);
    };

    const handleContextMenu = (x: number, y: number, node: ProjectNode) => {
        log.info(`HANDLE CONTEXT MENU CALLED for ${node.type}: ${node.name}`);
        log.info(`Coordinates:`, x, y);
        log.info(`Current contextMenu state:`, contextMenu);

        // Right-click focuses the item but doesn't select it
        setFocusedNodeId(node.nodeId);

        // Calculate adjusted position to keep menu within webview bounds
        const menuWidth = 220; // min-width from CSS
        const menuHeight = 200; // estimated height for menu items (increased for more items)
        const padding = 0; // no padding - use full available space

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Adjust X position if menu would go off right edge
        let adjustedX = x;
        if (x + menuWidth + padding > viewportWidth) {
            adjustedX = viewportWidth - menuWidth - padding;
        }

        // Adjust Y position if menu would go off bottom edge
        let adjustedY = y;
        if (y + menuHeight + padding > viewportHeight) {
            adjustedY = viewportHeight - menuHeight - padding;
        }

        // Ensure menu stays within bounds (no minimum padding needed)
        adjustedX = Math.max(0, adjustedX);
        adjustedY = Math.max(0, adjustedY);

        setContextMenu({ x: adjustedX, y: adjustedY, node });
        log.info(`Context menu state SET:`, { x: adjustedX, y: adjustedY, node });
    };

    const handleCloseContextMenu = () => {
        setContextMenu(null);
        // Return focus to the tree container so keyboard navigation works again
        if (treeRef.current) {
            treeRef.current.focus();
        }
    };

    const handleRename = () => {
        if (contextMenu) {
            log.info(`Starting rename for: ${contextMenu.node.name}`);
            setRenamingNodeId(contextMenu.node.nodeId);
            setContextMenu(null);
        }
    };

    const handleRenameConfirm = (newName: string, filePath: string, nodeType: string, oldName: string) => {
        log.info(`Rename confirmed: ${oldName} -> ${newName}`);
        setRenamingNodeId(undefined);
        onProjectAction('rename', filePath, { newName, oldName, type: nodeType });
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
    const flattenNodes = useCallback((nodes: ProjectNode[], level: number = 0): Array<{node: ProjectNode, level: number}> => {
        const result: Array<{node: ProjectNode, level: number}> = [];
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

    // Auto-focus the first node for keyboard navigation if no node is focused
    useEffect(() => {
        if (!focusedNodeId && flatNodes.length > 0) {
            setFocusedNodeId(flatNodes[0].node.nodeId);
        }
    }, [focusedNodeId, flatNodes]);

    const handleProjectActionWrapper = useCallback((action: string, path: string, data?: any) => {
        if (action === 'startRename') {
            setRenamingNodeId(path);
        } else if (action === 'collapseParent') {
            // Find the parent of the clicked file and collapse it
            const allNodes = flattenNodes(treeNodes);
            const nodeIndex = allNodes.findIndex(item => item.node.path === path);
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
            onProjectAction(action as ProjectActionType, path, data);
        }
    }, [treeNodes, flattenNodes, handleToggleExpand, onProjectAction]);


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

            // Don't handle tree navigation if context menu is open
            if (contextMenu) {
                return;
            }

            // Don't handle tree navigation if context menu is focused
            if (document.activeElement?.closest('.context-menu')) {
                return;
            }

            const currentIndex = flatNodes.findIndex(item => item.node.nodeId === focusedNodeId);
            if (currentIndex === -1) return;

            switch (e.key) {
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
                    if (focusedNode.type === 'file') {
                        // Open file like double-click
                        onProjectAction('openFile', focusedNode.path);
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
                    if (currentNode.children && !currentNode.expanded) {
                        handleToggleExpand(currentNode.nodeId, currentNode.type);
                    }
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    const currentNodeLeft = flatNodes[currentIndex].node;
                    if (currentNodeLeft.children && currentNodeLeft.expanded) {
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

                // Handle context menu shortcuts
                case 'F2':
                    e.preventDefault();
                    const focusedNodeForRename = flatNodes[currentIndex].node;
                    // Check if rename action is available for this node type
                    const nodeMenuItems = contextMenus[focusedNodeForRename.type] || [];
                    const renameMenuItem = nodeMenuItems.find(item =>
                        item.kind === 'action' && (item as MenuAction).action === 'rename'
                    );
                    if (renameMenuItem) {
                        setRenamingNodeId(focusedNodeForRename.nodeId);
                    }
                    break;

                case 'Delete':
                    e.preventDefault();
                    const focusedNodeForDelete = flatNodes[currentIndex].node;
                    // Check if delete action is available for this node type
                    const deleteMenuItems = contextMenus[focusedNodeForDelete.type] || [];
                    const deleteMenuItem = deleteMenuItems.find(item =>
                        item.kind === 'action' && (item as MenuAction).action === 'deleteFile'
                    );
                    if (deleteMenuItem) {
                        onProjectAction('deleteFile', focusedNodeForDelete.path, { type: focusedNodeForDelete.type });
                    }
                    break;
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
    }, [focusedNodeId, flatNodes, handleToggleExpand, contextMenu]);

    // Check if any node in the tree is loading (backend state or local frontend state)
    const hasLoadingNode = useCallback((nodes: ProjectNode[]): boolean => {
        for (const node of nodes) {
            if (node.isLoading || localLoadingNodes.has(node.nodeId)) {
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
                    const node = findNodeById(path, treeNodes);
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
        >
            <LoadingBar visible={showLoadingBar} />
            {treeNodes.map((node, index) => (
                <TreeNode
                    key={node.nodeId}
                    node={node}
                    level={0}
                    onProjectAction={handleProjectActionWrapper}
                    onToggleExpand={handleToggleExpand}
                    onNodeClick={handleNodeClick}
                    onNodeFocus={handleNodeFocus}
                    onContextMenu={handleContextMenu}
                    onRenameConfirm={handleRenameConfirm}
                    onRenameCancel={handleRenameCancel}
                    selectedNodeId={selectedNodeId}
                    focusedNodeId={focusedNodeId}
                    renamingNodeId={renamingNodeId}
                />
            ))}
            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={handleCloseContextMenu}
                    onRename={handleRename}
                    onAction={(action, data) => {
                        // For solution folder actions, pass GUID and name for safer operations
                        if (contextMenu.node.type === 'solutionFolder' &&
                            (action === 'removeSolutionFolder' || action === 'addSolutionItem')) {
                            const enhancedData = {
                                ...data,
                                guid: contextMenu.node.guid,
                                name: contextMenu.node.name
                            };
                            onProjectAction(action, contextMenu.node.path, enhancedData);
                        } else {
                            onProjectAction(action, contextMenu.node.path, data);
                        }
                    }}
                    nodeType={contextMenu.node.type}
                    nodeName={contextMenu.node.name}
                />
            )}
        </div>
    );
};