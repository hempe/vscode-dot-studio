/**
 * Solution file type definitions shared across .sln and .slnx handlers
 */

/**
 * Represents a parsed solution file structure
 */
export interface SolutionFile {
    formatVersion: string;
    visualStudioVersion?: string;
    minimumVisualStudioVersion?: string;
    projects: SolutionProject[];
    globalSections: GlobalSection[];
    nestedProjects: NestedProject[];
}

/**
 * Represents a project entry in a solution
 */
export interface SolutionProject {
    typeGuid: string;
    name: string;
    path: string;  // For regular projects, this is the .csproj path; for solution folders, it's the same as name
    guid: string;
    projectSections?: ProjectSection[];
    dependencies?: string[];  // Project GUIDs this project depends on
    targetFrameworks?: string[];  // Target frameworks for .NET projects
}

/**
 * Represents a project section within a project entry
 */
export interface ProjectSection {
    name: string;
    type: 'preProject' | 'postProject';
    items: Record<string, string>;
}

/**
 * Represents a global section in the solution file
 */
export interface GlobalSection {
    name: string;
    type: 'preSolution' | 'postSolution';
    items: Record<string, string>;
}

/**
 * Represents a parent-child relationship in the solution hierarchy
 */
export interface NestedProject {
    childGuid: string;
    parentGuid: string;
}

/**
 * Well-known project type GUIDs used in Visual Studio solutions
 */
export const PROJECT_TYPE_GUIDS = {
    SOLUTION_FOLDER: '{2150E333-8FDC-42A3-9474-1A3956D46DE8}',
    CSHARP_PROJECT: '{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}',
    VB_PROJECT: '{F184B08F-C81C-45F6-A57F-5ABD9991F28F}',
    FSHARP_PROJECT: '{F2A71F9B-5D33-465A-A702-920D77279786}',
    CPP_PROJECT: '{8BC9CEB8-8B4A-11D0-8D11-00A0C91BC942}',
    WEB_PROJECT: '{E24C65DC-7377-472B-9ABA-BC803B73C61A}',
    DATABASE_PROJECT: '{00D1A9C2-B5F0-4AF3-8072-F6C62B433612}'
} as const;
