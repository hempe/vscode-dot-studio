import { NodeType } from ".";
import { NodeIdString } from "./nodeId";


export interface OpenFileActionCmd {
    readonly action: 'openFile';
    readonly nodeId: NodeIdString;
}

export interface RevealInExplorerActionCmd {
    readonly action: 'revealInExplorer';
    readonly nodeId: NodeIdString;
}

export interface BuildActionCmd {
    readonly action: 'build';
    readonly nodeId: NodeIdString;
}

export interface RebuildActionCmd {
    readonly action: 'rebuild';
    readonly nodeId: NodeIdString;
}

export interface CleanActionCmd {
    readonly action: 'clean';
    readonly nodeId: NodeIdString;
}

export interface RestoreNugetsActionCmd {
    readonly action: 'restoreNugets';
    readonly nodeId: NodeIdString;
}

export interface DeleteFileActionCmd {
    readonly action: 'deleteFile';
    readonly nodeId: NodeIdString;
}

export interface RemoveSolutionItemActionCmd {
    readonly action: 'removeSolutionItem';
    readonly nodeId: NodeIdString;
}

export interface AddExistingProjectActionCmd {
    readonly action: 'addExistingProject';
    readonly nodeId: NodeIdString;
}

export interface AddNewProjectActionCmd {
    readonly action: 'addNewProject';
    readonly nodeId: NodeIdString;
}

export interface ManageNuGetPackagesActionCmd {
    readonly action: 'manageNuGetPackages';
    readonly nodeId: NodeIdString;
}

export interface ManageNuGetPackagesForSolutionActionCmd {
    readonly action: 'manageNuGetPackagesForSolution';
    readonly nodeId: NodeIdString;
}

export interface AddProjectReferenceActionCmd {
    readonly action: 'addProjectReference';
    readonly nodeId: NodeIdString;
}

export interface RestoreDependenciesActionCmd {
    readonly action: 'restoreDependencies';
    readonly nodeId: NodeIdString;
}

export interface RemoveDependencyActionCmd {
    readonly action: 'removeDependency';
    readonly nodeId: NodeIdString;
}

export interface RemoveProjectActionCmd {
    readonly action: 'removeProject';
    readonly nodeId: NodeIdString;
}

export interface DeleteProjectActionCmd {
    readonly action: 'deleteProject';
    readonly nodeId: NodeIdString;
}

export interface SetStartupProjectActionCmd {
    readonly action: 'setStartupProject';
    readonly nodeId: NodeIdString;
}

export interface PasteActionCmd {
    readonly action: 'paste';
    readonly nodeId: NodeIdString;
}

// UI-only actions (no backend processing)
export interface ContextMenuActionCmd {
    readonly action: 'contextMenu';
    readonly nodeId: NodeIdString;
}

export interface StartRenameActionCmd {
    readonly action: 'startRename';
    readonly nodeId: NodeIdString;
}

export interface CollapseParentActionCmd {
    readonly action: 'collapseParent';
    readonly nodeId: NodeIdString;
}

export interface CancelTemporaryNodeActionCmd {
    readonly action: 'cancelTemporaryNode';
    readonly nodeId: NodeIdString;
}

export interface RenameActionCmd {
    readonly action: 'rename';
    readonly nodeId: NodeIdString;
    readonly data: {
        readonly newName: string;
        readonly type?: NodeType;
        readonly oldName?: string;
    };
}

export interface AddSolutionFolderActionCmd {
    readonly action: 'addSolutionFolder';
    readonly nodeId: NodeIdString;
}

export interface RemoveSolutionFolderActionCmd {
    readonly action: 'removeSolutionFolder';
    readonly nodeId: NodeIdString;
}

export interface AddSolutionItemActionCmd {
    readonly action: 'addSolutionItem';
    readonly nodeId: NodeIdString;
}

export interface AddFileActionCmd {
    readonly action: 'addFile';
    readonly nodeId: NodeIdString;
    readonly data: {
        readonly name: string;
        readonly confirmed: boolean;
    };
}

export interface AddFolderActionCmd {
    readonly action: 'addFolder';
    readonly nodeId: NodeIdString;
    readonly data: {
        readonly name: string;
        readonly confirmed: boolean;
    };
}

export interface CopyActionCmd {
    readonly action: 'copy';
    readonly nodeId: NodeIdString;
}

export interface CutActionCmd {
    readonly action: 'cut';
    readonly nodeId: NodeIdString;
}

/**
 * Union type of all project action commands
 */
export type ProjectActionCmd =
    | OpenFileActionCmd
    | RevealInExplorerActionCmd
    | BuildActionCmd
    | RebuildActionCmd
    | CleanActionCmd
    | RestoreNugetsActionCmd
    | DeleteFileActionCmd
    | RemoveSolutionItemActionCmd
    | AddExistingProjectActionCmd
    | AddNewProjectActionCmd
    | ManageNuGetPackagesActionCmd
    | ManageNuGetPackagesForSolutionActionCmd
    | AddProjectReferenceActionCmd
    | RestoreDependenciesActionCmd
    | RemoveDependencyActionCmd
    | RemoveProjectActionCmd
    | DeleteProjectActionCmd
    | SetStartupProjectActionCmd
    | PasteActionCmd
    | ContextMenuActionCmd
    | StartRenameActionCmd
    | CollapseParentActionCmd
    | CancelTemporaryNodeActionCmd
    | RenameActionCmd
    | AddSolutionFolderActionCmd
    | RemoveSolutionFolderActionCmd
    | AddSolutionItemActionCmd
    | AddFileActionCmd
    | AddFolderActionCmd
    | CopyActionCmd
    | CutActionCmd;
