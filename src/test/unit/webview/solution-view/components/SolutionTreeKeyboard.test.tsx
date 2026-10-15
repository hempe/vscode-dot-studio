import { fireEvent, render } from '@testing-library/react';
import { SolutionTree } from '../../../../../webview/solution-view/components/SolutionTree';
import { NodeIdString } from '../../../../../types/nodeId';
import { ProjectNode } from '../../../../../types';

const file = (name: string): ProjectNode => ({ type: 'file', name, nodeId: name as NodeIdString });
const projects: ProjectNode[] = [{
    type: 'solution', name: 'App', nodeId: 'App' as NodeIdString, expanded: true,
    children: [{
        type: 'project', name: 'Api', nodeId: 'Api' as NodeIdString, expanded: true,
        children: [file('Program.cs'), file('Properties.json'), file('appsettings.json'), file('Pricing.cs')],
    }],
}];

describe('SolutionTree keyboard', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const setup = () => {
        const { container } = render(<SolutionTree projects={projects} onProjectAction={() => { }} />);
        const tree = container.querySelector('.solution-tree')!;
        const focused = () => container.querySelector('.tree-node.focused')?.textContent;
        const press = (key: string) => fireEvent.keyDown(tree, { key });
        return { focused, press };
    };

    it('Home and End go to the first and last node', () => {
        const { focused, press } = setup();
        press('End');
        expect(focused()).toBe('Pricing.cs');
        press('Home');
        expect(focused()).toBe('App');
    });

    it('typing jumps to the next node that starts with the typed text', () => {
        const { focused, press } = setup();
        press('p');
        expect(focused()).toBe('Program.cs');
        press('r');
        press('i');
        expect(focused()).toBe('Pricing.cs');

        // A pause starts a new search, from the next node on (wrapping around)
        jest.advanceTimersByTime(1500);
        press('a');
        expect(focused()).toBe('App');
        press('a');
        expect(focused()).toBe('Api');
        press('a');
        expect(focused()).toBe('appsettings.json');
    });

    it('the same letter again cycles through the matches', () => {
        const { focused, press } = setup();
        press('p');
        press('p');
        expect(focused()).toBe('Properties.json');
        press('p');
        expect(focused()).toBe('Pricing.cs');
        press('p');
        expect(focused()).toBe('Program.cs');
    });
});
