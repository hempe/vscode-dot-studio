import { applyMenuContributions, buildMenuContributions, buildMenuReference, contextMenus, menuCommands, MenuCommandAction, submenus, testProjectMenus } from '../../../core/contextMenus';
import { NodeType } from '../../../types';

const packageJson = require('../../../../package.json');
const fs = require('fs');
const path = require('path');

describe('contextMenus', () => {
    test('package.json is up to date (run `npm run generate:menus`)', () => {
        expect(applyMenuContributions(packageJson)).toEqual(packageJson);
    });

    test('every command is used by at least one menu', () => {
        const used = new Set([
            ...Object.values(contextMenus).flat(2),
            ...Object.values(testProjectMenus).flat(2),
            ...Object.values(submenus).flatMap(submenu => submenu.items),
        ]);
        expect((Object.keys(menuCommands) as MenuCommandAction[]).filter(action => !used.has(action))).toEqual([]);
    });

    test('a key is bound to at most one command per node type', () => {
        const nodeTypes = Object.keys(contextMenus) as NodeType[];
        const bound = new Map<string, string>();

        for (const binding of buildMenuContributions().keybindings) {
            for (const nodeType of nodeTypes) {
                const types = binding.when.match(/\/\^\((.*)\)\$\//)![1].split('|');
                if (!types.includes(nodeType)) continue;
                const slot = `${binding.key} on ${nodeType}`;
                expect(bound.get(slot)).toBeUndefined();
                bound.set(slot, binding.command);
            }
        }

        expect(bound.get('delete on file')).toBe('shinobi.solutionExplorer.deleteFile');
        expect(bound.get('delete on solutionFolder')).toBe('shinobi.solutionExplorer.removeSolutionFolder');
        expect(bound.get('delete on project')).toBeUndefined();
    });

    test('menu entries keep the order and separators of the node type menu', () => {
        const projectEntries = buildMenuContributions().webviewContext
            .filter(entry => entry.when.endsWith(`nodeType == 'project'`));

        expect(projectEntries.slice(0, 4)).toEqual([
            expect.objectContaining({ command: 'shinobi.solutionExplorer.editProjectFile', group: '1_group@1' }),
            expect.objectContaining({ command: 'shinobi.solutionExplorer.addNewItem', group: '2_group@1' }),
            expect.objectContaining({ command: 'shinobi.solutionExplorer.addExistingItem', group: '2_group@2' }),
            expect.objectContaining({ command: 'shinobi.solutionExplorer.addFile', group: '2_group@3' }),
        ]);
    });

    test('dependency categories get menus by context value', () => {
        const categoryEntries = buildMenuContributions().webviewContext
            .filter(entry => entry.when.includes(`nodeType == 'dependencyCategory'`))
            .map(entry => `${entry.when.match(/contextValue == '(\w+)'/)?.[1]}: ${entry.command}`);

        expect(categoryEntries).toEqual([
            'packages: shinobi.solutionExplorer.manageNuGetPackages',
            'packages: shinobi.solutionExplorer.restoreDependencies',
            'projects: shinobi.solutionExplorer.addProjectReference',
            'assemblies: shinobi.solutionExplorer.addAssemblyReference',
        ]);
    });

    it('offers service reference actions on projects, Connected Services and reference folders', () => {
        const { webviewContext } = buildMenuContributions();
        const when = (command: string) => webviewContext.filter(e => e.command === `shinobi.solutionExplorer.${command}`).map(e => e.when);
        expect(when('addServiceReference')).toEqual(expect.arrayContaining([
            expect.stringContaining("nodeType == 'project'"),
            expect.stringContaining("contextValue == 'connectedServices'"),
        ]));
        expect(when('updateServiceReference')).toEqual([expect.stringContaining("nodeType == 'folder' && contextValue == 'serviceReference'")]);
        expect(when('removeServiceReference')).toEqual([expect.stringContaining("contextValue == 'serviceReference'")]);
    });

    it('offers the Debug submenu on projects that can be started, the startup project included', () => {
        const { webviewContext, submenus: generated, submenuItems } = buildMenuContributions();
        const debugMenu = webviewContext.filter(entry => entry.submenu === 'shinobi.solutionExplorer.debug');
        expect(debugMenu.map(entry => entry.when.match(/contextValue == '(\w+)'/)?.[1]).sort())
            .toEqual(['executable', 'startup', 'startupWithProfiles']);
        expect(generated).toEqual([{ id: 'shinobi.solutionExplorer.debug', label: 'Debug' }]);
        expect(submenuItems['shinobi.solutionExplorer.debug'].map(item => item.command)).toEqual([
            'shinobi.solutionExplorer.startNewInstance',
            'shinobi.solutionExplorer.startWithoutDebugging',
        ]);
    });

    it('offers Run Tests and Debug Tests on the solution and on everything in test projects', () => {
        const { webviewContext } = buildMenuContributions();
        const when = (command: string) => webviewContext
            .filter(entry => entry.command === `shinobi.solutionExplorer.${command}`)
            .map(entry => entry.when.replace(/^.*webviewSection == 'node' && /, ''));
        const expected = [
            "nodeType == 'solution'",
            "nodeType == 'project' && inTestProject",
            "nodeType == 'folder' && inTestProject",
            "nodeType == 'file' && inTestProject",
        ];
        expect(when('runTests')).toEqual(expected);
        expect(when('debugTests')).toEqual(expected);
    });

    it('offers Open in Terminal, Copy Full Path, Edit Project File and Add Existing Item like Visual Studio', () => {
        const { webviewContext } = buildMenuContributions();
        const nodeTypes = (command: string) => [...new Set(webviewContext
            .filter(entry => entry.command === `shinobi.solutionExplorer.${command}`)
            .map(entry => entry.when.match(/nodeType == '(\w+)'/)![1]))];
        expect(nodeTypes('openInTerminal')).toEqual(['solution', 'project', 'folder']);
        expect(nodeTypes('copyFullPath')).toEqual(['solution', 'project', 'folder', 'file', 'solutionItem', 'generatedFile']);
        expect(nodeTypes('editProjectFile')).toEqual(['project']);
        expect(nodeTypes('addExistingItem')).toEqual(['project', 'folder']);
        expect(nodeTypes('manageUserSecrets')).toEqual(['project']);
        expect(nodeTypes('publish')).toEqual(['project']);
    });

    test('docs/context-menus.md is up to date (run `npm run generate:menus`)', () => {
        const reference = fs.readFileSync(path.join(__dirname, '../../../../docs/context-menus.md'), 'utf8');
        expect(reference).toBe(buildMenuReference());
    });

    test('the menu reference explains every command of a node type, with its key and conditions', () => {
        const reference = buildMenuReference();
        const project = reference.slice(reference.indexOf('## Project\n'), reference.indexOf('## Folder\n'));

        expect(project).toContain('| Edit Project File |  | Opens the project file (`.csproj`) in the editor, like double-clicking the project. |');
        expect(project).toContain('| Rename | F2 |');
        expect(project).toContain('**On projects that can be started**');
        expect(project).toContain('| Debug > Start New Instance |  |');
        expect(project).toContain('**In test projects**');
        expect(reference).toContain('| Delete | Delete (macOS: Cmd+Backspace) |');
        expect(reference).not.toContain('## temporary');
    });
});

describe('docs/keyboard-shortcuts.md', () => {
    test('lists every key binding the extension contributes', () => {
        const page = fs.readFileSync(path.join(__dirname, '../../../../docs/keyboard-shortcuts.md'), 'utf8');
        const keyName = (key: string) => key.split(' ').map(chord => chord.split('+').map(part =>
            ({ ctrl: 'Ctrl', cmd: 'Cmd', shift: 'Shift', alt: 'Alt', delete: 'Delete', backspace: 'Backspace' } as Record<string, string>)[part]
            ?? part.toUpperCase()).join('+')).join(', ');
        const missing = (packageJson.contributes.keybindings as { key: string; mac?: string }[])
            .flatMap(binding => [binding.key, ...(binding.mac && binding.mac !== binding.key ? [binding.mac] : [])])
            .map(keyName)
            .filter(key => !page.includes(key));
        expect(missing).toEqual([]);
    });
});
