import { render, screen } from '@testing-library/react';
import { TreeNode } from '../../../../../webview/solution-view/components/TreeNode/TreeNode';
import { NodeIdString } from '../../../../../types/nodeId';
import { ProjectNode } from '../../../../../types';

const props = {
    level: 0,
    onProjectAction: jest.fn(),
    onToggleExpand: jest.fn(),
    onNodeClick: jest.fn(),
    onNodeFocus: jest.fn(),
    onRenameConfirm: jest.fn(),
    onRenameCancel: jest.fn(),
};

describe('a temporary solution in the tree', () => {
    it('says it is not saved', () => {
        const node: ProjectNode = { type: 'solution', name: 'App', nodeId: 'solution-1' as NodeIdString, unsaved: true, contextValue: 'unsaved' };
        render(<TreeNode {...props} node={node} />);
        expect(screen.getByText('App (not saved)')).toBeTruthy();
    });

    it('a saved solution shows only its name', () => {
        const node: ProjectNode = { type: 'solution', name: 'App', nodeId: 'solution-1' as NodeIdString };
        render(<TreeNode {...props} node={node} />);
        expect(screen.getByText('App')).toBeTruthy();
        expect(screen.queryByText(/not saved/)).toBeNull();
    });
});
