import React from 'react';
import { TreeNodeProps } from '../../types';
import { RenameInput } from '../RenameInput/RenameInput';
import {logger as loggerFn} from '../../utils/logger';

const logger = loggerFn('TreeNode');
export const TreeNode: React.FC<TreeNodeProps> = ({
    node,
    level,
    onProjectAction,
    onToggleExpand,
    onNodeClick,
    onNodeFocus,
    onContextMenu,
    onRenameConfirm,
    onRenameCancel,
    selectedNodePath,
    focusedNodePath,
    renamingNodePath
}) => {
    const [clickTimeout, setClickTimeout] = React.useState<NodeJS.Timeout | null>(null);

    const nodeId = node.uniqueId || node.path; // Fallback to path if uniqueId not available
    const isRenaming = renamingNodePath === nodeId;


    const handleClick = () => {
        logger.info(`Single click on ${node.type}: ${node.name} (path: ${node.path})`);

        // Don't handle clicks if node is loading
        if (node.isLoading) {
            logger.info(`Node ${node.name} is loading, ignoring click`);
            return;
        }

        // Clear any existing timeout
        if (clickTimeout) {
            clearTimeout(clickTimeout);
            setClickTimeout(null);
        }

        // Set up debounced single click action
        const timeout = setTimeout(() => {
            logger.info(`Executing single click action for: ${node.name}`);

            // Click selects and focuses the item
            onNodeClick(nodeId);

            // Expand/collapse if has children (either loaded children or marked as having children for lazy loading)
            if (node.children?.length || node.hasChildren) {
                logger.info(`Toggling expansion for: ${node.name}`);
                onToggleExpand(node.path, node.type);
            } else {
                logger.info(`Node ${node.name} has no children, just focused`);
            }

            setClickTimeout(null);
        }, 250); // 250ms delay to detect double clicks

        setClickTimeout(timeout);
    };

    const handleDoubleClick = () => {
        logger.info(`Double click on ${node.type}: ${node.name} (path: ${node.path})`);

        // Don't handle clicks if node is loading
        if (node.isLoading) {
            logger.info(`Node ${node.name} is loading, ignoring double click`);
            return;
        }

        // Clear single click timeout since this is a double click
        if (clickTimeout) {
            clearTimeout(clickTimeout);
            setClickTimeout(null);
        }

        // Double click opens file
        logger.info(`Opening file: ${node.path}`);
        onProjectAction('openFile', node.path);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        logger.info(`RIGHT CLICK DETECTED on ${node.type}: ${node.name}`);
        logger.info(`Calling onContextMenu with coordinates:`, e.clientX, e.clientY);
        onContextMenu(e.clientX, e.clientY, node);
        logger.info(`onContextMenu called successfully`);
    };

    const handleRenameConfirmLocal = (newName: string) => {
        logger.info(`Renaming ${node.name} to ${newName}`);
        onRenameConfirm(newName, node.path, node.type, node.name);
    };

    const handleRenameCancelLocal = () => {
        logger.info(`Cancelling rename for: ${node.name}`);
        onRenameCancel();
    };


    const getIcon = () => {
        switch (node.type) {
            case 'solution': return 'codicon-symbol-namespace';
            case 'solutionFolder':
                // Solution folders are virtual folders in the solution file
                return node.expanded ? 'codicon-folder-opened' : 'codicon-folder';
            case 'project':
                // Different icons based on project type
                if (node.path.includes('.csproj')) return 'codicon-symbol-class';
                if (node.path.includes('.vbproj')) return 'codicon-symbol-class';
                if (node.path.includes('.fsproj')) return 'codicon-symbol-class';
                return 'codicon-file-directory';
            case 'folder':
                // Special folder names with specific icons
                if (node.name === 'Dependencies') return 'codicon-references';
                if (node.name === 'Properties') return 'codicon-gear';
                return node.expanded ? 'codicon-folder-opened' : 'codicon-folder';
            case 'file':
                // File type specific icons matching Visual Studio
                const fileName = node.name.toLowerCase();

                // C# files
                if (fileName.endsWith('.cs')) {
                    if (fileName.includes('.designer.') || fileName.includes('.generated.')) return 'codicon-symbol-method';
                    if (fileName.includes('.partial.')) return 'codicon-symbol-interface';
                    return 'codicon-symbol-class';
                }

                // VB.NET files
                if (fileName.endsWith('.vb')) return 'codicon-symbol-class';

                // F# files
                if (fileName.endsWith('.fs') || fileName.endsWith('.fsx')) return 'codicon-symbol-class';

                // Configuration files
                if (fileName === 'appsettings.json' || fileName.startsWith('appsettings.')) return 'codicon-settings-gear';
                if (fileName.endsWith('.config')) return 'codicon-gear';
                if (fileName === 'web.config' || fileName === 'app.config') return 'codicon-gear';

                // Project/build files
                if (fileName.endsWith('.csproj') || fileName.endsWith('.vbproj') || fileName.endsWith('.fsproj')) return 'codicon-symbol-class';
                if (fileName.endsWith('.sln')) return 'codicon-symbol-namespace';
                if (fileName === 'global.asax') return 'codicon-globe';

                // Web files
                if (fileName.endsWith('.cshtml') || fileName.endsWith('.vbhtml')) return 'codicon-symbol-color';
                if (fileName.endsWith('.aspx') || fileName.endsWith('.ascx')) return 'codicon-symbol-color';
                if (fileName.endsWith('.master')) return 'codicon-symbol-color';
                if (fileName.endsWith('.css')) return 'codicon-symbol-color';
                if (fileName.endsWith('.js') || fileName.endsWith('.ts')) return 'codicon-symbol-variable';
                if (fileName.endsWith('.html') || fileName.endsWith('.htm')) return 'codicon-symbol-color';

                // Resources
                if (fileName.endsWith('.resx')) return 'codicon-symbol-string';
                if (fileName.endsWith('.xaml')) return 'codicon-symbol-color';

                // Data files
                if (fileName.endsWith('.json')) return 'codicon-json';
                if (fileName.endsWith('.xml')) return 'codicon-symbol-namespace';
                if (fileName.endsWith('.sql')) return 'codicon-database';

                // Documentation
                if (fileName.endsWith('.md')) return 'codicon-markdown';
                if (fileName.endsWith('.txt')) return 'codicon-file-text';
                if (fileName === 'readme.md' || fileName === 'readme.txt') return 'codicon-info';

                // Build/CI files
                if (fileName.endsWith('.yml') || fileName.endsWith('.yaml')) return 'codicon-symbol-property';
                if (fileName === 'dockerfile' || fileName.startsWith('dockerfile.')) return 'codicon-vm';

                // Default file icon
                return 'codicon-file';

            case 'dependency': return 'codicon-package';
            default: return 'codicon-question';
        }
    };

    const paddingLeft = level * 16;
    const isSelected = selectedNodePath === nodeId;
    const isFocused = focusedNodePath === nodeId;

    return (
        <div>
            <div
                className={`tree-node ${node.type} ${isSelected ? 'selected' : ''} ${isFocused ? 'focused' : ''}`}
                style={{ paddingLeft, cursor: node.isLoading ? 'wait' : 'pointer' }}
                onClick={handleClick}
                onDoubleClick={handleDoubleClick}
                onContextMenu={handleContextMenu}
            >
                {(node.children?.length || node.hasChildren) ? (
                    <span className={`expand-icon codicon ${node.expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`}></span>
                ) : (
                    <span className="expand-icon-placeholder"></span>
                )}
                <span className={`node-icon codicon ${getIcon()}`}></span>
                {isRenaming ? (
                    <RenameInput
                        initialValue={node.name}
                        onConfirm={handleRenameConfirmLocal}
                        onCancel={handleRenameCancelLocal}
                    />
                ) : (
                    <span className="node-name">{node.name}</span>
                )}
            </div>
            {node.expanded && node.children && (
                <div className="tree-children">
                    {node.children.map((child, index) => (
                        <TreeNode
                            key={`${child.path}-${index}`}
                            node={child}
                            level={level + 1}
                            onProjectAction={onProjectAction}
                            onToggleExpand={onToggleExpand}
                            onNodeClick={onNodeClick}
                            onNodeFocus={onNodeFocus}
                            onContextMenu={onContextMenu}
                            onRenameConfirm={onRenameConfirm}
                            onRenameCancel={onRenameCancel}
                            selectedNodePath={selectedNodePath}
                            focusedNodePath={focusedNodePath}
                            renamingNodePath={renamingNodePath}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};