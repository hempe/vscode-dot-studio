import { act, render } from '@testing-library/react';
import { SolutionTree } from '../../../../../webview/solution-view/components/SolutionTree';
import { NodeIdString } from '../../../../../types/nodeId';
import { ProjectNode } from '../../../../../types';

const projects: ProjectNode[] = [{
    type: 'solution', name: 'App', nodeId: 'solution' as NodeIdString, expanded: true,
    children: [{
        type: 'project', name: 'Api', nodeId: 'project' as NodeIdString, expanded: true,
        children: [{ type: 'file', name: 'Program.cs', nodeId: 'file' as NodeIdString }],
    }],
}];

describe('SolutionTree: Sync with Active Document', () => {
    it('selects the node the extension reveals and scrolls it into view', () => {
        const scrolled: string[] = [];
        Element.prototype.scrollIntoView = function () { scrolled.push(this.textContent ?? ''); };
        const { container } = render(<SolutionTree projects={projects} onProjectAction={() => { }} />);

        act(() => {
            window.dispatchEvent(new MessageEvent('message', { data: { type: 'selectNode', payload: { nodeId: 'file' } } }));
        });

        expect(container.querySelector('.tree-node.selected')?.textContent).toBe('Program.cs');
        expect(scrolled).toEqual(['Program.cs']);
        expect(document.activeElement).toBe(container.querySelector('.solution-tree'));
    });

    it('only selects and scrolls when following the active editor (Track Active Item), keeping the focus where it is', () => {
        Element.prototype.scrollIntoView = () => { };
        const { container } = render(<SolutionTree projects={projects} onProjectAction={() => { }} />);
        const elsewhere = document.createElement('input');
        document.body.appendChild(elsewhere);
        elsewhere.focus();

        act(() => {
            window.dispatchEvent(new MessageEvent('message', { data: { type: 'selectNode', payload: { nodeId: 'file', focus: false } } }));
        });

        expect(container.querySelector('.tree-node.selected')?.textContent).toBe('Program.cs');
        expect(document.activeElement).toBe(elsewhere);
        elsewhere.remove();
    });
});
