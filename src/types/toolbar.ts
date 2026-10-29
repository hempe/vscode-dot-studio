/** The buttons of the Solution Explorer toolbar (the view's own row above the tree) and what the host tells it */

export const TOOLBAR_ACTIONS = [
    'debug', 'startWithoutDebugging', 'startWithHotReload', 'attachToProcess',
    'sync', 'showAllFiles', 'collapseAll', 'openSolution', 'newSolution', 'configurationManager', 'startupProfile',
] as const;
export type ToolbarAction = typeof TOOLBAR_ACTIONS[number];

/** The choices of the configuration menu: they carry the name picked, not a command */
export const TOOLBAR_CHOICES = ['setConfiguration', 'setPlatform', 'setFramework'] as const;
export type ToolbarChoice = typeof TOOLBAR_CHOICES[number];

/** The command each button runs (the same commands, key bindings and palette entries as before) */
export const TOOLBAR_COMMANDS: Readonly<Record<ToolbarAction, string>> = {
    debug: 'shinobi.solution.debug',
    startWithoutDebugging: 'shinobi.solution.startWithoutDebugging',
    startWithHotReload: 'shinobi.debug.startWithHotReload',
    attachToProcess: 'shinobi.debug.attachToProcess',
    sync: 'shinobi.solution.syncWithActiveDocument',
    showAllFiles: 'shinobi.solution.showAllFiles',
    collapseAll: 'shinobi.solution.collapseAll',
    openSolution: 'shinobi.solution.open',
    newSolution: 'shinobi.solution.new',
    configurationManager: 'shinobi.configurationManager.open',
    startupProfile: 'shinobi.solution.selectStartupProfile',
};

export interface ToolbarState {
    /** `Debug`, or `Debug | x64` with several platforms */
    readonly configuration: string;
    /** The solution's configurations and the active one (the menu's choices) */
    readonly configurations: readonly string[];
    readonly activeConfiguration: string;
    /** The platforms and the active one; the menu offers them only when there are several */
    readonly platforms: readonly string[];
    readonly activePlatform: string;
    /** The target frameworks of the startup project (the framework menu's choices; `value` is empty for Auto) */
    readonly frameworks: readonly { readonly value: string; readonly label: string; readonly checked: boolean }[];
    /** The framework or the startup profile's name, when there is one */
    readonly startup?: string;
    readonly showAllFiles: boolean;
}
