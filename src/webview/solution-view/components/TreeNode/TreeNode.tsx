import React from 'react';
import { Icon } from '@iconify/react';
import { TreeNodeProps } from '../../types';
import { RenameInput } from '../RenameInput/RenameInput';
import { logger } from '../../../shared/logger';

const log = logger('TreeNode');
export const TreeNode: React.FC<TreeNodeProps> = React.memo(({
    node,
    level,
    onProjectAction,
    onToggleExpand,
    onNodeClick,
    onNodeFocus,
    onContextMenu,
    onRenameConfirm,
    onRenameCancel,
    selectedNodeId,
    focusedNodeId,
    renamingNodeId
}) => {
    const [clickTimeout, setClickTimeout] = React.useState<NodeJS.Timeout | null>(null);

    const nodeIdentifier = node.nodeId;
    const isRenaming = renamingNodeId === nodeIdentifier;



    const handleClick = () => {
        log.info(`Single click on ${node.type}: ${node.name} (path: ${node.path})`);

        // Don't handle clicks if node is loading
        if (node.isLoading) {
            log.info(`Node ${node.name} is loading, ignoring click`);
            return;
        }

        // Clear any existing timeout
        if (clickTimeout) {
            clearTimeout(clickTimeout);
            setClickTimeout(null);
        }

        // Set up debounced single click action
        const timeout = setTimeout(() => {
            log.info(`Executing single click action for: ${node.name}`);

            // If has children, just expand/collapse - don't change selection
            if (node.children?.length || node.hasChildren) {
                log.info(`Toggling expansion for: ${node.name}`);
                onToggleExpand(nodeIdentifier, node.type);
            } else {
                // If no children, select and focus the item
                log.info(`Node ${node.name} has no children, selecting it`);
                onNodeClick(nodeIdentifier);
            }

            setClickTimeout(null);
        }, 250); // 250ms delay to detect double clicks

        setClickTimeout(timeout);
    };

    const handleDoubleClick = () => {
        log.info(`Double click on ${node.type}: ${node.name} (path: ${node.path})`);

        // Don't handle clicks if node is loading
        if (node.isLoading) {
            log.info(`Node ${node.name} is loading, ignoring double click`);
            return;
        }

        // Clear single click timeout since this is a double click
        if (clickTimeout) {
            clearTimeout(clickTimeout);
            setClickTimeout(null);
        }

        // Double click opens file for file types and project files
        if (node.type === 'file' || node.type === 'solutionItem' || node.type === 'project') {
            log.info(`Opening file: ${node.path}`);
            onProjectAction('openFile', node.path);
        } else {
            log.info(`Double click on ${node.type} - no action needed`);
        }
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        log.info(`RIGHT CLICK DETECTED on ${node.type}: ${node.name}`);
        log.info(`Calling onContextMenu with coordinates:`, e.clientX, e.clientY);
        onContextMenu(e.clientX, e.clientY, node);
        log.info(`onContextMenu called successfully`);
    };

    const handleRenameConfirmLocal = (newName: string) => {
        log.info(`Renaming ${node.name} to ${newName}`);
        onRenameConfirm(newName, node.path, node.type, node.name);
    };

    const handleRenameCancelLocal = () => {
        log.info(`Cancelling rename for: ${node.name}`);
        onRenameCancel();
    };


    const getIconConfig = () => {
        switch (node.type) {
            case 'solution': return {
                icon: 'mdi:microsoft-visual-studio',
                color: '#d294e2', // Updated solution color
                border: true
            };
            case 'solutionFolder':
                return {
                    icon: node.expanded ? 'mdi:folder-open' : 'mdi:folder',
                    color: '#d8ac6a' // Folder color
                };
            case 'project':
                // Different icons based on project type - same icon as code files but gray with green border
                if (node.path.includes('.csproj')) return {
                    icon: 'mdi:language-csharp',
                    __color: '#82c87e', // Green icon
                    color:'#3BA745',
                    border: true
                };
                if (node.path.includes('.vbproj')) return {
                    icon: 'mdi:file-code',
                    color: '#68217A', // Gray
                    border: true
                };
                if (node.path.includes('.fsproj')) return {
                    icon: 'mdi:file-code',
                    color: '#378BBA', // Gray
                    border: true
                };
                return { icon: 'mdi:folder', color: '#d8ac6a' };
            case 'folder':
                // Special folder names with specific icons
                if (node.name === 'Dependencies') return { icon: 'carbon:column-dependency', color: '#dcdcdc' };
                if (node.name === 'Properties') return { icon: 'streamline:wrench-solid', color: '#dcdcdc' };
                return {
                    icon: node.expanded ? 'mdi:folder-open' : 'mdi:folder',
                    color: '#d8ac6a' // Folder color
                };
            case 'file':
                // File type specific icons matching Visual Studio dark theme
                const fileName = node.name.toLowerCase();

                // C# files - Green color for code files
                if (fileName.endsWith('.cs')) {
                    return { icon: 'mdi:language-csharp', color: '#3BA745' };
                }

                // VB.NET files
                if (fileName.endsWith('.vb')) return { icon: 'mdi:file-code', color: '#68217A' };

                // F# files
                if (fileName.endsWith('.fs') || fileName.endsWith('.fsx')) return { icon: 'mdi:file-code', color: '#378BBA' };

                // Configuration files
                if (fileName === 'appsettings.json' || fileName.startsWith('appsettings.')) return { icon: 'mdi:cog', color: '#dcdcdc' };
                if (fileName.endsWith('.config')) return { icon: 'mdi:cog', color: '#dcdcdc' };
                if (fileName === 'web.config' || fileName === 'app.config') return { icon: 'mdi:cog', color: '#dcdcdc' };

                // Project/build files
                if (fileName.endsWith('.csproj') || fileName.endsWith('.vbproj') || fileName.endsWith('.fsproj')) return { icon: 'mdi:microsoft-visual-studio', color: '#dcdcdc' };
                if (fileName.endsWith('.sln')) return { icon: 'mdi:microsoft-visual-studio', color: '#68217a' };
                if (fileName === 'global.asax') return { icon: 'mdi:web', color: '#dcdcdc' };

                // Web files
                if (fileName.endsWith('.cshtml') || fileName.endsWith('.vbhtml')) return { icon: 'mdi:language-html5', color: '#dcdcdc' };
                if (fileName.endsWith('.aspx') || fileName.endsWith('.ascx')) return { icon: 'mdi:web', color: '#dcdcdc' };
                if (fileName.endsWith('.master')) return { icon: 'mdi:web', color: '#dcdcdc' };
                if (fileName.endsWith('.css')) return { icon: 'mdi:language-css3', color: '#dcdcdc' };
                if (fileName.endsWith('.js')) return { icon: 'mdi:language-javascript', color: '#dcdcdc' };
                if (fileName.endsWith('.ts')) return { icon: 'mdi:language-typescript', color: '#3178C6' };
                if (fileName.endsWith('.html') || fileName.endsWith('.htm')) return { icon: 'mdi:language-html5', color: '#dcdcdc' };

                // Resources
                if (fileName.endsWith('.resx')) return { icon: 'mdi:file-xml', color: '#dcdcdc' };
                if (fileName.endsWith('.xaml')) return { icon: 'mdi:file-xml', color: '#dcdcdc' };

                // Data files - JSON as gray
                if (fileName.endsWith('.json')) return { icon: 'mdi:code-json', color: '#dcdcdc' };
                if (fileName.endsWith('.xml')) return { icon: 'mdi:file-xml', color: '#dcdcdc' };
                if (fileName.endsWith('.sql')) return { icon: 'mdi:database', color: '#dcdcdc' };

                // Documentation
                if (fileName.endsWith('.md')) return { icon: 'mdi:language-markdown', color: '#dcdcdc' };
                if (fileName.endsWith('.txt')) return { icon: 'mdi:file-document', color: '#dcdcdc' };
                if (fileName === 'readme.md' || fileName === 'readme.txt') return { icon: 'mdi:information', color: '#dcdcdc' };

                // Build/CI files
                if (fileName.endsWith('.yml') || fileName.endsWith('.yaml')) return { icon: 'mdi:file-code', color: '#dcdcdc' };
                if (fileName === 'dockerfile' || fileName.startsWith('dockerfile.')) return { icon: 'mdi:docker', color: '#dcdcdc' };

                // Default file icon
                return { icon: 'mdi:file', color: '#dcdcdc' };

            case 'dependencies': return { icon: 'carbon:column-dependency', color: '#dcdcdc' };
            case 'dependencyCategory':
                // Use different icons for different dependency categories
                if (node.name === 'Packages') return { icon: 'simple-icons:nuget', color: '#dcdcdc' };
                if (node.name === 'Projects') return { icon: 'mdi:application-outline', color: '#dcdcdc' };
                if (node.name === 'Assemblies') return { icon: 'mdi:package-variant', color: '#dcdcdc' };
                if (node.name === 'Frameworks') return { icon: 'hugeicons:frameworks', color: '#dcdcdc' };
                return { icon: 'mdi:folder', color: '#d8ac6a' };
            case 'packageDependencies': return { icon: 'simple-icons:nuget', color: '#dcdcdc' };
            case 'projectDependencies': return { icon: 'mdi:application-outline', color: '#dcdcdc' };
            case 'assemblyDependencies': return { icon: 'mdi:package-variant', color: '#dcdcdc' };
            case 'dependency': return { icon: 'simple-icons:nuget', color: '#dcdcdc' };
            default: return { icon: 'mdi:file', color: '#dcdcdc' };
        }
    };

    const paddingLeft = level * 16;
    const isSelected = selectedNodeId === nodeIdentifier;
    const isFocused = focusedNodeId === nodeIdentifier;

    // Memoize icon configuration to prevent multiple calls during render
    const iconConfig = React.useMemo(() => getIconConfig(), [node.type, node.name, node.path, node.expanded]);

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
                    <Icon
                        icon="codicon:chevron-right"
                        className="expand-icon"
                        width="12"
                        height="12"
                        style={{
                            display: 'inline-flex',
                            minWidth: '12px',
                            minHeight: '12px',
                            transition: 'transform 0.15s ease',
                            transform: node.expanded ? 'rotate(90deg)' : 'rotate(0deg)'
                        }}
                    />
                ) : (
                    <span className="expand-icon-placeholder"></span>
                )}
                <div
                    className="node-icon"
                    style={{
                        ...(iconConfig.border ? {
                            width: '16px',
                            height: '9px',
                            position: 'relative',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderWidth: '3px 1px 2px 1px',
                            borderStyle: 'solid',
                            borderColor: 'var(--vscode-descriptionForeground)',
                            borderRadius: '2px',
                            marginBottom: '3px'
                        } : {
                            width: '16px',
                            height: '16px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        })
                    }}
                >
                    <Icon
                        icon={iconConfig.icon}
                        width={iconConfig.border ? "13": "14"}
                        height={iconConfig.border ? "13": "14"}
                        style={{
                            color: iconConfig.color,
                            display: 'block',
                            minWidth: iconConfig.border ? "13px" : "14px",
                            minHeight: iconConfig.border ? "13px" : "14px",
                            ...(iconConfig.border && {
                                position: 'absolute',
                                bottom: '-5px',
                                left: '0px',
                                background: 'var(--vscode-editor-background)'
                            })
                        }}
                    />
                </div>
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
                            key={child.nodeId}
                            node={child}
                            level={level + 1}
                            onProjectAction={onProjectAction}
                            onToggleExpand={onToggleExpand}
                            onNodeClick={onNodeClick}
                            onNodeFocus={onNodeFocus}
                            onContextMenu={onContextMenu}
                            onRenameConfirm={onRenameConfirm}
                            onRenameCancel={onRenameCancel}
                            selectedNodeId={selectedNodeId}
                            focusedNodeId={focusedNodeId}
                            renamingNodeId={renamingNodeId}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};