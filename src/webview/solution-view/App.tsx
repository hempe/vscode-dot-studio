import React from 'react';
import { FrameworkSelector } from './components/FrameworkSelector/FrameworkSelector';
import { SolutionTree } from './components/SolutionTree';
import { useVsCodeApi } from './hooks/useVsCodeApi';

export const App: React.FC = () => {
    const { solutionData, loading, refreshing, handleFrameworkChange, handleProjectAction, saveExpansionState, expandNode, collapseNode } = useVsCodeApi();

    if (loading) {
        return <div className="loading">Loading solution...</div>;
    }

    if (!solutionData) {
        return <div className="error">No solution found</div>;
    }

    return (
        <div className="solution-explorer">
            <div className="header">
                <FrameworkSelector
                    frameworks={solutionData.frameworks}
                    activeFramework={solutionData.activeFramework}
                    onFrameworkChange={handleFrameworkChange}
                />
            </div>
            <div className="content">
                <SolutionTree
                    projects={solutionData.projects}
                    onProjectAction={handleProjectAction}
                    onSaveExpansionState={saveExpansionState}
                    onExpandNode={expandNode}
                    onCollapseNode={collapseNode}
                    initialExpandedNodes={solutionData.expandedNodes}
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
};