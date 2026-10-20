export interface ConfigurationManagerProject {
    path: string;
    name: string;
    /** Configurations and platforms the project file declares (<Configurations>, <Platforms>), for the dropdowns */
    configurations: string[];
    platforms: string[];
}

export interface ConfigurationManagerState {
    configurations: string[];
    platforms: string[];
    activeConfiguration: string;
    activePlatform: string;
    projects: ConfigurationManagerProject[];
    /** "projectPath|configuration|platform" -> mapping; explicit mappings only, the UI resolves defaults */
    mappings: Record<string, { configuration: string; platform: string; build: boolean }>;
}

export type ConfigurationManagerRequest =
    | { type: 'ready' }
    | { type: 'setActive'; configuration: string; platform: string }
    | { type: 'setMapping'; project: string; configuration: string; platform: string; mapping: { configuration: string; platform: string; build: boolean } }
    | { type: 'addConfiguration'; name: string; copyFrom?: string }
    | { type: 'renameConfiguration'; from: string; to: string }
    | { type: 'removeConfiguration'; name: string }
    | { type: 'addPlatform'; name: string; copyFrom?: string }
    | { type: 'renamePlatform'; from: string; to: string }
    | { type: 'removePlatform'; name: string };

export type ConfigurationManagerMessage =
    | { type: 'state'; state: ConfigurationManagerState }
    | { type: 'error'; message: string };
