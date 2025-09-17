import React from 'react';

export interface ContextMenuProps {
    x: number;
    y: number;
    onClose: () => void;
    onRename: () => void;
    onAction: (action: string, data?: any) => void;
    nodeType: string;
    nodeName: string;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
    x,
    y,
    onClose,
    onRename,
    onAction,
    nodeType,
    nodeName
}) => {
    React.useEffect(() => {
        const handleClickOutside = () => {
            onClose();
        };

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('click', handleClickOutside);
        document.addEventListener('keydown', handleEscape);

        return () => {
            document.removeEventListener('click', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [onClose]);

    const handleMenuItemClick = (e: React.MouseEvent, action: () => void) => {
        e.stopPropagation();
        action();
        onClose();
    };

    const handleActionClick = (e: React.MouseEvent, actionName: string, data?: any) => {
        e.stopPropagation();
        onAction(actionName, data);
        onClose();
    };

    const renderMenuItems = () => {
        const items = [];

        // File-specific items
        if (nodeType === 'file') {
            items.push(
                <div key="open" className="context-menu-item" onClick={(e) => handleActionClick(e, 'openFile')}>
                    <span className="context-menu-label">Open</span>
                </div>
            );
        }

        // Rename (for files, folders, projects)
        if (nodeType === 'file' || nodeType === 'folder' || nodeType === 'project') {
            items.push(
                <div key="rename" className="context-menu-item" onClick={(e) => handleMenuItemClick(e, onRename)}>
                    <span className="context-menu-label">Rename</span>
                    <span className="context-menu-shortcut">F2</span>
                </div>
            );
        }

        // Delete (for files and folders, but not projects)
        if (nodeType === 'file' || nodeType === 'folder') {
            items.push(
                <div key="delete" className="context-menu-item" onClick={(e) => handleActionClick(e, 'deleteFile', { type: nodeType })}>
                    <span className="context-menu-label">Delete</span>
                </div>
            );
        }

        // Project-specific items
        if (nodeType === 'project') {
            items.push(<div key="sep1" className="context-menu-separator"></div>);

            items.push(
                <div key="build" className="context-menu-item" onClick={(e) => handleActionClick(e, 'build')}>
                    <span className="context-menu-label">Build</span>
                </div>
            );

            items.push(
                <div key="rebuild" className="context-menu-item" onClick={(e) => handleActionClick(e, 'rebuild')}>
                    <span className="context-menu-label">Rebuild</span>
                </div>
            );

            items.push(
                <div key="clean" className="context-menu-item" onClick={(e) => handleActionClick(e, 'clean')}>
                    <span className="context-menu-label">Clean</span>
                </div>
            );
        }

        // Reveal in Explorer (for all types except dependencies)
        if (nodeType !== 'dependency') {
            if (items.length > 0) {
                items.push(<div key="sep2" className="context-menu-separator"></div>);
            }

            items.push(
                <div key="reveal" className="context-menu-item" onClick={(e) => handleActionClick(e, 'revealInExplorer')}>
                    <span className="context-menu-label">Reveal in Explorer</span>
                </div>
            );
        }

        return items;
    };

    return (
        <div
            className="context-menu"
            style={{
                position: 'fixed',
                left: x,
                top: y,
                zIndex: 1000
            }}
            onClick={(e) => e.stopPropagation()}
        >
            <div className="context-menu-content">
                {renderMenuItems()}
            </div>
        </div>
    );
};