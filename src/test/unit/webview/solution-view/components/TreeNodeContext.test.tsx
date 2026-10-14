import { render } from '@testing-library/react';
import { TreeNode } from '../../../../../webview/solution-view/components/TreeNode/TreeNode';
import { NodeIdString } from '../../../../../types/nodeId';
import { ProjectNode } from '../../../../../types';

const noop = () => { };
const props = {
    level: 0,
    onProjectAction: noop,
    onToggleExpand: noop,
    onNodeClick: noop,
    onNodeFocus: noop,
    onRenameConfirm: noop,
    onRenameCancel: noop,
};

const project = (isTestProject: boolean): ProjectNode => ({
    type: 'project',
    name: 'Tests',
    nodeId: 'project' as NodeIdString,
    isTestProject,
    expanded: true,
    children: [{
        type: 'folder',
        name: 'Math',
        nodeId: 'folder' as NodeIdString,
        expanded: true,
        children: [{ type: 'file', name: 'MathTests.cs', nodeId: 'file' as NodeIdString }],
    }],
});

/** The `data-vscode-context` of every row, in tree order */
const contexts = (container: HTMLElement) => [...container.querySelectorAll('[data-vscode-context]')]
    .map(row => JSON.parse(row.getAttribute('data-vscode-context')!));

describe('TreeNode context menu context', () => {
    it('marks a test project and everything in it, for Run Tests and Debug Tests', () => {
        const { container } = render(<TreeNode {...props} node={project(true)} />);

        expect(contexts(container).map(context => [context.nodeType, context.inTestProject])).toEqual([
            ['project', true],
            ['folder', true],
            ['file', true],
        ]);
    });

    it('leaves other projects unmarked', () => {
        const { container } = render(<TreeNode {...props} node={project(false)} />);

        expect(contexts(container).map(context => context.inTestProject)).toEqual([undefined, undefined, undefined]);
    });
});
