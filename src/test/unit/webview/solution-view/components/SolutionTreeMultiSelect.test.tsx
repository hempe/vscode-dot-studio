import { fireEvent, render } from '@testing-library/react';

const sent: any[] = [];
jest.mock('../../../../../webview/nuget-view/shared', () => ({
    ...jest.requireActual('../../../../../webview/nuget-view/shared'),
    sendToBackend: (message: unknown) => sent.push(message),
}));

import { SolutionTree } from '../../../../../webview/solution-view/components/SolutionTree';
import { NodeIdString } from '../../../../../types/nodeId';
import { ProjectNode } from '../../../../../types';

const file = (name: string): ProjectNode => ({ type: 'file', name, nodeId: name as NodeIdString });
const projects: ProjectNode[] = [{
    type: 'solution', name: 'App', nodeId: 'App' as NodeIdString, expanded: true,
    children: [{
        type: 'project', name: 'Api', nodeId: 'Api' as NodeIdString, expanded: true,
        children: [file('A.cs'), file('B.cs'), file('C.cs'), file('D.cs')],
    }],
}];

describe('SolutionTree multi-select (Ctrl/Shift+click, like Visual Studio)', () => {
    beforeEach(() => { sent.length = 0; });

    const setup = () => {
        const { container } = render(<SolutionTree projects={projects} onProjectAction={() => { }} />);
        const row = (name: string) => [...container.querySelectorAll('.tree-node')].find(node => node.textContent === name)!;
        const selected = () => [...container.querySelectorAll('.tree-node.selected')].map(node => node.textContent);
        const lastSelection = () => [...sent].reverse().find(m => m.type === 'treeSelectionChanged')?.payload.nodeIds;
        return { row, selected, lastSelection };
    };

    it('Ctrl+click adds and removes nodes, Shift+click selects a range, and the extension learns the selection', () => {
        const { row, selected, lastSelection } = setup();
        fireEvent.click(row('A.cs'), { ctrlKey: true });
        fireEvent.click(row('C.cs'), { ctrlKey: true });
        expect(selected()).toEqual(['A.cs', 'C.cs']);

        fireEvent.click(row('A.cs'), { ctrlKey: true });
        expect(selected()).toEqual(['C.cs']);

        // Ctrl+click moved the range anchor to A, as in Visual Studio
        fireEvent.click(row('C.cs'), { shiftKey: true });
        expect(selected()).toEqual(['A.cs', 'B.cs', 'C.cs']);
        expect(lastSelection()).toEqual(['A.cs', 'B.cs', 'C.cs']);
    });

    it('right-clicking a node outside the selection selects only that node', () => {
        const { row, selected } = setup();
        fireEvent.click(row('A.cs'), { ctrlKey: true });
        fireEvent.click(row('B.cs'), { ctrlKey: true });

        fireEvent.contextMenu(row('B.cs'));
        expect(selected()).toEqual(['A.cs', 'B.cs']);
        fireEvent.contextMenu(row('D.cs'));
        expect(selected()).toEqual(['D.cs']);
    });
});
