/**
 * Extension-side type definitions
 * These use the extension's branded NodeIdString type
 */

import { NodeIdString } from '../services/nodeIdService';
import { Dependency } from "../parsers/projectFileParser";

export type NodeType = 'solution' | 'solutionFolder' | 'project' | 'folder' | 'file' | 'dependencies' | 'dependency' | 'dependencyCategory' | 'packageDependencies' | 'projectDependencies' | 'assemblyDependencies' | 'solutionItem';

export type MenuActionType = 'openFile' | 'rename' | 'deleteFile' | 'revealInExplorer' | 'removeProject' | 'deleteProject' | 'build' | 'rebuild' | 'clean' | 'restoreNugets' | 'addExistingProject' | 'addNewProject' | 'addSolutionFolder' | 'removeSolutionFolder' | 'addSolutionItem' | 'removeSolutionItem' | 'manageNuGetPackages' | 'manageNuGetPackagesForSolution' | 'addProjectReference' | 'restoreDependencies' | 'removeDependency' | 'setStartupProject' | 'addFile' | 'addFolder' | 'copy' | 'cut' | 'paste';

export type ProjectActionType = MenuActionType | 'contextMenu' | 'startRename' | 'collapseParent' | 'cancelTemporaryNode';

/**
 * Extension-side ProjectChild interface using extension's NodeIdString
 */
export interface ProjectChild {
    type: NodeType;
    name: string;
    nodeId: NodeIdString;
    hasChildren?: boolean;
    expanded?: boolean;
    children?: ProjectChild[];
    isLoaded?: boolean;
}

/**
 * Extension-side ProjectNode interface using extension's NodeIdString
 */
export interface ProjectNode {
    type: NodeType;
    name: string;
    children?: ProjectNode[];
    expanded?: boolean;
    isSolutionFolder?: boolean;
    projectDependencies?: Dependency[];
    frameworks?: string[];
    typeGuid?: string;
    guid?: string;
    isLoaded?: boolean;
    hasChildren?: boolean;
    isLoading?: boolean;
    isStartupProject?: boolean;
    nodeId: NodeIdString;
    isTemporary?: boolean;
    isEditing?: boolean;
}

export interface SolutionData {
    projects: any[];
    frameworks: string[];
    activeFramework?: string;
}