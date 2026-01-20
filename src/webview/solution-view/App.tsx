import React from 'react';
import { SolutionTree } from './components/SolutionTree';
import { useVsCodeApi } from './hooks/useVsCodeApi';
import { LoadingBar } from '../shared/LoadingBar';


export const App: React.FC = React.memo(() => {
    const { solutionData, loading, refreshing, handleProjectAction, expandNode, collapseNode } = useVsCodeApi();

    // Prevent keyboard events from bubbling to VS Code's main UI
    React.useEffect(() => {
        const preventKeyboardBubbling = (e: KeyboardEvent) => {
            // Only block specific keys that would trigger VS Code's menus
            // Alt key alone or with other keys triggers VS Code menus (File, Edit, etc.)
            if (e.altKey || e.key === 'Alt') {
                e.preventDefault();
                e.stopPropagation();
            }
        };

        // Capture keyboard events at the document level
        document.addEventListener('keydown', preventKeyboardBubbling, true);
        document.addEventListener('keyup', preventKeyboardBubbling, true);

        return () => {
            document.removeEventListener('keydown', preventKeyboardBubbling, true);
            document.removeEventListener('keyup', preventKeyboardBubbling, true);
        };
    }, []);

    // Temporarily disable to check if logging causes issues
    // log.shotgun('🔄 APP RENDERING with loading:', loading, 'refreshing:', refreshing, 'hasData:', !!solutionData);

    if (loading) {
        return (
            <div className="solution-explorer" style={{ position: 'relative', height: '100vh' }}>
                <LoadingBar visible={true} />
            </div>
        );
    }

    if (!solutionData) {
        return <div className="error">No solution found</div>;
    }

    return (
        <div className="solution-explorer" style={{ position: 'relative' }}>
            <LoadingBar visible={refreshing} />
            <div className="content">
                <SolutionTree
                    projects={solutionData.projects}
                    onProjectAction={handleProjectAction}
                    onExpandNode={expandNode}
                    onCollapseNode={collapseNode}
                />
                {refreshing && (
                    <div className="refresh-indicator" style={{
                        position: 'absolute',
                        bottom: '10px',
                        right: '10px',
                        background: 'var(--vscode-badge-background)',
                        color: 'var(--vscode-badge-foreground)',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        opacity: '0.8'
                    }}>
                        Updating solution...
                    </div>
                )}
            </div>
        </div>
    );
});