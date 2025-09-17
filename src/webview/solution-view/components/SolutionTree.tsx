import React, { useState, useEffect, useCallback } from 'react';
import { ProjectNode, SolutionTreeProps } from '../types';
import { TreeNode } from './TreeNode/TreeNode';
import { ContextMenu } from './ContextMenu/ContextMenu';

export const SolutionTree: React.FC<SolutionTreeProps> = ({ projects, onProjectAction }) => {
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
    const [selectedNodePath, setSelectedNodePath] = useState<string | undefined>();
    const [focusedNodePath, setFocusedNodePath] = useState<string | undefined>();
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: ProjectNode } | null>(null);
    const [renamingNodePath, setRenamingNodePath] = useState<string | undefined>();

    const handleToggleExpand = (path: string) => {
        console.log(`[SolutionTree] Toggle expand for path: ${path}`);
        setExpandedNodes(prev => {
            const newSet = new Set(prev);
            if (newSet.has(path)) {
                console.log(`[SolutionTree] Collapsing: ${path}`);
                newSet.delete(path);
            } else {
                console.log(`[SolutionTree] Expanding: ${path}`);
                newSet.add(path);
            }
            return newSet;
        });
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
        console.log(`[SolutionTree] Context menu for ${node.type}: ${node.name}`);

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
    };

    const handleCloseContextMenu = () => {
        setContextMenu(null);
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

    // Convert the projects data into tree structure
    const buildTreeNodes = (projects: any[]): ProjectNode[] => {
        return projects.map(project => ({
            type: project.type || 'project',
            name: project.name || 'Unknown',
            path: project.path || '',
            children: project.children ? buildTreeNodes(project.children) : undefined,
            expanded: expandedNodes.has(project.path || '')
        }));
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
            if (!focusedNodePath) return;

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
                    } else {
                        // For folders/projects, toggle expansion and select
                        if (focusedNode.children) {
                            handleToggleExpand(focusedNode.path);
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
                        handleToggleExpand(currentNode.path);
                    }
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    const currentNodeLeft = flatNodes[currentIndex].node;
                    if (currentNodeLeft.children && currentNodeLeft.expanded) {
                        handleToggleExpand(currentNodeLeft.path);
                    }
                    break;
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [focusedNodePath, flatNodes, handleToggleExpand]);

    console.log(`[SolutionTree] Rendering ${treeNodes.length} root nodes`);

    return (
        <div className="solution-tree" tabIndex={0}>
            {treeNodes.map((node, index) => (
                <TreeNode
                    key={`${node.path}-${index}`}
                    node={node}
                    level={0}
                    onProjectAction={(action, path, data) => {
                        if (action === 'startRename') {
                            setRenamingNodePath(path);
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
                />
            ))}
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