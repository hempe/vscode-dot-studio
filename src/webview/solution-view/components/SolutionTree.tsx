import React, { useState } from 'react';
import { ProjectNode, SolutionTreeProps } from '../types';
import { TreeNode } from './TreeNode/TreeNode';
import { ContextMenu } from './ContextMenu/ContextMenu';

export const SolutionTree: React.FC<SolutionTreeProps> = ({ projects, onProjectAction }) => {
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
    const [selectedNodePath, setSelectedNodePath] = useState<string | undefined>();
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

    const handleNodeFocus = (path: string) => {
        console.log(`[SolutionTree] Setting focus to: ${path}`);
        setSelectedNodePath(path);
    };

    const handleContextMenu = (x: number, y: number, node: ProjectNode) => {
        console.log(`[SolutionTree] Context menu for ${node.type}: ${node.name}`);

        // Calculate adjusted position to keep menu within webview bounds
        const menuWidth = 200; // min-width from CSS
        const menuHeight = 150; // estimated height for a few menu items
        const padding = 10; // padding from edges

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

        // Ensure minimum distance from edges
        adjustedX = Math.max(padding, adjustedX);
        adjustedY = Math.max(padding, adjustedY);

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

    const treeNodes = buildTreeNodes(projects);

    console.log(`[SolutionTree] Rendering ${treeNodes.length} root nodes`);

    return (
        <div className="solution-tree">
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
                    onNodeFocus={handleNodeFocus}
                    onContextMenu={handleContextMenu}
                    onRenameConfirm={handleRenameConfirm}
                    onRenameCancel={handleRenameCancel}
                    selectedNodePath={selectedNodePath}
                    renamingNodePath={renamingNodePath}
                />
            ))}
            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={handleCloseContextMenu}
                    onRename={handleRename}
                    nodeType={contextMenu.node.type}
                    nodeName={contextMenu.node.name}
                />
            )}
        </div>
    );
};