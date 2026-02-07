import { NodeType } from '../../../../types';
import { ProjectActionCmd } from '../../../../types/projectActionCmd';

export declare type ProjectActionType = ProjectActionCmd['action'];

export interface MenuAction {
    name: string;
    action: ProjectActionType;
    kind: 'action';
    shortcut?: string;
}

export interface MenuSeparator {
    kind: 'separator';
}

export type MenuItem = MenuAction | MenuSeparator;

// Define reusable actions
export const renameAction: MenuAction = {
    name: "Rename",
    action: "rename",
    kind: "action",
    shortcut: "F2"
};

export const openAction: MenuAction = {
    name: "Open",
    action: "openFile",
    kind: "action"
};

export const deleteAction: MenuAction = {
    name: "Delete",
    action: "deleteFile",
    kind: "action",
    shortcut: "Del"
};

export const revealInExplorerAction: MenuAction = {
    name: "Reveal in Explorer",
    action: "revealInExplorer",
    kind: "action"
};

export const removeFromSolutionAction: MenuAction = {
    name: "Remove from Solution",
    action: "removeProject",
    kind: "action"
};

export const removeSolutionItemAction: MenuAction = {
    name: "Remove from Solution",
    action: "removeSolutionItem",
    kind: "action",
    shortcut: "Del"
};

export const deleteProjectAction: MenuAction = {
    name: "Delete",
    action: "deleteProject",
    kind: "action"
};

export const buildAction: MenuAction = {
    name: "Build",
    action: "build",
    kind: "action"
};

export const rebuildAction: MenuAction = {
    name: "Rebuild",
    action: "rebuild",
    kind: "action"
};

export const cleanAction: MenuAction = {
    name: "Clean",
    action: "clean",
    kind: "action"
};

export const setStartupProjectAction: MenuAction = {
    name: "Set as Startup Project",
    action: "setStartupProject",
    kind: "action"
};

export const addFileAction: MenuAction = {
    name: "Add File...",
    action: "addFile",
    kind: "action"
};

export const addFolderAction: MenuAction = {
    name: "Add Folder...",
    action: "addFolder",
    kind: "action"
};

export const restoreNugetsAction: MenuAction = {
    name: "Restore NuGet Packages",
    action: "restoreNugets",
    kind: "action"
};

export const addExistingProjectAction: MenuAction = {
    name: "Add Existing Project...",
    action: "addExistingProject",
    kind: "action"
};

export const addNewProjectAction: MenuAction = {
    name: "Add New Project...",
    action: "addNewProject",
    kind: "action"
};

export const addSolutionFolderAction: MenuAction = {
    name: "Add Solution Folder",
    action: "addSolutionFolder",
    kind: "action"
};

export const removeSolutionFolderAction: MenuAction = {
    name: "Remove",
    action: "removeSolutionFolder",
    kind: "action",
    shortcut: "Del"
};

export const addSolutionItemAction: MenuAction = {
    name: "Add Solution Item...",
    action: "addSolutionItem",
    kind: "action"
};

export const manageNuGetPackagesAction: MenuAction = {
    name: "Manage NuGet Packages...",
    action: "manageNuGetPackages",
    kind: "action"
};

export const manageNuGetPackagesForSolutionAction: MenuAction = {
    name: "Manage NuGet Packages...",
    action: "manageNuGetPackagesForSolution",
    kind: "action"
};

export const addProjectReferenceAction: MenuAction = {
    name: "Add Project Reference...",
    action: "addProjectReference",
    kind: "action"
};



export const restoreDependenciesAction: MenuAction = {
    name: "Restore Dependencies",
    action: "restoreDependencies",
    kind: "action"
};

export const removeDependencyAction: MenuAction = {
    name: "Remove",
    action: "removeDependency",
    kind: "action",
    shortcut: "Del"
};

export const copyAction: MenuAction = {
    name: "Copy",
    action: "copy",
    kind: "action",
    shortcut: "Ctrl+C"
};

export const cutAction: MenuAction = {
    name: "Cut",
    action: "cut",
    kind: "action",
    shortcut: "Ctrl+X"
};

export const pasteAction: MenuAction = {
    name: "Paste",
    action: "paste",
    kind: "action",
    shortcut: "Ctrl+V"
};

export const separator: MenuSeparator = {
    kind: 'separator'
};

// Define menu configurations for each node type
export const contextMenus: Record<NodeType, MenuItem[]> = {
    solution: [
        addNewProjectAction,
        addExistingProjectAction,
        addSolutionFolderAction,
        addSolutionItemAction,
        separator,
        manageNuGetPackagesForSolutionAction,
        separator,
        buildAction,
        rebuildAction,
        cleanAction,
        restoreNugetsAction,
        separator,
        renameAction,
        separator,
        revealInExplorerAction
    ],

    solutionFolder: [
        addSolutionFolderAction,
        addSolutionItemAction,
        separator,
        removeSolutionFolderAction,
        renameAction,
        separator,
        revealInExplorerAction
    ],

    project: [
        openAction,
        separator,
        addFileAction,
        addFolderAction,
        separator,
        pasteAction,
        separator,
        setStartupProjectAction,
        separator,
        manageNuGetPackagesAction,
        separator,
        renameAction,
        removeFromSolutionAction,
        deleteProjectAction,
        separator,
        buildAction,
        rebuildAction,
        cleanAction,
        separator,
        revealInExplorerAction
    ],

    folder: [
        addFileAction,
        addFolderAction,
        separator,
        copyAction,
        cutAction,
        pasteAction,
        separator,
        renameAction,
        deleteAction,
        separator,
        revealInExplorerAction
    ],

    file: [
        openAction,
        separator,
        copyAction,
        cutAction,
        pasteAction,
        separator,
        renameAction,
        deleteAction,
        separator,
        revealInExplorerAction
    ],

    dependencies: [
        manageNuGetPackagesAction,
        separator,
        addProjectReferenceAction,
        separator,
        restoreDependenciesAction
    ],

    dependency: [
        removeDependencyAction
    ],

    dependencyCategory: [
        // Keep for backward compatibility - should not be used anymore
        manageNuGetPackagesAction,
        addProjectReferenceAction
    ],

    solutionItem: [
        openAction,
        separator,
        renameAction,
        removeSolutionItemAction,
        separator,
        revealInExplorerAction
    ],
    temporary: []
};

