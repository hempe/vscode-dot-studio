import React from 'react';
import { TreeNodeProps } from '../../types';
import { RenameInput } from '../RenameInput/RenameInput';

export const TreeNode: React.FC<TreeNodeProps> = ({
    node,
    level,
    onProjectAction,
    onToggleExpand,
    onNodeFocus,
    onContextMenu,
    onRenameConfirm,
    onRenameCancel,
    selectedNodePath,
    renamingNodePath
}) => {
    const [clickTimeout, setClickTimeout] = React.useState<NodeJS.Timeout | null>(null);

    const isRenaming = renamingNodePath === node.path;

    const handleClick = () => {
        console.log(`[TreeNode] Single click on ${node.type}: ${node.name} (path: ${node.path})`);

        // Clear any existing timeout
        if (clickTimeout) {
            clearTimeout(clickTimeout);
            setClickTimeout(null);
        }

        // Set up debounced single click action
        const timeout = setTimeout(() => {
            console.log(`[TreeNode] Executing single click action for: ${node.name}`);

            // Always set focus first
            onNodeFocus(node.path);

            // Expand/collapse if has children
            if (node.children && node.children.length > 0) {
                console.log(`[TreeNode] Toggling expansion for: ${node.name}`);
                onToggleExpand(node.path);
            } else {
                console.log(`[TreeNode] Node ${node.name} has no children, just focused`);
            }

            setClickTimeout(null);
        }, 250); // 250ms delay to detect double clicks

        setClickTimeout(timeout);
    };

    const handleDoubleClick = () => {
        console.log(`[TreeNode] Double click on ${node.type}: ${node.name} (path: ${node.path})`);

        // Clear single click timeout since this is a double click
        if (clickTimeout) {
            clearTimeout(clickTimeout);
            setClickTimeout(null);
        }

        // Double click opens file
        console.log(`[TreeNode] Opening file: ${node.path}`);
        onProjectAction('openFile', node.path);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        console.log(`[TreeNode] Context menu on ${node.type}: ${node.name}`);
        onContextMenu(e.clientX, e.clientY, node);
    };

    const handleRenameConfirmLocal = (newName: string) => {
        console.log(`[TreeNode] Renaming ${node.name} to ${newName}`);
        onRenameConfirm(newName, node.path, node.type, node.name);
    };

    const handleRenameCancelLocal = () => {
        console.log(`[TreeNode] Cancelling rename for: ${node.name}`);
        onRenameCancel();
    };

    // Add keyboard support for F2 (Rename)
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (selectedNodePath === node.path && e.key === 'F2') {
                e.preventDefault();
                // Start rename by triggering the parent's rename handler
                onProjectAction('startRename', node.path, { type: node.type, name: node.name });
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [selectedNodePath, node.path]);

    const getIcon = () => {
        switch (node.type) {
            case 'solution': return 'codicon-symbol-namespace';
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
    const isSelected = selectedNodePath === node.path;

    return (
        <div>
            <div
                className={`tree-node ${node.type} ${isSelected ? 'selected' : ''}`}
                style={{ paddingLeft }}
                onClick={handleClick}
                onDoubleClick={handleDoubleClick}
                onContextMenu={handleContextMenu}
            >
                {node.children && node.children.length > 0 ? (
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
                            onNodeFocus={onNodeFocus}
                            onContextMenu={onContextMenu}
                            onRenameConfirm={onRenameConfirm}
                            onRenameCancel={onRenameCancel}
                            selectedNodePath={selectedNodePath}
                            renamingNodePath={renamingNodePath}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};