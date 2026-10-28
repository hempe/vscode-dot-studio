import { useEffect, useState, useCallback } from 'react';
import type { ToolbarAction, ToolbarChoice, ToolbarState } from '../../../types/toolbar';
import { logger } from '../../shared/logger';
import { sendToBackend } from '../../nuget-view/shared';
import { NodeIdString } from '../../../types/nodeId';
import { DiagnosticMarkers, NodeType, ProjectNode, SolutionData } from '../../../types';
import { UICmd } from '../../../types/commands/ui';
import { IconThemePayload } from '../../../types/iconTheme';
import { ProjectActionCmd } from '../../../types/commands/project-action';

// Helper function to update a node in the tree structure
/**
 * Smart merge of tree data that preserves React component instances where possible
 * This prevents unnecessary re-renders and maintains expansion visual state
 */
export const mergeTreeData = (currentData: SolutionData | null, newData: SolutionData): SolutionData => {
    if (!currentData || !currentData.projects) {
        // No current data, use new data as-is
        return newData;
    }

    // Create a map of current nodes by nodeId for fast lookup
    const currentNodesMap = new Map<string, any>();

    const buildNodeMap = (nodes: any[]) => {
        for (const node of nodes) {
            if (node.nodeId) {
                currentNodesMap.set(node.nodeId, node);
            }
            if (node.children) {
                buildNodeMap(node.children);
            }
        }
    };

    buildNodeMap(currentData.projects);

    // Recursively merge nodes, preserving object references where possible
    const mergeNodes = (newNodes: any[]): any[] => {
        return newNodes.map(newNode => {
            const currentNode = currentNodesMap.get(newNode.nodeId);

            if (currentNode) {
                // Node exists in current tree - preserve the reference unless anything but its children changed
                // (e.g. isStartupProject or contextValue after "Set as Startup Project")
                const { children: _currentChildren, ...currentProps } = currentNode;
                const { children: _newChildren, ...newProps } = newNode;
                const nodeChanged = JSON.stringify(currentProps) !== JSON.stringify(newProps);

                if (!nodeChanged) {
                    // Node hasn't changed - preserve the current object reference
                    // But still merge children in case they changed
                    if (newNode.children) {
                        return {
                            ...currentNode,
                            children: mergeNodes(newNode.children)
                        };
                    }
                    return currentNode;
                } else {
                    // Node changed - create new object but merge children
                    return {
                        ...newNode,
                        children: newNode.children ? mergeNodes(newNode.children) : undefined
                    };
                }
            } else {
                // New node - create it but merge any children
                return {
                    ...newNode,
                    children: newNode.children ? mergeNodes(newNode.children) : undefined
                };
            }
        });
    };

    // Merge the tree structure
    const mergedProjects = mergeNodes(newData.projects);

    return {
        ...newData,
        projects: mergedProjects
    };
};
// Helper function to add a temporary node for creation
const addTemporaryNodeToTree = (
    solutionData: SolutionData,
    parentNodeId: NodeIdString,
    nodeId: NodeIdString,
    nodeType: NodeType): SolutionData => {
    const tempNode: ProjectNode = {
        nodeId: nodeId,
        type: nodeType,
        name: '',
        isTemporary: true,
        isEditing: true,
        hasChildren: false,
        expanded: false
    };

    const addTempNodeToParent = (nodes: any[]): any[] => {
        return nodes.map(node => {
            if (node.nodeId === parentNodeId) {
                // Found the parent, add the temporary node to its children in proper order
                let newChildren: any[];

                if (!node.children || node.children.length === 0) {
                    // Empty parent, just add the temp node
                    newChildren = [tempNode];
                } else {
                    // Insert temp node in proper position based on type
                    // Files go at the end
                    newChildren = [...node.children, tempNode];
                }

                return {
                    ...node,
                    children: newChildren,
                    expanded: true // Ensure parent is expanded to show the new temp node
                };
            }
            if (node.children) {
                return {
                    ...node,
                    children: addTempNodeToParent(node.children)
                };
            }
            return node;
        });
    };

    return {
        ...solutionData,
        projects: addTempNodeToParent(solutionData.projects)
    };
};

// Helper function to remove a temporary node from the tree
const removeTemporaryNodeFromTree = (solutionData: SolutionData, nodeId: NodeIdString): SolutionData => {
    const nodeIdString = nodeId;
    const removeNodeById = (nodes: any[]): any[] => {
        return nodes.filter(node => {
            if (node.nodeId === nodeIdString && node.isTemporary) {
                return false; // Remove this temporary node
            }
            if (node.children) {
                node.children = removeNodeById(node.children);
            }
            return true;
        });
    };

    return {
        ...solutionData,
        projects: removeNodeById(solutionData.projects)
    };
};

// Helper function to remove all temporary nodes from a specific parent
const removeTemporaryNodesFromParent = (solutionData: SolutionData, parentPath: string): SolutionData => {
    const removeTemporaryFromNode = (nodes: any[]): any[] => {
        return nodes.map(node => {
            if (node.nodeId === parentPath && node.children) {
                // Remove all temporary children from this parent
                return {
                    ...node,
                    children: node.children.filter((child: any) => !child.isTemporary)
                };
            }
            if (node.children) {
                return {
                    ...node,
                    children: removeTemporaryFromNode(node.children)
                };
            }
            return node;
        });
    };

    return {
        ...solutionData,
        projects: removeTemporaryFromNode(solutionData.projects)
    };
};

const log = logger('useVsCodeApi');
export const useVsCodeApi = () => {
    const [solutionData, setSolutionData] = useState<SolutionData | null>(null);
    const [loading, setLoading] = useState(true);
    const [toolbar, setToolbar] = useState<ToolbarState | null>(null);
    // Why the solution could not be loaded (the host's message), until data arrives
    const [loadError, setLoadError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [markers, setMarkers] = useState<DiagnosticMarkers>({} as DiagnosticMarkers);
    const [iconTheme, setIconTheme] = useState<IconThemePayload | null>(null);

    useEffect(() => {
        log.info('Hook initialized, requesting solution data');

        // Request initial solution data
        sendToBackend({ type: 'getSolutionData' });

        // Listen for messages from the extension
        const handleMessage = (event: MessageEvent) => {
            const message = event.data as UICmd;
            switch (message.type) {
                case 'toolbarState':
                    setToolbar(message.payload);
                    break;
                case 'hideLoading':
                    setLoading(false);
                    setRefreshing(false);
                    break;
                case 'solutionData':
                    setSolutionData(prev => mergeTreeData(prev, message.payload));
                    setLoadError(null);
                    setLoading(false);
                    setRefreshing(false);
                    break;
                case 'error':
                    log.info('Received error:', message.payload.message);
                    setLoadError(message.payload.message);
                    setLoading(false);
                    break;
                case 'addTemporaryNode':
                    log.info('Adding temporary node:', message);
                    setSolutionData(prev => {
                        if (!prev) return prev;
                        const parentNodeId = message.payload.parentNodeId;
                        log.info('findNodeIdFromPath result for path:', message.payload.parentNodeId, 'nodeId:', parentNodeId);
                        if (parentNodeId) {
                            return addTemporaryNodeToTree(prev, parentNodeId, message.payload.nodeId, message.payload.nodeType);
                        } else {
                            log.error('Could not find nodeId for parentNodeId:', message.payload.parentNodeId);
                        }
                        return prev;
                    });
                    break;
                case 'removeTemporaryNodes':
                    log.info('Removing temporary nodes from parent:', message.payload.parentPath);
                    setSolutionData(prev => {
                        if (!prev) return prev;
                        const parentNodeId = message.payload.parentPath;
                        if (parentNodeId) {
                            return removeTemporaryNodesFromParent(prev, parentNodeId);
                        }
                        return prev;
                    });
                    break;
                case 'activeFileChanged':
                    // Nothing in the tree shows it: no state, so an editor switch does not render the tree
                    break;
                case 'diagnostics':
                    setMarkers(message.payload.markers);
                    break;
                case 'iconTheme':
                    setIconTheme(message.payload.theme);
                    break;
                default:
                    log.info('Unknown message command:', message.payload);
            }
        };

        window.addEventListener('message', handleMessage);
        return () => {
            log.info('Cleaning up message listener');
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    const handleProjectAction = useCallback((cmd: ProjectActionCmd) => {
        log.info('Project action requested:', cmd);

        if (cmd.action === 'cancelTemporaryNode') {
            // Handle temporary node cancellation locally
            setSolutionData(prev => {
                if (!prev) return prev;
                return removeTemporaryNodeFromTree(prev, cmd.nodeId);
            });
        } else {
            sendToBackend({
                type: 'projectAction',
                payload: cmd
            });
        }
    }, []);

    const expandNode = useCallback((nodeId: NodeIdString) => {
        log.info('Expanding node:', nodeId);
        sendToBackend({ type: 'expandNode', payload: { nodeId: nodeId } });
    }, []);

    const collapseNode = useCallback((nodeId: NodeIdString) => {
        log.info('Collapsing node:', nodeId);
        sendToBackend({ type: 'collapseNode', payload: { nodeId: nodeId } });
    }, []);

    const toolbarChoose = useCallback((choice: ToolbarChoice, value: string) => {
        sendToBackend({ type: 'toolbarAction', payload: { action: choice, value } });
    }, []);

    const toolbarAction = useCallback((action: ToolbarAction) => {
        sendToBackend({ type: 'toolbarAction', payload: { action } });
    }, []);

    return {
        solutionData,
        loadError,
        toolbar,
        toolbarAction,
        toolbarChoose,
        loading,
        refreshing,
        markers,
        iconTheme,
        handleProjectAction,
        expandNode,
        collapseNode
    };
};