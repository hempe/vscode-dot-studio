import { useEffect, useState } from 'react';
import { SolutionData } from '../types';

declare global {
    interface Window {
        acquireVsCodeApi(): any;
    }
}

const vscode = window.acquireVsCodeApi();

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