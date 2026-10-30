import React from 'react';
import { Codicon as Icon } from '../../../shared/Codicon';
import { TreeNodeProps } from '../../types';
import { RenameInput } from '../RenameInput/RenameInput';
import { logger } from '../../../shared/logger';
import { nodeIdToKey } from '../../../shared/nodeIdUtils';
import { sln } from '../../../../core/utils';
import { ENTITY_FRAMEWORK_PROJECT, IN_TEST_PROJECT } from '../../../../core/contextMenus';
import { isDraggable } from '../../../../core/dropRules';
import { describeMarker } from './diagnosticMarker';
import { IconThemeContext, themeFontFamily } from './IconThemeContext';
import { fontGlyph, resolveThemeIcon } from '../../../shared/iconTheme';

const log = logger('TreeNode');
export const TreeNode: React.FC<TreeNodeProps> = ({
    node,
    level,
    inTestProject,
    onProjectAction,
    onToggleExpand,
    onNodeClick,
    onNodeFocus,
    onNodeContextMenu,
    onRenameConfirm,
    onRenameCancel,
    selectedNodeId,
    selectedNodeIds,
    focusedNodeId,
    renamingNodeId,
    markers,
    dropTargetId,
    onNodeDragStart,
    onNodeDragOver,
    onNodeDrop,
    onNodeDragEnd,
    onNodeHover,
    onMarkerHover
}) => {
    // The single-click action waits for a possible double click; a row removed meanwhile must not act
    const clickTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const clearClickTimeout = () => {
        if (clickTimeout.current) {
            clearTimeout(clickTimeout.current);
            clickTimeout.current = null;
        }
    };
    React.useEffect(() => clearClickTimeout, []);

    const nodeIdentifier = node.nodeId;
    const isInTestProject = inTestProject || node.isTestProject;
    const isRenaming = renamingNodeId === nodeIdentifier || (node.isTemporary && node.isEditing);
    // Nodes with a move can be dragged, not while a name is being edited (the input needs the mouse)
    const canDrag = isDraggable(node) && !renamingNodeId && !node.isLoading;

    const handleClick = (e: React.MouseEvent) => {
        log.debug(`Single click on ${node.type}: ${node.name} (nodeId: ${nodeIdentifier})`);

        // Don't handle clicks if node is loading or is temporary
        if (node.isLoading || node.isTemporary) {
            log.debug(`Node ${node.name} is loading or temporary, ignoring click`);
            return;
        }

        // Ctrl/Cmd+click and Shift+click change the selection only, like Visual Studio
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
            onNodeClick(nodeIdentifier, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey });
            return;
        }

        clearClickTimeout();

        // Set up debounced single click action
        const timeout = setTimeout(() => {
            log.debug(`Executing single click action for: ${node.name}`);

            // If has children, expand/collapse AND focus the item
            if (node.children?.length || node.hasChildren) {
                log.debug(`Toggling expansion for: ${node.name}`);
                onToggleExpand(nodeIdentifier, node.type);
                // Also focus the item so it gets the blue border
                log.debug(`Focusing expanded node: ${node.name}`);
                onNodeClick(nodeIdentifier);
            } else {
                // If no children, select and focus the item
                log.debug(`Node ${node.name} has no children, selecting it`);
                onNodeClick(nodeIdentifier);
            }

            clickTimeout.current = null;
        }, ['folder', 'solutionFolder', 'dependencyCategory', 'dependencies'].includes(node.type) ? 0 : 250); // 250ms delay to detect double clicks

        clickTimeout.current = timeout;
    };

    const handleDoubleClick = () => {
        log.debug(`Double click on ${node.type}: ${node.name} (nodeId: ${nodeIdentifier})`);

        // Don't handle clicks if node is loading or is temporary
        if (node.isLoading || node.isTemporary) {
            log.debug(`Node ${node.name} is loading or temporary, ignoring double click`);
            return;
        }

        // The single click action is not wanted: this is a double click
        clearClickTimeout();

        // Double click opens file for file types, project files, and solution files
        if (node.type === 'file' || node.type === 'generatedFile' || node.type === 'solutionItem' || node.type === 'project' || node.type === 'solution' || node.type === 'grpcReference') {
            log.debug(`Opening file: ${node.name}`);
            onProjectAction({
                action: 'openFile',
                nodeId: nodeIdentifier
            });
        } else {
            log.debug(`Double click on ${node.type} - no action needed`);
        }
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        if (node.isTemporary) {
            // Suppress the native menu while a new file/folder is being named
            e.preventDefault();
            return;
        }
        // Don't prevent default: VS Code shows the native webview/context menu for this row
        onNodeContextMenu?.(nodeIdentifier);
        onNodeFocus(nodeIdentifier);
    };

    const handleRenameConfirmLocal = (newName: string) => {
        if (node.isTemporary) {
            log.debug(`Creating new ${node.type}: ${newName}`);
            if (node.type === 'file') {
                onProjectAction({
                    action: 'addFile',
                    nodeId: nodeIdentifier,
                    data: {
                        name: newName,
                        confirmed: true
                    }
                });
            } else if (node.type === 'folder') {
                onProjectAction({
                    action: 'addFolder',
                    nodeId: nodeIdentifier,
                    data: {
                        name: newName,
                        confirmed: true
                    }
                });
            }
        } else {
            log.debug(`Renaming ${node.name} to ${newName}`);
            onRenameConfirm(newName, nodeIdentifier, node.type, node.name);
        }
    };

    const handleRenameCancelLocal = () => {
        if (node.isTemporary) {
            log.debug(`Cancelling creation of temporary ${node.type}: ${node.name}`);
            // For temporary nodes, trigger removal action
            onProjectAction({
                action: 'cancelTemporaryNode',
                nodeId: node.nodeId
            });
        } else {
            log.debug(`Cancelling rename for: ${node.name}`);
            onRenameCancel();
        }
    };


    const getIconConfig = () => {
        switch (node.type) {
            case 'solution': return {
                icon: 'project',
                color: '#d294e2', // Updated solution color
                border: true
            };
            case 'solutionFolder':
                return {
                    icon: node.expanded ? 'folder-opened' : 'folder',
                    color: '#d8ac6a' // Folder color
                };
            case 'project':
                // Different icons based on project type - check node name for project file extension
                const projectName = node.name || '';

                if (projectName.includes('.csproj')) return {
                    icon: 'file-code',
                    color: '#3BA745',
                    border: true
                };
                if (projectName.includes('.vbproj')) return {
                    icon: 'file-code',
                    color: '#68217A', // VB.NET purple
                    border: true
                };
                if (projectName.includes('.fsproj')) return {
                    icon: 'file-code',
                    color: '#378BBA', // F# blue
                    border: true
                };

                // Default C# icon for projects when we can't determine type
                return {
                    icon: 'file-code',
                    color: '#3BA745',
                    border: true
                };
            case 'folder':
                // Special folder names with specific icons
                if (node.name === 'Dependencies') return { icon: 'references', color: '#dcdcdc' };
                if (node.name === 'Properties') return { icon: 'wrench', color: '#dcdcdc' };
                if (node.name === 'Connected Services') return { icon: 'plug', color: '#dcdcdc' };
                return {
                    icon: node.expanded ? 'folder-opened' : 'folder',
                    color: '#d8ac6a' // Folder color
                };
            case 'file':
            case 'generatedFile':
                // File type specific icons matching Visual Studio dark theme
                const fileName = node.name.toLowerCase();

                // C# files - Green color for code files
                if (fileName.endsWith('.cs')) {
                    return { icon: 'file-code', color: '#3BA745' };
                }

                // VB.NET files
                if (fileName.endsWith('.vb')) return { icon: 'file-code', color: '#68217A' };

                // F# files
                if (fileName.endsWith('.fs') || fileName.endsWith('.fsx')) return { icon: 'file-code', color: '#378BBA' };

                // Configuration files
                if (fileName === 'appsettings.json' || fileName.startsWith('appsettings.')) return { icon: 'settings-gear', color: '#dcdcdc' };
                if (fileName.endsWith('.config')) return { icon: 'settings-gear', color: '#dcdcdc' };
                if (fileName === 'web.config' || fileName === 'app.config') return { icon: 'settings-gear', color: '#dcdcdc' };

                // Project/build files
                if (fileName.endsWith('.csproj') || fileName.endsWith('.vbproj') || fileName.endsWith('.fsproj')) return { icon: 'project', color: '#dcdcdc' };
                if (sln(fileName)) return { icon: 'project', color: '#68217a' };
                if (fileName === 'global.asax') return { icon: 'globe', color: '#dcdcdc' };

                // Web files
                if (fileName.endsWith('.cshtml') || fileName.endsWith('.vbhtml')) return { icon: 'file-code', color: '#dcdcdc' };
                if (fileName.endsWith('.aspx') || fileName.endsWith('.ascx')) return { icon: 'globe', color: '#dcdcdc' };
                if (fileName.endsWith('.master')) return { icon: 'globe', color: '#dcdcdc' };
                if (fileName.endsWith('.css')) return { icon: 'file-code', color: '#dcdcdc' };
                if (fileName.endsWith('.js')) return { icon: 'file-code', color: '#dcdcdc' };
                if (fileName.endsWith('.ts')) return { icon: 'file-code', color: '#3178C6' };
                if (fileName.endsWith('.html') || fileName.endsWith('.htm')) return { icon: 'file-code', color: '#dcdcdc' };

                // Resources
                if (fileName.endsWith('.resx')) return { icon: 'file-code', color: '#dcdcdc' };
                if (fileName.endsWith('.xaml')) return { icon: 'file-code', color: '#dcdcdc' };

                // Data files - JSON as gray
                if (fileName.endsWith('.json')) return { icon: 'json', color: '#dcdcdc' };
                if (fileName.endsWith('.xml')) return { icon: 'file-code', color: '#dcdcdc' };
                if (fileName.endsWith('.sql')) return { icon: 'database', color: '#dcdcdc' };

                // Documentation
                if (fileName.endsWith('.md')) return { icon: 'markdown', color: '#dcdcdc' };
                if (fileName.endsWith('.txt')) return { icon: 'file-text', color: '#dcdcdc' };
                if (fileName === 'readme.md' || fileName === 'readme.txt') return { icon: 'info', color: '#dcdcdc' };

                // Build/CI files
                if (fileName.endsWith('.yml') || fileName.endsWith('.yaml')) return { icon: 'file-code', color: '#dcdcdc' };
                if (fileName === 'dockerfile' || fileName.startsWith('dockerfile.')) return { icon: 'package', color: '#dcdcdc' };

                // Default file icon
                return { icon: 'file', color: '#dcdcdc' };

            case 'dependencies': return { icon: 'references', color: '#dcdcdc' };
            case 'dependencyCategory':
                // Use different icons for different dependency categories
                if (node.name === 'Analyzers') return { icon: 'search', color: '#dcdcdc' };
                if (node.name === 'Packages') return { icon: 'package', color: '#dcdcdc' };
                if (node.name === 'Projects') return { icon: 'project', color: '#dcdcdc' };
                if (node.name === 'Assemblies') return { icon: 'library', color: '#dcdcdc' };
                if (node.name === 'Frameworks') return { icon: 'server-environment', color: '#dcdcdc' };
                return { icon: 'folder', color: '#d8ac6a' };
            case 'dependency':
            case 'transitivePackage': return { icon: 'package', color: '#dcdcdc' };
            case 'analyzer': return { icon: 'search', color: '#dcdcdc' };
            case 'sourceGenerator': return { icon: 'gear', color: '#dcdcdc' };
            case 'connectedServices': return { icon: 'plug', color: '#dcdcdc' };
            case 'frameworkReference': return { icon: 'server-environment', color: '#dcdcdc' };
            case 'grpcReference': return { icon: 'radio-tower', color: '#dcdcdc' };
            default: return { icon: 'file', color: '#dcdcdc' };
        }
    };

    const paddingLeft = level * 16;
    const isSelected = selectedNodeId === nodeIdentifier || !!selectedNodeIds?.has(nodeIdentifier);
    const isFocused = focusedNodeId === nodeIdentifier;
    const marker = markers?.[nodeIdentifier];
    const markerTitle = marker ? describeMarker(marker) : undefined;
    // A node with problems has the squiggle and, instead of the native tooltip, a hint (DiagnosticsHint) with its name and a link to the Error List
    const markerProps = {
        'aria-label': markerTitle ? `${node.name}, ${markerTitle}` : node.name,
        onMouseEnter: (e: React.MouseEvent) => onMarkerHover?.(nodeIdentifier, (e.currentTarget as HTMLElement).getBoundingClientRect(), node.name),
        onMouseLeave: () => onMarkerHover?.(nodeIdentifier, undefined, node.name),
    };

    // Memoize icon configuration to prevent multiple calls during render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const iconConfig = React.useMemo(() => getIconConfig(), [node.type, node.name, nodeIdentifier, node.expanded]);

    // Files and folders use the user's file icon theme when it has an icon for them; solutions and
    // projects only when the theme has one for their file type, otherwise the built-in icons are nicer
    const iconTheme = React.useContext(IconThemeContext);
    const themeIcon = React.useMemo(() => {
        switch (node.type) {
            case 'file':
            case 'generatedFile':
            case 'solutionItem':
                return resolveThemeIcon(iconTheme, node.name, 'file');
            case 'folder':
            case 'solutionFolder':
                return resolveThemeIcon(iconTheme, node.name, 'folder', !!node.expanded);
            case 'solution':
            case 'project':
                return node.fileName ? resolveThemeIcon(iconTheme, node.fileName, 'file', false, true) : undefined;
            default:
                return undefined;
        }
    }, [iconTheme, node.type, node.name, node.fileName, node.expanded]);
    const themeFont = themeIcon?.fontCharacter
        ? iconTheme?.fonts.find(font => font.id === themeIcon.fontId) ?? iconTheme?.fonts[0]
        : undefined;

    return (
        <div>
            <div
                className={`tree-node ${node.type} ${isSelected ? 'selected' : ''} ${isFocused ? 'focused' : ''} ${node.isUnloaded ? 'unloaded' : ''} ${node.itemState ?? ''} ${dropTargetId === nodeIdentifier ? 'drop-target' : ''}`}
                style={{ paddingLeft, cursor: node.isLoading ? 'wait' : 'pointer' }}
                onClick={handleClick}
                onDoubleClick={handleDoubleClick}
                onContextMenu={handleContextMenu}
                draggable={canDrag}
                onDragStart={e => onNodeDragStart?.(nodeIdentifier, e)}
                onDragOver={e => onNodeDragOver?.(nodeIdentifier, e)}
                onDrop={e => onNodeDrop?.(nodeIdentifier, e)}
                onDragEnd={() => onNodeDragEnd?.()}
                onMouseOver={e => onNodeHover?.(nodeIdentifier, e)}
                onMouseMove={e => onNodeHover?.(nodeIdentifier, e)}
                data-vscode-context={node.isTemporary ? undefined : JSON.stringify({
                    webviewSection: 'node',
                    nodeType: node.type,
                    contextValue: node.contextValue,
                    ...(isInTestProject && { [IN_TEST_PROJECT]: true }),
                    ...(node.usesEntityFramework && { [ENTITY_FRAMEWORK_PROJECT]: true }),
                    nodeId: nodeIdentifier,
                    preventDefaultContextMenuItems: true
                })}
            >
                {(node.children?.length || node.hasChildren) ? (
                    <Icon
                        icon="chevron-right"
                        className="expand-icon"
                        width="16"
                        height="16"
                        style={{
                            display: 'inline-flex',
                            minWidth: '16px',
                            minHeight: '16px',
                            transform: node.expanded ? 'rotate(90deg)' : 'rotate(0deg)'
                        }}
                    />
                ) : (
                    <span className="expand-icon-placeholder"></span>
                )}
                <div
                    className="node-icon"
                    style={{
                        ...(iconConfig.border && !themeIcon ? {
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
                    {themeIcon?.svg ? (
                        <img src={themeIcon.svg} width="16" height="16" alt="" style={{ display: 'block' }} />
                    ) : themeIcon?.fontCharacter && themeFont ? (
                        <span className="theme-glyph" style={{ fontFamily: themeFontFamily(themeFont.id), color: themeIcon.fontColor }}>
                            <span style={{ fontSize: themeIcon.fontSize ?? themeFont.size }}>{fontGlyph(themeIcon.fontCharacter)}</span>
                        </span>
                    ) : (
                        <Icon
                            icon={iconConfig.icon}
                            width={iconConfig.border ? "15" : "16"}
                            height={iconConfig.border ? "15" : "16"}
                            style={{
                                color: iconConfig.color,
                                display: 'block',
                                minWidth: iconConfig.border ? "15px" : "16px",
                                minHeight: iconConfig.border ? "15px" : "16px",
                                ...(iconConfig.border && {
                                    position: 'absolute',
                                    bottom: '-6px',
                                    left: '0px',
                                    background: 'var(--vscode-editor-background)'
                                })
                            }}
                        />
                    )}
                    {node.itemState === 'linked' && (
                        <span className="link-overlay"><Icon icon="link" width="10" height="10" style={{ display: 'block' }} /></span>
                    )}
                </div>
                {isRenaming ? (
                    <RenameInput
                        initialValue={node.name}
                        onConfirm={handleRenameConfirmLocal}
                        onCancel={handleRenameCancelLocal}
                    />
                ) : (
                    <>
                        <span
                            className={`node-name ${node.isStartupProject ? 'startup-project' : ''} ${marker ? `diagnostic-${marker.severity}` : ''}`}
                            {...(marker ? markerProps : { title: node.name })}
                        >{node.isUnloaded ? `${node.name} (unloaded)` : node.name}</span>
                    </>
                )}
            </div>
            {node.expanded && node.children && (
                <div className="tree-children">
                    {node.children.map((child) => (
                        <TreeNode
                            key={nodeIdToKey(child.nodeId)}
                            node={child}
                            level={level + 1}
                            inTestProject={isInTestProject}
                            onProjectAction={onProjectAction}
                            onToggleExpand={onToggleExpand}
                            onNodeClick={onNodeClick}
                            onNodeFocus={onNodeFocus}
                            onNodeContextMenu={onNodeContextMenu}
                            onRenameConfirm={onRenameConfirm}
                            onRenameCancel={onRenameCancel}
                            selectedNodeId={selectedNodeId}
                            selectedNodeIds={selectedNodeIds}
                            focusedNodeId={focusedNodeId}
                            renamingNodeId={renamingNodeId}
                            markers={markers}
                            dropTargetId={dropTargetId}
                            onNodeDragStart={onNodeDragStart}
                            onNodeDragOver={onNodeDragOver}
                            onNodeDrop={onNodeDrop}
                            onNodeDragEnd={onNodeDragEnd}
                            onNodeHover={onNodeHover}
                            onMarkerHover={onMarkerHover}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};