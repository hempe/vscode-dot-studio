import React, { useState } from 'react';
import { ProjectNode, SolutionTreeProps } from '../types';
import { TreeNode } from './TreeNode/TreeNode';

export const SolutionTree: React.FC<SolutionTreeProps> = ({ projects, onProjectAction }) => {
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
    const [selectedNodePath, setSelectedNodePath] = useState<string | undefined>();

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
                    onProjectAction={onProjectAction}
                    onToggleExpand={handleToggleExpand}
                    onNodeFocus={handleNodeFocus}
                    selectedNodePath={selectedNodePath}
                />
            ))}
        </div>
    );
};