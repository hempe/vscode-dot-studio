import { fireEvent, render, screen } from '@testing-library/react';
import { TreeNode } from '../../../../../webview/solution-view/components/TreeNode/TreeNode';
import { describeMarker } from '../../../../../webview/solution-view/components/TreeNode/diagnosticMarker';
import { NodeIdString } from '../../../../../types/nodeId';
import { DiagnosticMarkers, ProjectNode } from '../../../../../types';

const fileNode: ProjectNode = { type: 'file', name: 'Program.cs', nodeId: 'file-1' as NodeIdString };
const folderNode: ProjectNode = { type: 'folder', name: 'Controllers', nodeId: 'folder-1' as NodeIdString };

const props = {
    level: 0,
    onProjectAction: jest.fn(),
    onToggleExpand: jest.fn(),
    onNodeClick: jest.fn(),
    onNodeFocus: jest.fn(),
    onRenameConfirm: jest.fn(),
    onRenameCancel: jest.fn(),
};

const markers = {
    ['file-1']: { severity: 'error', errors: 3, warnings: 2, infos: 0 },
    ['folder-1']: { severity: 'warning', errors: 0, warnings: 1, infos: 0 },
} as unknown as DiagnosticMarkers;

describe('TreeNode diagnostics markers', () => {
    test('a file shows its colour and a count badge for the most severe state', () => {
        const { container } = render(<TreeNode {...props} node={fileNode} markers={markers} />);
        expect(screen.getByText('Program.cs')).toHaveClass('diagnostic-error');
        const badge = container.querySelector('.diagnostic-badge');
        expect(badge).toHaveTextContent('3');
        expect(badge).toHaveAttribute('title', '3 errors, 2 warnings\nClick to list them in the Error List');
        expect(container.querySelector('.diagnostic-dot')).toBeNull();
    });

    test('a folder shows a dot instead of a count', () => {
        const { container } = render(<TreeNode {...props} node={folderNode} markers={markers} />);
        expect(screen.getByText('Controllers')).toHaveClass('diagnostic-warning');
        expect(container.querySelector('.diagnostic-dot')).toHaveAttribute('title', '1 warning\nClick to list them in the Error List');
        expect(container.querySelector('.diagnostic-badge')).toBeNull();
    });

    test('a click on the marker asks for the Error List narrowed to the node, without selecting the row', () => {
        const onProjectAction = jest.fn();
        const onNodeClick = jest.fn();
        const { container } = render(<TreeNode {...props} onProjectAction={onProjectAction} onNodeClick={onNodeClick} node={folderNode} markers={markers} />);
        fireEvent.click(container.querySelector('.diagnostic-dot')!);
        expect(onProjectAction).toHaveBeenCalledWith({ action: 'showDiagnostics', nodeId: 'folder-1' });
        expect(onNodeClick).not.toHaveBeenCalled();
    });

    test('nodes without a marker render as before', () => {
        const { container } = render(<TreeNode {...props} node={fileNode} markers={{} as DiagnosticMarkers} />);
        expect(screen.getByText('Program.cs').className).not.toMatch(/diagnostic-/);
        expect(container.querySelector('.diagnostic-badge, .diagnostic-dot')).toBeNull();
    });

    test('children receive their markers', () => {
        const parent: ProjectNode = { ...folderNode, expanded: true, children: [fileNode] };
        render(<TreeNode {...props} node={parent} markers={markers} />);
        expect(screen.getByText('Program.cs')).toHaveClass('diagnostic-error');
    });
});

describe('describeMarker', () => {
    test('lists the non-zero counts with plurals', () => {
        expect(describeMarker({ severity: 'error', errors: 1, warnings: 0, infos: 2 })).toBe('1 error, 2 infos');
        expect(describeMarker({ severity: 'warning', errors: 0, warnings: 2, infos: 0 })).toBe('2 warnings');
    });
});
