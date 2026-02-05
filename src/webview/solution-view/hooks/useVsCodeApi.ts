import { useEffect, useState, useCallback } from 'react';
import { ProjectActionType } from '../types';
import { logger } from '../../shared/logger';
import { generateTemporaryId, extractPathFromNodeId } from '../../shared/nodeIdUtils';
import { sendToBackend } from '../../nuget-view/shared';
import { NodeIdString } from '../../../types/nodeId';
import { SolutionData } from '../../../types';
import { UICmd } from '../../../types/uiCmd';

// Helper function to update a node in the tree structure
/**
 * Smart merge of tree data that preserves React component instances where possible
 * This prevents unnecessary re-renders and maintains expansion visual state
 */
const mergeTreeData = (currentData: SolutionData | null, newData: SolutionData): SolutionData => {
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
                // Node exists in current tree - check if we can preserve the reference
                const nodeChanged = JSON.stringify({
                    type: currentNode.type,
                    name: currentNode.name,
                    path: currentNode.path,
                    expanded: currentNode.expanded,
                    isLoading: currentNode.isLoading,
                    hasChildren: currentNode.hasChildren
                }) !== JSON.stringify({
                    type: newNode.type,
                    name: newNode.name,
                    path: newNode.path,
                    expanded: newNode.expanded,
                    isLoading: newNode.isLoading,
                    hasChildren: newNode.hasChildren
                });

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
const addTemporaryNodeToTree = (solutionData: SolutionData, parentNodeId: NodeIdString, nodeType: string, defaultName: string): SolutionData => {
    const parentPath = extractPathFromNodeId(parentNodeId);
    if (!parentPath) {
        // Parent node does not have a valid path
        return solutionData;
    }
    // Generate proper temporary node ID using the service
    const tempNodeId = generateTemporaryId(parentPath, nodeType);
    const tempNode = {
        nodeId: tempNodeId,
        type: nodeType,
        name: defaultName,
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
                    if (nodeType === 'folder') {
                        // Folders should go after existing folders but before files
                        const folders = node.children.filter((child: any) => child.type === 'folder');
                        const files = node.children.filter((child: any) => child.type !== 'folder');
                        newChildren = [...folders, tempNode, ...files];
                    } else {
                        // Files go at the end
                        newChildren = [...node.children, tempNode];
                    }
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

// Helper function to find nodeId from path in tree
const findNodeIdFromPath = (nodes: any[], targetPath: string): string | null => {
    for (const node of nodes) {
        if (node.path === targetPath) {
            return node.nodeId;
        }
        if (node.children) {
            const found = findNodeIdFromPath(node.children, targetPath);
            if (found) return found;
        }
    }
    return null;
};

const log = logger('useVsCodeApi');
export const useVsCodeApi = () => {
    const [solutionData, setSolutionData] = useState<SolutionData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

    useEffect(() => {
        log.info('Hook initialized, requesting solution data');

        // Request initial solution data
        sendToBackend({ type: 'getSolutionData' });

        // Listen for messages from the extension
        const handleMessage = (event: MessageEvent) => {
            const message = event.data as UICmd;
            switch (message.type) {
                case 'hideLoading':
                    setLoading(false);
                    setRefreshing(false);
                    break;
                case 'solutionData':
                    console.error('📥 Received full solution data:', message.payload);
                    console.error('📥 Projects count:', message.payload?.projects?.length);
                    setSolutionData(prev => mergeTreeData(prev, message.payload));
                    console.error('📥 Setting loading=false, refreshing=false');
                    setLoading(false);
                    setRefreshing(false);
                    break;
                case 'error':
                    log.info('Received error:', message.payload.message);
                    setLoading(false);
                    break;
                case 'addTemporaryNode':
                    log.info('Adding temporary node:', message);
                    setSolutionData(prev => {
                        if (!prev) return prev;
                        const parentNodeId = message.payload.parentNodeId;
                        log.info('findNodeIdFromPath result for path:', message.payload.parentNodeId, 'nodeId:', parentNodeId);
                        if (parentNodeId) {
                            return addTemporaryNodeToTree(prev, parentNodeId, message.payload.nodeType, message.payload.defaultName);
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
                    log.info('Active file changed:', message.payload.filePath);
                    setActiveFilePath(message.payload.filePath);
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

    const handleFrameworkChange = useCallback((framework: string) => {
        log.info('Framework change requested:', framework);
        sendToBackend({ type: 'setFramework', payload: { framework } });
    }, []);

    const handleProjectAction = useCallback((action: ProjectActionType, nodeId: NodeIdString, data: any | undefined) => {
        log.info('Project action requested:', { action, nodeId, data });

        if (action === 'cancelTemporaryNode') {
            // Handle temporary node cancellation locally
            setSolutionData(prev => {
                if (!prev) return prev;
                return removeTemporaryNodeFromTree(prev, nodeId); // projectPath is actually nodeId in this case
            });
        } else {
            sendToBackend({
                type: 'projectAction',
                payload: {
                    action,
                    nodeId: nodeId,
                    data
                }
            });
        }
    }, []);

    const expandNode = useCallback((nodeId: NodeIdString, nodeType: string) => {
        log.info('Expanding node:', nodeId, nodeType);
        sendToBackend({ type: 'expandNode', payload: { nodeId: nodeId, nodeType } });
    }, []);

    const collapseNode = useCallback((nodeId: NodeIdString) => {
        log.info('Collapsing node:', nodeId);
        sendToBackend({ type: 'collapseNode', payload: { nodeId: nodeId } });
    }, []);

    return {
        solutionData,
        loading,
        refreshing,
        activeFilePath,
        handleFrameworkChange,
        handleProjectAction,
        expandNode,
        collapseNode
    };
};