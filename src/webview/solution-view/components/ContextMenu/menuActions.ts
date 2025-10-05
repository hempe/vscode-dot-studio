import { NodeType, MenuActionType } from '../../types';

export interface MenuAction {
    name: string;
    action: MenuActionType;
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
    kind: "action"
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
    kind: "action"
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
    kind: "action"
};

export const addSolutionItemAction: MenuAction = {
    name: "Add Existing Item...",
    action: "addSolutionItem",
    kind: "action"
};

export const manageNuGetPackagesAction: MenuAction = {
    name: "Manage NuGet Packages...",
    action: "manageNuGetPackages",
    kind: "action"
};

export const manageNuGetPackagesForSolutionAction: MenuAction = {
    name: "Manage NuGet Packages for Solution...",
    action: "manageNuGetPackagesForSolution",
    kind: "action"
};

export const addProjectReferenceAction: MenuAction = {
    name: "Add Project Reference...",
    action: "addProjectReference",
    kind: "action"
};

export const addAssemblyReferenceAction: MenuAction = {
    name: "Add Assembly Reference...",
    action: "addAssemblyReference",
    kind: "action"
};

export const addFrameworkReferenceAction: MenuAction = {
    name: "Add Framework Reference...",
    action: "addFrameworkReference",
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
    kind: "action"
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
        renameAction,
        deleteAction,
        separator,
        revealInExplorerAction
    ],

    file: [
        openAction,
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
        addAssemblyReferenceAction,
        addFrameworkReferenceAction,
        separator,
        restoreDependenciesAction
    ],

    dependency: [
        removeDependencyAction
    ],

    dependencyCategory: [
        // Keep for backward compatibility - should not be used anymore
    ],

    packageDependencies: [
        manageNuGetPackagesAction
    ],

    projectDependencies: [
        addProjectReferenceAction
    ],

    assemblyDependencies: [
        addAssemblyReferenceAction
    ],

    solutionItem: [
        openAction,
        separator,
        renameAction,
        removeSolutionItemAction,
        separator,
        revealInExplorerAction
    ]
};