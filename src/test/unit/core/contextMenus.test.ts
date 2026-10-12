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

        expect(bound.get('delete on file')).toBe('dotnet.solutionExplorer.deleteFile');
        expect(bound.get('delete on solutionFolder')).toBe('dotnet.solutionExplorer.removeSolutionFolder');
        expect(bound.get('delete on project')).toBeUndefined();
    });

    test('menu entries keep the order and separators of the node type menu', () => {
        const projectEntries = buildMenuContributions().webviewContext
            .filter(entry => entry.when.endsWith(`nodeType == 'project'`));

        expect(projectEntries.slice(0, 3)).toEqual([
            expect.objectContaining({ command: 'dotnet.solutionExplorer.openFile', group: '1_group@1' }),
            expect.objectContaining({ command: 'dotnet.solutionExplorer.addFile', group: '2_group@1' }),
            expect.objectContaining({ command: 'dotnet.solutionExplorer.addFolder', group: '2_group@2' }),
        ]);
    });

    test('dependency categories get menus by context value', () => {
        const categoryEntries = buildMenuContributions().webviewContext
            .filter(entry => entry.when.includes(`nodeType == 'dependencyCategory'`))
            .map(entry => `${entry.when.match(/contextValue == '(\w+)'/)?.[1]}: ${entry.command}`);

        expect(categoryEntries).toEqual([
            'packages: dotnet.solutionExplorer.manageNuGetPackages',
            'packages: dotnet.solutionExplorer.restoreDependencies',
            'projects: dotnet.solutionExplorer.addProjectReference',
            'assemblies: dotnet.solutionExplorer.addAssemblyReference',
        ]);
    });
});
