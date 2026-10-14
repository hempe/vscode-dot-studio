import type { FolderSettings } from '../services/publish/publishProfiles';

export type { FolderSettings };

/** A publish profile as the Publish tab shows it */
export interface PublishProfileView {
    readonly name: string;
    /** `Folder`, or Visual Studio's publish method of targets that come later (Phase 21) */
    readonly target: string;
    readonly settings: FolderSettings;
    /** The publish folder on disk */
    readonly publishFolder: string;
    /** ISO time of the last successful publish from this workspace */
    readonly lastPublished?: string;
}

export interface PublishInit {
    readonly projectName: string;
    readonly profiles: PublishProfileView[];
    /** The profile to show; the first when not set */
    readonly selected?: string;
    readonly configurations: string[];
    readonly frameworks: string[];
    /** Target runtimes besides "Portable" */
    readonly runtimes: string[];
    /** The runtime of this machine, picked when a profile becomes self-contained */
    readonly hostRuntime: string;
    /** Defaults for a new Folder profile */
    readonly newProfile: FolderSettings;
}

/** Webview → extension */
export type PublishRequest =
    | { readonly type: 'ready' }
    | { readonly type: 'publish'; readonly profile: string }
    | { readonly type: 'createProfile'; readonly publishDir: string }
    | { readonly type: 'saveSettings'; readonly profile: string; readonly settings: FolderSettings }
    | { readonly type: 'renameProfile'; readonly profile: string }
    | { readonly type: 'deleteProfile'; readonly profile: string }
    | { readonly type: 'openProfile'; readonly profile: string }
    | { readonly type: 'openFolder'; readonly profile: string }
    | { readonly type: 'browseFolder'; readonly current: string };

/** Extension → webview */
export type PublishMessage =
    | { readonly type: 'init'; readonly payload: PublishInit }
    | { readonly type: 'publishing'; readonly profile: string }
    | { readonly type: 'published'; readonly profile: string; readonly succeeded: boolean }
    | { readonly type: 'folderPicked'; readonly path: string }
    | { readonly type: 'error'; readonly message: string };
