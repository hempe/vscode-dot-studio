import React from 'react';
import { NodeType } from '../../types';
import { contextMenus, MenuItem, MenuAction } from './menuActions';
import { logger } from '../../../shared/logger';
import { MenuActionType } from '../../../../types';

const log = logger('ContextMenu');
export interface ContextMenuProps {
    x: number;
    y: number;
    onClose: () => void;
    onRename: () => void;
    onAction: (action: MenuActionType, data?: any) => void;
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

    log.info(`RENDERING for nodeType: ${nodeType}, nodeName: ${nodeName}`);
    log.info(`Available contextMenus keys:`, Object.keys(contextMenus));
    log.info(`Full contextMenus object:`, contextMenus);

    const menuRef = React.useRef<HTMLDivElement>(null);
    const [focusedItemIndex, setFocusedItemIndex] = React.useState(0);
    const [position, setPosition] = React.useState({ x, y });

    // Get the menu configuration for this node type
    log.info(`Looking up contextMenus[${nodeType}] for nodeName: ${nodeName}`);
    const menuItems = contextMenus[nodeType] || [];
    log.info(`Found ${menuItems.length} menu items:`, menuItems);
    const actionItems: MenuItem[] = menuItems.filter(item => item.kind === 'action') as MenuAction[];
    log.info(`Filtered to ${actionItems.length} action items:`, actionItems);


    React.useEffect(() => {
        // Reset position when x or y props change (menu reopened at new location)
        setPosition({ x, y });
    }, [x, y]);

    React.useEffect(() => {
        // Focus the menu when it opens and adjust position to prevent overflow
        if (menuRef.current) {
            menuRef.current.focus();

            // Measure actual menu size and adjust position if needed
            const rect = menuRef.current.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            let adjustedX = position.x;
            let adjustedY = position.y;

            // Check right overflow
            if (rect.right > viewportWidth) {
                adjustedX = viewportWidth - rect.width;
            }

            // Check bottom overflow
            if (rect.bottom > viewportHeight) {
                adjustedY = viewportHeight - rect.height;
            }

            // Ensure menu stays within bounds
            adjustedX = Math.max(0, adjustedX);
            adjustedY = Math.max(0, adjustedY);

            // Only update if position changed
            if (adjustedX !== position.x || adjustedY !== position.y) {
                setPosition({ x: adjustedX, y: adjustedY });
            }
        }
    }, [position.x, position.y]);

    React.useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        function stop(e: KeyboardEvent) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        }
        const handleKeyDown = (e: KeyboardEvent) => {
            // Always handle keyboard events when the context menu is open
            // This prevents events from bubbling to VS Code's main UI
            if (e.key === 'Escape') {
                stop(e);;
                onClose();
                return;
            }

            if (actionItems.length === 0) return;

            switch (e.key) {
                case 'ArrowDown':
                    stop(e);;
                    setFocusedItemIndex(prev => (prev + 1) % actionItems.length);
                    break;
                case 'ArrowUp':
                    stop(e);;
                    setFocusedItemIndex(prev => (prev - 1 + actionItems.length) % actionItems.length);
                    break;
                case 'Enter':
                    stop(e);;
                    const focusedAction = actionItems[focusedItemIndex];
                    if (focusedAction && 'action' in focusedAction) {
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

    const handleActionClick = (action: MenuActionType, data?: any) => {
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
        log.info(`renderMenuItems called, rendering ${menuItems.length} items`);
        return menuItems.map((item, index) => {
            log.info(`Rendering item ${index}:`, item);
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
                left: position.x,
                top: position.y,
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