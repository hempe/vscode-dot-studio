import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SolutionTree } from '../../../../../webview/solution-view/components/SolutionTree';

// Mock data for testing
const mockProjects = [
  {
    type: 'solution',
    name: 'TestSolution',
    path: '/test/TestSolution.sln',
    children: [
      {
        type: 'project',
        name: 'WebApp',
        path: '/test/WebApp/WebApp.csproj',
        children: [
          {
            type: 'file',
            name: 'Program.cs',
            path: '/test/WebApp/Program.cs'
          },
          {
            type: 'folder',
            name: 'Controllers',
            path: '/test/WebApp/Controllers',
            children: [
              {
                type: 'file',
                name: 'HomeController.cs',
                path: '/test/WebApp/Controllers/HomeController.cs'
              }
            ]
          }
        ]
      },
      {
        type: 'project',
        name: 'TestProject',
        path: '/test/TestProject/TestProject.csproj',
        children: [
          {
            type: 'file',
            name: 'UnitTest1.cs',
            path: '/test/TestProject/UnitTest1.cs'
          }
        ]
      }
    ]
  }
];

describe('SolutionTree Keyboard Navigation', () => {
  const mockOnProjectAction = jest.fn();
  let user: ReturnType<typeof userEvent.setup>;

  beforeEach(() => {
    user = userEvent.setup();
    mockOnProjectAction.mockClear();
    // Clear console mocks
    (console.log as jest.Mock).mockClear();
    (console.debug as jest.Mock).mockClear();
    (console.info as jest.Mock).mockClear();
  });

  const renderSolutionTree = () => {
    return render(
      <SolutionTree
        projects={mockProjects}
        onProjectAction={mockOnProjectAction}
      />
    );
  };

  describe('Arrow Key Navigation', () => {
    test('should navigate down with ArrowDown key', async () => {
      renderSolutionTree();

      const treeContainer = screen.getByRole('generic', { name: /solution-tree/i }) ||
                           document.querySelector('.solution-tree');

      // Focus the tree
      if (treeContainer) {
        treeContainer.focus();
      }

      // First, expand the solution to show projects
      const solutionNode = screen.getByText('TestSolution');
      await user.click(solutionNode);

      // Now test arrow navigation
      await user.keyboard('{ArrowDown}');

      // Should focus the first project
      expect(document.querySelector('.tree-node.focused')).toBeTruthy();
    });

    test('should navigate up with ArrowUp key', async () => {
      renderSolutionTree();

      const treeContainer = document.querySelector('.solution-tree');
      if (treeContainer) {
        (treeContainer as HTMLElement).focus();
      }

      // Expand solution first
      const solutionNode = screen.getByText('TestSolution');
      await user.click(solutionNode);

      // Navigate down then up
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowUp}');

      // Should be back at solution level
      const focusedElement = document.querySelector('.tree-node.focused');
      expect(focusedElement).toBeTruthy();
    });

    test('should expand node with ArrowRight key', async () => {
      renderSolutionTree();

      const treeContainer = document.querySelector('.solution-tree');
      if (treeContainer) {
        (treeContainer as HTMLElement).focus();
      }

      // Focus on solution node and expand with right arrow
      const solutionNode = screen.getByText('TestSolution');
      await user.click(solutionNode);

      await user.keyboard('{ArrowRight}');

      // Should see expanded content
      await waitFor(() => {
        expect(screen.getByText('WebApp')).toBeInTheDocument();
      });
    });

    test('should collapse node with ArrowLeft key', async () => {
      renderSolutionTree();

      // First expand the solution
      const solutionNode = screen.getByText('TestSolution');
      await user.click(solutionNode);

      // Wait for expansion
      await waitFor(() => {
        expect(screen.getByText('WebApp')).toBeInTheDocument();
      });

      const treeContainer = document.querySelector('.solution-tree');
      if (treeContainer) {
        (treeContainer as HTMLElement).focus();
      }

      // Now collapse with left arrow
      await user.keyboard('{ArrowLeft}');

      // Content should be hidden (though elements might still exist in DOM)
      // Check for collapsed state by looking for chevron direction
      const chevronIcon = document.querySelector('.codicon-chevron-right');
      expect(chevronIcon).toBeTruthy();
    });
  });

  describe('Enter and Space Key Behavior', () => {
    test('should open file when Enter is pressed on file node', async () => {
      renderSolutionTree();

      // Expand to show files
      const solutionNode = screen.getByText('TestSolution');
      await user.click(solutionNode);

      await waitFor(() => {
        expect(screen.getByText('WebApp')).toBeInTheDocument();
      });

      const projectNode = screen.getByText('WebApp');
      await user.click(projectNode);

      await waitFor(() => {
        expect(screen.getByText('Program.cs')).toBeInTheDocument();
      });

      // Click on file to focus it
      const fileNode = screen.getByText('Program.cs');
      await user.click(fileNode);

      const treeContainer = document.querySelector('.solution-tree');
      if (treeContainer) {
        (treeContainer as HTMLElement).focus();
      }

      // Press Enter on file
      await user.keyboard('{Enter}');

      expect(mockOnProjectAction).toHaveBeenCalledWith(
        'openFile',
        '/test/WebApp/Program.cs'
      );
    });

    test('should toggle expansion when Enter is pressed on folder', async () => {
      renderSolutionTree();

      // Navigate to a folder and press Enter
      const solutionNode = screen.getByText('TestSolution');
      await user.click(solutionNode);

      await waitFor(() => {
        expect(screen.getByText('WebApp')).toBeInTheDocument();
      });

      const projectNode = screen.getByText('WebApp');
      await user.click(projectNode);

      await waitFor(() => {
        expect(screen.getByText('Controllers')).toBeInTheDocument();
      });

      // Focus on Controllers folder
      const folderNode = screen.getByText('Controllers');
      await user.click(folderNode);

      const treeContainer = document.querySelector('.solution-tree');
      if (treeContainer) {
        (treeContainer as HTMLElement).focus();
      }

      // Press Enter to expand folder
      await user.keyboard('{Enter}');

      // Should show folder contents
      await waitFor(() => {
        expect(screen.getByText('HomeController.cs')).toBeInTheDocument();
      });
    });

    test('should select node when Space is pressed', async () => {
      renderSolutionTree();

      const solutionNode = screen.getByText('TestSolution');
      await user.click(solutionNode);

      const treeContainer = document.querySelector('.solution-tree');
      if (treeContainer) {
        (treeContainer as HTMLElement).focus();
      }

      await user.keyboard('{Space}');

      // Should have selected class
      expect(document.querySelector('.tree-node.selected')).toBeTruthy();
    });
  });

  describe('F2 Rename Functionality', () => {
    test('should start rename when F2 is pressed on focused node', async () => {
      renderSolutionTree();

      // Focus on solution and press F2
      const solutionNode = screen.getByText('TestSolution');
      await user.click(solutionNode);

      const treeContainer = document.querySelector('.solution-tree');
      if (treeContainer) {
        (treeContainer as HTMLElement).focus();
      }

      await user.keyboard('{F2}');

      expect(mockOnProjectAction).toHaveBeenCalledWith(
        'startRename',
        '/test/TestSolution.sln',
        expect.objectContaining({
          type: 'solution',
          name: 'TestSolution'
        })
      );
    });
  });

  describe('Focus vs Selection States', () => {
    test('should have different styles for focused vs selected nodes', async () => {
      renderSolutionTree();

      const solutionNode = screen.getByText('TestSolution');
      await user.click(solutionNode);

      // Node should be both focused and selected after click
      const nodeElement = solutionNode.closest('.tree-node');
      expect(nodeElement).toHaveClass('focused');
      expect(nodeElement).toHaveClass('selected');
    });

    test('should maintain focus when navigating with arrows', async () => {
      renderSolutionTree();

      // Expand solution first
      const solutionNode = screen.getByText('TestSolution');
      await user.click(solutionNode);

      await waitFor(() => {
        expect(screen.getByText('WebApp')).toBeInTheDocument();
      });

      const treeContainer = document.querySelector('.solution-tree');
      if (treeContainer) {
        (treeContainer as HTMLElement).focus();
      }

      // Navigate with arrows
      await user.keyboard('{ArrowDown}');

      // Should have focused class
      expect(document.querySelector('.tree-node.focused')).toBeTruthy();
    });
  });
});