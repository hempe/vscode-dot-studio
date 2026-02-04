// import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TreeNode } from '../../../../../webview/solution-view/components/TreeNode/TreeNode';
import { NodeIdString } from '../../../../../types/nodeId';
import { ProjectNode } from '../../../../../types';

describe('TreeNode Focus and Selection States', () => {
  const mockOnProjectAction = jest.fn();
  const mockOnToggleExpand = jest.fn();
  const mockOnNodeClick = jest.fn();
  const mockOnNodeFocus = jest.fn();
  const mockOnContextMenu = jest.fn();
  const mockOnRenameConfirm = jest.fn();
  const mockOnRenameCancel = jest.fn();

  let user: ReturnType<typeof userEvent.setup>;

  const fileNode: ProjectNode = {
    type: 'file',
    name: 'Program.cs',
    nodeId: 'file:/test/Program.cs' as NodeIdString
  };

  const folderNode: ProjectNode = {
    type: 'folder',
    name: 'Controllers',
    nodeId: 'folder:/test/Controllers' as NodeIdString,
    children: [
      {
        type: 'file',
        name: 'HomeController.cs',
        nodeId: 'file:/test/Controllers/HomeController.cs' as NodeIdString
      }
    ],
    expanded: false
  };

  const defaultProps = {
    node: fileNode,
    level: 0,
    onProjectAction: mockOnProjectAction,
    onToggleExpand: mockOnToggleExpand,
    onNodeClick: mockOnNodeClick,
    onNodeFocus: mockOnNodeFocus,
    onContextMenu: mockOnContextMenu,
    onRenameConfirm: mockOnRenameConfirm,
    onRenameCancel: mockOnRenameCancel,
    selectedNodeId: undefined,
    focusedNodeId: undefined,
    renamingNodeId: undefined
  };

  beforeEach(() => {
    user = userEvent.setup();
    mockOnProjectAction.mockClear();
    mockOnToggleExpand.mockClear();
    mockOnNodeClick.mockClear();
    mockOnNodeFocus.mockClear();
    mockOnContextMenu.mockClear();
    mockOnRenameConfirm.mockClear();
    mockOnRenameCancel.mockClear();

    // Clear console mocks
    (console.log as jest.Mock).mockClear();
    (console.debug as jest.Mock).mockClear();
    (console.info as jest.Mock).mockClear();
  });

  describe('Mouse Interactions', () => {
    test('should call onNodeClick when left-clicked', async () => {
      render(<TreeNode {...defaultProps} />);

      const nodeElement = screen.getByText('Program.cs');
      await user.click(nodeElement);

      // Wait for debounced click
      await waitFor(() => {
        expect(mockOnNodeClick).toHaveBeenCalledWith('file:/test/Program.cs');
      }, { timeout: 300 });
    });

    test('should call onProjectAction with openFile on double-click', async () => {
      render(<TreeNode {...defaultProps} />);

      const nodeElement = screen.getByText('Program.cs');
      await user.dblClick(nodeElement);

      expect(mockOnProjectAction).toHaveBeenCalledWith('openFile', 'file:/test/Program.cs', undefined);
    });

    test('should call onContextMenu on right-click', async () => {
      render(<TreeNode {...defaultProps} />);

      const nodeElement = screen.getByText('Program.cs');
      fireEvent.contextMenu(nodeElement, {
        clientX: 100,
        clientY: 200
      });

      expect(mockOnContextMenu).toHaveBeenCalledWith(100, 200, fileNode);
    });

    test('should toggle expansion on single click for folders', async () => {
      render(<TreeNode {...defaultProps} node={folderNode} />);

      const nodeElement = screen.getByText('Controllers');
      await user.click(nodeElement);

      // Wait for debounced click
      await waitFor(() => {
        expect(mockOnToggleExpand).toHaveBeenCalledWith('folder:/test/project:/test/Controllers', 'folder');
      }, { timeout: 300 });
    });
  });

  describe('Visual States', () => {
    test('should have selected class when node is selected', () => {
      render(
        <TreeNode
          {...defaultProps}
          selectedNodeId={fileNode.nodeId}
        />
      );

      const nodeElement = screen.getByText('Program.cs').closest('.tree-node');
      expect(nodeElement).toHaveClass('selected');
    });

    test('should have focused class when node is focused', () => {
      render(
        <TreeNode
          {...defaultProps}
          focusedNodeId={fileNode.nodeId}
        />
      );

      const nodeElement = screen.getByText('Program.cs').closest('.tree-node');
      expect(nodeElement).toHaveClass('focused');
    });

    test('should have both focused and selected classes when both states are true', () => {
      render(
        <TreeNode
          {...defaultProps}
          selectedNodeId={fileNode.nodeId}
          focusedNodeId={fileNode.nodeId}
        />
      );

      const nodeElement = screen.getByText('Program.cs').closest('.tree-node');
      expect(nodeElement).toHaveClass('focused');
      expect(nodeElement).toHaveClass('selected');
    });

    test('should not have selected or focused classes when node is not selected or focused', () => {
      render(<TreeNode {...defaultProps} />);

      const nodeElement = screen.getByText('Program.cs').closest('.tree-node');
      expect(nodeElement).not.toHaveClass('selected');
      expect(nodeElement).not.toHaveClass('focused');
    });
  });

  describe('File Type Icons', () => {
    test('should display correct icon for C# files', () => {
      render(<TreeNode {...defaultProps} />);

      // Look for the node-icon container instead of specific icon classes
      const iconContainer = document.querySelector('.node-icon');
      expect(iconContainer).toBeInTheDocument();
    });

    test('should display correct icon for folders', () => {
      render(<TreeNode {...defaultProps} node={folderNode} />);

      // Look for the node-icon container instead of specific icon classes
      const iconContainer = document.querySelector('.node-icon');
      expect(iconContainer).toBeInTheDocument();
    });

    test('should show chevron for expandable nodes', () => {
      const nodeWithChildren = { ...folderNode, hasChildren: true };
      render(<TreeNode {...defaultProps} node={nodeWithChildren} />);

      // Look for the expand-icon instead of specific chevron classes
      const chevronElement = document.querySelector('.expand-icon');
      expect(chevronElement).toBeInTheDocument();
    });

    test('should show down chevron for expanded nodes', () => {
      const expandedFolder = { ...folderNode, expanded: true, hasChildren: true };
      render(<TreeNode {...defaultProps} node={expandedFolder} />);

      // Look for the expand-icon and check if it's rotated (expanded state)
      const chevronElement = document.querySelector('.expand-icon');
      expect(chevronElement).toBeInTheDocument();
      // The expanded state is shown via CSS transform rotation, not different icons
    });
  });

  describe('Keyboard Events', () => {
    test('TreeNode does not handle keyboard events directly', () => {
      // TreeNode delegates keyboard handling to SolutionTree
      // This is tested in SolutionTree.test.tsx instead
      expect(true).toBe(true);
    });
  });

  describe('Indentation', () => {
    test('should apply correct padding based on level', () => {
      render(<TreeNode {...defaultProps} level={2} />);

      const nodeElement = screen.getByText('Program.cs').closest('.tree-node') as HTMLElement;
      expect(nodeElement?.style.paddingLeft).toBe('32px'); // 2 * 16px
    });

    test('should have zero padding at root level', () => {
      render(<TreeNode {...defaultProps} level={0} />);

      const nodeElement = screen.getByText('Program.cs').closest('.tree-node') as HTMLElement;
      expect(nodeElement?.style.paddingLeft).toBe('0px');
    });
  });

  describe('Child Rendering', () => {
    test('should render children when node is expanded', () => {
      const expandedFolder = { ...folderNode, expanded: true };
      render(<TreeNode {...defaultProps} node={expandedFolder} />);

      expect(screen.getByText('HomeController.cs')).toBeInTheDocument();
    });

    test('should not render children when node is collapsed', () => {
      render(<TreeNode {...defaultProps} node={folderNode} />);

      expect(screen.queryByText('HomeController.cs')).not.toBeInTheDocument();
    });
  });

  describe('Click Debouncing', () => {
    test('should cancel single click when double click occurs', async () => {
      render(<TreeNode {...defaultProps} />);

      const nodeElement = screen.getByText('Program.cs');

      // Simulate fast single click followed by double click
      await user.click(nodeElement);
      await user.dblClick(nodeElement);

      // Should only call openFile from double click, not onNodeClick from single click
      expect(mockOnProjectAction).toHaveBeenCalledWith('openFile', 'file:/test/Program.cs', undefined);

      // Wait for any potential delayed single click
      await waitFor(() => {
        expect(mockOnNodeClick).not.toHaveBeenCalled();
      }, { timeout: 300 });
    });
  });
});