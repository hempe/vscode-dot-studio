// The built-in icons are VS Code's icon font (codicons): nothing is bundled or fetched (review A3-1)
import { act, render } from '@testing-library/react';

const fetchSpy = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
(global as any).fetch = fetchSpy;

import { SolutionTree } from '../../../../webview/solution-view/components/SolutionTree';

describe('Solution Explorer built-in icons', () => {
    it('show a chevron and an icon in a row without a network request', async () => {
        const projects = [{ nodeId: 'a', type: 'project', name: 'App', fileName: 'App.csproj', expanded: false, hasChildren: true }] as any;
        const { container } = render(<SolutionTree projects={projects} activeFilePath={null} onProjectAction={() => { }} onExpandNode={() => { }} onCollapseNode={() => { }} markers={{} as any} />);
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });

        const row = container.querySelector('.tree-node')!;
        expect(row.querySelector('.codicon-chevron-right')).not.toBeNull();
        expect(row.querySelector('.node-icon .codicon')).not.toBeNull();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('uses a codicon for Dependencies and its categories', async () => {
        const projects = [{
            nodeId: 'p', type: 'project', name: 'App', fileName: 'App.csproj', expanded: true, hasChildren: true,
            children: [{ nodeId: 'd', type: 'dependencies', name: 'Dependencies', expanded: true, hasChildren: true,
                children: [
                    { nodeId: 'dp', type: 'dependencyCategory', name: 'Packages', hasChildren: false },
                    { nodeId: 'da', type: 'dependencyCategory', name: 'Assemblies', hasChildren: false },
                ] }],
        }] as any;
        const { container } = render(<SolutionTree projects={projects} activeFilePath={null} onProjectAction={() => { }} onExpandNode={() => { }} onCollapseNode={() => { }} markers={{} as any} />);
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });

        const icons = [...container.querySelectorAll('.node-icon .codicon')].map(element => element.className);
        expect(icons.some(name => name.includes('codicon-references'))).toBe(true);
        expect(icons.some(name => name.includes('codicon-package'))).toBe(true);
        expect(icons.some(name => name.includes('codicon-library'))).toBe(true);
    });
});
