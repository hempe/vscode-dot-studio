import React from 'react';
import { FrameworkSelector } from './components/FrameworkSelector/FrameworkSelector';
import { SolutionTree } from './components/SolutionTree';
import { useVsCodeApi } from './hooks/useVsCodeApi';

export const App: React.FC = () => {
    const { solutionData, loading, handleFrameworkChange, handleProjectAction } = useVsCodeApi();

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
                />
            </div>
        </div>
    );
};