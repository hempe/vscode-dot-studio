import { applyMenuContributions, buildMenuContributions, contextMenus, menuCommands, MenuCommandAction } from '../../../core/contextMenus';
import { NodeType } from '../../../types';

const packageJson = require('../../../../package.json');

describe('contextMenus', () => {
    test('package.json is up to date (run `npm run generate:menus`)', () => {
        expect(applyMenuContributions(packageJson)).toEqual(packageJson);
    });

    test('every command is used by at least one menu', () => {
        const used = new Set(Object.values(contextMenus).flat(2));
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
            expect.objectContaining({ command: 'shinobi.solutionExplorer.openFile', group: '1_group@1' }),
            expect.objectContaining({ command: 'shinobi.solutionExplorer.addNewItem', group: '2_group@1' }),
            expect.objectContaining({ command: 'shinobi.solutionExplorer.addFile', group: '2_group@2' }),
            expect.objectContaining({ command: 'shinobi.solutionExplorer.addFolder', group: '2_group@3' }),
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
});
