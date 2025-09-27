import { useEffect, useState } from 'react';
import { SolutionData, ProjectActionType } from '../types';

import { logger as loggerFn } from '../utils/logger';

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

const logger = loggerFn('useVsCodeApi');
export const useVsCodeApi = () => {
    const [solutionData, setSolutionData] = useState<SolutionData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        logger.info('Hook initialized, requesting solution data');

        // Request initial solution data
        vscode.postMessage({ command: 'getSolutionData' });

        // Listen for messages from the extension
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            logger.info('Received message from extension:', message);


            switch (message.command) {
                case 'loading':
                    logger.info('Setting refreshing state');
                    // If we already have data, show refreshing indicator instead of full loading
                    if (solutionData) {
                        setRefreshing(true);
                    } else {
                        setLoading(true);
                    }
                    break;
                case 'solutionData':
                    logger.info('Received solution data:', message.data);
                    setSolutionData(message.data);
                    setLoading(false);
                    setRefreshing(false);
                    break;
                case 'solutionDataUpdate':
                    logger.info('Received solution data update (preserving tree state):', message.data);
                    // For updates triggered by file changes, we preserve tree state
                    // by updating data but not resetting component state
                    setSolutionData(message.data);
                    setRefreshing(false);
                    break;
                case 'frameworkChanged':
                    logger.info('Framework changed to:', message.framework);
                    setSolutionData(prev => prev ? { ...prev, activeFramework: message.framework } : null);
                    break;
                case 'error':
                    logger.info('Received error:', message.message);
                    setLoading(false);
                    break;
                case 'nodeRenamed':
                    logger.info('Node renamed:', message);
                    setSolutionData(prev => {
                        if (!prev) return prev;
                        return updateNodeInTree(prev, message.oldPath, message.newPath, message.newName);
                    });
                    break;
                case 'projectAdded':
                    logger.info('Project added:', message);
                    setSolutionData(prev => {
                        if (!prev) return prev;
                        return addProjectToTree(prev, message.project);
                    });
                    break;
                case 'projectRemoved':
                    logger.info('Project removed:', message);
                    setSolutionData(prev => {
                        if (!prev) return prev;
                        return removeProjectFromTree(prev, message.projectPath);
                    });
                    break;
                case 'fileChanged':
                    logger.info('File changed:', message);
                    // For now just log - could be used to show file modification indicators
                    // or trigger specific updates based on file type
                    break;
                case 'fileAdded':
                    logger.info('File added:', message);
                    setSolutionData(prev => {
                        if (!prev) return prev;
                        return addFileToTree(prev, message.file, message.parentPath);
                    });
                    break;
                case 'fileRemoved':
                    logger.info('File removed:', message);
                    setSolutionData(prev => {
                        if (!prev) return prev;
                        return removeFileFromTree(prev, message.filePath);
                    });
                    break;
                case 'updateSolution':
                    logger.info('Received complete solution update:', message);
                    setSolutionData({
                        projects: message.projects || [],
                        frameworks: message.frameworks || [],
                        activeFramework: message.activeFramework
                    });
                    setLoading(false);
                    setRefreshing(false);
                    break;
                default:
                    logger.info('Unknown message command:', message.command);
            }
        };

        window.addEventListener('message', handleMessage);
        return () => {
            logger.info('Cleaning up message listener');
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    const handleFrameworkChange = (framework: string) => {
        logger.info('Framework change requested:', framework);
        vscode.postMessage({ command: 'setFramework', framework });
    };

    const handleProjectAction = (action: ProjectActionType, projectPath: string, data?: any) => {
        logger.info('Project action requested:', { action, projectPath, data });
        vscode.postMessage({ command: 'projectAction', action, projectPath, data });
    };


    const expandNode = (nodePath: string, nodeType: string) => {
        logger.info('Expanding node:', nodePath, nodeType);
        vscode.postMessage({ command: 'expandNode', nodePath, nodeType });
    };

    const collapseNode = (nodePath: string) => {
        logger.info('Collapsing node:', nodePath);
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