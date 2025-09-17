import { useEffect, useState } from 'react';
import { SolutionData } from '../types';

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

export const useVsCodeApi = () => {
    const [solutionData, setSolutionData] = useState<SolutionData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        console.log('[useVsCodeApi] Hook initialized, requesting solution data');

        // Request initial solution data
        vscode.postMessage({ command: 'getSolutionData' });

        // Listen for messages from the extension
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            console.log('[useVsCodeApi] Received message from extension:', message);

            switch (message.command) {
                case 'loading':
                    console.log('[useVsCodeApi] Setting loading state to true');
                    setLoading(true);
                    break;
                case 'solutionData':
                    console.log('[useVsCodeApi] Received solution data:', message.data);
                    setSolutionData(message.data);
                    setLoading(false);
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

    const handleProjectAction = (action: string, projectPath: string, data?: any) => {
        console.log('[useVsCodeApi] Project action requested:', { action, projectPath, data });
        vscode.postMessage({ command: 'projectAction', action, projectPath, data });
    };

    return {
        solutionData,
        loading,
        handleFrameworkChange,
        handleProjectAction
    };
};