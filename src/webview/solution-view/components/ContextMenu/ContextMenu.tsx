import React from 'react';

export interface ContextMenuProps {
    x: number;
    y: number;
    onClose: () => void;
    onRename: () => void;
    nodeType: string;
    nodeName: string;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
    x,
    y,
    onClose,
    onRename,
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

    const canRename = nodeType === 'file' || nodeType === 'folder' || nodeType === 'project';

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
                {canRename && (
                    <div
                        className="context-menu-item"
                        onClick={(e) => handleMenuItemClick(e, onRename)}
                    >
                        <span className="context-menu-icon codicon codicon-edit"></span>
                        <span className="context-menu-label">Rename</span>
                        <span className="context-menu-shortcut">F2</span>
                    </div>
                )}
                {nodeType === 'project' && (
                    <>
                        <div className="context-menu-separator"></div>
                        <div className="context-menu-item">
                            <span className="context-menu-icon codicon codicon-tools"></span>
                            <span className="context-menu-label">Build</span>
                        </div>
                        <div className="context-menu-item">
                            <span className="context-menu-icon codicon codicon-refresh"></span>
                            <span className="context-menu-label">Rebuild</span>
                        </div>
                        <div className="context-menu-item">
                            <span className="context-menu-icon codicon codicon-clear-all"></span>
                            <span className="context-menu-label">Clean</span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};