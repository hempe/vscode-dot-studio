import React from 'react';
import { NodeType } from '../../types';
import { contextMenus, MenuItem, MenuAction } from './menuActions';

export interface ContextMenuProps {
    x: number;
    y: number;
    onClose: () => void;
    onRename: () => void;
    onAction: (action: string, data?: any) => void;
    nodeType: NodeType;
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

    const menuRef = React.useRef<HTMLDivElement>(null);
    const [focusedItemIndex, setFocusedItemIndex] = React.useState(0);

    // Get the menu configuration for this node type
    const menuItems = contextMenus[nodeType] || [];
    const actionItems = menuItems.filter(item => item.kind === 'action') as MenuAction[];


    React.useEffect(() => {
        // Focus the menu when it opens
        if (menuRef.current) {
            menuRef.current.focus();
        }
    }, []);

    React.useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            // Only handle keyboard events if the menu is focused or contains the focused element
            if (!menuRef.current || (!menuRef.current.contains(document.activeElement) && document.activeElement !== menuRef.current)) {
                return;
            }

            if (e.key === 'Escape') {
                onClose();
                return;
            }

            if (actionItems.length === 0) return;

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    setFocusedItemIndex(prev => (prev + 1) % actionItems.length);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    setFocusedItemIndex(prev => (prev - 1 + actionItems.length) % actionItems.length);
                    break;
                case 'Enter':
                    e.preventDefault();
                    const focusedAction = actionItems[focusedItemIndex];
                    if (focusedAction) {
                        handleActionClick(focusedAction.action);
                    }
                    break;
            }
        };

        document.addEventListener('click', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('click', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose, focusedItemIndex]);

    const handleActionClick = (action: string, data?: any) => {
        // Handle special case for rename action
        if (action === 'rename') {
            onRename();
        } else {
            // For deleteFile action, pass the node type as data
            const actionData = action === 'deleteFile' ? { type: nodeType, ...data } : data;
            onAction(action, actionData);
        }
        onClose();
    };

    const renderMenuItems = () => {
        return menuItems.map((item, index) => {
            if (item.kind === 'separator') {
                return <div key={`sep-${index}`} className="context-menu-separator"></div>;
            }

            const actionIndex = actionItems.findIndex(actionItem => actionItem === item);
            const isFocused = focusedItemIndex === actionIndex;

            return (
                <div
                    key={`${item.action}-${index}`}
                    className={`context-menu-item ${isFocused ? 'focused' : ''}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        handleActionClick(item.action);
                    }}
                >
                    <span className="context-menu-label">{item.name}</span>
                    {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
                </div>
            );
        });
    };

    return (
        <div
            ref={menuRef}
            className="context-menu"
            style={{
                position: 'fixed',
                left: x,
                top: y,
                zIndex: 1000
            }}
            onClick={(e) => e.stopPropagation()}
            tabIndex={0}
        >
            <div className="context-menu-content">
                {renderMenuItems()}
            </div>
        </div>
    );
};