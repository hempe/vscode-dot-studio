import { useEffect, useState, useCallback } from 'react';
import { SolutionData, ProjectActionType } from '../types';
import { logger } from '../../shared/logger';
import { NodeIdString, parseNodeId, generateTemporaryId } from '../../shared/nodeIdUtils';

declare global {
    interface Window {
        acquireVsCodeApi(): any;
    }
}

const vscode = window.acquireVsCodeApi();

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

const updateNodeInTree = (solutionData: SolutionData, oldNodeId: string, newName: string, newPath?: string): SolutionData => {
    const updateNode = (node: any): any => {
        if (node.nodeId === oldNodeId) {
            // This is the node we want to update
            return {
                ...node,
                name: newName,
                path: newPath || node.path // Keep existing path if not provided
            };
        }

        if (node.children) {
            return {
                ...node,
                children: node.children.map(updateNode)
            };
        }

        return node;
    };

    return {
        ...solutionData,
        projects: solutionData.projects.map(updateNode)
    };
};

// Helper function to add a project to the tree structure
const addProjectToTree = (solutionData: SolutionData, newProject: any): SolutionData => {
    const addToNode = (nodes: any[]): any[] => {
        return nodes.map(node => {
            // If this is a solution node, add the project to its children
            if (node.type === 'solution') {
                return {
                    ...node,
                    children: node.children ? [...node.children, newProject] : [newProject]
                };
            }
            // Recursively check children for solution nodes
            if (node.children) {
                return {
                    ...node,
                    children: addToNode(node.children)
                };
            }
            return node;
        });
    };

    return {
        ...solutionData,
        projects: addToNode(solutionData.projects)
    };
};

// Helper function to remove a project from the tree structure
const removeProjectFromTree = (solutionData: SolutionData, projectNodeId: string): SolutionData => {
    const removeNode = (nodes: any[]): any[] => {
        return nodes.filter(node => {
            if (node.nodeId === projectNodeId) {
                return false; // Remove this node
            }
            if (node.children) {
                node.children = removeNode(node.children);
            }
            return true;
        });
    };

    return {
        ...solutionData,
        projects: removeNode(solutionData.projects)
    };
};

// Helper function to add a file to the tree structure
const addFileToTree = (solutionData: SolutionData, file: any, parentNodeId: string): SolutionData => {
    const addFileToNode = (nodes: any[]): any[] => {
        return nodes.map(node => {
            if (node.nodeId === parentNodeId) {
                // Found the parent, add the file to its children
                return {
                    ...node,
                    children: node.children ? [...node.children, file] : [file]
                };
            }
            if (node.children) {
                return {
                    ...node,
                    children: addFileToNode(node.children)
                };
            }
            return node;
        });
    };

    return {
        ...solutionData,
        projects: addFileToNode(solutionData.projects)
    };
};

// Helper function to remove a file from the tree structure
const removeFileFromTree = (solutionData: SolutionData, fileNodeId: string): SolutionData => {
    const removeFileFromNode = (nodes: any[]): any[] => {
        return nodes.filter(node => {
            if (node.nodeId === fileNodeId) {
                return false; // Remove this file
            }
            if (node.children) {
                node.children = removeFileFromNode(node.children);
            }
            return true;
        });
    };

    return {
        ...solutionData,
        projects: removeFileFromNode(solutionData.projects)
    };
};

// Helper function to add a temporary node for creation
const addTemporaryNodeToTree = (solutionData: SolutionData, parentNodeId: NodeIdString, nodeType: string, defaultName: string): SolutionData => {
    // Extract the actual file system path from the parentNodeId using the service
    const parentNode = parseNodeId(parentNodeId);
    if (!parentNode) {
        // Invalid parent node ID
        return solutionData;
    }
    const parentPath = parentNode.folderPath || parentNode.solutionPath;
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
const removeTemporaryNodesFromParent = (solutionData: SolutionData, parentNodeId: string): SolutionData => {
    const removeTemporaryFromNode = (nodes: any[]): any[] => {
        return nodes.map(node => {
            if (node.nodeId === parentNodeId && node.children) {
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
        vscode.postMessage({ command: 'getSolutionData' });

        // Listen for messages from the extension
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case 'loading':
                    log.info('Setting refreshing state');
                    // If we already have data, show refreshing indicator instead of full loading
                    if (solutionData) {
                        setRefreshing(true);
                    } else {
                        setLoading(true);
                    }
                    break;
                case 'showLoading':
                    // Skip showing loading for quick operations
                    break;
                case 'hideLoading':
                    setLoading(false);
                    setRefreshing(false);
                    break;
                case 'solutionData':
                    console.error('Received full solution data:', message.data);
                    setSolutionData(prev => mergeTreeData(prev, message.data));
                    setLoading(false);
                    setRefreshing(false);
                    break;
                case 'frameworkChanged':
                    log.info('Framework changed to:', message.framework);
                    setSolutionData(prev => prev ? { ...prev, activeFramework: message.framework } : null);
                    break;
                case 'error':
                    log.info('Received error:', message.message);
                    setLoading(false);
                    break;
                case 'nodeRenamed':
                    log.info('Node renamed:', message);
                    setSolutionData(prev => {
                        if (!prev) return prev;
                        const nodeId = findNodeIdFromPath(prev.projects, message.oldPath);
                        if (nodeId) {
                            return updateNodeInTree(prev, nodeId, message.newName, message.newPath);
                        }
                        return prev;
                    });
                    break;
                case 'projectAdded':
                    log.info('Project added:', message);
                    setSolutionData(prev => {
                        if (!prev) return prev;
                        return addProjectToTree(prev, message.project);
                    });
                    break;
                case 'projectRemoved':
                    log.info('Project removed:', message);
                    setSolutionData(prev => {
                        if (!prev) return prev;
                        const nodeId = findNodeIdFromPath(prev.projects, message.projectPath);
                        if (nodeId) {
                            return removeProjectFromTree(prev, nodeId);
                        }
                        return prev;
                    });
                    break;
                case 'fileChanged':
                    log.info('File changed:', message);
                    // For now just log - could be used to show file modification indicators
                    // or trigger specific updates based on file type
                    break;
                case 'fileAdded':
                    log.info('File added:', message);
                    setSolutionData(prev => {
                        if (!prev) return prev;
                        const parentNodeId = findNodeIdFromPath(prev.projects, message.parentPath);
                        if (parentNodeId) {
                            return addFileToTree(prev, message.file, parentNodeId);
                        }
                        return prev;
                    });
                    break;
                case 'fileRemoved':
                    log.info('File removed:', message);
                    setSolutionData(prev => {
                        if (!prev) return prev;
                        const nodeId = findNodeIdFromPath(prev.projects, message.filePath);
                        if (nodeId) {
                            return removeFileFromTree(prev, nodeId);
                        }
                        return prev;
                    });
                    break;
                case 'updateSolution':
                    log.info('Received complete solution update:', message);
                    setSolutionData({
                        projects: message.projects || [],
                        frameworks: message.frameworks || [],
                        activeFramework: message.activeFramework
                    });
                    setLoading(false);
                    setRefreshing(false);
                    break;
                case 'addTemporaryNode':
                    log.info('Adding temporary node:', message);
                    setSolutionData(prev => {
                        if (!prev) return prev;
                        const parentNodeId = message.parentNodeId;
                        log.info('findNodeIdFromPath result for path:', message.parentNodeId, 'nodeId:', parentNodeId);
                        if (parentNodeId) {
                            return addTemporaryNodeToTree(prev, parentNodeId, message.nodeType, message.defaultName);
                        } else {
                            log.error('Could not find nodeId for parentNodeId:', message.parentNodeId);
                        }
                        return prev;
                    });
                    break;
                case 'removeTemporaryNodes':
                    log.info('Removing temporary nodes from parent:', message.parentPath);
                    setSolutionData(prev => {
                        if (!prev) return prev;
                        const parentNodeId = message.parentNodeId;
                        if (parentNodeId) {
                            return removeTemporaryNodesFromParent(prev, parentNodeId);
                        }
                        return prev;
                    });
                    break;
                case 'activeFileChanged':
                    log.info('Active file changed:', message.filePath);
                    setActiveFilePath(message.filePath);
                    break;
                default:
                    log.info('Unknown message command:', message.command);
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
        vscode.postMessage({ command: 'setFramework', framework });
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
            vscode.postMessage({
                command: 'projectAction',
                action,
                nodeId: nodeId,
                data
            });
        }
    }, []);

    const expandNode = useCallback((nodeId: NodeIdString, nodeType: string) => {
        log.info('Expanding node:', nodeId, nodeType);
        vscode.postMessage({ command: 'expandNode', nodeId: nodeId, nodeType });
    }, []);

    const collapseNode = useCallback((nodeId: NodeIdString) => {
        log.info('Collapsing node:', nodeId);
        vscode.postMessage({ command: 'collapseNode', nodeId: nodeId });
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