import React from 'react';
import { TreeNodeProps } from '../../types';

export const TreeNode: React.FC<TreeNodeProps> = ({
    node,
    level,
    onProjectAction,
    onToggleExpand,
    onNodeFocus,
    selectedNodePath
}) => {
    const [clickTimeout, setClickTimeout] = React.useState<NodeJS.Timeout | null>(null);

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
        onProjectAction('contextMenu', node.path, { type: node.type });
    };

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
                <span className={`node-icon ${getIcon()}`}></span>
                <span className="node-name">{node.name}</span>
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
                            selectedNodePath={selectedNodePath}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};