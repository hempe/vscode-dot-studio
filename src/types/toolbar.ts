/** The buttons of the Solution Explorer toolbar (the view's own row above the tree) and what the host tells it */

export const TOOLBAR_ACTIONS = [
    'configuration', 'framework', 'debug', 'startWithoutDebugging', 'sync', 'showAllFiles', 'collapseAll',
] as const;
export type ToolbarAction = typeof TOOLBAR_ACTIONS[number];

/** The command each button runs (the same commands, key bindings and palette entries as before) */
export const TOOLBAR_COMMANDS: Readonly<Record<ToolbarAction, string>> = {
    configuration: 'shinobi.solution.configurationMenu',
    framework: 'shinobi.solution.selectFramework',
    debug: 'shinobi.solution.debug',
    startWithoutDebugging: 'shinobi.solution.startWithoutDebugging',
    sync: 'shinobi.solution.syncWithActiveDocument',
    showAllFiles: 'shinobi.solution.showAllFiles',
    collapseAll: 'shinobi.solution.collapseAll',
};

export interface ToolbarState {
    /** `Debug`, or `Debug | x64` with several platforms */
    readonly configuration: string;
    /** The framework or the startup profile's name, when there is one */
    readonly startup?: string;
    readonly showAllFiles: boolean;
}
