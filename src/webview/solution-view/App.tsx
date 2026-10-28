import React from 'react';
import { SolutionTree } from './components/SolutionTree';
import { Toolbar } from './components/Toolbar';
import { useVsCodeApi } from './hooks/useVsCodeApi';
import { LoadingBar } from '../shared/LoadingBar';
import { blocksVsCodeMenu } from '../shared/altKey';
import { IconThemeContext, IconThemeFonts } from './components/TreeNode/IconThemeContext';


export const App: React.FC = React.memo(() => {
    const { solutionData, loadError, toolbar, toolbarAction, toolbarChoose, loading, refreshing, markers, iconTheme, handleProjectAction, expandNode, collapseNode } = useVsCodeApi();

    // Prevent keyboard events from bubbling to VS Code's main UI
    React.useEffect(() => {
        const preventKeyboardBubbling = (e: KeyboardEvent) => {
            // Alt triggers VS Code's menus (File, Edit, etc.); AltGr/Option characters and anything typed into an input stay
            if (blocksVsCodeMenu(e)) {
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

    if (loading) {
        return (
            <div className="solution-explorer" style={{ position: 'relative', height: '100vh' }}>
                <LoadingBar visible={true} />
                <div className="loading">Loading the solution...</div>
            </div>
        );
    }

    if (!solutionData) {
        // The host asked for the data when the view opened; a failed load says why instead of "No solution found"
        return <div className="error" role="alert">{loadError ? `Could not load the solution: ${loadError}` : 'No solution found'}</div>;
    }

    return (
        <IconThemeContext.Provider value={iconTheme}>
            <div className="solution-explorer" style={{ position: 'relative' }}>
                <IconThemeFonts theme={iconTheme} />
                <LoadingBar visible={refreshing} />
                <Toolbar state={toolbar} onAction={toolbarAction} onChoose={toolbarChoose} />
                <div className="content">
                    <SolutionTree
                        projects={solutionData.projects}
                        onProjectAction={handleProjectAction}
                        onExpandNode={expandNode}
                        onCollapseNode={collapseNode}
                        markers={markers}
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
        </IconThemeContext.Provider>
    );
});