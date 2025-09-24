import { useEffect, useState } from 'react';
import { SolutionData, ProjectActionType } from '../types';

declare global {
    interface Window {
        acquireVsCodeApi(): any;
    }
}

const vscode = window.acquireVsCodeApi();

// Helper function to update a node in the tree structure
const updateNodeInTree = (solutionData: SolutionData, oldPath: string, newPath: string, newName: string): SolutionData => {
    const updateNode = (node: any): any => {
        if (node.path === oldPath) {
            // This is the node we want to update
            return {
                ...node,
                name: newName,
                path: newPath
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
const removeProjectFromTree = (solutionData: SolutionData, projectPath: string): SolutionData => {
    const removeNode = (nodes: any[]): any[] => {
        return nodes.filter(node => {
            if (node.path === projectPath) {
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
const addFileToTree = (solutionData: SolutionData, file: any, parentPath: string): SolutionData => {
    const addFileToNode = (nodes: any[]): any[] => {
        return nodes.map(node => {
            if (node.path === parentPath) {
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
const removeFileFromTree = (solutionData: SolutionData, filePath: string): SolutionData => {
    const removeFileFromNode = (nodes: any[]): any[] => {
        return nodes.filter(node => {
            if (node.path === filePath) {
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


export const useVsCodeApi = () => {
    const [solutionData, setSolutionData] = useState<SolutionData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        console.log('[useVsCodeApi] Hook initialized, requesting solution data');

        // Request initial solution data
        vscode.postMessage({ command: 'getSolutionData' });

        // Listen for messages from the extension
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            console.log('[useVsCodeApi] Received message from extension:', message);

            // DEBUG: Track all solution data updates with stack trace
            if (message.command === 'solutionData' || message.command === 'updateSolution' || message.command === 'solutionDataUpdate') {
                const timestamp = new Date().toISOString();
                console.log(`[useVsCodeApi] SOLUTION UPDATE at ${timestamp}:`, message.command);
            }

            switch (message.command) {
                case 'loading':
                    console.log('[useVsCodeApi] Setting refreshing state');
                    // If we already have data, show refreshing indicator instead of full loading
                    if (solutionData) {
                        setRefreshing(true);
                    } else {
                        setLoading(true);
                    }
                    break;
                case 'solutionData':
                    console.log('[useVsCodeApi] Received solution data:', message.data);
                    // Debug: Log expansion states received from backend
                    const logInitialExpansion = (nodes: any[], prefix = '') => {
                        for (const node of nodes) {
                            if (node.expanded) {
                                console.log(`[useVsCodeApi] ${prefix}Initial expanded: ${node.name} (${node.path})`);
                            }
                            if (node.children) {
                                logInitialExpansion(node.children, prefix + '  ');
                            }
                        }
                    };
                    console.log('[useVsCodeApi] Initial expansion states received from backend:');
                    logInitialExpansion(message.data?.projects || []);

                    setSolutionData(message.data);
                    setLoading(false);
                    setRefreshing(false);
                    break;
                case 'solutionDataUpdate':
                    console.log('[useVsCodeApi] Received solution data update (preserving tree state):', message.data);
                    // For updates triggered by file changes, we preserve tree state
                    // by updating data but not resetting component state
                    setSolutionData(message.data);
                    setRefreshing(false);
                    break;
                case 'frameworkChanged':
                    console.log('[useVsCodeApi] Framework changed to:', message.framework);
                    setSolutionData(prev => prev ? { ...prev, activeFramework: message.framework } : null);
                    break;
                case 'error':
                    console.log('[useVsCodeApi] Received error:', message.message);
                    setLoading(false);
                    break;
                case 'nodeRenamed':
                    console.log('[useVsCodeApi] Node renamed:', message);
                    setSolutionData(prev => {
                        if (!prev) return prev;
                        return updateNodeInTree(prev, message.oldPath, message.newPath, message.newName);
                    });
                    break;
                case 'projectAdded':
                    console.log('[useVsCodeApi] Project added:', message);
                    setSolutionData(prev => {
                        if (!prev) return prev;
                        return addProjectToTree(prev, message.project);
                    });
                    break;
                case 'projectRemoved':
                    console.log('[useVsCodeApi] Project removed:', message);
                    setSolutionData(prev => {
                        if (!prev) return prev;
                        return removeProjectFromTree(prev, message.projectPath);
                    });
                    break;
                case 'fileChanged':
                    console.log('[useVsCodeApi] File changed:', message);
                    // For now just log - could be used to show file modification indicators
                    // or trigger specific updates based on file type
                    break;
                case 'fileAdded':
                    console.log('[useVsCodeApi] File added:', message);
                    setSolutionData(prev => {
                        if (!prev) return prev;
                        return addFileToTree(prev, message.file, message.parentPath);
                    });
                    break;
                case 'fileRemoved':
                    console.log('[useVsCodeApi] File removed:', message);
                    setSolutionData(prev => {
                        if (!prev) return prev;
                        return removeFileFromTree(prev, message.filePath);
                    });
                    break;
                case 'updateSolution':
                    console.log('[useVsCodeApi] Received complete solution update:', message);
                    // Debug: Log expansion states received from backend
                    const logReceivedExpansion = (nodes: any[], prefix = '') => {
                        for (const node of nodes) {
                            if (node.expanded) {
                                console.log(`[useVsCodeApi] ${prefix}Received expanded: ${node.name} (${node.path})`);
                            }
                            if (node.children) {
                                logReceivedExpansion(node.children, prefix + '  ');
                            }
                        }
                    };
                    console.log('[useVsCodeApi] Expansion states received from backend:');
                    logReceivedExpansion(message.projects || []);

                    setSolutionData({
                        projects: message.projects || [],
                        frameworks: message.frameworks || [],
                        activeFramework: message.activeFramework
                    });
                    setLoading(false);
                    setRefreshing(false);
                    break;
                default:
                    console.log('[useVsCodeApi] Unknown message command:', message.command);
            }
        };

        window.addEventListener('message', handleMessage);
        return () => {
            console.log('[useVsCodeApi] Cleaning up message listener');
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    const handleFrameworkChange = (framework: string) => {
        console.log('[useVsCodeApi] Framework change requested:', framework);
        vscode.postMessage({ command: 'setFramework', framework });
    };

    const handleProjectAction = (action: ProjectActionType, projectPath: string, data?: any) => {
        console.log('[useVsCodeApi] Project action requested:', { action, projectPath, data });
        vscode.postMessage({ command: 'projectAction', action, projectPath, data });
    };


    const expandNode = (nodePath: string, nodeType: string) => {
        console.log('[useVsCodeApi] Expanding node:', nodePath, nodeType);
        vscode.postMessage({ command: 'expandNode', nodePath, nodeType });
    };

    const collapseNode = (nodePath: string) => {
        console.log('[useVsCodeApi] Collapsing node:', nodePath);
        vscode.postMessage({ command: 'collapseNode', nodePath });
    };

    return {
        solutionData,
        loading,
        refreshing,
        handleFrameworkChange,
        handleProjectAction,
        expandNode,
        collapseNode
    };
};