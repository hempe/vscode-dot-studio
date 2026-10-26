// The Solution Explorer's built-in icons and chevrons are bundled: no request to api.iconify.design (review A3-1)
import { act, render } from '@testing-library/react';

const fetchSpy = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
(global as any).fetch = fetchSpy;

import { SolutionTree } from '../../../../webview/solution-view/components/SolutionTree';

describe('Solution Explorer icons', () => {
    it('render without any network: a chevron and an icon in the row, no request', async () => {
        const projects = [{ nodeId: 'a', type: 'project', name: 'App', fileName: 'App.csproj', expanded: false, hasChildren: true }] as any;
        const { container } = render(<SolutionTree projects={projects} activeFilePath={null} onProjectAction={() => { }} onExpandNode={() => { }} onCollapseNode={() => { }} markers={{} as any} />);
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });

        const row = container.querySelector('.tree-node')!;
        expect(row.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
