export interface ProjectNode {
    type: 'solution' | 'project' | 'folder' | 'file' | 'dependency';
    name: string;
    path: string;
    children?: ProjectNode[];
    expanded?: boolean;
}

export interface SolutionData {
    projects: any[];
    frameworks: string[];
    activeFramework?: string;
}

export interface TreeNodeProps {
    node: ProjectNode;
    level: number;
    onProjectAction: (action: string, projectPath: string, data?: any) => void;
    onToggleExpand: (path: string) => void;
    onNodeFocus: (path: string) => void;
    selectedNodePath?: string;
}

export interface SolutionTreeProps {
    projects: any[];
    onProjectAction: (action: string, projectPath: string, data?: any) => void;
}

export interface FrameworkSelectorProps {
    frameworks: string[];
    activeFramework?: string;
    onFrameworkChange: (framework: string) => void;
}