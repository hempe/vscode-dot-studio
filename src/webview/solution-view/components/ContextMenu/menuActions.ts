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
        separator,
        removeSolutionFolderAction,
        renameAction,
        separator,
        revealInExplorerAction
    ],

    project: [
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
        // Dependencies node has no menu items
    ],

    dependency: [
        // Individual dependency items have no menu items
    ]
};