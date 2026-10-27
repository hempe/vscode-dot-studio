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

export declare type AddAssemblyReferenceActionCmd = {
    readonly action: 'addAssemblyReference';
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

export declare type AddNewItemActionCmd = {
    readonly action: 'addNewItem';
    readonly nodeId: NodeIdString;
}

export declare type AddServiceReferenceActionCmd = {
    readonly action: 'addServiceReference';
    readonly nodeId: NodeIdString;
}

export declare type UpdateServiceReferenceActionCmd = {
    readonly action: 'updateServiceReference';
    readonly nodeId: NodeIdString;
}

export declare type RemoveServiceReferenceActionCmd = {
    readonly action: 'removeServiceReference';
    readonly nodeId: NodeIdString;
}

export declare type UpdateGrpcReferenceActionCmd = {
    readonly action: 'updateGrpcReference';
    readonly nodeId: NodeIdString;
}

export declare type RemoveGrpcReferenceActionCmd = {
    readonly action: 'removeGrpcReference';
    readonly nodeId: NodeIdString;
}

export declare type ChooseLaunchProfileActionCmd = {
    readonly action: 'chooseLaunchProfile';
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

export declare type ExcludeFromProjectActionCmd = {
    readonly action: 'excludeFromProject';
    readonly nodeId: NodeIdString;
}

export declare type IncludeInProjectActionCmd = {
    readonly action: 'includeInProject';
    readonly nodeId: NodeIdString;
}

export declare type RemoveLinkActionCmd = {
    readonly action: 'removeLink';
    readonly nodeId: NodeIdString;
}

export declare type CopyActionCmd = {
    readonly action: 'copy';
    readonly nodeId: NodeIdString;
}

export declare type CutActionCmd = {
    readonly action: 'cut';
    readonly nodeId: NodeIdString;
}

export declare type EditProjectFileActionCmd = {
    readonly action: 'editProjectFile';
    readonly nodeId: NodeIdString;
}

export declare type AddExistingItemActionCmd = {
    readonly action: 'addExistingItem';
    readonly nodeId: NodeIdString;
}

export declare type StartNewInstanceActionCmd = {
    readonly action: 'startNewInstance';
    readonly nodeId: NodeIdString;
}

export declare type StartWithoutDebuggingActionCmd = {
    readonly action: 'startWithoutDebugging';
    readonly nodeId: NodeIdString;
}

export declare type StartWithHotReloadActionCmd = {
    readonly action: 'startWithHotReload';
    readonly nodeId: NodeIdString;
}

export declare type RunTestsActionCmd = {
    readonly action: 'runTests';
    readonly nodeId: NodeIdString;
}

export declare type DebugTestsActionCmd = {
    readonly action: 'debugTests';
    readonly nodeId: NodeIdString;
}

export declare type OpenInTerminalActionCmd = {
    readonly action: 'openInTerminal';
    readonly nodeId: NodeIdString;
}

export declare type CopyFullPathActionCmd = {
    readonly action: 'copyFullPath';
    readonly nodeId: NodeIdString;
}

export declare type ManageUserSecretsActionCmd = {
    readonly action: 'manageUserSecrets';
    readonly nodeId: NodeIdString;
}

export declare type OpenLaunchSettingsActionCmd = {
    readonly action: 'openLaunchSettings';
    readonly nodeId: NodeIdString;
}

export declare type PackActionCmd = {
    readonly action: 'pack';
    readonly nodeId: NodeIdString;
}

export declare type AddMigrationActionCmd = {
    readonly action: 'addMigration';
    readonly nodeId: NodeIdString;
}

export declare type UpdateDatabaseActionCmd = {
    readonly action: 'updateDatabase';
    readonly nodeId: NodeIdString;
}

export declare type RemoveMigrationActionCmd = {
    readonly action: 'removeMigration';
    readonly nodeId: NodeIdString;
}

export declare type UnloadProjectActionCmd = {
    readonly action: 'unloadProject';
    readonly nodeId: NodeIdString;
}

export declare type ReloadProjectActionCmd = {
    readonly action: 'reloadProject';
    readonly nodeId: NodeIdString;
}

export declare type PublishActionCmd = {
    readonly action: 'publish';
    readonly nodeId: NodeIdString;
}

export declare type ConfigurationManagerActionCmd = {
    readonly action: 'configurationManager';
    readonly nodeId: NodeIdString;
}

export declare type CodeCleanupActionCmd = {
    readonly action: 'codeCleanup';
    readonly nodeId: NodeIdString;
}

export declare type SyncNamespacesActionCmd = {
    readonly action: 'syncNamespaces';
    readonly nodeId: NodeIdString;
}

export declare type StartupProjectsActionCmd = {
    readonly action: 'startupProjects';
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
    | AddAssemblyReferenceActionCmd
    | RestoreDependenciesActionCmd
    | RemoveDependencyActionCmd
    | RemoveProjectActionCmd
    | DeleteProjectActionCmd
    | SetStartupProjectActionCmd
    | ChooseLaunchProfileActionCmd
    | AddServiceReferenceActionCmd
    | AddNewItemActionCmd
    | UpdateServiceReferenceActionCmd
    | RemoveServiceReferenceActionCmd
    | UpdateGrpcReferenceActionCmd
    | RemoveGrpcReferenceActionCmd
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
    | ExcludeFromProjectActionCmd
    | IncludeInProjectActionCmd
    | RemoveLinkActionCmd
    | CutActionCmd
    | EditProjectFileActionCmd
    | AddExistingItemActionCmd
    | StartNewInstanceActionCmd
    | StartWithoutDebuggingActionCmd
    | StartWithHotReloadActionCmd
    | RunTestsActionCmd
    | DebugTestsActionCmd
    | OpenInTerminalActionCmd
    | CopyFullPathActionCmd
    | ManageUserSecretsActionCmd
    | PackActionCmd
    | AddMigrationActionCmd
    | UpdateDatabaseActionCmd
    | RemoveMigrationActionCmd
    | UnloadProjectActionCmd
    | ReloadProjectActionCmd
    | OpenLaunchSettingsActionCmd
    | PublishActionCmd
    | ConfigurationManagerActionCmd
    | StartupProjectsActionCmd
    | CodeCleanupActionCmd
    | SyncNamespacesActionCmd;
