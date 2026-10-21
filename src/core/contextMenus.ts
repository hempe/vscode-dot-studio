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
    /** What the command does, for the menu reference (docs/context-menus.md) */
    readonly description: string;
    /** VS Code key binding, active while a tree node of a type whose menu contains this command has focus */
    readonly key?: string;
    readonly mac?: string;
}

export const COMMAND_PREFIX = 'shinobi.solutionExplorer.';

/** Context key holding the type of the focused tree node, empty when the tree isn't focused or a rename is in progress */
/** `contextValue` of project nodes that can be the startup project */
export const EXECUTABLE_PROJECT = 'executable';
/** `contextValue` of the startup project */
export const STARTUP_PROJECT = 'startup';
/** `contextValue` of the startup project when it has several launch profiles */
export const STARTUP_PROJECT_WITH_PROFILES = 'startupWithProfiles';
/** `contextValue` of class libraries, which can be packed into a NuGet package */
export const LIBRARY_PROJECT = 'library';
/** `contextValue` of projects the user unloaded: their menu has no build, add or run items */
export const UNLOADED_PROJECT = 'unloaded';
/** `contextValue` of files and folders the project contains (SDK-style projects): they can be excluded */
export const INCLUDED_ITEM = 'included';
/** `contextValue` of files and folders on disk the project does not contain (shown with Show All Files): they can be included */
export const EXCLUDED_ITEM = 'excluded';
/** Key of tree rows in test projects (the project and everything in it), set in their `data-vscode-context` */
export const IN_TEST_PROJECT = 'inTestProject';

export const FOCUSED_NODE_TYPE_CONTEXT = 'shinobi.solutionExplorer.focusedNodeType';

export const menuCommands = {
    openFile: { title: 'Open', description: 'Opens the file in the editor. Generated files open read-only.' },
    unloadProject: { title: 'Unload Project', description: 'Leaves the project out of solution builds and shows it greyed out and collapsed in the tree; Reload Project undoes it. Remembered for this workspace.' },
    reloadProject: { title: 'Reload Project', description: 'Takes the unloaded project back into solution builds and shows its files again.' },
    editProjectFile: { title: 'Edit Project File', description: 'Opens the project file (`.csproj`) in the editor, like double-clicking the project.' },
    addNewProject: { title: 'Add New Project...', description: 'Opens the Add New Project wizard; the new project goes into the solution or into this solution folder.' },
    addExistingProject: { title: 'Add Existing Project...', description: 'Adds a project file from disk to the solution or to this solution folder.' },
    addSolutionFolder: { title: 'Add Solution Folder', description: 'Adds a solution folder (a virtual folder in the solution file, not on disk).' },
    addSolutionItem: { title: 'Add Solution Item...', description: 'Adds a file to the solution as a solution item (on the solution: into the "Solution Items" folder). A project file is added as a project.' },
    addFile: { title: 'Add File...', description: 'Creates an empty file; type its name in the tree.' },
    addNewItem: { title: 'Add New Item...', description: "Opens the Add New Item wizard: C# types with the folder's namespace, or any `dotnet new` item template." },
    addExistingItem: { title: 'Add Existing Item...', description: 'Copies files from anywhere into the project or folder; asks before replacing a file with the same name.' },
    addFolder: { title: 'Add Folder...', description: 'Creates a folder; type its name in the tree.' },
    addProjectReference: { title: 'Add Project Reference...', description: 'Adds a reference to another project of the solution.' },
    addAssemblyReference: { title: 'Add Assembly Reference...', description: 'Adds a reference to a `.dll` file (with its hint path).' },
    manageNuGetPackages: { title: 'Manage NuGet Packages...', description: 'Opens the NuGet Package Manager for the project.' },
    manageUserSecrets: { title: 'Manage User Secrets', description: "Opens the project's `secrets.json` in your user profile (outside the repository); adds a `UserSecretsId` to the project first if it has none." },
    manageNuGetPackagesForSolution: { title: 'Manage NuGet Packages...', description: 'Opens the NuGet Package Manager for all projects of the solution, with Consolidate.' },
    restoreNugets: { title: 'Restore NuGet Packages', description: 'Restores the NuGet packages of the solution (`dotnet restore`).' },
    restoreDependencies: { title: 'Restore Dependencies', description: 'Restores the NuGet packages of the project (`dotnet restore`).' },
    setStartupProject: { title: 'Set as Startup Project', description: 'Makes the project the one F5 and Ctrl+F5 start; asks for the launch profile if it has several. Writes the `Startup` configuration to `.vscode/launch.json`.' },
    chooseLaunchProfile: { title: 'Set Launch Profile...', description: 'Picks another launch profile (`Properties/launchSettings.json`) of the startup project.' },
    openLaunchSettings: { title: 'Open Launch Settings', description: "Opens the project's `Properties/launchSettings.json` (URLs, environment variables, command line arguments of its launch profiles); creates it with the default profiles first if it has none." },
    addServiceReference: { title: 'Add Service Reference...', description: 'Adds a WCF/SOAP service reference from a WSDL URL or file, generated with `dotnet-svcutil` into `Connected Services/<Name>/`.' },
    updateServiceReference: { title: 'Update Service Reference', description: "Regenerates the service reference from its WSDL, for the project's current target framework." },
    removeServiceReference: { title: 'Remove Service Reference', description: 'Removes the service reference: deletes its folder after asking; the WCF packages stay.' },
    startNewInstance: { title: 'Start New Instance', description: 'Builds the project and starts it in the debugger next to whatever already runs, without making it the startup project.' },
    startWithoutDebugging: { title: 'Start Without Debugging', description: 'Builds the project and runs it without the debugger, without making it the startup project.' },
    startWithHotReload: { title: 'Start with Hot Reload', description: 'Runs the project with `dotnet watch` in a terminal named `<project> (watch)`, without the debugger: saved code changes are applied to the running app, changes it cannot apply restart it. Starting it again restarts it; closing the terminal stops it.' },
    runTests: { title: 'Run Tests', description: 'Builds and runs the tests in the solution, project, folder or file; results appear in the Test Explorer.' },
    debugTests: { title: 'Debug Tests', description: 'Like Run Tests, with the debugger attached: breakpoints in tests and tested code are hit.' },
    build: { title: 'Build', description: 'Builds the solution or project as a task (`dotnet build`); errors go to the Error List.' },
    rebuild: { title: 'Rebuild', description: 'Builds everything again, ignoring what is up to date (`dotnet build --no-incremental`).' },
    clean: { title: 'Clean', description: 'Deletes the build output (`dotnet clean`).' },
    pack: { title: 'Pack', description: "Builds the project's NuGet package (`dotnet pack`) in the active configuration, with the package metadata of the project file (`PackageId`, `Version`, `Authors`, ...), and tells where the `.nupkg` went." },
    publish: { title: 'Publish...', description: 'Opens the Publish tab of the project: publish profiles, settings and the Publish button.' },
    configurationManager: { title: 'Configuration Manager...', description: 'Opens the Configuration Manager tab: solution configurations and platforms, and which configuration, platform and Build setting each project uses.' },
    codeCleanup: { title: 'Code Cleanup', description: "Runs Code Cleanup on the solution, project, folder or C# file: formatting, unused usings and the `.editorconfig` code style fixes (`dotnet format`), with progress and Cancel. See the `shinobi.codeCleanup.severity` setting." },
    syncNamespaces: { title: 'Sync Namespaces', description: "Changes the namespaces of the C# files of the project or folder to match the project's root namespace and the folders (the language server's \"Change namespace\" action, which also updates references in other files); needs the C# extension and IDE0130 reporting in `.editorconfig`. Asks first, with progress and Cancel." },
    startupProjects: { title: 'Configure Startup Projects...', description: 'Opens the Configure Startup Projects tab: the single startup project, or a profile that starts several projects (with the action, launch profile and order of each) and is shared with Visual Studio through the `.slnLaunch` file.' },
    copy: { title: 'Copy', description: 'Copies the file or folder; Paste puts a copy into another folder.', key: 'ctrl+c', mac: 'cmd+c' },
    cut: { title: 'Cut', description: 'Marks the file or folder to move; Paste moves it and updates the namespaces of moved C# files.', key: 'ctrl+x', mac: 'cmd+x' },
    paste: { title: 'Paste', description: 'Pastes the copied or cut file or folder into this folder or project.', key: 'ctrl+v', mac: 'cmd+v' },
    rename: { title: 'Rename', description: 'Renames inline in the tree. Renaming a C# file offers to rename the type of the same name; nested files (Designer, code-behind) are renamed with their parent.', key: 'f2' },
    deleteFile: { title: 'Delete', description: 'Moves the file or folder to the trash, after asking.', key: 'delete', mac: 'cmd+backspace' },
    deleteProject: { title: 'Delete', description: 'Removes the project from the solution and moves its folder to the trash, after asking.' },
    removeProject: { title: 'Remove from Solution', description: 'Removes the project from the solution; its files stay on disk.' },
    removeSolutionFolder: { title: 'Remove', description: 'Removes the solution folder from the solution, with the projects and folders in it; files on disk stay.', key: 'delete', mac: 'cmd+backspace' },
    removeSolutionItem: { title: 'Remove from Solution', description: 'Removes the file from the solution; it stays on disk.', key: 'delete', mac: 'cmd+backspace' },
    removeDependency: { title: 'Remove', description: 'Removes the package, project or assembly reference from the project file, after asking.', key: 'delete', mac: 'cmd+backspace' },
    revealInExplorer: { title: 'Reveal in Explorer', description: "Shows the file or folder in your operating system's file manager." },
    openInTerminal: { title: 'Open in Terminal', description: 'Opens a terminal in the folder of the solution, project or folder.' },
    copyFullPath: { title: 'Copy Full Path', description: 'Copies the full path of the item to the clipboard.' },
} as const satisfies Partial<Record<MenuActionType, MenuCommand>>;

export type MenuCommandAction = keyof typeof menuCommands;

/** Submenus of the context menus, e.g. Visual Studio's "Debug >" on projects */
export const submenus = {
    debug: { label: 'Debug', description: "Visual Studio's Debug submenu of projects that can be started.", items: ['startNewInstance', 'startWithoutDebugging', 'startWithHotReload'] },
} as const satisfies Record<string, { readonly label: string; readonly description: string; readonly items: readonly MenuCommandAction[] }>;

export type SubmenuId = keyof typeof submenus;

/** Groups of actions and submenus, rendered with separators between them */
export type Menu = readonly (readonly (MenuCommandAction | SubmenuId)[])[];

const isSubmenu = (item: MenuCommandAction | SubmenuId): item is SubmenuId => item in submenus;

/**
 * Menu per node type. A `<nodeType>.<contextValue>` key adds items for nodes of that type whose
 * `contextValue` matches (e.g. the dependency categories), on top of the plain node type menu.
 */
export const contextMenus: Readonly<Record<NodeType, Menu>> & Readonly<Partial<Record<`${NodeType}.${string}`, Menu>>> = {
    solution: [
        ['addNewProject', 'addExistingProject', 'addSolutionFolder', 'addSolutionItem'],
        ['manageNuGetPackagesForSolution'],
        ['build', 'rebuild', 'clean', 'restoreNugets', 'configurationManager', 'startupProjects'],
        ['codeCleanup'],
        ['runTests', 'debugTests'],
        ['rename'],
        ['copyFullPath', 'revealInExplorer', 'openInTerminal'],
    ],
    // Solution folders are virtual (only in the solution file), so nothing on disk to reveal
    solutionFolder: [
        ['addNewProject', 'addExistingProject', 'addSolutionFolder', 'addSolutionItem'],
        ['removeSolutionFolder', 'rename'],
    ],
    project: [
        ['editProjectFile', 'unloadProject'],
        ['addNewItem', 'addExistingItem', 'addFile', 'addFolder', 'addServiceReference'],
        ['paste'],
        [], // setStartupProject or chooseLaunchProfile, openLaunchSettings and the Debug submenu, see below
        ['manageNuGetPackages', 'manageUserSecrets'],
        ['rename', 'removeProject', 'deleteProject'],
        ['build', 'rebuild', 'clean', 'publish'],
        [], // pack in libraries
        [], // runTests, debugTests in test projects
        ['codeCleanup', 'syncNamespaces'],
        ['copyFullPath', 'revealInExplorer', 'openInTerminal'],
    ],
    // Only projects that can be started; libraries and test projects can't be.
    // The empty groups keep the items in their slot in the project menu.
    [`project.${EXECUTABLE_PROJECT}`]: [
        [], [], [],
        ['setStartupProject', 'openLaunchSettings', 'debug'],
    ],
    [`project.${STARTUP_PROJECT}`]: [
        [], [], [],
        ['openLaunchSettings', 'debug'],
    ],
    [`project.${STARTUP_PROJECT_WITH_PROFILES}`]: [
        [], [], [],
        ['chooseLaunchProfile', 'openLaunchSettings', 'debug'],
    ],
    // Libraries can be packed; the empty groups keep the item in its slot in the project menu
    [`project.${LIBRARY_PROJECT}`]: [
        [], [], [], [], [], [], [],
        ['pack'],
    ],
    // Only what works without loading the project
    [`project.${UNLOADED_PROJECT}`]: [
        ['reloadProject', 'editProjectFile'],
        ['removeProject', 'deleteProject'],
        ['copyFullPath', 'revealInExplorer', 'openInTerminal'],
    ],
    'folder.connectedServices': [
        ['addServiceReference'],
    ],
    'folder.serviceReference': [
        ['updateServiceReference', 'removeServiceReference'],
    ],
    folder: [
        ['addNewItem', 'addExistingItem', 'addFile', 'addFolder'],
        ['copy', 'cut', 'paste'],
        ['rename', 'deleteFile'],
        [], // runTests, debugTests in test projects
        ['codeCleanup', 'syncNamespaces'],
        ['copyFullPath', 'revealInExplorer', 'openInTerminal'],
    ],
    // The menu can't tell C# files from others: Code Cleanup says so for the others
    file: [
        ['openFile'],
        ['copy', 'cut', 'paste'],
        ['rename', 'deleteFile'],
        [], // runTests, debugTests in test projects
        ['codeCleanup'],
        ['copyFullPath', 'revealInExplorer'],
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
        ['copyFullPath', 'revealInExplorer'],
    ],
    analyzer: [],
    // Packages a package depends on can't be removed, only the package that brings them in
    transitivePackage: [],
    sourceGenerator: [],
    // Opens read-only: the next build overwrites it
    generatedFile: [
        ['openFile'],
        ['copyFullPath'],
    ],
    temporary: [],
};

/** Items added to the menus of rows in test projects (the project, its folders and files), in the empty slots above */
export const testProjectMenus: Readonly<Partial<Record<NodeType, Menu>>> = {
    project: [[], [], [], [], [], [], [], [], ['runTests', 'debugTests']],
    folder: [[], [], [], ['runTests', 'debugTests']],
    file: [[], [], [], ['runTests', 'debugTests']],
};

/** Names of the node types in the menu reference, in the order of the tree; `temporary` nodes have no menu */
const nodeTypeNames: Readonly<Partial<Record<NodeType, string>>> = {
    solution: 'Solution',
    solutionFolder: 'Solution folder',
    solutionItem: 'Solution item',
    project: 'Project',
    folder: 'Folder',
    file: 'File',
    dependencies: 'Dependencies',
    dependencyCategory: 'Analyzers, Packages, Projects, Assemblies (under Dependencies)',
    dependency: 'Package, project or assembly reference',
    transitivePackage: 'Package a package depends on',
    analyzer: 'Analyzer',
    sourceGenerator: 'Source generator',
    generatedFile: 'Generated file',
};

/** When the extra items of a `<nodeType>.<contextValue>` menu (and of test project menus) show, for the menu reference */
const conditionNames: Readonly<Record<string, string>> = {
    [`project.${EXECUTABLE_PROJECT}`]: 'On projects that can be started',
    [`project.${LIBRARY_PROJECT}`]: 'On class libraries',
    [`project.${UNLOADED_PROJECT}`]: 'On an unloaded project (instead of the menu above)',
    [`project.${STARTUP_PROJECT}`]: 'On the startup project',
    [`project.${STARTUP_PROJECT_WITH_PROFILES}`]: 'On the startup project, when it has several launch profiles',
    'folder.connectedServices': 'On the Connected Services folder',
    'folder.serviceReference': 'On a service reference (a folder in Connected Services)',
    'dependencyCategory.packages': 'On Packages',
    'dependencyCategory.projects': 'On Projects',
    'dependencyCategory.assemblies': 'On Assemblies',
    test: 'In test projects',
};

const keyName = (key: string) => key.split('+').map(part =>
    ({ ctrl: 'Ctrl', cmd: 'Cmd', shift: 'Shift', alt: 'Alt', delete: 'Delete', backspace: 'Backspace' } as Record<string, string>)[part]
    ?? part.toUpperCase()).join('+');

/** docs/context-menus.md: every Solution Explorer context menu, written by `npm run generate:menus` */
export function buildMenuReference(): string {
    const rows = (menu: Menu): [string, MenuCommand][] => menu.flat().flatMap((item): [string, MenuCommand][] => isSubmenu(item)
        ? submenus[item].items.map((action): [string, MenuCommand] => [`${submenus[item].label} > ${menuCommands[action].title}`, menuCommands[action]])
        : [[menuCommands[item].title, menuCommands[item]]]);
    const table = (menu: Menu) => [
        '| Command | Key | What it does |',
        '|---|---|---|',
        ...rows(menu).map(([title, command]) => {
            const key = command.key ? keyName(command.key) + (command.mac && command.mac !== command.key ? ` (macOS: ${keyName(command.mac)})` : '') : '';
            return `| ${title} | ${key} | ${command.description} |`;
        }),
    ].join('\n');

    const sections = (Object.keys(nodeTypeNames) as NodeType[]).map(nodeType => {
        const variants = Object.entries(contextMenus)
            .filter(([key]) => key.startsWith(`${nodeType}.`))
            .map(([key, menu]) => [key, menu as Menu] as const);
        const testMenu = testProjectMenus[nodeType];
        const extra = [...variants, ...(testMenu ? [['test', testMenu] as const] : [])]
            .filter(([, menu]) => menu.flat().length > 0)
            .map(([key, menu]) => {
                if (!conditionNames[key]) {
                    throw new Error(`No name for the menu condition ${key}`);
                }
                return `**${conditionNames[key]}**\n\n${table(menu)}`;
            });
        const base = contextMenus[nodeType];
        const parts = [
            base.flat().length > 0 ? table(base) : extra.length > 0 ? '' : 'No context menu.',
            ...extra,
        ].filter(Boolean);
        return `## ${nodeTypeNames[nodeType]}\n\n${parts.join('\n\n')}\n`;
    });

    return [
        '<!-- Generated from src/core/contextMenus.ts by `npm run generate:menus`; edit the descriptions there. -->',
        '# Solution Explorer Context Menus',
        '',
        'What each right-click menu of the Solution Explorer offers, by node. Keys work while the node has focus in the tree. With several nodes selected, Delete, Remove, Copy, Cut, Build, Rebuild and Clean act on all of them.',
        '',
        ...sections,
    ].join('\n');
}

type WebviewContextEntry = { command?: string; submenu?: string; when: string; group: string };

/** Merges the entries of one submenu on one node type into a single entry with a context value regex */
function mergeSubmenuEntries(entries: WebviewContextEntry[]): WebviewContextEntry[] {
    const merged: WebviewContextEntry[] = [];
    const bySubmenu = new Map<string, { entry: WebviewContextEntry; base: string; values: string[] }>();
    for (const entry of entries) {
        const match = entry.submenu ? /^(.*) && contextValue == '([^']+)'$/.exec(entry.when) : null;
        if (!match) {
            merged.push(entry);
            continue;
        }
        const [, base, value] = match;
        const key = `${entry.submenu}|${base}`;
        const existing = bySubmenu.get(key);
        if (existing) {
            existing.values.push(value);
            existing.entry.when = `${base} && contextValue =~ /^(${existing.values.join('|')})$/`;
        } else {
            const first = { ...entry };
            bySubmenu.set(key, { entry: first, base, values: [value] });
            merged.push(first);
        }
    }
    return merged;
}

/** The node types whose menus (including the conditional ones) offer the command */
export function nodeTypesWithAction(action: MenuCommandAction): NodeType[] {
    return [...new Set(menuEntries()
        .filter(({ menu }) => menu.some(group => group.includes(action)))
        .map(({ nodeType }) => nodeType))];
}

/** All menus with the node type and the condition they apply to (context value or being in a test project) */
function menuEntries() {
    return [
        ...Object.entries(contextMenus).map(([key, menu]) => {
            const [nodeType, contextValue] = key.split('.') as [NodeType, string | undefined];
            // The plain project menu is replaced by the unloaded project one
            const condition = contextValue ? ` && contextValue == '${contextValue}'`
                : nodeType === 'project' ? ` && contextValue != '${UNLOADED_PROJECT}'` : '';
            return { nodeType, condition, menu: menu as Menu };
        }),
        ...Object.entries(testProjectMenus).map(([nodeType, menu]) =>
            ({ nodeType: nodeType as NodeType, condition: ` && ${IN_TEST_PROJECT}`, menu: menu as Menu })),
    ];
}

/** Builds the package.json `contributes` entries for the context menus */
export function buildMenuContributions() {
    const webviewWhen = 'webviewId =~ /^shinobi-solution-webview/ && webviewSection == \'node\'';
    const actions = Object.keys(menuCommands) as MenuCommandAction[];
    const nodeTypesWith = nodeTypesWithAction;
    const submenuId = (id: SubmenuId) => COMMAND_PREFIX + id;

    const commands = actions.map(action => ({
        command: COMMAND_PREFIX + action,
        title: menuCommands[action].title,
        category: '.NET',
    }));

    // Group names sort as text: two digits keep group 10 after group 9 (the project menu has more than nine)
    const webviewContext = menuEntries().flatMap(({ nodeType, condition, menu }) =>
        menu.flatMap((group, groupIndex) => group.map((item, index): { command?: string; submenu?: string; when: string; group: string } => ({
            ...(isSubmenu(item) ? { submenu: submenuId(item) } : { command: COMMAND_PREFIX + item }),
            when: `${webviewWhen} && nodeType == '${nodeType}'${condition}`,
            group: `${String(groupIndex + 1).padStart(2, '0')}_group@${index + 1}`,
        })))
    );

    // VS Code drops a submenu contributed to the same menu twice: one entry per node type and submenu,
    // shown for all the context values it appears under
    const webviewContextEntries = mergeSubmenuEntries(webviewContext);

    const submenuIds = Object.keys(submenus) as SubmenuId[];
    const generatedSubmenus = submenuIds.map(id => ({ id: submenuId(id), label: submenus[id].label }));
    const submenuItems = Object.fromEntries(submenuIds.map(id => [
        submenuId(id),
        submenus[id].items.map((action, index) => ({ command: COMMAND_PREFIX + action, group: `01_group@${index + 1}` })),
    ]));

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

    return { commands, webviewContext: webviewContextEntries, submenus: generatedSubmenus, submenuItems, commandPalette, keybindings };
}

/** Returns a copy of package.json with the context menu contributions replaced by freshly generated ones */
export function applyMenuContributions<T extends { contributes: any }>(pkg: T): T {
    const generated = buildMenuContributions();
    const isGenerated = (entry: { command: string }) => entry.command.startsWith(COMMAND_PREFIX);
    const contributes = pkg.contributes;
    const otherMenus = Object.fromEntries(Object.entries(contributes.menus ?? {}).filter(([id]) => !id.startsWith(COMMAND_PREFIX)));

    return {
        ...pkg,
        contributes: {
            ...contributes,
            commands: [...(contributes.commands ?? []).filter((c: any) => !isGenerated(c)), ...generated.commands],
            submenus: [...(contributes.submenus ?? []).filter((s: any) => !s.id.startsWith(COMMAND_PREFIX)), ...generated.submenus],
            menus: {
                ...otherMenus,
                ...generated.submenuItems,
                commandPalette: [...(contributes.menus?.commandPalette ?? []).filter((c: any) => !isGenerated(c)), ...generated.commandPalette],
                'webview/context': generated.webviewContext,
            },
            keybindings: [...(contributes.keybindings ?? []).filter((c: any) => !isGenerated(c)), ...generated.keybindings],
        },
    };
}
