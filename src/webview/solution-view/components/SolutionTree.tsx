import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ProjectNode, SolutionTreeProps } from '../types';
import { TreeNode } from './TreeNode/TreeNode';
import { ContextMenu } from './ContextMenu/ContextMenu';
import { contextMenus, MenuAction } from './ContextMenu/menuActions';

export const SolutionTree: React.FC<SolutionTreeProps> = ({ projects, onProjectAction, onExpandNode, onCollapseNode }) => {
    const treeRef = useRef<HTMLDivElement>(null);
    // Backend controls all expansion state - no local expansion management
    const [selectedNodePath, setSelectedNodePath] = useState<string | undefined>();
    const [focusedNodePath, setFocusedNodePath] = useState<string | undefined>();
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: ProjectNode } | null>(null);
    const [renamingNodePath, setRenamingNodePath] = useState<string | undefined>();


    // Helper function to find node in tree by path
    const findNodeByPath = useCallback((targetPath: string, nodes: ProjectNode[]): ProjectNode | null => {
        for (const node of nodes) {
            if (node.path === targetPath) {
                return node;
            }
            if (node.children) {
                const found = findNodeByPath(targetPath, node.children);
                if (found) return found;
            }
        }
        return null;
    }, []);

    const handleToggleExpand = (path: string, nodeType: string) => {
        console.log(`[SolutionTree] Toggle expand request for path: ${path}, type: ${nodeType}`);

        // Find the node to check its current state
        const node = findNodeByPath(path, treeNodes);
        if (!node) {
            console.warn(`[SolutionTree] Node not found: ${path}`);
            return;
        }

        if (node.expanded) {
            console.log(`[SolutionTree] Requesting collapse: ${path}`);
            onCollapseNode?.(path);
        } else {
            console.log(`[SolutionTree] Requesting expand: ${path}`);
            onExpandNode?.(path, nodeType);
        }
    };

    const handleNodeClick = (path: string) => {
        console.log(`[SolutionTree] Node clicked: ${path}`);
        setSelectedNodePath(path);
        setFocusedNodePath(path);
    };

    const handleNodeFocus = (path: string) => {
        console.log(`[SolutionTree] Setting focus to: ${path}`);
        setFocusedNodePath(path);
    };

    const handleContextMenu = (x: number, y: number, node: ProjectNode) => {
        console.log(`[SolutionTree] HANDLE CONTEXT MENU CALLED for ${node.type}: ${node.name}`);
        console.log(`[SolutionTree] Coordinates:`, x, y);
        console.log(`[SolutionTree] Current contextMenu state:`, contextMenu);

        // Right-click focuses the item but doesn't select it
        setFocusedNodePath(node.path);

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
        console.log(`[SolutionTree] Context menu state SET:`, { x: adjustedX, y: adjustedY, node });
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
            console.log(`[SolutionTree] Starting rename for: ${contextMenu.node.name}`);
            setRenamingNodePath(contextMenu.node.path);
            setContextMenu(null);
        }
    };

    const handleRenameConfirm = (newName: string, nodePath: string, nodeType: string, oldName: string) => {
        console.log(`[SolutionTree] Rename confirmed: ${oldName} -> ${newName}`);
        setRenamingNodePath(undefined);
        onProjectAction('rename', nodePath, { newName, oldName, type: nodeType });
    };

    const handleRenameCancel = () => {
        console.log(`[SolutionTree] Rename cancelled`);
        setRenamingNodePath(undefined);
    };

    // Convert the projects data into tree structure - backend controls expansion state
    const buildTreeNodes = (projects: any[]): ProjectNode[] => {
        const result = projects.map(project => ({
            ...project, // Preserve all properties from original data including expanded state
            children: project.children ? buildTreeNodes(project.children) : undefined
        }));


        return result;
    };

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

    const treeNodes = buildTreeNodes(projects);
    const flatNodes = flattenNodes(treeNodes);


    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!focusedNodePath) {
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

            const currentIndex = flatNodes.findIndex(item => item.node.path === focusedNodePath);
            if (currentIndex === -1) return;

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    if (currentIndex < flatNodes.length - 1) {
                        setFocusedNodePath(flatNodes[currentIndex + 1].node.path);
                    }
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    if (currentIndex > 0) {
                        setFocusedNodePath(flatNodes[currentIndex - 1].node.path);
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
                            handleToggleExpand(focusedNode.path, focusedNode.type);
                        }
                        setSelectedNodePath(focusedNodePath);
                    } else if (focusedNode.type === 'dependencies') {
                        // Dependencies folder should only expand/collapse
                        if (focusedNode.children) {
                            handleToggleExpand(focusedNode.path, focusedNode.type);
                        }
                        setSelectedNodePath(focusedNodePath);
                    } else {
                        // For other node types (projects, regular folders), toggle expansion and select
                        if (focusedNode.children) {
                            handleToggleExpand(focusedNode.path, focusedNode.type);
                        }
                        setSelectedNodePath(focusedNodePath);
                    }
                    break;
                case ' ':
                    e.preventDefault();
                    setSelectedNodePath(focusedNodePath);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    const currentNode = flatNodes[currentIndex].node;
                    if (currentNode.children && !currentNode.expanded) {
                        handleToggleExpand(currentNode.path, currentNode.type);
                    }
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    const currentNodeLeft = flatNodes[currentIndex].node;
                    if (currentNodeLeft.children && currentNodeLeft.expanded) {
                        // If current node has expanded children, collapse it
                        handleToggleExpand(currentNodeLeft.path, currentNodeLeft.type);
                    } else {
                        // If current node has no children or is not expanded, move focus to parent
                        const currentLevel = flatNodes[currentIndex].level;
                        if (currentLevel > 0) {
                            // Find parent node (previous node with level - 1)
                            for (let i = currentIndex - 1; i >= 0; i--) {
                                if (flatNodes[i].level === currentLevel - 1) {
                                    setFocusedNodePath(flatNodes[i].node.path);
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
                        setRenamingNodePath(focusedNodeForRename.path);
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
    }, [focusedNodePath, flatNodes, handleToggleExpand, contextMenu]);

    // Check if any node in the tree is loading
    const hasLoadingNode = useCallback((nodes: ProjectNode[]): boolean => {
        for (const node of nodes) {
            if (node.isLoading) {
                return true;
            }
            if (node.children && hasLoadingNode(node.children)) {
                return true;
            }
        }
        return false;
    }, []);

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

    console.log(`[SolutionTree] Rendering ${treeNodes.length} root nodes`);

    return (
        <div
            ref={treeRef}
            className="solution-tree"
            tabIndex={0}
        >
            {/* Fixed loading progress bar - VS Code style */}
            {showLoadingBar && (
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: '2px',
                    backgroundColor: 'var(--vscode-progressBar-background)',
                    zIndex: 1000,
                    overflow: 'hidden'
                }}>
                    <div style={{
                        height: '100%',
                        backgroundColor: 'var(--vscode-progressBar-foreground)',
                        animation: 'loading-progress 1.5s ease-in-out infinite',
                        width: '30%',
                        transform: 'translateX(-100%)'
                    }}></div>
                </div>
            )}
            {treeNodes.map((node, index) => {
                console.log(`[SolutionTree] Rendering TreeNode ${index}: ${node.type} - ${node.name}`);
                return (<TreeNode
                    key={`${node.path}-${index}`}
                    node={node}
                    level={0}
                    onProjectAction={(action, path, data) => {
                        if (action === 'startRename') {
                            setRenamingNodePath(path);
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
                                                console.log(`[SolutionTree] Collapsing parent: ${parentNode.name}`);
                                                handleToggleExpand(parentNode.path, parentNode.type);
                                            }
                                            break;
                                        }
                                    }
                                }
                            }
                        } else {
                            onProjectAction(action, path, data);
                        }
                    }}
                    onToggleExpand={handleToggleExpand}
                    onNodeClick={handleNodeClick}
                    onNodeFocus={handleNodeFocus}
                    onContextMenu={handleContextMenu}
                    onRenameConfirm={handleRenameConfirm}
                    onRenameCancel={handleRenameCancel}
                    selectedNodePath={selectedNodePath}
                    focusedNodePath={focusedNodePath}
                    renamingNodePath={renamingNodePath}
                />);
            })}
            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={handleCloseContextMenu}
                    onRename={handleRename}
                    onAction={(action, data) => {
                        onProjectAction(action, contextMenu.node.path, data);
                    }}
                    nodeType={contextMenu.node.type}
                    nodeName={contextMenu.node.name}
                />
            )}
        </div>
    );
};