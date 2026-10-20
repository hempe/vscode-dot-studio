/** Messages of the Configure Startup Projects tab; browser-safe (no vscode, no Node imports) */

export type StartupProjectAction = 'None' | 'Start' | 'StartWithoutDebugging';

/** A project of the solution as the tab lists it. `path` is relative to the solution, forward slashes. */
export interface StartupProjectInfo {
    path: string;
    name: string;
    /** Launch profiles of its launchSettings.json that `dotnet run` can use (`commandName: "Project"`) */
    launchProfiles: string[];
    unloaded: boolean;
}

/** One row of a profile: what Visual Studio's table shows for a project */
export interface StartupRow {
    path: string;
    action: StartupProjectAction;
    /** The chosen launch profile; undefined is "(default)" */
    launchProfile?: string;
}

/** A multi-project profile; `shared` is the .slnLaunch file (source control), otherwise the user file */
export interface StartupProfileEntry {
    name: string;
    shared: boolean;
    /** In launch order, only the projects the file lists */
    projects: StartupRow[];
}

export interface StartupProjectsState {
    /** Every project of the solution, in solution order */
    projects: StartupProjectInfo[];
    /** The paths of the projects that can be started (the "Single startup project" dropdown) */
    startable: string[];
    /** The path of the single startup project (the remembered one while a profile is active) */
    singleProject?: string;
    /** The profile F5 starts; undefined while the single startup project is active */
    active?: { name: string; shared: boolean };
    profiles: StartupProfileEntry[];
    /** Readable messages for profile files that exist but cannot be read (hand-edited, merge conflict) */
    unreadable: string[];
}

export type StartupProjectsRequest =
    | { type: 'ready' }
    /** Radio "Single startup project": F5 starts the single startup project again */
    | { type: 'useSingle' }
    /** The "Single startup project" dropdown, the same as "Set as Startup Project" */
    | { type: 'setSingle'; project: string }
    /** Apply: writes the profile (replacing `original` when it exists, moving it between the files when `shared` changed) and makes it active */
    | { type: 'applyProfile'; original?: { name: string; shared: boolean }; profile: StartupProfileEntry }
    | { type: 'deleteProfile'; name: string; shared: boolean };

export type StartupProjectsMessage =
    | { type: 'state'; state: StartupProjectsState }
    | { type: 'error'; message: string };
