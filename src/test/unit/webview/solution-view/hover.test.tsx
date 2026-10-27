// The row under the mouse gets its highlight without rendering the tree (review A3-8)
import { act, fireEvent, render } from '@testing-library/react';
import { SolutionTree } from '../../../../webview/solution-view/components/SolutionTree';
import * as TreeNodeModule from '../../../../webview/solution-view/components/TreeNode/TreeNode';

const projects = [
    { nodeId: 'a', type: 'project', name: 'First', fileName: 'First.csproj', expanded: false, hasChildren: false },
    { nodeId: 'b', type: 'project', name: 'Second', fileName: 'Second.csproj', expanded: false, hasChildren: false },
] as any;

describe('hover in the Solution Explorer', () => {
    const mount = async () => {
        const view = render(<SolutionTree projects={projects} onProjectAction={() => { }} onExpandNode={() => { }} onCollapseNode={() => { }} markers={{} as any} />);
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
        return view;
    };

    it('highlights the row under the mouse, one at a time, and none outside the tree', async () => {
        const { container } = await mount();
        const rows = () => [...container.querySelectorAll('.tree-node')];

        fireEvent.mouseMove(rows()[0], { movementX: 1 });
        expect(rows().map(row => row.classList.contains('hovered'))).toEqual([true, false]);
        fireEvent.mouseMove(rows()[1], { movementX: 1 });
        expect(rows().map(row => row.classList.contains('hovered'))).toEqual([false, true]);
        fireEvent.mouseLeave(container.querySelector('.solution-tree')!);
        expect(rows().map(row => row.classList.contains('hovered'))).toEqual([false, false]);
    });

    it('does not render the rows again when the mouse moves', async () => {
        const spy = jest.spyOn(TreeNodeModule, 'TreeNode');
        const { container } = await mount();
        const rows = [...container.querySelectorAll('.tree-node')];
        spy.mockClear();

        fireEvent.mouseMove(rows[0], { movementX: 1 });
        fireEvent.mouseMove(rows[1], { movementX: 1 });

        expect(spy).not.toHaveBeenCalled();
    });
});
