import type { NodeType } from '../types';
import type { ProjectActionCmd } from '../types/commands/project-action';

// Solution Explorer context menus. They are shown natively by VS Code through `webview/context`
// menu contributions; `npm run generate:menus` writes the matching commands, menus and keybindings
// into package.json (a unit test fails if package.json is out of date).
//
// No vscode/node imports here: this module is loaded by the generator script and the webview.

export type MenuActionType = ProjectActionCmd['action'];

export interface MenuCommand {
    readonly title: string;
    /** VS Code key binding, active while a tree node of a type whose menu contains this command has focus */
    readonly key?: string;
    readonly mac?: string;
}

export const COMMAND_PREFIX = 'shinobi.solutionExplorer.';

/** Context key holding the type of the focused tree node, empty when the tree isn't focused or a rename is in progress */
/** `contextValue` of project nodes that can be the startup project */
export const EXECUTABLE_PROJECT = 'executable';
/** `contextValue` of the startup project when it has several launch profiles */
export const STARTUP_PROJECT_WITH_PROFILES = 'startupWithProfiles';

export const FOCUSED_NODE_TYPE_CONTEXT = 'shinobi.solutionExplorer.focusedNodeType';

export const menuCommands = {
    openFile: { title: 'Open' },
    addNewProject: { title: 'Add New Project...' },
    addExistingProject: { title: 'Add Existing Project...' },
    addSolutionFolder: { title: 'Add Solution Folder' },
    addSolutionItem: { title: 'Add Solution Item...' },
    addFile: { title: 'Add File...' },
    addNewItem: { title: 'Add New Item...' },
    addFolder: { title: 'Add Folder...' },
    addProjectReference: { title: 'Add Project Reference...' },
    addAssemblyReference: { title: 'Add Assembly Reference...' },
    manageNuGetPackages: { title: 'Manage NuGet Packages...' },
    manageNuGetPackagesForSolution: { title: 'Manage NuGet Packages...' },
    restoreNugets: { title: 'Restore NuGet Packages' },
    restoreDependencies: { title: 'Restore Dependencies' },
    setStartupProject: { title: 'Set as Startup Project' },
    chooseLaunchProfile: { title: 'Set Launch Profile...' },
    addServiceReference: { title: 'Add Service Reference...' },
    updateServiceReference: { title: 'Update Service Reference' },
    removeServiceReference: { title: 'Remove Service Reference' },
    build: { title: 'Build' },
    rebuild: { title: 'Rebuild' },
    clean: { title: 'Clean' },
    copy: { title: 'Copy', key: 'ctrl+c', mac: 'cmd+c' },
    cut: { title: 'Cut', key: 'ctrl+x', mac: 'cmd+x' },
    paste: { title: 'Paste', key: 'ctrl+v', mac: 'cmd+v' },
    rename: { title: 'Rename', key: 'f2' },
    deleteFile: { title: 'Delete', key: 'delete', mac: 'cmd+backspace' },
    deleteProject: { title: 'Delete' },
    removeProject: { title: 'Remove from Solution' },
    removeSolutionFolder: { title: 'Remove', key: 'delete', mac: 'cmd+backspace' },
    removeSolutionItem: { title: 'Remove from Solution', key: 'delete', mac: 'cmd+backspace' },
    removeDependency: { title: 'Remove', key: 'delete', mac: 'cmd+backspace' },
    revealInExplorer: { title: 'Reveal in Explorer' },
} as const satisfies Partial<Record<MenuActionType, MenuCommand>>;

export type MenuCommandAction = keyof typeof menuCommands;

/** Groups of actions, rendered with separators between them */
export type Menu = readonly (readonly MenuCommandAction[])[];

/**
 * Menu per node type. A `<nodeType>.<contextValue>` key adds items for nodes of that type whose
 * `contextValue` matches (e.g. the dependency categories), on top of the plain node type menu.
 */
export const contextMenus: Readonly<Record<NodeType, Menu>> & Readonly<Partial<Record<`${NodeType}.${string}`, Menu>>> = {
    solution: [
        ['addNewProject', 'addExistingProject', 'addSolutionFolder', 'addSolutionItem'],
        ['manageNuGetPackagesForSolution'],
        ['build', 'rebuild', 'clean', 'restoreNugets'],
        ['rename'],
        ['revealInExplorer'],
    ],
    solutionFolder: [
        ['addNewProject', 'addExistingProject', 'addSolutionFolder', 'addSolutionItem'],
        ['removeSolutionFolder', 'rename'],
        ['revealInExplorer'],
    ],
    project: [
        ['openFile'],
        ['addNewItem', 'addFile', 'addFolder', 'addServiceReference'],
        ['paste'],
        [], // setStartupProject or chooseLaunchProfile, see below
        ['manageNuGetPackages'],
        ['rename', 'removeProject', 'deleteProject'],
        ['build', 'rebuild', 'clean'],
        ['revealInExplorer'],
    ],
    // Only projects that can be started and aren't already the startup project; libraries can't be.
    // The empty groups keep the item in its slot in the project menu.
    [`project.${EXECUTABLE_PROJECT}`]: [
        [], [], [],
        ['setStartupProject'],
    ],
    [`project.${STARTUP_PROJECT_WITH_PROFILES}`]: [
        [], [], [],
        ['chooseLaunchProfile'],
    ],
    'folder.connectedServices': [
        ['addServiceReference'],
    ],
    'folder.serviceReference': [
        ['updateServiceReference', 'removeServiceReference'],
    ],
    folder: [
        ['addNewItem', 'addFile', 'addFolder'],
        ['copy', 'cut', 'paste'],
        ['rename', 'deleteFile'],
        ['revealInExplorer'],
    ],
    file: [
        ['openFile'],
        ['copy', 'cut', 'paste'],
        ['rename', 'deleteFile'],
        ['revealInExplorer'],
    ],
    dependencies: [
        ['manageNuGetPackages'],
        ['addProjectReference', 'addAssemblyReference'],
        ['restoreDependencies'],
    ],
    dependency: [
        ['removeDependency'],
    ],
    dependencyCategory: [],
    'dependencyCategory.packages': [
        ['manageNuGetPackages'],
        ['restoreDependencies'],
    ],
    'dependencyCategory.projects': [
        ['addProjectReference'],
    ],
    'dependencyCategory.assemblies': [
        ['addAssemblyReference'],
    ],
    solutionItem: [
        ['openFile'],
        ['rename', 'removeSolutionItem'],
        ['revealInExplorer'],
    ],
    temporary: [],
};

/** All menus with the node type and optional context value they apply to */
function menuEntries() {
    return Object.entries(contextMenus).map(([key, menu]) => {
        const [nodeType, contextValue] = key.split('.') as [NodeType, string | undefined];
        return { nodeType, contextValue, menu: menu as Menu };
    });
}

/** Builds the package.json `contributes` entries for the context menus */
export function buildMenuContributions() {
    const webviewWhen = 'webviewId =~ /^shinobi-solution-webview/ && webviewSection == \'node\'';
    const actions = Object.keys(menuCommands) as MenuCommandAction[];
    const nodeTypesWith = (action: MenuCommandAction) => [...new Set(menuEntries()
        .filter(({ menu }) => menu.some(group => group.includes(action)))
        .map(({ nodeType }) => nodeType))];

    const commands = actions.map(action => ({
        command: COMMAND_PREFIX + action,
        title: menuCommands[action].title,
        category: '.NET',
    }));

    const webviewContext = menuEntries().flatMap(({ nodeType, contextValue, menu }) =>
        menu.flatMap((group, groupIndex) => group.map((action, index) => ({
            command: COMMAND_PREFIX + action,
            when: `${webviewWhen} && nodeType == '${nodeType}'` + (contextValue ? ` && contextValue == '${contextValue}'` : ''),
            group: `${groupIndex + 1}_group@${index + 1}`,
        })))
    );

    const commandPalette = actions.map(action => ({ command: COMMAND_PREFIX + action, when: 'false' }));

    const keybindings = actions.flatMap(action => {
        const { key, mac } = menuCommands[action] as MenuCommand;
        if (!key) {
            return [];
        }
        return [{
            command: COMMAND_PREFIX + action,
            key,
            ...(mac ? { mac } : {}),
            when: `${FOCUSED_NODE_TYPE_CONTEXT} =~ /^(${nodeTypesWith(action).join('|')})$/`,
        }];
    });

    return { commands, webviewContext, commandPalette, keybindings };
}

/** Returns a copy of package.json with the context menu contributions replaced by freshly generated ones */
export function applyMenuContributions<T extends { contributes: any }>(pkg: T): T {
    const generated = buildMenuContributions();
    const isGenerated = (entry: { command: string }) => entry.command.startsWith(COMMAND_PREFIX);
    const contributes = pkg.contributes;

    return {
        ...pkg,
        contributes: {
            ...contributes,
            commands: [...(contributes.commands ?? []).filter((c: any) => !isGenerated(c)), ...generated.commands],
            menus: {
                ...contributes.menus,
                commandPalette: [...(contributes.menus?.commandPalette ?? []).filter((c: any) => !isGenerated(c)), ...generated.commandPalette],
                'webview/context': generated.webviewContext,
            },
            keybindings: [...(contributes.keybindings ?? []).filter((c: any) => !isGenerated(c)), ...generated.keybindings],
        },
    };
}
