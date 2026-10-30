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
    test('a node with problems gets the squiggle of its most severe state, and no count or dot', () => {
        const { container } = render(<TreeNode {...props} node={fileNode} markers={markers} />);
        expect(screen.getByText('Program.cs')).toHaveClass('diagnostic-error');
        expect(container.querySelector('.diagnostic-badge, .diagnostic-dot')).toBeNull();
        const folder = render(<TreeNode {...props} node={folderNode} markers={markers} />);
        expect(folder.getByText('Controllers')).toHaveClass('diagnostic-warning');
    });

    test('the name of such a node has no native tooltip (its hint replaces it) but says its problems to screen readers', () => {
        render(<TreeNode {...props} node={fileNode} markers={markers} />);
        const name = screen.getByText('Program.cs');
        expect(name).not.toHaveAttribute('title');
        expect(name).toHaveAttribute('aria-label', 'Program.cs, 3 errors, 2 warnings');
    });

    test('the mouse over the name reports it with its box and the name, and leaving reports that', () => {
        const onMarkerHover = jest.fn();
        render(<TreeNode {...props} onMarkerHover={onMarkerHover} node={folderNode} markers={markers} />);
        const name = screen.getByText('Controllers');
        fireEvent.mouseEnter(name);
        fireEvent.mouseLeave(name);
        expect(onMarkerHover.mock.calls.map(call => [call[0], call[2]])).toEqual([['folder-1', 'Controllers'], ['folder-1', 'Controllers']]);
        expect(onMarkerHover.mock.calls[1][1]).toBeUndefined();
    });

    test('nodes without problems keep the native tooltip with their name and open no hint', () => {
        const onMarkerHover = jest.fn();
        render(<TreeNode {...props} onMarkerHover={onMarkerHover} node={fileNode} markers={{} as DiagnosticMarkers} />);
        const name = screen.getByText('Program.cs');
        expect(name.className).not.toMatch(/diagnostic-/);
        expect(name).toHaveAttribute('title', 'Program.cs');
        fireEvent.mouseEnter(name);
        expect(onMarkerHover).not.toHaveBeenCalled();
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
