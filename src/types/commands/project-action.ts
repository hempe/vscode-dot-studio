import { NodeType } from "..";
import { NodeIdString } from "../nodeId";

export declare type OpenFileActionCmd = {
    readonly action: 'openFile';
    readonly nodeId: NodeIdString;
}

export declare type RevealInExplorerActionCmd = {
    readonly action: 'revealInExplorer';
    readonly nodeId: NodeIdString;
}

export declare type BuildActionCmd = {
    readonly action: 'build';
    readonly nodeId: NodeIdString;
}

export declare type RebuildActionCmd = {
    readonly action: 'rebuild';
    readonly nodeId: NodeIdString;
}

export declare type CleanActionCmd = {
    readonly action: 'clean';
    readonly nodeId: NodeIdString;
}

export declare type RestoreNugetsActionCmd = {
    readonly action: 'restoreNugets';
    readonly nodeId: NodeIdString;
}

export declare type DeleteFileActionCmd = {
    readonly action: 'deleteFile';
    readonly nodeId: NodeIdString;
}

export declare type RemoveSolutionItemActionCmd = {
    readonly action: 'removeSolutionItem';
    readonly nodeId: NodeIdString;
}

export declare type AddExistingProjectActionCmd = {
    readonly action: 'addExistingProject';
    readonly nodeId: NodeIdString;
}

export declare type AddNewProjectActionCmd = {
    readonly action: 'addNewProject';
    readonly nodeId: NodeIdString;
}

export declare type ManageNuGetPackagesActionCmd = {
    readonly action: 'manageNuGetPackages';
    readonly nodeId: NodeIdString;
}

export declare type ManageNuGetPackagesForSolutionActionCmd = {
    readonly action: 'manageNuGetPackagesForSolution';
    readonly nodeId: NodeIdString;
}

export declare type AddProjectReferenceActionCmd = {
    readonly action: 'addProjectReference';
    readonly nodeId: NodeIdString;
}

export declare type RestoreDependenciesActionCmd = {
    readonly action: 'restoreDependencies';
    readonly nodeId: NodeIdString;
}

export declare type RemoveDependencyActionCmd = {
    readonly action: 'removeDependency';
    readonly nodeId: NodeIdString;
}

export declare type RemoveProjectActionCmd = {
    readonly action: 'removeProject';
    readonly nodeId: NodeIdString;
}

export declare type DeleteProjectActionCmd = {
    readonly action: 'deleteProject';
    readonly nodeId: NodeIdString;
}

export declare type SetStartupProjectActionCmd = {
    readonly action: 'setStartupProject';
    readonly nodeId: NodeIdString;
}

export declare type PasteActionCmd = {
    readonly action: 'paste';
    readonly nodeId: NodeIdString;
}

export declare type StartRenameActionCmd = {
    readonly action: 'startRename';
    readonly nodeId: NodeIdString;
}

export declare type CollapseParentActionCmd = {
    readonly action: 'collapseParent';
    readonly nodeId: NodeIdString;
}

export declare type CancelTemporaryNodeActionCmd = {
    readonly action: 'cancelTemporaryNode';
    readonly nodeId: NodeIdString;
}

export declare type RenameActionCmd = {
    readonly action: 'rename';
    readonly nodeId: NodeIdString;
    readonly data: {
        readonly newName: string;
        readonly type?: NodeType;
        readonly oldName?: string;
    };
}

export declare type AddSolutionFolderActionCmd = {
    readonly action: 'addSolutionFolder';
    readonly nodeId: NodeIdString;
}

export declare type RemoveSolutionFolderActionCmd = {
    readonly action: 'removeSolutionFolder';
    readonly nodeId: NodeIdString;
}

export declare type AddSolutionItemActionCmd = {
    readonly action: 'addSolutionItem';
    readonly nodeId: NodeIdString;
}

export declare type AddFileActionCmd = {
    readonly action: 'addFile';
    readonly nodeId: NodeIdString;
    readonly data: {
        readonly name: string;
        readonly confirmed: boolean;
    };
}

export declare type AddFolderActionCmd = {
    readonly action: 'addFolder';
    readonly nodeId: NodeIdString;
    readonly data: {
        readonly name: string;
        readonly confirmed: boolean;
    };
}

export declare type CopyActionCmd = {
    readonly action: 'copy';
    readonly nodeId: NodeIdString;
}

export declare type CutActionCmd = {
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
